use serde_json::{Value, json};
use std::{
    collections::HashSet,
    io::{self, BufRead, Write},
    net::{Ipv4Addr, Shutdown, SocketAddr, TcpStream},
    sync::mpsc::{self, Receiver, SyncSender, TryRecvError},
    thread,
    time::{Duration, Instant},
};
use tungstenite::{Message, WebSocket, client::client_with_config, protocol::WebSocketConfig};

const MAX_COMMAND: usize = 4096;
const MAX_MESSAGE: usize = 65_536;
const LOGIN_TIMEOUT: Duration = Duration::from_secs(5);
const POLL: Duration = Duration::from_millis(25);

enum Input {
    Line(Vec<u8>),
    Invalid,
    End,
}

// The bounded queue and capped line reader also bound input from a broken host.
fn read_input(reader: &mut impl BufRead, tx: &SyncSender<Input>) {
    let mut line = Vec::with_capacity(256);
    let mut oversized = false;
    loop {
        let buffer = match reader.fill_buf() {
            Ok([]) => {
                if !line.is_empty() || oversized {
                    let item = if oversized {
                        Input::Invalid
                    } else {
                        Input::Line(line)
                    };
                    if tx.send(item).is_err() {
                        return;
                    }
                }
                let _ = tx.send(Input::End);
                return;
            }
            Ok(buffer) => buffer,
            Err(_) => {
                let _ = tx.send(Input::End);
                return;
            }
        };
        let end = buffer.iter().position(|byte| *byte == b'\n');
        let count = end.map_or(buffer.len(), |index| index + 1);
        if line.len() + count > MAX_COMMAND {
            oversized = true;
        }
        if !oversized {
            line.extend_from_slice(&buffer[..count]);
        }
        reader.consume(count);
        if end.is_some() {
            let item = if oversized {
                Input::Invalid
            } else {
                Input::Line(std::mem::take(&mut line))
            };
            if tx.send(item).is_err() {
                return;
            }
            line.clear();
            oversized = false;
        }
    }
}

fn emit(value: Value) -> io::Result<()> {
    let mut out = io::stdout().lock();
    serde_json::to_writer(&mut out, &value)?;
    out.write_all(b"\n")?;
    out.flush()
}

fn status(state: &str, detail: &str) -> io::Result<()> {
    emit(json!({"event":"status","state":state,"detail":detail}))
}

fn error(detail: &str) -> io::Result<()> {
    emit(json!({"event":"error","detail":detail}))
}

fn clear_view() -> io::Result<()> {
    emit(json!({"event":"users","users":[],"pointer_users":0}))?;
    emit(json!({"event":"mode","mode":[],"confirmed":false}))
}

fn result(command: &str, ok: bool, detail: &str) -> io::Result<()> {
    emit(json!({"event":"result","command":command,"ok":ok,"detail":detail}))
}

fn clean_label(value: &Value, fallback: &str) -> String {
    value
        .as_str()
        .unwrap_or(fallback)
        .chars()
        .take(80)
        .map(|c| if c.is_control() { ' ' } else { c })
        .collect()
}

fn integer(value: &Value) -> Option<u32> {
    value.as_u64().and_then(|n| u32::try_from(n).ok())
}

fn observed_modes(value: &Value) -> Option<(&[Value], bool)> {
    let modes = value.as_array()?;
    let mut base = None;
    let mut multi_keyboard = false;
    for mode in modes {
        match mode.as_str()? {
            "native" | "merged" | "switched" | "multiplex" if base.is_none() => {
                base = mode.as_str();
            }
            "multi-keyboard" if !multi_keyboard => multi_keyboard = true,
            _ => return None,
        }
    }
    match base? {
        "native" | "merged" if multi_keyboard => None,
        _ => Some((modes, multi_keyboard)),
    }
}

fn is_mouse(device: &Value) -> bool {
    if device["type"] != "pointer"
        || !(device["subtype"] == "mouse" || device.get("subtype").is_none())
    {
        return false;
    }
    // The installed server lists Capture and Touchpad helper users before
    // HID-backed mice. Inspect their path only for filtering; never emit it.
    if let Some(path) = device["path"].as_str() {
        let path = path.trim_start_matches('\\').to_ascii_lowercase();
        if ["capture\\", "touchpad\\", "virtual\\", "sdk\\"]
            .iter()
            .any(|prefix| path.starts_with(prefix))
        {
            return false;
        }
    }
    true
}

// Emit only display data, never raw device paths, fingerprints, or keyboard data.
fn roster(value: &Value) -> Option<Value> {
    let list = value.as_array()?;
    if list.len() > 256 {
        return None;
    }
    let mut ids = HashSet::new();
    let mut hardware = HashSet::new();
    let mut users = Vec::new();
    for user in list {
        let id = integer(&user["id"])?;
        if !ids.insert(id) {
            return None;
        }
        let devices = user["devices"].as_array()?;
        if devices.len() > 32 {
            return None;
        }
        let mut pointers = 0;
        for device in devices {
            let hwid = integer(&device["hwid"])?;
            if !hardware.insert(hwid) || hardware.len() > 1024 {
                return None;
            }
            // Installed MouseMux uses uint32 hardware IDs, including physical
            // mice well above 4095. Never infer device kind from its numeric ID.
            if is_mouse(device) {
                pointers += 1;
            }
        }
        if pointers == 0 {
            continue;
        }
        let channel = |name: &str, fallback| {
            user["color"][name]
                .as_u64()
                .filter(|n| *n <= 255)
                .unwrap_or(fallback)
        };
        users.push(json!({
            "id":id,
            "name":clean_label(&user["name"], &format!("User {id}")),
            "active":user["flags"].as_array().is_some_and(|flags| flags.iter().any(|flag| flag == "active")),
            "color":{"r":channel("r", 70),"g":channel("g", 160),"b":channel("b", 255)},
            "pointers":pointers
        }));
    }
    users.sort_by_key(|user| {
        (
            !user["active"].as_bool().unwrap_or(false),
            user["id"].as_u64().unwrap_or(0),
        )
    });
    Some(json!({"event":"users","pointer_users":users.len(),"users":users}))
}

struct PendingMode {
    name: String,
    started: Instant,
    acknowledged: Option<bool>,
}

struct Bridge {
    socket: Option<WebSocket<TcpStream>>,
    logged_in: bool,
    login_started: Option<Instant>,
    expired: bool,
    pending_mode: Option<PendingMode>,
    multi_keyboard: Option<bool>,
    port: u16,
}

impl Bridge {
    fn new(port: u16) -> Self {
        Self {
            socket: None,
            logged_in: false,
            login_started: None,
            expired: false,
            pending_mode: None,
            multi_keyboard: None,
            port,
        }
    }

    fn send(&mut self, message: Value) -> bool {
        self.socket.as_mut().is_some_and(|socket| {
            socket
                .send(Message::Text(message.to_string().into()))
                .is_ok()
        })
    }

    fn request(&mut self, kind: &str) -> bool {
        self.send(json!({"type":kind}))
    }

    fn close(&mut self) {
        if self.logged_in {
            self.request("client.logout.request.A2M");
        }
        if let Some(mut socket) = self.socket.take() {
            let _ = socket.close(None);
            let _ = socket.get_mut().shutdown(Shutdown::Both);
        }
        self.logged_in = false;
        self.login_started = None;
        self.pending_mode = None;
        self.multi_keyboard = None;
    }

    fn fail(&mut self, detail: &str) -> io::Result<()> {
        self.close();
        clear_view()?;
        status("error", detail)
    }

    fn connect(&mut self) -> io::Result<()> {
        if self.expired {
            return error(
                "MouseMux SDK session expired; automatic or in-process reconnection is disabled",
            );
        }
        if self.socket.is_some() {
            return result("connect", false, "Already connected or connecting");
        }
        clear_view()?;
        status("connecting", "Connecting to the local MouseMux SDK")?;
        let address = SocketAddr::from((Ipv4Addr::LOCALHOST, self.port));
        let stream = match TcpStream::connect_timeout(&address, Duration::from_secs(1)) {
            Ok(stream) => stream,
            Err(_) => {
                return self
                    .fail("MouseMux SDK unavailable; start MouseMux and enable its Web SDK");
            }
        };
        stream.set_read_timeout(Some(Duration::from_secs(1)))?;
        stream.set_write_timeout(Some(Duration::from_secs(1)))?;
        stream.set_nodelay(true)?;
        let config = WebSocketConfig::default()
            .max_message_size(Some(MAX_MESSAGE))
            .max_frame_size(Some(MAX_MESSAGE))
            .write_buffer_size(0)
            .max_write_buffer_size(MAX_MESSAGE);
        let url = format!("ws://127.0.0.1:{}/", self.port);
        match client_with_config(url, stream, Some(config)) {
            Ok((socket, _)) => self.socket = Some(socket),
            Err(_) => return self.fail("MouseMux WebSocket handshake failed"),
        }
        if let Some(socket) = self.socket.as_mut() {
            socket.get_mut().set_read_timeout(Some(POLL))?;
            socket
                .get_mut()
                .set_write_timeout(Some(Duration::from_millis(250)))?;
        }
        self.login_started = Some(Instant::now());
        if !self.send(json!({
            "type":"client.login.request.A2M",
            "appName":"CoLaB MouseMux for Live","appVersion":"0.1.0",
            "appBuildDate":"2026-10-20","sdkVersion":"colab-wire-1","sdkBuildDate":"2026-10-20"
        })) {
            self.fail("Could not send MouseMux login")?;
        }
        Ok(())
    }

    fn refresh(&mut self) -> io::Result<()> {
        if !self.request("user.list.request.A2M") || !self.request("server.mode.request.A2M") {
            self.fail("MouseMux connection lost during refresh")?;
        }
        Ok(())
    }

    fn command(&mut self, input: Input) -> io::Result<bool> {
        let line = match input {
            Input::End => return Ok(false),
            Input::Invalid => {
                error("Command exceeds 4096 bytes")?;
                return Ok(true);
            }
            Input::Line(line) => line,
        };
        let Ok(command) = serde_json::from_slice::<Value>(&line) else {
            error("Invalid command JSON")?;
            return Ok(true);
        };
        match command["command"].as_str() {
            Some("stop") => return Ok(false),
            Some("disconnect") => {
                self.close();
                clear_view()?;
                status(
                    if self.expired {
                        "expired"
                    } else {
                        "disconnected"
                    },
                    "Disconnected",
                )?;
            }
            Some("connect") => self.connect()?,
            Some("refresh") if !self.logged_in => {
                error("Connect and wait for MouseMux login before controlling the SDK")?
            }
            Some("refresh") => self.refresh()?,
            Some("mode") => {
                if !self.logged_in {
                    result(
                        "mode",
                        false,
                        "Connect and wait for MouseMux login before controlling the SDK",
                    )?;
                    return Ok(true);
                }
                let Some(multi_keyboard) = self.multi_keyboard else {
                    result(
                        "mode",
                        false,
                        "Wait for the observed MouseMux mode before changing it",
                    )?;
                    return Ok(true);
                };
                let (name, mode) = match command["mode"].as_str() {
                    Some("native") => ("native", 1),
                    Some("switched") => ("switched", if multi_keyboard { 4 } else { 3 }),
                    Some("multiplex") => ("multiplex", if multi_keyboard { 6 } else { 5 }),
                    _ => {
                        result("mode", false, "Mode must be native, switched, or multiplex")?;
                        return Ok(true);
                    }
                };
                if self.pending_mode.is_some() {
                    result(
                        "mode",
                        false,
                        "A mode request is awaiting MouseMux confirmation",
                    )?;
                } else if self.send(json!({"type":"server.mode.set.request.A2M","mode":mode})) {
                    self.pending_mode = Some(PendingMode {
                        name: name.into(),
                        started: Instant::now(),
                        acknowledged: None,
                    });
                    self.multi_keyboard = None;
                    emit(json!({"event":"mode","mode":[],"confirmed":false}))?;
                } else {
                    self.fail("MouseMux connection lost during mode request")?;
                }
            }
            _ => error("Unknown command")?,
        }
        Ok(true)
    }

    fn message(&mut self, message: Value) -> io::Result<()> {
        let Some(kind) = message["type"].as_str() else {
            return error("Invalid SDK message");
        };
        match kind {
            "server.timeout.stopped.notify.M2A" => {
                self.expired = true;
                self.close();
                clear_view()?;
                status(
                    "expired",
                    "MouseMux SDK session expired; use a valid MouseMux SDK license",
                )?;
            }
            "server.shutdown.notify.M2A" => self.fail("MouseMux shut down")?,
            "server.ping.notify.M2A" => {
                if !self.request("client.pong.request.A2M") {
                    self.fail("MouseMux keepalive response failed")?;
                }
            }
            "client.login.request.A2M" => {
                if message["ok"] == false {
                    self.fail("MouseMux rejected the SDK login")?;
                } else if message["ok"] == true && !self.logged_in {
                    self.logged_in = true;
                    self.login_started = None;
                    status("connected", "MouseMux SDK connected")?;
                    self.refresh()?;
                }
            }
            _ if !self.logged_in => {}
            "server.mode.set.request.A2M" => {
                if let Some(pending) = self.pending_mode.as_mut()
                    && pending.acknowledged.is_none()
                {
                    let ok = message["ok"] == true;
                    pending.acknowledged = Some(ok);
                    let detail = if ok {
                        format!("Requested {}; waiting for observed mode", pending.name)
                    } else {
                        "MouseMux rejected the mode request".into()
                    };
                    result("mode", ok, &detail)?;
                    if !self.request("server.mode.request.A2M") {
                        self.fail("MouseMux connection lost while checking mode")?;
                    }
                }
            }
            "server.mode.notify.M2A" => {
                if let Some((modes, multi_keyboard)) = observed_modes(&message["mode"]) {
                    self.multi_keyboard = Some(multi_keyboard);
                    // A notify can precede the setter acknowledgement. Finish
                    // only on the observation requested after that ack.
                    if self
                        .pending_mode
                        .as_ref()
                        .is_some_and(|pending| pending.acknowledged.is_some())
                        && let Some(pending) = self.pending_mode.take()
                        && pending.acknowledged == Some(true)
                        && !modes.iter().any(|mode| mode == &pending.name)
                    {
                        let actual = modes
                            .iter()
                            .filter_map(Value::as_str)
                            .collect::<Vec<_>>()
                            .join(" + ");
                        result(
                            "mode",
                            false,
                            &format!(
                                "MouseMux reports {actual} instead of requested {}",
                                pending.name
                            ),
                        )?;
                    }
                    emit(json!({"event":"mode","mode":modes,"confirmed":true}))?;
                } else {
                    self.multi_keyboard = None;
                    emit(json!({"event":"mode","mode":[],"confirmed":false}))?;
                    error("Invalid MouseMux mode observation")?;
                }
            }
            "user.list.notify.M2A" => {
                if let Some(users) = roster(&message["users"]) {
                    emit(users)?;
                } else {
                    emit(json!({"event":"users","users":[],"pointer_users":0}))?;
                    error("Invalid MouseMux user roster")?;
                }
            }
            "user.create.notify.M2A" | "user.dispose.notify.M2A" | "user.changed.notify.M2A" => {
                emit(json!({"event":"users","users":[],"pointer_users":0}))?;
                if !self.request("user.list.request.A2M") {
                    self.fail("MouseMux connection lost while updating users")?;
                }
            }
            _ if message["ok"] == false => error("MouseMux rejected an SDK request")?,
            _ => {}
        }
        Ok(())
    }

    fn poll(&mut self) -> io::Result<()> {
        if self
            .login_started
            .is_some_and(|start| start.elapsed() >= LOGIN_TIMEOUT)
        {
            return self.fail("MouseMux login timed out");
        }
        if self
            .pending_mode
            .as_ref()
            .is_some_and(|pending| pending.started.elapsed() >= LOGIN_TIMEOUT)
        {
            return self
                .fail("MouseMux mode confirmation timed out; reconnect to check actual mode");
        }
        let Some(socket) = self.socket.as_mut() else {
            return Ok(());
        };
        match socket.read() {
            Ok(Message::Text(text)) => match serde_json::from_str(&text) {
                Ok(message) => self.message(message)?,
                Err(_) => error("Invalid JSON from MouseMux SDK")?,
            },
            Ok(Message::Close(_)) => self.fail("MouseMux disconnected")?,
            Ok(Message::Ping(_)) => {
                if socket.flush().is_err() {
                    self.fail("MouseMux ping response failed")?;
                }
            }
            Ok(_) => {}
            Err(tungstenite::Error::Io(ref error))
                if matches!(
                    error.kind(),
                    io::ErrorKind::WouldBlock | io::ErrorKind::TimedOut
                ) => {}
            Err(_) => self.fail("MouseMux connection closed or invalid WebSocket message")?,
        }
        Ok(())
    }
}

impl Drop for Bridge {
    fn drop(&mut self) {
        self.close();
    }
}

fn run(rx: Receiver<Input>, port: u16) -> io::Result<()> {
    let mut bridge = Bridge::new(port);
    status("disconnected", "Ready to connect")?;
    loop {
        if bridge.socket.is_none() {
            let Ok(input) = rx.recv() else {
                break;
            };
            if !bridge.command(input)? {
                break;
            }
        } else {
            // Process only a bounded batch so stdin cannot starve SDK keepalive.
            for _ in 0..8 {
                match rx.try_recv() {
                    Ok(input) => {
                        if !bridge.command(input)? {
                            return Ok(());
                        }
                    }
                    Err(TryRecvError::Empty) => break,
                    Err(TryRecvError::Disconnected) => return Ok(()),
                }
            }
            bridge.poll()?;
        }
    }
    Ok(())
}

fn main() {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let port = match args.as_slice() {
        [] => 41001,
        [flag, port] if flag == "--port" => match port.parse::<u16>() {
            Ok(port) if port != 0 => port,
            _ => {
                let _ = error("Port must be between 1 and 65535");
                std::process::exit(2);
            }
        },
        _ => {
            let _ = error("Usage: mousemux-live-bridge [--port N]");
            std::process::exit(2);
        }
    };
    let (tx, rx) = mpsc::sync_channel(32);
    thread::spawn(move || read_input(&mut io::stdin().lock(), &tx));
    if run(rx, port).is_err() {
        std::process::exit(1);
    }
}

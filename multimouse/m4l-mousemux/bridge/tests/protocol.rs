use serde_json::{Value, json};
use std::{
    io::{BufRead, BufReader, Write},
    net::{TcpListener, TcpStream},
    process::{Child, Command, Stdio},
    sync::mpsc::{self, Receiver},
    thread,
    time::{Duration, Instant},
};
use tungstenite::{
    Message, WebSocket,
    protocol::frame::{
        Frame,
        coding::{Data, OpCode},
    },
};

struct Fixture {
    child: Child,
    output: Receiver<Value>,
    listener: TcpListener,
    socket: Option<WebSocket<TcpStream>>,
}

impl Fixture {
    fn new() -> Self {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        listener.set_nonblocking(true).unwrap();
        let mut child = Command::new(env!("CARGO_BIN_EXE_mousemux-live-bridge"))
            .args(["--port", &listener.local_addr().unwrap().port().to_string()])
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::inherit())
            .spawn()
            .unwrap();
        let stdout = child.stdout.take().unwrap();
        let (tx, output) = mpsc::channel();
        thread::spawn(move || {
            for line in BufReader::new(stdout).lines() {
                let Ok(line) = line else {
                    break;
                };
                let value = serde_json::from_str(&line).expect("stdout must be JSON lines");
                if tx.send(value).is_err() {
                    break;
                }
            }
        });
        let fixture = Self {
            child,
            output,
            listener,
            socket: None,
        };
        assert_eq!(fixture.next()["state"], "disconnected");
        fixture
    }

    fn command(&mut self, command: Value) {
        writeln!(self.child.stdin.as_mut().unwrap(), "{command}").unwrap();
        self.child.stdin.as_mut().unwrap().flush().unwrap();
    }

    fn raw(&mut self, line: &str) {
        writeln!(self.child.stdin.as_mut().unwrap(), "{line}").unwrap();
        self.child.stdin.as_mut().unwrap().flush().unwrap();
    }

    fn next(&self) -> Value {
        self.output
            .recv_timeout(Duration::from_secs(3))
            .expect("bridge event")
    }

    fn until(&self, predicate: impl Fn(&Value) -> bool) -> Value {
        let deadline = Instant::now() + Duration::from_secs(3);
        loop {
            let value = self
                .output
                .recv_timeout(deadline.saturating_duration_since(Instant::now()))
                .expect("matching bridge event");
            if predicate(&value) {
                return value;
            }
        }
    }

    fn open(&mut self) {
        self.command(json!({"command":"connect"}));
        let deadline = Instant::now() + Duration::from_secs(3);
        let stream = loop {
            match self.listener.accept() {
                Ok((stream, _)) => break stream,
                Err(error) if error.kind() == std::io::ErrorKind::WouldBlock => {
                    assert!(Instant::now() < deadline, "client did not connect");
                    thread::sleep(Duration::from_millis(5));
                }
                Err(error) => panic!("accept: {error}"),
            }
        };
        stream.set_nonblocking(false).unwrap();
        stream
            .set_read_timeout(Some(Duration::from_secs(2)))
            .unwrap();
        self.socket = Some(tungstenite::accept(stream).unwrap());
        let login = self.request();
        assert_eq!(login["type"], "client.login.request.A2M");
        assert_eq!(login["appName"], "CoLaB MouseMux for Live");
        assert_eq!(login["sdkVersion"], "colab-wire-1");
        self.until(|event| event["state"] == "connecting");
    }

    fn login(&mut self) {
        self.open();
        self.send(json!({"type":"client.login.request.A2M","ok":true}));
        self.until(|event| event["state"] == "connected");
        assert_eq!(self.request()["type"], "user.list.request.A2M");
        assert_eq!(self.request()["type"], "server.mode.request.A2M");
        self.send(json!({"type":"server.mode.notify.M2A","mode":["native"]}));
        assert_eq!(self.next()["mode"], json!(["native"]));
    }

    fn request(&mut self) -> Value {
        loop {
            match self.socket.as_mut().unwrap().read().unwrap() {
                Message::Text(text) => return serde_json::from_str(&text).unwrap(),
                Message::Ping(_) => self.socket.as_mut().unwrap().flush().unwrap(),
                other => panic!("unexpected message {other:?}"),
            }
        }
    }

    fn send(&mut self, value: Value) {
        self.socket
            .as_mut()
            .unwrap()
            .send(Message::Text(value.to_string().into()))
            .unwrap();
    }

    fn exit(&mut self) {
        self.child.stdin.take();
        let deadline = Instant::now() + Duration::from_secs(2);
        loop {
            if let Some(status) = self.child.try_wait().unwrap() {
                assert!(status.success());
                break;
            }
            assert!(
                Instant::now() < deadline,
                "bridge did not exit on stdin EOF"
            );
            thread::sleep(Duration::from_millis(5));
        }
    }
}

impl Drop for Fixture {
    fn drop(&mut self) {
        self.child.stdin.take();
        let _ = self.child.kill();
        let _ = self.child.wait();
    }
}

fn roster() -> Value {
    json!({"type":"user.list.notify.M2A","users":[
        {"id":7,"name":"Blue","flags":["active"],"color":{"r":30,"g":70,"b":255},
            "devices":[{"hwid":1380887,"type":"pointer","subtype":"mouse","path":"SECRET-PATH"},
                {"hwid":11,"type":"keyboard"}]},
        {"id":9,"name":"Orange","devices":[{"hwid":20,"type":"pointer"}]},
        {"id":10,"name":"Pen","devices":[{"hwid":30,"type":"pointer","subtype":"pen"}]},
        {"id":1,"name":"Capture Mouse","devices":[{"hwid":8192,"type":"pointer","subtype":"mouse","path":"\\\\Capture\\Mouse"}]},
        {"id":2,"name":"Touchpad Mouse","devices":[{"hwid":36864,"type":"pointer","subtype":"mouse","path":"\\\\Touchpad\\Mouse"}]}
    ]})
}

#[test]
fn login_roster_refresh_keepalive_modes_and_disconnect() {
    let mut fixture = Fixture::new();
    fixture.login();
    fixture.send(json!({"type":"server.info.notify.M2A","systemId":"SECRET-FINGERPRINT"}));
    fixture.send(roster());
    let users = fixture.until(|event| event["event"] == "users");
    assert_eq!(users["pointer_users"], 2);
    assert_eq!(users["users"][0]["id"], 7);
    assert_eq!(users["users"][0]["pointers"], 1);
    assert_eq!(users["users"][0]["active"], true);
    assert_eq!(users["users"][1]["id"], 9);
    assert!(!users.to_string().contains("SECRET"));
    assert!(!users.to_string().contains("hwid"));
    fixture.send(json!({"type":"server.ping.notify.M2A"}));
    assert_eq!(fixture.request()["type"], "client.pong.request.A2M");
    fixture
        .socket
        .as_mut()
        .unwrap()
        .send(Message::Ping(vec![1, 2, 3].into()))
        .unwrap();
    assert_eq!(
        fixture.socket.as_mut().unwrap().read().unwrap(),
        Message::Pong(vec![1, 2, 3].into())
    );
    for (mode, value) in [("native", 1), ("switched", 3), ("multiplex", 5)] {
        fixture.command(json!({"command":"mode","mode":mode}));
        assert_eq!(
            fixture.request(),
            json!({"type":"server.mode.set.request.A2M","mode":value})
        );
        fixture.send(json!({"type":"server.mode.set.request.A2M","ok":true}));
        let ack = fixture.until(|event| event["event"] == "result");
        assert_eq!(ack["ok"], true);
        assert_eq!(fixture.request()["type"], "server.mode.request.A2M");
        // A successful setter acknowledgement must not invent confirmed mode.
        assert!(
            fixture
                .output
                .recv_timeout(Duration::from_millis(80))
                .is_err()
        );
        fixture.send(json!({"type":"server.mode.notify.M2A","mode":[mode]}));
        let observed = fixture.next();
        assert_eq!(observed["mode"], json!([mode]));
        assert_eq!(observed["confirmed"], true);
    }
    fixture.command(json!({"command":"refresh"}));
    assert_eq!(fixture.request()["type"], "user.list.request.A2M");
    assert_eq!(fixture.request()["type"], "server.mode.request.A2M");
    fixture.command(json!({"command":"disconnect"}));
    assert_eq!(fixture.request()["type"], "client.logout.request.A2M");
    assert_eq!(fixture.next()["pointer_users"], 0);
    assert_eq!(fixture.next()["confirmed"], false);
    assert_eq!(fixture.next()["state"], "disconnected");
    fixture.exit();
}

#[test]
fn only_acknowledged_login_permits_controls_and_refusal_clears_state() {
    let mut fixture = Fixture::new();
    fixture.open();
    fixture.send(roster());
    fixture.send(json!({"type":"server.mode.notify.M2A","mode":["multiplex"]}));
    fixture.command(json!({"command":"mode","mode":"multiplex"}));
    assert_eq!(fixture.next()["ok"], false);
    fixture.send(json!({"type":"client.login.request.A2M","ok":false,"error":"SECRET-PATH"}));
    assert_eq!(fixture.next()["pointer_users"], 0);
    assert_eq!(fixture.next()["confirmed"], false);
    let error = fixture.next();
    assert_eq!(error["state"], "error");
    assert!(!error.to_string().contains("SECRET"));
    assert!(
        fixture
            .output
            .recv_timeout(Duration::from_millis(80))
            .is_err()
    );
    fixture.exit();
}

#[test]
fn expiry_is_terminal_even_after_explicit_connect_and_disconnect() {
    let mut fixture = Fixture::new();
    fixture.login();
    fixture.send(json!({"type":"server.timeout.stopped.notify.M2A","reason":"Session expired"}));
    assert_eq!(fixture.next()["pointer_users"], 0);
    assert_eq!(fixture.next()["confirmed"], false);
    assert_eq!(fixture.next()["state"], "expired");
    fixture.command(json!({"command":"disconnect"}));
    fixture.until(|event| event["state"] == "expired");
    fixture.command(json!({"command":"connect"}));
    assert_eq!(fixture.next()["event"], "error");
    assert_eq!(
        fixture.listener.accept().unwrap_err().kind(),
        std::io::ErrorKind::WouldBlock
    );
    fixture.exit();
}

#[test]
fn malformed_json_oversized_commands_and_invalid_modes_are_safe() {
    let mut fixture = Fixture::new();
    fixture.raw("{");
    assert_eq!(fixture.next()["event"], "error");
    fixture.raw(&"x".repeat(8192));
    assert_eq!(fixture.next()["event"], "error");
    fixture.raw("[]");
    assert_eq!(fixture.next()["event"], "error");
    fixture.login();
    fixture.command(json!({"command":"mode","mode":"invalid"}));
    assert_eq!(fixture.next()["ok"], false);
    fixture
        .socket
        .as_mut()
        .unwrap()
        .send(Message::Text("{".into()))
        .unwrap();
    assert_eq!(fixture.next()["event"], "error");
    fixture.command(json!({"command":"refresh"}));
    assert_eq!(fixture.request()["type"], "user.list.request.A2M");
    assert_eq!(fixture.request()["type"], "server.mode.request.A2M");
    fixture.exit();
    assert_eq!(fixture.request()["type"], "client.logout.request.A2M");
}

#[test]
fn lifecycle_and_corrupt_roster_clear_stale_users() {
    let mut fixture = Fixture::new();
    fixture.login();
    fixture.send(roster());
    assert_eq!(fixture.next()["pointer_users"], 2);
    fixture.send(json!({"type":"user.dispose.notify.M2A","userId":7}));
    assert_eq!(fixture.next()["pointer_users"], 0);
    assert_eq!(fixture.request()["type"], "user.list.request.A2M");
    fixture.send(json!({"type":"user.list.notify.M2A","users":[{"id":7,"devices":[]},{"id":7,"devices":[]}]}));
    assert_eq!(fixture.next()["pointer_users"], 0);
    assert_eq!(fixture.next()["event"], "error");
    fixture.send(json!({"type":"server.mode.notify.M2A","mode":["multiplex"]}));
    assert_eq!(fixture.next()["confirmed"], true);
    fixture.socket.as_mut().unwrap().close(None).unwrap();
    assert_eq!(fixture.next()["pointer_users"], 0);
    assert_eq!(fixture.next()["confirmed"], false);
    assert_eq!(fixture.next()["state"], "error");
    fixture.exit();
}

#[test]
fn fragmented_text_is_reassembled_without_blocking_eof() {
    let mut fixture = Fixture::new();
    fixture.login();
    let first = Frame::message(
        b"{\"type\":\"server.mode.".to_vec(),
        OpCode::Data(Data::Text),
        false,
    );
    fixture
        .socket
        .as_mut()
        .unwrap()
        .send(Message::Frame(first))
        .unwrap();
    thread::sleep(Duration::from_millis(70));
    let last = Frame::message(
        b"notify.M2A\",\"mode\":[\"native\"]}".to_vec(),
        OpCode::Data(Data::Continue),
        true,
    );
    fixture
        .socket
        .as_mut()
        .unwrap()
        .send(Message::Frame(last))
        .unwrap();
    assert_eq!(fixture.next()["mode"], json!(["native"]));
    let incomplete = Frame::message(b"{\"type\":".to_vec(), OpCode::Data(Data::Text), false);
    fixture
        .socket
        .as_mut()
        .unwrap()
        .send(Message::Frame(incomplete))
        .unwrap();
    fixture.exit();
}

#[test]
fn denied_mode_stays_unconfirmed_and_stop_logs_out() {
    let mut fixture = Fixture::new();
    fixture.login();
    fixture.command(json!({"command":"mode","mode":"multiplex"}));
    fixture.request();
    fixture.send(json!({"type":"server.mode.set.request.A2M","ok":false,"error":"not allowed"}));
    let result = fixture.until(|event| event["event"] == "result");
    assert_eq!(result["event"], "result");
    assert_eq!(result["ok"], false);
    assert_eq!(fixture.request()["type"], "server.mode.request.A2M");
    fixture.command(json!({"command":"stop"}));
    fixture.exit();
    assert_eq!(fixture.request()["type"], "client.logout.request.A2M");
}

#[test]
fn modes_require_observed_state_and_preserve_multi_keyboard() {
    let mut fixture = Fixture::new();
    fixture.open();
    fixture.send(json!({"type":"client.login.request.A2M","ok":true}));
    fixture.until(|event| event["state"] == "connected");
    fixture.request();
    fixture.request();
    fixture.command(json!({"command":"mode","mode":"multiplex"}));
    assert_eq!(fixture.next()["ok"], false);
    fixture.send(json!({"type":"server.mode.notify.M2A","mode":["multiplex","multi-keyboard"]}));
    assert_eq!(fixture.next()["confirmed"], true);
    for (mode, number) in [("switched", 4), ("multiplex", 6)] {
        fixture.command(json!({"command":"mode","mode":mode}));
        assert_eq!(fixture.request()["mode"], number);
        fixture.send(json!({"type":"server.mode.set.request.A2M","ok":true}));
        fixture.until(|event| event["event"] == "result");
        fixture.request();
        fixture.send(json!({"type":"server.mode.notify.M2A","mode":[mode,"multi-keyboard"]}));
        assert_eq!(fixture.next()["confirmed"], true);
    }
    fixture.command(json!({"command":"mode","mode":"native"}));
    assert_eq!(fixture.request()["mode"], 1);
    fixture.exit();
}

#[test]
fn invalid_mode_observations_clear_state_and_merged_remains_controllable() {
    let mut fixture = Fixture::new();
    fixture.login();
    for mode in [
        json!([]),
        json!(["multi-keyboard"]),
        json!(["native", "multiplex"]),
        json!(["switched", "switched"]),
        json!(["switched", "multi-keyboard", "multi-keyboard"]),
        json!(["native", "multi-keyboard"]),
        json!(["merged", "multi-keyboard"]),
        json!(["unknown"]),
        json!("native"),
    ] {
        fixture.send(json!({"type":"server.mode.notify.M2A","mode":mode}));
        assert_eq!(fixture.next()["confirmed"], false);
        assert_eq!(fixture.next()["event"], "error");
        fixture.command(json!({"command":"mode","mode":"multiplex"}));
        assert_eq!(fixture.next()["ok"], false);
        fixture
            .send(json!({"type":"server.mode.notify.M2A","mode":["multiplex","multi-keyboard"]}));
        assert_eq!(fixture.next()["confirmed"], true);
    }
    fixture.send(json!({"type":"server.mode.notify.M2A","mode":["merged"]}));
    assert_eq!(fixture.next()["mode"], json!(["merged"]));
    fixture.command(json!({"command":"mode","mode":"multiplex"}));
    assert_eq!(fixture.request()["mode"], 5);
    fixture.exit();
}

#[test]
fn mode_notification_before_ack_does_not_finish_the_pending_request() {
    let mut fixture = Fixture::new();
    fixture.login();
    fixture.command(json!({"command":"mode","mode":"multiplex"}));
    assert_eq!(fixture.request()["mode"], 5);
    assert_eq!(fixture.next()["confirmed"], false);
    fixture.send(json!({"type":"server.mode.notify.M2A","mode":["multiplex"]}));
    assert_eq!(fixture.next()["confirmed"], true);
    fixture.command(json!({"command":"mode","mode":"switched"}));
    assert_eq!(fixture.next()["ok"], false);
    fixture.send(json!({"type":"server.mode.set.request.A2M","ok":true}));
    assert_eq!(fixture.next()["ok"], true);
    assert_eq!(fixture.request()["type"], "server.mode.request.A2M");
    fixture.command(json!({"command":"mode","mode":"switched"}));
    assert_eq!(fixture.next()["ok"], false);
    fixture.send(json!({"type":"server.mode.notify.M2A","mode":["multiplex"]}));
    assert_eq!(fixture.next()["confirmed"], true);
    fixture.command(json!({"command":"mode","mode":"switched"}));
    assert_eq!(fixture.request()["mode"], 3);
    fixture.exit();
}

#[test]
fn acknowledgement_without_observed_mode_times_out_and_clears_state() {
    let mut fixture = Fixture::new();
    fixture.login();
    fixture.command(json!({"command":"mode","mode":"multiplex"}));
    fixture.request();
    fixture.send(json!({"type":"server.mode.set.request.A2M","ok":true}));
    assert_eq!(
        fixture.until(|event| event["event"] == "result")["ok"],
        true
    );
    assert_eq!(fixture.request()["type"], "server.mode.request.A2M");
    let cleared = fixture.output.recv_timeout(Duration::from_secs(7)).unwrap();
    assert_eq!(cleared["pointer_users"], 0);
    assert_eq!(fixture.next()["confirmed"], false);
    let status = fixture.next();
    assert_eq!(status["state"], "error");
    assert!(
        status["detail"]
            .as_str()
            .unwrap()
            .contains("confirmation timed out")
    );
    assert_eq!(fixture.request()["type"], "client.logout.request.A2M");
    fixture.exit();
}

#[test]
fn acknowledgement_with_different_observed_mode_reports_failure() {
    let mut fixture = Fixture::new();
    fixture.login();
    fixture.command(json!({"command":"mode","mode":"multiplex"}));
    fixture.request();
    fixture.send(json!({"type":"server.mode.set.request.A2M","ok":true}));
    assert_eq!(
        fixture.until(|event| event["event"] == "result")["ok"],
        true
    );
    fixture.request();
    fixture.send(json!({"type":"server.mode.notify.M2A","mode":["native"]}));
    let result = fixture.next();
    assert_eq!(result["event"], "result");
    assert_eq!(result["ok"], false);
    assert!(
        result["detail"]
            .as_str()
            .unwrap()
            .contains("instead of requested multiplex")
    );
    assert_eq!(fixture.next()["mode"], json!(["native"]));
    fixture.command(json!({"command":"mode","mode":"switched"}));
    assert_eq!(fixture.request()["mode"], 3);
    fixture.exit();
}

#[test]
fn local_mode_rejections_finish_the_host_request_without_changing_the_engine() {
    let mut fixture = Fixture::new();
    let rejected = |fixture: &Fixture| {
        let result = fixture.next();
        assert_eq!(result["event"], "result");
        assert_eq!(result["command"], "mode");
        assert_eq!(result["ok"], false);
    };
    fixture.command(json!({"command":"mode","mode":"multiplex"}));
    rejected(&fixture);
    fixture.login();
    fixture.command(json!({"command":"mode","mode":"invalid"}));
    rejected(&fixture);
    // The host may click using its last valid state before this invalidation
    // reaches its UI. A generic error would leave that host request pending.
    fixture.send(json!({"type":"server.mode.notify.M2A","mode":[]}));
    assert_eq!(fixture.next()["confirmed"], false);
    assert_eq!(fixture.next()["event"], "error");
    fixture.command(json!({"command":"mode","mode":"multiplex"}));
    rejected(&fixture);
    fixture.send(json!({"type":"server.ping.notify.M2A"}));
    assert_eq!(fixture.request()["type"], "client.pong.request.A2M");
    fixture.send(json!({"type":"server.mode.notify.M2A","mode":["native"]}));
    assert_eq!(fixture.next()["confirmed"], true);
    fixture.command(json!({"command":"mode","mode":"switched"}));
    assert_eq!(fixture.request()["mode"], 3);
    assert_eq!(fixture.next()["confirmed"], false);
    fixture.send(json!({"type":"server.mode.notify.M2A","mode":["switched"]}));
    assert_eq!(fixture.next()["confirmed"], true);
    fixture.command(json!({"command":"mode","mode":"multiplex"}));
    rejected(&fixture);
    fixture.send(json!({"type":"server.ping.notify.M2A"}));
    assert_eq!(fixture.request()["type"], "client.pong.request.A2M");
    fixture.exit();
}

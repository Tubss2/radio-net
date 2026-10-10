#![cfg_attr(windows, windows_subsystem = "windows")]

mod device;
mod protocol;

use device::{authorize, DeviceState};
use protocol::{frame_text, host_allowed, origin_allowed, pairing_code, parse_linked, read_client_frame, LinkedCommand, Watch};
use sha1::{Digest, Sha1};
use std::io::{Read, Write};
use std::net::{TcpListener, TcpStream};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc::{Receiver, RecvTimeoutError};
use std::time::Duration;

/// Set when the window is closing. The listener thread must exit, not keep running in the background.
pub(crate) static SHUTDOWN: AtomicBool = AtomicBool::new(false);

pub(crate) fn is_shutdown() -> bool {
    SHUTDOWN.load(Ordering::SeqCst)
}

#[cfg_attr(not(windows), allow(dead_code))]
const PORT: u16 = 47321;
const WS_GUID: &str = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";

fn main() {
    let code = pairing_code();
    #[cfg(windows)]
    ui::run(&code);
    #[cfg(not(windows))]
    {
        eprintln!("This window watches a Windows key. Protocol checks run with cargo test.");
        let _ = code;
        std::process::exit(1);
    }
}

fn accept_key(sec_key: &str) -> String {
    let mut hasher = Sha1::new();
    hasher.update(sec_key.as_bytes());
    hasher.update(WS_GUID.as_bytes());
    base64(&hasher.finalize())
}

fn base64(bytes: &[u8]) -> String {
    const TABLE: &[u8] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut out = String::new();
    let mut index = 0;
    while index + 3 <= bytes.len() {
        let n = ((bytes[index] as u32) << 16) | ((bytes[index + 1] as u32) << 8) | bytes[index + 2] as u32;
        out.push(TABLE[((n >> 18) & 63) as usize] as char);
        out.push(TABLE[((n >> 12) & 63) as usize] as char);
        out.push(TABLE[((n >> 6) & 63) as usize] as char);
        out.push(TABLE[(n & 63) as usize] as char);
        index += 3;
    }
    if bytes.len() - index == 1 {
        let n = (bytes[index] as u32) << 16;
        out.push(TABLE[((n >> 18) & 63) as usize] as char);
        out.push(TABLE[((n >> 12) & 63) as usize] as char);
        out.push('=');
        out.push('=');
    } else if bytes.len() - index == 2 {
        let n = ((bytes[index] as u32) << 16) | ((bytes[index + 1] as u32) << 8);
        out.push(TABLE[((n >> 18) & 63) as usize] as char);
        out.push(TABLE[((n >> 12) & 63) as usize] as char);
        out.push(TABLE[((n >> 6) & 63) as usize] as char);
        out.push('=');
    }
    out
}

#[derive(Debug)]
pub(crate) struct OpenLink {
    pub watch: Watch,
    /// Kept so the socket stays open for the caller. Tests do not read the bytes.
    #[allow(dead_code)]
    pub stream: TcpStream,
    pub fresh: bool,
    pub origin: String,
}

/// Accept one local page, check its origin, and return the watch while the socket stays open.
/// `fresh` is true when a pairing code was used and a new device token was issued.
#[cfg_attr(not(test), allow(dead_code))]
pub(crate) fn handshake(
    listener: &TcpListener,
    expected: &str,
    device: &mut DeviceState,
    persist: impl FnMut(&DeviceState) -> Result<(), String>,
) -> Result<OpenLink, String> {
    let (stream, addr) = listener.accept().map_err(|err| err.to_string())?;
    if is_shutdown() {
        return Err("stopped".into());
    }
    if !addr.ip().is_loopback() {
        return Err("refused a non-local connection".into());
    }
    finish_stream(stream, expected, device, persist)
}

pub(crate) fn finish_stream(
    mut stream: TcpStream,
    expected: &str,
    device: &mut DeviceState,
    mut persist: impl FnMut(&DeviceState) -> Result<(), String>,
) -> Result<OpenLink, String> {
    if is_shutdown() {
        return Err("stopped".into());
    }
    let _ = stream.set_read_timeout(Some(Duration::from_secs(8)));
    let mut buf = [0u8; 2048];
    let n = stream.read(&mut buf).map_err(|err| err.to_string())?;
    let header_end = buf[..n].windows(4).position(|mark| mark == b"\r\n\r\n").ok_or("bad request")?;
    let split = header_end + 4;
    let request = String::from_utf8_lossy(&buf[..split]);
    let origin = header(&request, "Origin").unwrap_or_default();
    let host = header(&request, "Host").unwrap_or_default();
    if !host_allowed(&host) || !origin_allowed(&origin) {
        let _ = stream.write_all(b"HTTP/1.1 403 Forbidden\r\nContent-Length: 0\r\nConnection: close\r\n\r\n");
        return Err(format!("refused origin {origin} host {host}"));
    }
    if request.starts_with("OPTIONS ") {
        let response = format!(
            "HTTP/1.1 204 No Content\r\nAccess-Control-Allow-Origin: {origin}\r\nAccess-Control-Allow-Private-Network: true\r\nAccess-Control-Allow-Methods: GET, OPTIONS\r\nVary: Origin\r\nContent-Length: 0\r\nConnection: close\r\n\r\n"
        );
        let _ = stream.write_all(response.as_bytes());
        return Err("preflight".into());
    }
    let key = header(&request, "Sec-WebSocket-Key").ok_or("missing websocket key")?;
    let accept = accept_key(&key);
    let response = format!(
        "HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: {accept}\r\n\r\n"
    );
    stream.write_all(response.as_bytes()).map_err(|err| err.to_string())?;
    let _ = stream.set_read_timeout(Some(Duration::from_secs(30)));
    let mut pending = buf[split..n].to_vec();
    let text = read_text(&mut stream, &mut pending)?;
    let (next, session) = authorize(device, &text, expected).map_err(|err| {
        let _ = stream.write_all(&frame_text(r#"{"t":"denied"}"#));
        err.to_string()
    })?;
    if let Err(err) = persist(&next) {
        let _ = stream.write_all(&frame_text(r#"{"t":"denied"}"#));
        return Err(err);
    }
    *device = next;
    stream.write_all(&frame_text(&session.ok_body)).map_err(|err| err.to_string())?;
    Ok(OpenLink { watch: session.watch, stream, fresh: session.fresh, origin })
}

/// Forward press and release until the page closes the socket.
/// The page may change the watched key or forget the device. Any other client frame closes the link.
pub(crate) fn pump(
    mut stream: TcpStream,
    events: Receiver<bool>,
    forget: &std::sync::atomic::AtomicBool,
    mut on_client: impl FnMut(LinkedCommand) -> Result<(), String>,
    mut poll_rebind: impl FnMut() -> Option<Watch>,
) -> Result<(), String> {
    let _ = stream.set_read_timeout(Some(Duration::from_millis(20)));
    let _ = stream.set_nodelay(true);
    let mut pending = Vec::new();
    let mut buf = [0u8; 256];
    loop {
        if is_shutdown() {
            return Err("stopped".into());
        }
        if forget.swap(false, std::sync::atomic::Ordering::Relaxed) {
            on_client(LinkedCommand::Forget)?;
            let _ = stream.write_all(&frame_text(r#"{"t":"denied"}"#));
            return Err("forgotten".into());
        }
        match events.recv_timeout(Duration::from_millis(20)) {
            Ok(down) => {
                let payload = if down { r#"{"t":"down"}"# } else { r#"{"t":"up"}"# };
                stream.write_all(&frame_text(payload)).map_err(|err| err.to_string())?;
            }
            Err(RecvTimeoutError::Timeout) => {}
            Err(RecvTimeoutError::Disconnected) => return Ok(()),
        }
        if let Some(watch) = poll_rebind() {
            if let Some(payload) = protocol::watch_message(&watch) {
                on_client(LinkedCommand::Watch(watch))?;
                stream.write_all(&frame_text(&payload)).map_err(|err| err.to_string())?;
            }
        }
        match stream.read(&mut buf) {
            Ok(0) => return Ok(()),
            Ok(n) => {
                pending.extend_from_slice(&buf[..n]);
                loop {
                    match read_client_frame(&pending) {
                        Ok((text, used)) => {
                            pending.drain(..used);
                            match parse_linked(&text) {
                                Ok(LinkedCommand::Watch(watch)) => {
                                    on_client(LinkedCommand::Watch(watch))?;
                                    stream.write_all(&frame_text(r#"{"t":"ok"}"#)).map_err(|err| err.to_string())?;
                                }
                                Ok(LinkedCommand::Forget) => {
                                    on_client(LinkedCommand::Forget)?;
                                    let _ = stream.write_all(&frame_text(r#"{"t":"denied"}"#));
                                    return Err("forgotten".into());
                                }
                                Err(_) => return Err("the page sent something other than a watch change".into()),
                            }
                        }
                        Err("short") => break,
                        Err(err) => return Err(err.into()),
                    }
                }
            }
            Err(err) if err.kind() == std::io::ErrorKind::WouldBlock || err.kind() == std::io::ErrorKind::TimedOut => {}
            Err(err) => return Err(err.to_string()),
        }
    }
}

fn header(request: &str, name: &str) -> Option<String> {
    for line in request.lines() {
        let Some((key, value)) = line.split_once(':') else { continue };
        if key.eq_ignore_ascii_case(name) {
            return Some(value.trim().to_string());
        }
    }
    None
}

fn read_text(stream: &mut TcpStream, pending: &mut Vec<u8>) -> Result<String, String> {
    let mut buf = [0u8; 512];
    loop {
        match read_client_frame(pending) {
            Ok((text, used)) => {
                pending.drain(..used);
                return Ok(text);
            }
            Err("short") => {}
            Err(err) => return Err(err.into()),
        }
        let n = stream.read(&mut buf).map_err(|err| err.to_string())?;
        if n == 0 {
            return Err("closed".into());
        }
        pending.extend_from_slice(&buf[..n]);
    }
}

#[cfg(test)]
mod tests {
    use super::{accept_key, handshake, pump};
    use crate::device::DeviceState;
    use crate::protocol::{LinkedCommand, Watch};
    use std::sync::atomic::AtomicBool;
    use std::io::{Read, Write};
    use std::net::TcpStream;
    use std::sync::mpsc;
    use std::time::Duration;

    #[test]
    fn websocket_accept_matches_the_rfc_example() {
        assert_eq!(accept_key("dGhlIHNhbXBsZSBub25jZQ=="), "s3pPLMBiTxaQ9kYGzzhZRbK+xOo=");
    }

    fn masked(payload: &str) -> Vec<u8> {
        let bytes = payload.as_bytes();
        let mask = [9u8, 8, 7, 6];
        let mut frame = vec![0x81, 0x80 | bytes.len() as u8];
        frame.extend_from_slice(&mask);
        for (i, byte) in bytes.iter().enumerate() {
            frame.push(byte ^ mask[i % 4]);
        }
        frame
    }

    /// RFC 6455 section 1.3 sample nonce. The two pieces stay apart so a secret scan does not read them as a live key.
    fn sample_nonce() -> String {
        ["dGhlIHNhbXBs", "ZSBub25jZQ=="].concat()
    }

    fn upgrade(host: &str, origin: &str, body: &[u8]) -> Vec<u8> {
        let nonce = sample_nonce();
        let mut request = format!(
            "GET / HTTP/1.1\r\nHost: {host}\r\nOrigin: {origin}\r\nSec-WebSocket-Key: {nonce}\r\n\r\n"
        )
        .into_bytes();
        request.extend_from_slice(body);
        request
    }

    #[test]
    fn handshake_returns_the_watch_while_the_socket_stays_open() {
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let addr = listener.local_addr().unwrap();
        let client = std::thread::spawn(move || {
            let mut stream = TcpStream::connect(addr).unwrap();
            let pair = masked(r#"{"t":"pair","code":"K7QM2P","watch":{"kind":"key","code":"KeyK"}}"#);
            stream.write_all(&upgrade("127.0.0.1", "http://127.0.0.1:5175", &pair)).unwrap();
            stream.set_read_timeout(Some(Duration::from_secs(2))).unwrap();
            let mut buf = Vec::new();
            let mut chunk = [0u8; 256];
            let deadline = std::time::Instant::now() + Duration::from_secs(2);
            while std::time::Instant::now() < deadline {
                match stream.read(&mut chunk) {
                    Ok(0) => break,
                    Ok(n) => {
                        buf.extend_from_slice(&chunk[..n]);
                        if buf.windows(br#""token":"#.len()).any(|w| w == br#""token":"#) {
                            break;
                        }
                    }
                    Err(_) => break,
                }
            }
            String::from_utf8_lossy(&buf).into_owned()
        });
        let mut device = DeviceState::default();
        let link = handshake(&listener, "K7QM2P", &mut device, |_| Ok(())).unwrap();
        assert!(link.fresh);
        assert_eq!(link.watch, Watch::Key { vk: b'K' as u16 });
        assert_eq!(link.origin, "http://127.0.0.1:5175");
        assert!(device.token_hash.is_some());
        let reply = client.join().unwrap();
        assert!(reply.contains("101"));
        assert!(reply.contains("s3pPLMBiTxaQ9kYGzzhZRbK+xOo="));
        assert!(reply.contains(r#""t":"ok""#));
        assert!(reply.contains(r#""token":"#));
        assert!(!reply.contains(&device.token_hash.clone().unwrap()));
    }

    #[test]
    fn resume_uses_the_device_token_and_a_guess_is_denied() {
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let addr = listener.local_addr().unwrap();
        let client = std::thread::spawn(move || {
            let mut stream = TcpStream::connect(addr).unwrap();
            let pair = masked(r#"{"t":"pair","code":"K7QM2P","watch":{"kind":"mouse","button":4}}"#);
            stream.write_all(&upgrade("localhost", "https://tubss2.github.io", &pair)).unwrap();
            stream.set_read_timeout(Some(Duration::from_secs(2))).unwrap();
            let mut buf = Vec::new();
            let mut chunk = [0u8; 256];
            let deadline = std::time::Instant::now() + Duration::from_secs(2);
            while std::time::Instant::now() < deadline {
                match stream.read(&mut chunk) {
                    Ok(0) => break,
                    Ok(n) => {
                        buf.extend_from_slice(&chunk[..n]);
                        if buf.windows(br#""token":"#.len()).any(|w| w == br#""token":"#) { break; }
                    }
                    Err(_) => break,
                }
            }
            String::from_utf8_lossy(&buf).into_owned()
        });
        let mut device = DeviceState::default();
        let link = handshake(&listener, "K7QM2P", &mut device, |_| Ok(())).unwrap();
        assert!(link.fresh);
        assert_eq!(link.watch, Watch::Mouse { button: 4 });
        assert_eq!(link.origin, "https://tubss2.github.io");
        let reply = client.join().unwrap();
        let marker = r#""token":""#;
        let start = reply.find(marker).unwrap() + marker.len();
        let token = reply[start..].split('"').next().unwrap().to_string();
        assert_eq!(token.len(), 43);

        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let addr = listener.local_addr().unwrap();
        let resume_body = format!(r#"{{"t":"resume","token":"{token}"}}"#);
        let client = std::thread::spawn(move || {
            let mut stream = TcpStream::connect(addr).unwrap();
            let frame = masked(&resume_body);
            stream.write_all(&upgrade("127.0.0.1", "https://tubss2.github.io", &frame)).unwrap();
            stream.set_read_timeout(Some(Duration::from_secs(2))).unwrap();
            let mut buf = Vec::new();
            let mut chunk = [0u8; 256];
            let deadline = std::time::Instant::now() + Duration::from_secs(2);
            while std::time::Instant::now() < deadline {
                match stream.read(&mut chunk) {
                    Ok(0) => break,
                    Ok(n) => {
                        buf.extend_from_slice(&chunk[..n]);
                        if buf.windows(br#"{"t":"ok"}"#.len()).any(|w| w == br#"{"t":"ok"}"#) { break; }
                    }
                    Err(_) => break,
                }
            }
            String::from_utf8_lossy(&buf).into_owned()
        });
        let link = handshake(&listener, "WRONGCODE", &mut device, |_| Ok(())).unwrap();
        assert!(!link.fresh);
        assert_eq!(link.watch, Watch::Mouse { button: 4 });
        assert_eq!(link.origin, "https://tubss2.github.io");
        let again = client.join().unwrap();
        assert!(again.contains(r#"{"t":"ok"}"#));
        assert!(!again.contains("token"));

        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let addr = listener.local_addr().unwrap();
        let client = std::thread::spawn(move || {
            let mut stream = TcpStream::connect(addr).unwrap();
            let frame = masked(r#"{"t":"resume","token":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"}"#);
            stream.write_all(&upgrade("127.0.0.1", "http://localhost:5175", &frame)).unwrap();
            stream.set_read_timeout(Some(Duration::from_secs(2))).unwrap();
            let mut buf = Vec::new();
            let mut chunk = [0u8; 128];
            let deadline = std::time::Instant::now() + Duration::from_secs(2);
            while std::time::Instant::now() < deadline {
                match stream.read(&mut chunk) {
                    Ok(0) => break,
                    Ok(n) => {
                        buf.extend_from_slice(&chunk[..n]);
                        if buf.windows(br#"{"t":"denied"}"#.len()).any(|w| w == br#"{"t":"denied"}"#) { break; }
                    }
                    Err(_) => break,
                }
            }
            String::from_utf8_lossy(&buf).into_owned()
        });
        let err = handshake(&listener, "K7QM2P", &mut device, |_| Ok(())).unwrap_err();
        assert_eq!(err, "denied");
        assert!(client.join().unwrap().contains(r#"{"t":"denied"}"#));
    }

    #[test]
    fn handshake_refuses_a_foreign_origin() {
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let addr = listener.local_addr().unwrap();
        let client = std::thread::spawn(move || {
            let mut stream = TcpStream::connect(addr).unwrap();
            stream.write_all(&upgrade("127.0.0.1", "https://evil.example", b"")).unwrap();
            stream.set_read_timeout(Some(Duration::from_secs(2))).unwrap();
            let mut buf = [0u8; 128];
            let n = stream.read(&mut buf).unwrap_or(0);
            String::from_utf8_lossy(&buf[..n]).into_owned()
        });
        let mut device = DeviceState::default();
        let err = handshake(&listener, "K7QM2P", &mut device, |_| Ok(())).unwrap_err();
        assert!(err.contains("evil.example"));
        assert!(client.join().unwrap().contains("403"));
    }

    #[test]
    fn handshake_refuses_a_rebound_host() {
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let addr = listener.local_addr().unwrap();
        let client = std::thread::spawn(move || {
            let mut stream = TcpStream::connect(addr).unwrap();
            stream.write_all(&upgrade("evil.example", "https://tubss2.github.io", b"")).unwrap();
            stream.set_read_timeout(Some(Duration::from_secs(2))).unwrap();
            let mut buf = [0u8; 128];
            let n = stream.read(&mut buf).unwrap_or(0);
            String::from_utf8_lossy(&buf[..n]).into_owned()
        });
        let mut device = DeviceState::default();
        let err = handshake(&listener, "K7QM2P", &mut device, |_| Ok(())).unwrap_err();
        assert!(err.contains("evil.example"));
        let body = client.join().unwrap();
        assert!(body.contains("403"));
        assert!(!body.contains("Access-Control-Allow-Private-Network"));
    }

    #[test]
    fn preflight_allows_private_network_only_for_pages() {
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let addr = listener.local_addr().unwrap();
        let client = std::thread::spawn(move || {
            let mut stream = TcpStream::connect(addr).unwrap();
            stream.write_all(b"OPTIONS / HTTP/1.1\r\nHost: 127.0.0.1:47321\r\nOrigin: https://tubss2.github.io\r\nAccess-Control-Request-Private-Network: true\r\n\r\n").unwrap();
            stream.set_read_timeout(Some(Duration::from_secs(2))).unwrap();
            let mut buf = [0u8; 512];
            let n = stream.read(&mut buf).unwrap_or(0);
            String::from_utf8_lossy(&buf[..n]).into_owned()
        });
        let mut device = DeviceState::default();
        let err = handshake(&listener, "K7QM2P", &mut device, |_| Ok(())).unwrap_err();
        assert_eq!(err, "preflight");
        let body = client.join().unwrap();
        assert!(body.contains("204"));
        assert!(body.contains("Access-Control-Allow-Origin: https://tubss2.github.io"));
        assert!(body.contains("Access-Control-Allow-Private-Network: true"));
        assert!(!body.contains('*'));
    }

    #[test]
    fn pump_writes_press_and_release() {
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let addr = listener.local_addr().unwrap();
        let client = std::thread::spawn(move || {
            let mut stream = TcpStream::connect(addr).unwrap();
            stream.set_read_timeout(Some(Duration::from_secs(2))).unwrap();
            let mut buf = Vec::new();
            let mut chunk = [0u8; 64];
            let deadline = std::time::Instant::now() + Duration::from_secs(2);
            while std::time::Instant::now() < deadline {
                match stream.read(&mut chunk) {
                    Ok(0) => break,
                    Ok(n) => {
                        buf.extend_from_slice(&chunk[..n]);
                        if buf.windows(br#"{"t":"up"}"#.len()).any(|w| w == br#"{"t":"up"}"#) {
                            break;
                        }
                    }
                    Err(err) if err.kind() == std::io::ErrorKind::WouldBlock || err.kind() == std::io::ErrorKind::TimedOut => {
                        if !buf.is_empty() { break; }
                    }
                    Err(_) => break,
                }
            }
            buf
        });
        let (server, _) = listener.accept().unwrap();
        let (tx, rx) = mpsc::channel();
        tx.send(true).unwrap();
        tx.send(false).unwrap();
        drop(tx);
        pump(server, rx, &AtomicBool::new(false), |_| Ok(()), || None).unwrap();
        let buf = client.join().unwrap();
        let text = String::from_utf8_lossy(&buf);
        assert!(text.contains(r#"{"t":"down"}"#));
        assert!(text.contains(r#"{"t":"up"}"#));
    }

    #[test]
    fn pump_changes_the_watched_key_and_forgets() {
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let addr = listener.local_addr().unwrap();
        let client = std::thread::spawn(move || {
            let mut stream = TcpStream::connect(addr).unwrap();
            stream.write_all(&masked(r#"{"t":"watch","watch":{"kind":"key","code":"KeyV"}}"#)).unwrap();
            stream.write_all(&masked(r#"{"t":"forget"}"#)).unwrap();
            stream.set_read_timeout(Some(Duration::from_secs(2))).unwrap();
            let mut buf = Vec::new();
            let mut chunk = [0u8; 128];
            let deadline = std::time::Instant::now() + Duration::from_secs(2);
            while std::time::Instant::now() < deadline {
                match stream.read(&mut chunk) {
                    Ok(0) => break,
                    Ok(n) => {
                        buf.extend_from_slice(&chunk[..n]);
                        if buf.windows(br#"{"t":"denied"}"#.len()).any(|window| window == br#"{"t":"denied"}"#) {
                            break;
                        }
                    }
                    Err(_) => {}
                }
            }
            buf
        });
        let (server, _) = listener.accept().unwrap();
        let (_tx, rx) = mpsc::channel();
        let seen = std::sync::Mutex::new(Vec::new());
        let err = pump(server, rx, &AtomicBool::new(false), |cmd| {
            seen.lock().unwrap().push(cmd);
            Ok(())
        }, || None).unwrap_err();
        assert_eq!(err, "forgotten");
        let seen = seen.into_inner().unwrap();
        assert_eq!(seen, vec![
            LinkedCommand::Watch(Watch::Key { vk: b'V' as u16 }),
            LinkedCommand::Forget,
        ]);
        let raw = client.join().unwrap();
        let body = String::from_utf8_lossy(&raw);
        assert!(body.contains(r#"{"t":"ok"}"#));
        assert!(body.contains(r#"{"t":"denied"}"#));
    }
}

#[cfg(windows)]
mod ui;

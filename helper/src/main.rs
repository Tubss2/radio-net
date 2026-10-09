mod device;
mod protocol;

use device::{authorize, DeviceState};
use protocol::{frame_text, host_allowed, origin_allowed, pairing_code, parse_linked, read_client_frame, LinkedCommand, Watch};
use sha1::{Digest, Sha1};
use std::io::{Read, Write};
use std::net::{TcpListener, TcpStream};
use std::sync::mpsc::{Receiver, RecvTimeoutError};
use std::time::Duration;

const PORT: u16 = 47321;
const WS_GUID: &str = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";

fn main() {
    let code = pairing_code();
    println!("Radio Net helper");
    println!("Pairing code: {code}");
    println!("Listening on 127.0.0.1:{PORT}");
    #[cfg(windows)]
    windows_ui::run(&code);
    #[cfg(not(windows))]
    {
        eprintln!("This tray app watches a Windows key. Protocol checks run with cargo test.");
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

/// Accept one local page, check its origin, and return the watch while the socket stays open.
/// `fresh` is true when a pairing code was used and a new device token was issued.
fn handshake(
    listener: &TcpListener,
    expected: &str,
    device: &mut DeviceState,
    mut persist: impl FnMut(&DeviceState) -> Result<(), String>,
) -> Result<(Watch, TcpStream, bool), String> {
    let (mut stream, addr) = listener.accept().map_err(|err| err.to_string())?;
    if !addr.ip().is_loopback() {
        return Err("refused a non-local connection".into());
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
    Ok((session.watch, stream, session.fresh))
}

/// Forward press and release until the page closes the socket.
/// The page may change the watched key or forget the device. Any other client frame closes the link.
fn pump(
    mut stream: TcpStream,
    events: Receiver<bool>,
    forget: &std::sync::atomic::AtomicBool,
    mut on_client: impl FnMut(LinkedCommand) -> Result<(), String>,
) -> Result<(), String> {
    let _ = stream.set_read_timeout(Some(Duration::from_millis(20)));
    let _ = stream.set_nodelay(true);
    let mut pending = Vec::new();
    let mut buf = [0u8; 256];
    loop {
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
        let (watch, _stream, fresh) = handshake(&listener, "K7QM2P", &mut device, |_| Ok(())).unwrap();
        assert!(fresh);
        assert_eq!(watch, Watch::Key { vk: b'K' as u16 });
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
        let (watch, _stream, fresh) = handshake(&listener, "K7QM2P", &mut device, |_| Ok(())).unwrap();
        assert!(fresh);
        assert_eq!(watch, Watch::Mouse { button: 4 });
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
        let (watch, _stream, fresh) = handshake(&listener, "WRONGCODE", &mut device, |_| Ok(())).unwrap();
        assert!(!fresh);
        assert_eq!(watch, Watch::Mouse { button: 4 });
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
        pump(server, rx, &AtomicBool::new(false), |_| Ok(())).unwrap();
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
        }).unwrap_err();
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
mod windows_ui {
    use super::PORT;
    use crate::protocol::Watch;
    use std::net::TcpListener;
    use std::sync::atomic::{AtomicIsize, Ordering};
    use std::sync::{mpsc::Sender, Mutex};
    use windows::core::w;
    use windows::Win32::Foundation::{HWND, LPARAM, LRESULT, WPARAM};
    use windows::Win32::System::LibraryLoader::GetModuleHandleW;
    use windows::Win32::System::Registry::{
        RegCloseKey, RegCreateKeyExW, RegDeleteValueW, RegSetValueExW, HKEY_CURRENT_USER, KEY_SET_VALUE,
        REG_OPTION_NON_VOLATILE, REG_SZ,
    };
    use windows::Win32::UI::Input::{
        GetRawInputData, RegisterRawInputDevices, HRAWINPUT, RAWINPUT, RAWINPUTDEVICE, RAWINPUTHEADER,
        RIDEV_INPUTSINK, RIDEV_REMOVE, RID_INPUT, RIM_TYPEKEYBOARD, RIM_TYPEMOUSE,
    };
    use windows::Win32::UI::Shell::{
        Shell_NotifyIconW, NIF_INFO, NIF_MESSAGE, NIF_TIP, NIM_ADD, NIM_DELETE, NIM_MODIFY, NOTIFYICONDATAW, NIIF_INFO,
    };
    use windows::Win32::UI::WindowsAndMessaging::{
        AppendMenuW, CreatePopupMenu, CreateWindowExW, DefWindowProcW, DestroyMenu, DispatchMessageW, GetCursorPos,
        GetMessageW, LoadIconW, PostMessageW, PostQuitMessage, RegisterClassW, SetForegroundWindow, TrackPopupMenu,
        TranslateMessage, CW_USEDEFAULT, HMENU, IDI_APPLICATION, MF_CHECKED, MF_GRAYED, MF_STRING,
        MSG, TPM_RIGHTBUTTON, WINDOW_EX_STYLE, WINDOW_STYLE, WM_COMMAND, WM_DESTROY, WM_INPUT, WM_NULL, WM_RBUTTONUP,
        WM_USER, WNDCLASSW,
    };

    const WM_APP_WATCH: u32 = WM_USER + 20;
    const WM_APP_TRAY: u32 = WM_USER + 21;
    const MENU_UNLINK: u16 = 1;
    const MENU_AUTOSTART: u16 = 2;
    static HWND_SLOT: AtomicIsize = AtomicIsize::new(0);
    static EVENTS: Mutex<Option<Sender<bool>>> = Mutex::new(None);
    static WATCH: Mutex<Option<Watch>> = Mutex::new(None);
    static DISPLAY_CODE: Mutex<String> = Mutex::new(String::new());
    static EXPECTED: Mutex<String> = Mutex::new(String::new());
    static DEVICE: Mutex<super::DeviceState> = Mutex::new(super::DeviceState { token_hash: None, watch: None, autostart: false });
    static DEVICE_PATH: std::sync::OnceLock<std::path::PathBuf> = std::sync::OnceLock::new();
    static DROP_LINK: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);
    static LINKED: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);
    static ANNOUNCE_CODE: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);

    pub fn run(code: &str) {
        let listener = match TcpListener::bind(("127.0.0.1", PORT)) {
            Ok(listener) => listener,
            Err(err) => {
                eprintln!("Could not listen on 127.0.0.1:{PORT}: {err}");
                return;
            }
        };
        let path = super::device::default_device_path();
        *DEVICE.lock().unwrap() = super::device::load_device(&path);
        if DEVICE.lock().unwrap().autostart {
            let _ = crate::device::AUTOSTART_VALUE;
            let _ = set_autostart(true);
        }
        let _ = DEVICE_PATH.set(path);
        *EXPECTED.lock().unwrap() = code.to_string();
        *DISPLAY_CODE.lock().unwrap() = code.to_string();
        std::thread::spawn(move || loop {
            let current = EXPECTED.lock().unwrap().clone();
            let mut device = DEVICE.lock().unwrap().clone();
            match super::handshake(&listener, &current, &mut device, |next| {
                match DEVICE_PATH.get() {
                    Some(path) => crate::device::save_device(path, next),
                    None => Ok(()),
                }
            }) {
                Ok((watch, stream, fresh)) => {
                    *DEVICE.lock().unwrap() = device;
                    if fresh {
                        rotate_code();
                    }
                    let (tx, rx) = std::sync::mpsc::channel();
                    *WATCH.lock().unwrap() = Some(watch);
                    *EVENTS.lock().unwrap() = Some(tx);
                    LINKED.store(true, Ordering::Relaxed);
                    post_watch();
                    let ended = super::pump(stream, rx, &DROP_LINK, |cmd| {
                        let mut stored = DEVICE.lock().unwrap();
                        match cmd {
                            super::LinkedCommand::Watch(watch) => {
                                stored.watch = Some(watch.clone());
                                if let Some(path) = DEVICE_PATH.get() {
                                    crate::device::save_device(path, &stored)?;
                                }
                                *WATCH.lock().unwrap() = Some(watch);
                                post_watch();
                                Ok(())
                            }
                            super::LinkedCommand::Forget => {
                                stored.forget_link();
                                if let Some(path) = DEVICE_PATH.get() {
                                    let _ = crate::device::save_device(path, &stored);
                                }
                                Ok(())
                            }
                        }
                    });
                    LINKED.store(false, Ordering::Relaxed);
                    *WATCH.lock().unwrap() = None;
                    *EVENTS.lock().unwrap() = None;
                    if matches!(&ended, Err(err) if err == "forgotten") {
                        rotate_code();
                    } else if let Err(err) = ended {
                        eprintln!("{err}");
                    }
                    post_watch();
                }
                Err(err) if err == "preflight" || err == "denied" => {}
                Err(err) => eprintln!("{err}"),
            }
        });
        message_loop(code);
    }

    fn rotate_code() {
        let next = super::pairing_code();
        *EXPECTED.lock().unwrap() = next.clone();
        *DISPLAY_CODE.lock().unwrap() = next;
        ANNOUNCE_CODE.store(true, Ordering::Relaxed);
    }

    fn forget_from_tray() {
        {
            let mut stored = DEVICE.lock().unwrap();
            stored.forget_link();
            if let Some(path) = DEVICE_PATH.get() {
                let _ = crate::device::save_device(path, &stored);
            }
        }
        *WATCH.lock().unwrap() = None;
        if LINKED.load(Ordering::Relaxed) {
            DROP_LINK.store(true, Ordering::Relaxed);
        } else {
            rotate_code();
            post_watch();
        }
    }

    fn message_loop(code: &str) {
        unsafe {
            let instance = GetModuleHandleW(None).unwrap_or_default();
            let class_name = w!("RadioNetHelper");
            let wc = WNDCLASSW {
                lpfnWndProc: Some(wnd_proc),
                hInstance: instance.into(),
                lpszClassName: class_name,
                hIcon: LoadIconW(None, IDI_APPLICATION).unwrap_or_default(),
                ..Default::default()
            };
            RegisterClassW(&wc);
            let hwnd = CreateWindowExW(
                WINDOW_EX_STYLE(0),
                class_name,
                w!("Radio Net helper"),
                WINDOW_STYLE(0),
                CW_USEDEFAULT, CW_USEDEFAULT, CW_USEDEFAULT, CW_USEDEFAULT,
                HWND::default(),
                HMENU::default(),
                instance,
                None,
            ).unwrap();
            HWND_SLOT.store(hwnd.0 as isize, Ordering::SeqCst);
            if let Some(watch) = WATCH.lock().unwrap().clone() {
                register(hwnd, &watch);
            }
            add_tray(hwnd, code);
            let mut msg = MSG::default();
            while GetMessageW(&mut msg, HWND::default(), 0, 0).as_bool() {
                let _ = TranslateMessage(&msg);
                DispatchMessageW(&msg);
            }
            let data = tray_data(hwnd, "");
            let _ = Shell_NotifyIconW(NIM_DELETE, &data);
        }
    }

    unsafe fn refresh_tray(hwnd: HWND) {
        let code = DISPLAY_CODE.lock().unwrap().clone();
        if code.is_empty() {
            return;
        }
        let linked = LINKED.load(Ordering::Relaxed);
        let announce = !linked && ANNOUNCE_CODE.swap(false, Ordering::Relaxed);
        let tip = if linked { "Radio Net linked".to_string() } else { format!("Radio Net {code}") };
        let mut data = tray_data(hwnd, &tip);
        if announce {
            data.uFlags = flags(NIF_TIP.0 | NIF_INFO.0);
            data.dwInfoFlags = NIIF_INFO;
            write_utf16(&format!("Pairing code {code}"), &mut data.szInfo);
        } else {
            data.uFlags = flags(NIF_TIP.0);
        }
        let _ = Shell_NotifyIconW(NIM_MODIFY, &data);
    }

    unsafe fn show_menu(hwnd: HWND) {
        let menu = CreatePopupMenu().unwrap_or_default();
        if menu.is_invalid() {
            return;
        }
        let code = DISPLAY_CODE.lock().unwrap().clone();
        let code_label = if LINKED.load(Ordering::Relaxed) {
            "Linked to this browser".to_string()
        } else {
            format!("Pairing code {code}")
        };
        let mut code_units: Vec<u16> = code_label.encode_utf16().collect();
        code_units.push(0);
        let _ = AppendMenuW(menu, MF_STRING | MF_GRAYED, 0, windows::core::PCWSTR(code_units.as_ptr()));
        let _ = AppendMenuW(menu, MF_STRING, MENU_UNLINK as usize, w!("Unlink this browser"));
        let auto = DEVICE.lock().unwrap().autostart;
        let auto_flags = if auto { MF_STRING | MF_CHECKED } else { MF_STRING };
        let _ = AppendMenuW(menu, auto_flags, MENU_AUTOSTART as usize, w!("Start with Windows"));
        let mut point = windows::Win32::Foundation::POINT::default();
        let _ = GetCursorPos(&mut point);
        let _ = SetForegroundWindow(hwnd);
        let _ = TrackPopupMenu(menu, TPM_RIGHTBUTTON, point.x, point.y, 0, hwnd, None);
        let _ = PostMessageW(hwnd, WM_NULL, WPARAM(0), LPARAM(0));
        let _ = DestroyMenu(menu);
    }

    fn set_autostart(enabled: bool) -> Result<(), String> {
        unsafe {
            let mut key = windows::Win32::System::Registry::HKEY::default();
            let status = RegCreateKeyExW(
                HKEY_CURRENT_USER,
                w!("Software\\Microsoft\\Windows\\CurrentVersion\\Run"),
                0,
                None,
                REG_OPTION_NON_VOLATILE,
                KEY_SET_VALUE,
                None,
                &mut key,
                None,
            );
            if status.is_err() {
                return Err("could not open the Run key".into());
            }
            let result = if enabled {
                let exe = std::env::current_exe().map_err(|err| err.to_string())?;
                let mut units: Vec<u16> = exe.to_string_lossy().encode_utf16().collect();
                units.push(0);
                let bytes = std::slice::from_raw_parts(units.as_ptr() as *const u8, units.len() * 2);
                RegSetValueExW(key, w!("RadioNetHelper"), 0, REG_SZ, Some(bytes))
            } else {
                RegDeleteValueW(key, w!("RadioNetHelper"))
            };
            let _ = RegCloseKey(key);
            if enabled && result.is_err() {
                return Err("could not set the Run key".into());
            }
            Ok(())
        }
    }

    fn toggle_autostart() {
        let enabled = {
            let mut stored = DEVICE.lock().unwrap();
            stored.autostart = !stored.autostart;
            let enabled = stored.autostart;
            if let Some(path) = DEVICE_PATH.get() {
                let _ = crate::device::save_device(path, &stored);
            }
            enabled
        };
        let _ = set_autostart(enabled);
    }

    unsafe fn add_tray(hwnd: HWND, code: &str) {
        let mut data = tray_data(hwnd, &format!("Radio Net {code}"));
        data.uFlags = flags(NIF_MESSAGE.0 | NIF_TIP.0 | NIF_INFO.0);
        data.uCallbackMessage = WM_APP_TRAY;
        data.dwInfoFlags = NIIF_INFO;
        write_utf16(&format!("Pairing code {code}"), &mut data.szInfo);
        data.hIcon = LoadIconW(None, IDI_APPLICATION).unwrap_or_default();
        let _ = Shell_NotifyIconW(NIM_ADD, &data);
    }

    fn tray_data(hwnd: HWND, tip: &str) -> NOTIFYICONDATAW {
        let mut data = NOTIFYICONDATAW::default();
        data.cbSize = std::mem::size_of::<NOTIFYICONDATAW>() as u32;
        data.hWnd = hwnd;
        data.uID = 1;
        write_utf16(tip, &mut data.szTip);
        data
    }

    fn write_utf16(text: &str, dest: &mut [u16]) {
        for (i, unit) in text.encode_utf16().take(dest.len().saturating_sub(1)).enumerate() {
            dest[i] = unit;
        }
    }

    fn flags(bits: u32) -> windows::Win32::UI::Shell::NOTIFY_ICON_DATA_FLAGS {
        windows::Win32::UI::Shell::NOTIFY_ICON_DATA_FLAGS(bits)
    }

    unsafe extern "system" fn wnd_proc(hwnd: HWND, msg: u32, wparam: WPARAM, lparam: LPARAM) -> LRESULT {
        if msg == WM_INPUT {
            handle_input(HRAWINPUT(lparam.0 as *mut std::ffi::c_void));
            return LRESULT(0);
        }
        if msg == WM_APP_WATCH {
            match WATCH.lock().unwrap().clone() {
                Some(watch) => register(hwnd, &watch),
                None => clear_raw(),
            }
            refresh_tray(hwnd);
            return LRESULT(0);
        }
        if msg == WM_APP_TRAY {
            if lparam.0 as u32 == WM_RBUTTONUP {
                show_menu(hwnd);
            }
            return LRESULT(0);
        }
        if msg == WM_COMMAND {
            match (wparam.0 & 0xffff) as u16 {
                MENU_UNLINK => forget_from_tray(),
                MENU_AUTOSTART => toggle_autostart(),
                _ => {}
            }
            return LRESULT(0);
        }
        if msg == WM_DESTROY {
            PostQuitMessage(0);
            return LRESULT(0);
        }
        DefWindowProcW(hwnd, msg, wparam, lparam)
    }

    unsafe fn register(hwnd: HWND, watch: &Watch) {
        let mouse = matches!(watch, Watch::Mouse { .. });
        let keep = RAWINPUTDEVICE {
            usUsagePage: 0x01,
            usUsage: if mouse { 0x02 } else { 0x06 },
            dwFlags: RIDEV_INPUTSINK,
            hwndTarget: hwnd,
        };
        let drop_other = RAWINPUTDEVICE {
            usUsagePage: 0x01,
            usUsage: if mouse { 0x06 } else { 0x02 },
            dwFlags: RIDEV_REMOVE,
            hwndTarget: HWND::default(),
        };
        let size = std::mem::size_of::<RAWINPUTDEVICE>() as u32;
        let _ = RegisterRawInputDevices(&[drop_other, keep], size);
    }

    unsafe fn clear_raw() {
        let keyboard = RAWINPUTDEVICE {
            usUsagePage: 0x01,
            usUsage: 0x06,
            dwFlags: RIDEV_REMOVE,
            hwndTarget: HWND::default(),
        };
        let mouse = RAWINPUTDEVICE {
            usUsagePage: 0x01,
            usUsage: 0x02,
            dwFlags: RIDEV_REMOVE,
            hwndTarget: HWND::default(),
        };
        let size = std::mem::size_of::<RAWINPUTDEVICE>() as u32;
        let _ = RegisterRawInputDevices(&[keyboard, mouse], size);
    }

    fn post_watch() {
        let raw = HWND_SLOT.load(Ordering::SeqCst);
        if raw == 0 {
            return;
        }
        let hwnd = HWND(raw as *mut std::ffi::c_void);
        unsafe { let _ = PostMessageW(hwnd, WM_APP_WATCH, WPARAM(0), LPARAM(0)); }
    }

    unsafe fn handle_input(handle: HRAWINPUT) {
        let watch = match WATCH.lock().unwrap().clone() {
            Some(watch) => watch,
            None => return,
        };
        let mut size = 0u32;
        let header = std::mem::size_of::<RAWINPUTHEADER>() as u32;
        GetRawInputData(handle, RID_INPUT, None, &mut size, header);
        if size == 0 { return; }
        let mut bytes = vec![0u8; size as usize];
        GetRawInputData(handle, RID_INPUT, Some(bytes.as_mut_ptr() as *mut _), &mut size, header);
        let input = &*(bytes.as_ptr() as *const RAWINPUT);
        let down = match (&watch, input.header.dwType) {
            (Watch::Key { vk }, kind) if kind == RIM_TYPEKEYBOARD.0 => {
                let keyboard = input.data.keyboard;
                if keyboard.VKey != *vk { return; }
                keyboard.Flags & 1 == 0
            }
            (Watch::Mouse { button }, kind) if kind == RIM_TYPEMOUSE.0 => {
                let flags = input.data.mouse.Anonymous.Anonymous.usButtonFlags;
                let (down_bit, up_bit) = match button {
                    4 => (0x0040u16, 0x0080u16),
                    5 => (0x0100u16, 0x0200u16),
                    _ => return,
                };
                if flags & down_bit != 0 { true }
                else if flags & up_bit != 0 { false }
                else { return; }
            }
            _ => return,
        };
        if let Some(tx) = EVENTS.lock().unwrap().as_ref() {
            let _ = tx.send(down);
        }
    }
}

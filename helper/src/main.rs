mod protocol;

use protocol::{frame_text, origin_allowed, pairing_code, parse_pair, read_client_frame, Watch};
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
fn handshake(listener: &TcpListener, expected: &str) -> Result<(Watch, TcpStream), String> {
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
    if !origin_allowed(&origin) {
        let _ = stream.write_all(b"HTTP/1.1 403 Forbidden\r\nContent-Length: 0\r\nConnection: close\r\n\r\n");
        return Err(format!("refused origin {origin}"));
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
    let watch = parse_pair(&text, expected).map_err(|err| err.to_string())?;
    stream.write_all(&frame_text(r#"{"t":"ok"}"#)).map_err(|err| err.to_string())?;
    Ok((watch, stream))
}

/// Forward press and release until the page closes the socket.
fn pump(mut stream: TcpStream, events: Receiver<bool>) -> Result<(), String> {
    let _ = stream.set_read_timeout(Some(Duration::from_millis(20)));
    let _ = stream.set_nodelay(true);
    loop {
        match events.recv_timeout(Duration::from_millis(20)) {
            Ok(down) => {
                let payload = if down { r#"{"t":"down"}"# } else { r#"{"t":"up"}"# };
                stream.write_all(&frame_text(payload)).map_err(|err| err.to_string())?;
            }
            Err(RecvTimeoutError::Timeout) => {}
            Err(RecvTimeoutError::Disconnected) => return Ok(()),
        }
        let mut extra = [0u8; 32];
        match stream.read(&mut extra) {
            Ok(0) => return Ok(()),
            Ok(_) => return Err("the page sent something other than the pair".into()),
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
    use crate::protocol::Watch;
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

    #[test]
    fn handshake_returns_the_watch_while_the_socket_stays_open() {
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let addr = listener.local_addr().unwrap();
        let client = std::thread::spawn(move || {
            let mut stream = TcpStream::connect(addr).unwrap();
            let pair = masked(r#"{"t":"pair","code":"K7QM2P","watch":{"kind":"key","code":"KeyK"}}"#);
            let mut request = b"GET / HTTP/1.1\r\nHost: 127.0.0.1\r\nOrigin: http://127.0.0.1:5175\r\nSec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\n\r\n".to_vec();
            request.extend_from_slice(&pair);
            stream.write_all(&request).unwrap();
            stream.set_read_timeout(Some(Duration::from_secs(2))).unwrap();
            let mut buf = [0u8; 256];
            let n = stream.read(&mut buf).unwrap();
            String::from_utf8_lossy(&buf[..n]).into_owned()
        });
        let (watch, _stream) = handshake(&listener, "K7QM2P").unwrap();
        assert_eq!(watch, Watch::Key { vk: b'K' as u16 });
        let reply = client.join().unwrap();
        assert!(reply.contains("101"));
        assert!(reply.contains("s3pPLMBiTxaQ9kYGzzhZRbK+xOo="));
        assert!(reply.contains(r#"{"t":"ok"}"#));
    }

    #[test]
    fn handshake_refuses_a_foreign_origin() {
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let addr = listener.local_addr().unwrap();
        let client = std::thread::spawn(move || {
            let mut stream = TcpStream::connect(addr).unwrap();
            stream.write_all(b"GET / HTTP/1.1\r\nHost: 127.0.0.1\r\nOrigin: https://evil.example\r\nSec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\n\r\n").unwrap();
            stream.set_read_timeout(Some(Duration::from_secs(2))).unwrap();
            let mut buf = [0u8; 128];
            let n = stream.read(&mut buf).unwrap_or(0);
            String::from_utf8_lossy(&buf[..n]).into_owned()
        });
        let err = handshake(&listener, "K7QM2P").unwrap_err();
        assert!(err.contains("evil.example"));
        assert!(client.join().unwrap().contains("403"));
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
        pump(server, rx).unwrap();
        let buf = client.join().unwrap();
        let text = String::from_utf8_lossy(&buf);
        assert!(text.contains(r#"{"t":"down"}"#));
        assert!(text.contains(r#"{"t":"up"}"#));
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
    use windows::Win32::UI::Input::{
        GetRawInputData, RegisterRawInputDevices, HRAWINPUT, RAWINPUT, RAWINPUTDEVICE, RAWINPUTHEADER,
        RIDEV_INPUTSINK, RIDEV_REMOVE, RID_INPUT, RIM_TYPEKEYBOARD, RIM_TYPEMOUSE,
    };
    use windows::Win32::UI::Shell::{
        Shell_NotifyIconW, NIF_INFO, NIF_MESSAGE, NIF_TIP, NIM_ADD, NIM_DELETE, NOTIFYICONDATAW, NIIF_INFO,
    };
    use windows::Win32::UI::WindowsAndMessaging::{
        CreateWindowExW, DefWindowProcW, DispatchMessageW, GetMessageW, LoadIconW, PostMessageW, PostQuitMessage,
        RegisterClassW, TranslateMessage, CW_USEDEFAULT, HMENU, IDI_APPLICATION, MSG, WINDOW_EX_STYLE,
        WINDOW_STYLE, WM_DESTROY, WM_INPUT, WM_USER, WNDCLASSW,
    };

    const WM_APP_WATCH: u32 = WM_USER + 20;
    const WM_APP_TRAY: u32 = WM_USER + 21;
    static HWND_SLOT: AtomicIsize = AtomicIsize::new(0);
    static EVENTS: Mutex<Option<Sender<bool>>> = Mutex::new(None);
    static WATCH: Mutex<Option<Watch>> = Mutex::new(None);

    pub fn run(code: &str) {
        let listener = match TcpListener::bind(("127.0.0.1", PORT)) {
            Ok(listener) => listener,
            Err(err) => {
                eprintln!("Could not listen on 127.0.0.1:{PORT}: {err}");
                return;
            }
        };
        let expected = code.to_string();
        std::thread::spawn(move || loop {
            match super::handshake(&listener, &expected) {
                Ok((watch, stream)) => {
                    let (tx, rx) = std::sync::mpsc::channel();
                    *WATCH.lock().unwrap() = Some(watch);
                    *EVENTS.lock().unwrap() = Some(tx);
                    post_watch();
                    if let Err(err) = super::pump(stream, rx) {
                        eprintln!("{err}");
                    }
                    *WATCH.lock().unwrap() = None;
                    *EVENTS.lock().unwrap() = None;
                    post_watch();
                }
                Err(err) => eprintln!("{err}"),
            }
        });
        message_loop(code);
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
            return LRESULT(0);
        }
        if msg == WM_APP_TRAY {
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

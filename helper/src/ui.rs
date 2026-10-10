//! Always-visible Win32 window. There is no tray icon and no background mode.
//! Closing the window stops Raw Input, closes the socket, and exits the process.

use super::{finish_stream, is_shutdown, pump, PORT, SHUTDOWN};
use crate::device::{self, DeviceState};
use crate::protocol::{watch_label, LinkedCommand, Watch};
use std::net::{Shutdown, TcpListener, TcpStream};
use std::sync::atomic::{AtomicBool, AtomicIsize, Ordering};
use std::sync::{mpsc, Mutex, OnceLock};
use std::time::Duration;
use windows::core::{w, PCWSTR};
use windows::Win32::Foundation::{HWND, LPARAM, LRESULT, WPARAM};
use windows::Win32::Graphics::Gdi::{GetStockObject, GetSysColorBrush, COLOR_WINDOW, DEFAULT_GUI_FONT};
use windows::Win32::System::LibraryLoader::GetModuleHandleW;
use windows::Win32::System::Registry::{
    RegCloseKey, RegCreateKeyExW, RegDeleteValueW, HKEY_CURRENT_USER, KEY_SET_VALUE, REG_OPTION_NON_VOLATILE,
};
use windows::Win32::UI::Input::{
    GetRawInputData, RegisterRawInputDevices, HRAWINPUT, RAWINPUT, RAWINPUTDEVICE, RAWINPUTHEADER, RIDEV_INPUTSINK,
    RIDEV_REMOVE, RID_INPUT, RIM_TYPEKEYBOARD, RIM_TYPEMOUSE,
};
use windows::Win32::UI::WindowsAndMessaging::{
    CreateWindowExW, DefWindowProcW, DestroyWindow, DispatchMessageW, GetMessageW, LoadIconW, MessageBoxW,
    PostMessageW, PostQuitMessage, RegisterClassW, SendMessageW, SetWindowTextW, ShowWindow, TranslateMessage,
    BS_PUSHBUTTON, CW_USEDEFAULT, HMENU, IDI_APPLICATION, MB_ICONINFORMATION, MB_OK, MSG, SW_HIDE, SW_SHOW,
    SW_SHOWNORMAL, WINDOW_EX_STYLE, WINDOW_STYLE, WM_CLOSE, WM_COMMAND, WM_DESTROY, WM_INPUT, WM_SETFONT, WM_USER,
    WNDCLASSW, WS_CAPTION, WS_CHILD, WS_MINIMIZEBOX, WS_OVERLAPPED, WS_SYSMENU, WS_TABSTOP, WS_VISIBLE,
};

const WM_APP_REFRESH: u32 = WM_USER + 20;
const ID_STATUS: usize = 101;
const ID_CODE_LABEL: usize = 102;
const ID_CODE: usize = 103;
const ID_KEY: usize = 104;
const ID_PRESS: usize = 105;
const ID_SET: usize = 106;
const ID_UNLINK: usize = 107;

static HWND_SLOT: AtomicIsize = AtomicIsize::new(0);
static EVENTS: Mutex<Option<mpsc::Sender<bool>>> = Mutex::new(None);
static WATCH: Mutex<Option<Watch>> = Mutex::new(None);
static DEVICE: Mutex<DeviceState> = Mutex::new(DeviceState { token_hash: None, watch: None, autostart: false });
static DEVICE_PATH: OnceLock<std::path::PathBuf> = OnceLock::new();
static EXPECTED: Mutex<String> = Mutex::new(String::new());
static DROP_LINK: AtomicBool = AtomicBool::new(false);
static ACTIVE: Mutex<Option<TcpStream>> = Mutex::new(None);
static REBIND: Mutex<Option<mpsc::Sender<Watch>>> = Mutex::new(None);
static STATUS: Mutex<Status> = Mutex::new(Status {
    linked: false,
    origin: String::new(),
    code: String::new(),
    watch: None,
    pressed: false,
    capturing: false,
    suppress_held: false,
});
static CONTROLS: Mutex<Option<Controls>> = Mutex::new(None);

struct Status {
    linked: bool,
    origin: String,
    code: String,
    watch: Option<Watch>,
    pressed: bool,
    capturing: bool,
    /// The key used to bind is still physically down. Do not transmit until it is released.
    suppress_held: bool,
}

#[derive(Clone, Copy)]
struct Controls {
    status: isize,
    code_label: isize,
    code: isize,
    key: isize,
    press: isize,
    set_key: isize,
    unlink: isize,
}

fn hwnd_of(raw: isize) -> HWND {
    HWND(raw as *mut core::ffi::c_void)
}

enum RawEdge {
    Key { vk: u16, down: bool },
    Mouse { button: u8, down: bool },
}

pub fn run(code: &str) {
    let listener = match TcpListener::bind(("127.0.0.1", PORT)) {
        Ok(listener) => listener,
        Err(_) => {
            unsafe {
                MessageBoxW(
                    HWND::default(),
                    w!("Radio Net helper is already open."),
                    w!("Radio Net helper"),
                    MB_OK | MB_ICONINFORMATION,
                );
            }
            return;
        }
    };
    let path = device::default_device_path();
    let mut loaded = device::load_device(&path);
    if loaded.autostart {
        loaded.autostart = false;
        let _ = device::save_device(&path, &loaded);
    }
    clear_legacy_run_key();
    *DEVICE.lock().unwrap() = loaded.clone();
    let _ = DEVICE_PATH.set(path);
    *EXPECTED.lock().unwrap() = code.to_string();
    {
        let mut status = STATUS.lock().unwrap();
        status.code = code.to_string();
        status.watch = loaded.watch.clone();
    }
    *WATCH.lock().unwrap() = loaded.watch;
    let net = std::thread::spawn(move || net_loop(listener));
    message_loop();
    SHUTDOWN.store(true, Ordering::SeqCst);
    wake_listener();
    let _ = net.join();
}

fn net_loop(listener: TcpListener) {
    loop {
        if is_shutdown() {
            break;
        }
        let (stream, addr) = match listener.accept() {
            Ok(pair) => pair,
            Err(_) => break,
        };
        if is_shutdown() {
            break;
        }
        if !addr.ip().is_loopback() {
            continue;
        }
        track(&stream);
        let current = EXPECTED.lock().unwrap().clone();
        let mut device = DEVICE.lock().unwrap().clone();
        let outcome = finish_stream(stream, &current, &mut device, |next| {
            match DEVICE_PATH.get() {
                Some(path) => device::save_device(path, next),
                None => Ok(()),
            }
        });
        match outcome {
            Ok(link) => {
                *DEVICE.lock().unwrap() = device;
                if link.fresh {
                    rotate_code();
                }
                let (tx, rx) = mpsc::channel();
                {
                    *WATCH.lock().unwrap() = Some(link.watch.clone());
                    let mut status = STATUS.lock().unwrap();
                    status.linked = true;
                    status.origin = link.origin;
                    status.watch = Some(link.watch);
                    status.pressed = false;
                    status.capturing = false;
                }
                *EVENTS.lock().unwrap() = Some(tx);
                let (rebind_tx, rebind_rx) = mpsc::channel();
                *REBIND.lock().unwrap() = Some(rebind_tx);
                post_refresh();
                let ended = pump(link.stream, rx, &DROP_LINK, apply_command, || rebind_rx.try_recv().ok());
                *REBIND.lock().unwrap() = None;
                clear_active();
                *EVENTS.lock().unwrap() = None;
                let watch = DEVICE.lock().unwrap().watch.clone();
                *WATCH.lock().unwrap() = watch.clone();
                {
                    let mut status = STATUS.lock().unwrap();
                    status.linked = false;
                    status.origin.clear();
                    status.pressed = false;
                    status.watch = watch;
                }
                if matches!(&ended, Err(err) if err == "forgotten") {
                    rotate_code();
                }
                post_refresh();
            }
            Err(err) if err == "preflight" || err == "denied" || err == "stopped" || is_shutdown() => {}
            Err(_) => {}
        }
    }
}

fn apply_command(cmd: LinkedCommand) -> Result<(), String> {
    let watch = {
        let mut stored = DEVICE.lock().unwrap();
        match cmd {
            LinkedCommand::Watch(watch) => {
                stored.watch = Some(watch.clone());
                if let Some(path) = DEVICE_PATH.get() {
                    device::save_device(path, &stored)?;
                }
                Some(watch)
            }
            LinkedCommand::Forget => {
                stored.forget_link();
                if let Some(path) = DEVICE_PATH.get() {
                    let _ = device::save_device(path, &stored);
                }
                stored.watch.clone()
            }
        }
    };
    *WATCH.lock().unwrap() = watch.clone();
    STATUS.lock().unwrap().watch = watch;
    post_refresh();
    Ok(())
}

fn rotate_code() {
    let next = crate::protocol::pairing_code();
    *EXPECTED.lock().unwrap() = next.clone();
    STATUS.lock().unwrap().code = next;
    post_refresh();
}

fn track(stream: &TcpStream) {
    if let Ok(clone) = stream.try_clone() {
        *ACTIVE.lock().unwrap() = Some(clone);
    }
}

fn clear_active() {
    *ACTIVE.lock().unwrap() = None;
}

fn wake_listener() {
    if let Some(stream) = ACTIVE.lock().unwrap().take() {
        let _ = stream.shutdown(Shutdown::Both);
    }
    let _ = TcpStream::connect_timeout(
        &std::net::SocketAddr::from(([127, 0, 0, 1], PORT)),
        Duration::from_millis(300),
    );
}

fn clear_legacy_run_key() {
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
            return;
        }
        let mut name: Vec<u16> = device::AUTOSTART_VALUE.encode_utf16().collect();
        name.push(0);
        let _ = RegDeleteValueW(key, PCWSTR(name.as_ptr()));
        let _ = RegCloseKey(key);
    }
}

fn message_loop() {
    unsafe {
        let instance = GetModuleHandleW(None).unwrap_or_default();
        let class_name = w!("RadioNetHelperWindow");
        let wc = WNDCLASSW {
            lpfnWndProc: Some(wnd_proc),
            hInstance: instance.into(),
            lpszClassName: class_name,
            hIcon: LoadIconW(None, IDI_APPLICATION).unwrap_or_default(),
            hbrBackground: GetSysColorBrush(COLOR_WINDOW),
            ..Default::default()
        };
        RegisterClassW(&wc);
        let hwnd = match CreateWindowExW(
            WINDOW_EX_STYLE(0),
            class_name,
            w!("Radio Net helper"),
            WS_OVERLAPPED | WS_CAPTION | WS_SYSMENU | WS_MINIMIZEBOX,
            CW_USEDEFAULT,
            CW_USEDEFAULT,
            440,
            300,
            HWND::default(),
            HMENU::default(),
            instance,
            None,
        ) {
            Ok(hwnd) => hwnd,
            Err(_) => return,
        };
        HWND_SLOT.store(hwnd.0 as isize, Ordering::SeqCst);
        let controls = Controls {
            status: child(w!("STATIC"), "", WS_CHILD | WS_VISIBLE, 16, 16, 392, 24, hwnd, ID_STATUS).0 as isize,
            code_label: child(w!("STATIC"), "Pairing code", WS_CHILD | WS_VISIBLE, 16, 48, 392, 20, hwnd, ID_CODE_LABEL).0 as isize,
            code: child(w!("STATIC"), "", WS_CHILD | WS_VISIBLE, 16, 70, 392, 28, hwnd, ID_CODE).0 as isize,
            key: child(w!("STATIC"), "", WS_CHILD | WS_VISIBLE, 16, 112, 392, 24, hwnd, ID_KEY).0 as isize,
            press: child(w!("STATIC"), "", WS_CHILD | WS_VISIBLE, 16, 140, 392, 24, hwnd, ID_PRESS).0 as isize,
            set_key: child(w!("BUTTON"), "Set key", WS_CHILD | WS_VISIBLE | WS_TABSTOP | style_bits(BS_PUSHBUTTON as u32), 16, 180, 180, 32, hwnd, ID_SET).0 as isize,
            unlink: child(w!("BUTTON"), "Unlink", WS_CHILD | WS_VISIBLE | WS_TABSTOP | style_bits(BS_PUSHBUTTON as u32), 212, 180, 180, 32, hwnd, ID_UNLINK).0 as isize,
        };
        let font = GetStockObject(DEFAULT_GUI_FONT);
        for control in [controls.status, controls.code_label, controls.code, controls.key, controls.press, controls.set_key, controls.unlink] {
            let _ = SendMessageW(hwnd_of(control), WM_SETFONT, WPARAM(font.0 as usize), LPARAM(1));
        }
        *CONTROLS.lock().unwrap() = Some(controls);
        apply_status(true);
        let _ = ShowWindow(hwnd, SW_SHOWNORMAL);
        let mut msg = MSG::default();
        while GetMessageW(&mut msg, HWND::default(), 0, 0).as_bool() {
            let _ = TranslateMessage(&msg);
            DispatchMessageW(&msg);
        }
    }
}

fn style_bits(bits: u32) -> WINDOW_STYLE {
    WINDOW_STYLE(bits)
}

fn child(class: PCWSTR, text: &str, style: WINDOW_STYLE, x: i32, y: i32, w: i32, h: i32, parent: HWND, id: usize) -> HWND {
    let mut units: Vec<u16> = text.encode_utf16().collect();
    units.push(0);
    unsafe {
        CreateWindowExW(
            WINDOW_EX_STYLE(0),
            class,
            PCWSTR(units.as_ptr()),
            style,
            x,
            y,
            w,
            h,
            parent,
            HMENU(id as *mut core::ffi::c_void),
            GetModuleHandleW(None).unwrap_or_default(),
            None,
        )
        .unwrap_or_default()
    }
}

fn set_text(hwnd: HWND, text: &str) {
    if hwnd.0.is_null() {
        return;
    }
    let mut units: Vec<u16> = text.encode_utf16().collect();
    units.push(0);
    unsafe {
        let _ = SetWindowTextW(hwnd, PCWSTR(units.as_ptr()));
    }
}

fn post_refresh() {
    let raw = HWND_SLOT.load(Ordering::SeqCst);
    if raw == 0 {
        return;
    }
    let hwnd = HWND(raw as *mut core::ffi::c_void);
    unsafe {
        let _ = PostMessageW(hwnd, WM_APP_REFRESH, WPARAM(0), LPARAM(0));
    }
}

fn apply_status(reregister: bool) {
    let status = {
        let guard = STATUS.lock().unwrap();
        StatusCopy {
            linked: guard.linked,
            origin: guard.origin.clone(),
            code: guard.code.clone(),
            watch: guard.watch.clone(),
            pressed: guard.pressed,
            capturing: guard.capturing,
        }
    };
    let controls = match *CONTROLS.lock().unwrap() {
        Some(controls) => controls,
        None => return,
    };
    let state = if status.linked && !status.origin.is_empty() {
        format!("Connected to {}", status.origin)
    } else if status.linked {
        "Connected".into()
    } else {
        "Disconnected".into()
    };
    set_text(hwnd_of(controls.status), &state);
    let show_code = !status.linked && !status.capturing;
    unsafe {
        let _ = ShowWindow(hwnd_of(controls.code_label), if show_code { SW_SHOW } else { SW_HIDE });
        let _ = ShowWindow(hwnd_of(controls.code), if show_code { SW_SHOW } else { SW_HIDE });
    }
    set_text(hwnd_of(controls.code), &status.code);
    let key = if status.capturing {
        "Press a key or a mouse side button".into()
    } else if let Some(watch) = &status.watch {
        format!("Watched key: {}", watch_label(watch))
    } else {
        "Watched key: not set".into()
    };
    set_text(hwnd_of(controls.key), &key);
    set_text(hwnd_of(controls.press), if status.pressed { "Pressed" } else { "" });
    set_text(hwnd_of(controls.set_key), if status.capturing { "Cancel" } else { "Set key" });
    if reregister {
        let raw = HWND_SLOT.load(Ordering::SeqCst);
        if raw != 0 {
            register(HWND(raw as *mut core::ffi::c_void), status.watch.as_ref(), status.capturing);
        }
    }
}

struct StatusCopy {
    linked: bool,
    origin: String,
    code: String,
    watch: Option<Watch>,
    pressed: bool,
    capturing: bool,
}

fn toggle_capture() {
    {
        let mut status = STATUS.lock().unwrap();
        status.capturing = !status.capturing;
        if !status.capturing {
            status.suppress_held = false;
        }
    }
    apply_status(true);
}

fn unlink_from_window() {
    let watch = {
        let mut stored = DEVICE.lock().unwrap();
        stored.forget_link();
        if let Some(path) = DEVICE_PATH.get() {
            let _ = device::save_device(path, &stored);
        }
        stored.watch.clone()
    };
    *WATCH.lock().unwrap() = watch.clone();
    let linked = {
        let mut status = STATUS.lock().unwrap();
        status.capturing = false;
        status.watch = watch;
        status.pressed = false;
        status.suppress_held = false;
        status.linked
    };
    if linked {
        DROP_LINK.store(true, Ordering::SeqCst);
    } else {
        rotate_code();
    }
    apply_status(true);
}

fn bind_watch(watch: Watch) {
    {
        let mut stored = DEVICE.lock().unwrap();
        stored.watch = Some(watch.clone());
        if let Some(path) = DEVICE_PATH.get() {
            let _ = device::save_device(path, &stored);
        }
    }
    *WATCH.lock().unwrap() = Some(watch.clone());
    {
        let mut status = STATUS.lock().unwrap();
        status.watch = Some(watch.clone());
        status.capturing = false;
        status.suppress_held = true;
        status.pressed = false;
    }
    if let Some(tx) = REBIND.lock().unwrap().as_ref() {
        let _ = tx.send(watch);
    }
    apply_status(true);
}

unsafe extern "system" fn wnd_proc(hwnd: HWND, msg: u32, wparam: WPARAM, lparam: LPARAM) -> LRESULT {
    if msg == WM_INPUT {
        handle_input(HRAWINPUT(lparam.0 as *mut core::ffi::c_void));
        return LRESULT(0);
    }
    if msg == WM_APP_REFRESH {
        apply_status(true);
        return LRESULT(0);
    }
    if msg == WM_COMMAND {
        match wparam.0 & 0xffff {
            ID_SET => toggle_capture(),
            ID_UNLINK => unlink_from_window(),
            _ => {}
        }
        return LRESULT(0);
    }
    if msg == WM_CLOSE {
        clear_raw();
        SHUTDOWN.store(true, Ordering::SeqCst);
        wake_listener();
        let _ = DestroyWindow(hwnd);
        return LRESULT(0);
    }
    if msg == WM_DESTROY {
        HWND_SLOT.store(0, Ordering::SeqCst);
        PostQuitMessage(0);
        return LRESULT(0);
    }
    DefWindowProcW(hwnd, msg, wparam, lparam)
}

fn register(hwnd: HWND, watch: Option<&Watch>, capturing: bool) {
    unsafe {
        if capturing {
            let keyboard = device(0x06, RIDEV_INPUTSINK, hwnd);
            let mouse = device(0x02, RIDEV_INPUTSINK, hwnd);
            let size = std::mem::size_of::<RAWINPUTDEVICE>() as u32;
            let _ = RegisterRawInputDevices(&[keyboard, mouse], size);
            return;
        }
        match watch {
            Some(watch) => {
                let mouse = matches!(watch, Watch::Mouse { .. });
                let keep = device(if mouse { 0x02 } else { 0x06 }, RIDEV_INPUTSINK, hwnd);
                let drop_other = device(if mouse { 0x06 } else { 0x02 }, RIDEV_REMOVE, HWND::default());
                let size = std::mem::size_of::<RAWINPUTDEVICE>() as u32;
                let _ = RegisterRawInputDevices(&[drop_other, keep], size);
            }
            None => clear_raw(),
        }
    }
}

fn device(usage: u16, flags: windows::Win32::UI::Input::RAWINPUTDEVICE_FLAGS, hwnd: HWND) -> RAWINPUTDEVICE {
    RAWINPUTDEVICE {
        usUsagePage: 0x01,
        usUsage: usage,
        dwFlags: flags,
        hwndTarget: hwnd,
    }
}

unsafe fn clear_raw() {
    let keyboard = device(0x06, RIDEV_REMOVE, HWND::default());
    let mouse = device(0x02, RIDEV_REMOVE, HWND::default());
    let size = std::mem::size_of::<RAWINPUTDEVICE>() as u32;
    let _ = RegisterRawInputDevices(&[keyboard, mouse], size);
}

unsafe fn handle_input(handle: HRAWINPUT) {
    let Some(edge) = read_edge(handle) else { return };
    let capturing = STATUS.lock().unwrap().capturing;
    if capturing {
        let bound = match edge {
            RawEdge::Key { vk, down: true } if (1..0xFF).contains(&vk) => Some(Watch::Key { vk }),
            RawEdge::Mouse { button, down: true } if button == 4 || button == 5 => Some(Watch::Mouse { button }),
            _ => None,
        };
        if let Some(watch) = bound {
            bind_watch(watch);
        }
        return;
    }
    let watch = match WATCH.lock().unwrap().clone() {
        Some(watch) => watch,
        None => return,
    };
    let down = match (&watch, edge) {
        (Watch::Key { vk }, RawEdge::Key { vk: got, down }) if *vk == got => down,
        (Watch::Mouse { button }, RawEdge::Mouse { button: got, down }) if *button == got => down,
        _ => return,
    };
    if STATUS.lock().unwrap().suppress_held {
        if !down {
            STATUS.lock().unwrap().suppress_held = false;
        }
        return;
    }
    STATUS.lock().unwrap().pressed = down;
    if let Some(tx) = EVENTS.lock().unwrap().as_ref() {
        let _ = tx.send(down);
    }
    apply_status(false);
}

unsafe fn read_edge(handle: HRAWINPUT) -> Option<RawEdge> {
    let mut size = 0u32;
    let header = std::mem::size_of::<RAWINPUTHEADER>() as u32;
    GetRawInputData(handle, RID_INPUT, None, &mut size, header);
    if size == 0 {
        return None;
    }
    let mut bytes = vec![0u8; size as usize];
    GetRawInputData(handle, RID_INPUT, Some(bytes.as_mut_ptr() as *mut _), &mut size, header);
    let input = &*(bytes.as_ptr() as *const RAWINPUT);
    if input.header.dwType == RIM_TYPEKEYBOARD.0 {
        let keyboard = input.data.keyboard;
        let vk = keyboard.VKey;
        if vk == 0 {
            return None;
        }
        return Some(RawEdge::Key { vk, down: keyboard.Flags & 1 == 0 });
    }
    if input.header.dwType == RIM_TYPEMOUSE.0 {
        let flags = input.data.mouse.Anonymous.Anonymous.usButtonFlags;
        let (button, down) = if flags & 0x0040 != 0 {
            (4, true)
        } else if flags & 0x0080 != 0 {
            (4, false)
        } else if flags & 0x0100 != 0 {
            (5, true)
        } else if flags & 0x0200 != 0 {
            (5, false)
        } else {
            return None;
        };
        return Some(RawEdge::Mouse { button, down });
    }
    None
}

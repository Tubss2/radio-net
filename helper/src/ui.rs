//! Always-visible Win32 window. There is no tray icon and no background mode.
//! Closing the window stops Raw Input, closes the socket, and exits the process.

use super::{finish_stream, is_shutdown, pump, PORT, SHUTDOWN};
use crate::device::{self, Binds, DeviceState, Edge};
use crate::protocol::{watch_label, LinkedCommand, OutEvent, Role, Watch, CAPTURE_HINT, NEXT_ROW, PREV_ROW, TALK_ROW};
use std::net::{Shutdown, TcpListener, TcpStream};
use std::sync::atomic::{AtomicBool, AtomicIsize, Ordering};
use std::sync::{mpsc, Mutex, OnceLock};
use std::time::Duration;
use windows::core::{w, PCWSTR};
use windows::Win32::Foundation::{COLORREF, HWND, LPARAM, LRESULT, RECT, WPARAM};
use windows::Win32::Graphics::Gdi::{
    BeginPaint, CreateFontW, CreateSolidBrush, EndPaint, FillRect, GetStockObject, GetSysColorBrush, InvalidateRect,
    UpdateWindow, COLOR_WINDOW, DEFAULT_GUI_FONT, FW_BOLD, HBRUSH, PAINTSTRUCT,
};
use windows::Win32::System::LibraryLoader::GetModuleHandleW;
use windows::Win32::System::Registry::{
    RegCloseKey, RegCreateKeyExW, RegDeleteValueW, HKEY_CURRENT_USER, KEY_SET_VALUE, REG_OPTION_NON_VOLATILE,
};
use windows::Win32::UI::Input::{
    GetRawInputData, RegisterRawInputDevices, HRAWINPUT, RAWINPUT, RAWINPUTDEVICE, RAWINPUTHEADER, RIDEV_INPUTSINK,
    RIDEV_REMOVE, RID_INPUT, RIM_TYPEKEYBOARD, RIM_TYPEMOUSE,
};
use windows::Win32::UI::Shell::ShellExecuteW;
use windows::Win32::UI::WindowsAndMessaging::{
    CreateWindowExW, DefWindowProcW, DestroyWindow, DispatchMessageW, GetClientRect, GetDlgCtrlID, GetMessageW, IsIconic,
    LoadIconW, MessageBoxW, MoveWindow, PostMessageW, PostQuitMessage, RegisterClassW, SendMessageW, SetWindowPos,
    SetWindowTextW, ShowWindow, TranslateMessage, BS_PUSHBUTTON, CW_USEDEFAULT, HMENU, IDI_APPLICATION,
    MB_ICONINFORMATION, MB_OK, MSG, SW_HIDE, SW_SHOW, SW_SHOWNORMAL, SWP_NOACTIVATE, SWP_NOMOVE, SWP_NOZORDER,
    WINDOW_EX_STYLE, WINDOW_STYLE, WM_CLOSE, WM_COMMAND, WM_DESTROY, WM_ERASEBKGND, WM_INPUT, WM_PAINT, WM_SETFONT,
    WM_USER, WNDCLASSW, WS_BORDER, WS_CAPTION, WS_CHILD, WS_MINIMIZEBOX, WS_OVERLAPPED, WS_SYSMENU, WS_TABSTOP,
    WS_VISIBLE,
};

const WM_APP_REFRESH: u32 = WM_USER + 20;
const ID_STATUS: usize = 101;
const ID_HINT: usize = 102;
const ID_CODE: usize = 103;
const ID_OPEN: usize = 104;
const ID_UNLINK: usize = 105;
const ID_PTT_LABEL: usize = 110;
const ID_PTT_LIGHT: usize = 111;
const ID_PTT_SET: usize = 112;
const ID_PREV_LABEL: usize = 120;
const ID_PREV_LIGHT: usize = 121;
const ID_PREV_SET: usize = 122;
const ID_NEXT_LABEL: usize = 130;
const ID_NEXT_LIGHT: usize = 131;
const ID_NEXT_SET: usize = 132;
const SS_CENTER: u32 = 0x0001;

static HWND_SLOT: AtomicIsize = AtomicIsize::new(0);
static EVENTS: Mutex<Option<mpsc::Sender<OutEvent>>> = Mutex::new(None);
static DEVICE: Mutex<DeviceState> = Mutex::new(DeviceState {
    token_hash: None,
    binds: Binds {
        ptt: Some(Watch::Key { vk: 0x70 }),
        prev: Some(Watch::Key { vk: 0x72 }),
        next: Some(Watch::Key { vk: 0x73 }),
    },
    autostart: false,
});
static DEVICE_PATH: OnceLock<std::path::PathBuf> = OnceLock::new();
static EXPECTED: Mutex<String> = Mutex::new(String::new());
static DROP_LINK: AtomicBool = AtomicBool::new(false);
static ACTIVE: Mutex<Option<TcpStream>> = Mutex::new(None);
static STATUS: Mutex<Status> = Mutex::new(Status {
    linked: false,
    origin: String::new(),
    code: String::new(),
    binds: Binds {
        ptt: Some(Watch::Key { vk: 0x70 }),
        prev: Some(Watch::Key { vk: 0x72 }),
        next: Some(Watch::Key { vk: 0x73 }),
    },
    held: [false; 3],
    capturing: None,
    suppress: None,
});
static CONTROLS: Mutex<Option<Controls>> = Mutex::new(None);
static PAINT: Mutex<Paint> = Mutex::new(Paint { red: 0, dim: 0 });

struct Status {
    linked: bool,
    origin: String,
    code: String,
    binds: Binds,
    held: [bool; 3],
    capturing: Option<Role>,
    /// The key used to bind is still physically down. Do not transmit until it is released.
    suppress: Option<Watch>,
}

struct Paint {
    red: isize,
    dim: isize,
}

#[derive(Clone, Copy)]
struct Row {
    label: isize,
    light: isize,
    set: isize,
}

#[derive(Clone, Copy)]
struct Controls {
    status: isize,
    hint: isize,
    code: isize,
    open: isize,
    unlink: isize,
    ptt: Row,
    prev: Row,
    next: Row,
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
        status.binds = loaded.binds.clone();
    }
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
                *DEVICE.lock().unwrap() = device.clone();
                if link.fresh {
                    rotate_code();
                }
                let (tx, rx) = mpsc::channel();
                {
                    let mut status = STATUS.lock().unwrap();
                    status.linked = true;
                    status.origin = link.origin;
                    status.binds = device.binds;
                    status.held = [false; 3];
                    status.capturing = None;
                }
                *EVENTS.lock().unwrap() = Some(tx);
                post_refresh();
                let ended = pump(link.stream, rx, &DROP_LINK, apply_command);
                clear_active();
                *EVENTS.lock().unwrap() = None;
                {
                    let mut status = STATUS.lock().unwrap();
                    status.linked = false;
                    status.origin.clear();
                    status.held = [false; 3];
                    status.binds = DEVICE.lock().unwrap().binds.clone();
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
    let LinkedCommand::Forget = cmd;
    let mut stored = DEVICE.lock().unwrap();
    stored.forget_link();
    if let Some(path) = DEVICE_PATH.get() {
        let _ = device::save_device(path, &stored);
    }
    drop(stored);
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
        let light_class = w!("RadioNetHelperLight");
        let light_wc = WNDCLASSW {
            lpfnWndProc: Some(light_proc),
            hInstance: instance.into(),
            lpszClassName: light_class,
            hbrBackground: HBRUSH::default(),
            ..Default::default()
        };
        RegisterClassW(&light_wc);
        let hwnd = match CreateWindowExW(
            WINDOW_EX_STYLE(0),
            class_name,
            w!("Radio Net helper"),
            WS_OVERLAPPED | WS_CAPTION | WS_SYSMENU | WS_MINIMIZEBOX,
            CW_USEDEFAULT,
            CW_USEDEFAULT,
            460,
            520,
            HWND::default(),
            HMENU::default(),
            instance,
            None,
        ) {
            Ok(hwnd) => hwnd,
            Err(_) => return,
        };
        HWND_SLOT.store(hwnd.0 as isize, Ordering::SeqCst);
        let button = WS_CHILD | WS_VISIBLE | WS_TABSTOP | style_bits(BS_PUSHBUTTON as u32);
        let controls = Controls {
            status: child(w!("STATIC"), "", WS_CHILD | WS_VISIBLE, 16, 16, 412, 22, hwnd, ID_STATUS).0 as isize,
            hint: child(w!("STATIC"), "", WS_CHILD | WS_VISIBLE, 16, 44, 412, 64, hwnd, ID_HINT).0 as isize,
            code: child(w!("STATIC"), "", WS_CHILD | WS_VISIBLE | style_bits(SS_CENTER), 16, 112, 412, 48, hwnd, ID_CODE).0 as isize,
            open: child(w!("BUTTON"), "Open Radio Net", button, 16, 168, 200, 32, hwnd, ID_OPEN).0 as isize,
            unlink: child(w!("BUTTON"), "Unlink", button, 228, 168, 140, 32, hwnd, ID_UNLINK).0 as isize,
            ptt: row(hwnd, TALK_ROW, ID_PTT_LABEL, ID_PTT_LIGHT, ID_PTT_SET, 220),
            prev: row(hwnd, PREV_ROW, ID_PREV_LABEL, ID_PREV_LIGHT, ID_PREV_SET, 260),
            next: row(hwnd, NEXT_ROW, ID_NEXT_LABEL, ID_NEXT_LIGHT, ID_NEXT_SET, 300),
        };
        let font = GetStockObject(DEFAULT_GUI_FONT);
        let code_font = CreateFontW(-32, 0, 0, 0, FW_BOLD.0 as i32, 0, 0, 0, 0, 0, 0, 0, 0, w!("Segoe UI"));
        let red = CreateSolidBrush(COLORREF(0x000000FF));
        let dim = CreateSolidBrush(COLORREF(0x00B0B0B0));
        *PAINT.lock().unwrap() = Paint { red: red.0 as isize, dim: dim.0 as isize };
        let handles = [
            controls.status, controls.hint, controls.code, controls.open, controls.unlink,
            controls.ptt.label, controls.ptt.set, controls.prev.label, controls.prev.set,
            controls.next.label, controls.next.set,
        ];
        for control in handles {
            let _ = SendMessageW(hwnd_of(control), WM_SETFONT, WPARAM(font.0 as usize), LPARAM(1));
        }
        if !code_font.0.is_null() {
            let _ = SendMessageW(hwnd_of(controls.code), WM_SETFONT, WPARAM(code_font.0 as usize), LPARAM(1));
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

fn row(parent: HWND, title: &str, label: usize, light: usize, set: usize, y: i32) -> Row {
    let button = WS_CHILD | WS_VISIBLE | WS_TABSTOP | style_bits(BS_PUSHBUTTON as u32);
    Row {
        label: child(w!("STATIC"), title, WS_CHILD | WS_VISIBLE, 16, y, 280, 24, parent, label).0 as isize,
        light: child(w!("RadioNetHelperLight"), "", WS_CHILD | style_bits(WS_BORDER.0), 304, y + 2, 20, 20, parent, light).0 as isize,
        set: child(w!("BUTTON"), "Set", button, 332, y - 4, 96, 28, parent, set).0 as isize,
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

fn apply_status(relayout: bool) {
    let status = {
        let guard = STATUS.lock().unwrap();
        StatusCopy {
            linked: guard.linked,
            origin: guard.origin.clone(),
            code: guard.code.clone(),
            binds: guard.binds.clone(),
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
    let show_pair = !status.linked && status.capturing.is_none();
    let hint = if status.capturing.is_some() {
        CAPTURE_HINT
    } else if show_pair {
        "In Radio Net on the website, click Set up push to talk, then Helper app, and enter this code."
    } else {
        ""
    };
    set_text(hwnd_of(controls.hint), hint);
    set_text(hwnd_of(controls.code), &status.code);
    paint_row(&controls.ptt, TALK_ROW, Role::Ptt, &status);
    paint_row(&controls.prev, PREV_ROW, Role::Prev, &status);
    paint_row(&controls.next, NEXT_ROW, Role::Next, &status);
    if relayout {
        let show_hint = !hint.is_empty();
        place(controls.hint, 16, 44, 412, 64, show_hint);
        place(controls.code, 16, 112, 412, 48, show_pair);
        place(controls.open, 16, 168, 200, 32, show_pair);
        let rows_y = if show_pair { 220 } else if show_hint { 120 } else { 48 };
        place_row(&controls.ptt, rows_y);
        place_row(&controls.prev, rows_y + 40);
        place_row(&controls.next, rows_y + 80);
        place(controls.unlink, 16, rows_y + 128, 140, 32, true);
        resize_window(if show_pair { 520 } else if show_hint { 400 } else { 300 });
    }
    for light in [controls.ptt.light, controls.prev.light, controls.next.light] {
        let hwnd = hwnd_of(light);
        unsafe {
            let _ = InvalidateRect(hwnd, None, true);
            let _ = UpdateWindow(hwnd);
        }
    }
    if relayout {
        let raw = HWND_SLOT.load(Ordering::SeqCst);
        if raw != 0 {
            register(HWND(raw as *mut core::ffi::c_void), &status.binds, status.capturing.is_some());
        }
    }
}

fn paint_row(row: &Row, title: &str, role: Role, status: &StatusCopy) {
    let name = match status.binds.get(role) {
        Some(watch) => watch_label(watch),
        None => "not set".into(),
    };
    let text = if status.capturing == Some(role) {
        format!("{title} — press a key")
    } else {
        format!("{title} — {name}")
    };
    set_text(hwnd_of(row.label), &text);
    set_text(hwnd_of(row.set), if status.capturing == Some(role) { "Cancel" } else { "Set" });
}

fn place(raw: isize, x: i32, y: i32, w: i32, h: i32, show: bool) {
    unsafe {
        let _ = ShowWindow(hwnd_of(raw), if show { SW_SHOW } else { SW_HIDE });
        if show {
            let _ = MoveWindow(hwnd_of(raw), x, y, w, h, true);
        }
    }
}

fn place_row(row: &Row, y: i32) {
    place(row.label, 16, y, 280, 24, true);
    place(row.light, 304, y + 2, 20, 20, true);
    place(row.set, 332, y - 4, 96, 28, true);
}

fn resize_window(height: i32) {
    let raw = HWND_SLOT.load(Ordering::SeqCst);
    if raw == 0 {
        return;
    }
    let hwnd = hwnd_of(raw);
    unsafe {
        if IsIconic(hwnd).as_bool() {
            return;
        }
        let _ = SetWindowPos(hwnd, HWND::default(), 0, 0, 460, height, SWP_NOMOVE | SWP_NOZORDER | SWP_NOACTIVATE);
    }
}

struct StatusCopy {
    linked: bool,
    origin: String,
    code: String,
    binds: Binds,
    capturing: Option<Role>,
}

fn toggle_capture(role: Role) {
    {
        let mut status = STATUS.lock().unwrap();
        status.capturing = if status.capturing == Some(role) { None } else { Some(role) };
        if status.capturing.is_none() {
            status.suppress = None;
        }
    }
    apply_status(true);
}

fn unlink_from_window() {
    {
        let mut stored = DEVICE.lock().unwrap();
        stored.forget_link();
        if let Some(path) = DEVICE_PATH.get() {
            let _ = device::save_device(path, &stored);
        }
    }
    let linked = {
        let mut status = STATUS.lock().unwrap();
        status.capturing = None;
        status.held = [false; 3];
        status.suppress = None;
        status.linked
    };
    if linked {
        DROP_LINK.store(true, Ordering::SeqCst);
    } else {
        rotate_code();
    }
    apply_status(true);
}

fn bind_watch(role: Role, watch: Watch) {
    {
        let mut stored = DEVICE.lock().unwrap();
        stored.binds.set(role, watch.clone());
        if let Some(path) = DEVICE_PATH.get() {
            let _ = device::save_device(path, &stored);
        }
    }
    {
        let mut status = STATUS.lock().unwrap();
        status.binds = DEVICE.lock().unwrap().binds.clone();
        status.capturing = None;
        status.suppress = Some(watch);
        status.held = [false; 3];
    }
    apply_status(true);
}

fn open_radio(code: &str) {
    if code.len() != crate::protocol::PAIRING_LEN || !code.bytes().all(|byte| byte.is_ascii_alphanumeric()) {
        return;
    }
    let url = format!("https://tubss2.github.io/radio-net/#h={code}");
    let mut file: Vec<u16> = url.encode_utf16().collect();
    file.push(0);
    unsafe {
        let _ = ShellExecuteW(HWND::default(), w!("open"), PCWSTR(file.as_ptr()), PCWSTR::null(), PCWSTR::null(), SW_SHOWNORMAL);
    }
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
            ID_PTT_SET => toggle_capture(Role::Ptt),
            ID_PREV_SET => toggle_capture(Role::Prev),
            ID_NEXT_SET => toggle_capture(Role::Next),
            ID_UNLINK => unlink_from_window(),
            ID_OPEN => open_radio(&STATUS.lock().unwrap().code),
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

fn light_index(hwnd: HWND) -> Option<usize> {
    match unsafe { GetDlgCtrlID(hwnd) } as usize {
        ID_PTT_LIGHT => Some(0),
        ID_PREV_LIGHT => Some(1),
        ID_NEXT_LIGHT => Some(2),
        _ => None,
    }
}

unsafe extern "system" fn light_proc(hwnd: HWND, msg: u32, wparam: WPARAM, lparam: LPARAM) -> LRESULT {
    if msg == WM_ERASEBKGND {
        return LRESULT(1);
    }
    if msg == WM_PAINT {
        paint_light(hwnd);
        return LRESULT(0);
    }
    DefWindowProcW(hwnd, msg, wparam, lparam)
}

unsafe fn paint_light(hwnd: HWND) {
    let mut ps = PAINTSTRUCT::default();
    let hdc = BeginPaint(hwnd, &mut ps);
    if !hdc.0.is_null() {
        let mut rect = RECT::default();
        let _ = GetClientRect(hwnd, &mut rect);
        let held = light_index(hwnd).is_some_and(|index| STATUS.lock().unwrap().held[index]);
        let paint = PAINT.lock().unwrap();
        let brush = HBRUSH((if held { paint.red } else { paint.dim }) as *mut core::ffi::c_void);
        if !brush.0.is_null() {
            let _ = FillRect(hdc, &rect, brush);
        }
    }
    let _ = EndPaint(hwnd, &ps);
}

/// Raw Input has no per-key registration. The keyboard or mouse device is registered only
/// while a bind uses it (or while Set is waiting). `apply_edge` drops every other key
/// before a light changes or a socket write.
fn register(hwnd: HWND, binds: &Binds, capturing: bool) {
    let mouse = capturing || slot_is_mouse(&binds.ptt) || slot_is_mouse(&binds.prev) || slot_is_mouse(&binds.next);
    let keyboard = capturing || slot_is_key(&binds.ptt) || slot_is_key(&binds.prev) || slot_is_key(&binds.next);
    unsafe {
        let mut list = Vec::new();
        if keyboard {
            list.push(device(0x06, RIDEV_INPUTSINK, hwnd));
        } else {
            list.push(device(0x06, RIDEV_REMOVE, HWND::default()));
        }
        if mouse {
            list.push(device(0x02, RIDEV_INPUTSINK, hwnd));
        } else {
            list.push(device(0x02, RIDEV_REMOVE, HWND::default()));
        }
        let size = std::mem::size_of::<RAWINPUTDEVICE>() as u32;
        let _ = RegisterRawInputDevices(&list, size);
    }
}

fn slot_is_mouse(slot: &Option<Watch>) -> bool {
    matches!(slot, Some(Watch::Mouse { .. }))
}

fn slot_is_key(slot: &Option<Watch>) -> bool {
    matches!(slot, Some(Watch::Key { .. }))
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
    if let Some(role) = capturing {
        let bound = match edge {
            RawEdge::Key { vk, down: true } if (1..0xFF).contains(&vk) => Some(Watch::Key { vk }),
            RawEdge::Mouse { button, down: true } if button == 4 || button == 5 => Some(Watch::Mouse { button }),
            _ => None,
        };
        if let Some(watch) = bound {
            bind_watch(role, watch);
        }
        return;
    }
    if suppressed(&edge) {
        return;
    }
    let physical = match edge {
        RawEdge::Key { vk, down } => Edge::Key { vk, down },
        RawEdge::Mouse { button, down } => Edge::Mouse { button, down },
    };
    let (held, event) = {
        let status = STATUS.lock().unwrap();
        device::apply_edge(&status.binds, status.held, physical)
    };
    let send = {
        let mut status = STATUS.lock().unwrap();
        if status.held == held && event.is_none() {
            return;
        }
        status.held = held;
        event
    };
    // The light updates even when nothing is linked. The socket only gets the abstract action.
    if let Some(event) = send {
        if let Some(tx) = EVENTS.lock().unwrap().as_ref() {
            let _ = tx.send(event);
        }
    }
    apply_status(false);
}

fn suppressed(edge: &RawEdge) -> bool {
    let mut status = STATUS.lock().unwrap();
    let Some(watch) = status.suppress.clone() else { return false };
    let down = match (watch, edge) {
        (Watch::Key { vk }, RawEdge::Key { vk: got, down }) if vk == *got => Some(*down),
        (Watch::Mouse { button }, RawEdge::Mouse { button: got, down }) if button == *got => Some(*down),
        _ => None,
    };
    match down {
        Some(true) => true,
        Some(false) => {
            status.suppress = None;
            true
        }
        None => false,
    }
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

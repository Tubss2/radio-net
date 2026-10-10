//! Long-lived device token. The plaintext token is sent to the page once.
//! This file stores only its SHA-256, plus the keys the window is watching.

use crate::protocol::{parse_hello, parse_linked, Hello, LinkedCommand, OutEvent, Role, Watch};
use sha2::{Digest, Sha256};
use std::fs::OpenOptions;
use std::io::Write;
use std::path::{Path, PathBuf};

pub const TOKEN_BYTES: usize = 32;

/// Push-to-talk, previous channel, and next channel. Defaults are F1, F3, and F4.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Binds {
    pub ptt: Option<Watch>,
    pub prev: Option<Watch>,
    pub next: Option<Watch>,
}

impl Default for Binds {
    fn default() -> Self {
        Self {
            ptt: Some(Watch::Key { vk: 0x70 }),
            prev: Some(Watch::Key { vk: 0x72 }),
            next: Some(Watch::Key { vk: 0x73 }),
        }
    }
}

impl Binds {
    #[cfg_attr(not(windows), allow(dead_code))]
    pub fn get(&self, role: Role) -> Option<&Watch> {
        match role {
            Role::Ptt => self.ptt.as_ref(),
            Role::Prev => self.prev.as_ref(),
            Role::Next => self.next.as_ref(),
        }
    }

    /// One physical key belongs to one row. Binding it again clears the other row.
    pub fn set(&mut self, role: Role, watch: Watch) {
        for slot in [&mut self.ptt, &mut self.prev, &mut self.next] {
            if slot.as_ref() == Some(&watch) {
                *slot = None;
            }
        }
        match role {
            Role::Ptt => self.ptt = Some(watch),
            Role::Prev => self.prev = Some(watch),
            Role::Next => self.next = Some(watch),
        }
    }
}

/// One Raw Input edge after the window has already dropped every other button.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Edge {
    Key { vk: u16, down: bool },
    Mouse { button: u8, down: bool },
}

/// Apply one edge to the three binds.
/// Talk reports on and off. Previous and next report once on the press.
/// The held flags are the red test lights. An unbound key changes nothing and sends nothing.
pub fn apply_edge(binds: &Binds, mut held: [bool; 3], edge: Edge) -> ([bool; 3], Option<OutEvent>) {
    let Some((role, down)) = match_role(binds, &edge) else {
        return (held, None);
    };
    let index = role.index();
    match role {
        Role::Ptt => {
            if held[index] == down {
                return (held, None);
            }
            held[index] = down;
            (held, Some(OutEvent::Ptt(down)))
        }
        Role::Prev | Role::Next => {
            if down {
                if held[index] {
                    return (held, None);
                }
                held[index] = true;
                (held, Some(OutEvent::Tx(role == Role::Next)))
            } else {
                held[index] = false;
                (held, None)
            }
        }
    }
}

fn match_role(binds: &Binds, edge: &Edge) -> Option<(Role, bool)> {
    for role in [Role::Ptt, Role::Prev, Role::Next] {
        let Some(watch) = binds.get(role) else { continue };
        let down = match (watch, edge) {
            (Watch::Key { vk }, Edge::Key { vk: got, down }) if vk == got => Some(*down),
            (Watch::Mouse { button }, Edge::Mouse { button: got, down }) if button == got => Some(*down),
            _ => None,
        };
        if let Some(down) = down {
            return Some((role, down));
        }
    }
    None
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct DeviceState {
    pub token_hash: Option<String>,
    pub binds: Binds,
    /// Old tray builds wrote this. The window build never starts with Windows, and clears the Run key.
    pub autostart: bool,
}

impl Default for DeviceState {
    fn default() -> Self {
        Self { token_hash: None, binds: Binds::default(), autostart: false }
    }
}

impl DeviceState {
    /// Drops the browser token. The keys stay, so Unlink does not forget the bindings.
    pub fn forget_link(&mut self) {
        self.token_hash = None;
    }
}

pub struct Session {
    /// Body of the ok frame. A fresh pair includes the plaintext token. A resume does not.
    pub ok_body: String,
    pub fresh: bool,
}

/// Decide whether this first message may link. Does not write the ok frame.
pub fn authorize(device: &DeviceState, text: &str, expected_code: &str) -> Result<(DeviceState, Session), &'static str> {
    match parse_hello(text, expected_code)? {
        Hello::Pair => {
            let token = device_token();
            let mut next = device.clone();
            next.token_hash = Some(token_hash(&token));
            Ok((next, Session {
                ok_body: format!(r#"{{"t":"ok","token":"{token}"}}"#),
                fresh: true,
            }))
        }
        Hello::Resume { token } => {
            if !accepts_token(device, &token) {
                return Err("denied");
            }
            Ok((device.clone(), Session {
                ok_body: r#"{"t":"ok"}"#.into(),
                fresh: false,
            }))
        }
    }
}

#[cfg_attr(not(test), allow(dead_code))]
pub fn apply_linked(device: &mut DeviceState, text: &str) -> Result<LinkedCommand, &'static str> {
    let command = parse_linked(text)?;
    device.forget_link();
    Ok(command)
}

pub fn device_token() -> String {
    let mut bytes = [0u8; TOKEN_BYTES];
    getrandom::getrandom(&mut bytes).expect("os random");
    base64url(&bytes)
}

pub fn token_hash(token: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(token.as_bytes());
    hex(&hasher.finalize())
}

fn accepts_token(device: &DeviceState, token: &str) -> bool {
    if !token_shape_ok(token) {
        return false;
    }
    let got = token_hash(token);
    match &device.token_hash {
        Some(stored) => ct_eq(got.as_bytes(), stored.as_bytes()),
        None => {
            let _ = ct_eq(got.as_bytes(), b"0000000000000000000000000000000000000000000000000000000000000000");
            false
        }
    }
}

pub fn token_shape_ok(token: &str) -> bool {
    token.len() == 43 && token.bytes().all(|byte| byte.is_ascii_alphanumeric() || byte == b'-' || byte == b'_')
}

fn ct_eq(a: &[u8], b: &[u8]) -> bool {
    if a.len() != b.len() {
        return false;
    }
    let mut diff = 0u8;
    for (left, right) in a.iter().zip(b.iter()) {
        diff |= left ^ right;
    }
    diff == 0
}

fn base64url(bytes: &[u8]) -> String {
    const TABLE: &[u8] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
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
    } else if bytes.len() - index == 2 {
        let n = ((bytes[index] as u32) << 16) | ((bytes[index + 1] as u32) << 8);
        out.push(TABLE[((n >> 18) & 63) as usize] as char);
        out.push(TABLE[((n >> 12) & 63) as usize] as char);
        out.push(TABLE[((n >> 6) & 63) as usize] as char);
    }
    out
}

fn hex(bytes: &[u8]) -> String {
    const TABLE: &[u8] = b"0123456789abcdef";
    let mut out = String::with_capacity(bytes.len() * 2);
    for byte in bytes {
        out.push(TABLE[(byte >> 4) as usize] as char);
        out.push(TABLE[(byte & 0xf) as usize] as char);
    }
    out
}

pub fn encode_state(state: &DeviceState) -> String {
    let hash = match &state.token_hash {
        Some(value) => format!("\"{value}\""),
        None => "null".into(),
    };
    let ptt = encode_slot(&state.binds.ptt);
    let prev = encode_slot(&state.binds.prev);
    let next = encode_slot(&state.binds.next);
    let autostart = if state.autostart { "true" } else { "false" };
    format!(r#"{{"v":2,"tokenHash":{hash},"ptt":{ptt},"prev":{prev},"next":{next},"autostart":{autostart}}}"#)
}

fn encode_slot(watch: &Option<Watch>) -> String {
    match watch {
        Some(Watch::Key { vk }) => format!(r#"{{"kind":"key","vk":{vk}}}"#),
        Some(Watch::Mouse { button }) => format!(r#"{{"kind":"mouse","button":{button}}}"#),
        None => "null".into(),
    }
}

pub fn decode_state(json: &str) -> Result<DeviceState, &'static str> {
    let token_hash = match crate::protocol::json_string(json, "tokenHash") {
        Some(value) if value.len() == 64 && value.bytes().all(|byte| byte.is_ascii_hexdigit()) => Some(value),
        Some(_) => return Err("bad hash"),
        None => None,
    };
    let binds = if json.contains("\"ptt\"") {
        Binds {
            ptt: decode_slot(json, "ptt")?,
            prev: decode_slot(json, "prev")?,
            next: decode_slot(json, "next")?,
        }
    } else if json.contains("\"watch\"") && !json.contains(r#""watch":null"#) {
        let raw = crate::protocol::object_after(json, "watch").ok_or("bad watch")?;
        let mut binds = Binds::default();
        binds.set(Role::Ptt, crate::protocol::parse_watch(raw)?);
        binds
    } else {
        Binds::default()
    };
    let autostart = json.contains(r#""autostart":true"#);
    Ok(DeviceState { token_hash, binds, autostart })
}

fn decode_slot(json: &str, key: &str) -> Result<Option<Watch>, &'static str> {
    let null = format!("\"{key}\":null");
    if json.contains(&null) {
        return Ok(None);
    }
    let pattern = format!("\"{key}\":");
    if !json.contains(&pattern) {
        return Ok(match key {
            "ptt" => Binds::default().ptt,
            "prev" => Binds::default().prev,
            "next" => Binds::default().next,
            _ => None,
        });
    }
    let raw = crate::protocol::object_after(json, key).ok_or("bad watch")?;
    Ok(Some(crate::protocol::parse_watch(raw)?))
}

/// `%APPDATA%\RadioNet\helper-device.bin` on Windows. Tests pass their own path.
pub fn default_device_path() -> PathBuf {
    let base = std::env::var_os("APPDATA")
        .map(PathBuf::from)
        .or_else(|| std::env::var_os("HOME").map(|home| PathBuf::from(home).join(".config")))
        .unwrap_or_else(|| PathBuf::from("."));
    base.join("RadioNet").join("helper-device.bin")
}

pub fn load_device(path: &Path) -> DeviceState {
    let bytes = match std::fs::read(path) {
        Ok(bytes) => bytes,
        Err(_) => return DeviceState::default(),
    };
    let plain = unseal(&bytes);
    let text = String::from_utf8(plain).unwrap_or_default();
    decode_state(&text).unwrap_or_default()
}

pub fn save_device(path: &Path, state: &DeviceState) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|err| err.to_string())?;
    }
    let bytes = seal(encode_state(state).as_bytes())?;
    let tmp = path.with_extension("tmp");
    {
        let mut opts = OpenOptions::new();
        opts.write(true).create(true).truncate(true);
        #[cfg(unix)]
        {
            use std::os::unix::fs::OpenOptionsExt;
            opts.mode(0o600);
        }
        let mut file = opts.open(&tmp).map_err(|err| err.to_string())?;
        file.write_all(&bytes).map_err(|err| err.to_string())?;
    }
    std::fs::rename(&tmp, path).map_err(|err| err.to_string())?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o600));
    }
    Ok(())
}

fn seal(plain: &[u8]) -> Result<Vec<u8>, String> {
    #[cfg(windows)]
    {
        // Fail closed. A hash written in the clear is still not the token, but the file is supposed to be sealed.
        return seal_dpapi(plain);
    }
    #[cfg(not(windows))]
    {
        Ok(plain.to_vec())
    }
}

fn unseal(bytes: &[u8]) -> Vec<u8> {
    #[cfg(windows)]
    {
        if let Ok(plain) = unseal_dpapi(bytes) {
            return plain;
        }
    }
    bytes.to_vec()
}

#[cfg(windows)]
fn seal_dpapi(plain: &[u8]) -> Result<Vec<u8>, String> {
    use std::ptr;
    use windows::Win32::Foundation::LocalFree;
    use windows::Win32::Security::Cryptography::{CryptProtectData, CRYPT_INTEGER_BLOB, CRYPTPROTECT_UI_FORBIDDEN};
    unsafe {
        let input = CRYPT_INTEGER_BLOB {
            cbData: plain.len() as u32,
            pbData: plain.as_ptr() as *mut u8,
        };
        let mut output = CRYPT_INTEGER_BLOB { cbData: 0, pbData: ptr::null_mut() };
        CryptProtectData(&input, None, None, None, None, CRYPTPROTECT_UI_FORBIDDEN, &mut output)
            .map_err(|err| err.to_string())?;
        let sealed = std::slice::from_raw_parts(output.pbData, output.cbData as usize).to_vec();
        let _ = LocalFree(windows::Win32::Foundation::HLOCAL(output.pbData as *mut _));
        let _ = input;
        Ok(sealed)
    }
}

#[cfg(windows)]
fn unseal_dpapi(bytes: &[u8]) -> Result<Vec<u8>, String> {
    use std::ptr;
    use windows::Win32::Foundation::LocalFree;
    use windows::Win32::Security::Cryptography::{CryptUnprotectData, CRYPT_INTEGER_BLOB, CRYPTPROTECT_UI_FORBIDDEN};
    unsafe {
        let input = CRYPT_INTEGER_BLOB {
            cbData: bytes.len() as u32,
            pbData: bytes.as_ptr() as *mut u8,
        };
        let mut output = CRYPT_INTEGER_BLOB { cbData: 0, pbData: ptr::null_mut() };
        CryptUnprotectData(&input, None, None, None, None, CRYPTPROTECT_UI_FORBIDDEN, &mut output)
            .map_err(|err| err.to_string())?;
        let plain = std::slice::from_raw_parts(output.pbData, output.cbData as usize).to_vec();
        let _ = LocalFree(windows::Win32::Foundation::HLOCAL(output.pbData as *mut _));
        let _ = input;
        Ok(plain)
    }
}

/// Old tray builds used this Run-key name. The window build deletes it on startup.
pub const AUTOSTART_VALUE: &str = "RadioNetHelper";

#[cfg(test)]
mod tests {
    use super::*;
    use crate::protocol::{event_message, Role, Watch};

    #[test]
    fn token_is_32_bytes_and_the_file_keeps_only_the_hash() {
        assert_eq!(device_token().len(), 43);
        let mut device = DeviceState::default();
        assert!(!device.autostart);
        let text = r#"{"t":"pair","code":"K7QM2P"}"#;
        let (next, session) = authorize(&device, text, "K7QM2P").unwrap();
        assert!(session.fresh);
        assert!(session.ok_body.contains(&token_shape_from(&session.ok_body)));
        assert!(!session.ok_body.contains("F1"));
        device = next;
        assert!(!encode_state(&device).contains(&token_shape_from(&session.ok_body)));
        let saved = encode_state(&device);
        assert!(saved.contains("tokenHash"));
        assert_eq!(decode_state(&saved).unwrap().binds.ptt, Some(Watch::Key { vk: 0x70 }));
        assert_eq!(decode_state(&saved).unwrap().binds.prev, Some(Watch::Key { vk: 0x72 }));
        assert_eq!(decode_state(&saved).unwrap().binds.next, Some(Watch::Key { vk: 0x73 }));

        let resume = format!(r#"{{"t":"resume","token":"{}"}}"#, token_shape_from(&session.ok_body));
        let (same, again) = authorize(&device, &resume, "UNUSED").unwrap();
        assert!(!again.fresh);
        assert_eq!(again.ok_body, r#"{"t":"ok"}"#);
        assert_eq!(same.token_hash, device.token_hash);

        assert!(authorize(&device, r#"{"t":"resume","token":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"}"#, "K7QM2P").is_err());
        assert!(apply_linked(&mut device, r#"{"t":"watch","watch":{"kind":"mouse","button":5}}"#).is_err());
        device.binds.set(Role::Ptt, Watch::Mouse { button: 5 });
        assert_eq!(device.binds.ptt, Some(Watch::Mouse { button: 5 }));
        apply_linked(&mut device, r#"{"t":"forget"}"#).unwrap();
        assert!(device.token_hash.is_none());
        assert_eq!(device.binds.ptt, Some(Watch::Mouse { button: 5 }));
        assert!(authorize(&device, &resume, "K7QM2P").is_err());

        let legacy = r#"{"v":1,"tokenHash":null,"watch":{"kind":"key","vk":75},"autostart":false}"#;
        let migrated = decode_state(legacy).unwrap();
        assert_eq!(migrated.binds.ptt, Some(Watch::Key { vk: 75 }));
        assert_eq!(migrated.binds.prev, Some(Watch::Key { vk: 0x72 }));
        assert_eq!(migrated.binds.next, Some(Watch::Key { vk: 0x73 }));
        let was_f3 = r#"{"v":1,"tokenHash":null,"watch":{"kind":"key","vk":114},"autostart":false}"#;
        let moved = decode_state(was_f3).unwrap();
        assert_eq!(moved.binds.ptt, Some(Watch::Key { vk: 0x72 }));
        assert_eq!(moved.binds.prev, None);
    }

    fn token_shape_from(ok_body: &str) -> String {
        let marker = r#""token":""#;
        let start = ok_body.find(marker).unwrap() + marker.len();
        ok_body[start..].trim_end_matches("}").trim_end_matches('"').to_string()
    }

    #[test]
    fn round_trips_a_user_only_file_without_the_token() {
        let dir = std::env::temp_dir().join(format!("radionet-helper-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("helper-device.bin");
        let token = device_token();
        let mut state = DeviceState {
            token_hash: Some(token_hash(&token)),
            binds: Binds::default(),
            autostart: false,
        };
        state.binds.set(Role::Next, Watch::Key { vk: 0x20 });
        save_device(&path, &state).unwrap();
        let raw = std::fs::read(&path).unwrap();
        let text = String::from_utf8_lossy(&raw);
        assert!(!text.contains(&token));
        assert_eq!(load_device(&path).binds.next, Some(Watch::Key { vk: 0x20 }));
        assert_eq!(load_device(&path).binds.ptt, Some(Watch::Key { vk: 0x70 }));
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let mode = std::fs::metadata(&path).unwrap().permissions().mode();
            assert_eq!(mode & 0o777, 0o600);
        }
        let _ = std::fs::remove_dir_all(&dir);
        assert!(default_device_path().ends_with("helper-device.bin"));
        assert_eq!(AUTOSTART_VALUE, "RadioNetHelper");
    }

    #[test]
    fn talk_is_f1_previous_is_f3_next_is_f4_and_other_keys_stay_dark() {
        let binds = Binds::default();
        assert_eq!(binds.ptt, Some(Watch::Key { vk: 0x70 }));
        assert_eq!(binds.prev, Some(Watch::Key { vk: 0x72 }));
        assert_eq!(binds.next, Some(Watch::Key { vk: 0x73 }));

        let (held, event) = apply_edge(&binds, [false; 3], Edge::Key { vk: 0x70, down: true });
        assert_eq!(held, [true, false, false]);
        assert_eq!(event, Some(OutEvent::Ptt(true)));
        assert_eq!(event_message(event.unwrap()), r#"{"t":"ptt","v":"down"}"#);
        assert!(!event_message(event.unwrap()).contains("F1"));

        let (held, event) = apply_edge(&binds, held, Edge::Key { vk: 0x70, down: true });
        assert_eq!(event, None);
        assert_eq!(held[0], true);

        let (held, event) = apply_edge(&binds, held, Edge::Key { vk: 0x70, down: false });
        assert_eq!(held, [false, false, false]);
        assert_eq!(event, Some(OutEvent::Ptt(false)));

        let (held, event) = apply_edge(&binds, [false; 3], Edge::Key { vk: 0x72, down: true });
        assert_eq!(held, [false, true, false]);
        assert_eq!(event_message(event.unwrap()), r#"{"t":"tx","v":"prev"}"#);
        let (held, event) = apply_edge(&binds, held, Edge::Key { vk: 0x72, down: false });
        assert_eq!(held[1], false);
        assert_eq!(event, None);

        let (held, event) = apply_edge(&binds, [false; 3], Edge::Key { vk: 0x73, down: true });
        assert_eq!(held, [false, false, true]);
        assert_eq!(event_message(event.unwrap()), r#"{"t":"tx","v":"next"}"#);
        let (_, again) = apply_edge(&binds, held, Edge::Key { vk: 0x73, down: true });
        assert_eq!(again, None);

        // F2 is the desktop channel wheel. F10 hides the overlay. Neither is a helper bind.
        for vk in [0x71u16, 0x79] {
            let (held, event) = apply_edge(&binds, [false; 3], Edge::Key { vk, down: true });
            assert_eq!(held, [false; 3]);
            assert_eq!(event, None);
        }
        let (held, event) = apply_edge(&binds, [false; 3], Edge::Key { vk: b'A' as u16, down: true });
        assert_eq!(event, None);
        assert_eq!(held, [false; 3]);
        let (held, event) = apply_edge(&binds, [false; 3], Edge::Mouse { button: 1, down: true });
        assert_eq!(event, None);
        assert_eq!(held, [false; 3]);

        let mut custom = binds;
        custom.set(Role::Ptt, Watch::Mouse { button: 5 });
        let (held, event) = apply_edge(&custom, [false; 3], Edge::Key { vk: 0x70, down: true });
        assert_eq!(event, None);
        assert_eq!(held, [false; 3]);
        let (held, event) = apply_edge(&custom, [false; 3], Edge::Mouse { button: 5, down: true });
        assert_eq!(held[0], true);
        assert_eq!(event, Some(OutEvent::Ptt(true)));
        assert_eq!(custom.prev, Some(Watch::Key { vk: 0x72 }));
        assert_eq!(custom.next, Some(Watch::Key { vk: 0x73 }));
    }
}

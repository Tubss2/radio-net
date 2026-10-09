//! Long-lived device token. The plaintext token is sent to the page once.
//! This file stores only its SHA-256, plus the one watched key.

use crate::protocol::{parse_hello, parse_linked, Hello, LinkedCommand, Watch};
use sha2::{Digest, Sha256};
use std::fs::OpenOptions;
use std::io::Write;
use std::path::{Path, PathBuf};

pub const TOKEN_BYTES: usize = 32;

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct DeviceState {
    pub token_hash: Option<String>,
    pub watch: Option<Watch>,
    /// Tray toggle. Off unless the user turns it on. Unlink does not change it.
    pub autostart: bool,
}

impl Default for DeviceState {
    fn default() -> Self {
        Self { token_hash: None, watch: None, autostart: false }
    }
}

impl DeviceState {
    pub fn forget_link(&mut self) {
        self.token_hash = None;
        self.watch = None;
    }
}

pub struct Session {
    pub watch: Watch,
    /// Body of the ok frame. A fresh pair includes the plaintext token. A resume does not.
    pub ok_body: String,
    pub fresh: bool,
}

/// Decide whether this first message may link. Does not write the ok frame.
pub fn authorize(device: &DeviceState, text: &str, expected_code: &str) -> Result<(DeviceState, Session), &'static str> {
    match parse_hello(text, expected_code)? {
        Hello::Pair { watch } => {
            let token = device_token();
            let mut next = device.clone();
            next.token_hash = Some(token_hash(&token));
            next.watch = Some(watch.clone());
            Ok((next, Session {
                watch,
                ok_body: format!(r#"{{"t":"ok","token":"{token}"}}"#),
                fresh: true,
            }))
        }
        Hello::Resume { token } => {
            if !accepts_token(device, &token) {
                return Err("denied");
            }
            let watch = device.watch.clone().ok_or("denied")?;
            Ok((device.clone(), Session {
                watch,
                ok_body: r#"{"t":"ok"}"#.into(),
                fresh: false,
            }))
        }
    }
}

#[cfg_attr(not(test), allow(dead_code))]
pub fn apply_linked(device: &mut DeviceState, text: &str) -> Result<LinkedCommand, &'static str> {
    let command = parse_linked(text)?;
    match &command {
        LinkedCommand::Forget => device.forget_link(),
        LinkedCommand::Watch(watch) => device.watch = Some(watch.clone()),
    }
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
    let watch = match &state.watch {
        Some(Watch::Key { vk }) => format!(r#"{{"kind":"key","vk":{vk}}}"#),
        Some(Watch::Mouse { button }) => format!(r#"{{"kind":"mouse","button":{button}}}"#),
        None => "null".into(),
    };
    let autostart = if state.autostart { "true" } else { "false" };
    format!(r#"{{"v":1,"tokenHash":{hash},"watch":{watch},"autostart":{autostart}}}"#)
}

pub fn decode_state(json: &str) -> Result<DeviceState, &'static str> {
    let token_hash = match crate::protocol::json_string(json, "tokenHash") {
        Some(value) if value.len() == 64 && value.bytes().all(|byte| byte.is_ascii_hexdigit()) => Some(value),
        Some(_) => return Err("bad hash"),
        None => None,
    };
    let watch = if json.contains(r#""watch":null"#) {
        None
    } else {
        let raw = crate::protocol::object_after(json, "watch").ok_or("bad watch")?;
        Some(crate::protocol::parse_watch(raw)?)
    };
    let autostart = json.contains(r#""autostart":true"#);
    Ok(DeviceState { token_hash, watch, autostart })
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

/// Registry value under `HKCU\...\Run`. Absent unless the user turns the tray toggle on.
pub const AUTOSTART_VALUE: &str = "RadioNetHelper";

#[cfg(test)]
mod tests {
    use super::*;
    use crate::protocol::Watch;

    #[test]
    fn token_is_32_bytes_and_the_file_keeps_only_the_hash() {
        assert_eq!(device_token().len(), 43);
        let mut device = DeviceState::default();
        assert!(!device.autostart);
        let text = r#"{"t":"pair","code":"K7QM2P","watch":{"kind":"key","code":"KeyK"}}"#;
        let (next, session) = authorize(&device, text, "K7QM2P").unwrap();
        assert!(session.fresh);
        assert!(session.ok_body.contains(&token_shape_from(&session.ok_body)));
        assert!(!session.ok_body.contains("KeyK"));
        device = next;
        assert!(!encode_state(&device).contains(&token_shape_from(&session.ok_body)));
        let saved = encode_state(&device);
        assert!(saved.contains("tokenHash"));
        assert_eq!(decode_state(&saved).unwrap().watch, Some(Watch::Key { vk: b'K' as u16 }));

        let resume = format!(r#"{{"t":"resume","token":"{}"}}"#, token_shape_from(&session.ok_body));
        let (same, again) = authorize(&device, &resume, "UNUSED").unwrap();
        assert!(!again.fresh);
        assert_eq!(again.ok_body, r#"{"t":"ok"}"#);
        assert_eq!(again.watch, Watch::Key { vk: b'K' as u16 });
        assert_eq!(same.token_hash, device.token_hash);

        assert!(authorize(&device, r#"{"t":"resume","token":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"}"#, "K7QM2P").is_err());
        apply_linked(&mut device, r#"{"t":"watch","watch":{"kind":"mouse","button":5}}"#).unwrap();
        assert_eq!(device.watch, Some(Watch::Mouse { button: 5 }));
        apply_linked(&mut device, r#"{"t":"forget"}"#).unwrap();
        assert!(device.token_hash.is_none());
        assert!(device.watch.is_none());
        assert!(authorize(&device, &resume, "K7QM2P").is_err());
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
        let state = DeviceState {
            token_hash: Some(token_hash(&token)),
            watch: Some(Watch::Key { vk: 0x20 }),
            autostart: false,
        };
        save_device(&path, &state).unwrap();
        let raw = std::fs::read(&path).unwrap();
        let text = String::from_utf8_lossy(&raw);
        assert!(!text.contains(&token));
        assert_eq!(load_device(&path).watch, Some(Watch::Key { vk: 0x20 }));
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
}

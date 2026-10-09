//! Pairing messages and the localhost origin check. No keystrokes are parsed here.

const PAGES_ORIGIN: &str = "https://tubss2.github.io";

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Watch {
    Key { vk: u16 },
    Mouse { button: u8 },
}

/// Browser `Origin` values the helper will upgrade. Anything else is refused.
pub fn origin_allowed(origin: &str) -> bool {
    if origin == PAGES_ORIGIN {
        return true;
    }
    let Some(rest) = origin.strip_prefix("http://") else {
        return false;
    };
    let host = rest.split('/').next().unwrap_or("");
    let host = host.split(':').next().unwrap_or("");
    host == "localhost" || host == "127.0.0.1"
}

/// `KeyboardEvent.code` or a mouse button of 4 or 5 (side buttons).
pub fn parse_pair(text: &str, expected_code: &str) -> Result<Watch, &'static str> {
    let text = text.trim();
    let code = json_string(text, "code").ok_or("bad pair")?;
    if code != expected_code {
        return Err("bad code");
    }
    let watch = object_after(text, "watch").ok_or("bad pair")?;
    let kind = json_string(watch, "kind").ok_or("bad pair")?;
    if kind == "mouse" {
        let button = json_number(watch, "button").ok_or("bad pair")?;
        if button != 4 && button != 5 {
            return Err("unsupported button");
        }
        return Ok(Watch::Mouse { button: button as u8 });
    }
    if kind == "key" {
        let dom = json_string(watch, "code").ok_or("bad pair")?;
        let vk = dom_code_to_vk(&dom).ok_or("unsupported key")?;
        return Ok(Watch::Key { vk });
    }
    Err("bad pair")
}

pub fn frame_text(payload: &str) -> Vec<u8> {
    let bytes = payload.as_bytes();
    let mut out = Vec::with_capacity(bytes.len() + 4);
    out.push(0x81);
    if bytes.len() < 126 {
        out.push(bytes.len() as u8);
    } else {
        out.push(126);
        out.extend_from_slice(&(bytes.len() as u16).to_be_bytes());
    }
    out.extend_from_slice(bytes);
    out
}

/// Unmask one client text frame. Returns the text and the number of bytes consumed.
pub fn read_client_frame(buf: &[u8]) -> Result<(String, usize), &'static str> {
    if buf.len() < 2 {
        return Err("short");
    }
    let opcode = buf[0] & 0x0f;
    if opcode == 0x8 {
        return Err("closed");
    }
    if opcode != 0x1 {
        return Err("unsupported");
    }
    let masked = buf[1] & 0x80 != 0;
    if !masked {
        return Err("unmasked");
    }
    let mut len = (buf[1] & 0x7f) as usize;
    let mut offset = 2;
    if len == 126 {
        if buf.len() < 4 {
            return Err("short");
        }
        len = u16::from_be_bytes([buf[2], buf[3]]) as usize;
        offset = 4;
    } else if len == 127 {
        return Err("too big");
    }
    if len > 512 {
        return Err("too big");
    }
    if buf.len() < offset + 4 + len {
        return Err("short");
    }
    let mask = &buf[offset..offset + 4];
    offset += 4;
    let mut text = Vec::with_capacity(len);
    for i in 0..len {
        text.push(buf[offset + i] ^ mask[i % 4]);
    }
    let text = String::from_utf8(text).map_err(|_| "bad utf8")?;
    Ok((text, offset + len))
}

fn json_string(json: &str, key: &str) -> Option<String> {
    let pattern = format!("\"{key}\"");
    let start = json.find(&pattern)? + pattern.len();
    let rest = json[start..].trim_start();
    let rest = rest.strip_prefix(':')?.trim_start();
    let rest = rest.strip_prefix('"')?;
    let mut out = String::new();
    let mut chars = rest.chars();
    while let Some(ch) = chars.next() {
        if ch == '\\' {
            out.push(chars.next()?);
            continue;
        }
        if ch == '"' {
            return Some(out);
        }
        out.push(ch);
    }
    None
}

fn json_number(json: &str, key: &str) -> Option<u32> {
    let pattern = format!("\"{key}\"");
    let start = json.find(&pattern)? + pattern.len();
    let rest = json[start..].trim_start().strip_prefix(':')?.trim_start();
    let digits: String = rest.chars().take_while(|ch| ch.is_ascii_digit()).collect();
    digits.parse().ok()
}

fn object_after<'a>(json: &'a str, key: &str) -> Option<&'a str> {
    let pattern = format!("\"{key}\"");
    let start = json.find(&pattern)? + pattern.len();
    let rest = json[start..].trim_start().strip_prefix(':')?.trim_start();
    let brace = rest.find('{')?;
    Some(&rest[brace..])
}

pub fn dom_code_to_vk(code: &str) -> Option<u16> {
    if code == "Space" {
        return Some(0x20);
    }
    if let Some(letter) = code.strip_prefix("Key") {
        let bytes = letter.as_bytes();
        if bytes.len() == 1 && bytes[0].is_ascii_uppercase() {
            return Some(bytes[0] as u16);
        }
    }
    if let Some(digit) = code.strip_prefix("Digit") {
        let bytes = digit.as_bytes();
        if bytes.len() == 1 && bytes[0].is_ascii_digit() {
            return Some(bytes[0] as u16);
        }
    }
    if let Some(num) = code.strip_prefix('F') {
        if let Ok(n) = num.parse::<u16>() {
            if (1..=12).contains(&n) {
                return Some(0x70 + n - 1);
            }
        }
    }
    Some(match code {
        "Enter" => 0x0D,
        "Escape" => 0x1B,
        "Tab" => 0x09,
        "Backspace" => 0x08,
        "ShiftLeft" | "ShiftRight" => 0x10,
        "ControlLeft" | "ControlRight" => 0x11,
        "AltLeft" | "AltRight" => 0x12,
        "ArrowLeft" => 0x25,
        "ArrowUp" => 0x26,
        "ArrowRight" => 0x27,
        "ArrowDown" => 0x28,
        "Minus" => 0xBD,
        "Equal" => 0xBB,
        "Backquote" => 0xC0,
        "BracketLeft" => 0xDB,
        "BracketRight" => 0xDD,
        "Backslash" => 0xDC,
        "Semicolon" => 0xBA,
        "Quote" => 0xDE,
        "Comma" => 0xBC,
        "Period" => 0xBE,
        "Slash" => 0xBF,
        _ => return None,
    })
}

pub fn pairing_code() -> String {
    const ALPHABET: &[u8] = b"ABCDEFGHJKMNPQRSTUVWXYZ23456789";
    let mut bytes = [0u8; 6];
    get_random(&mut bytes);
    bytes.into_iter().map(|b| ALPHABET[(b as usize) % ALPHABET.len()] as char).collect()
}

fn get_random(buf: &mut [u8]) {
    getrandom::getrandom(buf).expect("os random");
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn allows_pages_and_local_dev_only() {
        assert!(origin_allowed("https://tubss2.github.io"));
        assert!(origin_allowed("http://127.0.0.1:5175"));
        assert!(origin_allowed("http://localhost:5175"));
        assert!(!origin_allowed("https://tubss2.github.io.evil.com"));
        assert!(!origin_allowed("https://evil.example"));
        assert!(!origin_allowed("http://127.0.0.1.evil.com"));
    }

    #[test]
    fn pairs_a_key_or_side_button_and_rejects_other_buttons() {
        let key = r#"{"t":"pair","code":"K7QM2P","watch":{"kind":"key","code":"KeyK"}}"#;
        assert_eq!(parse_pair(key, "K7QM2P").unwrap(), Watch::Key { vk: b'K' as u16 });
        let mouse = r#"{"t":"pair","code":"K7QM2P","watch":{"kind":"mouse","button":4}}"#;
        assert_eq!(parse_pair(mouse, "K7QM2P").unwrap(), Watch::Mouse { button: 4 });
        assert_eq!(parse_pair(mouse, "OTHER").unwrap_err(), "bad code");
        let left = r#"{"t":"pair","code":"K7QM2P","watch":{"kind":"mouse","button":1}}"#;
        assert_eq!(parse_pair(left, "K7QM2P").unwrap_err(), "unsupported button");
        assert_eq!(dom_code_to_vk("Space"), Some(0x20));
        assert_eq!(dom_code_to_vk("F2"), Some(0x71));
    }

    #[test]
    fn reads_a_masked_text_frame() {
        let payload = br#"{"t":"pair"}"#;
        let mask = [1u8, 2, 3, 4];
        let mut frame = vec![0x81, 0x80 | payload.len() as u8];
        frame.extend_from_slice(&mask);
        for (i, byte) in payload.iter().enumerate() {
            frame.push(byte ^ mask[i % 4]);
        }
        let (text, used) = read_client_frame(&frame).unwrap();
        assert_eq!(text, r#"{"t":"pair"}"#);
        assert_eq!(used, frame.len());
        let packed = frame_text(r#"{"t":"ok"}"#);
        assert_eq!(packed[0], 0x81);
        assert_eq!(&packed[2..], br#"{"t":"ok"}"#);
    }
}

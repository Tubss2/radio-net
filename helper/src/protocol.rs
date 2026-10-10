//! Pairing messages and the localhost origin check. No keystrokes are parsed here.

const PAGES_ORIGIN: &str = "https://tubss2.github.io";

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Watch {
    Key { vk: u16 },
    Mouse { button: u8 },
}

/// Which helper binding a key belongs to. The page never sees the key itself.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
#[cfg_attr(not(windows), allow(dead_code))]
pub enum Role {
    Ptt,
    Prev,
    Next,
}

impl Role {
    pub fn index(self) -> usize {
        match self {
            Role::Ptt => 0,
            Role::Prev => 1,
            Role::Next => 2,
        }
    }
}

/// Labels on the helper window. The talk row is "Talk", not a watched-key list.
pub const TALK_ROW: &str = "Talk";
pub const PREV_ROW: &str = "Previous channel";
pub const NEXT_ROW: &str = "Next channel";

/// Shown while Set is waiting. A mouse button still binds if one is pressed. The window does not mention that.
pub const CAPTURE_HINT: &str = "Press a key.";

/// What the helper tells the page. These names are actions, not key codes.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum OutEvent {
    Ptt(bool),
    /// `true` is the next transmit channel. `false` is the previous one.
    Tx(bool),
}

pub fn event_message(event: OutEvent) -> &'static str {
    match event {
        OutEvent::Ptt(true) => r#"{"t":"ptt","v":"down"}"#,
        OutEvent::Ptt(false) => r#"{"t":"ptt","v":"up"}"#,
        OutEvent::Tx(true) => r#"{"t":"tx","v":"next"}"#,
        OutEvent::Tx(false) => r#"{"t":"tx","v":"prev"}"#,
    }
}

/// Short name for the helper window. Letters use the virtual-key code, which matches `KeyK` style DOM codes.
pub fn watch_label(watch: &Watch) -> String {
    match watch {
        Watch::Mouse { button } => format!("Mouse {button}"),
        Watch::Key { vk } => vk_label(*vk),
    }
}

/// Inverse of [`dom_code_to_vk`] for labels in the helper window. Left/right modifiers share one virtual key.
#[cfg_attr(not(test), allow(dead_code))]
pub fn dom_code_for_vk(vk: u16) -> Option<String> {
    Some(match vk {
        0x08 => "Backspace".into(),
        0x09 => "Tab".into(),
        0x0D => "Enter".into(),
        0x10 => "ShiftLeft".into(),
        0x11 => "ControlLeft".into(),
        0x12 => "AltLeft".into(),
        0x1B => "Escape".into(),
        0x20 => "Space".into(),
        0x25 => "ArrowLeft".into(),
        0x26 => "ArrowUp".into(),
        0x27 => "ArrowRight".into(),
        0x28 => "ArrowDown".into(),
        0xBA => "Semicolon".into(),
        0xBB => "Equal".into(),
        0xBC => "Comma".into(),
        0xBD => "Minus".into(),
        0xBE => "Period".into(),
        0xBF => "Slash".into(),
        0xC0 => "Backquote".into(),
        0xDB => "BracketLeft".into(),
        0xDC => "Backslash".into(),
        0xDD => "BracketRight".into(),
        0xDE => "Quote".into(),
        value if (b'0' as u16..=b'9' as u16).contains(&value) => format!("Digit{}", char::from(value as u8)),
        value if (b'A' as u16..=b'Z' as u16).contains(&value) => format!("Key{}", char::from(value as u8)),
        value if (0x70..=0x7B).contains(&value) => format!("F{}", value - 0x6F),
        _ => return None,
    })
}

fn vk_label(vk: u16) -> String {
    match vk {
        0x08 => "Backspace".into(),
        0x09 => "Tab".into(),
        0x0D => "Enter".into(),
        0x10 => "Shift".into(),
        0x11 => "Ctrl".into(),
        0x12 => "Alt".into(),
        0x1B => "Esc".into(),
        0x20 => "Space".into(),
        0x25 => "Left".into(),
        0x26 => "Up".into(),
        0x27 => "Right".into(),
        0x28 => "Down".into(),
        0xBA => ";".into(),
        0xBB => "=".into(),
        0xBC => ",".into(),
        0xBD => "-".into(),
        0xBE => ".".into(),
        0xBF => "/".into(),
        0xC0 => "`".into(),
        0xDB => "[".into(),
        0xDC => "\\".into(),
        0xDD => "]".into(),
        0xDE => "'".into(),
        value if (b'0' as u16..=b'9' as u16).contains(&value) => char::from(value as u8).to_string(),
        value if (b'A' as u16..=b'Z' as u16).contains(&value) => char::from(value as u8).to_string(),
        value if (0x70..=0x7B).contains(&value) => format!("F{}", value - 0x6F),
        value => format!("VK {value}"),
    }
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

/// The pairing message is the code only. A key name in this message is refused.
pub fn parse_pair(text: &str, expected_code: &str) -> Result<(), &'static str> {
    let text = text.trim();
    if text.contains("\"watch\"") || text.contains("\"vk\"") || text.contains("\"button\"") {
        return Err("bad pair");
    }
    let code = json_string(text, "code").ok_or("bad pair")?;
    if code != expected_code {
        return Err("bad code");
    }
    Ok(())
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

pub(crate) fn json_string(json: &str, key: &str) -> Option<String> {
    let pattern = format!("\"{key}\":");
    let start = json.find(&pattern)? + pattern.len();
    let rest = json[start..].trim_start();
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

pub(crate) fn json_number(json: &str, key: &str) -> Option<u32> {
    let pattern = format!("\"{key}\":");
    let start = json.find(&pattern)? + pattern.len();
    let rest = json[start..].trim_start();
    let digits: String = rest.chars().take_while(|ch| ch.is_ascii_digit()).collect();
    digits.parse().ok()
}

pub(crate) fn object_after<'a>(json: &'a str, key: &str) -> Option<&'a str> {
    let pattern = format!("\"{key}\":");
    let start = json.find(&pattern)? + pattern.len();
    let rest = json[start..].trim_start();
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

/// Typed by the user, so this is shorter than the phone's 32-byte secret, and long enough that a localhost page cannot walk it.
pub const PAIRING_LEN: usize = 12;

pub fn pairing_code() -> String {
    const ALPHABET: &[u8] = b"ABCDEFGHJKMNPQRSTUVWXYZ23456789";
    let mut bytes = [0u8; PAIRING_LEN];
    get_random(&mut bytes);
    bytes.into_iter().map(|b| ALPHABET[(b as usize) % ALPHABET.len()] as char).collect()
}

/// DNS rebinding keeps the attacker's Host name while the TCP peer is loopback. The name has to be loopback too.
pub fn host_allowed(host: &str) -> bool {
    let host = host.trim();
    if host.is_empty() || host.starts_with('[') {
        return false;
    }
    let (name, port) = match host.rsplit_once(':') {
        Some((name, port)) => (name, Some(port)),
        None => (host, None),
    };
    if let Some(port) = port {
        if port.is_empty() || !port.bytes().all(|byte| byte.is_ascii_digit()) {
            return false;
        }
    }
    name.eq_ignore_ascii_case("127.0.0.1") || name.eq_ignore_ascii_case("localhost")
}

/// One key or one side button. A DOM `code` comes from the page. `vk` is the stored form.
pub fn parse_watch(json: &str) -> Result<Watch, &'static str> {
    let kind = json_string(json, "kind").ok_or("bad watch")?;
    if kind == "mouse" {
        let button = json_number(json, "button").ok_or("bad watch")?;
        if button != 4 && button != 5 {
            return Err("unsupported button");
        }
        return Ok(Watch::Mouse { button: button as u8 });
    }
    if kind == "key" {
        if let Some(dom) = json_string(json, "code") {
            let vk = dom_code_to_vk(&dom).ok_or("unsupported key")?;
            return Ok(Watch::Key { vk });
        }
        if let Some(vk) = json_number(json, "vk") {
            if vk > u16::MAX as u32 {
                return Err("unsupported key");
            }
            return Ok(Watch::Key { vk: vk as u16 });
        }
        return Err("bad watch");
    }
    Err("bad watch")
}

pub enum Hello {
    Pair,
    Resume { token: String },
}

/// The first socket message. A resume token is not a pairing code.
pub fn parse_hello(text: &str, expected_code: &str) -> Result<Hello, &'static str> {
    let kind = json_string(text, "t").unwrap_or_else(|| "pair".to_string());
    if kind == "resume" {
        let token = json_string(text, "token").ok_or("bad token")?;
        return Ok(Hello::Resume { token });
    }
    if kind == "pair" {
        parse_pair(text, expected_code)?;
        return Ok(Hello::Pair);
    }
    Err("bad pair")
}

#[derive(Debug, PartialEq, Eq)]
pub enum LinkedCommand {
    Forget,
}

/// Messages after the link is up. Unlink is the only one. A key name closes the link.
pub fn parse_linked(text: &str) -> Result<LinkedCommand, &'static str> {
    let kind = json_string(text, "t").ok_or("bad message")?;
    if kind == "forget" {
        return Ok(LinkedCommand::Forget);
    }
    Err("unsupported")
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
        assert!(!origin_allowed(""));
    }

    #[test]
    fn host_must_be_loopback() {
        assert!(host_allowed("127.0.0.1"));
        assert!(host_allowed("127.0.0.1:47321"));
        assert!(host_allowed("localhost:5175"));
        assert!(!host_allowed("evil.example"));
        assert!(!host_allowed("evil.example:47321"));
        assert!(!host_allowed("127.0.0.1.evil.com"));
        assert!(!host_allowed(""));
        assert_eq!(pairing_code().len(), PAIRING_LEN);
    }

    #[test]
    fn pair_is_a_code_and_a_key_name_is_refused() {
        assert!(parse_pair(r#"{"t":"pair","code":"K7QM2P"}"#, "K7QM2P").is_ok());
        assert_eq!(parse_pair(r#"{"t":"pair","code":"K7QM2P"}"#, "OTHER").unwrap_err(), "bad code");
        let key = r#"{"t":"pair","code":"K7QM2P","watch":{"kind":"key","code":"KeyK"}}"#;
        assert_eq!(parse_pair(key, "K7QM2P").unwrap_err(), "bad pair");
        assert_eq!(dom_code_to_vk("Space"), Some(0x20));
        assert_eq!(dom_code_to_vk("F1"), Some(0x70));
        assert_eq!(dom_code_to_vk("F3"), Some(0x72));
        assert_eq!(dom_code_to_vk("F4"), Some(0x73));
        assert_eq!(watch_label(&Watch::Key { vk: 0x70 }), "F1");
        assert_eq!(watch_label(&Watch::Key { vk: 0x72 }), "F3");
        assert_eq!(watch_label(&Watch::Key { vk: 0x73 }), "F4");
        assert_eq!(TALK_ROW, "Talk");
        assert_eq!(PREV_ROW, "Previous channel");
        assert_eq!(NEXT_ROW, "Next channel");
        assert_eq!(CAPTURE_HINT, "Press a key.");
        assert!(!CAPTURE_HINT.to_ascii_lowercase().contains("mouse"));
        assert!(!CAPTURE_HINT.to_ascii_lowercase().contains("side"));
        assert!(!CAPTURE_HINT.to_ascii_lowercase().contains("button"));
        assert_eq!(watch_label(&Watch::Key { vk: 0x20 }), "Space");
        assert_eq!(watch_label(&Watch::Mouse { button: 5 }), "Mouse 5");
        assert_eq!(event_message(OutEvent::Ptt(true)), r#"{"t":"ptt","v":"down"}"#);
        assert_eq!(event_message(OutEvent::Ptt(false)), r#"{"t":"ptt","v":"up"}"#);
        assert_eq!(event_message(OutEvent::Tx(true)), r#"{"t":"tx","v":"next"}"#);
        assert_eq!(event_message(OutEvent::Tx(false)), r#"{"t":"tx","v":"prev"}"#);
        assert!(!event_message(OutEvent::Ptt(true)).contains("vk"));
        assert_eq!(dom_code_to_vk(&dom_code_for_vk(0x20).unwrap()), Some(0x20));
    }

    #[test]
    fn resume_and_unlink_do_not_accept_a_key() {
        let resume = r#"{"t":"resume","token":"abc"}"#;
        match parse_hello(resume, "K7QM2P").unwrap() {
            Hello::Resume { token } => assert_eq!(token, "abc"),
            Hello::Pair => panic!("resume was read as a pair"),
        }
        assert!(matches!(parse_hello(r#"{"t":"pair","code":"K7QM2P"}"#, "K7QM2P").unwrap(), Hello::Pair));
        assert_eq!(parse_linked(r#"{"t":"forget"}"#).unwrap(), LinkedCommand::Forget);
        assert!(parse_linked(r#"{"t":"down","code":"KeyA"}"#).is_err());
        assert!(parse_linked(r#"{"t":"watch","watch":{"kind":"key","code":"KeyV"}}"#).is_err());
        assert!(parse_linked(r#"{"t":"watch","watch":{"kind":"key","vk":65}}"#).is_err());
        assert!(parse_linked(r#"{"t":"ptt","v":"down"}"#).is_err());
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

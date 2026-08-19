//! Минимальный NBT-ридер: нужен для чтения имён миров (level.dat)
//! и списка серверов (servers.dat) без тяжёлых зависимостей.

use std::io::Read;
use std::path::Path;

/// Читает файл, при необходимости распаковывая gzip.
pub fn read_maybe_gzip(path: &Path) -> Option<Vec<u8>> {
    let raw = std::fs::read(path).ok()?;
    if raw.len() > 2 && raw[0] == 0x1f && raw[1] == 0x8b {
        let mut out = Vec::new();
        let mut dec = flate2::read::GzDecoder::new(&raw[..]);
        dec.read_to_end(&mut out).ok()?;
        Some(out)
    } else {
        Some(raw)
    }
}

fn read_u16(data: &[u8], i: usize) -> Option<usize> {
    if i + 1 >= data.len() {
        return None;
    }
    Some(((data[i] as usize) << 8) | data[i + 1] as usize)
}

/// Находит первое значение TAG_String с указанным именем тега.
pub fn find_string(data: &[u8], key: &str) -> Option<String> {
    let key_bytes = key.as_bytes();
    let mut i = 0usize;
    while i + 3 + key_bytes.len() < data.len() {
        if data[i] == 0x08 {
            let name_len = read_u16(data, i + 1)?;
            if name_len == key_bytes.len() && data.get(i + 3..i + 3 + name_len) == Some(key_bytes) {
                let vpos = i + 3 + name_len;
                let vlen = read_u16(data, vpos)?;
                let start = vpos + 2;
                if start + vlen <= data.len() {
                    return String::from_utf8(data[start..start + vlen].to_vec()).ok();
                }
            }
        }
        i += 1;
    }
    None
}

/// Все значения TAG_String с данным именем (в порядке появления).
pub fn find_all_strings(data: &[u8], key: &str) -> Vec<String> {
    let key_bytes = key.as_bytes();
    let mut out = Vec::new();
    let mut i = 0usize;
    while i + 3 + key_bytes.len() < data.len() {
        if data[i] == 0x08 {
            if let Some(name_len) = read_u16(data, i + 1) {
                if name_len == key_bytes.len()
                    && data.get(i + 3..i + 3 + name_len) == Some(key_bytes)
                {
                    let vpos = i + 3 + name_len;
                    if let Some(vlen) = read_u16(data, vpos) {
                        let start = vpos + 2;
                        if start + vlen <= data.len() {
                            if let Ok(s) = String::from_utf8(data[start..start + vlen].to_vec()) {
                                out.push(s);
                                i = start + vlen;
                                continue;
                            }
                        }
                    }
                }
            }
        }
        i += 1;
    }
    out
}

/// Значение TAG_Long с данным именем (например LastPlayed).
pub fn find_long(data: &[u8], key: &str) -> Option<i64> {
    let key_bytes = key.as_bytes();
    let mut i = 0usize;
    while i + 3 + key_bytes.len() + 8 < data.len() {
        if data[i] == 0x04 {
            if let Some(name_len) = read_u16(data, i + 1) {
                if name_len == key_bytes.len()
                    && data.get(i + 3..i + 3 + name_len) == Some(key_bytes)
                {
                    let vpos = i + 3 + name_len;
                    let bytes = data.get(vpos..vpos + 8)?;
                    let mut arr = [0u8; 8];
                    arr.copy_from_slice(bytes);
                    return Some(i64::from_be_bytes(arr));
                }
            }
        }
        i += 1;
    }
    None
}

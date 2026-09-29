//! Поддержка кастомных тем `.prtheme` — обычный CSS + шапка с метаданными.
//! Файл кладётся в <data>/PortalLauncher/themes и применяется в UI.
//!
//! Формат:
//! ```text
//! /* @name Neon Night
//!    @author Nick
//!    @background https://example.com/bg.png
//!    @accent #7c5cff */
//! :root { --color-bg: #08080c; }
//! ```

use serde::{Deserialize, Serialize};
use std::path::PathBuf;

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct PrTheme {
    pub id: String,
    pub name: String,
    pub author: Option<String>,
    pub background: Option<String>,
    pub accent: Option<String>,
    pub css: String,
    pub file: String,
}

pub fn themes_dir() -> PathBuf {
    let p = crate::commands::version_manager::mc_base_dir().join("themes");
    std::fs::create_dir_all(&p).ok();
    p
}

fn meta(css: &str, key: &str) -> Option<String> {
    for line in css.lines().take(40) {
        if let Some(pos) = line.find(&format!("@{key}")) {
            let value = line[pos + key.len() + 1..]
                .trim()
                .trim_end_matches("*/")
                .trim()
                .to_string();
            if !value.is_empty() {
                return Some(value);
            }
        }
    }
    None
}

fn parse(path: &PathBuf) -> Option<PrTheme> {
    let css = std::fs::read_to_string(path).ok()?;
    let stem = path.file_stem()?.to_string_lossy().to_string();
    Some(PrTheme {
        id: format!("prtheme:{stem}"),
        name: meta(&css, "name").unwrap_or_else(|| stem.clone()),
        author: meta(&css, "author"),
        background: meta(&css, "background"),
        accent: meta(&css, "accent"),
        css,
        file: path.to_string_lossy().to_string(),
    })
}

#[tauri::command]
pub fn list_prthemes() -> Result<Vec<PrTheme>, String> {
    let dir = themes_dir();
    let mut out = Vec::new();
    for entry in std::fs::read_dir(&dir)
        .map_err(|e| e.to_string())?
        .flatten()
    {
        let p = entry.path();
        let ext = p
            .extension()
            .map(|e| e.to_string_lossy().to_lowercase())
            .unwrap_or_default();
        if ext == "prtheme" || ext == "css" {
            if let Some(t) = parse(&p) {
                out.push(t);
            }
        }
    }
    out.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
    Ok(out)
}

/// Импорт файла темы (в том числе через drag&drop).
#[tauri::command]
pub fn import_prtheme(source_path: String) -> Result<PrTheme, String> {
    let src = PathBuf::from(&source_path);
    if !src.exists() {
        return Err("Файл темы не найден".into());
    }
    let name = src
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .ok_or("нет имени файла")?;
    let dest = themes_dir().join(&name);
    std::fs::copy(&src, &dest).map_err(|e| e.to_string())?;
    parse(&dest).ok_or_else(|| "Не удалось прочитать тему".into())
}

/// Сохранение темы, написанной прямо в лаунчере.
#[tauri::command]
pub fn save_prtheme(name: String, css: String) -> Result<PrTheme, String> {
    let safe: String = name
        .chars()
        .map(|c| {
            if c.is_alphanumeric() || c == '-' || c == '_' {
                c
            } else {
                '-'
            }
        })
        .collect();
    let dest = themes_dir().join(format!("{safe}.prtheme"));
    std::fs::write(&dest, css).map_err(|e| e.to_string())?;
    parse(&dest).ok_or_else(|| "Не удалось прочитать тему".into())
}

#[tauri::command]
pub fn delete_prtheme(id: String) -> Result<(), String> {
    let stem = id.trim_start_matches("prtheme:");
    for ext in ["prtheme", "css"] {
        let p = themes_dir().join(format!("{stem}.{ext}"));
        if p.exists() {
            std::fs::remove_file(p).map_err(|e| e.to_string())?;
        }
    }
    Ok(())
}

#[tauri::command]
pub fn get_prtheme(id: String) -> Result<PrTheme, String> {
    list_prthemes()?
        .into_iter()
        .find(|t| t.id == id)
        .ok_or_else(|| "Тема не найдена".into())
}

#[tauri::command]
pub fn open_themes_folder() -> Result<(), String> {
    let dir = themes_dir().to_string_lossy().to_string();
    #[cfg(target_os = "windows")]
    crate::utils::create_hidden_command("explorer")
        .arg(&dir)
        .spawn()
        .map_err(|e| e.to_string())?;
    #[cfg(target_os = "macos")]
    crate::utils::create_hidden_command("open")
        .arg(&dir)
        .spawn()
        .map_err(|e| e.to_string())?;
    #[cfg(all(unix, not(target_os = "macos")))]
    crate::utils::create_hidden_command("xdg-open")
        .arg(&dir)
        .spawn()
        .map_err(|e| e.to_string())?;
    Ok(())
}

/// Готовый CSS пользователя, который лежит файлом на диске.
///
/// Раньше CSS жил только в localStorage: файл, который пользователь положил
/// в папку (в том числе оставшийся от первой версии лаунчера), никто не
/// читал, и после переустановки оформление пропадало. Теперь файл читается
/// при запуске и его можно сохранить обратно.
#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct UiCssFile {
    pub css: String,
    pub name: String,
    pub path: String,
    /// Откуда нашёлся файл: `data` — в корне данных, `themes` — в папке тем.
    pub origin: String,
}

/// Ищет файл оформления: сначала `custom.css`/`portal.css` в корне данных,
/// затем первый `.prtheme`/`.css` в папке тем.
#[tauri::command]
pub fn load_ui_css() -> Result<Option<UiCssFile>, String> {
    let base = crate::commands::version_manager::mc_base_dir();
    for name in ["custom.css", "portal.css", "ui.css"] {
        let p = base.join(name);
        if p.is_file() {
            if let Ok(css) = std::fs::read_to_string(&p) {
                return Ok(Some(UiCssFile {
                    css,
                    name: name.to_string(),
                    path: p.to_string_lossy().to_string(),
                    origin: "data".to_string(),
                }));
            }
        }
    }
    // В папке тем берём самый свежий по времени изменения.
    let mut best: Option<(std::time::SystemTime, PathBuf)> = None;
    for entry in std::fs::read_dir(themes_dir())
        .map_err(|e| e.to_string())?
        .flatten()
    {
        let p = entry.path();
        let ext = p
            .extension()
            .map(|e| e.to_string_lossy().to_lowercase())
            .unwrap_or_default();
        if ext != "prtheme" && ext != "css" {
            continue;
        }
        let modified = entry
            .metadata()
            .and_then(|m| m.modified())
            .unwrap_or(std::time::SystemTime::UNIX_EPOCH);
        if best.as_ref().map(|(t, _)| modified > *t).unwrap_or(true) {
            best = Some((modified, p));
        }
    }
    let Some((_, path)) = best else {
        return Ok(None);
    };
    let css = std::fs::read_to_string(&path).map_err(|e| e.to_string())?;
    let name = path
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_else(|| "custom.css".to_string());
    Ok(Some(UiCssFile {
        css,
        name,
        path: path.to_string_lossy().to_string(),
        origin: "themes".to_string(),
    }))
}

/// Сохраняет CSS пользователя файлом в корень данных лаунчера, чтобы правки
/// не потерялись и файл можно было положить рядом вручную.
#[tauri::command]
pub fn save_ui_css(css: String) -> Result<UiCssFile, String> {
    let path = crate::commands::version_manager::mc_base_dir().join("custom.css");
    std::fs::write(&path, css).map_err(|e| e.to_string())?;
    Ok(UiCssFile {
        css: std::fs::read_to_string(&path).unwrap_or_default(),
        name: "custom.css".to_string(),
        path: path.to_string_lossy().to_string(),
        origin: "data".to_string(),
    })
}

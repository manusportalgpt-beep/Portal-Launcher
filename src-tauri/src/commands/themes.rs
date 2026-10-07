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
    /// Цвета из `colors` манифеста темы Prism. Это палитра Qt-ролей
    /// (Window, WindowText, Base, Highlight, ...), а не готовые CSS-переменные.
    #[serde(default)]
    pub palette: Vec<(String, String)>,
    /// Путь к папке `resources` темы Prism — там лежат иконки и картинки.
    #[serde(default)]
    pub resources_dir: Option<String>,
    /// Иконка темы для превью: первый файл в `resources` верхнего уровня.
    #[serde(default)]
    pub icon: Option<String>,
    /// Папка это тема Prism (theme.json + qss + resources) или наш плоский
    /// .prtheme-файл. От этого зависит, как она удаляется и импортируется.
    #[serde(default)]
    pub is_prism_folder: bool,
}

/// Цвет из `colors` манифеста Prism. Ключи — роли палитры Qt, значения — любой
/// формат, который понимает Qt: #RGB, #RRGGBB, #AARRGGBB или название цвета.
fn read_prism_colors(css: &str, key: &str) -> Vec<(String, String)> {
    let mut out = vec![];
    if let Ok(json) = serde_json::from_str::<serde_json::Value>(css) {
        if let Some(colors) = json.get("colors").and_then(|v| v.as_object()) {
            for (name, value) in colors {
                if let Some(text) = value.as_str() {
                    if !text.trim().is_empty() {
                        out.push((name.clone(), text.trim().to_string()));
                    }
                }
            }
        }
        // logColors держим отдельно: имена пересекаются с палитрой, но
        // применяются к консоли, а не к интерфейсу.
        let _ = key;
    }
    out
}

/// Первое изображение верхнего уровня `resources` — для превью темы.
fn prism_theme_icon(theme_dir: &std::path::Path) -> Option<String> {
    let res = theme_dir.join("resources");
    let mut files: Vec<PathBuf> = std::fs::read_dir(&res)
        .ok()?
        .flatten()
        .map(|e| e.path())
        .filter(|p| {
            p.is_file()
                && matches!(
                    p.extension().map(|e| e.to_string_lossy().to_lowercase()).as_deref(),
                    Some("png") | Some("svg") | Some("webp") | Some("jpg") | Some("jpeg")
                )
        })
        .collect();
    files.sort();
    files.first().map(|p| p.to_string_lossy().to_string())
}

/// Тема Prism: папка themes/<id> с theme.json, файлом стилей и resources.
fn parse_prism_folder(theme_dir: &PathBuf) -> Option<PrTheme> {
    let manifest_path = theme_dir.join("theme.json");
    let json_text = std::fs::read_to_string(&manifest_path).ok()?;
    let json: serde_json::Value = serde_json::from_str(&json_text).ok()?;

    let id = theme_dir
        .file_name()
        .map(|n| n.to_string_lossy().to_string())?;
    let name = json
        .get("name")
        .and_then(|v| v.as_str())
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| id.clone());

    // Путь к стилям задаётся в манифесте, по умолчанию themeStyle.css.
    let qss_name = json
        .get("qssFilePath")
        .and_then(|v| v.as_str())
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| "themeStyle.css".to_string());
    // Название файла может содержать подпапку — тогда склеиваем.
    let qss_path = theme_dir.join(&qss_name);
    let css = std::fs::read_to_string(&qss_path).unwrap_or_default();

    let resources = theme_dir.join("resources");
    let resources_dir = if resources.is_dir() {
        Some(resources.to_string_lossy().to_string())
    } else {
        None
    };
    let icon = prism_theme_icon(theme_dir);

    Some(PrTheme {
        id: format!("prism:{id}"),
        name,
        author: None,
        background: json
            .get("colors")
            .and_then(|c| c.get("Window"))
            .and_then(|v| v.as_str())
            .map(|s| s.to_string()),
        accent: json
            .get("colors")
            .and_then(|c| c.get("Highlight"))
            .and_then(|v| v.as_str())
            .map(|s| s.to_string()),
        palette: read_prism_colors(&json_text, "colors"),
        resources_dir,
        icon,
        is_prism_folder: true,
        css,
        file: theme_dir.to_string_lossy().to_string(),
    })
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

/// Плоский файл нашей разновидности темы: обычный CSS с шапкой метаданных.
fn parse(path: &PathBuf) -> Option<PrTheme> {
    let css = std::fs::read_to_string(path).ok()?;
    let stem = path.file_stem()?.to_string_lossy().to_string();
    Some(PrTheme {
        id: format!("prtheme:{stem}"),
        name: meta(&css, "name").unwrap_or_else(|| stem.clone()),
        author: meta(&css, "author"),
        background: meta(&css, "background"),
        accent: meta(&css, "accent"),
        palette: vec![],
        resources_dir: None,
        icon: None,
        is_prism_folder: false,
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
    // Темы Prism — это ПАПКИ: themes/<id>/theme.json + файл стилей +
    // resources/ с иконками. Раньше мы проходили только по файлам в корне,
    // поэтому папка с темой Prism молча игнорировалась, и в списке тем её
    // просто не было. Заходим в каждый подкаталог с theme.json.
    if let Ok(entries) = std::fs::read_dir(&dir) {
        for entry in entries.flatten() {
            let p = entry.path();
            if !p.is_dir() {
                continue;
            }
            if !p.join("theme.json").is_file() {
                continue;
            }
            if let Some(t) = parse_prism_folder(&p) {
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
        .ok_or("нет имени файла".to_string())?;
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

/// Удаляет CSS пользователя с диска.
///
/// Кнопка «Очистить» в настройках чистила только состояние в памяти, но файл
/// `custom.css` оставался. Дальше adoptUiCssFileFromDisk при пустом customCss
/// снова читал этот файл и возвращал текст в поле — выглядело так, будто
/// очистка не сработала. Поэтому файл надо удалять, а не просто забыть.
#[tauri::command]
pub fn clear_ui_css() -> Result<Vec<String>, String> {
    let base = crate::commands::version_manager::mc_base_dir();
    let mut removed = vec![];
    for name in ["custom.css", "portal.css", "ui.css"] {
        let p = base.join(name);
        if p.is_file() {
            std::fs::remove_file(&p).map_err(|e| e.to_string())?;
            removed.push(name.to_string());
        }
    }
    Ok(removed)
}

/// Тема Prism вместе с её файлами — папка целиком.
#[tauri::command]
pub fn import_prism_theme(source_path: String) -> Result<PrTheme, String> {
    let src = PathBuf::from(&source_path);
    if !src.is_dir() {
        return Err("Тема Prism — это папка с theme.json".into());
    }
    if !src.join("theme.json").is_file() {
        return Err("В папке нет theme.json — это не тема Prism".into());
    }
    let name = src
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .ok_or("нет имени папки".to_string())?;
    let dest = themes_dir().join(&name);
    if dest.exists() {
        std::fs::remove_dir_all(&dest).map_err(|e| e.to_string())?;
    }
    copy_dir_recursive(&src, &dest).map_err(|e| e.to_string())?;
    parse_prism_folder(&dest).ok_or_else(|| "Не удалось прочитать тему".into())
}

fn copy_dir_recursive(from: &std::path::Path, to: &std::path::Path) -> Result<(), String> {
    std::fs::create_dir_all(to).map_err(|e| e.to_string())?;
    for entry in std::fs::read_dir(from).map_err(|e| e.to_string())?.flatten() {
        let target = to.join(entry.file_name());
        if entry.path().is_dir() {
            copy_dir_recursive(&entry.path(), &target)?;
        } else {
            std::fs::copy(entry.path(), &target).map_err(|e| e.to_string())?;
        }
    }
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
    // Сначала папка themes. Раньше порядок был обратный, и из-за этого файл,
    // который пользователь положил в themes/, переставал читаться, стоило один
    // раз нажать «Сохранить файлом»: save_ui_css писал custom.css в корень
    // данных, и тот навсегда перебивал папку тем при следующей загрузке.
    let mut best: Option<(std::time::SystemTime, PathBuf)> = None;
    for entry in std::fs::read_dir(themes_dir()).map_err(|e| e.to_string())?.flatten() {
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
    if let Some((_, path)) = best {
        let css = std::fs::read_to_string(&path).map_err(|e| e.to_string())?;
        let name = path
            .file_name()
            .map(|n| n.to_string_lossy().to_string())
            .unwrap_or_else(|| "custom.css".to_string());
        return Ok(Some(UiCssFile {
            css,
            name,
            path: path.to_string_lossy().to_string(),
            origin: "themes".to_string(),
        }));
    }
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
    Ok(None)
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


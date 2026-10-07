//! Закладки — наборы модификаций, которые можно быстро приложить к сборке.
//!
//! Закладка НЕ является сборкой: у неё нет `.minecraft`, нет своих JVM-arg и
//! запуска, и весит она ровно столько, сколько весят лежащие в ней моды.
//! Это быстрая установка «пачки» модов: один раз собрал набор под Fabric,
//! потом применяешь к любой подходящей сборке одной кнопкой.
//!
//! Раскладка на диске:
//! ```text
//! <данные>/bookmarks/<id>/bookmark.json
//! <данные>/bookmarks/<id>/{mods,resourcepacks,shaderpacks,datapacks}/
//! <данные>/bookmarks/.portal-recovery/<id>-<uuid>/   удалённые
//! ```
//!
//! Формат выбран по образцу сборок (`instances.rs`), но без папки игры:
//! закладка — это манифест плюс файлы модов рядом.

use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};

/// Один мод внутри закладки.
#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct BookmarkMod {
    /// `modrinth` или `curseforge`.
    pub source: String,
    pub project_id: String,
    /// Конкретная версия, скачанная в закладку.
    pub version_id: String,
    pub file_id: String,
    pub name: String,
    pub author: Option<String>,
    pub icon_url: Option<String>,
    /// mods / resourcepack / shaderpack / datapack — от этого зависит папка.
    pub kind: String,
    /// Под какую версию Minecraft и лоадер подобрана эта версия. Нужна, чтобы
    /// при применении к другой сборке не ставить заведомо неподходящее.
    pub mc_version: Option<String>,
    pub loader: Option<String>,
    /// Имя файла внутри папки закладки.
    pub file_name: String,
    pub url: Option<String>,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct Bookmark {
    pub id: String,
    pub name: String,
    /// fabric / forge / quilt / neoforge / vanilla — обязателен при создании.
    pub loader: String,
    /// Версия Minecraft опциональна: пустая строка означает «любая».
    pub mc_version: String,
    pub created_at: String,
    pub mods: Vec<BookmarkMod>,
}

fn bookmarks_root() -> PathBuf {
    crate::commands::version_manager::mc_base_dir().join("bookmarks")
}

fn recovery_root() -> PathBuf {
    bookmarks_root().join(".portal-recovery")
}

fn bookmark_dir(id: &str) -> PathBuf {
    bookmarks_root().join(id)
}

fn manifest_path(id: &str) -> PathBuf {
    bookmark_dir(id).join("bookmark.json")
}

/// Папка содержимого по типу мода. Имена совпадают с папками сборки, чтобы код
/// копирования не расходился в двух местах.
pub fn kind_folder(kind: &str) -> &'static str {
    match kind {
        "resourcepack" => "resourcepacks",
        "shaderpack" => "shaderpacks",
        "datapack" => "datapacks",
        _ => "mods",
    }
}

fn slugify(input: &str) -> String {
    let mut out = String::new();
    let mut last_dash = true;
    for ch in input.trim().chars() {
        if ch.is_alphanumeric() {
            out.extend(ch.to_lowercase());
            last_dash = false;
        } else if !last_dash {
            out.push('-');
            last_dash = true;
        }
    }
    let trimmed = out.trim_matches('-').to_string();
    if trimmed.is_empty() {
        "bookmark".to_string()
    } else {
        trimmed
    }
}

fn unique_id(base: &str) -> String {
    let root = bookmarks_root();
    let mut candidate = base.to_string();
    let mut n = 2;
    while root.join(&candidate).exists() {
        candidate = format!("{base}-{n}");
        n += 1;
    }
    candidate
}

fn read_manifest(path: &Path) -> Option<Bookmark> {
    let text = std::fs::read_to_string(path).ok()?;
    serde_json::from_str(&text).ok()
}

fn write_manifest(bookmark: &Bookmark) -> Result<(), String> {
    let path = manifest_path(&bookmark.id);
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let text = serde_json::to_string_pretty(bookmark).map_err(|e| e.to_string())?;
    std::fs::write(&path, text).map_err(|e| format!("Не удалось сохранить закладку: {e}"))
}

fn scan() -> Vec<Bookmark> {
    let mut out = vec![];
    let Ok(entries) = std::fs::read_dir(bookmarks_root()) else {
        return out;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        if !path.is_dir() {
            continue;
        }
        // Корзина удалённых не должна попадать в список живых закладок.
        if path.file_name().map(|n| n == ".portal-recovery").unwrap_or(false) {
            continue;
        }
        if let Some(bookmark) = read_manifest(&path.join("bookmark.json")) {
            out.push(bookmark);
        }
    }
    out.sort_by(|a, b| b.created_at.cmp(&a.created_at));
    out
}

// ── Команды ─────────────────────────────────────────────────────────────────

#[tauri::command]
pub fn get_bookmarks() -> Result<Vec<Bookmark>, String> {
    Ok(scan())
}

/// Создание закладки. Лоадер обязателен: без него набор не к чему прикладывать,
/// и версия при этом может быть пустой — «любая».
#[tauri::command]
pub fn create_bookmark(name: String, loader: String, mc_version: String) -> Result<Bookmark, String> {
    let name = name.trim().to_string();
    if name.is_empty() {
        return Err("Назовите закладку".into());
    }
    let loader = loader.trim().to_lowercase();
    if loader.is_empty() {
        return Err("Выберите загрузчик: без него набор не к чему прикладывать".into());
    }
    let id = unique_id(&slugify(&name));
    let dir = bookmark_dir(&id);
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    for kind in ["mods", "resourcepacks", "shaderpacks", "datapacks"] {
        std::fs::create_dir_all(dir.join(kind)).map_err(|e| e.to_string())?;
    }
    let bookmark = Bookmark {
        id,
        name,
        loader,
        mc_version: mc_version.trim().to_string(),
        created_at: chrono::Utc::now().to_rfc3339(),
        mods: vec![],
    };
    write_manifest(&bookmark)?;
    Ok(bookmark)
}

#[tauri::command]
pub fn rename_bookmark(id: String, name: String) -> Result<Vec<Bookmark>, String> {
    let name = name.trim().to_string();
    if name.is_empty() {
        return Err("Название не может быть пустым".into());
    }
    let mut updated = false;
    for mut bookmark in scan() {
        if bookmark.id == id {
            // name копируется: цикл может встретить больше одной закладки, а
            // перемещение строки обнулило бы её для следующих итераций.
            bookmark.name = name.clone();
            write_manifest(&bookmark)?;
            updated = true;
        }
    }
    if !updated {
        return Err("Закладка не найдена".into());
    }
    Ok(scan())
}

/// Удаление переносит закладку в корзину целиком, вместе с модами, поэтому
/// её можно восстановить без повторной закачки.
#[tauri::command]
pub fn delete_bookmark(id: String) -> Result<(), String> {
    let src = bookmark_dir(&id);
    if !src.is_dir() {
        return Err("Закладка не найдена".into());
    }
    let recovery = recovery_root();
    std::fs::create_dir_all(&recovery).map_err(|e| e.to_string())?;
    let stamp = chrono::Utc::now().timestamp_millis();
    let dest = recovery.join(format!("{id}-{stamp}"));
    // На диске имя папки не совпадёт с id, поэтому возвращаем его в манифест —
    // иначе после восстановления закладка потеряет привязку к своей папке.
    if let Some(mut bookmark) = read_manifest(&src.join("bookmark.json")) {
        std::fs::rename(&src, &dest).map_err(|e| e.to_string())?;
        // Имя папки на диске теперь с меткой времени, и оно же становится id:
        // иначе закладка из корзины потеряла бы привязку к своей папке.
        let dest_id = dest
            .file_name()
            .map(|n| n.to_string_lossy().to_string())
            .unwrap_or_else(|| id.clone());
        bookmark.id = dest_id;
        let text = serde_json::to_string_pretty(&bookmark).map_err(|e| e.to_string())?;
        std::fs::write(dest.join("bookmark.json"), text).map_err(|e| e.to_string())?;
    } else {
        std::fs::rename(&src, &dest).map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct DeletedBookmark {
    pub id: String,
    pub name: String,
    pub loader: String,
    pub mc_version: String,
    pub deleted_at: String,
    pub mods: usize,
}

#[tauri::command]
pub fn list_deleted_bookmarks() -> Result<Vec<DeletedBookmark>, String> {
    let mut out = vec![];
    let Ok(entries) = std::fs::read_dir(recovery_root()) else {
        return Ok(out);
    };
    for entry in entries.flatten() {
        let path = entry.path();
        if !path.is_dir() {
            continue;
        }
        let dir_id = path
            .file_name()
            .map(|n| n.to_string_lossy().to_string())
            .unwrap_or_default();
        let Some(bookmark) = read_manifest(&path.join("bookmark.json")) else {
            continue;
        };
        // Время удаления зашито в имя папки суффиксом метки.
        let deleted_at = dir_id
            .rsplit('-')
            .next()
            .and_then(|ts| ts.parse::<i64>().ok())
            .and_then(|ms| chrono::DateTime::<chrono::Utc>::from_timestamp_millis(ms))
            .map(|d| d.to_rfc3339())
            .unwrap_or_default();
        out.push(DeletedBookmark {
            id: dir_id,
            name: bookmark.name,
            loader: bookmark.loader,
            mc_version: bookmark.mc_version,
            deleted_at,
            mods: bookmark.mods.len(),
        });
    }
    out.sort_by(|a, b| b.deleted_at.cmp(&a.deleted_at));
    Ok(out)
}

#[tauri::command]
pub fn restore_deleted_bookmark(id: String) -> Result<Vec<Bookmark>, String> {
    let src = recovery_root().join(&id);
    if !src.is_dir() {
        return Err("Закладка не найдена в удалённых".into());
    }
    // Возвращаемое имя папки должно быть коротким и уникальным, как при
    // создании, иначе следующая закладка с тем же названием столкнётся с ней.
    let Some(mut bookmark) = read_manifest(&src.join("bookmark.json")) else {
        return Err("Не читается манифест закладки".into());
    };
    let new_id = unique_id(&slugify(&bookmark.name));
    let dest = bookmark_dir(&new_id);
    std::fs::create_dir_all(bookmarks_root()).map_err(|e| e.to_string())?;
    std::fs::rename(&src, &dest).map_err(|e| e.to_string())?;
    bookmark.id = new_id;
    write_manifest(&bookmark)?;
    Ok(scan())
}

#[tauri::command]
pub fn permanently_delete_bookmark(id: String) -> Result<Vec<DeletedBookmark>, String> {
    let path = recovery_root().join(&id);
    if path.is_dir() {
        std::fs::remove_dir_all(&path).map_err(|e| e.to_string())?;
    }
    list_deleted_bookmarks()
}
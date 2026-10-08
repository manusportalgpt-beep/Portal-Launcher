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
    /// Версия загрузчика — Fabric 0.15.11, Forge 47.2.0 и так далее. Как и
    /// версия Minecraft, может быть пустой: тогда подойдёт любой.
    ///
    /// default обязателен: закладки, созданные до появления этого поля, не
    /// должны переставать читаться, иначе они просто исчезли бы из списка.
    #[serde(default)]
    pub loader_version: String,
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
pub fn create_bookmark(
    name: String,
    loader: String,
    mc_version: String,
    loader_version: String,
) -> Result<Bookmark, String> {
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
        loader_version: loader_version.trim().to_string(),
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

// ── Моды внутри закладки ────────────────────────────────────────────────────

/// Версия Minecraft и лоадер сборки — нужно, чтобы понять, что подойдёт.
struct InstanceMeta {
    mc_version: String,
    loader: String,
    dir: PathBuf,
}

fn instance_meta(instance_id: &str) -> Result<InstanceMeta, String> {
    let base = crate::commands::version_manager::mc_base_dir();
    let dir = base.join("instances").join(instance_id);
    let path = dir.join("instance.json");
    let text = std::fs::read_to_string(&path)
        .map_err(|_| "Сборка не найдена".to_string())?;
    let json: serde_json::Value =
        serde_json::from_str(&text).map_err(|e| format!("Сборка читается криво: {e}"))?;
    Ok(InstanceMeta {
        mc_version: json["mc_version"].as_str().unwrap_or("").to_string(),
        loader: json["loader"].as_str().unwrap_or("").to_lowercase(),
        dir,
    })
}

fn http_client() -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(60))
        .user_agent("PortalLauncher/1.0 (bookmarks)")
        .build()
        .map_err(|e| e.to_string())
}

/// Находит версию проекта под заданный лоадер и версию Minecraft.
///
/// Пустая mc_version означает «любая»: тогда фильтруем только по лоадеру.
/// Возвращает самую свежую подходящую версию — Modrinth отдаёт их от новых к
/// старым, поэтому берём первую.
async fn resolve_version(
    client: &reqwest::Client,
    project_id: &str,
    loader: &str,
    mc_version: &str,
) -> Result<serde_json::Value, String> {
    let loaders = format!("[\"{loader}\"]");
    let url = if mc_version.is_empty() {
        format!("https://api.modrinth.com/v2/project/{project_id}/version?loaders={loaders}")
    } else {
        format!(
            "https://api.modrinth.com/v2/project/{project_id}/version?game_versions=[\"{mc_version}\"]&loaders={loaders}"
        )
    };
    let resp = client
        .get(&url)
        .send()
        .await
        .map_err(|e| format!("Modrinth не ответил: {e}"))?;
    let body: serde_json::Value = resp
        .json()
        .await
        .map_err(|e| format!("Ответ Modrinth не разобран: {e}"))?;
    body.as_array()
        .and_then(|a| a.first())
        .cloned()
        .ok_or_else(|| {
            if mc_version.is_empty() {
                format!("Для лоадера {loader} нет ни одной версии")
            } else {
                format!("Для {loader} {mc_version} версий нет")
            }
        })
}

/// Проектные данные для карточки: нужны автору, описанию и иконке.
async fn fetch_project(
    client: &reqwest::Client,
    project_id: &str,
) -> Result<serde_json::Value, String> {
    client
        .get(format!("https://api.modrinth.com/v2/project/{project_id}"))
        .send()
        .await
        .map_err(|e| format!("Modrinth не ответил: {e}"))?
        .json()
        .await
        .map_err(|e| format!("Ответ Modrinth не разобран: {e}"))
}

/// Автор проекта по ответу Modrinth v2. В v2 автора нет отдельной строкой:
/// это массив `authors`, где у каждого объекта своё `name`. Поле `author`
/// осталось только в v1, поэтому проверяем оба — иначе автор молча пустой.
fn project_author(meta: &serde_json::Value) -> Option<String> {
    meta.get("authors")
        .and_then(|list| list.as_array())
        .and_then(|list| {
            list.iter()
                .find_map(|entry| entry.get("name").and_then(|n| n.as_str()))
        })
        .or_else(|| meta.get("author").and_then(|a| a.as_str()))
        .map(|name| name.trim().to_string())
        .filter(|name| !name.is_empty())
}

fn safe_file_name(value: &str) -> String {
    let cleaned: String = value
        .chars()
        .map(|c| {
            if c.is_alphanumeric() || matches!(c, '-' | '_' | '.' | '+') {
                c
            } else {
                '_'
            }
        })
        .collect();
    let trimmed = cleaned.trim_matches(['.', '_', '-']).to_string();
    if trimmed.is_empty() {
        "mod.jar".to_string()
    } else {
        trimmed
    }
}

/// Добавляет мод в закладку: подбирает версию под её лоадер, скачивает файл и
/// тянет обязательные зависимости. Зависимости добавляются рекурсивно, но без
/// повторов — циклы в графе зависимостей у Modrinth встречаются.
#[tauri::command]
pub async fn add_mod_to_bookmark(
    bookmark_id: String,
    project_id: String,
    kind: String,
) -> Result<Bookmark, String> {
    let client = http_client()?;
    let mut bookmark = scan()
        .into_iter()
        .find(|b| b.id == bookmark_id)
        .ok_or("Закладка не найдена".to_string())?;

    // Один заход на проект: иначе цикл зависимостей будет крутиться вечно.
    let mut visited: std::collections::HashSet<String> = bookmark
        .mods
        .iter()
        .map(|m| m.project_id.clone())
        .collect();
    // Очередь на обработку: сначала сам мод, затем его зависимости.
    let mut queue = vec![(project_id.clone(), kind.clone())];

    while let Some((current_project, current_kind)) = queue.pop() {
        if !visited.insert(current_project.clone()) {
            continue;
        }
        let version = match resolve_version(
            &client,
            &current_project,
            &bookmark.loader,
            &bookmark.mc_version,
        )
        .await
        {
            Ok(v) => v,
            Err(e) => {
                // Ошибку первого (запрошенного) мода пробрасываем, у
                // зависимостей молча пропускаем: иначе один сломанный
                // транзитивный мод роняет добавление всего набора.
                if current_project == project_id {
                    return Err(e);
                }
                continue;
            }
        };

        let files = version["files"].as_array().cloned().unwrap_or_default();
        let primary = files
            .iter()
            .find(|f| f["primary"].as_bool().unwrap_or(false))
            .or_else(|| files.first())
            .ok_or("У версии нет файлов".to_string())?;
        let file_url = primary["url"].as_str().unwrap_or("").to_string();
        let file_name = safe_file_name(
            primary["fileName"].as_str().unwrap_or(&format!("{current_project}.jar")),
        );
        if file_url.is_empty() {
            return Err(format!("У мода {current_project} нет ссылки на файл"));
        }

        let target_dir = bookmark_dir(&bookmark_id).join(kind_folder(&current_kind));
        std::fs::create_dir_all(&target_dir).map_err(|e| e.to_string())?;
        let bytes = client
            .get(&file_url)
            .send()
            .await
            .map_err(|e| format!("Файл не скачан: {e}"))?
            .bytes()
            .await
            .map_err(|e| e.to_string())?;
        std::fs::write(target_dir.join(&file_name), &bytes).map_err(|e| e.to_string())?;

        let meta = fetch_project(&client, &current_project).await.ok();
        bookmark.mods.push(BookmarkMod {
            source: "modrinth".to_string(),
            project_id: current_project.clone(),
            version_id: version["id"].as_str().unwrap_or("").to_string(),
            file_id: primary["id"].as_str().unwrap_or("").to_string(),
            name: meta
                .as_ref()
                .and_then(|m| m["title"].as_str())
                .map(String::from)
                .or_else(|| version["name"].as_str().map(String::from))
                .unwrap_or_else(|| current_project.clone()),
            author: meta.as_ref().and_then(project_author),
            icon_url: meta
                .as_ref()
                .and_then(|m| m["icon_url"].as_str())
                .map(String::from),
            kind: current_kind.clone(),
            mc_version: version["game_versions"]
                .as_array()
                .and_then(|a| a.first())
                .and_then(|v| v.as_str())
                .map(String::from)
                .or(Some(bookmark.mc_version.clone()))
                .filter(|v| !v.is_empty()),
            loader: Some(bookmark.loader.clone()),
            file_name,
            url: Some(file_url),
        });

        // Обязательные зависимости — в ту же очередь, вид и папку у них тот же.
        if let Some(deps) = version["dependencies"].as_array() {
            for dep in deps {
                if dep["dependency_type"].as_str() != Some("required") {
                    continue;
                }
                if let Some(dep_id) = dep["project_id"].as_str() {
                    if !visited.contains(dep_id) {
                        queue.push((dep_id.to_string(), current_kind.clone()));
                    }
                }
            }
        }
    }

    write_manifest(&bookmark)?;
    Ok(bookmark)
}

#[tauri::command]
pub fn remove_mod_from_bookmark(
    bookmark_id: String,
    project_id: String,
) -> Result<Bookmark, String> {
    let mut bookmark = scan()
        .into_iter()
        .find(|b| b.id == bookmark_id)
        .ok_or("Закладка не найдена".to_string())?;
    let dir = bookmark_dir(&bookmark_id);
    bookmark.mods.retain(|m| {
        if m.project_id != project_id {
            return true;
        }
        let path = dir.join(kind_folder(&m.kind)).join(&m.file_name);
        std::fs::remove_file(&path).ok();
        false
    });
    write_manifest(&bookmark)?;
    Ok(bookmark)
}

/// Отчёт по одному моду: подходит ли он под сборку и какая версия встанет.
/// Несовместимые показываем пользователю подробно, поэтому здесь всё, что
/// нужно карточке, а не только флаги.
#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct BookmarkModReport {
    pub project_id: String,
    pub name: String,
    pub author: Option<String>,
    pub icon_url: Option<String>,
    pub description: String,
    pub kind: String,
    pub resolved_version: Option<String>,
    pub resolved_file_name: Option<String>,
    pub resolved_url: Option<String>,
    pub bookmark_version: Option<String>,
    pub compatible: bool,
    pub reason: String,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct BookmarkCompatReport {
    pub mc_version: String,
    pub loader: String,
    /// Совпадают ли лоадер и версия с закладкой. false — нужно подтверждение.
    pub exact_match: bool,
    pub loader_match: bool,
    pub version_match: bool,
    pub total: usize,
    pub compatible: usize,
    pub incompatible: usize,
    pub mods: Vec<BookmarkModReport>,
}

/// Подбирает под сборку версию каждого мода закладки. Ничего не качает — только
/// отчёт, чтобы показать пользователю, что не встанет.
#[tauri::command]
pub async fn bookmark_compatibility(
    bookmark_id: String,
    instance_id: String,
) -> Result<BookmarkCompatReport, String> {
    let mut bookmark = scan()
        .into_iter()
        .find(|b| b.id == bookmark_id)
        .ok_or("Закладка не найдена".to_string())?;
    let meta = instance_meta(&instance_id)?;
    let client = http_client()?;

    let loader_match = !bookmark.loader.is_empty() && bookmark.loader == meta.loader;
    let version_match = !bookmark.mc_version.is_empty() && bookmark.mc_version == meta.mc_version;
    let exact_match = loader_match && version_match;

    let mut mods = vec![];
    // Закладки, созданные до исправления чтения авторов, лежат с author: null.
    // Дописываем им метаданные и сохраняем обратно, иначе пустота останется
    // навсегда и придётся пересоздавать закладки вручную.
    let mut repaired: Vec<(usize, Option<String>, Option<String>)> = vec![];
    for (index, m) in bookmark.mods.iter().enumerate() {
        let mut report = BookmarkModReport {
            project_id: m.project_id.clone(),
            name: m.name.clone(),
            author: m.author.clone(),
            icon_url: m.icon_url.clone(),
            description: String::new(),
            kind: m.kind.clone(),
            resolved_version: None,
            resolved_file_name: None,
            resolved_url: None,
            bookmark_version: m.mc_version.clone(),
            compatible: false,
            reason: String::new(),
        };
        match resolve_version(&client, &m.project_id, &meta.loader, &meta.mc_version).await {
            Ok(version) => {
                let files = version["files"].as_array().cloned().unwrap_or_default();
                let primary = files
                    .iter()
                    .find(|f| f["primary"].as_bool().unwrap_or(false))
                    .or_else(|| files.first());
                report.resolved_version = version["version_number"]
                    .as_str()
                    .map(String::from)
                    .or_else(|| version["name"].as_str().map(String::from));
                report.resolved_file_name = primary
                    .and_then(|f| f["fileName"].as_str())
                    .map(safe_file_name);
                report.resolved_url =
                    primary.and_then(|f| f["url"].as_str()).map(String::from);
                report.compatible = report.resolved_url.is_some();
                if !report.compatible {
                    report.reason = "У версии нет файла для загрузки".into();
                }
            }
            Err(e) => report.reason = e,
        }
        if report.author.is_none() || report.icon_url.is_none() {
            if let Ok(project) = fetch_project(&client, &m.project_id).await {
                let author = project_author(&project);
                let icon = project
                    .get("icon_url")
                    .and_then(|i| i.as_str())
                    .map(String::from);
                if report.author.is_none() {
                    report.author = author.clone();
                }
                if report.icon_url.is_none() {
                    report.icon_url = icon.clone();
                }
                if report.author.is_some() || report.icon_url.is_some() {
                    repaired.push((index, author, icon));
                }
            }
        }
        mods.push(report);
    }

    if !repaired.is_empty() {
        for (index, author, icon) in repaired {
            if let Some(entry) = bookmark.mods.get_mut(index) {
                if entry.author.is_none() {
                    entry.author = author;
                }
                if entry.icon_url.is_none() {
                    entry.icon_url = icon;
                }
            }
        }
        // Не срываем отчёт, если метаданные записать не вышло: это кэш.
        let _ = write_manifest(&bookmark);
    }

    // Описание тянем отдельным запросом: в отчёте оно нужно, чтобы «Подробнее»
    // не показывал пустую карточку.
    let missing: Vec<String> = mods
        .iter()
        .filter(|r| !r.compatible)
        .map(|r| r.project_id.clone())
        .collect();
    for report in mods.iter_mut() {
        if !missing.contains(&report.project_id) {
            continue;
        }
        if let Ok(project) = fetch_project(&client, &report.project_id).await {
            if let Some(text) = project["description"].as_str() {
                report.description = text.chars().take(400).collect();
            }
        }
    }

    let compatible = mods.iter().filter(|r| r.compatible).count();
    Ok(BookmarkCompatReport {
        mc_version: meta.mc_version,
        loader: meta.loader,
        exact_match,
        loader_match,
        version_match,
        total: mods.len(),
        compatible,
        incompatible: mods.len() - compatible,
        mods,
    })
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct BookmarkApplyResult {
    pub installed: usize,
    pub skipped: usize,
    pub failed: Vec<String>,
}

/// Применяет закладку к сборке. Подходящие моды копируются из папки закладки,
/// остальные резолвятся и качаются заново под лоадер и версию сборки.
///
/// Параметр `force` — это подтверждение пользователя на применение к
/// несовместимой сборке. Без него несовместимые моды молча пропускаются.
#[tauri::command]
pub async fn apply_bookmark(
    bookmark_id: String,
    instance_id: String,
    force: bool,
) -> Result<BookmarkApplyResult, String> {
    let bookmark = scan()
        .into_iter()
        .find(|b| b.id == bookmark_id)
        .ok_or("Закладка не найдена".to_string())?;
    let meta = instance_meta(&instance_id)?;
    let report = bookmark_compatibility(bookmark_id.clone(), instance_id.clone()).await?;
    let client = http_client()?;

    let game_dir = meta.dir.join(".minecraft");
    let source_root = bookmark_dir(&bookmark_id);
    let mut result = BookmarkApplyResult {
        installed: 0,
        skipped: 0,
        failed: vec![],
    };

    for m in &bookmark.mods {
        let Some(entry) = report
            .mods
            .iter()
            .find(|r| r.project_id == m.project_id)
            .cloned()
        else {
            continue;
        };

        let target_dir = game_dir.join(kind_folder(&m.kind));
        if let Err(e) = std::fs::create_dir_all(&target_dir) {
            result.failed.push(format!("{}: {e}", m.name));
            continue;
        }

        // Подходящий и уже скачанный мод — просто копируем из закладки.
        if entry.compatible {
            let source = source_root.join(kind_folder(&m.kind)).join(&m.file_name);
            if source.is_file() {
                let name = entry
                    .resolved_file_name
                    .clone()
                    .unwrap_or_else(|| m.file_name.clone());
                match std::fs::copy(&source, target_dir.join(&name)) {
                    Ok(_) => result.installed += 1,
                    Err(e) => result.failed.push(format!("{}: {e}", m.name)),
                }
                continue;
            }
        }

        if !force && !entry.compatible {
            result.skipped += 1;
            continue;
        }
        // Подтверждённый несовместимый мод: качаем версию под сборку.
        if let Some(url) = &entry.resolved_url {
            let name = entry
                .resolved_file_name
                .clone()
                .unwrap_or_else(|| m.file_name.clone());
            match client.get(url).send().await {
                Ok(resp) => match resp.bytes().await {
                    Ok(bytes) => match std::fs::write(target_dir.join(&name), &bytes) {
                        Ok(()) => result.installed += 1,
                        Err(e) => result.failed.push(format!("{}: {e}", m.name)),
                    },
                    Err(e) => result.failed.push(format!("{}: {e}", m.name)),
                },
                Err(e) => result.failed.push(format!("{}: {e}", m.name)),
            }
        } else {
            result.skipped += 1;
        }
    }

    Ok(result)
}

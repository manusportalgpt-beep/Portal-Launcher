//! Файловая система сборки: у каждой сборки свои mods/saves/config/…
//! Просмотр, создание, переименование, удаление, drag&drop установка модов,
//! список миров и серверов, запуск в мир/на сервер.

use base64::Engine as _;
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};

use crate::mc::launch::instance_game_dir;
use crate::mc::nbt;

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct CrashDiagnosis {
    pub category: String,
    pub title: String,
    pub summary: String,
    pub evidence: Vec<String>,
    pub suggestions: Vec<String>,
    pub confidence: String,
}

fn first_evidence(lines: &[&str], needles: &[&str]) -> Vec<String> {
    lines.iter()
        .filter(|line| {
            let lower = line.to_ascii_lowercase();
            needles.iter().any(|needle| lower.contains(needle))
        })
        .take(3)
        .map(|line| line.trim().chars().take(360).collect::<String>())
        .filter(|line| !line.is_empty())
        .collect()
}

fn conflict_pair(line: &str) -> Option<(String, String)> {
    let lower = line.to_ascii_lowercase();
    for marker in [" conflicts with ", " is incompatible with ", " incompatible with "] {
        if let Some(index) = lower.find(marker) {
            let left = line[..index].split_whitespace().last()?.trim_matches(|c: char| !c.is_alphanumeric() && c != '_' && c != '-').to_string();
            let right = line[index + marker.len()..].split_whitespace().next()?.trim_matches(|c: char| !c.is_alphanumeric() && c != '_' && c != '-').to_string();
            if left.len() > 1 && right.len() > 1 { return Some((left, right)); }
        }
    }
    None
}

pub fn diagnose_crash_log(content: &str) -> Option<CrashDiagnosis> {
    let lines: Vec<&str> = content.lines().collect();
    if lines.is_empty() { return None; }

    if let Some(line) = lines.iter().find(|line| {
        let lower = line.to_ascii_lowercase();
        lower.contains(" conflicts with ") || lower.contains(" is incompatible with ") || lower.contains(" incompatible with ")
    }) {
        let pair = conflict_pair(line).map(|(a, b)| format!("Мод «{a}» конфликтует с модом «{b}».")).unwrap_or_else(|| "Лог сообщает о несовместимых модификациях.".to_string());
        return Some(CrashDiagnosis {
            category: "mod_conflict".into(), title: "Обнаружен конфликт модификаций".into(), summary: pair,
            evidence: vec![line.trim().chars().take(360).collect()],
            suggestions: vec!["Отключите один из указанных модов или установите совместимые версии.".into(), "Проверьте зависимости в настройках сборки.".into()], confidence: "high".into(),
        });
    }

    let dependency_evidence = first_evidence(&lines, &["missing required mod", "requires version", "could not find required mod", "depends on", "mod resolution failed"]);
    if !dependency_evidence.is_empty() {
        return Some(CrashDiagnosis { category: "missing_dependency".into(), title: "Не хватает зависимости или несовместима её версия".into(), summary: "Загрузчик не смог собрать список модификаций из-за требования зависимости.".into(), evidence: dependency_evidence, suggestions: vec!["Установите требуемую зависимость той версии Minecraft и loader, которые используются сборкой.".into(), "Проверьте, не отключён ли обязательный мод.".into()], confidence: "high".into() });
    }

    let java_evidence = first_evidence(&lines, &["unsupportedclassversionerror", "unsupported class file major version", "class file version", "java runtime environment", "could not create the java virtual machine", "a fatal exception has occurred"]);
    if !java_evidence.is_empty() {
        return Some(CrashDiagnosis { category: "java".into(), title: "Несовместимая версия Java или ошибка JVM".into(), summary: "В логе обнаружена ошибка Java/JVM, поэтому Minecraft не смог запуститься.".into(), evidence: java_evidence, suggestions: vec!["Выберите Java, рекомендованную для версии Minecraft, и перезапустите подготовку сборки.".into(), "Для Minecraft 1.20.5+ обычно нужна Java 21, а для Minecraft 26.x — Java 25.".into()], confidence: "high".into() });
    }

    let memory_evidence = first_evidence(&lines, &["outofmemoryerror", "java heap space", "unable to create native thread", "native memory allocation"]);
    if !memory_evidence.is_empty() {
        return Some(CrashDiagnosis { category: "memory".into(), title: "Недостаточно памяти".into(), summary: "JVM не смогла выделить необходимую оперативную или native-память.".into(), evidence: memory_evidence, suggestions: vec!["Уменьшите максимальную память сборки или закройте другие тяжёлые приложения.".into(), "Проверьте, что установлена 64-битная Java.".into()], confidence: "high".into() });
    }

    let native_evidence = first_evidence(&lines, &["could not load", "failed to load", "no lwjgl", "glfw error", "opengl", "native library"]);
    if !native_evidence.is_empty() {
        return Some(CrashDiagnosis { category: "native_or_graphics".into(), title: "Ошибка native-библиотеки или графики".into(), summary: "Minecraft не смог загрузить native-компонент или графический backend.".into(), evidence: native_evidence, suggestions: vec!["Повторите проверку установки Minecraft и библиотек natives.".into(), "Обновите драйвер видеокарты и отключите несовместимые графические моды.".into()], confidence: "medium".into() });
    }

    let auth_evidence = first_evidence(&lines, &["authentication servers are down", "invalid session", "failed to verify username", "authentication failed", "not authenticated"]);
    if !auth_evidence.is_empty() {
        return Some(CrashDiagnosis { category: "authentication".into(), title: "Ошибка авторизации Minecraft".into(), summary: "Сессия игрока недействительна или серверы авторизации недоступны.".into(), evidence: auth_evidence, suggestions: vec!["Выйдите из аккаунта и войдите снова, затем повторите запуск.".into(), "Проверьте подключение к интернету и статус серверов авторизации.".into()], confidence: "high".into() });
    }

    let network_evidence = first_evidence(&lines, &["failed to download", "connection refused", "connection timed out", "unknownhostexception", "could not resolve host", "error downloading"]);
    if !network_evidence.is_empty() {
        return Some(CrashDiagnosis { category: "network".into(), title: "Ошибка загрузки или подключения".into(), summary: "Minecraft или загрузчик не смогли получить нужный файл по сети.".into(), evidence: network_evidence, suggestions: vec!["Проверьте интернет, VPN/прокси и повторите установку файла.".into(), "Запустите проверку целостности сборки.".into()], confidence: "high".into() });
    }

    None
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct FsEntry {
    pub name: String,
    /// путь относительно корня сборки (.minecraft)
    pub path: String,
    pub is_dir: bool,
    pub size: u64,
    pub modified: Option<String>,
    pub kind: String,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct WorldInfo {
    pub folder: String,
    pub name: String,
    pub icon: Option<String>,
    pub last_played: Option<i64>,
    pub size_mb: u64,
    pub game_mode: Option<String>,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct ServerInfo {
    pub name: String,
    pub address: String,
    pub icon: Option<String>,
}

fn safe_join(instance_id: &str, rel: &str) -> Result<PathBuf, String> {
    let root = instance_game_dir(instance_id);
    let rel = rel.trim_start_matches(['/', '\\']);
    let candidate = root.join(rel);
    // защита от выхода за пределы сборки
    let normalized = normalize(&candidate);
    if !normalized.starts_with(&normalize(&root)) {
        return Err("Путь вне папки сборки запрещён".into());
    }
    Ok(normalized)
}

fn normalize(p: &Path) -> PathBuf {
    let mut out = PathBuf::new();
    for comp in p.components() {
        match comp {
            std::path::Component::ParentDir => {
                out.pop();
            }
            std::path::Component::CurDir => {}
            other => out.push(other.as_os_str()),
        }
    }
    out
}

fn kind_of(path: &Path) -> String {
    if path.is_dir() {
        return "folder".into();
    }
    match path
        .extension()
        .map(|e| e.to_string_lossy().to_lowercase())
        .unwrap_or_default()
        .as_str()
    {
        "jar" => "mod",
        "zip" => "archive",
        "json" | "toml" | "cfg" | "properties" | "txt" | "log" | "prtheme" | "css" => "text",
        "png" | "jpg" | "jpeg" | "webp" => "image",
        "dat" | "dat_old" => "data",
        _ => "file",
    }
    .to_string()
}

fn dir_size(path: &Path) -> u64 {
    let mut total = 0u64;
    if let Ok(entries) = std::fs::read_dir(path) {
        for e in entries.flatten() {
            let p = e.path();
            if p.is_dir() {
                total += dir_size(&p);
            } else if let Ok(m) = e.metadata() {
                total += m.len();
            }
        }
    }
    total
}

// ─────────────────────────────────────────────────────────────────────────────
// Просмотр и правка файлов
// ─────────────────────────────────────────────────────────────────────────────

#[tauri::command]
pub fn instance_list_dir(instance_id: String, path: Option<String>) -> Result<Vec<FsEntry>, String> {
    let rel = path.unwrap_or_default();
    let dir = safe_join(&instance_id, &rel)?;
    std::fs::create_dir_all(&dir).ok();
    let mut out = Vec::new();
    for entry in std::fs::read_dir(&dir).map_err(|e| e.to_string())?.flatten() {
        let p = entry.path();
        let meta = entry.metadata().ok();
        let modified = meta
            .as_ref()
            .and_then(|m| m.modified().ok())
            .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
            .map(|d| {
                chrono::DateTime::from_timestamp(d.as_secs() as i64, 0)
                    .map(|dt| dt.to_rfc3339())
                    .unwrap_or_default()
            });
        let name = entry.file_name().to_string_lossy().to_string();
        let rel_path = if rel.is_empty() {
            name.clone()
        } else {
            format!("{}/{}", rel.trim_end_matches('/'), name)
        };
        out.push(FsEntry {
            name,
            path: rel_path,
            is_dir: p.is_dir(),
            size: meta.as_ref().map(|m| m.len()).unwrap_or(0),
            modified,
            kind: kind_of(&p),
        });
    }
    out.sort_by(|a, b| b.is_dir.cmp(&a.is_dir).then(a.name.to_lowercase().cmp(&b.name.to_lowercase())));
    Ok(out)
}

/// Рекурсивный поиск по файлам сборки (по имени/расширению).
/// Пропускает скрытые папки и тяжёлые миры (`saves`) ради скорости.
#[tauri::command]
pub fn instance_search_files(instance_id: String, query: String) -> Result<Vec<FsEntry>, String> {
    let root = safe_join(&instance_id, "")?;
    let q = query.trim().to_lowercase();
    if q.is_empty() {
        return Ok(Vec::new());
    }

    fn walk(dir: &Path, rel: &str, q: &str, out: &mut Vec<FsEntry>, scanned: &mut u32) {
        if *scanned >= 80_000 || out.len() >= 300 {
            return;
        }
        let Ok(entries) = std::fs::read_dir(dir) else { return };
        for entry in entries.flatten() {
            if *scanned >= 80_000 || out.len() >= 300 {
                return;
            }
            *scanned += 1;
            let name = entry.file_name().to_string_lossy().to_string();
            if name.starts_with('.') {
                continue;
            }
            let p = entry.path();
            let is_dir = p.is_dir();
            // Миры — десятки тысяч бинарных файлов, их поиск почти не нужен.
            if is_dir && name.eq_ignore_ascii_case("saves") {
                continue;
            }
            let rel_path = if rel.is_empty() {
                name.clone()
            } else {
                format!("{}/{}", rel, name)
            };
            if name.to_lowercase().contains(q) {
                out.push(FsEntry {
                    name,
                    path: rel_path.clone(),
                    is_dir,
                    size: entry.metadata().map(|m| m.len()).unwrap_or(0),
                    modified: None,
                    kind: kind_of(&p),
                });
            }
            if is_dir {
                walk(&p, &rel_path, q, out, scanned);
            }
        }
    }

    let mut out = Vec::new();
    let mut scanned = 0u32;
    walk(&root, "", &q, &mut out, &mut scanned);
    Ok(out)
}

#[tauri::command]
pub fn instance_read_text(instance_id: String, path: String) -> Result<String, String> {
    let p = safe_join(&instance_id, &path)?;
    let bytes = std::fs::read(&p).map_err(|e| format!("Не удалось прочитать {}: {e}", p.display()))?;
    // Minecraft-конфиги встречаются с BOM/неидеальным UTF-8. Lossy decoding
    // позволяет открыть и отредактировать их, не ломая файловый менеджер.
    Ok(String::from_utf8_lossy(&bytes).trim_start_matches('\u{feff}').to_string())
}

#[tauri::command]
pub fn instance_write_text(instance_id: String, path: String, content: String) -> Result<(), String> {
    let p = safe_join(&instance_id, &path)?;
    if let Some(dir) = p.parent() {
        std::fs::create_dir_all(dir).ok();
    }
    std::fs::write(p, content).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn instance_mkdir(instance_id: String, path: String) -> Result<(), String> {
    let p = safe_join(&instance_id, &path)?;
    std::fs::create_dir_all(p).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn instance_delete_path(instance_id: String, path: String) -> Result<(), String> {
    let p = safe_join(&instance_id, &path)?;
    if p == instance_game_dir(&instance_id) {
        return Err("Нельзя удалить корень сборки".into());
    }
    let first_segment = path.replace('\\', "/").split('/').next().unwrap_or("").to_ascii_lowercase();
    let content_type = match first_segment.as_str() { "mods" => Some("mod"), "resourcepacks" => Some("resourcepack"), "shaderpacks" => Some("shaderpack"), "datapacks" => Some("datapack"), "saves" => Some("saves"), _ => None };
    if let Some(mod_type) = content_type {
        crate::commands::mods::move_instance_content_to_recovery(&instance_id, p, mod_type, false)?;
        return Ok(());
    }
    if p.is_dir() {
        std::fs::remove_dir_all(p).map_err(|e| e.to_string())
    } else {
        std::fs::remove_file(p).map_err(|e| e.to_string())
    }
}

#[tauri::command]
pub fn instance_rename_path(
    instance_id: String,
    path: String,
    new_name: String,
) -> Result<(), String> {
    let p = safe_join(&instance_id, &path)?;
    let clean_name = new_name.trim();
    if clean_name.is_empty() || clean_name == "." || clean_name == ".." || clean_name.contains('/') || clean_name.contains('\\') {
        return Err("Некорректное имя файла или папки".into());
    }
    let parent = p.parent().ok_or("нет родительской папки")?;
    let target = parent.join(clean_name);
    if !normalize(&target).starts_with(&normalize(&instance_game_dir(&instance_id))) {
        return Err("Переименование за пределами сборки запрещено".into());
    }
    std::fs::rename(p, target).map_err(|e| e.to_string())
}

/// Перемещение (используется drag&drop внутри файлового менеджера).
#[tauri::command]
pub fn instance_move_path(
    instance_id: String,
    from: String,
    to_dir: String,
) -> Result<(), String> {
    let src = safe_join(&instance_id, &from)?;
    let dir = safe_join(&instance_id, &to_dir)?;
    if !src.exists() {
        return Err("Источник перемещения не найден".into());
    }
    if !dir.is_dir() && !dir.exists() {
        std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    }
    let source_normalized = normalize(&src);
    let target_dir_normalized = normalize(&dir);
    if src.is_dir() && target_dir_normalized.starts_with(&source_normalized) {
        return Err("Нельзя переместить папку внутрь самой себя".into());
    }
    let name = src.file_name().ok_or("нет имени файла")?;
    let target = dir.join(name);
    if target.exists() {
        return Err("В папке назначения уже есть файл или папка с таким именем".into());
    }
    std::fs::rename(&src, target).map_err(|e| e.to_string())
}

/// Drag&drop файлов из ОС: моды/ресурспаки/шейдеры/миры раскладываются сами.
#[tauri::command]
pub fn instance_drop_files(
    instance_id: String,
    files: Vec<String>,
    target_dir: Option<String>,
) -> Result<Vec<String>, String> {
    let root = instance_game_dir(&instance_id);
    std::fs::create_dir_all(&root).ok();
    let mut installed = Vec::new();

    for file in files {
        let src = PathBuf::from(&file);
        if !src.exists() {
            continue;
        }
        let name = src
            .file_name()
            .map(|n| n.to_string_lossy().to_string())
            .unwrap_or_default();
        let lower = name.to_lowercase();

        // Files workspace always passes an explicit current folder, including
        // the empty string for `.minecraft`. Only callers that omit target_dir
        // altogether use the existing Minecraft-content classification.
        let dest_dir = if let Some(t) = target_dir.as_ref() {
            safe_join(&instance_id, t)?
        } else if lower.ends_with(".jar") {
            root.join("mods")
        } else if lower.ends_with(".mrpack") {
            root.join("imports")
        } else if lower.ends_with(".zip") {
            // определяем ресурспак / шейдеры по содержимому
            classify_zip(&src, &root)
        } else if lower.ends_with(".prtheme") || lower.ends_with(".css") {
            crate::commands::version_manager::mc_base_dir().join("themes")
        } else {
            return Err(format!("{name}: поддерживаются только .jar, .zip и .mrpack файлы Minecraft"));
        };

        std::fs::create_dir_all(&dest_dir).ok();
        let dest = dest_dir.join(&name);
        if src.is_dir() {
            copy_dir(&src, &dest)?;
        } else {
            std::fs::copy(&src, &dest).map_err(|e| format!("{name}: {e}"))?;
        }
        installed.push(
            dest.strip_prefix(&root)
                .map(|p| p.to_string_lossy().to_string())
                .unwrap_or_else(|_| dest.to_string_lossy().to_string()),
        );
    }
    Ok(installed)
}

fn classify_zip(src: &Path, root: &Path) -> PathBuf {
    let Ok(file) = std::fs::File::open(src) else {
        return root.join("resourcepacks");
    };
    let Ok(mut zip) = zip::ZipArchive::new(file) else {
        return root.join("resourcepacks");
    };
    let mut has_shaders = false;
    let mut has_level = false;
    let mut has_resource_assets = false;
    for i in 0..zip.len().min(400) {
        if let Ok(entry) = zip.by_index(i) {
            let n = entry.name().to_lowercase();
            if n.contains("shaders/") || n.ends_with("shaders.properties") {
                has_shaders = true;
            }
            if n.ends_with("level.dat") {
                has_level = true;
            }
            if n.starts_with("assets/") || n.contains("/assets/") || n.ends_with("pack.mcmeta") {
                has_resource_assets = true;
            }
        }
    }
    if has_shaders {
        root.join("shaderpacks")
    } else if has_level {
        root.join("saves")
    } else if has_resource_assets {
        root.join("resourcepacks")
    } else {
        // ZIP archive without a shader or world marker is treated as a
        // resource-pack candidate. Minecraft itself validates `pack.mcmeta`
        // when the instance starts, while the launcher keeps it out of mods.
        root.join("resourcepacks")
    }
}

fn copy_dir(from: &Path, to: &Path) -> Result<(), String> {
    std::fs::create_dir_all(to).map_err(|e| e.to_string())?;
    for entry in std::fs::read_dir(from).map_err(|e| e.to_string())?.flatten() {
        let p = entry.path();
        let dest = to.join(entry.file_name());
        if p.is_dir() {
            copy_dir(&p, &dest)?;
        } else {
            std::fs::copy(&p, &dest).map_err(|e| e.to_string())?;
        }
    }
    Ok(())
}

// ─────────────────────────────────────────────────────────────────────────────
// Миры и серверы
// ─────────────────────────────────────────────────────────────────────────────

#[tauri::command]
pub fn instance_list_worlds(instance_id: String) -> Result<Vec<WorldInfo>, String> {
    let saves = instance_game_dir(&instance_id).join("saves");
    std::fs::create_dir_all(&saves).ok();
    let mut out = Vec::new();
    for entry in std::fs::read_dir(&saves).map_err(|e| e.to_string())?.flatten() {
        let dir = entry.path();
        if !dir.is_dir() {
            continue;
        }
        let folder = entry.file_name().to_string_lossy().to_string();
        let level = dir.join("level.dat");
        let (mut name, mut last_played) = (folder.clone(), None);
        if let Some(data) = nbt::read_maybe_gzip(&level) {
            if let Some(n) = nbt::find_string(&data, "LevelName") {
                name = n;
            }
            last_played = nbt::find_long(&data, "LastPlayed");
        }
        let icon_path = dir.join("icon.png");
        let icon = std::fs::read(&icon_path).ok().map(|bytes| format!(
            "data:image/png;base64,{}",
            base64::engine::general_purpose::STANDARD.encode(bytes),
        ));
        out.push(WorldInfo {
            folder,
            name,
            icon,
            last_played,
            size_mb: dir_size(&dir) / (1024 * 1024),
            game_mode: None,
        });
    }
    out.sort_by(|a, b| b.last_played.cmp(&a.last_played));
    Ok(out)
}

#[tauri::command]
pub fn instance_list_servers(instance_id: String) -> Result<Vec<ServerInfo>, String> {
    let path = instance_game_dir(&instance_id).join("servers.dat");
    if !path.exists() {
        return Ok(vec![]);
    }
    let data = nbt::read_maybe_gzip(&path).ok_or("не удалось прочитать servers.dat")?;
    let names = nbt::find_all_strings(&data, "name");
    let ips = nbt::find_all_strings(&data, "ip");
    let icons = nbt::find_all_strings(&data, "icon");
    let mut out = Vec::new();
    for (i, address) in ips.iter().enumerate() {
        out.push(ServerInfo {
            name: names.get(i).cloned().unwrap_or_else(|| address.clone()),
            address: address.clone(),
            icon: icons.get(i).map(|b| format!("data:image/png;base64,{b}")),
        });
    }
    Ok(out)
}

#[tauri::command]
pub fn instance_delete_world(instance_id: String, folder: String) -> Result<(), String> {
    let dir = safe_join(&instance_id, &format!("saves/{folder}"))?;
    crate::commands::mods::move_instance_content_to_recovery(&instance_id, dir, "saves", false).map(|_| ())
}

/// Добавляет сервер в servers.dat сборки (простая запись NBT).
#[tauri::command]
pub fn instance_add_server(
    instance_id: String,
    name: String,
    address: String,
) -> Result<(), String> {
    let path = instance_game_dir(&instance_id).join("servers.dat");
    let mut existing = if path.exists() {
        instance_list_servers(instance_id.clone())?
    } else {
        vec![]
    };
    existing.push(ServerInfo {
        name,
        address,
        icon: None,
    });
    write_servers_dat(&path, &existing)
}

fn write_servers_dat(path: &Path, servers: &[ServerInfo]) -> Result<(), String> {
    // NBT: TAG_Compound "" { TAG_List "servers" of TAG_Compound { name, ip } }
    let mut buf: Vec<u8> = Vec::new();
    buf.push(0x0a); // compound
    buf.extend_from_slice(&0u16.to_be_bytes()); // пустое имя
    buf.push(0x09); // list
    let key = b"servers";
    buf.extend_from_slice(&(key.len() as u16).to_be_bytes());
    buf.extend_from_slice(key);
    buf.push(0x0a); // элементы — compound
    buf.extend_from_slice(&(servers.len() as i32).to_be_bytes());
    for s in servers {
        for (tag, value) in [("name", &s.name), ("ip", &s.address)] {
            buf.push(0x08); // string
            buf.extend_from_slice(&(tag.len() as u16).to_be_bytes());
            buf.extend_from_slice(tag.as_bytes());
            buf.extend_from_slice(&(value.len() as u16).to_be_bytes());
            buf.extend_from_slice(value.as_bytes());
        }
        buf.push(0x00); // end compound
    }
    buf.push(0x00); // end root
    std::fs::write(path, buf).map_err(|e| e.to_string())
}

/// Результат публикации лога в mclo.gs.
#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct McLogsPublishResult {
    pub id: String,
    pub url: String,
    pub raw_url: Option<String>,
    pub errors: u64,
    pub lines: u64,
    pub insights: Option<serde_json::Value>,
    pub diagnosis: Option<CrashDiagnosis>,
}

/// Публикует лог через официальный API mclo.gs и возвращает ссылку и найденные insights.
#[tauri::command]
pub async fn publish_log_mclogs(
    content: String,
    source: Option<String>,
    instance_id: Option<String>,
    minecraft_version: Option<String>,
    loader: Option<String>,
) -> Result<McLogsPublishResult, String> {
    let mut lines = content.lines().take(25_000).collect::<Vec<_>>().join("\\n");
    if lines.chars().count() > 10 * 1024 * 1024 {
        lines = lines.chars().take(10 * 1024 * 1024).collect();
    }
    if lines.trim().is_empty() {
        return Err("Лог пустой и не может быть отправлен".into());
    }

    let mut metadata = Vec::new();
    if let Some(value) = instance_id.filter(|v| !v.trim().is_empty()) {
        metadata.push(serde_json::json!({ "key": "instance_id", "value": value, "visible": false }));
    }
    if let Some(value) = minecraft_version.filter(|v| !v.trim().is_empty()) {
        metadata.push(serde_json::json!({ "key": "minecraft_version", "value": value, "label": "Minecraft", "visible": true }));
    }
    if let Some(value) = loader.filter(|v| !v.trim().is_empty()) {
        metadata.push(serde_json::json!({ "key": "loader", "value": value, "label": "Loader", "visible": true }));
    }

    let diagnosis = diagnose_crash_log(&lines);
    let body = serde_json::json!({
        "content": lines,
        "source": source.unwrap_or_else(|| "Portal Launcher".into()),
        "metadata": metadata,
    });
    let client = reqwest::Client::builder()
        .user_agent("PortalLauncher/1.0 (mclo.gs integration)")
        .build()
        .map_err(|e| format!("mclo.gs client: {e}"))?;
    let response = client
        .post("https://api.mclo.gs/1/log")
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("mclo.gs upload: {e}"))?;
    let status = response.status();
    let created: serde_json::Value = response.json().await.map_err(|e| format!("mclo.gs response: {e}"))?;
    if !status.is_success() || created["success"].as_bool() != Some(true) {
        return Err(created["error"].as_str().unwrap_or("mclo.gs не принял лог").to_string());
    }

    let id = created["id"].as_str().ok_or("mclo.gs не вернул ID лога")?.to_string();
    let insights = match client
        .get(format!("https://api.mclo.gs/1/log/{id}?insights=true"))
        .send()
        .await
    {
        Ok(reply) => reply
            .json::<serde_json::Value>()
            .await
            .ok()
            .and_then(|value| value.get("content").and_then(|content| content.get("insights")).cloned()),
        Err(_) => None,
    };

    Ok(McLogsPublishResult {
        id,
        url: created["url"].as_str().unwrap_or("").to_string(),
        raw_url: created["raw"].as_str().map(str::to_string),
        errors: created["errors"].as_u64().unwrap_or(0),
        lines: created["lines"].as_u64().unwrap_or(0),
        insights,
        diagnosis,
    })
}

#[tauri::command]
pub fn instance_open_dir(instance_id: String, path: Option<String>) -> Result<(), String> {
    let target = safe_join(&instance_id, &path.unwrap_or_default())?;
    std::fs::create_dir_all(&target).ok();
    let target = target.to_string_lossy().to_string();
    #[cfg(target_os = "windows")]
    crate::utils::create_hidden_command("explorer").arg(&target).spawn().map_err(|e| e.to_string())?;
    #[cfg(target_os = "macos")]
    crate::utils::create_hidden_command("open").arg(&target).spawn().map_err(|e| e.to_string())?;
    #[cfg(all(unix, not(target_os = "macos")))]
    crate::utils::create_hidden_command("xdg-open").arg(&target).spawn().map_err(|e| e.to_string())?;
    Ok(())
}

/// Сводка по сборке для панели (как в Modrinth App).
#[tauri::command]
pub fn instance_overview(instance_id: String) -> Result<serde_json::Value, String> {
    let root = instance_game_dir(&instance_id);
    let count = |sub: &str| {
        std::fs::read_dir(root.join(sub))
            .map(|d| d.flatten().count())
            .unwrap_or(0)
    };
    Ok(serde_json::json!({
        "path": root.to_string_lossy(),
        "size_mb": dir_size(&root) / (1024 * 1024),
        "mods": count("mods"),
        "resourcepacks": count("resourcepacks"),
        "shaderpacks": count("shaderpacks"),
        "worlds": count("saves"),
        "screenshots": count("screenshots"),
        "running": crate::mc::launch::get_running_instances().contains(&instance_id),
    }))
}

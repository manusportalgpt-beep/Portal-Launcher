//! OpenPortal — встроенный ИИ-агент лаунчера (альтернатива OpenCode).
//!
//! Хранение в `<mc_base_dir>/OpenPortal/`:
//!   Projects/  — песочница проектов («OpenPortal – Portal Projects»)
//!   Sessions/  — чаты/история сессий
//!   Cache/     — кеш (веб, карточки, контекст)
//!   Config/    — config.json (провайдеры/модели), permissions.json (разрешения)
//!
//! Файловые операции и запуск команд — строго в разрешённых корнях
//! (песочница, Temp, каталог лаунчера), без возможности выйти за их пределы.

use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use base64::Engine as _;
use std::io::{Read, Write};

const MAX_TEXT_READ: usize = 512 * 1024;
const MAX_FETCH_BYTES: usize = 2 * 1024 * 1024;
const DEFAULT_CMD_TIMEOUT_MS: u64 = 120_000;

// ---------------------------------------------------------------------------
// Каталоги
// ---------------------------------------------------------------------------

pub fn openportal_dir() -> PathBuf {
    crate::commands::version_manager::mc_base_dir().join("OpenPortal")
}

pub fn projects_dir() -> PathBuf {
    openportal_dir().join("Projects")
}

pub fn sessions_dir() -> PathBuf {
    openportal_dir().join("Sessions")
}

pub fn cache_dir() -> PathBuf {
    openportal_dir().join("Cache")
}

pub fn config_dir() -> PathBuf {
    openportal_dir().join("Config")
}

pub fn images_dir() -> PathBuf {
    cache_dir().join("images")
}

pub fn skills_dir() -> PathBuf {
    openportal_dir().join("Skills")
}

fn ensure_all() {
    for d in [
        openportal_dir(),
        projects_dir(),
        sessions_dir(),
        cache_dir(),
        config_dir(),
        images_dir(),
        skills_dir(),
    ] {
        std::fs::create_dir_all(&d).ok();
    }
}

/// Системная папка Temp (для временной работы агента).
fn system_temp_dir() -> PathBuf {
    std::env::temp_dir()
}

fn launcher_settings_path() -> PathBuf {
    crate::commands::version_manager::mc_base_dir().join("settings.json")
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct PortalLayout {
    pub base: String,
    pub projects: String,
    pub sessions: String,
    pub cache: String,
    pub config: String,
    pub temp: String,
    pub launcher: String,
}

#[tauri::command]
pub fn op_layout() -> PortalLayout {
    ensure_all();
    PortalLayout {
        base: openportal_dir().to_string_lossy().to_string(),
        projects: projects_dir().to_string_lossy().to_string(),
        sessions: sessions_dir().to_string_lossy().to_string(),
        cache: cache_dir().to_string_lossy().to_string(),
        config: config_dir().to_string_lossy().to_string(),
        temp: system_temp_dir().to_string_lossy().to_string(),
        launcher: crate::commands::version_manager::mc_base_dir().to_string_lossy().to_string(),
    }
}

// ---------------------------------------------------------------------------
// Песочница путей
// ---------------------------------------------------------------------------

/// Корневые зоны, в которых агенту разрешено работать.
#[derive(Debug, Clone, Copy)]
enum Root {
    /// OpenPortal + все подпапки (проекты, сессии, конфиг) — полный доступ.
    Portal,
    /// Системная Temp — полный доступ.
    Temp,
    /// Каталог лаунчера (`<mc_base_dir>`) — чтение + запись только settings.json.
    Launcher,
}

fn root_path(root: Root) -> PathBuf {
    match root {
        Root::Portal => openportal_dir(),
        Root::Temp => system_temp_dir(),
        Root::Launcher => crate::commands::version_manager::mc_base_dir(),
    }
}

fn canonical(p: &Path) -> Option<PathBuf> {
    std::fs::canonicalize(p).ok()
}

/// Проверяет, что `path` находится внутри корня `root`.
/// Для записи в Launcher разрешён только settings.json на верхнем уровне,
/// либо любая папка ативной сборки (instance), выбранной в OpenPortal.
fn enforce_root(root: Root, path: &Path, write: bool) -> Result<PathBuf, String> {
    let base = root_path(root);
    let base = canonical(&base).unwrap_or(base);
    if matches!(root, Root::Launcher) && write {
        // Launcher: всегда можно трогать только settings.json…
        let settings = launcher_settings_path();
        let settings = canonical(&settings).unwrap_or(settings);
        if path == settings {
            return Ok(settings);
        }
        // …и полные права внутри папки активной сборки (изменения подтверждаются
        // пермишн-модалкой — запись в любой момент может быть отклонена).
        if let Some(dir) = active_build_dir() {
            if let Some(p) = canonical(path) {
                if p.starts_with(&dir) {
                    return Ok(p);
                }
            }
        }
        return Err(
            "Запись разрешена только в settings.json лаунчера или внутри выбранной сборки."
                .into(),
        );
    }
    let ok = if write {
        // Для записи файл может ещё не существовать — канонизируем родителя.
        let parent = path.parent().unwrap_or(&base);
        canonical(parent)
            .map(|p| p.starts_with(&base))
            .unwrap_or(false)
    } else {
        canonical(path)
            .map(|p| p.starts_with(&base))
            .unwrap_or(false)
    };
    if !ok {
        return Err(format!(
            "Путь вне разрешённой зоны: {}",
            path.to_string_lossy()
        ));
    }
    Ok(canonical(path).unwrap_or_else(|| path.to_path_buf()))
}

// ---------------------------------------------------------------------------
// Активная сборка
// ---------------------------------------------------------------------------

/// Разрешает id сборки в папку инстанса. Никакие произвольные пути от клиента
/// не принимаются — только существующие инстансы из каталога лаунчера.
fn valid_instance_dir(id: &str) -> Option<PathBuf> {
    if !is_safe_id(id) {
        return None;
    }
    let dir = crate::commands::instances::instances_dir().join(id);
    if dir.join("instance.json").is_file() {
        Some(dir)
    } else {
        None
    }
}

fn active_build_id() -> Option<String> {
    let p = config_dir().join("active_build.json");
    let raw = std::fs::read_to_string(&p).ok()?;
    let v: serde_json::Value = serde_json::from_str(&raw).ok()?;
    v.get("instance_id").and_then(|x| x.as_str()).map(|s| s.to_string())
}

fn active_build_dir() -> Option<PathBuf> {
    let id = active_build_id()?;
    valid_instance_dir(&id)
}

/// Задаёт активную сборку для OpenPortal (`None` — «без сборки»).
#[tauri::command]
pub fn op_set_active_build(instance_id: Option<String>) -> Result<(), String> {
    ensure_all();
    if let Some(id) = &instance_id {
        if valid_instance_dir(id).is_none() {
            return Err(format!("Сборка не найдена: {id}"));
        }
    }
    let payload = serde_json::json!({ "instance_id": instance_id });
    std::fs::write(
        config_dir().join("active_build.json"),
        serde_json::to_string(&payload).unwrap_or_default(),
    )
    .map_err(|e| format!("Запись активной сборки: {e}"))
}

/// Возвращает абсолютный путь папки сборки (для системного промпта и UI).
#[tauri::command]
pub fn op_resolve_build(instance_id: String) -> Result<String, String> {
    let dir = valid_instance_dir(&instance_id)
        .ok_or_else(|| format!("Сборка не найдена: {instance_id}"))?;
    Ok(dir.to_string_lossy().to_string())
}

// ---------------------------------------------------------------------------
// Навыки (SKILL.md) — агент может создавать/устанавливать их сам
// ---------------------------------------------------------------------------

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct SkillMeta {
    /// slug папки навыка (например `file-browser`).
    pub name: String,
    /// Абсолютный путь к папке навыка.
    pub path: String,
    /// Короткое описание из frontmatter SKILL.md.
    pub description: String,
}

/// Список установленных навыков `OpenPortal/Skills/<slug>/SKILL.md`.
#[tauri::command]
pub fn op_list_skills() -> Vec<SkillMeta> {
    ensure_all();
    let mut out = Vec::new();
    if let Ok(rd) = std::fs::read_dir(skills_dir()) {
        for e in rd.flatten() {
            let dir = e.path();
            if !dir.is_dir() {
                continue;
            }
            let slug = dir
                .file_name()
                .map(|s| s.to_string_lossy().to_string())
                .unwrap_or_default();
            if !is_safe_id(&slug) || slug.is_empty() {
                continue;
            }
            let md = dir.join("SKILL.md");
            if !md.is_file() {
                continue;
            }
            let description = std::fs::read_to_string(&md)
                .ok()
                .map(|raw| parse_skill_description(&raw))
                .unwrap_or_default();
            out.push(SkillMeta {
                name: slug,
                path: dir.to_string_lossy().to_string(),
                description,
            });
        }
    }
    out.sort_by(|a, b| a.name.cmp(&b.name));
    out
}

/// Достаёт `description:` из frontmatter `---\n...\n---` в начале SKILL.md.
fn parse_skill_description(raw: &str) -> String {
    let body = raw.trim_start();
    let Some(stripped) = body.strip_prefix("---") else {
        return String::new();
    };
    let Some(end) = stripped.find("\n---") else {
        return String::new();
    };
    for line in stripped[..end].lines() {
        let line = line.trim();
        if let Some(rest) = line.strip_prefix("description:") {
            let v = rest.trim().trim_matches('"').trim();
            if !v.is_empty() {
                return v.to_string();
            }
        }
    }
    String::new()
}

// ---------------------------------------------------------------------------
// Изображения (генерация + чтение для чата)
// ---------------------------------------------------------------------------

/// Расширение и mime по magic-байтам картинки (PNG/JPEG/GIF/WebP), по умолчанию PNG.
fn detect_image_ext(bytes: &[u8]) -> (&'static str, &'static str) {
    if bytes.len() >= 8 && &bytes[..8] == b"\x89PNG\r\n\x1a\n" {
        return ("png", "image/png");
    }
    if bytes.len() >= 3 && &bytes[..3] == b"GIF" {
        return ("gif", "image/gif");
    }
    if bytes.len() >= 12 && &bytes[..4] == b"RIFF" && &bytes[8..12] == b"WEBP" {
        return ("webp", "image/webp");
    }
    if bytes.len() >= 3 && bytes[0] == 0xFF && bytes[1] == 0xD8 && bytes[2] == 0xFF {
        return ("jpg", "image/jpeg");
    }
    ("png", "image/png")
}

/// Разрешённый формат имени файла изображения в кеше.
fn is_safe_image_file(name: &str) -> bool {
    let lower = name.to_lowercase();
    let ext = [".png", ".jpg", ".jpeg", ".gif", ".webp"]
        .iter()
        .find(|e| lower.ends_with(*e))
        .map(|e| e.len())
        .unwrap_or(0);
    if ext == 0 {
        return false;
    }
    let stem = &lower[..lower.len() - ext];
    is_safe_id(stem)
}

/// Сохраняет сгенерированное изображение (base64 PNG) в `Cache/images/`.
/// Возвращает имя файла, которое вставляется в markdown как `/op-image/<name>`.
#[tauri::command]
pub fn op_save_image(b64: String) -> Result<String, String> {
    ensure_all();
    if b64.is_empty() || b64.len() > 30 * 1024 * 1024 {
        return Err("Изображение пустое или слишком большое.".into());
    }
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(b64.trim())
        .map_err(|e| format!("Некорректный base64: {e}"))?;
    if bytes.is_empty() {
        return Err("Изображение пустое.".into());
    }
    let (ext, _) = detect_image_ext(&bytes);
    let name = format!(
        "img-{}-{}.{}",
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_millis())
            .unwrap_or(0),
        uuid::Uuid::new_v4().simple(),
        ext,
    );
    let dest = images_dir().join(&name);
    std::fs::write(&dest, bytes).map_err(|e| format!("Запись изображения: {e}"))?;
    Ok(name)
}

/// Читает изображение из кеша как data URL для отображения/скачивания в чате.
#[tauri::command]
pub fn op_image_read(file: String) -> Result<String, String> {
    if !is_safe_image_file(&file) {
        return Err("Некорректное имя файла изображения.".into());
    }
    let path = images_dir().join(&file);
    let bytes = std::fs::read(&path).map_err(|e| format!("Чтение изображения: {e}"))?;
    if bytes.is_empty() || bytes.len() > 30 * 1024 * 1024 {
        return Err("Изображение пустое или слишком большое.".into());
    }
    let (_, mime) = detect_image_ext(&bytes);
    let b64 = base64::engine::general_purpose::STANDARD.encode(&bytes);
    Ok(format!("data:{mime};base64,{b64}"))
}

// ---------------------------------------------------------------------------
// Осмотр файлов: картинки «по пикселям» (палитра) и hexdump бинарных файлов.
// Нужно, чтобы текстовая модель (без зрения) «видела» файлы и изображения.
// ---------------------------------------------------------------------------

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct ImageColor {
    pub hex: String,
    pub share: f64,
    pub brightness: u8,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct ImageInspect {
    pub width: u32,
    pub height: u32,
    pub alpha: bool,
    pub colors: Vec<ImageColor>,
    pub dominant: String,
    pub average: String,
}

/// Анализирует изображение: размеры, палитра доминирующих цветов, яркость.
/// Результат — текстовое описание для модели, которая не умеет смотреть картинки.
#[tauri::command]
pub fn op_image_inspect(root: String, path: String) -> Result<ImageInspect, String> {
    let r = root_from_name(&root)?;
    let file = enforce_root(r, Path::new(&path), false)?;
    let meta = std::fs::metadata(&file).map_err(|e| format!("Метаданные файла: {e}"))?;
    if !meta.is_file() {
        return Err("Это не файл.".into());
    }
    if meta.len() > 30 * 1024 * 1024 {
        return Err("Файл слишком большой для анализа.".into());
    }

    let decoded = image::open(&file);
    let (width, height) = decoded.as_ref().map(|d| d.dimensions()).unwrap_or((0, 0));
    let mut counts: std::collections::HashMap<(u8, u8, u8), u64> = std::collections::HashMap::new();
    let mut total: u64 = 0;
    let mut alpha = false;
    let (mut sr, mut sg, mut sb) = (0u64, 0u64, 0u64);
    if let Ok(dyn_img) = decoded {
        let small = dyn_img.thumbnail(96, 96);
        let rgba = small.to_rgba8();
        let (w, h) = rgba.dimensions();
        let every = ((w * h) / 4000).max(1) as usize;
        let mut idx = 0usize;
        for px in rgba.pixels() {
            idx += 1;
            if idx % every != 0 {
                continue;
            }
            let (cr, cg, cb, ca) = (px[0], px[1], px[2], px[3]);
            if ca < 255 {
                alpha = true;
            }
            // Квантуем к 6 битам на канал (+1 — середина ячейки), чтобы не считать дубли.
            let (qr, qg, qb) = (((cr >> 2) << 2) + 1, ((cg >> 2) << 2) + 1, ((cb >> 2) << 2) + 1);
            *counts.entry((qr, qg, qb)).or_insert(0) += 1;
            total += 1;
            sr += cr as u64;
            sg += cg as u64;
            sb += cb as u64;
        }
    }

    let mut colors: Vec<ImageColor> = counts
        .into_iter()
        .map(|((r, g, b), n)| {
            let brightness = ((r as u32 * 299 + g as u32 * 587 + b as u32 * 114) / 1000) as u8;
            ImageColor {
                hex: format!("#{:02x}{:02x}{:02x}", r, g, b),
                share: if total > 0 { (n as f64 / total as f64) * 100.0 } else { 0.0 },
                brightness,
            }
        })
        .collect();
    colors.sort_by(|a, b| b.share.partial_cmp(&a.share).unwrap_or(std::cmp::Ordering::Equal));
    colors.truncate(12);

    let dominant = colors.first().map(|c| c.hex.clone()).unwrap_or_default();
    let average = if total > 0 {
        format!("#{:02x}{:02x}{:02x}", (sr / total) as u8, (sg / total) as u8, (sb / total) as u8)
    } else {
        String::new()
    };

    Ok(ImageInspect { width, height, alpha, colors, dominant, average })
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct HexLine {
    pub offset: u32,
    pub hex: String,
    pub ascii: String,
}

/// Показывает бинарный файл как hexdump (по 16 байт на строку) — чтобы модель
/// могла изучить неизвестные форматы без возможности открыть их.
#[tauri::command]
pub fn op_hexdump(root: String, path: String, max_bytes: Option<u64>) -> Result<Vec<HexLine>, String> {
    let r = root_from_name(&root)?;
    let file = enforce_root(r, Path::new(&path), false)?;
    let meta = std::fs::metadata(&file).map_err(|e| format!("Метаданные файла: {e}"))?;
    if !meta.is_file() {
        return Err("Это не файл.".into());
    }
    let cap = max_bytes.unwrap_or(4096).clamp(256, 65_536);
    if meta.len() > cap {
        return Err(format!("Файл больше лимита показа ({} байт > {} байт).", meta.len(), cap));
    }
    let bytes = std::fs::read(&file).map_err(|e| format!("Чтение файла: {e}"))?;
    let mut out = Vec::with_capacity(bytes.len() / 16 + 1);
    for (i, chunk) in bytes.chunks(16).enumerate() {
        let hex = chunk
            .iter()
            .map(|b| format!("{b:02x}"))
            .collect::<Vec<_>>()
            .join(" ");
        let ascii: String = chunk
            .iter()
            .map(|b| if b.is_ascii_graphic() || *b == b' ' { *b as char } else { '.' })
            .collect();
        out.push(HexLine { offset: (i * 16) as u32, hex, ascii });
    }
    Ok(out)
}

// ---------------------------------------------------------------------------
// Архивы: встроенный «7-Zip» — просмотр и распаковка .zip/.7z/.tar(+gz,bz2)
// и создание .zip/.7z. Распаковка всегда внутрь разрешённой зоны.
// ---------------------------------------------------------------------------

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct ArchiveEntry {
    pub name: String,
    pub is_dir: bool,
    pub size: u64,
}

#[derive(Debug, Clone, Copy, PartialEq)]
enum ArchiveKind {
    Zip,
    SevenZip,
    Tar,
    TarGz,
    TarBz2,
}

fn archive_kind(p: &Path) -> Result<ArchiveKind, String> {
    let name = p.file_name().map(|s| s.to_string_lossy().to_lowercase()).unwrap_or_default();
    if name.ends_with(".zip") {
        return Ok(ArchiveKind::Zip);
    }
    if name.ends_with(".7z") {
        return Ok(ArchiveKind::SevenZip);
    }
    if name.ends_with(".tar.gz") || name.ends_with(".tgz") {
        return Ok(ArchiveKind::TarGz);
    }
    if name.ends_with(".tar.bz2") || name.ends_with(".tbz2") {
        return Ok(ArchiveKind::TarBz2);
    }
    if name.ends_with(".tar") {
        return Ok(ArchiveKind::Tar);
    }
    Err("Поддерживаются только архивы: .zip, .7z, .tar, .tar.gz, .tar.bz2. Файл должен лежать внутри разрешённой зоны.".into())
}

fn tar_reader(p: &Path, kind: ArchiveKind) -> Result<Box<dyn Read>, String> {
    let f = std::fs::File::open(p).map_err(|e| format!("Открытие архива: {e}"))?;
    Ok(match kind {
        ArchiveKind::TarGz => Box::new(flate2::read::GzDecoder::new(f)),
        ArchiveKind::TarBz2 => Box::new(bzip2::read::BzDecoder::new(f)),
        ArchiveKind::Tar => Box::new(f),
        _ => return Err("Не tar-архив.".into()),
    })
}

/// Не даём распаковке выйти за пределы папки назначения (защита от zip-slip).
fn is_safe_relative(rel: &Path) -> bool {
    !rel.is_absolute()
        && rel.components().all(|c| {
            !matches!(
                c,
                std::path::Component::ParentDir
                    | std::path::Component::RootDir
                    | std::path::Component::Prefix(_)
            )
        })
}

/// Список содержимого архива (без распаковки).
#[tauri::command]
pub fn op_archive_list(root: String, path: String) -> Result<Vec<ArchiveEntry>, String> {
    let r = root_from_name(&root)?;
    let file = enforce_root(r, Path::new(&path), false)?;
    let meta = std::fs::metadata(&file).map_err(|e| format!("Метаданные файла: {e}"))?;
    if !meta.is_file() {
        return Err("Это не файл.".into());
    }
    if meta.len() > 1024 * 1024 * 1024 {
        return Err("Архив слишком большой.".into());
    }
    let kind = archive_kind(&file)?;
    let mut out: Vec<ArchiveEntry> = Vec::new();

    match kind {
        ArchiveKind::Zip => {
            let f = std::fs::File::open(&file).map_err(|e| format!("Открытие архива: {e}"))?;
            let mut archive = zip::ZipArchive::new(f).map_err(|e| format!("Не удалось открыть ZIP: {e}"))?;
            for i in 0..archive.len() {
                let e = archive.by_index(i).map_err(|err| err.to_string())?;
                out.push(ArchiveEntry {
                    name: e.name().to_string(),
                    is_dir: e.is_dir(),
                    size: e.size(),
                });
            }
        }
        ArchiveKind::SevenZip => {
            let archive = sevenz_rust::Archive::open(&file)
                .map_err(|e| format!("Не удалось открыть 7z: {e}"))?;
            for e in &archive.files {
                out.push(ArchiveEntry {
                    name: e.name().to_string(),
                    is_dir: e.is_directory(),
                    size: e.size(),
                });
            }
        }
        ArchiveKind::Tar | ArchiveKind::TarGz | ArchiveKind::TarBz2 => {
            let rdr = tar_reader(&file, kind)?;
            let mut archive = tar::Archive::new(rdr);
            for entry in archive.entries().map_err(|e| e.to_string())? {
                let entry = entry.map_err(|e| e.to_string())?;
                let name = entry.path().map(|p| p.to_string_lossy().to_string()).unwrap_or_default();
                out.push(ArchiveEntry {
                    name,
                    is_dir: entry.header().entry_type().is_dir(),
                    size: entry.header().size().unwrap_or(0),
                });
            }
        }
    }

    Ok(out)
}

fn extract_tar(rdr: Box<dyn Read>, dest: &Path) -> Result<(), String> {
    let mut archive = tar::Archive::new(rdr);
    archive.set_preserve_permissions(false);
    for entry in archive.entries().map_err(|e| e.to_string())? {
        let mut entry = entry.map_err(|e| e.to_string())?;
        let rel = entry.path().map(|p| p.to_path_buf()).unwrap_or_default();
        if !is_safe_relative(&rel) {
            continue; // пропускаем опасные пути (.., абсолютные)
        }
        let target = dest.join(&rel);
        if entry.header().entry_type().is_dir() {
            std::fs::create_dir_all(&target).ok();
        } else {
            if let Some(parent) = target.parent() {
                std::fs::create_dir_all(parent).ok();
            }
            entry.unpack(&target).map_err(|e| e.to_string())?;
        }
    }
    Ok(())
}

/// Распаковывает архив. `dest_path` (необязателен) — папка внутри той же зоны;
/// по умолчанию — `OpenPortal/Cache/extracted/<имя архива>`.
#[tauri::command]
pub fn op_archive_extract(root: String, path: String, dest_path: Option<String>) -> Result<String, String> {
    let r = root_from_name(&root)?;
    let file = enforce_root(r, Path::new(&path), false)?;
    let meta = std::fs::metadata(&file).map_err(|e| format!("Метаданные файла: {e}"))?;
    if !meta.is_file() {
        return Err("Это не файл.".into());
    }
    if meta.len() > 2 * 1024 * 1024 * 1024 {
        return Err("Архив слишком большой для распаковки.".into());
    }
    let kind = archive_kind(&file)?;

    let dest = match dest_path {
        Some(dp) => enforce_root(r, Path::new(&dp), true)?,
        None => {
            let stem = file
                .file_stem()
                .map(|s| s.to_string_lossy().to_string())
                .unwrap_or_else(|| "archive".to_string());
            let stem: String = stem
                .chars()
                .filter(|c| c.is_alphanumeric() || *c == '-' || *c == '_' || *c == '.')
                .collect();
            let stem = if stem.is_empty() { "archive".to_string() } else { stem };
            unique_dest_path(&cache_dir().join("extracted"), &stem)
        }
    };
    std::fs::create_dir_all(&dest).map_err(|e| format!("Создание папки: {e}"))?;

    match kind {
        ArchiveKind::Zip => {
            let f = std::fs::File::open(&file).map_err(|e| format!("Открытие архива: {e}"))?;
            let mut archive = zip::ZipArchive::new(f).map_err(|e| format!("Не удалось открыть ZIP: {e}"))?;
            archive.extract(&dest).map_err(|e| format!("Распаковка ZIP: {e}"))?;
        }
        ArchiveKind::SevenZip => {
            sevenz_rust::decompress_file(&file, &dest)
                .map_err(|e| format!("Распаковка 7z: {e}"))?;
        }
        ArchiveKind::Tar | ArchiveKind::TarGz | ArchiveKind::TarBz2 => {
            let rdr = tar_reader(&file, kind)?;
            extract_tar(rdr, &dest)?;
        }
    }

    Ok(dest.to_string_lossy().to_string())
}

fn add_to_zip(
    writer: &mut zip::ZipWriter<std::fs::File>,
    base: &Path,
    cur: &Path,
    options: &zip::write::FileOptions<()>,
) -> Result<(), String> {
    if cur.is_dir() {
        let rel = cur
            .strip_prefix(base)
            .ok()
            .map(|p| p.to_string_lossy().replace('\\', "/"))
            .unwrap_or_default();
        if !rel.is_empty() {
            writer.add_directory(format!("{rel}/"), *options).map_err(|e| e.to_string())?;
        }
        for e in std::fs::read_dir(cur).map_err(|e| e.to_string())? {
            let e = e.map_err(|e| e.to_string())?;
            add_to_zip(writer, base, &e.path(), options)?;
        }
    } else {
        let rel = cur
            .strip_prefix(base)
            .ok()
            .map(|p| p.to_string_lossy().replace('\\', "/"))
            .unwrap_or_default();
        writer.start_file(rel, *options).map_err(|e| e.to_string())?;
        let bytes = std::fs::read(cur).map_err(|e| e.to_string())?;
        writer.write_all(&bytes).map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// Создаёт архив из файла или папки. `name` — имя результата (.zip или .7z),
/// сохраняется в `OpenPortal/Cache/archives/`.
#[tauri::command]
pub fn op_archive_create(root: String, path: String, name: String) -> Result<String, String> {
    let r = root_from_name(&root)?;
    let src = enforce_root(r, Path::new(&path), false)?;
    let lower = name.to_lowercase();
    let out_name = if lower.ends_with(".zip") || lower.ends_with(".7z") {
        sanitize_download_name(&name)
    } else {
        return Err("Имя архива должно заканчиваться на .zip или .7z".into());
    };
    let dest = cache_dir().join("archives");
    std::fs::create_dir_all(&dest).map_err(|e| format!("Создание папки: {e}"))?;
    let out = unique_dest_path(&dest, &out_name);

    if lower.ends_with(".zip") {
        let file = std::fs::File::create(&out).map_err(|e| format!("Создание архива: {e}"))?;
        let mut writer = zip::ZipWriter::new(file);
        let options = zip::write::FileOptions::<()>::default()
            .compression_method(zip::CompressionMethod::Deflated)
            .unix_permissions(0o644);
        let base = if src.is_dir() {
            src.clone()
        } else {
            src.parent().map(Path::to_path_buf).unwrap_or_default()
        };
        add_to_zip(&mut writer, &base, &src, &options)?;
        writer.finish().map_err(|e| format!("Завершение архива: {e}"))?;
    } else {
        sevenz_rust::compress_to_path(&src, &out)
            .map_err(|e| format!("Создание 7z: {e}"))?;
    }

    Ok(out.to_string_lossy().to_string())
}

// ---------------------------------------------------------------------------
// Скачивание файлов в системную папку «Загрузки»
// ---------------------------------------------------------------------------

/// Копирует файл (base64) в «Загрузки» текущего пользователя (Windows: %USERPROFILE%\Downloads).
#[tauri::command]
pub fn op_save_to_downloads(file_name: String, b64: String) -> Result<String, String> {
    if b64.is_empty() || b64.len() > 100 * 1024 * 1024 {
        return Err("Файл пустой или слишком большой (лимит 100 МБ).".into());
    }
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(b64.trim())
        .map_err(|e| format!("Некорректный base64: {e}"))?;
    if bytes.is_empty() {
        return Err("Файл пустой.".into());
    }
    let name = sanitize_download_name(&file_name);
    let dir = downloads_dir().ok_or_else(|| "Не удалось найти папку «Загрузки».".to_string())?;
    std::fs::create_dir_all(&dir).ok();
    let dest = unique_dest_path(&dir, &name);
    std::fs::write(&dest, &bytes).map_err(|e| format!("Сохранение файла: {e}"))?;
    Ok(dest.to_string_lossy().to_string())
}

fn downloads_dir() -> Option<PathBuf> {
    for env_name in ["USERPROFILE", "HOME"] {
        if let Some(p) = std::env::var_os(env_name) {
            let d = PathBuf::from(p).join("Downloads");
            if d.is_dir() || d.parent().is_some() {
                return Some(d);
            }
        }
    }
    None
}

/// Оставляет из имени только безопасное имя файла (без путей и служебных символов).
fn sanitize_download_name(name: &str) -> String {
    let base: String = name
        .rsplit(|c| c == '/' || c == '\\')
        .next()
        .unwrap_or("file.bin")
        .trim()
        .chars()
        .filter(|c| !matches!(c, '<' | '>' | ':' | '"' | '/' | '\\' | '|' | '?' | '*' | '\0'))
        .collect();
    let base = base.trim().trim_matches('.').to_string();
    if base.is_empty() {
        return "file.bin".to_string();
    }
    if base.chars().count() > 120 {
        let ext = Path::new(&base)
            .extension()
            .map(|e| e.to_string_lossy().to_string())
            .unwrap_or_default();
        let trimmed: String = base.chars().take(110).collect();
        return if ext.is_empty() { trimmed } else { format!("{trimmed}.{ext}") };
    }
    base
}

/// Если файл с таким именем уже существует — добавить « (1)», « (2)» и т.д.
fn unique_dest_path(dir: &Path, name: &str) -> PathBuf {
    let p = dir.join(name);
    if !p.exists() {
        return p;
    }
    let stem = Path::new(name)
        .file_stem()
        .map(|s| s.to_string_lossy().to_string())
        .unwrap_or_else(|| "file".to_string());
    let ext = Path::new(name)
        .extension()
        .map(|e| format!(".{}", e.to_string_lossy().to_string()))
        .unwrap_or_default();
    for i in 1..100 {
        let cand = dir.join(format!("{stem} ({i}){ext}"));
        if !cand.exists() {
            return cand;
        }
    }
    p
}

/// Копирует файл из песочницы (portal|temp) в системную папку «Загрузки».
/// `path` — путь относительно корня зоны, `name` (необязательно) — имя файла-результата.
#[tauri::command]
pub fn op_copy_to_downloads(root: String, path: String, name: Option<String>) -> Result<String, String> {
    let r = root_from_name(&root)?;
    let p = Path::new(&path);
    let file = enforce_root(r, p, false)?;
    let meta = std::fs::metadata(&file).map_err(|e| format!("Метаданные файла: {e}"))?;
    if !meta.is_file() {
        return Err("Это не файл — скачать можно только файл.".into());
    }
    if meta.len() > 200 * 1024 * 1024 {
        return Err("Файл слишком большой для скачивания (лимит 200 МБ).".into());
    }
    let fallback = file
        .file_name()
        .map(|s| s.to_string_lossy().to_string())
        .unwrap_or_else(|| "file.bin".to_string());
    let out_name = name
        .map(|n| sanitize_download_name(&n))
        .unwrap_or_else(|| sanitize_download_name(&fallback));
    let dir = downloads_dir().ok_or_else(|| "Не удалось найти папку «Загрузки».".to_string())?;
    std::fs::create_dir_all(&dir).ok();
    let dest = unique_dest_path(&dir, &out_name);
    std::fs::copy(&file, &dest).map_err(|e| format!("Копирование файла: {e}"))?;
    Ok(dest.to_string_lossy().to_string())
}

// ---------------------------------------------------------------------------
// Сессии
// ---------------------------------------------------------------------------

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct SessionMeta {
    pub id: String,
    pub title: String,
    pub updated: u64,
    pub message_count: u32,
}

fn session_file(id: &str) -> PathBuf {
    sessions_dir().join(format!("{id}.json"))
}

fn is_safe_id(id: &str) -> bool {
    !id.is_empty() && id.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
}

fn check_id(id: &str) -> Result<(), String> {
    if is_safe_id(id) {
        Ok(())
    } else {
        Err("Некорректный id сессии".into())
    }
}

fn meta_from_json(id: &str, raw: &serde_json::Value) -> SessionMeta {
    SessionMeta {
        id: id.to_string(),
        title: raw["title"].as_str().unwrap_or("Новая сессия").to_string(),
        updated: raw["updated"]
            .as_u64()
            .unwrap_or_else(|| raw["created_at"].as_u64().unwrap_or(0)),
        message_count: raw["messages"]
            .as_array()
            .map(|a| a.len() as u32)
            .unwrap_or(0),
    }
}

#[tauri::command]
pub fn op_list_sessions() -> Vec<SessionMeta> {
    ensure_all();
    let mut out = Vec::new();
    if let Ok(rd) = std::fs::read_dir(sessions_dir()) {
        for e in rd.flatten() {
            let p = e.path();
            if p.extension().map(|x| x == "json").unwrap_or(false) {
                let id = p
                    .file_stem()
                    .map(|s| s.to_string_lossy().to_string())
                    .unwrap_or_default();
                if let Ok(raw) = std::fs::read_to_string(&p) {
                    if let Ok(v) = serde_json::from_str::<serde_json::Value>(&raw) {
                        out.push(meta_from_json(&id, &v));
                    }
                }
            }
        }
    }
    out.sort_by(|a, b| b.updated.cmp(&a.updated));
    out
}

#[tauri::command]
pub fn op_save_session(session_id: String, payload: String) -> Result<(), String> {
    ensure_all();
    check_id(&session_id)?;
    let v: serde_json::Value =
        serde_json::from_str(&payload).map_err(|e| format!("Некорректный JSON сессии: {e}"))?;
    let path = session_file(&session_id);
    std::fs::write(&path, serde_json::to_string_pretty(&v).unwrap_or(payload))
        .map_err(|e| format!("Запись сессии: {e}"))
}

#[tauri::command]
pub fn op_load_session(session_id: String) -> Result<String, String> {
    check_id(&session_id)?;
    let path = session_file(&session_id);
    std::fs::read_to_string(&path).map_err(|e| format!("Чтение сессии: {e}"))
}

#[tauri::command]
pub fn op_delete_session(session_id: String) -> Result<(), String> {
    check_id(&session_id)?;
    let path = session_file(&session_id);
    if path.exists() {
        std::fs::remove_file(&path).map_err(|e| format!("Удаление сессии: {e}"))?;
    }
    Ok(())
}

// ---------------------------------------------------------------------------
// Конфиг и разрешения
// ---------------------------------------------------------------------------

#[tauri::command]
pub fn op_load_config() -> String {
    ensure_all();
    let p = config_dir().join("config.json");
    std::fs::read_to_string(&p).unwrap_or_else(|_| "{}".to_string())
}

#[tauri::command]
pub fn op_save_config(payload: String) -> Result<(), String> {
    ensure_all();
    let _v: serde_json::Value =
        serde_json::from_str(&payload).map_err(|e| format!("Некорректный JSON конфига: {e}"))?;
    std::fs::write(config_dir().join("config.json"), payload)
        .map_err(|e| format!("Запись конфига: {e}"))
}

#[tauri::command]
pub fn op_load_permissions() -> String {
    ensure_all();
    let p = config_dir().join("permissions.json");
    std::fs::read_to_string(&p).unwrap_or_else(|_| "{}".to_string())
}

#[tauri::command]
pub fn op_save_permissions(payload: String) -> Result<(), String> {
    ensure_all();
    let _v: serde_json::Value =
        serde_json::from_str(&payload).map_err(|e| format!("Некорректный JSON разрешений: {e}"))?;
    std::fs::write(config_dir().join("permissions.json"), payload)
        .map_err(|e| format!("Запись разрешений: {e}"))
}

// ---------------------------------------------------------------------------
// Файловая панель (sandbox)
// ---------------------------------------------------------------------------

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct FsEntry {
    pub name: String,
    pub path: String,
    pub is_dir: bool,
    pub size: u64,
}

fn root_from_name(name: &str) -> Result<Root, String> {
    match name {
        "portal" => Ok(Root::Portal),
        "temp" => Ok(Root::Temp),
        "launcher" => Ok(Root::Launcher),
        _ => Err("Неизвестная зона: ожидается portal|temp|launcher".into()),
    }
}

#[tauri::command]
pub fn op_list_dir(root: String, path: String) -> Result<Vec<FsEntry>, String> {
    let r = root_from_name(&root)?;
    let p = Path::new(&path);
    let dir = enforce_root(r, p, false)?;
    let mut out = Vec::new();
    for e in std::fs::read_dir(&dir).map_err(|err| format!("Чтение каталога: {err}"))? {
        let e = e.map_err(|err| err.to_string())?;
        let ft = e.file_type().ok();
        let meta = e.metadata().ok();
        out.push(FsEntry {
            name: e.file_name().to_string_lossy().to_string(),
            path: e.path().to_string_lossy().to_string(),
            is_dir: ft.map(|f| f.is_dir()).unwrap_or(false),
            size: meta.map(|m| m.len()).unwrap_or(0),
        });
    }
    out.sort_by(|a, b| b.is_dir.cmp(&a.is_dir).then(a.name.cmp(&b.name)));
    Ok(out)
}

#[tauri::command]
pub fn op_read_text(root: String, path: String) -> Result<String, String> {
    let r = root_from_name(&root)?;
    let p = Path::new(&path);
    let file = enforce_root(r, p, false)?;
    let meta = std::fs::metadata(&file).map_err(|e| format!("Команда метаданных: {e}"))?;
    if meta.len() > MAX_TEXT_READ as u64 {
        return Err(format!(
            "Файл слишком большой для чтения в чат ({} > {} КБ).",
            meta.len(),
            MAX_TEXT_READ / 1024
        ));
    }
    if !meta.is_file() {
        return Err("Это не файл.".into());
    }
    std::fs::read_to_string(&file).map_err(|e| format!("Чтение файла: {e}"))
}

#[tauri::command]
pub fn op_write_text(root: String, path: String, content: String) -> Result<(), String> {
    let r = root_from_name(&root)?;
    let p = Path::new(&path);
    let file = enforce_root(r, p, true)?;
    std::fs::write(&file, content).map_err(|e| format!("Запись файла: {e}"))
}

#[tauri::command]
pub fn op_launcher_settings_path() -> String {
    launcher_settings_path().to_string_lossy().to_string()
}

// ---------------------------------------------------------------------------
// Запуск команд (sandbox: cwd обязательно внутри разрешённой зоны)
// ---------------------------------------------------------------------------

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct CmdResult {
    pub exit_code: i32,
    pub stdout: String,
    pub stderr: String,
    pub timed_out: bool,
}

#[tauri::command]
pub async fn op_run_command(
    root: String,
    cwd: String,
    command: String,
    timeout_ms: Option<u64>,
    shell: Option<String>,
) -> Result<CmdResult, String> {
    let r = root_from_name(&root)?;
    let cwd_path = enforce_root(r, Path::new(&cwd), false)?;
    if command.trim().is_empty() {
        return Err("Пустая команда".into());
    }
    if is_dangerous_command(&command) {
        return Err(
            "Команда заблокирована защитой OpenPortal: похоже на действие, опасное для системы."
                .into(),
        );
    }
    let use_powershell = shell.as_deref() == Some("powershell");

    let cwd_path_for_block = cwd_path.clone();
    let command_for_block = command.clone();
    let timeout = timeout_ms.unwrap_or(DEFAULT_CMD_TIMEOUT_MS).min(600_000);

    let finished = tokio::task::spawn_blocking(move || {
        let cache_env = apply_cache_env(&command_for_block);
        let parts = split_command_line(&command_for_block);
        let direct = parts.first().is_some_and(|p| {
            let p = p.to_lowercase();
            p.contains('\\') || p.contains('/') || p.ends_with(".exe")
        });
        let out = if direct && !parts.is_empty() {
            let mut program = parts.clone();
            let exe = program.remove(0);
            let mut c = crate::utils::create_hidden_command(&exe);
            c.current_dir(&cwd_path_for_block);
            c.envs(cache_env.iter().map(|(k, v)| (k, v)));
            c.args(program);
            c.stdout(std::process::Stdio::piped());
            c.stderr(std::process::Stdio::piped());
            c.output()
        } else if cfg!(target_os = "windows") && use_powershell {
            let mut c = crate::utils::create_hidden_command("powershell");
            c.current_dir(&cwd_path_for_block);
            c.envs(cache_env.iter().map(|(k, v)| (k, v)));
            c.args(["-NoProfile", "-NonInteractive", "-Command", &command_for_block]);
            c.stdout(std::process::Stdio::piped());
            c.stderr(std::process::Stdio::piped());
            c.output()
        } else if cfg!(target_os = "windows") {
            let mut c = crate::utils::create_hidden_command("cmd");
            c.current_dir(&cwd_path_for_block);
            c.envs(cache_env.iter().map(|(k, v)| (k, v)));
            c.args(["/C", &command_for_block]);
            c.stdout(std::process::Stdio::piped());
            c.stderr(std::process::Stdio::piped());
            c.output()
        } else {
            let mut c = crate::utils::create_hidden_command("sh");
            c.current_dir(&cwd_path_for_block);
            c.envs(cache_env.iter().map(|(k, v)| (k, v)));
            c.args(["-c", &command_for_block]);
            c.stdout(std::process::Stdio::piped());
            c.stderr(std::process::Stdio::piped());
            c.output()
        };
        out
    });

    match tokio::time::timeout(std::time::Duration::from_millis(timeout), finished).await {
        Ok(Ok(Ok(output))) => Ok(CmdResult {
            exit_code: output.status.code().unwrap_or(-1),
            stdout: String::from_utf8_lossy(&output.stdout).to_string(),
            stderr: String::from_utf8_lossy(&output.stderr).to_string(),
            timed_out: false,
        }),
        Ok(Ok(Err(e))) => Err(format!("Выполнение команды: {e}")),
        Ok(Err(e)) => Err(format!("Запуск фоновой команды: {e}")),
        Err(_) => Ok(CmdResult {
            exit_code: -1,
            stdout: String::new(),
            stderr: format!("Команда превысила таймаут ({} мс).", timeout),
            timed_out: true,
        }),
    }
}

/// Простой парсер командной строки Windows (уважает двойные кавычки).
/// Нужен, чтобы запускать прямые исполняемые файлы без обёртки `cmd /C`.
fn split_command_line(line: &str) -> Vec<String> {
    let mut out = Vec::new();
    let mut cur = String::new();
    let mut in_quotes = false;
    let mut started = false;
    for ch in line.chars() {
        match ch {
            '"' => in_quotes = !in_quotes,
            c if c.is_whitespace() && !in_quotes => {
                if started {
                    out.push(std::mem::take(&mut cur));
                    started = false;
                }
            }
            c => {
                cur.push(c);
                started = true;
            }
        }
    }
    if started {
        out.push(cur);
    }
    out
}

fn deps_cache_dir() -> PathBuf {
    cache_dir().join("deps")
}

/// Подменяет кеш-каталоги пакетных менеджеров на `OpenPortal/Cache/deps/<name>`,
/// чтобы зависимости песочницы не засоряли системный диск и чистились одной командой.
fn apply_cache_env(command: &str) -> Vec<(String, String)> {
    let lower = command.to_lowercase();
    let deps = deps_cache_dir();
    let mut env: Vec<(String, String)> = Vec::new();
    if lower.contains("npm") {
        let d = deps.join("npm");
        std::fs::create_dir_all(&d).ok();
        env.push(("npm_config_cache".into(), d.to_string_lossy().into_owned()));
    }
    if lower.contains("pnpm") {
        let d = deps.join("pnpm");
        std::fs::create_dir_all(&d).ok();
        env.push(("PNPM_STORE_DIR".into(), d.to_string_lossy().into_owned()));
        env.push(("npm_config_store_dir".into(), d.to_string_lossy().into_owned()));
    }
    if lower.contains("yarn") {
        let d = deps.join("yarn");
        std::fs::create_dir_all(&d).ok();
        env.push(("YARN_CACHE_FOLDER".into(), d.to_string_lossy().into_owned()));
    }
    env
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct CacheInfo {
    pub root: String,
    pub deps: Vec<CacheDirInfo>,
    pub total_size: u64,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct CacheDirInfo {
    pub name: String,
    pub path: String,
    pub size: u64,
}

/// Суммарный размер файлов в папке (рекурсивно), с бюджетом проходов.
fn dir_size_rec(path: &Path, budget: &mut u64) -> u64 {
    let mut total = 0u64;
    if let Ok(rd) = std::fs::read_dir(path) {
        for e in rd.flatten() {
            if *budget == 0 {
                break;
            }
            *budget -= 1;
            let p = e.path();
            if e.file_type().map(|t| t.is_dir()).unwrap_or(false) {
                total += dir_size_rec(&p, budget);
            } else if let Ok(m) = e.metadata() {
                total += m.len();
            }
        }
    }
    total
}

/// Справка по кешу зависимостей песочницы (`Cache/deps/npm|pnpm|yarn|corepack`).
#[tauri::command]
pub fn op_cache_info() -> Result<CacheInfo, String> {
    ensure_all();
    let root = deps_cache_dir();
    std::fs::create_dir_all(&root).ok();
    let mut budget = 20_000u64;
    let mut deps = Vec::new();
    for name in ["npm", "pnpm", "yarn", "corepack"] {
        let d = root.join(name);
        let size = if d.exists() { dir_size_rec(&d, &mut budget) } else { 0 };
        deps.push(CacheDirInfo { name: name.to_string(), path: d.to_string_lossy().to_string(), size });
    }
    let total_size = deps.iter().map(|d| d.size).sum();
    Ok(CacheInfo { root: root.to_string_lossy().to_string(), deps, total_size })
}

/// Очищает кеш зависимостей песочницы. `what`: npm|pnpm|yarn|corepack|all (по умолчанию всё).
/// Не затрагивает `Cache/images`, web-кеш и проекты.
#[tauri::command]
pub fn op_clear_cache(what: Option<String>) -> Result<CacheInfo, String> {
    let root = deps_cache_dir();
    let targets: Vec<String> = match what.as_deref() {
        Some(w) => {
            let w = w.to_lowercase();
            if w == "all" {
                vec!["npm", "pnpm", "yarn", "corepack"].into_iter().map(String::from).collect()
            } else {
                vec![w.to_string()]
            }
        }
        None => vec!["npm", "pnpm", "yarn", "corepack"].into_iter().map(String::from).collect(),
    };
    for name in &targets {
        let d = root.join(name);
        if d.exists() {
            std::fs::remove_dir_all(&d).ok();
        }
    }
    op_cache_info()
}

/// Вручную заблокированные деструктивные/системные паттерны команд.
/// Срабатывает до запуска процесса — такие команды запрещены всегда,
/// независимо от выданного разрешения.
fn is_dangerous_command(cmd: &str) -> bool {
    let lower = cmd.to_lowercase();
    const PATTERNS: &[&str] = &[
        "format c:",
        "format /q /y",
        "rm -rf /",
        "rm -rf /*",
        "rm -rf ~",
        "rm -rf c:",
        "rd /s /q c:",
        "rd /s c:\\windows",
        "del /s /q c:",
        "del c:\\windows",
        "deltree /y c:",
        "rd /s /q \"c:",
        "shutdown",
        "halt",
        "poweroff",
        "diskpart",
        "mountvol",
        "bcdedit",
        "reg add hklm",
        "reg delete hklm",
        "reg add hkcu /v run",
        "reg add hkcu\\software\\microsoft\\windows\\currentversion\\run",
        "schtasks",
        "net user",
        "net localgroup",
        "certutil",
        "esentutl",
        "powershell -e",
        "powershell -enc",
        "powershell -encodedcommand",
        "pwsh -e",
        "invoke-expression",
        "iex(",
        "rundll32",
    ];
    PATTERNS.iter().any(|p| lower.contains(p))
}

// ---------------------------------------------------------------------------
// WebFetch (обход CORS через бэкенд)
// ---------------------------------------------------------------------------

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct FetchResult {
    pub ok: bool,
    pub status: u16,
    pub content_type: String,
    pub text: String,
    pub error: Option<String>,
}

#[tauri::command]
pub async fn op_web_fetch(url: String, headers: Option<Vec<(String, String)>>) -> FetchResult {
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(60))
        .http1_only()
        .user_agent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36")
        .build()
        .unwrap_or_else(|_| reqwest::Client::new());
    let mut req = client.get(&url);
    if let Some(hs) = headers {
        for (k, v) in hs {
            if let (Ok(k), Ok(v)) = (reqwest::header::HeaderName::from_bytes(k.as_bytes()), reqwest::header::HeaderValue::from_str(&v)) {
                req = req.header(k, v);
            }
        }
    }
    match req.send().await {
        Ok(resp) => {
            let status = resp.status().as_u16();
            let content_type = resp
                .headers()
                .get(reqwest::header::CONTENT_TYPE)
                .and_then(|v| v.to_str().ok())
                .unwrap_or("")
                .to_string();
            let bytes = match resp.bytes().await {
                Ok(b) => b,
                Err(e) => {
                    return FetchResult {
                        ok: false,
                        status,
                        content_type,
                        text: String::new(),
                        error: Some(format!("Чтение тела: {e}")),
                    }
                }
            };
            let truncated = bytes.len() > MAX_FETCH_BYTES;
            let sliced = bytes.iter().take(MAX_FETCH_BYTES).copied().collect::<Vec<u8>>();
            FetchResult {
                ok: status < 400,
                status,
                content_type,
                text: String::from_utf8_lossy(&sliced).to_string(),
                error: Some(if truncated {
                    format!("Ответ обрезан на {} КБ.", MAX_FETCH_BYTES / 1024)
                } else {
                    String::new()
                })
                .filter(|e| !e.is_empty()),
            }
        }
        Err(e) => FetchResult {
            ok: false,
            status: 0,
            content_type: String::new(),
            text: String::new(),
            error: Some(format!("Сеть: {e}")),
        },
    }
}

/// Ответ двоичного GET-запроса (base64) — для скачивания изображений через бэкенд.
#[derive(serde::Serialize)]
pub struct BytesResult {
    pub ok: bool,
    pub status: u16,
    pub content_type: String,
    pub b64: String,
    pub error: Option<String>,
}

/// Скачивает бинарный ответ по URL (base64). Обходит CORS/сетевые лимиты веб-вью.
#[tauri::command]
pub async fn op_http_get_bytes(
    url: String,
    headers: Option<Vec<(String, String)>>,
) -> Result<BytesResult, String> {
    if !url.starts_with("http://") && !url.starts_with("https://") {
        return Err("Некорректный URL — только http/https.".into());
    }
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(60))
        .http1_only()
        .user_agent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36")
        .build()
        .unwrap_or_else(|_| reqwest::Client::new());
    let mut req = client.get(&url);
    if let Some(hs) = headers {
        for (k, v) in hs {
            if let (Ok(k), Ok(v)) = (
                reqwest::header::HeaderName::from_bytes(k.as_bytes()),
                reqwest::header::HeaderValue::from_str(&v),
            ) {
                req = req.header(k, v);
            }
        }
    }
    match req.send().await {
        Ok(resp) => {
            let status = resp.status().as_u16();
            let content_type = resp
                .headers()
                .get(reqwest::header::CONTENT_TYPE)
                .and_then(|v| v.to_str().ok())
                .unwrap_or("")
                .to_string();
            let bytes = match resp.bytes().await {
                Ok(b) => b,
                Err(e) => {
                    return Ok(BytesResult {
                        ok: false,
                        status,
                        content_type,
                        b64: String::new(),
                        error: Some(format!("Чтение тела: {e}")),
                    })
                }
            };
            if bytes.is_empty() {
                return Ok(BytesResult {
                    ok: false,
                    status,
                    content_type,
                    b64: String::new(),
                    error: Some("Пустой ответ.".into()),
                });
            }
            if bytes.len() > 30 * 1024 * 1024 {
                return Ok(BytesResult {
                    ok: false,
                    status,
                    content_type,
                    b64: String::new(),
                    error: Some("Ответ больше 30 МБ.".into()),
                });
            }
            let b64 = base64::engine::general_purpose::STANDARD.encode(&bytes);
            Ok(BytesResult {
                ok: status < 400,
                status,
                content_type,
                b64,
                error: None,
            })
        }
        Err(e) => Ok(BytesResult {
            ok: false,
            status: 0,
            content_type: String::new(),
            b64: String::new(),
            error: Some(format!("Сеть: {e}")),
        }),
    }
}

/// Универсальный HTTP-запрос к любому REST API (обход CORS через бэкенд).
/// Используется инструментами агента: `http_request`, а также как фолбэк для
/// прямых `fetch()` в вебвью (когда провайдер недоступен из-за CORS/сети).
#[tauri::command]
pub async fn op_http_request(
    url: String,
    method: Option<String>,
    headers: Option<Vec<(String, String)>>,
    body: Option<String>,
    timeout_ms: Option<u64>,
) -> FetchResult {
    let lower = url.to_lowercase();
    if !lower.starts_with("http://") && !lower.starts_with("https://") {
        return FetchResult {
            ok: false,
            status: 0,
            content_type: String::new(),
            text: String::new(),
            error: Some("Некорректный URL — только http/https.".into()),
        };
    }
    let method = method.unwrap_or_else(|| "GET".to_string());
    let method = reqwest::Method::from_bytes(method.as_bytes()).unwrap_or(reqwest::Method::GET);
    let timeout = std::time::Duration::from_millis(timeout_ms.unwrap_or(90_000).min(600_000));
    let client = reqwest::Client::builder()
        .timeout(timeout)
        .user_agent("Mozilla/5.0 (Portal-Launcher OpenPortal; like Gecko)")
        // HTTP/1.1: часть шлюзов (Cloudflare и др.) возвращает 403 на POST по
        // HTTP/2 от не-браузерных клиентов (TLS/фреймовый фингерпринт).
        .http1_only()
        .build()
        .unwrap_or_else(|_| reqwest::Client::new());
    let mut req = client.request(method, &url);
    if let Some(hs) = headers {
        for (k, v) in hs {
            if k.eq_ignore_ascii_case("host") || k.eq_ignore_ascii_case("content-length") {
                continue;
            }
            if let (Ok(k), Ok(v)) = (
                reqwest::header::HeaderName::from_bytes(k.as_bytes()),
                reqwest::header::HeaderValue::from_str(&v),
            ) {
                req = req.header(k, v);
            }
        }
    }
    if let Some(b) = body {
        req = req.body(b);
    }
    match req.send().await {
        Ok(resp) => {
            let status = resp.status().as_u16();
            let content_type = resp
                .headers()
                .get(reqwest::header::CONTENT_TYPE)
                .and_then(|v| v.to_str().ok())
                .unwrap_or("")
                .to_string();
            let bytes = match resp.bytes().await {
                Ok(b) => b,
                Err(e) => {
                    return FetchResult {
                        ok: false,
                        status,
                        content_type,
                        text: String::new(),
                        error: Some(format!("Чтение тела: {e}")),
                    }
                }
            };
            let truncated = bytes.len() > MAX_FETCH_BYTES;
            let sliced = bytes
                .iter()
                .take(MAX_FETCH_BYTES)
                .copied()
                .collect::<Vec<u8>>();
            FetchResult {
                ok: status < 400,
                status,
                content_type,
                text: String::from_utf8_lossy(&sliced).to_string(),
                error: Some(if truncated {
                    format!("Ответ обрезан на {} КБ.", MAX_FETCH_BYTES / 1024)
                } else {
                    String::new()
                })
                .filter(|e| !e.is_empty()),
            }
        }
        Err(e) => FetchResult {
            ok: false,
            status: 0,
            content_type: String::new(),
            text: String::new(),
            error: Some(format!("Сеть: {e}")),
        },
    }
}

// ---------------------------------------------------------------------------
// Listing моделей провайдера (GET {url}/models, обход CORS через бэкенд)
// ---------------------------------------------------------------------------

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct ListedModel {
    pub id: String,
    pub name: Option<String>,
}

/// Запрашивает `URL` (готовый endpoint `/models` у провайдера) и возвращает
/// список моделей в OpenAI-совместимом виде: `{ data: [ { id, name? } ] }`.
/// Используется как для OpenAI-совместимых, так и для Anthropic (`/v1/models`).
#[tauri::command]
pub async fn op_list_models(url: String, api_key: Option<String>) -> Result<Vec<ListedModel>, String> {
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(30))
        .user_agent("Mozilla/5.0 (Portal-Launcher OpenPortal; like Gecko)")
        .build()
        .unwrap_or_else(|_| reqwest::Client::new());
    let mut req = client.get(&url);
    if let Some(key) = api_key.filter(|k| !k.trim().is_empty()) {
        req = req.header("Authorization", format!("Bearer {}", key.trim()));
    }
    let resp = req.send().await.map_err(|e| format!("Сеть: {e}"))?;
    let status = resp.status();
    let text = resp.text().await.unwrap_or_default();
    if !status.is_success() {
        let snippet: String = text.chars().take(200).collect();
        return Err(format!("HTTP {} — {}", status.as_u16(), snippet));
    }
    let value: serde_json::Value = serde_json::from_str(&text).map_err(|e| format!("JSON: {e}"))?;
    let mut out: Vec<ListedModel> = Vec::new();
    if let Some(arr) = value.get("data").and_then(|d| d.as_array()) {
        for item in arr {
            if let Some(id) = item.get("id").and_then(|x| x.as_str()) {
                let name = item.get("name").and_then(|x| x.as_str()).map(|s| s.to_string());
                out.push(ListedModel { id: id.to_string(), name });
            }
        }
    } else if let Some(arr) = value.as_array() {
        for item in arr {
            if let Some(id) = item.get("id").and_then(|x| x.as_str()) {
                out.push(ListedModel { id: id.to_string(), name: None });
            }
        }
    }
    out.sort_by(|a, b| a.id.to_lowercase().cmp(&b.id.to_lowercase()));
    if out.is_empty() {
        return Err("Сервер не вернул список моделей".to_string());
    }
    Ok(out)
}
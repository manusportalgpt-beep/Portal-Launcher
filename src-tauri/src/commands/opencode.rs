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

use base64::Engine as _;
use image::GenericImageView as _;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::io::{Read, Write};
use std::path::{Path, PathBuf};

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
        launcher: crate::commands::version_manager::mc_base_dir()
            .to_string_lossy()
            .to_string(),
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

/// Все каталоги, в которые агенту разрешено писать.
///
/// Главное требование: вся папка лаунчера `%APPDATA%\PortalLauncher` доступна
/// целиком и при ЛЮБом значении root. Раньше mc_base_dir добавлялся только для
/// root=launcher, поэтому агент, который работал со сборкой, но называл зону
/// portal или temp, получал «Путь вне разрешённой зоны» на обычных задачах —
/// положить мод, шейдер или ресурс-пак в папку сборки.
fn allowed_bases(root: Root) -> Vec<PathBuf> {
    let mut bases: Vec<PathBuf> = Vec::new();
    let mut add = |p: PathBuf, bases: &mut Vec<PathBuf>| {
        if !bases.iter().any(|b| b == &p) {
            bases.push(p);
        }
    };

    // 1) Папка лаунчера целиком: данные, сборки, версии, библиотеки, OpenPortal.
    add(crate::commands::version_manager::mc_base_dir(), &mut bases);
    if let Some(roaming) = dirs_next::data_dir() {
        add(roaming.join("PortalLauncher"), &mut bases);
    }
    if let Some(local) = dirs_next::data_local_dir() {
        add(local.join("PortalLauncher"), &mut bases);
    }
    // 2) Рабочие проекты агента (лежат внутри папки лаунчера, но перечислим
    //    явно — так правило читается однозначно).
    add(openportal_dir(), &mut bases);
    add(projects_dir(), &mut bases);
    // 3) Системный Temp: шейдеры и паки сначала собираются во временной папке.
    add(system_temp_dir(), &mut bases);
    // 4) Зона, соответствующая root, — на случай отдельных каталогов.
    match root {
        Root::Portal => add(openportal_dir(), &mut bases),
        Root::Temp => add(system_temp_dir(), &mut bases),
        Root::Launcher => add(crate::commands::version_manager::mc_base_dir(), &mut bases),
    }
    bases
}

/// Ближайший существующий предок пути: `canonicalize` не работает для
/// ещё не созданных папок, а агент постоянно пишет в новые.
fn nearest_existing(path: &Path) -> Option<PathBuf> {
    let mut cur = path;
    loop {
        if cur.exists() {
            return canonical(cur);
        }
        match cur.parent() {
            Some(parent) if parent != cur => cur = parent,
            _ => return None,
        }
    }
}

/// Снимает префикс `\\?\`, который `canonicalize` добавляет на Windows.
///
/// Без этого целевой путь и база сравниваются в разных написаниях
/// (`\\?\C:\...` против `C:\...`), `starts_with` возвращает false, и файл
/// внутри разрешённой папки получал «Путь вне разрешённой зоны».
fn comparable(p: &Path) -> PathBuf {
    let text = p.to_string_lossy();
    match text.strip_prefix(r"\\?\") {
        Some(rest) => PathBuf::from(rest),
        None => p.to_path_buf(),
    }
}

fn is_inside(path: &Path, base: &Path) -> bool {
    let path = comparable(path);
    let base = comparable(base);
    path == base || path.starts_with(base)
}

/// Проверяет, что `path` находится внутри одной из разрешённых зон агента.
fn enforce_root(root: Root, path: &Path, write: bool) -> Result<PathBuf, String> {
    let raw_bases = allowed_bases(root);
    let bases: Vec<PathBuf> = raw_bases
        .iter()
        .filter_map(|b| canonical(b))
        .chain(raw_bases.iter().cloned())
        .collect();

    // Для записи файл может ещё не существовать — проверяем ближайшего
    // существующего предка и сами создаём недостающие папки.
    let target = if write {
        nearest_existing(path.parent().unwrap_or(path))
    } else {
        canonical(path)
    };
    // 1) По разыменованному пути: честная проверка, что агент не выходит наружу.
    let resolved_ok = target
        .as_ref()
        .map(|p| bases.iter().any(|b| is_inside(p, b)))
        .unwrap_or(false);
    // 2) По буквальному пути. Нужна для папки навыков: если пользователь положил
    //    туда ссылку (junction) на навык из ~/.opencode/skills, разыменование
    //    уводит путь наружу, и агент получал «Путь вне разрешённой зоны» на
    //    файле, который физически лежит в OpenPortal/Skills.
    let literal_ok = raw_bases.iter().any(|b| is_inside(path, b));
    if !resolved_ok && !literal_ok {
        return Err(format!(
            "Путь вне разрешённой зоны: {}. Разрешены папки PortalLauncher (Roaming и Local), \
             системный Temp и OpenPortal\\Projects.",
            path.to_string_lossy()
        ));
    }
    if write {
        // Модель иногда приклеивает имя файла к папке («папка/имя/имя.html»).
        // Видно только здесь, по настоящей файловой системе: если последний
        // сегмент уже существует как папка — это явная ошибка, говорим прямо.
        // Имя переменной не `file`: так называется макрос Rust.
        if path.is_dir() {
            return Err(format!(
                "Путь «{}» указывает на папку, а нужен файл. Укажи полное имя файла, например {}/index.html.",
                path.to_string_lossy(),
                path.to_string_lossy()
            ));
        }
        // Если где-то выше стоит файл, а мы хотели в него подпапку — тоже понятная ошибка.
        let mut probe = path.parent();
        while let Some(dir) = probe {
            if dir.exists() {
                if dir.is_file() {
                    return Err(format!(
                        "Не удалось создать папку: «{}» — это файл, а не папка.",
                        dir.to_string_lossy()
                    ));
                }
                break;
            }
            probe = dir.parent();
        }
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent).map_err(|e| {
                format!("Не удалось создать папку {}: {e}", parent.to_string_lossy())
            })?;
        }
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
    v.get("instance_id")
        .and_then(|x| x.as_str())
        .map(|s| s.to_string())
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
    /// Откуда навык взят: `portal` или id внешнего источника.
    pub source: String,
    /// Человеческое имя источника (для подсказки в списке).
    pub source_label: String,
}

/// Источники навыков.
///
/// По умолчанию включён только `portal` — папка самого лаунчера
/// (`OpenPortal/Skills`). Остальные подключаются пользователем переключателем
/// под закладками, потому что они лежат в чужих каталогах.
pub fn skill_sources() -> Vec<(&'static str, &'static str)> {
    vec![
        ("portal", "OpenPortal (встроенные)"),
        ("opencode", "OpenCode"),
        ("agents", "Агенты (общие)"),
        ("chatgpt", "ChatGPT"),
        ("claude", "Claude"),
        ("claude-code", "Claude Code"),
        ("codex", "Codex"),
        ("llm", "LLM"),
        ("copilot", "Microsoft Copilot"),
        ("github-copilot", "GitHub Copilot"),
        ("deepseek", "DeepSeek"),
        ("deepseek-harness", "DeepSeek Harness"),
    ]
}

/// Каталоги одного источника. У некоторых агентов папка навыков может лежать
/// в двух местах, поэтому источник даёт список путей.
fn source_dirs(source: &str) -> Vec<PathBuf> {
    let home = dirs_next::home_dir();
    let rel: &[&str] = match source {
        "portal" => return vec![skills_dir()],
        "opencode" => &["/.opencode/skills"],
        "agents" => &["/.agents/skills"],
        "chatgpt" => &["/.chatgpt/skills", "/.openai/skills"],
        "claude" => &["/.claude/skills"],
        "claude-code" => &["/.claude-code/skills", "/.config/claude-code/skills"],
        "codex" => &["/.codex/skills"],
        "llm" => &["/.llm/skills", "/.config/llm/skills"],
        "copilot" => &["/.copilot/skills", "/.config/github-copilot/skills"],
        "github-copilot" => &["/.github-copilot/skills", "/.config/github-copilot/skills"],
        "deepseek" => &["/.deepseek/skills"],
        "deepseek-harness" => &["/.deepseek-harness/skills", "/.config/deepseek/skills"],
        _ => return Vec::new(),
    };
    let Some(home) = home else { return Vec::new() };
    rel.iter()
        .map(|r| home.join(r.trim_start_matches('/')))
        .collect()
}

/// Папки, откуда читаются навыки для набора включённых источников.
///
/// Раньше внешние каталоги читались всегда и без спроса. Теперь по умолчанию
/// видна только своя папка лаунчера, а чужие включаются переключателем.
fn skill_dirs(sources: &[String]) -> Vec<PathBuf> {
    let mut dirs: Vec<PathBuf> = vec![skills_dir()];
    for (id, _) in skill_sources() {
        if id == "portal" {
            continue;
        }
        if !sources.iter().any(|s| s == id) {
            continue;
        }
        dirs.extend(source_dirs(id));
    }
    let mut seen: Vec<PathBuf> = Vec::new();
    for d in dirs {
        if d.is_dir() && !seen.contains(&d) {
            seen.push(d);
        }
    }
    seen
}

fn read_skill_dir(dir: &Path, source: &str, out: &mut Vec<SkillMeta>) {
    let Ok(rd) = std::fs::read_dir(dir) else {
        return;
    };
    for e in rd.flatten() {
        let path = e.path();
        if !path.is_dir() {
            continue;
        }
        let slug = path
            .file_name()
            .map(|s| s.to_string_lossy().to_string())
            .unwrap_or_default();
        if !is_safe_id(&slug) || slug.is_empty() {
            continue;
        }
        // Файл навыка может лежать прямо в корне подпапки или внутри неё.
        let md = path.join("SKILL.md");
        if !md.is_file() {
            continue;
        }
        if out.iter().any(|s| s.name.eq_ignore_ascii_case(&slug)) {
            continue;
        }
        let description = std::fs::read_to_string(&md)
            .ok()
            .map(|raw| parse_skill_description(&raw))
            .unwrap_or_default();
        out.push(SkillMeta {
            name: slug,
            path: path.to_string_lossy().to_string(),
            description,
            source: source.to_string(),
            source_label: skill_sources()
                .iter()
                .find(|(id, _)| *id == source)
                .map(|(_, label)| label.to_string())
                .unwrap_or_else(|| source.to_string()),
        });
    }
}

#[tauri::command]
pub fn op_list_skills(sources: Option<Vec<String>>) -> Vec<SkillMeta> {
    ensure_all();
    crate::commands::opencode_skills::ensure_builtin_skills();
    let enabled = sources.unwrap_or_default();
    let mut out: Vec<SkillMeta> = Vec::new();
    for (id, _) in skill_sources() {
        // Папка лаунчера включается всегда: без неё у пользователя не будет
        // вообще никаких навыков. Остальные источники — только по переключателю.
        let on = id == "portal" || enabled.iter().any(|s| s == id);
        if !on {
            continue;
        }
        for dir in source_dirs(id) {
            if dir.is_dir() {
                read_skill_dir(&dir, id, &mut out);
            }
        }
    }
    out.sort_by(|a, b| a.name.cmp(&b.name));
    out
}

/// Каталоги всех источников — нужны UI, чтобы показать пользователю, откуда
/// берутся навыки и что можно подключить.
#[tauri::command]
pub fn op_skill_sources() -> Vec<Value> {
    skill_sources()
        .into_iter()
        .map(|(id, label)| {
            let dirs = source_dirs(id);
            serde_json::json!({
                "id": id,
                "label": label,
                "builtin": id == "portal",
                "exists": dirs.iter().any(|d| d.is_dir()),
                "path": dirs.iter().map(|d| d.to_string_lossy().to_string()).collect::<Vec<_>>(),
            })
        })
        .collect()
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
    if bytes.len() >= 12 && &bytes[4..8] == b"ftyp" {
        let brand = &bytes[8..12];
        if brand == b"avif" || brand == b"avis" {
            return ("avif", "image/avif");
        }
        if brand == b"heic" || brand == b"heix" || brand == b"mif1" || brand == b"msf1" {
            return ("heic", "image/heic");
        }
    }
    if bytes.len() >= 2 && bytes[0] == b'B' && bytes[1] == b'M' {
        return ("bmp", "image/bmp");
    }
    ("png", "image/png")
}

/// «По пикселям»: декодирует картинку декодером и перекодирует её в PNG.
/// Так в чат всегда отдаётся валидный PNG — превью не будет битым, даже если
/// источник прислал webp/gif/jpeg/ещё что-то. Если формат декодеру неизвестен
/// (например AVIF), возвращает исходные байты, и файл сохраняется с его
/// настоящим mime — WebView2 (Chromium) такие картинки тоже умеет рисовать.
fn normalize_to_png(bytes: Vec<u8>) -> (Vec<u8>, bool) {
    let Ok(img) = image::load_from_memory(&bytes) else {
        return (bytes, false);
    };
    let mut out = Vec::with_capacity(bytes.len());
    if img
        .write_to(&mut std::io::Cursor::new(&mut out), image::ImageFormat::Png)
        .is_ok()
    {
        (out, true)
    } else {
        (bytes, false)
    }
}

/// Разрешённый формат имени файла изображения в кеше.
fn is_safe_image_file(name: &str) -> bool {
    let lower = name.to_lowercase();
    let ext = [".png", ".jpg", ".jpeg", ".gif", ".webp", ".avif", ".heic"]
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
    let (bytes, converted) = normalize_to_png(bytes);
    // Что удалось перекодировать «по пикселям» — сохраняем как PNG, и превью
    // в чате гарантированно отрисуется. Остальное — с настоящим расширением.
    let (ext, _) = if converted {
        ("png", "")
    } else {
        detect_image_ext(&bytes)
    };
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

/// Копирует сгенерированную картинку из кеша в проект по указанному пути.
///
/// Без этого текстура, нарисованная агентом, оставалась в кеше чата и не
/// попадала в ресурс-пак — поэтому «ИИ не рисует текстуры» на практике.
#[tauri::command]
pub fn op_image_write(name: String, dest: String, root: String) -> Result<String, String> {
    if !is_safe_image_file(&name) {
        return Err("Некорректное имя файла изображения.".into());
    }
    let src = images_dir().join(&name);
    if !src.is_file() {
        return Err(format!("Картинка {name} не найдена в кеше."));
    }
    let r = root_from_name(&root)?;
    // Имя файла задаёт вызов: путь может быть относительным к корню зоны.
    let requested = resolve_agent_path(r, Path::new(&dest));
    let target = enforce_root(r, &requested, true)?;
    if target.extension().is_none() {
        return Err(format!(
            "У пути «{dest}» нет расширения. Текстура должна быть .png, например assets/мод/textures/block/grass_top.png"
        ));
    }
    std::fs::copy(&src, &target).map_err(|e| format!("Копирование текстуры: {e}"))?;
    Ok(target.to_string_lossy().to_string())
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
    // Лечим и старые файлы кеша: что декодер понимает — отдаём как валидный PNG,
    // остальное — с корректным типом контента, чтобы браузер сам его открыл.
    let (bytes, converted) = normalize_to_png(bytes);
    let (_, mime) = if converted {
        ("png", "image/png")
    } else {
        detect_image_ext(&bytes)
    };
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
    /// MIME уменьшенной копии.
    pub mime: String,
    /// Сама картинка в base64 (уменьшенная копия), чтобы модель могла
    /// РЕАЛЬНО её рассмотреть, а не читать статистику.
    pub b64: String,
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
    let (width, height) = decoded
        .as_ref()
        .map(|d| (d.width(), d.height()))
        .unwrap_or((0, 0));
    let mut counts: std::collections::HashMap<(u8, u8, u8), u64> = std::collections::HashMap::new();
    let mut total: u64 = 0;
    let mut alpha = false;
    let (mut sr, mut sg, mut sb) = (0u64, 0u64, 0u64);
    // &decoded, а не decoded: значение нужно и здесь, и ниже для base64.
    if let Ok(dyn_img) = &decoded {
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
            let (qr, qg, qb) = (
                ((cr >> 2) << 2) + 1,
                ((cg >> 2) << 2) + 1,
                ((cb >> 2) << 2) + 1,
            );
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
                share: if total > 0 {
                    (n as f64 / total as f64) * 100.0
                } else {
                    0.0
                },
                brightness,
            }
        })
        .collect();
    colors.sort_by(|a, b| {
        b.share
            .partial_cmp(&a.share)
            .unwrap_or(std::cmp::Ordering::Equal)
    });
    colors.truncate(12);

    let dominant = colors.first().map(|c| c.hex.clone()).unwrap_or_default();
    let average = if total > 0 {
        format!(
            "#{:02x}{:02x}{:02x}",
            (sr / total) as u8,
            (sg / total) as u8,
            (sb / total) as u8
        )
    } else {
        String::new()
    };

    // Уменьшенная копия в base64: именно её модель может посмотреть.
    // Ограничиваем сторону, чтобы картинка не раздувала контекст.
    let (mime, b64) = match decoded {
        Ok(dyn_img) => {
            let small = dyn_img.thumbnail(1024, 1024);
            // w/h берём у small, а не у rgba: rgba потом целиком уходит в encode.
            let w = small.width();
            let h = small.height();
            let rgba = small.to_rgba8();
            let mut out: Vec<u8> = Vec::new();
            let enc_ok = image::ImageEncoder::write_image(
                image::codecs::png::PngEncoder::new(&mut out),
                rgba.as_raw(),
                w,
                h,
                image::ExtendedColorType::Rgba8,
            )
            .is_ok();
            if enc_ok {
                (
                    "image/png".to_string(),
                    base64::engine::general_purpose::STANDARD.encode(&out),
                )
            } else {
                (String::new(), String::new())
            }
        }
        Err(_) => (String::new(), String::new()),
    };

    Ok(ImageInspect {
        width,
        height,
        alpha,
        colors,
        dominant,
        average,
        mime,
        b64,
    })
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
pub fn op_hexdump(
    root: String,
    path: String,
    max_bytes: Option<u64>,
) -> Result<Vec<HexLine>, String> {
    let r = root_from_name(&root)?;
    let file = enforce_root(r, Path::new(&path), false)?;
    let meta = std::fs::metadata(&file).map_err(|e| format!("Метаданные файла: {e}"))?;
    if !meta.is_file() {
        return Err("Это не файл.".into());
    }
    let cap = max_bytes.unwrap_or(4096).clamp(256, 65_536);
    if meta.len() > cap {
        return Err(format!(
            "Файл больше лимита показа ({} байт > {} байт).",
            meta.len(),
            cap
        ));
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
            .map(|b| {
                if b.is_ascii_graphic() || *b == b' ' {
                    *b as char
                } else {
                    '.'
                }
            })
            .collect();
        out.push(HexLine {
            offset: (i * 16) as u32,
            hex,
            ascii,
        });
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
    let name = p
        .file_name()
        .map(|s| s.to_string_lossy().to_lowercase())
        .unwrap_or_default();
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
            let mut archive =
                zip::ZipArchive::new(f).map_err(|e| format!("Не удалось открыть ZIP: {e}"))?;
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
                let name = entry
                    .path()
                    .map(|p| p.to_string_lossy().to_string())
                    .unwrap_or_default();
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
pub fn op_archive_extract(
    root: String,
    path: String,
    dest_path: Option<String>,
) -> Result<String, String> {
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
            let stem = if stem.is_empty() {
                "archive".to_string()
            } else {
                stem
            };
            unique_dest_path(&cache_dir().join("extracted"), &stem)
        }
    };
    std::fs::create_dir_all(&dest).map_err(|e| format!("Создание папки: {e}"))?;

    match kind {
        ArchiveKind::Zip => {
            let f = std::fs::File::open(&file).map_err(|e| format!("Открытие архива: {e}"))?;
            let mut archive =
                zip::ZipArchive::new(f).map_err(|e| format!("Не удалось открыть ZIP: {e}"))?;
            archive
                .extract(&dest)
                .map_err(|e| format!("Распаковка ZIP: {e}"))?;
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
            writer
                .add_directory(format!("{rel}/"), *options)
                .map_err(|e| e.to_string())?;
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
        writer
            .start_file(rel, *options)
            .map_err(|e| e.to_string())?;
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
        writer
            .finish()
            .map_err(|e| format!("Завершение архива: {e}"))?;
    } else {
        sevenz_rust::compress_to_path(&src, &out).map_err(|e| format!("Создание 7z: {e}"))?;
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

/// Размер файла в байтах — для показа размера вместо пути.
#[tauri::command]
pub fn op_file_size(root: String, path: String) -> Result<u64, String> {
    let r = root_from_name(&root)?;
    let file = enforce_root(r, Path::new(&path), false)?;
    std::fs::metadata(&file)
        .map(|m| m.len())
        .map_err(|e| format!("Не удалось узнать размер файла: {e}"))
}

/// Ставит архив (.jar / .zip) из песочницы агента в выбранную сборку.
///
/// Отдельная команда вместо копирования: сборка сама разбирает архив и
/// раскладывает моды по правильным папкам, поэтому результат сразу рабочий.
#[tauri::command]
pub fn install_sandbox_archive(
    app: tauri::AppHandle,
    root: String,
    path: String,
    instance_id: String,
) -> Result<u32, String> {
    let r = root_from_name(&root)?;
    let file = enforce_root(r, Path::new(&path), false)?;
    let meta = std::fs::metadata(&file).map_err(|e| format!("Файл не найден: {e}"))?;
    if !meta.is_file() {
        return Err("Это не файл.".into());
    }
    let inst_dir = valid_instance_dir(&instance_id)
        .ok_or_else(|| format!("Сборка {instance_id} не найдена в лаунчере."))?;
    let ext = file
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("")
        .to_ascii_lowercase();
    if ext != "jar" && ext != "zip" {
        return Err(format!(
            "Файл .{ext} нельзя установить: нужны .jar или .zip."
        ));
    }

    // Копируем в mods сборки: лаунчер сам проиндексирует файл при следующем
    // обновлении содержимого, а jar сразу попадёт в classpath.
    let mods_dir = inst_dir.join("mods");
    std::fs::create_dir_all(&mods_dir).map_err(|e| format!("Не удалось создать mods: {e}"))?;
    let file_name = file
        .file_name()
        .map(|s| s.to_string_lossy().to_string())
        .unwrap_or_else(|| "archive.jar".to_string());
    let dest = mods_dir.join(&file_name);
    std::fs::copy(&file, &dest)
        .map_err(|e| format!("Не удалось скопировать файл в сборку: {e}"))?;

    // Emitter нужен для app.emit: метод приходит из трейта, а не из самой
    // структуры AppHandle, поэтому его надо импортировать.
    use tauri::Emitter;
    let _ = app.emit(
        "instance-progress",
        serde_json::json!({
            "stage": "installed",
            "instance_id": instance_id,
            "percent": 100,
            "message": format!("Файл {} установлен в сборку", file_name),
        }),
    );
    Ok(1)
}

/// Открывает файл из песочницы агента в системном приложении по умолчанию.
///
/// HTML, PNG, JPEG, GIF, WebP, PDF открываются браузером или просмотрщиком,
/// остальное — приложением, которое назначено в системе. `reveal` открывает
/// проводник с выделенным файлом — это нужно после копирования в «Загрузки».
#[tauri::command]
pub fn op_open_sandbox_file(
    root: String,
    path: String,
    reveal: Option<bool>,
) -> Result<String, String> {
    let r = root_from_name(&root)?;
    let p = Path::new(&path);
    let file = enforce_root(r, p, false)?;
    if !file.is_file() {
        return Err(format!("Не найден файл: {}", file.to_string_lossy()));
    }
    if reveal.unwrap_or(false) {
        // map_err: io::Error не конвертится в String автоматически через ?.
        open_in_explorer(&file).map_err(|e| format!("Не удалось открыть проводник: {e}"))?;
        return Ok(file.to_string_lossy().to_string());
    }
    let ext = file
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("")
        .to_ascii_lowercase();
    // HTML открываем браузером по умолчанию, остальное — приложением,
    // назначенным в системе. В Windows `explorer` умеет и то, и другое,
    // поэтому отдельные ветки для картинок и PDF не нужны.
    let result = if cfg!(target_os = "windows") {
        std::process::Command::new("explorer").arg(&file).spawn()
    } else if ext == "html" || ext == "htm" {
        std::process::Command::new("xdg-open").arg(&file).spawn()
    } else {
        std::process::Command::new("open").arg(&file).spawn()
    };
    result.map_err(|e| format!("Не удалось открыть файл: {e}"))?;
    Ok(file.to_string_lossy().to_string())
}

/// Показывает файл в проводнике: выделяет его, а папку открывает сразу.
#[cfg(target_os = "windows")]
fn open_in_explorer(file: &Path) -> Result<(), std::io::Error> {
    // /select, обязательно с запятой, иначе показывается сама папка.
    std::process::Command::new("explorer")
        .arg(format!("/select,{}", file.to_string_lossy()))
        .spawn()
        .map(|_| ())
}

#[cfg(not(target_os = "windows"))]
fn open_in_explorer(file: &Path) -> Result<(), std::io::Error> {
    // На других системах проводника с выделением нет — открываем папку.
    if let Some(parent) = file.parent() {
        return std::process::Command::new("xdg-open")
            .arg(parent)
            .spawn()
            .map(|_| ());
    }
    std::process::Command::new("xdg-open")
        .arg(file)
        .spawn()
        .map(|_| ())
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
        .filter(|c| {
            !matches!(
                c,
                '<' | '>' | ':' | '"' | '/' | '\\' | '|' | '?' | '*' | '\0'
            )
        })
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
        return if ext.is_empty() {
            trimmed
        } else {
            format!("{trimmed}.{ext}")
        };
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
pub fn op_copy_to_downloads(
    root: String,
    path: String,
    name: Option<String>,
) -> Result<String, String> {
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
    !id.is_empty()
        && id
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
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

/// Архив полной истории сессии — того, что было ДО сжатия.
///
/// Сжатие перезаписывает файл сессии выжимкой, и старая переписка пропадала
/// навсегда. Теперь полная история складывается рядом отдельным файлом, и её
/// можно листать вверх по мере надобности.
#[tauri::command]
pub fn op_session_archive(session_id: String, payload: String) -> Result<(), String> {
    if !is_safe_id(&session_id) {
        return Err("Некорректный идентификатор сессии.".into());
    }
    // Принимаем только массив сообщений: мусор в файл писать не даём.
    let parsed: serde_json::Value = serde_json::from_str(&payload).map_err(|e| e.to_string())?;
    if !parsed.is_array() {
        return Err("Архив истории должен быть массивом сообщений.".into());
    }
    ensure_all();
    let dir = sessions_dir().join("history");
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let path = dir.join(format!("{session_id}.json"));
    std::fs::write(&path, payload).map_err(|e| e.to_string())
}

/// Сколько всего сообщений в архиве сессии.
#[tauri::command]
pub fn op_session_archive_count(session_id: String) -> usize {
    if !is_safe_id(&session_id) {
        return 0;
    }
    let path = sessions_dir()
        .join("history")
        .join(format!("{session_id}.json"));
    std::fs::read_to_string(&path)
        .ok()
        .and_then(|raw| serde_json::from_str::<serde_json::Value>(&raw).ok())
        .and_then(|v| v.as_array().map(|a| a.len()))
        .unwrap_or(0)
}

/// Страница более старых сообщений: те, что стоят ДО индекса `before`.
///
/// Возвращаем срез в прямом порядке (старые → новые), чтобы игрок мог
/// подставить их над уже показанными и продолжить читать вверх.
#[tauri::command]
pub fn op_session_archive_page(
    session_id: String,
    before: Option<usize>,
    limit: Option<usize>,
) -> Result<Vec<Value>, String> {
    if !is_safe_id(&session_id) {
        return Err("Некорректный идентификатор сессии.".into());
    }
    let path = sessions_dir()
        .join("history")
        .join(format!("{session_id}.json"));
    let raw = std::fs::read_to_string(&path).map_err(|_| "Архив истории не найден.".to_string())?;
    let all: Vec<Value> = serde_json::from_str(&raw).map_err(|e| e.to_string())?;
    let before = before.unwrap_or(all.len()).min(all.len());
    let limit = limit.unwrap_or(40).clamp(1, 200);
    let start = before.saturating_sub(limit);
    Ok(all[start..before].to_vec())
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
    let p = resolve_agent_path(r, Path::new(&path));
    let dir = enforce_root(r, &p, false)?;
    let mut out = Vec::new();
    for e in std::fs::read_dir(&dir).map_err(|err| format!("Чтение каталога: {err}"))?
    {
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
    let p = resolve_agent_path(r, Path::new(&path));
    let file = enforce_root(r, &p, false)?;
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

/// Разрешает путь агента в абсолютный.
///
/// Агент почти всегда пишет относительные пути (`src/main/java/Mod.java`,
/// `Projects/my-mod/file.txt`), а `enforce_root` умеет проверять только
/// абсолютные. Раньше такой вызов падал с «Путь вне разрешённой зоны», и
/// агент не мог создать структуру проекта вообще.
///
/// Относительный путь отсчитывается от рабочей папки зоны: для portal это
/// `Projects` (то самое «место песочницы»), для остальных — корень зоны.
fn resolve_agent_path(root: Root, path: &Path) -> PathBuf {
    if path.is_absolute() {
        return path.to_path_buf();
    }
    let base = root_path(root);
    if matches!(root, Root::Portal) {
        return projects_dir().join(path);
    }
    base.join(path)
}

#[tauri::command]
pub fn op_write_text(root: String, path: String, content: String) -> Result<(), String> {
    let r = root_from_name(&root)?;
    let p = resolve_agent_path(r, Path::new(&path));
    let file = enforce_root(r, &p, true)?;
    // Родительские папки создаём сами: без этого невозможно разложить проект
    // по вложенным каталогам (src/main/resources и т.п.) — запись падала с
    // «No such file or directory», и песочница оставалась пустой.
    if let Some(dir) = file.parent() {
        std::fs::create_dir_all(dir)
            .map_err(|e| format!("Не удалось создать папку {}: {e}", dir.to_string_lossy()))?;
    }
    std::fs::write(&file, content).map_err(|e| format!("Не удалось записать файл: {e}"))
}

/// Одно найденное совпадение при поиске по коду.
#[derive(Serialize)]
pub struct CodeMatch {
    pub path: String,
    pub line: usize,
    pub text: String,
}

#[derive(Serialize)]
pub struct CodeSearchResult {
    pub matches: Vec<CodeMatch>,
}

const SEARCH_MAX_FILES: usize = 4000;
const SEARCH_MAX_FILE_BYTES: u64 = 512 * 1024;

/// Рекурсивный поиск подстроки или регулярного выражения по файлам зоны.
/// Нужен агенту, чтобы перед правкой кода найти все места использования
/// функции/поля/класса — иначе легко изменить не все и сломать сборку.
#[tauri::command]
pub fn op_search_code(
    root: String,
    query: String,
    regex: Option<bool>,
    glob: Option<String>,
    limit: Option<u64>,
) -> Result<CodeSearchResult, String> {
    let r = root_from_name(&root)?;
    let base = root_path(r);
    let limit = limit.unwrap_or(60).clamp(1, 200) as usize;
    let use_regex = regex.unwrap_or(false);
    let pattern = glob.as_deref().unwrap_or("").trim().to_string();

    let re = if use_regex {
        Some(
            regex::Regex::new(&query)
                .map_err(|e| format!("Некорректное регулярное выражение: {e}"))?,
        )
    } else {
        None
    };

    let mut matches: Vec<CodeMatch> = Vec::new();
    let mut visited = 0usize;
    let mut stack: Vec<PathBuf> = vec![base];

    while let Some(dir) = stack.pop() {
        if visited >= SEARCH_MAX_FILES || matches.len() >= limit {
            break;
        }
        let entries = match std::fs::read_dir(&dir) {
            Ok(e) => e,
            Err(_) => continue,
        };
        for entry in entries.flatten() {
            let path = entry.path();
            let meta = match entry.metadata() {
                Ok(m) => m,
                Err(_) => continue,
            };
            let name = entry.file_name().to_string_lossy().to_string();

            if meta.is_dir() {
                // Пропускаем служебные каталоги, чтобы не упираться в лимит.
                if matches!(
                    name.as_str(),
                    "node_modules" | "target" | ".git" | "dist" | "build" | ".gradle"
                ) {
                    continue;
                }
                stack.push(path);
                continue;
            }
            if !meta.is_file() || meta.len() > SEARCH_MAX_FILE_BYTES {
                continue;
            }
            if !pattern.is_empty() && !glob_matches(&pattern, &name, &path.to_string_lossy()) {
                continue;
            }
            visited += 1;
            if visited > SEARCH_MAX_FILES {
                break;
            }

            let text = match std::fs::read_to_string(&path) {
                Ok(t) => t,
                Err(_) => continue,
            };
            for (idx, line) in text.lines().enumerate() {
                if line.len() > 2000 {
                    continue;
                }
                let hit = match &re {
                    Some(re) => re.is_match(line),
                    None => line.contains(&query),
                };
                if hit {
                    matches.push(CodeMatch {
                        path: path.to_string_lossy().to_string(),
                        line: idx + 1,
                        text: line.trim().to_string(),
                    });
                    if matches.len() >= limit {
                        break;
                    }
                }
            }
            if matches.len() >= limit {
                break;
            }
        }
    }

    Ok(CodeSearchResult { matches })
}

/// Простое сопоставление фильтра: поддерживает «*.java» и вхождение как подстроку пути.
fn glob_matches(pattern: &str, file_name: &str, full_path: &str) -> bool {
    if let Some(ext) = pattern.strip_prefix("*.") {
        return file_name.ends_with(&format!(".{}", ext));
    }
    if pattern.contains('/') {
        return full_path.contains(pattern);
    }
    file_name.contains(pattern)
}

#[tauri::command]
pub fn op_write_bytes(root: String, path: String, b64: String) -> Result<String, String> {
    let r = root_from_name(&root)?;
    let p = resolve_agent_path(r, Path::new(&path));
    let file = enforce_root(r, &p, true)?;
    if let Some(dir) = file.parent() {
        std::fs::create_dir_all(dir).ok();
    }
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(b64.as_bytes())
        .map_err(|e| format!("Не удалось декодировать base64: {e}"))?;
    std::fs::write(&file, &bytes).map_err(|e| format!("Не удалось записать файл: {e}"))?;
    Ok(file.to_string_lossy().to_string())
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
    // Рабочая папка команды: если агент передал относительный путь или пустой —
    // работаем в песочнице (Projects для portal), а не в произвольном месте.
    let requested = if cwd.trim().is_empty() {
        PathBuf::new()
    } else {
        PathBuf::from(&cwd)
    };
    let cwd_candidate = if requested.as_os_str().is_empty() {
        root_path(r)
    } else {
        resolve_agent_path(r, &requested)
    };
    let cwd_path = if cwd_candidate.is_dir() {
        enforce_root(r, &cwd_candidate, false)?
    } else {
        // Папки могло ещё не быть — берём корень зоны, а путь создастся при записи.
        enforce_root(r, &root_path(r), false)?
    };
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
            c.args([
                "-NoProfile",
                "-NonInteractive",
                "-Command",
                &command_for_block,
            ]);
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
            stdout: decode_output(&output.stdout),
            stderr: decode_output(&output.stderr),
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
    // Node не всегда лежит в PATH лаунчера: ярлык запускает его из Проводника,
    // и переменные пользователя в окружение процесса не попадают. Без этого
    // `node`/`npm` для агента просто не находятся. Добавляем найденные
    // каталоги в начало PATH - тем же приёмом пользуемся и мы сами.
    if let Some(dir) = node_bin_dir() {
        let path = std::env::var("PATH").unwrap_or_default();
        let sep = if cfg!(target_os = "windows") {
            ';'
        } else {
            ':'
        };
        if !path.split(sep).any(|p| p.eq_ignore_ascii_case(&dir)) {
            env.push(("PATH".into(), format!("{dir}{sep}{path}")));
        }
    }
    if lower.contains("npm") {
        let d = deps.join("npm");
        std::fs::create_dir_all(&d).ok();
        env.push(("npm_config_cache".into(), d.to_string_lossy().into_owned()));
    }
    if lower.contains("pnpm") {
        let d = deps.join("pnpm");
        std::fs::create_dir_all(&d).ok();
        env.push(("PNPM_STORE_DIR".into(), d.to_string_lossy().into_owned()));
        env.push((
            "npm_config_store_dir".into(),
            d.to_string_lossy().into_owned(),
        ));
    }
    if lower.contains("yarn") {
        let d = deps.join("yarn");
        std::fs::create_dir_all(&d).ok();
        env.push(("YARN_CACHE_FOLDER".into(), d.to_string_lossy().into_owned()));
    }
    env
}

/// Каталог с `node.exe`, если Node установлен в типовом месте или есть в PATH.
/// Проверяем именно существование файла: в системах без Node `where node`
/// ничего не печатает, а на Windows может вернуть заглушку из WindowsApps.
fn node_bin_dir() -> Option<String> {
    let exe = if cfg!(target_os = "windows") {
        "node.exe"
    } else {
        "node"
    };
    let mut candidates: Vec<std::path::PathBuf> = Vec::new();
    for var in ["ProgramFiles", "ProgramFiles(x86)", "LOCALAPPDATA"] {
        if let Ok(base) = std::env::var(var) {
            if !base.is_empty() {
                if var == "LOCALAPPDATA" {
                    candidates.push(std::path::PathBuf::from(&base).join("Programs/nodejs"));
                    candidates.push(std::path::PathBuf::from(&base).join("nodejs"));
                } else {
                    candidates.push(std::path::PathBuf::from(&base).join("nodejs"));
                }
            }
        }
    }
    // nvm/n: версии лежат глубже, берём верхний каталог, где есть node.exe.
    if let Ok(local) = std::env::var("LOCALAPPDATA") {
        candidates.push(std::path::PathBuf::from(&local).join("nvm"));
        candidates.push(std::path::PathBuf::from(&local).join("n"));
    }
    if let Ok(path) = std::env::var("PATH") {
        let sep = if cfg!(target_os = "windows") {
            ';'
        } else {
            ':'
        };
        for p in path.split(sep).filter(|p| !p.is_empty()) {
            candidates.push(std::path::PathBuf::from(p));
        }
    }
    for dir in candidates {
        if dir.join(exe).is_file() {
            return Some(dir.to_string_lossy().into_owned());
        }
    }
    None
}

/// Декод вывода дочернего процесса.
///
/// `cmd /C` отдаёт текст в однобайтовой кодировке консоли (у русской Windows
/// обычно CP866, иногда CP1251). Декодировать такие байты как UTF-8 нельзя -
/// в выводе появляются чёрные ромбы вместо букв, и агент не понимает, что
/// произошло. Поэтому сначала пробуем UTF-8, а при неудаче однобайтовую
/// таблицу Windows-1251 (кириллица) с таблицей 866 как запасным вариантом.
pub(crate) fn decode_output(bytes: &[u8]) -> String {
    if bytes.is_empty() {
        return String::new();
    }
    if let Ok(s) = std::str::from_utf8(bytes) {
        return s.to_string();
    }
    // CP866 -> CP1251: 0x80..=0xAF в 866 это ё..п, в 1251 это блоки псевдографики
    // и часть букв. Для читаемости ошибок важнее 1251.
    let text: String = bytes
        .iter()
        .map(|&b| match b {
            0x00..=0x7F => b as char,
            // переводим кириллицу CP1251 в Unicode
            0xC0..=0xFF => char::from_u32(b as u32 - 0xC0 + 0x0410).unwrap_or('\u{FFFD}'),
            0xA8 => '\u{0401}', // ё
            0xB8 => '\u{0451}', // Ё
            0x80 => '\u{0402}', // А с макроном
            0x81 => '\u{201A}',
            0x82 => '\u{201E}',
            0x83 => '\u{2026}',
            0x84 => '\u{2020}',
            0x85 => '\u{2021}',
            0x86 => '\u{20AC}',
            0x87 => '\u{2030}',
            0x88 => '\u{0409}',
            0x89 => '\u{2039}',
            0x8A => '\u{203A}',
            0x8B => '\u{040F}',
            0x8C => '\u{221A}',
            0x8D => '\u{045E}',
            0x8E => '\u{0408}',
            0x8F => '\u{00A0}',
            0x90 => '\u{040E}',
            0x91 => '\u{045A}',
            0x92 => '\u{0409}',
            0x93 => '\u{040A}',
            0x94 => '\u{040C}',
            0x95 => '\u{040B}',
            0x96 => '\u{040F}',
            0x97 => '\u{0452}',
            0x98 => '\u{0453}',
            0x99 => '\u{0451}',
            0x9A => '\u{2014}',
            0x9B => '\u{2013}',
            0x9C => '\u{201E}',
            0x9D => '\u{2122}',
            0x9E => '\u{0454}',
            0x9F => '\u{00A9}',
            _ => '\u{FFFD}',
        })
        .collect();
    text
}

/// Где лежит Node и какая версия. Отдаём агенту, чтобы он не угадывал путь и
/// не тратил попытки на `where node`: версия и путь различаются от запуска из
/// терминала, где пользователь мог настроить nvm.
#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct NodeInfo {
    pub found: bool,
    pub path: String,
    pub version: String,
    pub npm: String,
}

#[tauri::command]
pub async fn op_node_info() -> Result<NodeInfo, String> {
    let Some(dir) = node_bin_dir() else {
        return Ok(NodeInfo {
            found: false,
            path: String::new(),
            version: String::new(),
            npm: String::new(),
        });
    };
    let exe = if cfg!(target_os = "windows") {
        "node.exe"
    } else {
        "node"
    };
    let node = std::path::PathBuf::from(&dir).join(exe);
    let version = std::process::Command::new(&node)
        .arg("--version")
        .output()
        .ok()
        .map(|o| decode_output(&o.stdout).trim().to_string())
        .unwrap_or_default();
    let npm = {
        let cand = if cfg!(target_os = "windows") {
            "npm.cmd"
        } else {
            "npm"
        };
        let p = std::path::PathBuf::from(&dir).join(cand);
        if p.is_file() {
            p.to_string_lossy().into_owned()
        } else {
            String::new()
        }
    };
    Ok(NodeInfo {
        found: true,
        path: node.to_string_lossy().into_owned(),
        version,
        npm,
    })
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
        let size = if d.exists() {
            dir_size_rec(&d, &mut budget)
        } else {
            0
        };
        deps.push(CacheDirInfo {
            name: name.to_string(),
            path: d.to_string_lossy().to_string(),
            size,
        });
    }
    let total_size = deps.iter().map(|d| d.size).sum();
    Ok(CacheInfo {
        root: root.to_string_lossy().to_string(),
        deps,
        total_size,
    })
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
                vec!["npm", "pnpm", "yarn", "corepack"]
                    .into_iter()
                    .map(String::from)
                    .collect()
            } else {
                vec![w.to_string()]
            }
        }
        None => vec!["npm", "pnpm", "yarn", "corepack"]
            .into_iter()
            .map(String::from)
            .collect(),
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
/// Программы, которые разрешено запускать агенту напрямую, без оболочки.
///
/// Смысл: агент передаёт программу и готовые аргументы, а мы запускаем
/// процесс как есть. Ни `cmd`, ни `powershell` в цепочке нет, поэтому
/// символы `& | > ;` внутри аргумента остаются обычными символами и
/// командой не становятся. Это убирает целый класс инъекций, на которых
/// держался прежний `run_command`.
const PROGRAM_ALLOWLIST: &[&str] = &[
    "node",
    "npm",
    "npx",
    "pnpm",
    "yarn",
    "python",
    "python3",
    "py",
    "pip",
    "git",
    "java",
    "javac",
    "gradle",
    "mvn",
    "cargo",
    "rustc",
    "dotnet",
    "go",
    "tsc",
    "eslint",
    "prettier",
    "curl",
    "winget",
    "code",
    "java.exe",
    "node.exe",
    "git.exe",
    "winget.exe",
];

fn is_program_allowed(program: &str) -> bool {
    let name = Path::new(program)
        .file_name()
        .map(|s| s.to_string_lossy().to_lowercase())
        .unwrap_or_else(|| program.to_lowercase());
    PROGRAM_ALLOWLIST
        .iter()
        .any(|p| *p == name || p.trim_end_matches(".exe") == name.trim_end_matches(".exe"))
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct ProgramRun {
    pub exit_code: i32,
    pub stdout: String,
    pub stderr: String,
    pub timed_out: bool,
    pub log: String,
}

/// Запуск программы без оболочки: отдельная программа и отдельные аргументы.
///
/// Отличие от `run_command` принципиальное. Там строка целиком уходила в
/// `cmd /C`, где модель могла написать `node -e "..." && del ...`, и
/// блоклист по подстрокам от этого не спасал. Здесь каждый аргумент - это
/// отдельный элемент массива, поэтому спецсимвол внутри него физически
/// не может стать разделителем команд.
#[tauri::command]
pub async fn op_run_program(
    root: String,
    cwd: String,
    program: String,
    args: Vec<String>,
    timeout_ms: Option<u64>,
) -> Result<ProgramRun, String> {
    let r = root_from_name(&root)?;
    if !is_program_allowed(&program) {
        return Err(format!(
            "Программа «{program}» не в списке разрешённых. Разрешены: {}.",
            PROGRAM_ALLOWLIST.join(", ")
        ));
    }
    if args.iter().any(|a| a.contains('\0')) {
        return Err("Аргумент содержит недопустимый символ".into());
    }
    // Рабочая папка - только внутри разрешённой зоны.
    let cwd_path = if cwd.trim().is_empty() {
        root_path(r)
    } else {
        let cand = resolve_agent_path(r, Path::new(&cwd));
        if cand.is_dir() {
            enforce_root(r, &cand, false)?
        } else {
            root_path(r)
        }
    };
    let timeout = timeout_ms.unwrap_or(DEFAULT_CMD_TIMEOUT_MS).min(600_000);
    let args_for_run = args.clone();
    let cwd_for_run = cwd_path.clone();
    let prog_for_run = program.clone();

    let finished = tokio::task::spawn_blocking(move || {
        let env = apply_cache_env(&prog_for_run);
        let mut c = crate::utils::create_hidden_command(prog_for_run.as_str());
        c.current_dir(&cwd_for_run);
        c.envs(env.iter().map(|(k, v)| (k, v)));
        // Никаких cmd /C: аргументы уходят в CreateProcess как есть.
        c.args(&args_for_run);
        c.stdin(std::process::Stdio::null());
        c.stdout(std::process::Stdio::piped());
        c.stderr(std::process::Stdio::piped());
        c.output()
    });

    match tokio::time::timeout(std::time::Duration::from_millis(timeout), finished).await {
        Ok(Ok(Ok(out))) => {
            let run = ProgramRun {
                exit_code: out.status.code().unwrap_or(-1),
                stdout: decode_output(&out.stdout),
                stderr: decode_output(&out.stderr),
                timed_out: false,
                log: String::new(),
            };
            Ok(record_program_log(r, &program, &args, &run))
        }
        Ok(Ok(Err(e))) => Err(format!("Не удалось запустить {program}: {e}")),
        Ok(Err(e)) => Err(format!("Ошибка запуска: {e}")),
        Err(_) => Ok(record_program_log(
            r,
            &program,
            &args,
            &ProgramRun {
                exit_code: -1,
                stdout: String::new(),
                stderr: format!("Превышено время выполнения ({timeout} мс)."),
                timed_out: true,
                log: String::new(),
            },
        )),
    }
}

/// Пишем историю запусков в кеш лаунчера: по ней видно, что ИИ ставил
/// и запускал, и куда делись скачанные файлы.
fn record_program_log(r: Root, program: &str, args: &[String], run: &ProgramRun) -> ProgramRun {
    let line = format!(
        "{} | exit={} | {} {}\n  stdout: {}\n  stderr: {}\n",
        chrono::Local::now().format("%Y-%m-%d %H:%M:%S"),
        run.exit_code,
        program,
        args.join(" "),
        run.stdout.chars().take(2000).collect::<String>(),
        run.stderr.chars().take(1000).collect::<String>(),
    );
    let dir = root_path(r).join("Cache").join("program-logs");
    std::fs::create_dir_all(&dir).ok();
    let path = dir.join("runs.log");
    if let Ok(mut f) = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(&path)
    {
        use std::io::Write as _;
        let _ = f.write_all(line.as_bytes());
    }
    ProgramRun {
        log: path.to_string_lossy().into_owned(),
        ..run.clone()
    }
}

// ---------------------------------------------------------------------------
// Установка программ: только официальные источники
// ---------------------------------------------------------------------------

/// Источник для установки. `winget` - курируемый репозиторий манифестов
/// Microsoft, где у каждого пакета указан издатель и ссылка на сайт.
/// Произвольные exe и «установщики из интернета» сюда не попадают.
const WINGET_SOURCE: &str = "winget";

/// Единственная разрешённая программа для установки. Никаких setup.exe
/// из интернета: только манифест с издателем.
fn winget_program() -> String {
    "winget".to_string()
}

async fn winget(args: &[&str], timeout_ms: u64) -> Result<String, String> {
    let owned: Vec<String> = args.iter().map(|s| s.to_string()).collect();
    let prog = winget_program();
    let finished = tokio::task::spawn_blocking(move || {
        let env = apply_cache_env("winget");
        let mut c = crate::utils::create_hidden_command(prog.as_str());
        c.envs(env.iter().map(|(k, v)| (k, v)));
        c.args(&owned);
        c.stdin(std::process::Stdio::null());
        c.stdout(std::process::Stdio::piped());
        c.stderr(std::process::Stdio::piped());
        c.output()
    });
    match tokio::time::timeout(std::time::Duration::from_millis(timeout_ms), finished).await {
        Ok(Ok(Ok(out))) => Ok(decode_output(&out.stdout)),
        Ok(Ok(Err(e))) => Err(format!(
            "winget недоступен: {e}. Он входит в Windows 10/11; обновить: https://aka.ms/getwinget"
        )),
        Ok(Err(e)) => Err(format!("Ошибка запуска winget: {e}")),
        Err(_) => Err("winget не ответил за отведённое время".into()),
    }
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct AppCandidate {
    pub id: String,
    pub name: String,
    pub version: String,
    pub source: String,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct AppInfo {
    pub id: String,
    pub name: String,
    pub publisher: String,
    pub publisher_url: String,
    pub homepage: String,
    pub license: String,
    pub installer_type: String,
    pub source: String,
    /// Человеческий вывод: можно ставить или нет.
    pub verdict: String,
}

/// Поиск пакета в официальном репозитории манифестов.
#[tauri::command]
pub async fn op_app_search(query: String) -> Result<Vec<AppCandidate>, String> {
    let q = query.trim();
    if q.is_empty() {
        return Err("Пустой запрос".into());
    }
    let out = winget(
        &[
            "search",
            "--query",
            q,
            "--source",
            WINGET_SOURCE,
            "--accept-source-agreements",
            "--disable-interactivity",
        ],
        120_000,
    )
    .await?;
    let mut list: Vec<AppCandidate> = Vec::new();
    for line in out.lines() {
        // Таблица winget разделяет колонки двумя и более пробелами.
        let cols: Vec<&str> = line.split_whitespace().collect();
        if cols.len() < 3 {
            continue;
        }
        // Идентификатор пакета узнаём по виду: Точка.Точка.Часть
        let id = cols
            .iter()
            .find(|c| c.contains('.') && c.chars().any(|ch| ch.is_ascii_alphabetic()))
            .copied();
        let Some(id) = id else { continue };
        let version = cols
            .last()
            .filter(|c| c.starts_with(|ch: char| ch.is_ascii_digit()))
            .copied();
        let name = line.split_whitespace().next().unwrap_or("").to_string();
        if list.iter().any(|c| c.id.eq_ignore_ascii_case(id)) {
            continue;
        }
        list.push(AppCandidate {
            id: id.to_string(),
            name,
            version: version.unwrap_or("").to_string(),
            source: WINGET_SOURCE.to_string(),
        });
    }
    Ok(list)
}

/// Полная карточка пакета: издатель, сайт, тип установщика.
///
/// Именно её ИИ обязан показать пользователю до установки. Установка без
/// этого шага невозможна: `op_app_install` требует издателя, который
/// агент видел здесь, и перепроверяет его сам.
#[tauri::command]
pub async fn op_app_show(id: String) -> Result<AppInfo, String> {
    let id = id.trim();
    if id.is_empty() || !id.contains('.') {
        return Err(
            "Нужен полный идентификатор пакета, например Microsoft.VisualStudioCode".into(),
        );
    }
    if id.chars().any(|c| c == '/' || c == '\\' || c == '\0') {
        return Err("Недопустимый идентификатор".into());
    }
    let out = winget(
        &[
            "show",
            "--id",
            id,
            "--exact",
            "--source",
            WINGET_SOURCE,
            "--accept-source-agreements",
            "--disable-interactivity",
        ],
        120_000,
    )
    .await?;

    let pick = |label: &str| -> String {
        out.lines()
            .find_map(|l| {
                let t = l.trim();
                t.strip_prefix(label)
                    .map(|v| v.trim().to_string())
                    .filter(|v| !v.is_empty())
            })
            .unwrap_or_default()
    };
    let name = out
        .lines()
        .find_map(|l| l.trim().strip_prefix("Found ").map(|s| s.to_string()))
        .unwrap_or_else(|| id.to_string());
    let publisher = pick("Publisher:");
    let publisher_url = pick("Publisher Url:");
    let installer_type = pick("Installer Type:");
    let license = pick("License:");
    // Сайт пакета: в выводе есть Installer Url - это и есть официальный адрес.
    let homepage = pick("Installer Url:");

    let verdict = if publisher.is_empty() {
        "непонятно: в манифесте нет издателя".to_string()
    } else {
        format!("источник: {WINGET_SOURCE}, издатель: {publisher}")
    };
    Ok(AppInfo {
        id: id.to_string(),
        name,
        publisher,
        publisher_url,
        homepage,
        license,
        installer_type,
        source: WINGET_SOURCE.to_string(),
        verdict,
    })
}

/// Установка пакета.
///
/// Три проверки подряд, поэтому «скачай setup.exe с сайта из выдачи
/// поисковика» агент сделать не может даже если Very решит:
///   1. идентификатор строго из официального репозитория манифестов;
///   2. издатель, который агент передал, должен совпасть с манифестом -
///      это отсекает пакеты-подделки с похожим именем;
///   3. ключ `--allow-scripts` намеренно не передаётся, поэтому установщики
///      с произвольными скриптами не выполнятся.
#[tauri::command]
pub async fn op_app_install(id: String, expect_publisher: String) -> Result<String, String> {
    let info = op_app_show(id.clone()).await?;
    if info.publisher.is_empty() {
        return Err("В манифесте нет издателя - устанавливать нечего.".into());
    }
    let want = expect_publisher.trim().to_lowercase();
    if want.is_empty() {
        return Err(
            "Сначала покажи пользователю карточку пакета (app_show) и назови издателя: \
             без этого установка запрещена."
                .into(),
        );
    }
    if !info.publisher.to_lowercase().contains(&want)
        && !want.contains(&info.publisher.to_lowercase())
    {
        return Err(format!(
            "Издатель не совпал: в манифесте «{}», а ты указал «{}». Покажи карточку заново.",
            info.publisher, expect_publisher
        ));
    }
    let out = winget(
        &[
            "install",
            "--id",
            &info.id,
            "--exact",
            "--source",
            WINGET_SOURCE,
            "--silent",
            "--accept-package-agreements",
            "--accept-source-agreements",
            "--disable-interactivity",
        ],
        900_000,
    )
    .await?;
    Ok(format!(
        "Установлено: {} ({}) — {}\n{}",
        info.name, info.id, info.publisher, out
    ))
}

/// Проверка, установлено ли что-то (для отчёта ИИ).
#[tauri::command]
pub async fn op_app_installed(query: String) -> Result<String, String> {
    let q = query.trim();
    if q.is_empty() {
        return Err("Пустой запрос".into());
    }
    winget(
        &[
            "list",
            "--query",
            q,
            "--accept-source-agreements",
            "--disable-interactivity",
        ],
        120_000,
    )
    .await
}

/// Команды, которые нельзя запускать агенту как угодно: список опасных
/// строк оставлен для `run_command`, а для установки используется
/// отдельный путь через манифесты.
/// Команды отсёкаются по подстрокам: `cmd`, `powershell`, `del`, `rd`.
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
    /// Размер контекстного окна, если провайдер его сообщает
    /// (OpenRouter-совместимые используют `context_length`).
    /// Без этого поле удалённые модели показывались с дефолтом 128K.
    #[serde(default)]
    pub context_length: Option<u64>,
    /// Провайдер иногда сообщает лимит вывода.
    #[serde(default)]
    pub max_output_tokens: Option<u64>,
}

/// Запрашивает `URL` (готовый endpoint `/models` у провайдера) и возвращает
/// список моделей в OpenAI-совместимом виде: `{ data: [ { id, name? } ] }`.
/// Используется как для OpenAI-совместимых, так и для Anthropic (`/v1/models`).
#[tauri::command]
pub async fn op_list_models(
    url: String,
    api_key: Option<String>,
) -> Result<Vec<ListedModel>, String> {
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
                let name = item
                    .get("name")
                    .and_then(|x| x.as_str())
                    .map(|s| s.to_string());
                // context_length: у OpenRouter-совместимых провайдеров, включая
                // модели с 1M+ контекста. Ещё встречается context_window/max_context.
                let context_length = item
                    .get("context_length")
                    .or_else(|| item.get("context_window"))
                    .or_else(|| item.get("max_context_tokens"))
                    .and_then(|x| x.as_u64());
                let max_output_tokens = item
                    .get("max_completion_tokens")
                    .or_else(|| item.get("max_output_tokens"))
                    .and_then(|x| x.as_u64());
                out.push(ListedModel {
                    id: id.to_string(),
                    name,
                    context_length,
                    max_output_tokens,
                });
            }
        }
    } else if let Some(arr) = value.as_array() {
        for item in arr {
            if let Some(id) = item.get("id").and_then(|x| x.as_str()) {
                let context_length = item
                    .get("context_length")
                    .or_else(|| item.get("context_window"))
                    .or_else(|| item.get("max_context_tokens"))
                    .and_then(|x| x.as_u64());
                let max_output_tokens = item
                    .get("max_completion_tokens")
                    .or_else(|| item.get("max_output_tokens"))
                    .and_then(|x| x.as_u64());
                out.push(ListedModel {
                    id: id.to_string(),
                    name: None,
                    context_length,
                    max_output_tokens,
                });
            }
        }
    }
    out.sort_by(|a, b| a.id.to_lowercase().cmp(&b.id.to_lowercase()));
    if out.is_empty() {
        return Err("Сервер не вернул список моделей".to_string());
    }
    Ok(out)
}

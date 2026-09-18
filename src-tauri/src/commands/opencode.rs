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

fn ensure_all() {
    for d in [openportal_dir(), projects_dir(), sessions_dir(), cache_dir(), config_dir()] {
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

    let cwd_path_for_block = cwd_path.clone();
    let command_for_block = command.clone();
    let timeout = timeout_ms.unwrap_or(DEFAULT_CMD_TIMEOUT_MS).min(600_000);

    let finished = tokio::task::spawn_blocking(move || {
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
            c.args(program);
            c.stdout(std::process::Stdio::piped());
            c.stderr(std::process::Stdio::piped());
            c.output()
        } else if cfg!(target_os = "windows") {
            let mut c = crate::utils::create_hidden_command("cmd");
            c.current_dir(&cwd_path_for_block);
            c.args(["/C", &command_for_block]);
            c.stdout(std::process::Stdio::piped());
            c.stderr(std::process::Stdio::piped());
            c.output()
        } else {
            let mut c = crate::utils::create_hidden_command("sh");
            c.current_dir(&cwd_path_for_block);
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
        .user_agent("Mozilla/5.0 (Portal-Launcher OpenPortal; like Gecko)")
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
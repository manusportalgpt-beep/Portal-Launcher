//! Локальный прокси до OpenCode Zen.
//!
//! Zen пускает free-тариф только официальный клиент, и проверка идёт ниже
//! заголовков, поэтому подделать её из нашего запроса нельзя. Выход один:
//! поднять настоящий клиент (`opencode serve`) и ходить через него. Здесь
//! он ищется, запускается и проверяется на живость.

use std::process::{Child, Command, Stdio};
use std::sync::Mutex;

/// Процесс поднятого сервера, чтобы не плодить копии при повторных кликах.
static SERVER: Mutex<Option<Child>> = Mutex::new(None);
static PORT: Mutex<Option<u16>> = Mutex::new(None);

/// Где обычно лежит официальный клиент.
fn candidate_binaries() -> Vec<std::path::PathBuf> {
    let mut out: Vec<std::path::PathBuf> = Vec::new();
    if let Ok(path) = std::env::var("PATH") {
        for dir in std::env::split_paths(&path) {
            out.push(dir.join("opencode"));
            out.push(dir.join("opencode.exe"));
            out.push(dir.join("opencode.cmd"));
            out.push(dir.join("opencode.bat"));
        }
    }
    if let Ok(appdata) = std::env::var("APPDATA") {
        out.push(std::path::PathBuf::from(&appdata).join("npm").join("opencode.cmd"));
    }
    if let Ok(local) = std::env::var("LOCALAPPDATA") {
        out.push(std::path::PathBuf::from(&local).join("opencode").join("opencode.exe"));
    }
    if let Ok(home) = std::env::var("USERPROFILE") {
        out.push(std::path::PathBuf::from(&home).join(".opencode").join("bin").join("opencode.exe"));
        out.push(std::path::PathBuf::from(&home).join(".bun").join("bin").join("opencode.exe"));
    }
    out
}

fn find_binary() -> Option<std::path::PathBuf> {
    candidate_binaries().into_iter().find(|p| p.is_file())
}

/// Немного разряженный http-запрос: хватает, чтобы узнать, отвечает ли сервер.
/// Синхронный клиент - здесь это разовая проверка в отдельном потоке, а сам
/// запрос модели идёт обычным асинхронным путём.
fn probe_health(port: u16) -> Result<String, String> {
    let url = format!("http://127.0.0.1:{port}/global/health");
    let client = reqwest::blocking::Client::builder()
        .timeout(std::time::Duration::from_millis(1200))
        .build()
        .map_err(|e| e.to_string())?;
    let res = client.get(&url).send().map_err(|e| e.to_string())?;
    if !res.status().is_success() {
        return Err(format!("HTTP {}", res.status()));
    }
    res.text().map_err(|e| e.to_string())
}

#[derive(serde::Serialize)]
pub struct ZenProxyStatus {
    pub installed: bool,
    pub running: bool,
    pub port: Option<u16>,
    pub base_url: Option<String>,
    pub version: Option<String>,
    pub binary: Option<String>,
}

/// Где клиент, запущен ли сервер и какой у него адрес.
#[tauri::command]
pub fn zen_proxy_status() -> ZenProxyStatus {
    let bin = find_binary();
    let port = PORT.lock().ok().and_then(|p| *p);
    let running = port.and_then(|p| probe_health(p).ok());
    ZenProxyStatus {
        installed: bin.is_some(),
        running: running.is_some(),
        version: running.clone(),
        port,
        base_url: port.map(|p| format!("http://127.0.0.1:{p}")),
        binary: bin.map(|p| p.to_string_lossy().to_string()),
    }
}

/// Поднимает `opencode serve` и возвращает его адрес. Если сервер уже
/// отвечает, ничего не делает - второй копии не нужно.
#[tauri::command]
pub fn zen_proxy_start(port: Option<u16>) -> Result<String, String> {
    // Уже живой - просто отдаём адрес.
    if let Ok(p) = PORT.lock() {
        if let Some(existing) = *p {
            if probe_health(existing).is_ok() {
                return Ok(format!("http://127.0.0.1:{existing}"));
            }
        }
    }
    let bin = find_binary().ok_or_else(|| {
        "Официальный клиент opencode не найден. Установите его - и прокси поднимется сам.".to_string()
    })?;

    let port = port.unwrap_or(41616);
    let mut cmd = crate::utils::create_hidden_command(&bin);
    cmd.arg("serve")
        .arg("--port")
        .arg(port.to_string())
        .arg("--hostname")
        .arg("127.0.0.1")
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null());

    let child = cmd
        .spawn()
        .map_err(|e| format!("Не удалось запустить opencode: {e}"))?;
    if let Ok(mut slot) = SERVER.lock() {
        *slot = Some(child);
    }

    // Сервер поднимается не мгновенно, поэтому даём ему время.
    let base = format!("http://127.0.0.1:{port}");
    for _ in 0..40 {
        if probe_health(port).is_ok() {
            if let Ok(mut p) = PORT.lock() {
                *p = Some(port);
            }
            return Ok(base);
        }
        std::thread::sleep(std::time::Duration::from_millis(250));
    }
    Err("Сервер opencode запустился, но не отвечает. Проверьте, не занят ли порт и не блокирует ли антивирус.".to_string())
}

/// Останавливает сервер, если мы его сами подняли.
#[tauri::command]
pub fn zen_proxy_stop() {
    if let Ok(mut slot) = SERVER.lock() {
        if let Some(mut child) = slot.take() {
            let _ = child.kill();
            let _ = child.wait();
        }
    }
    if let Ok(mut p) = PORT.lock() {
        *p = None;
    }
}

/// Путь к официальной инструкции установки: кнопка в настройках ведёт туда,
/// чтобы пользователю не пришлось искать самому.
#[tauri::command]
pub fn zen_proxy_install_hint() -> &'static str {
    "https://opencode.ai/docs/"
}

/// Скрытое окно нужно на Windows, на других системах команда обычная.
/// Неиспользуемый импорт оставлен на случай вариантов без команды.
#[allow(dead_code)]
fn _unused(_c: Command) {}
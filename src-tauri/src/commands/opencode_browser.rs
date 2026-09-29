//! Браузер ИИ: невидимый Chrome, картинка которого живёт в чате.
//!
//! Ключевая идея: окна на рабочем столе нет вообще. Chrome запускается в
//! режиме `--headless=new`, а мы по протоколу CDP забираем кадры
//! (`Page.screencast`) и отдаём их фронтенду событием — в чате рисуется
//! карточка с живой картинкой. Пользователь видит всё, что делает ИИ, но
//! ни одного окна не появляется.
//!
//! ## Почему это безопасно
//!
//! Ограничения не «на словах», а в настройках процесса:
//!
//!   * `--headless=new` — нет окна, нет доступа к экрану.
//!   * `--user-data-dir` в отдельной папке лаунчера: куки, пароли и
//!     авторизации пользователя браузеру недоступны в принципе.
//!   * `--password-store=basic --use-mock-keychain` — системное хранилище
//!     секретов не читается и не пишется.
//!   * навигация на `file://`, `chrome://`, `view-source:` и прочие
//!     не-веб-схемы запрещена: агент не прочитает файлы диска.
//!   * загрузки идут в `OpenPortal/Cache/downloads` и больше никуда.
//!   * у агента нет доступа к оболочке: браузерные инструменты — это
//!     фиксированный набор CDP-команд, произвольную команду выполнить
//!     нечем.

use futures::{SinkExt, StreamExt};
use lazy_static::lazy_static;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::HashMap;
use std::path::PathBuf;
use std::process::{Child, Command, Stdio};
use std::sync::atomic::{AtomicI64, AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tauri::Emitter;
use tokio::sync::{mpsc, oneshot};
use tokio_tungstenite::tungstenite::client::IntoClientRequest;

/// Порт отладки нашего браузера.
const DEBUG_PORT: u16 = 9333;
/// Размер кадра, который уходит в чат.
const CAST_WIDTH: u32 = 900;
const CAST_HEIGHT: u32 = 640;

/// Один кадр, летящий в карточку чата.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BrowserFrame {
    /// Кадр в base64 (JPEG, без префикса `data:`).
    pub data: String,
    pub seq: u64,
    /// Позиция курсора ИИ в пикселях кадра.
    pub cursor_x: f64,
    pub cursor_y: f64,
    /// Виден ли курсор (появляется после первого действия).
    pub cursor_visible: bool,
    pub url: String,
    pub title: String,
    /// Файл, который сейчас скачивается, если идёт загрузка.
    pub downloading: Option<String>,
}

// ---------------------------------------------------------------------------
// Пути: всё в профиле лаунчера, ничего в системных каталогах
// ---------------------------------------------------------------------------

/// Корень профиля лаунчера (тот же, где лежит OpenPortal).
fn portal_root() -> PathBuf {
    let base = dirs_next::data_dir()
        .unwrap_or_else(std::env::temp_dir)
        .join("PortalLauncher");
    std::fs::create_dir_all(&base).ok();
    base
}

/// Папка профиля браузера ИИ: своя и пустая, без единого чужого cookie.
fn browser_profile() -> PathBuf {
    let p = portal_root().join("BrowserAI");
    std::fs::create_dir_all(&p).ok();
    p
}

/// Папка загрузок. Единственное место на диске, куда браузер вообще пишет.
fn download_dir() -> PathBuf {
    let p = portal_root()
        .join("OpenPortal")
        .join("Cache")
        .join("downloads");
    std::fs::create_dir_all(&p).ok();
    p
}

fn find_browser() -> Option<(PathBuf, String)> {
    let mut c: Vec<PathBuf> = Vec::new();
    for (var, sub) in [
        ("ProgramFiles", "Google/Chrome/Application/chrome.exe"),
        ("ProgramFiles", "Microsoft/Edge/Application/msedge.exe"),
        ("ProgramFiles(x86)", "Google/Chrome/Application/chrome.exe"),
        ("ProgramFiles(x86)", "Microsoft/Edge/Application/msedge.exe"),
        ("LOCALAPPDATA", "Google/Chrome/Application/chrome.exe"),
        ("LOCALAPPDATA", "Microsoft/Edge/Application/msedge.exe"),
    ] {
        if let Ok(base) = std::env::var(var) {
            c.push(PathBuf::from(base).join(sub));
        }
    }
    for p in c {
        if p.is_file() {
            let name = p
                .file_stem()
                .map(|s| s.to_string_lossy().into_owned())
                .unwrap_or_else(|| "browser".into());
            return Some((p, name));
        }
    }
    None
}

// ---------------------------------------------------------------------------
// CDP-соединение
// ---------------------------------------------------------------------------

type Pending = Arc<Mutex<HashMap<i64, oneshot::Sender<Result<Value, String>>>>>;

struct Cdp {
    /// Отправитель в сокет. Клонируется читающей задаче для ack кадров.
    tx: mpsc::UnboundedSender<String>,
    pending: Pending,
    next_id: AtomicI64,
}

impl Cdp {
    async fn call(&self, method: &str, params: Value) -> Result<Value, String> {
        let id = self.next_id.fetch_add(1, Ordering::SeqCst);
        let (tx, rx) = oneshot::channel();
        self.pending.lock().map_err(|_| "poisoned")?.insert(id, tx);
        let msg = json!({ "id": id, "method": method, "params": params }).to_string();
        self.tx
            .send(msg)
            .await
            .map_err(|_| "Соединение с браузером закрыто".to_string())?;
        match tokio::time::timeout(Duration::from_secs(45), rx).await {
            Ok(Ok(res)) => res,
            Ok(Err(_)) => {
                self.pending.lock().ok().and_then(|mut m| m.remove(&id));
                Err("Браузер не ответил".to_string())
            }
            Err(_) => {
                self.pending.lock().ok().and_then(|mut m| m.remove(&id));
                Err(format!("{method}: нет ответа за 45 с"))
            }
        }
    }
}

struct Browser {
    cdp: Arc<Cdp>,
    child: Option<Child>,
}

lazy_static! {
    static ref STATE: Mutex<Option<Browser>> = Mutex::new(None);
    static ref SEQ: AtomicU64 = AtomicU64::new(0);
    /// Позиция курсора ИИ: (x, y, видно ли). Её рисует фронт поверх кадра.
    static ref CURSOR: Mutex<(f64, f64, bool)> = Mutex::new((0.0, 0.0, false));
    /// Адрес и заголовок страницы - едут в каждый кадр.
    static ref META: Mutex<(String, String)> = Mutex::new((String::new(), String::new()));
}

/// Клонируем Arc и отпускаем блокировку, чтобы во время `await` мьютекс
/// не держался: иначе любая другая команда встанет в очередь.
fn cdp() -> Result<Arc<Cdp>, String> {
    let g = STATE.lock().map_err(|_| "poisoned")?;
    match g.as_ref() {
        Some(b) => Ok(b.cdp.clone()),
        None => Err("Окно браузера не открыто. Сначала вызови browser_open.".into()),
    }
}

fn set_cursor(x: f64, y: f64) {
    if let Ok(mut c) = CURSOR.lock() {
        *c = (x, y, true);
    }
}

fn set_meta(url: &str, title: &str) {
    if let Ok(mut m) = META.lock() {
        if !url.is_empty() {
            m.0 = url.to_string();
        }
        if !title.is_empty() {
            m.1 = title.to_string();
        }
    }
}

/// Проверка адреса: агент ходит только по вебу.
///
/// Запрещены не только `file://` и `chrome://`. Схемы вроде `intent:` или
/// `javascript:` способны передать команду обработчику ОС - их режем.
fn check_url(url: &str) -> Result<(), String> {
    let u = url.trim();
    if u.is_empty() {
        return Err("Пустой адрес".into());
    }
    let lower = u.to_lowercase();
    for bad in [
        "file:",
        "chrome:",
        "chrome-extension:",
        "devtools:",
        "view-source:",
        "javascript:",
        "intent:",
        "vbscript:",
        "data:text/html",
        "ms-msdt:",
        "search-ms:",
    ] {
        if lower.starts_with(bad) {
            return Err(format!(
                "Адрес «{u}» запрещён: ИИ работает только с обычными веб-страницами."
            ));
        }
    }
    if !lower.starts_with("http://")
        && !lower.starts_with("https://")
        && !lower.starts_with("about:blank")
    {
        return Err("Нужен полный адрес, например https://example.com".into());
    }
    Ok(())
}

// ---------------------------------------------------------------------------
// Запуск
// ---------------------------------------------------------------------------

async fn list_targets(port: u16) -> Vec<Value> {
    let url = format!("http://127.0.0.1:{port}/json/list");
    let Ok(resp) = reqwest::Client::new()
        .get(&url)
        .timeout(Duration::from_millis(1500))
        .send()
        .await
    else {
        return Vec::new();
    };
    resp.json::<Vec<Value>>().await.unwrap_or_default()
}

fn launch_browser(start_url: &str) -> Result<Child, String> {
    let (exe, _name) = find_browser().ok_or(
        "Не найден Chrome или Edge. Установи один из них - без браузера ИИ не сможет работать.",
    )?;
    let profile = browser_profile();
    let dl = download_dir();
    let mut cmd: Command = crate::utils::create_hidden_command(exe.to_string_lossy().as_ref());
    cmd.arg("--headless=new")
        // Свой пустой профиль: сессия пользователя недоступна.
        .arg(format!("--user-data-dir={}", profile.to_string_lossy()))
        .arg(format!("--remote-debugging-port={DEBUG_PORT}"))
        .arg("--no-first-run")
        .arg("--no-default-browser-check")
        .arg("--no-service-autorun")
        .arg("--disable-sync")
        .arg("--disable-extensions")
        .arg("--disable-default-apps")
        .arg("--disable-component-update")
        .arg("--disable-background-networking")
        .arg("--disable-backgrounding-occluded-windows")
        .arg("--disable-renderer-backgrounding")
        // Системные хранилища секретов не трогаем вообще.
        .arg("--password-store=basic")
        .arg("--use-mock-keychain")
        .arg(
            "--disable-features=Translate,MediaRouter,OptimizationHints,InterestFeedContentSuggestions",
        )
        // Единственная папка, куда браузер пишет.
        .arg(format!("--download-directory={}", dl.to_string_lossy()))
        .arg(format!("--window-size={CAST_WIDTH},{CAST_HEIGHT}"))
        .arg(start_url)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|e| format!("не удалось запустить браузер: {e}"))
}

async fn connect(app: tauri::AppHandle, start_url: &str) -> Result<(), String> {
    let child = launch_browser(start_url)?;

    // Ждём, пока браузер поднимет порт отладки.
    let mut ws_url = String::new();
    for _ in 0..60 {
        tokio::time::sleep(Duration::from_millis(250)).await;
        for t in list_targets(DEBUG_PORT).await {
            if t.get("type").and_then(|x| x.as_str()) == Some("page") {
                if let Some(w) = t.get("webSocketDebuggerUrl").and_then(|x| x.as_str()) {
                    ws_url = w.to_string();
                    break;
                }
            }
        }
        if !ws_url.is_empty() {
            break;
        }
    }
    if ws_url.is_empty() {
        let mut c = child;
        let _ = c.kill();
        return Err("Браузер запустился, но не открыл порт отладки".into());
    }

    // Одно долгоживущее соединение на всю работу: на коротком сокете
    // события screencast терялись бы между вызовами.
    let req = ws_url
        .as_str()
        .into_client_request()
        .map_err(|e| format!("неверный адрес отладки: {e}"))?;
    let (sock, _) = tokio_tungstenite::connect_async(req)
        .await
        .map_err(|e| format!("не удалось подключиться к вкладке: {e}"))?;
    let (mut writer, mut reader) = sock.split();

    let (tx, mut rx) = mpsc::unbounded_channel::<String>();
    // Читающая задача шлёт через свою копию отправителя: сокет уже разделён,
    // а подтверждать кадры обязан тот же, кто их читает.
    let tx_ack = tx.clone();
    let pending: Pending = Arc::new(Mutex::new(HashMap::new()));

    tokio::spawn(async move {
        while let Some(msg) = rx.recv().await {
            if writer
                .send(tokio_tungstenite::tungstenite::Message::Text(msg))
                .await
                .is_err()
            {
                break;
            }
        }
    });

    let pending_r = pending.clone();
    let app_r = app.clone();
    tokio::spawn(async move {
        while let Some(Ok(msg)) = reader.next().await {
            let text = match msg {
                tokio_tungstenite::tungstenite::Message::Text(t) => t,
                tokio_tungstenite::tungstenite::Message::Close(_) => break,
                _ => continue,
            };
            let Ok(v) = serde_json::from_str::<Value>(&text) else {
                continue;
            };
            // Ответ на нашу команду.
            if let Some(id) = v.get("id").and_then(|x| x.as_i64()) {
                let waiter = pending_r.lock().ok().and_then(|mut m| m.remove(&id));
                if let Some(w) = waiter {
                    let res = if let Some(e) = v.get("error") {
                        Err(e
                            .get("message")
                            .and_then(|m| m.as_str())
                            .unwrap_or("ошибка браузера")
                            .to_string())
                    } else {
                        Ok(v.get("result").cloned().unwrap_or(Value::Null))
                    };
                    let _ = w.send(res);
                }
                continue;
            }
            if v.get("method").and_then(|m| m.as_str()) != Some("Page.screencastFrame") {
                continue;
            }
            let Some(p) = v.get("params") else { continue };
            let data = p
                .get("data")
                .and_then(|d| d.as_str())
                .unwrap_or("")
                .to_string();
            let sid = p
                .get("sessionId")
                .and_then(|d| d.as_str())
                .unwrap_or("")
                .to_string();
            // Кадр обязателен к подтверждению, иначе поток встаёт.
            // Именно unbounded_send, а не send: send возвращает future, и без
            // .await он просто был бы выброшен и подтверждение не ушло бы.
            let _ = tx_ack.unbounded_send(
                json!({
                    "id": 0,
                    "method": "Page.screencastFrameAck",
                    "params": { "sessionId": sid }
                })
                .to_string(),
            );
            if data.is_empty() {
                continue;
            }
            let (cx, cy, vis) = CURSOR.lock().map(|c| *c).unwrap_or((0.0, 0.0, false));
            let (url, title) = META.lock().map(|m| m.clone()).unwrap_or_default();
            let seq = SEQ.fetch_add(1, Ordering::SeqCst);
            let _ = app_r.emit(
                "browser://frame",
                BrowserFrame {
                    data,
                    seq,
                    cursor_x: cx,
                    cursor_y: cy,
                    cursor_visible: vis,
                    url,
                    title,
                    downloading: None,
                },
            );
        }
    });

    let cdp = Arc::new(Cdp {
        tx,
        pending,
        next_id: AtomicI64::new(1),
    });

    let _ = cdp.call("Page.enable", json!({})).await;
    let _ = cdp.call("Runtime.enable", json!({})).await;
    // Загрузки - строго в нашу папку.
    let _ = cdp
        .call(
            "Page.setDownloadBehavior",
            json!({ "behavior": "allow", "downloadPath": download_dir().to_string_lossy() }),
        )
        .await;
    for perm in ["geolocation", "notifications", "clipboardRead", "midi"] {
        let _ = cdp
            .call(
                "Browser.setPermission",
                json!({ "permission": { "name": perm }, "setting": "denied" }),
            )
            .await;
    }
    // Лента кадров в чат.
    let _ = cdp
        .call(
            "Page.startScreencast",
            json!({
                "format": "jpeg",
                "quality": 62,
                "maxWidth": CAST_WIDTH,
                "maxHeight": CAST_HEIGHT,
                "everyNthFrame": 2
            }),
        )
        .await;

    set_meta(start_url, "");
    if let Ok(mut g) = STATE.lock() {
        *g = Some(Browser {
            cdp,
            child: Some(child),
        });
    }
    Ok(())
}

// ---------------------------------------------------------------------------
// Вспомогательное для чтения страницы
// ---------------------------------------------------------------------------

/// Читает страницу: заголовок, адрес и видимый текст без секретных полей.
const TEXT_JS: &str = r##"
(() => {
  const isHidden = el => {
    const s = getComputedStyle(el);
    return s.display === 'none' || s.visibility === 'hidden' || s.opacity === '0';
  };
  const parts = [];
  const walk = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  let n;
  while ((n = walk.nextNode())) {
    if (isHidden(n.parentElement || document.body)) continue;
    const t = n.textContent.trim();
    if (t) parts.push(t);
  }
  const fields = [...document.querySelectorAll('input, textarea')].map(el => {
    const type = (el.getAttribute('type') || 'text').toLowerCase();
    const ac = (el.getAttribute('autocomplete') || '').toLowerCase();
    const secret = type === 'password' || ac.includes('password') || ac.includes('one-time-code');
    return {
      tag: el.tagName.toLowerCase(),
      name: el.getAttribute('name') || el.id || '',
      secret,
      value: secret ? '' : (el.value || ''),
    };
  });
  return JSON.stringify({
    title: document.title,
    url: location.href,
    text: parts.join('\n').slice(0, 12000),
    fields,
  });
})()
"##;

/// Прячем чувствительные значения в тексте страницы.
fn redact(input: &str) -> (String, Vec<String>) {
    use regex::Regex;
    let mut kinds: Vec<String> = Vec::new();
    let mut s = input.to_string();

    // e-mail: домен оставляем (он и так виден в адресной строке), local-part
    // скрываем - сам адрес утекать не должен.
    let email = Regex::new(r"(?i)\b[a-z0-9._%+-]{1,}@([a-z0-9.-]+\.[a-z]{2,})\b").unwrap();
    if email.is_match(&s) {
        let out = email
            .replace_all(&s, |c: &regex::Captures<'_>| {
                format!("[почта скрыта @{}]", &c[1])
            })
            .to_string();
        s = out;
        kinds.push("почта".into());
    }
    let phone = Regex::new(r"\+?\d[\d\s\-()]{8,}\d").unwrap();
    if phone.is_match(&s) {
        let out = phone.replace_all(&s, "[телефон скрыт]").to_string();
        s = out;
        kinds.push("телефон".into());
    }
    let card = Regex::new(r"\b(?:\d[ -]?){13,19}\b").unwrap();
    if card.is_match(&s) {
        let out = card.replace_all(&s, "[номер карты скрыт]").to_string();
        s = out;
        kinds.push("номер карты".into());
    }
    (s, kinds)
}

/// Находит точку клика по селектору либо берёт готовые координаты.
/// Поля пароля отбрасываются - см. правила безопасности.
async fn resolve_point(
    selector: Option<String>,
    x: Option<f64>,
    y: Option<f64>,
) -> Result<(f64, f64), String> {
    match (selector, x, y) {
        (None, Some(cx), Some(cy)) => Ok((cx, cy)),
        (None, _, _) => Err("Нужен selector или координаты x/y".into()),
        (Some(sel), _, _) => {
            let expr = format!(
                "(() => {{ const e = document.querySelector({}); if (!e) return 'NONE';
                   e.scrollIntoView({{block:'center'}});
                   const t = (e.getAttribute('type')||'').toLowerCase();
                   const ac = (e.getAttribute('autocomplete')||'').toLowerCase();
                   if (t === 'password' || ac.includes('password')) return 'SECRET';
                   const r = e.getBoundingClientRect();
                   return JSON.stringify({{x: r.left + r.width/2, y: r.top + r.height/2}}); }})()",
                serde_json::to_string(&sel).unwrap_or_else(|_| "\"\"".into())
            );
            let c = cdp()?;
            let res = c
                .call(
                    "Runtime.evaluate",
                    json!({ "expression": expr, "returnByValue": true }),
                )
                .await?;
            let v = res
                .get("result")
                .and_then(|r| r.get("value"))
                .and_then(|v| v.as_str())
                .unwrap_or("NONE")
                .to_string();
            match v.as_str() {
                "NONE" => Err(format!("Элемент «{sel}» не найден на странице")),
                "SECRET" => Err("Это поле пароля - ИИ не взаимодействует с полями паролей".into()),
                other => {
                    let p: Value =
                        serde_json::from_str(other).map_err(|e| format!("не понял точку: {e}"))?;
                    Ok((
                        p.get("x").and_then(|v| v.as_f64()).unwrap_or(0.0),
                        p.get("y").and_then(|v| v.as_f64()).unwrap_or(0.0),
                    ))
                }
            }
        }
    }
}

async fn dispatch_click(px: f64, py: f64) -> Result<String, String> {
    set_cursor(px, py);
    let c = cdp()?;
    for ty in ["mousePressed", "mouseReleased"] {
        c.call(
            "Input.dispatchMouseEvent",
            json!({ "type": ty, "x": px, "y": py, "button": "left", "clickCount": 1 }),
        )
        .await?;
    }
    Ok(format!("Клик в ({px:.0}, {py:.0})"))
}

// ---------------------------------------------------------------------------
// Команды для агента
// ---------------------------------------------------------------------------

fn downloads_list() -> Vec<String> {
    let mut v = Vec::new();
    if let Ok(rd) = std::fs::read_dir(download_dir()) {
        for e in rd.flatten() {
            if let Ok(md) = e.metadata() {
                v.push(format!(
                    "{} ({} КБ)",
                    e.file_name().to_string_lossy(),
                    md.len() / 1024
                ));
            }
        }
    }
    v
}

#[tauri::command]
pub async fn op_browser_open(app: tauri::AppHandle, url: Option<String>) -> Result<Value, String> {
    let start = url.unwrap_or_else(|| "about:blank".to_string());
    check_url(&start)?;
    if cdp().is_ok() {
        let c = cdp()?;
        c.call("Page.navigate", json!({ "url": start })).await?;
    } else {
        connect(app, &start).await?;
    }
    op_browser_status().await
}

#[tauri::command]
pub async fn op_browser_status() -> Result<Value, String> {
    let Ok(c) = cdp() else {
        return Ok(json!({
            "open": false,
            "closed_by_user": false,
            "url": "", "title": "",
            "downloads": [],
            "download_dir": download_dir().to_string_lossy(),
            "note": "Окно браузера не открыто",
        }));
    };
    let (url, title) = META.lock().map(|m| m.clone()).unwrap_or_default();
    // Страховка: если вкладку закрыли изнутри - вкладка исчезла из списка.
    let alive = list_targets(DEBUG_PORT)
        .await
        .iter()
        .any(|t| t.get("type").and_then(|x| x.as_str()) == Some("page"));
    if !alive {
        return Ok(json!({
            "open": false,
            "closed_by_user": true,
            "url": "", "title": "",
            "downloads": [],
            "download_dir": download_dir().to_string_lossy(),
            "note": "Браузер остановлен",
        }));
    }
    let _ = c;
    Ok(json!({
        "open": true,
        "closed_by_user": false,
        "url": url,
        "title": title,
        "downloads": downloads_list(),
        "download_dir": download_dir().to_string_lossy(),
        "note": "Браузер работает, картинка в чате",
    }))
}

#[tauri::command]
pub async fn op_browser_navigate(url: String) -> Result<String, String> {
    check_url(&url)?;
    let c = cdp()?;
    c.call("Page.navigate", json!({ "url": url })).await?;
    set_meta(&url, "");
    Ok(format!("Перешёл на {url}"))
}

#[tauri::command]
pub async fn op_browser_click(
    selector: Option<String>,
    x: Option<f64>,
    y: Option<f64>,
) -> Result<String, String> {
    let (px, py) = resolve_point(selector, x, y).await?;
    dispatch_click(px, py).await
}

#[tauri::command]
pub async fn op_browser_type(selector: Option<String>, text: String) -> Result<String, String> {
    let sel = selector.ok_or("Нужен selector поля")?;
    let c = cdp()?;
    let expr = format!(
        "(() => {{ const e = document.querySelector({}); if (!e) return 'NONE';
           e.focus();
           const t = (e.getAttribute('type')||'').toLowerCase();
           const ac = (e.getAttribute('autocomplete')||'').toLowerCase();
           if (t === 'password' || ac.includes('password') || ac.includes('one-time-code')) return 'SECRET';
           return 'OK'; }})()",
        serde_json::to_string(&sel).unwrap_or_else(|_| "\"\"".into())
    );
    let res = c
        .call(
            "Runtime.evaluate",
            json!({ "expression": expr, "returnByValue": true }),
        )
        .await?;
    let v = res
        .get("result")
        .and_then(|r| r.get("value"))
        .and_then(|v| v.as_str())
        .unwrap_or("NONE")
        .to_string();
    match v.as_str() {
        "SECRET" => {
            return Err(
                "Поле пароля или кода - ИИ не вводит секреты. Попроси пользователя ввести сам."
                    .into(),
            )
        }
        "NONE" => return Err(format!("Поле «{sel}» не найдено на странице")),
        _ => {}
    }
    c.call("Input.insertText", json!({ "text": text })).await?;
    Ok(format!("Введено в «{sel}»"))
}

#[tauri::command]
pub async fn op_browser_scroll(dy: Option<f64>) -> Result<String, String> {
    let y = dy.unwrap_or(500.0);
    let c = cdp()?;
    c.call(
        "Input.dispatchMouseEvent",
        json!({ "type": "mouseWheel", "x": 450.0, "y": 320.0, "deltaX": 0.0, "deltaY": y }),
    )
    .await?;
    Ok(format!("Прокрутка {y}"))
}

/// Текст страницы без секретов. Отдельный инструмент: модель не должна
/// видеть картинку, если ей достаточно текста.
#[tauri::command]
pub async fn op_browser_read_text() -> Result<Value, String> {
    let c = cdp()?;
    let res = c
        .call(
            "Runtime.evaluate",
            json!({ "expression": TEXT_JS, "returnByValue": true }),
        )
        .await?;
    let s = res
        .get("result")
        .and_then(|r| r.get("value"))
        .and_then(|v| v.as_str())
        .ok_or("страница не ответила")?;
    let parsed: Value = serde_json::from_str(s).map_err(|e| e.to_string())?;
    let text = parsed.get("text").and_then(|t| t.as_str()).unwrap_or("");
    let mut masked: Vec<String> = Vec::new();
    if parsed
        .get("fields")
        .and_then(|f| f.as_array())
        .map(|a| {
            a.iter()
                .any(|f| f.get("secret").and_then(|s| s.as_bool()) == Some(true))
        })
        .unwrap_or(false)
    {
        masked.push("пароль".into());
    }
    let (clean, kinds) = redact(text);
    masked.extend(kinds);
    let title = parsed.get("title").and_then(|t| t.as_str()).unwrap_or("");
    let url = parsed.get("url").and_then(|t| t.as_str()).unwrap_or("");
    set_meta(url, title);
    Ok(json!({
        "title": title,
        "url": url,
        "text": clean,
        "redacted": masked,
    }))
}

#[tauri::command]
pub async fn op_browser_close() -> Result<String, String> {
    let mut child = None;
    if let Ok(mut g) = STATE.lock() {
        if let Some(b) = g.as_mut() {
            child = b.child.take();
        }
        *g = None;
    }
    if let Some(mut c) = child {
        let _ = c.kill();
    }
    if let Ok(mut cur) = CURSOR.lock() {
        *cur = (0.0, 0.0, false);
    }
    Ok("Браузер закрыт".into())
}

/// Что скачалось. Путь всегда один и тот же - внутри кеша лаунчера.
#[tauri::command]
pub fn op_browser_cache() -> Result<Value, String> {
    Ok(json!({
        "dir": download_dir().to_string_lossy(),
        "files": downloads_list(),
    }))
}

/// Удаляет только скачанное. Других путей функция не касается.
#[tauri::command]
pub fn op_browser_cache_clear() -> Result<Value, String> {
    let dl = download_dir();
    let mut removed = 0;
    if let Ok(rd) = std::fs::read_dir(&dl) {
        for e in rd.flatten() {
            let p = e.path();
            // Страховка от symlink: трогаем только то, что физически лежит
            // внутри папки загрузок.
            if p.starts_with(&dl) && p.is_file() {
                if std::fs::remove_file(&p).is_ok() {
                    removed += 1;
                }
            }
        }
    }
    Ok(json!({ "removed": removed, "dir": dl.to_string_lossy() }))
}

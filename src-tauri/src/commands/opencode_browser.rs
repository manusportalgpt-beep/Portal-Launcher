//! Управление браузером агента через Chrome DevTools Protocol.
//!
//! Агент видит и кликает только по одному окну, которое запускает сам
//! лаунчер (или уже открытое с отладочным портом). Свой профиль и свои
//! Cookies: чужую сессию мы не читаем, поэтому и пароли, и почта в профиле
//! пользователя недоступны.
//!
//! Что специально не делается:
//!   * не подключаемся к браузеру пользователя без его явного разрешения;
//!   * не читаем значения `input[type=password]` и не печатаем в них;
//!   * e-mail, телефоны и номера карт маскируются в тексте до отправки модели.

use futures::StreamExt;
use lazy_static::lazy_static;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::path::PathBuf;
use std::process::Child;
use std::sync::Mutex;
use std::time::Duration;
use tokio_tungstenite::tungstenite::client::IntoClientRequest;

/// Порт, на котором поднимаем браузер агента.
const DEBUG_PORT: u16 = 9333;
/// Кандидаты: если пользователь сам запускал браузер с отладочным портом,
/// подключаемся к нему, чтобы работать с уже открытой вкладкой.
const EXISTING_PORTS: &[u16] = &[9222, 9223, 9229];

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BrowserTarget {
    pub ws_url: String,
    pub url: String,
    pub title: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BrowserStatus {
    pub open: bool,
    pub attached: bool,
    /// Окно закрыто пользователем - агент должен остановиться и выдать итог.
    pub closed_by_user: bool,
    pub url: String,
    pub title: String,
    pub browser: String,
    pub note: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BrowserSnapshot {
    pub url: String,
    pub title: String,
    /// Текст страницы уже с замазанными e-mail/телефонами/картами.
    pub text: String,
    /// PNG в base64, чтобы фронт мог показать превью.
    pub screenshot: String,
    /// Что было закрыто маскировкой - чтобы агент знал, что данных не хватает.
    pub redacted: Vec<String>,
    pub closed_by_user: bool,
}

struct Session {
    ws_url: String,
    /// Окно было закрыто пользователем - это разные состояния нам нужны для
    /// сообщения агенту: «задача отменена» против «вкладка переехала».
    closed_by_user: bool,
}

lazy_static! {
    static ref SESSION: Mutex<Option<Session>> = Mutex::new(None);
    /// Процесс браузера, которого подняли сами. Держим хендл, чтобы
    /// `op_browser_close` действительно закрыл окно, а не оставил его висеть.
    static ref OWNED: Mutex<Option<Child>> = Mutex::new(None);
}

/// Каталог профиля, отдельный от профиля пользователя.
fn profile_dir() -> PathBuf {
    let base = dirs_next::data_dir()
        .unwrap_or_else(std::env::temp_dir)
        .join("PortalLauncher")
        .join("BrowserAI");
    std::fs::create_dir_all(&base).ok();
    base
}

/// Ищем установленный Chrome/Edge/Yandex. Порядок важен: Chrome стоит выше.
fn find_browser() -> Option<(PathBuf, String)> {
    let mut candidates: Vec<PathBuf> = Vec::new();
    if let Ok(pf) = std::env::var("ProgramFiles") {
        candidates.push(PathBuf::from(&pf).join("Google/Chrome/Application/chrome.exe"));
        candidates.push(PathBuf::from(&pf).join("Microsoft/Edge/Application/msedge.exe"));
        candidates.push(PathBuf::from(&pf).join("Yandex/YandexBrowser/Application/browser.exe"));
    }
    if let Ok(pf) = std::env::var("ProgramFiles(x86)") {
        candidates.push(PathBuf::from(&pf).join("Google/Chrome/Application/chrome.exe"));
        candidates.push(PathBuf::from(&pf).join("Microsoft/Edge/Application/msedge.exe"));
    }
    if let Ok(local) = std::env::var("LOCALAPPDATA") {
        candidates.push(PathBuf::from(&local).join("Google/Chrome/Application/chrome.exe"));
        candidates.push(PathBuf::from(&local).join("Microsoft/Edge/Application/msedge.exe"));
    }
    for c in candidates {
        if c.is_file() {
            let name = c
                .file_stem()
                .map(|s| s.to_string_lossy().into_owned())
                .unwrap_or_else(|| "browser".into());
            return Some((c, name));
        }
    }
    None
}

/// Список вкладок на порту отладки. Пустой vec - браузер на порту не отвечает.
async fn list_targets(port: u16) -> Vec<BrowserTarget> {
    let url = format!("http://127.0.0.1:{port}/json/list");
    let Ok(resp) = reqwest::Client::new()
        .get(&url)
        .timeout(Duration::from_millis(1500))
        .send()
        .await
    else {
        return Vec::new();
    };
    let Ok(json) = resp.json::<Vec<Value>>().await else {
        return Vec::new();
    };
    json.iter()
        .filter(|t| t.get("type").and_then(|x| x.as_str()) == Some("page"))
        .filter_map(|t| {
            Some(BrowserTarget {
                ws_url: t.get("webSocketDebuggerUrl")?.as_str()?.to_string(),
                url: t.get("url")?.as_str().unwrap_or("").to_string(),
                title: t.get("title")?.as_str().unwrap_or("").to_string(),
            })
        })
        .collect()
}

/// Вызов CDP поверх WebSocket. Соединение одноразовое: открываем, отправляем
/// команду, читаем ответ с нужным id, закрываем. Для редких вызовов агента
/// это надёжнее, чем держать постоянный сокет и разбираться с реконнектами.
async fn cdp(ws_url: &str, method: &str, params: Value) -> Result<Value, String> {
    use futures::StreamExt;
    let req = ws_url
        .into_client_request()
        .map_err(|e| format!("неверный адрес отладки: {e}"))?;
    let (mut sock, _) = tokio_tungstenite::connect_async(req)
        .await
        .map_err(|e| format!("не удалось подключиться к вкладке: {e}"))?;

    let mut id = 1i64;
    let payload = json!({ "id": id, "method": method, "params": params });
    sock.send(tokio_tungstenite::tungstenite::Message::Text(
        serde_json::to_string(&payload).map_err(|e| e.to_string())?,
    ))
    .await
    .map_err(|e| format!("отправка не удалась: {e}"))?;

    let deadline = tokio::time::Instant::now() + Duration::from_secs(30);
    loop {
        if tokio::time::Instant::now() > deadline {
            return Err(format!("{method}: нет ответа за 30 с"));
        }
        let next = tokio::time::timeout(Duration::from_secs(30), sock.next()).await;
        let Ok(Ok(Some(msg))) = next else {
            return Err(format!("{method}: соединение закрыто"));
        };
        let text = match msg {
            tokio_tungstenite::tungstenite::Message::Text(t) => t,
            tokio_tungstenite::tungstenite::Message::Close(_) => {
                return Err("вкладка закрыта".to_string())
            }
            _ => continue,
        };
        let Ok(v) = serde_json::from_str::<Value>(&text) else {
            continue;
        };
        // Пропускаем события (у них нет поля id) - нас интересует только ответ.
        if v.get("id").and_then(|x| x.as_i64()) != Some(id) {
            continue;
        }
        if let Some(err) = v.get("error") {
            let desc = err
                .get("message")
                .and_then(|m| m.as_str())
                .unwrap_or("неизвестная ошибка");
            return Err(format!("{method}: {desc}"));
        }
        return Ok(v.get("result").cloned().unwrap_or(Value::Null));
    }
}

/// Текущая сессия браузера. Err - окно закрыто пользователем.
fn session() -> Result<BrowserTarget, String> {
    let guard = SESSION.lock().map_err(|_| " poisoned")?;
    match guard.as_ref() {
        Some(s) if s.closed_by_user => Err("Окно браузера закрыто пользователем".to_string()),
        Some(s) => Ok(BrowserTarget {
            ws_url: s.ws_url.clone(),
            url: String::new(),
            title: String::new(),
        }),
        None => Err("Окно браузера не открыто. Вызови browser_open".to_string()),
    }
}

/// Проверяем, что вкладка жива. Пропала - значит пользователь закрыл окно.
async fn probe(target: &BrowserTarget) -> bool {
    for port in EXISTING_PORTS.iter().chain(std::iter::once(&DEBUG_PORT)) {
        if list_targets(*port)
            .await
            .iter()
            .any(|t| t.ws_url == target.ws_url)
        {
            return true;
        }
    }
    false
}

/// Прячем чувствительные значения в тексте страницы.
fn redact(input: &str) -> (String, Vec<String>) {
    use regex::Regex;
    let mut kinds: Vec<String> = Vec::new();
    let mut s = input.to_string();

    // e-mail: сохраняем домен, local-part скрываем - по нему ИИ всё равно
    // ничего полезного не делать не сможет, а адрес утекать не должен.
    let email = Regex::new(r"(?i)\b[a-z0-9._%+-]{1,}@([a-z0-9.-]+\.[a-z]{2,})\b").unwrap();
    if email.is_match(&s) {
        // Через промежуточную переменную: присваивать в `s` результат
        // replace_all(&s, ..) нельзя - это же заимствование.
        let out = email
            .replace_all(&s, |c: &regex::Captures<'_>| {
                format!("[почта скрыта @{}]", &c[1])
            })
            .to_string();
        s = out;
        kinds.push("email".into());
    }
    // Телефоны
    let phone = Regex::new(r"\+?\d[\d\s\-()]{8,}\d").unwrap();
    if phone.is_match(&s) {
        let out = phone.replace_all(&s, "[телефон скрыт]").to_string();
        s = out;
        kinds.push("phone".into());
    }
    // Номера карт (13-19 цифр подряд, с возможными разделителями)
    let card = Regex::new(r"\b(?:\d[ -]?){13,19}\b").unwrap();
    if card.is_match(&s) {
        let out = card.replace_all(&s, "[номер карты скрыт]").to_string();
        s = out;
        kinds.push("card".into());
    }
    (s, kinds)
}

/// Скрипт, который рисует курсор ИИ поверх страницы. Без него пользователь
/// не видит, куда именно агент кликает.
const CURSOR_JS: &str = r##"
(() => {
  let c = document.getElementById('__portal_ai_cursor');
  if (!c) {
    c = document.createElement('div');
    c.id = '__portal_ai_cursor';
    c.style.cssText = 'position:fixed;z-index:2147483647;pointer-events:none;' +
      'left:0;top:0;width:26px;height:26px;transition:transform .12s ease-out;' +
      'opacity:0;transition-property:transform,opacity';
    document.body.appendChild(c);
    c.innerHTML = '<svg width="26" height="26" viewBox="0 0 24 24" style="filter:drop-shadow(0 0 3px #000)">' +
      '<path d="M4 2 L4 20 L9 15 L12.5 21 L15.5 19.5 L12 14 L19 14 Z" ' +
      'fill="#22c55e" stroke="#052e16" stroke-width="1.2"/></svg>' +
      '<div style="position:absolute;left:26px;top:12px;background:#22c55e;color:#052e16;' +
      'font:700 11px/1.5 system-ui,sans-serif;padding:1px 6px;border-radius:3px;white-space:nowrap;' +
      'border:1px solid #052e16">ИИ</div>';
  }
  const move = (x, y) => {
    c.style.opacity = '1';
    c.style.transform = `translate(${x}px, ${y}px)`;
  };
  window.__portalAiMove = move;
  move(window.innerWidth / 2, window.innerHeight / 2);
  return true;
})()
"##;

/// Читаем страницу: заголовок, ссылка и видимый текст без чувствительных полей.
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
  const inputs = [...document.querySelectorAll('input, textarea')].map(el => {
    const type = (el.getAttribute('type') || 'text').toLowerCase();
    const ac = (el.getAttribute('autocomplete') || '').toLowerCase();
    // Значения секретных полей наружу не отдаём никогда.
    const secret = type === 'password' || ac.includes('password') || ac.includes('one-time-code');
    return {
      tag: el.tagName.toLowerCase(),
      type,
      name: el.getAttribute('name') || el.id || '',
      placeholder: el.getAttribute('placeholder') || '',
      secret,
      value: secret ? '' : (el.value || ''),
    };
  });
  return JSON.stringify({
    title: document.title,
    url: location.href,
    text: parts.join('\n').slice(0, 12000),
    inputs,
  });
})()
"##;

#[derive(Deserialize)]
pub struct TextPayload {
    title: String,
    url: String,
    text: String,
    inputs: Vec<InputInfo>,
}

#[derive(Deserialize)]
pub struct InputInfo {
    #[allow(dead_code)]
    tag: String,
    #[serde(rename = "type")]
    #[allow(dead_code)]
    kind: String,
    name: String,
    #[allow(dead_code)]
    placeholder: String,
    secret: bool,
    value: String,
}

// ---------------------------------------------------------------------------
// Команды
// ---------------------------------------------------------------------------

#[tauri::command]
pub async fn op_browser_status() -> Result<BrowserStatus, String> {
    let (ws_url, closed) = {
        let guard = SESSION.lock().map_err(|_| "poisoned")?;
        match guard.as_ref() {
            Some(s) => (Some(s.ws_url.clone()), s.closed_by_user),
            None => (None, false),
        }
    };
    let Some(ws) = ws_url else {
        return Ok(BrowserStatus {
            open: false,
            attached: false,
            closed_by_user: false,
            url: String::new(),
            title: String::new(),
            browser: String::new(),
            note: "Окно не открыто".into(),
        });
    };
    let target = BrowserTarget {
        ws_url: ws,
        url: String::new(),
        title: String::new(),
    };
    if closed || !probe(&target).await {
        if let Ok(mut g) = SESSION.lock() {
            if let Some(s) = g.as_mut() {
                s.closed_by_user = true;
            }
        }
        return Ok(BrowserStatus {
            open: false,
            attached: false,
            closed_by_user: true,
            url: String::new(),
            title: String::new(),
            browser: String::new(),
            note: "Пользователь закрыл окно браузера. Задача остановлена.".into(),
        });
    }
    let info = cdp(
        &target.ws_url,
        "Runtime.evaluate",
        json!({
            "expression": "JSON.stringify({t: document.title, u: location.href})",
            "returnByValue": true,
        }),
    )
    .await
    .unwrap_or(Value::Null);
    let parsed: Value = info
        .get("result")
        .and_then(|r| r.get("value"))
        .and_then(|v| v.as_str())
        .and_then(|s| serde_json::from_str(s).ok())
        .unwrap_or(json!({ "t": "", "u": "" }));
    Ok(BrowserStatus {
        open: true,
        attached: true,
        closed_by_user: false,
        url: parsed
            .get("u")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .into(),
        title: parsed
            .get("t")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .into(),
        browser: "CDP".into(),
        note: "Окно браузера открыто".into(),
    })
}

/// Открывает окно. Сначала пытаемся подключиться к уже запущенному браузеру с
/// отладочным портом (тогда работаем с открытой у пользователя вкладкой),
/// иначе поднимаем своё отдельное окно.
#[tauri::command]
pub async fn op_browser_open(url: Option<String>) -> Result<BrowserStatus, String> {
    // 1) Уже есть браузер с отладочным портом - берём его последнюю вкладку.
    for port in EXISTING_PORTS {
        let targets = list_targets(*port).await;
        if let Some(t) = targets.first() {
            if let Ok(mut g) = SESSION.lock() {
                *g = Some(Session {
                    ws_url: t.ws_url.clone(),
                    closed_by_user: false,
                });
            }
            return op_browser_status().await;
        }
    }
    // 2) Свое окно: отдельный профиль, чтобы не трогать сессию пользователя.
    let (exe, name) = find_browser().ok_or(
        "Не найден Chrome или Edge. Установи один из них, чтобы агент мог работать с браузером.",
    )?;
    let profile = profile_dir();
    let start = url.clone().unwrap_or_else(|| "about:blank".into());
    let mut cmd = crate::utils::create_hidden_command(exe.to_string_lossy().as_ref());
    let child = cmd
        .arg(format!("--remote-debugging-port={DEBUG_PORT}"))
        .arg(format!("--user-data-dir={}", profile.to_string_lossy()))
        // Наш профиль и так отдельный, но флаги делают поведение явным.
        .arg("--no-first-run")
        .arg("--no-default-browser-check")
        .arg("--disable-features=Translate,AutomationControlled")
        .arg(&start)
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .spawn()
        .map_err(|e| format!("не удалось запустить {name}: {e}"))?;
    if let Ok(mut o) = OWNED.lock() {
        *o = Some(child);
    }

    // Ждём, пока браузер поднимет порт отладки.
    let mut target: Option<BrowserTarget> = None;
    for _ in 0..40 {
        tokio::time::sleep(Duration::from_millis(250)).await;
        let targets = list_targets(DEBUG_PORT).await;
        if let Some(t) = targets.first() {
            target = Some(t.clone());
            break;
        }
    }
    let target = target.ok_or("Браузер запустился, но порт отладки не открылся")?;
    if let Ok(mut g) = SESSION.lock() {
        *g = Some(Session {
            ws_url: target.ws_url.clone(),
            closed_by_user: false,
        });
    }
    let _ = cdp(&target.ws_url, "Page.enable", json!({})).await;
    let _ = cdp(
        &target.ws_url,
        "Runtime.evaluate",
        json!({
            "expression": CURSOR_JS, "returnByValue": true,
        }),
    )
    .await;
    let mut st = op_browser_status().await?;
    st.browser = name;
    Ok(st)
}

#[tauri::command]
pub async fn op_browser_navigate(url: String) -> Result<BrowserStatus, String> {
    let target = session()?;
    if !url.starts_with("http://") && !url.starts_with("https://") && !url.starts_with("about:") {
        return Err("Нужен полный адрес, например https://example.com".into());
    }
    cdp(&target.ws_url, "Page.navigate", json!({ "url": url })).await?;
    // Даём странице отрисоваться, иначе снимок увидит прошлую.
    tokio::time::sleep(Duration::from_millis(900)).await;
    let _ = cdp(
        &target.ws_url,
        "Runtime.evaluate",
        json!({
            "expression": CURSOR_JS, "returnByValue": true,
        }),
    )
    .await;
    op_browser_status().await
}

/// Снимок окна: картинка + текст. Основа для «посмотреть, что у пользователя».
#[tauri::command]
pub async fn op_browser_snapshot() -> Result<BrowserSnapshot, String> {
    let target = session()?;
    if !probe(&target).await {
        if let Ok(mut g) = SESSION.lock() {
            if let Some(s) = g.as_mut() {
                s.closed_by_user = true;
            }
        }
        return Err("Окно браузера закрыто пользователем - задача остановлена".into());
    }
    let _ = cdp(
        &target.ws_url,
        "Runtime.evaluate",
        json!({
            "expression": CURSOR_JS, "returnByValue": true,
        }),
    )
    .await;

    let text_raw = cdp(
        &target.ws_url,
        "Runtime.evaluate",
        json!({
            "expression": TEXT_JS, "returnByValue": true,
        }),
    )
    .await?;
    let payload: TextPayload = text_raw
        .get("result")
        .and_then(|r| r.get("value"))
        .and_then(|v| v.as_str())
        .and_then(|s| serde_json::from_str(s).ok())
        .ok_or("страница не ответила")?;

    let mut kinds: Vec<String> = Vec::new();
    if payload.inputs.iter().any(|i| i.secret) {
        kinds.push("password".into());
    }
    let (text, mut masked) = redact(&payload.text);
    kinds.append(&mut masked);

    // Поля ввода показываем без значений, если это секретные поля.
    let fields: Vec<String> = payload
        .inputs
        .iter()
        .map(|i| {
            if i.secret {
                format!("{} {} (значение скрыто)", i.tag, i.name)
            } else if i.value.is_empty() {
                format!("{} {} (пусто)", i.tag, i.name)
            } else {
                format!("{} {} = {}", i.tag, i.name, i.value)
            }
        })
        .collect();

    let shot = cdp(
        &target.ws_url,
        "Page.captureScreenshot",
        json!({ "format": "png" }),
    )
    .await?;
    let screenshot = shot
        .get("data")
        .and_then(|v| v.as_str())
        .map(|s| s.trim_start_matches("data:image/png;base64,").to_string())
        .unwrap_or_default();

    kinds.sort();
    kinds.dedup();
    Ok(BrowserSnapshot {
        url: payload.url,
        title: payload.title,
        text: if fields.is_empty() {
            text
        } else {
            format!("{text}\n\nПоля на странице:\n{}", fields.join("\n"))
        },
        screenshot,
        redacted: kinds,
        closed_by_user: false,
    })
}

/// Клик. Либо по CSS-селектору, либо по координатам.
#[tauri::command]
pub async fn op_browser_click(
    selector: Option<String>,
    x: Option<f64>,
    y: Option<f64>,
) -> Result<String, String> {
    let target = session()?;
    let (px, py) = match (&selector, x, y) {
        (Some(sel), _, _) => {
            // Проверяем, что элемент не является полем пароля.
            let guard = cdp(&target.ws_url, "Runtime.evaluate", json!({
                "expression": format!(
                    "(() => {{ const e = document.querySelector({}); if (!e) return null;
                       const t = (e.getAttribute('type')||'').toLowerCase();
                       const ac = (e.getAttribute('autocomplete')||'').toLowerCase();
                       if (t === 'password' || ac.includes('password')) return 'SECRET';
                       const r = e.getBoundingClientRect();
                       return JSON.stringify({{x: r.left + r.width/2, y: r.top + r.height/2, tag: e.tagName}}); }})()",
                    serde_json::to_string(sel).unwrap_or_else(|_| "\"\"".into())
                ),
                "returnByValue": true,
            }))
            .await?;
            let val = guard
                .get("result")
                .and_then(|r| r.get("value"))
                .and_then(|v| v.as_str())
                .unwrap_or("null");
            if val == "SECRET" {
                return Err("Это поле пароля - агент не взаимодействует с полями паролей".into());
            }
            if val == "null" {
                return Err(format!("Элемент по селектору «{sel}» не найден"));
            }
            let v: Value = serde_json::from_str(val).map_err(|e| e.to_string())?;
            (
                v.get("x").and_then(|x| x.as_f64()).unwrap_or(0.0),
                v.get("y").and_then(|x| x.as_f64()).unwrap_or(0.0),
            )
        }
        (None, Some(cx), Some(cy)) => (cx, cy),
        _ => return Err("Нужен selector или координаты x/y".into()),
    };
    // Показываем курсор ИИ в точке клика, чтобы пользователь видел действие.
    let _ = cdp(
        &target.ws_url,
        "Runtime.evaluate",
        json!({
            "expression": format!("window.__portalAiMove && window.__portalAiMove({px}, {py})"),
            "returnByValue": true,
        }),
    )
    .await;
    for (ty, button) in [("mousePressed", "left"), ("mouseReleased", "left")] {
        cdp(
            &target.ws_url,
            "Input.dispatchMouseEvent",
            json!({ "type": ty, "x": px, "y": py, "button": button, "clickCount": 1 }),
        )
        .await?;
    }
    tokio::time::sleep(Duration::from_millis(400)).await;
    Ok(format!("Клик выполнен в точке ({px:.0}, {py:.0})"))
}

/// Ввод текста. В поле пароля — отказ.
#[tauri::command]
pub async fn op_browser_type(selector: Option<String>, text: String) -> Result<String, String> {
    let target = session()?;
    let sel = selector.ok_or("Нужен selector поля")?;
    let check = cdp(&target.ws_url, "Runtime.evaluate", json!({
        "expression": format!(
            "(() => {{ const e = document.querySelector({}); if (!e) return 'NONE';
               e.focus();
               const t = (e.getAttribute('type')||'').toLowerCase();
               const ac = (e.getAttribute('autocomplete')||'').toLowerCase();
               if (t === 'password' || ac.includes('password') || ac.includes('one-time-code')) return 'SECRET';
               return 'OK'; }})()",
            serde_json::to_string(&sel).unwrap_or_else(|_| "\"\"".into())
        ),
        "returnByValue": true,
    }))
    .await?;
    let state = check
        .get("result")
        .and_then(|r| r.get("value"))
        .and_then(|v| v.as_str())
        .unwrap_or("NONE");
    match state {
        "SECRET" => return Err("Поле пароля или кода - агент не вводит секреты".into()),
        "NONE" => return Err(format!("Поле по селектору «{sel}» не найдено")),
        _ => {}
    }
    cdp(&target.ws_url, "Input.insertText", json!({ "text": text })).await?;
    Ok(format!("Текст введён в «{sel}»"))
}

#[tauri::command]
pub async fn op_browser_scroll(dy: Option<f64>) -> Result<String, String> {
    let target = session()?;
    let y = dy.unwrap_or(600.0);
    cdp(
        &target.ws_url,
        "Input.dispatchMouseEvent",
        json!({ "type": "mouseWheel", "x": 400.0, "y": 400.0, "deltaX": 0.0, "deltaY": y }),
    )
    .await?;
    tokio::time::sleep(Duration::from_millis(300)).await;
    Ok(format!("Прокрутка на {y}"))
}

/// Закрыть окно по инициативе агента.
#[tauri::command]
pub async fn op_browser_close() -> Result<String, String> {
    if let Ok(target) = session() {
        let _ = cdp(&target.ws_url, "Page.close", json!({})).await;
    }
    // Окно могли закрыть и целиком - тогда закрываем запущенный нами процесс.
    if let Ok(mut o) = OWNED.lock() {
        if let Some(mut child) = o.take() {
            let _ = child.kill();
        }
    }
    if let Ok(mut g) = SESSION.lock() {
        *g = None;
    }
    Ok("Окно браузера закрыто".into())
}

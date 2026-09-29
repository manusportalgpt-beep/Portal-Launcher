use base64::Engine as _;
use futures::{SinkExt, StreamExt};
use once_cell::sync::Lazy;
use std::collections::HashMap;
use std::sync::atomic::{AtomicI64, Ordering};
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Emitter as _};

use crate::commands::files::launcher_base_dir;
use boa_engine::{Context, Source as BoaSource};

const BASE: &str = "https://aternos.org";
const AJAX: &str = "https://aternos.org/ajax";
const UA: &str = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";
const SERVICE: &str = "PortalLauncher";
const SEC_ALPH: &[u8] = b"abcdefghijklmnopqrstuvwxyz0123456789";

/* ------------------------------------------------------------------ */
/* tiny helpers                                                        */
/* ------------------------------------------------------------------ */

fn now_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as i64
}

static LAST_MS: AtomicI64 = AtomicI64::new(0);

async fn polite() {
    loop {
        let last = LAST_MS.load(Ordering::Relaxed);
        let wait = 1400 - (now_ms() - last);
        if wait <= 0 {
            match LAST_MS.compare_exchange(last, now_ms(), Ordering::Relaxed, Ordering::Relaxed) {
                Ok(_) => break,
                Err(_) => {
                    tokio::task::yield_now().await;
                    continue;
                }
            }
        }
        tokio::time::sleep(Duration::from_millis(wait as u64)).await;
    }
}

fn sec_part() -> String {
    let seed = now_ms() as u64 ^ 0x517c1b23_a7e9_40f3;
    let mut v = seed;
    let mut out = String::with_capacity(16);
    for _ in 0..11 {
        v = v.wrapping_mul(6364136223846793005).wrapping_add(1);
        out.push(SEC_ALPH[(v >> 33) as usize % SEC_ALPH.len()] as char);
    }
    out.push_str("00000");
    out
}

fn md5_hex(input: &str) -> String {
    format!("{:x}", md5::compute(input.as_bytes()))
}

fn session_path() -> std::path::PathBuf {
    launcher_base_dir().join("aternos_session.json")
}

fn save_session_file(s: &AternosSession) {
    if let Ok(json) = serde_json::to_string_pretty(s) {
        if let Some(dir) = session_path().parent() {
            let _ = std::fs::create_dir_all(dir);
        }
        let _ = std::fs::write(session_path(), json);
    }
}

fn load_session_file() -> Option<AternosSession> {
    let data = std::fs::read_to_string(session_path()).ok()?;
    serde_json::from_str(&data).ok()
}

fn client() -> reqwest::Client {
    reqwest::Client::builder()
        .user_agent(UA)
        .timeout(Duration::from_secs(40))
        .build()
        .unwrap_or_default()
}

/* ------------------------------------------------------------------ */
/* Session                                                             */
/* ------------------------------------------------------------------ */

#[derive(Clone, Debug, Default, serde::Serialize, serde::Deserialize)]
pub struct AternosSession {
    pub username: String,
    pub session_cookie: String,
    pub token: String,
    pub sec_key: String,
    pub sec_val: String,
}

impl AternosSession {
    fn sec_str(&self) -> String {
        format!("{}:{}", self.sec_key, self.sec_val)
    }
    fn cookie_str(&self) -> String {
        format!(
            "ATERNOS_SESSION={}; ATERNOS_SEC_{}={}",
            self.session_cookie, self.sec_key, self.sec_val
        )
    }
}

static SESSION: Lazy<tokio::sync::Mutex<Option<AternosSession>>> =
    Lazy::new(|| tokio::sync::Mutex::new(None));

static CLIENT: Lazy<reqwest::Client> = Lazy::new(client);

async fn session() -> AternosSession {
    SESSION.lock().await.clone().unwrap_or_default()
}

async fn set_session(s: AternosSession) {
    *SESSION.lock().await = Some(s.clone());
    save_session_file(&s);
}

async fn regen_sec() -> AternosSession {
    let mut s = session().await;
    s.sec_key = sec_part();
    s.sec_val = sec_part();
    set_session(s.clone()).await;
    s
}

/* ------------------------------------------------------------------ */
/* HTTP helpers                                                        */
/* ------------------------------------------------------------------ */

fn parse_cookie(resp: &reqwest::Response, key: &str) -> Option<String> {
    let _ = resp.url();
    for header in resp.headers().get_all(reqwest::header::SET_COOKIE).iter() {
        if let Ok(s) = header.to_str() {
            for part in s.split(';') {
                if let Some(rest) = part.trim().strip_prefix(&format!("{key}=")) {
                    return Some(rest.to_string());
                }
            }
        }
    }
    None
}

fn cookie_headers(s: &AternosSession, server: Option<&str>) -> String {
    let mut v = s.cookie_str();
    if let Some(sid) = server {
        v.push_str("; ATERNOS_SERVER=");
        v.push_str(sid);
    }
    v
}

async fn get(s: &AternosSession, url: &str, server: Option<&str>) -> Result<reqwest::Response, String> {
    polite().await;
    let resp = CLIENT
        .get(url)
        .header("Cookie", cookie_headers(s, server))
        .header("X-Requested-With", "XMLHttpRequest")
        .header("Accept-Language", "en-US,en;q=0.9,ru;q=0.8")
        .send()
        .await
        .map_err(|e| format!("Network: {e}"))?;
    Ok(resp)
}

// Простая загрузка HTML-страницы (без AJAX-заголовков), используется для /go/
async fn get_page(s: &AternosSession, url: &str) -> Result<reqwest::Response, String> {
    polite().await;
    let resp = CLIENT
        .get(url)
        .header("Cookie", cookie_headers(s, None))
        .header("Accept-Language", "en-US,en;q=0.9,ru;q=0.8")
        .send()
        .await
        .map_err(|e| format!("Network: {e}"))?;
    Ok(resp)
}

// Загружает /go/, достаёт AJAX_TOKEN (с ретраями против анти-бот челленджа).
// Возвращает (токен, последний html) — html нужен для диагностики.
async fn fetch_token(tmp: &AternosSession) -> (String, String) {
    let mut token = String::new();
    let mut html = String::new();
    for attempt in 0..3 {
        if let Ok(resp) = get_page(tmp, &format!("{BASE}/go/")).await {
            html = resp.text().await.unwrap_or_default();
            if let Some(t) = decode_token(&html) {
                token = t;
                break;
            }
        }
        if attempt < 2 {
            tokio::time::sleep(Duration::from_secs(1)).await;
        }
    }
    (token, html)
}

async fn ajax_get(s: &AternosSession, path: &str, extra: &str, server: Option<&str>) -> Result<reqwest::Response, String> {
    let sep = if path.contains('?') { '&' } else { '?' };
    let mut url = format!("{AJAX}{path}{sep}TOKEN={}&SEC={}", s.token, s.sec_str());
    if !extra.is_empty() {
        url.push('&');
        url.push_str(extra);
    }
    get(s, &url, server).await
}

async fn post_form(s: &AternosSession, url: &str, server: Option<&str>, form: &HashMap<&str, String>) -> Result<reqwest::Response, String> {
    polite().await;
    let resp = CLIENT
        .post(url)
        .header("Cookie", cookie_headers(s, server))
        .header("X-Requested-With", "XMLHttpRequest")
        .header(reqwest::header::CONTENT_TYPE, "application/x-www-form-urlencoded; charset=UTF-8")
        .header("Accept-Language", "en-US,en;q=0.9,ru;q=0.8")
        .form(form)
        .send()
        .await
        .map_err(|e| format!("Network: {e}"))?;
    Ok(resp)
}

/* ------------------------------------------------------------------ */
/* token parse                                                         */
/* ------------------------------------------------------------------ */

fn between_iefies(html: &str) -> Option<String> {
    // arrow function IIFE like (()=> ... )();  or more generally scripts with window
    let mut i = 0;
    while let Some(start) = html[i..].find('(') {
        if html[i + start..].starts_with("(()=>") || html[i + start..].starts_with("(async ()=>") {
            let mut depth = 0;
            let s = i + start;
            for (j, b) in html[s..].bytes().enumerate() {
                match b {
                    b'(' => depth += 1,
                    b')' => {
                        depth -= 1;
                        if depth == 0 {
                            let end = s + j + 2;
                            if end > html.len() {
                                break;
                            }
                            if html[end - 2..].starts_with("();") || html[end - 2..].starts_with(")(") {
                                return Some(html[s..end].to_string());
                            }
                            break;
                        }
                    }
                    _ => {}
                }
            }
            break;
        }
        i += start + 1;
    }
    None
}

// Aternos выдаёт AJAX_TOKEN не в виде готовой строки, а вычисляет его в JS-челлендже:
// IIFE вида `(() => ... )();` внутри <head> страницы /go/ (см. python-aternos,
// regex ARROW_FN_REGEX = r"\(\(\).*?\)\(\);", выполнение через js2py/Node).
// Здесь мы выполняем этот код настоящим JS-движком (boa_engine) c теми же
// заглушками window/document/atob, что и python-aternos.

const JS_PRELUDE: &str = r#"
if (typeof window === "undefined") { var window = {}; }
if (typeof document === "undefined") { var document = {}; }
window.Map = window.Map || function(_i) {};
window.setTimeout = window.setTimeout || function(_f, _t) {};
window.setInterval = window.setInterval || function(_f, _t) {};
window.encodeURIComponent = window.encodeURIComponent || window.Map;
window.document = window.document || document;
document.doctype = document.doctype || {};
document.currentScript = document.currentScript || {};
document.getElementById = document.getElementById || function() {};
document.prepend = document.prepend || function() {};
document.append = document.append || function() {};
document.appendChild = document.appendChild || function() {};
function atob(v) {
  if (typeof v !== "string") { return ""; }
  var t = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  var s = v.replace(/[^A-Za-z0-9+/=]/g, "").replace(/=+$/, "");
  var out = "", i, b = 0, n = 0;
  for (i = 0; i < s.length; i++) {
    var o = t.indexOf(s.charAt(i));
    if (o < 0) { break; }
    b = (b << 6) | o;
    n += 6;
    if (n >= 8) {
      out += String.fromCharCode((b >>> (n - 8)) & 255);
      n -= 8;
    }
  }
  return out;
}
window.atob = atob;
"#;

const JS_TAIL: &str = r#"
;(typeof AJAX_TOKEN !== "undefined" ? AJAX_TOKEN : ((window && window.AJAX_TOKEN) || ""))
"#;

fn head_slice<'a>(html: &'a str) -> &'a str {
    if let Some(s) = html.find("<head>") {
        let s = s + 6;
        if let Some(e) = html[s..].find("</head>") {
            return &html[s..s + e];
        }
    }
    html
}

fn arrow_iifes(head: &str) -> Vec<String> {
    // Порт `re.findall(r"\(\(\).*?\)\(\);", head)`: lazy-совпадение на одной строке.
    let mut out = Vec::new();
    for line in head.split('\n') {
        let mut rest = line;
        while let Some(start) = rest.find("(()") {
            let after = &rest[start + 3..];
            if let Some(end) = after.find(")();") {
                out.push(format!("((){})();", &after[..end]));
                rest = &after[end + 4..];
            } else {
                break;
            }
        }
    }
    out
}

fn run_token_js(code: &str) -> Option<String> {
    let mut context = Context::default();
    let src = format!("{JS_PRELUDE}\n{code}\n{JS_TAIL}");
    let value = context.eval(BoaSource::from_bytes(src.as_bytes())).ok()?;
    let s = value.as_string()?.to_std_string_escaped();
    if s.is_empty() || s.len() < 4 {
        return None;
    }
    Some(s)
}

fn decode_token(html: &str) -> Option<String> {
    // 1) честное выполнение JS-челленджа из <head>
    let mut iifes = arrow_iifes(head_slice(html));
    // python-aternos при нескольких IIFE берёт второй (первый — другой скрипт)
    if iifes.len() > 1 {
        let second = iifes.remove(1);
        iifes.insert(0, second);
    }
    for code in &iifes {
        if let Some(t) = run_token_js(code) {
            return Some(t);
        }
    }
    // 2) fallback-эвристики на старые версии страницы
    if let Some(script) = between_iefies(html) {
        if let Some(s) = atob_call(&script) {
            if let Ok(bytes) = base64::engine::general_purpose::STANDARD.decode(&s) {
                if let Ok(tok) = String::from_utf8(bytes) {
                    if tok.len() >= 4 {
                        return Some(tok);
                    }
                }
            }
        }
        // attempt 2: extract any literal string assigned to window["AJAX_TOKEN"] or window.AJAX_TOKEN
        if let Some(t) = extract_token_literal(&script) {
            return Some(t);
        }
    }
    // attempt 3: direct "AJAX_TOKEN=..." in page
    extract_token_literal(html)
}

fn diag_snippet(html: &str) -> String {
    let clean: String = html.chars().take(180).collect();
    let clean = clean.replace('\n', " ").replace('\r', " ");
    if html.chars().count() > 180 {
        format!("{clean}…")
    } else {
        clean
    }
}

fn atob_call(s: &str) -> Option<String> {
    let mut idx = 0;
    while let Some(at) = s[idx..].find("atob(") {
        let start = idx + at + 5;
        let rest = &s[start..];
        if rest.starts_with('"') || rest.starts_with('\'') {
            let q = rest.as_bytes()[0] as char;
            let end = start + rest[1..].find(q)? + 1;
            return Some(s[start + 1..end].to_string());
        }
        idx += start;
    }
    None
}

fn extract_token_literal(s: &str) -> Option<String> {
    let key = "AJAX_TOKEN";
    if let Some(p) = s.find(key) {
        let rest = &s[p + key.len()..];
for q in [b'\"', b'\''] {
        if let Some(p2) = rest.as_bytes().iter().position(|&b| b == q) {
                let q2 = q;
                let inner = &rest[p2 + 1..];
                if let Some(p3) = inner.as_bytes().iter().position(|&b| b == q2) {
                    let val = &inner[..p3];
                    if !val.is_empty() && val.len() >= 4 {
                        return Some(val.to_string());
                    }
                }
            }
        }
    }
    None
}

/* ------------------------------------------------------------------ */
/* login                                                               */
/* ------------------------------------------------------------------ */

#[derive(serde::Serialize)]
#[serde(tag = "kind")]
pub enum LoginResult {
    Success { username: String },
    Needs2fa { username: String },
    InvalidCredentials,
    BrowserSessionRequired { reason: String },
}

#[tauri::command]
pub async fn aternos_login(
    username: String,
    password: String,
    code: Option<String>,
) -> Result<LoginResult, String> {
    // 1) fetch /go/ and extract token (several attempts against the anti-bot challenge)
    let tmp = AternosSession {
        username: username.clone(),
        session_cookie: "".into(),
        token: "".into(),
        sec_key: sec_part(),
        sec_val: sec_part(),
    };
    let (token, login_page) = fetch_token(&tmp).await;

    if token.is_empty() {
        return Ok(LoginResult::BrowserSessionRequired {
            reason: format!(
                "Aternos не выдал AJAX_TOKEN из-за анти-бот челленджа на странице входа (страница: '{}'). Войдите через 'Сессия из браузера' (вставьте cookie ATERNOS_SESSION) или 'Токен'.",
                diag_snippet(&login_page)
            ),
        });
    }

    // 2) session skeleton with fresh sec
    let sk = sec_part();
    let sv = sec_part();
    let mut sess = AternosSession {
        username: username.clone(),
        session_cookie: "".into(),
        token,
        sec_key: sk.clone(),
        sec_val: sv.clone(),
    };

    // 3) login POST
    let mut form: HashMap<&str, String> = HashMap::new();
    form.insert("username", username.clone());
    form.insert("password", md5_hex(&password));
    if let Some(c) = code {
        form.insert("code", c);
    }

    let login_url = format!(
        "{AJAX}/account/login?TOKEN={}&SEC={}:{}",
        sess.token, sk, sv
    );

    let resp = post_form(
        &sess,
        &login_url,
        None,
        &form,
    )
    .await?;

    let session_cookie = parse_cookie(&resp, "ATERNOS_SESSION").unwrap_or_default();
    let body = resp.text().await.unwrap_or_default();

    if body.contains("\"show2FA\":true") || body.contains("\"show2FA\": true") {
        return Ok(LoginResult::Needs2fa { username });
    }

    if session_cookie.is_empty() {
        if body.contains("password") || body.contains("incorrect") || body.contains("wrong")
            || body.contains("\"error\"") || body.to_lowercase().contains("wrong-e-mail")
        {
            return Ok(LoginResult::InvalidCredentials);
        }
        return Ok(LoginResult::BrowserSessionRequired {
            reason: format!(
                "Aternos не выдал сессию (ответ: '{}'). Проверьте пароль или войдите через 'Сессия из браузера'.",
                diag_snippet(&body)
            ),
        });
    }

    sess.session_cookie = session_cookie;
    set_session(sess).await;
    Ok(LoginResult::Success { username })
}

#[tauri::command]
pub async fn aternos_login_with_session(
    username: String,
    session_cookie: String,
) -> Result<(), String> {
    // fetch token (fresh ANONYMOUS page first, then re-fetch WITH the session cookie)
    let tmp = AternosSession {
        username: "".into(),
        session_cookie: "".into(),
        token: "".into(),
        sec_key: sec_part(),
        sec_val: sec_part(),
    };
    let (token, _) = fetch_token(&tmp).await;

    let sk = sec_part();
    let sv = sec_part();
    let mut sess = AternosSession {
        username,
        session_cookie,
        token,
        sec_key: sk,
        sec_val: sv,
    };

    // re-fetch with real session to extract fresh AJAX_TOKEN (bound to the session)
    let (token2, _) = fetch_token(&sess).await;
    if !token2.is_empty() {
        sess.token = token2;
    }

    set_session(sess).await;
    Ok(())
}

#[tauri::command]
pub async fn aternos_login_with_token(
    username: String,
    ajax_token: String,
) -> Result<(), String> {
    let sk = sec_part();
    let sv = sec_part();
    let sess = AternosSession {
        username,
        session_cookie: "".into(),
        token: ajax_token,
        sec_key: sk,
        sec_val: sv,
    };
    set_session(sess).await;
    Ok(())
}

#[tauri::command]
pub async fn aternos_logout() -> Result<(), String> {
    let s = session().await;
    let _ = ajax_get(&s, "/account/logout", "", None).await;
    *SESSION.lock().await = None;
    let _ = std::fs::remove_file(session_path());
    // clear keyring entry
    if let Ok(entry) = keyring::Entry::new(SERVICE, &format!("aternos_{}", s.username)) {
        let _ = entry.delete_credential();
    }
    Ok(())
}

/* ------------------------------------------------------------------ */
/* servers list                                                        */
/* ------------------------------------------------------------------ */

#[derive(serde::Serialize, Clone)]
pub struct AternosServerSummary {
    pub id: String,
    pub name: Option<String>,
    pub ip: Option<String>,
    pub status: Option<String>,
    pub online: bool,
    pub class: Option<String>,
    pub version: Option<String>,
    pub software: Option<String>,
}

#[derive(serde::Serialize, Clone, Default)]
pub struct AternosServerInfo {
    pub id: String,
    pub online: bool,
    pub starting: bool,
    pub class: Option<String>,
    pub status_text: Option<String>,
    pub ip: Option<String>,
    pub domain: Option<String>,
    pub port: Option<u64>,
    pub version: Option<String>,
    pub software: Option<String>,
    pub motd: Option<String>,
    pub players: Option<Vec<String>>,
    pub slots: Option<u64>,
    pub ram: Option<String>,
    pub mem: Option<String>,
    pub queue: Option<serde_json::Value>,
    pub raw: Option<serde_json::Value>,
}

fn find_between(html: &str, start_pat: &str, end_pat: &str, start_from: usize) -> Option<String> {
    let s = html[start_from..].find(start_pat)? + start_from + start_pat.len();
    let e = html[s..].find(end_pat).map(|i| s + i).unwrap_or(html.len());
    Some(html[s..e].to_string())
}

fn parse_last_status(html: &str) -> Option<serde_json::Value> {
    // find "var lastStatus = {...};"
    let marker = "lastStatus";
    let p = html.find(marker)?;
    let eq = html[p + marker.len()..].find('=')? + p + marker.len() + 1;
    let json_start = eq + html[eq..].find('{')?;
    let mut depth = 0;
    let mut json_end = None;
    for (j, b) in html[json_start..].bytes().enumerate() {
        match b {
            b'{' => depth += 1,
            b'}' => {
                depth -= 1;
                if depth == 0 {
                    json_end = Some(json_start + j + 1);
                    break;
                }
            }
            _ => {}
        }
    }
    let end = json_end?;
    let slice = &html[json_start..end];
    serde_json::from_str(slice).ok()
}

fn extract_server_id_and_block(_html: &str, _needle: &str, _offset: usize) -> Option<String> {
    None
}

fn extract_servers_from_html(html: &str) -> Vec<AternosServerSummary> {
    let mut out = Vec::new();
    let mut cursor = 0;
    while let Some(block) = html[cursor..].find("server-body") {
        let block_start = cursor + block;
        let chunk = &html[block_start..];
        let id = match find_between(chunk, "data-id=\"", "\"", 0) {
            Some(id) => id,
            None => {
                cursor = block_start + 12;
                continue;
            }
        };
        // name attempt: look for server-name within next 800 chars
        let limit = std::cmp::min(chunk.len(), 1200);
        let block = &chunk[..limit];
        let name = find_between(block, "server-name", ">", 0)
            .and_then(|v| {
                let v2 = v.trim_start().trim_start_matches('>').trim();
                let end = v2.find('<').unwrap_or(v2.len());
                let s = v2[..end].trim();
                if s.is_empty() { None } else { Some(s.to_string()) }
            });
        let sub = find_between(block, "server-subinfo", ">", 0)
            .and_then(|v| {
                let v2 = v.trim_start().trim_start_matches('>').trim();
                let end = v2.find('<').unwrap_or(v2.len());
                let s = v2[..end].trim();
                if s.is_empty() { None } else { Some(s.to_string()) }
            });
        out.push(AternosServerSummary {
            id,
            name: name.clone(),
            ip: None,
            status: sub,
            online: false,
            class: None,
            version: None,
            software: None,
        });
        cursor = block_start + 12;
    }
    out
}

#[tauri::command]
pub async fn aternos_list_servers() -> Result<Vec<AternosServerSummary>, String> {
    let s = session().await;
    if s.session_cookie.is_empty() {
        return Err("Not logged in".into());
    }
    let mut s = regen_sec().await;
    let resp = get(&s, &format!("{BASE}/servers/"), None).await?;
    let fresh_session = parse_cookie(&resp, "ATERNOS_SESSION");
    let html = resp.text().await.unwrap_or_default();
    if let Some(c) = fresh_session {
        s.session_cookie = c;
        set_session(s.clone()).await;
    }
    let mut list = extract_servers_from_html(&html);
    // For each, try to get quick status from the same page snippet
    // The list page doesn't expose online status well; set online=false; caller can fetch info individually.
    Ok(list)
}

/* ------------------------------------------------------------------ */
/* server info                                                         */
/* ------------------------------------------------------------------ */

#[tauri::command]
pub async fn aternos_server_info(servid: String) -> Result<AternosServerInfo, String> {
    let s = regen_sec().await;
    let resp = get(&s, &format!("{BASE}/server"), Some(&servid)).await?;
    let fresh_session = parse_cookie(&resp, "ATERNOS_SESSION");
    let html = resp.text().await.unwrap_or_default();
    if let Some(c) = fresh_session {
        let mut ns = s.clone();
        ns.session_cookie = c;
        set_session(ns).await;
    }
    let v = parse_last_status(&html).unwrap_or(serde_json::json!({}));
    let online = v["online"] == serde_json::json!(1) || v["online"] == serde_json::json!(true);
    let starting = v["starting"] == serde_json::json!(1) || v["starting"] == serde_json::json!(true);
    let class = v["class"].as_str().map(String::from);
    let status_text = v["status"].as_str().map(String::from).or_else(|| v["class"].as_str().map(String::from));
    Ok(AternosServerInfo {
        id: servid,
        online,
        starting,
        class: class.clone(),
        status_text,
        ip: v["ip"].as_str().map(String::from),
        domain: v["domain"].as_str().map(String::from),
        port: v["port"].as_u64(),
        version: v["version"].as_str().map(String::from),
        software: v["software"].as_str().map(String::from),
        motd: v["motd"].as_str().map(String::from),
        players: v["players"].as_array().map(|a| a.iter().filter_map(|p| p.as_str().map(String::from)).collect()),
        slots: v["slotLimit"].as_u64().or(v["slot"].as_u64()),
        ram: v["ram"].as_str().map(String::from),
        mem: v["mem"].as_str().map(String::from),
        queue: v.get("queue").cloned(),
        raw: Some(v),
    })
}

/* ------------------------------------------------------------------ */
/* server actions                                                      */
/* ------------------------------------------------------------------ */

#[tauri::command]
pub async fn aternos_start(servid: String) -> Result<serde_json::Value, String> {
    let s = regen_sec().await;
    let extra = "headstart=false&access-credits=false";
    let resp = ajax_get(&s, "/server/start", extra, Some(&servid)).await?;
    let json = resp.json().await.unwrap_or(serde_json::json!({}));
    Ok(json)
}

#[tauri::command]
pub async fn aternos_stop(servid: String) -> Result<(), String> {
    let s = regen_sec().await;
    ajax_get(&s, "/server/stop", "", Some(&servid)).await?;
    Ok(())
}

#[tauri::command]
pub async fn aternos_restart(servid: String) -> Result<(), String> {
    let s = regen_sec().await;
    ajax_get(&s, "/server/restart", "", Some(&servid)).await?;
    Ok(())
}

#[tauri::command]
pub async fn aternos_confirm(servid: String) -> Result<(), String> {
    let s = regen_sec().await;
    let extra = "headstart=false&access-credits=false";
    ajax_get(&s, "/server/confirm", extra, Some(&servid)).await?;
    Ok(())
}

#[tauri::command]
pub async fn aternos_accept_eula(servid: String) -> Result<(), String> {
    let s = regen_sec().await;
    ajax_get(&s, "/server/accept-eula", "", Some(&servid)).await?;
    Ok(())
}

#[tauri::command]
pub async fn aternos_set_motd(servid: String, motd: String) -> Result<(), String> {
    let s = regen_sec().await;
    let url = format!(
        "{AJAX}/server/options/set-motd?TOKEN={}&SEC={}",
        s.token, s.sec_str()
    );
    let mut form = HashMap::new();
    form.insert("motd", motd);
    post_form(&s, &url, Some(&servid), &form).await?;
    Ok(())
}

#[tauri::command]
pub async fn aternos_set_subdomain(servid: String, subdomain: String) -> Result<(), String> {
    let s = regen_sec().await;
    let url = format!(
        "{AJAX}/server/options/set-subdomain?subdomain={}&TOKEN={}&SEC={}",
        urlencoding::encode(&subdomain),
        s.token,
        s.sec_str()
    );
    get(&s, &url, Some(&servid)).await?;
    Ok(())
}

/* ------------------------------------------------------------------ */
/* files list (best-effort parse)                                      */
/* ------------------------------------------------------------------ */

#[derive(serde::Serialize, Clone)]
pub struct AternosFile {
    pub path: String,
    pub kind: String,
    pub size: Option<String>,
}

fn parse_files_html(html: &str) -> Vec<AternosFile> {
    let mut out = Vec::new();
    let mut cursor = 0;
    while let Some(pos) = html[cursor..].find("data-path=\"") {
        let start = cursor + pos + 11;
        let chunk = &html[start..];
        let end = chunk.find('"').unwrap_or(chunk.len());
        let path = chunk[..end].to_string();
        // kind: look backwards for data-type
        let lookback = &html[cursor..start];
        let kind = find_between(lookback, "data-type=\"", "\"", 0).unwrap_or_else(|| "file".into());
        let size = find_between(&html[start..std::cmp::min(html.len(), start + 500)], "class=\"filesize\"", "</div>", 0)
            .map(|v| v.trim().to_string());
        out.push(AternosFile { path, kind, size });
        cursor = start + end + 1;
    }
    out
}

#[tauri::command]
pub async fn aternos_files(servid: String, path: String) -> Result<Vec<AternosFile>, String> {
    let s = regen_sec().await;
    let url = if path.trim().is_empty() {
        format!("{BASE}/files/")
    } else {
        format!("{BASE}/files/{}/", path.trim_start_matches('/'))
    };
    let resp = get(&s, &url, Some(&servid)).await?;
    let html = resp.text().await.unwrap_or_default();
    Ok(parse_files_html(&html))
}

#[tauri::command]
pub async fn aternos_download_file(servid: String, file_path: String, filename: String) -> Result<String, String> {
    let s = regen_sec().await;
    let encoded = file_path.replace('/', "%2F");
    let url = format!("{BASE}/files/?file={encoded}");
    let resp = get(&s, &url, Some(&servid)).await?;
    let bytes = resp.bytes().await.map_err(|e| format!("Download: {e}"))?;
    if bytes.len() > 80_000_000 {
        return Err("File too large for direct download (>80 MB)".into());
    }
    let downloads = dirs_next::download_dir().unwrap_or_else(|| std::path::PathBuf::from("."));
    std::fs::create_dir_all(&downloads).ok();
    let out = downloads.join(&filename);
    std::fs::write(&out, &bytes).map_err(|e| format!("Write: {e}"))?;
    Ok(out.to_string_lossy().to_string())
}

/* ------------------------------------------------------------------ */
/* upload (best-effort attempt — may fail; user sees clear error)      */
/* ------------------------------------------------------------------ */

#[tauri::command]
pub async fn aternos_upload_file(
    servid: String,
    target_path: String,
    filename: String,
    data: Vec<u8>,
) -> Result<(), String> {
    if data.len() > 64_000_000 {
        return Err("File too large for upload (>64 MB)".into());
    }
    let s = regen_sec().await;
    let url = format!(
        "{AJAX}/file/upload?TOKEN={}&SEC={}",
        s.token,
        s.sec_str()
    );
    let part = reqwest::multipart::Part::bytes(data)
        .file_name(filename.clone())
        .mime_str("application/java-archive")
        .unwrap_or_else(|_| reqwest::multipart::Part::bytes(vec![]).file_name(filename.clone()));
    let form = reqwest::multipart::Form::new()
        .part("file", part)
        .text("path", target_path);
    polite().await;
    let resp = CLIENT
        .post(url)
        .header("Cookie", cookie_headers(&s, Some(&servid)))
        .header("X-Requested-With", "XMLHttpRequest")
        .multipart(form)
        .send()
        .await
        .map_err(|e| format!("Upload: {e}"))?;
    let status = resp.status();
    let body = resp.text().await.unwrap_or_default();
    if status.is_success() || body.contains("success") {
        Ok(())
    } else {
        Err(format!("Upload failed ({status}): {body}"))
    }
}

/* ------------------------------------------------------------------ */
/* create server (best-effort — if endpoint not available, opens browser) */
/* ------------------------------------------------------------------ */

#[tauri::command]
pub async fn aternos_create_server(
    name: String,
    version: String,
    software: Option<String>,
) -> Result<String, String> {
    let s = regen_sec().await;
    let url = format!(
        "{AJAX}/server/create?TOKEN={}&SEC={}",
        s.token,
        s.sec_str()
    );
    let mut form: HashMap<&str, String> = HashMap::new();
    form.insert("name", name);
    form.insert("version", version);
    if let Some(sw) = software {
        form.insert("software", sw);
    }
    let resp = post_form(&s, &url, None, &form).await?;
    let status = resp.status();
    let status_body = resp.text().await.unwrap_or_default();
    if status.is_success() && (status_body.contains("success") || status_body.contains("server")) {
        Ok(status_body)
    } else {
        // fallback: open browser create page
        let _ = crate::commands::files::open_url(format!("{BASE}/servers/")).await;
        Err(format!("Aternos API create failed ({status}). Opened browser — create your server there."))
    }
}

/* ------------------------------------------------------------------ */
/* watchdog (24/7 auto-restart + optional confirm)                      */
/* ------------------------------------------------------------------ */

struct WatchCtx {
    stop: tokio::sync::watch::Sender<bool>,
    interval_secs: u64,
}

static WATCH: Lazy<tokio::sync::Mutex<Option<(String, WatchCtx)>>> =
    Lazy::new(|| tokio::sync::Mutex::new(None));

#[tauri::command]
pub async fn aternos_watch_set(app: AppHandle, servid: String, enabled: bool, interval_secs: Option<u64>) -> Result<(), String> {
    let mut w = WATCH.lock().await;
    if !enabled {
        if let Some((_, ctx)) = w.take() {
            let _ = ctx.stop.send(true);
        }
        return Ok(());
    }
    if let Some((old, ctx)) = w.take() {
        let _ = ctx.stop.send(true);
        if old == servid && !enabled {
            return Ok(());
        }
    }
    let (tx, mut rx) = tokio::sync::watch::channel(false);
    let interval = interval_secs.unwrap_or(50).max(35);
    let id = servid.clone();
    let app2 = app.clone();
    tauri::async_runtime::spawn(async move {
        let mut consecutive_offline = 0u32;
        let mut last_started_at: Option<std::time::Instant> = None;
        let mut confirmed = false;
        loop {
            let off = *rx.borrow();
            if off {
                break;
            }
            let info = match aternos_server_info(id.clone()).await {
                Ok(i) => i,
                Err(_) => {
                    tokio::time::sleep(Duration::from_secs(interval)).await;
                    continue;
                }
            };
            let _ = app2.emit("aternos-status", serde_json::json!({"servid":id,"status":info.class.clone(),"online":info.online,"starting":info.starting}));
            if info.online {
                consecutive_offline = 0;
                confirmed = false;
            } else if info.starting {
                // in queue/starting — confirm if we started it recently
                if last_started_at.is_some() && !confirmed {
                    if aternos_confirm(id.clone()).await.is_ok() {
                        confirmed = true;
                    }
                }
            } else {
                consecutive_offline += 1;
                if consecutive_offline >= 2 {
                    if let Ok(v) = aternos_start(id.clone()).await {
                        if v["success"] == serde_json::json!(true) {
                            last_started_at = Some(std::time::Instant::now());
                            confirmed = false;
                            consecutive_offline = 0;
                            let _ = app2.emit("aternos-status", serde_json::json!({"servid":id,"status":"starting","online":false,"starting":true}));
                        }
                    }
                }
            }
            tokio::select! {
                _ = tokio::time::sleep(Duration::from_secs(interval)) => {},
                _ = rx.changed() => {},
            }
        }
    });
    *w = Some((servid, WatchCtx { stop: tx, interval_secs: interval }));
    Ok(())
}

/* ------------------------------------------------------------------ */
/* console via WebSocket                                               */
/* ------------------------------------------------------------------ */

struct ConsoleCtx {
    stop: tokio::sync::watch::Sender<bool>,
    cmd_tx: tokio::sync::mpsc::Sender<String>,
}

static CONSOLE: Lazy<tokio::sync::Mutex<Option<(String, ConsoleCtx)>>> =
    Lazy::new(|| tokio::sync::Mutex::new(None));

#[tauri::command]
pub async fn aternos_console_open(app: AppHandle, servid: String) -> Result<(), String> {
    {
        let mut c = CONSOLE.lock().await;
        if let Some((old, ctx)) = c.take() {
            let _ = ctx.stop.send(true);
            if old == servid {
                // reconnect anyway
            }
        }
    }
    let s = session().await;
    if s.session_cookie.is_empty() {
        return Err("Not logged in".into());
    }
    let cookie = format!(
        "ATERNOS_SESSION={}; ATERNOS_SERVER={}",
        s.session_cookie, servid
    );
    let (ws_stream, _) = tokio_tungstenite::connect_async({
        let req = tokio_tungstenite::tungstenite::http::Request::builder()
            .uri("wss://aternos.org/hermes/")
            .header("Origin", "https://aternos.org")
            .header("Cookie", cookie)
            .header("User-Agent", UA)
            .body(())
            .map_err(|e| format!("WS request: {e}"))?;
        req
    })
    .await
    .map_err(|e| format!("WebSocket connect: {e}"))?;

    let (mut ws_tx, mut ws_rx) = ws_stream.split();
    let (cmd_tx, mut cmd_rx) = tokio::sync::mpsc::channel::<String>(128);
    let (stop_tx, mut stop_rx) = tokio::sync::watch::channel(false);
    let app2 = app.clone();
    let sid = servid.clone();

    tauri::async_runtime::spawn(async move {
        use tokio_tungstenite::tungstenite::Message;
        // start console stream
        let _ = ws_tx.send(Message::Text(r#"{"stream":"console","type":"start"}"#.into())).await;
        let mut interval = tokio::time::interval(Duration::from_secs(44));
        interval.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Delay);
        loop {
            tokio::select! {
                _ = stop_rx.changed() => { break; }
                _ = interval.tick() => { let _ = ws_tx.send(Message::Text(r#"{"type":"❤"}"#.into())).await; }
                Some(cmd) = cmd_rx.recv() => {
                    let j = serde_json::json!({"stream":"console","type":"command","data":cmd});
                    let _ = ws_tx.send(Message::Text(j.to_string().into())).await;
                }
                msg = ws_rx.next() => {
                    match msg {
                        Some(Ok(Message::Text(t))) => {
                            if let Ok(v) = serde_json::from_str::<serde_json::Value>(&t) {
                                let typ = v["type"].as_str().unwrap_or("");
                                match typ {
                                    "line" => {
                                        let line = v["data"].as_str().unwrap_or("").trim();
                                        let _ = app2.emit("aternos-console", serde_json::json!({"servid":sid,"line":line}));
                                    }
                                    "status" => {
                                        if let Ok(m) = serde_json::from_str::<serde_json::Value>(v["message"].as_str().unwrap_or("{}")) {
                                            let _ = app2.emit("aternos-status", serde_json::json!({"servid":sid,"status":m["class"],"online":m["online"],"starting":m["starting"],"players":m["players"],"ram":m["ram"],"mem":m["mem"]}));
                                        }
                                    }
                                    _ => {}
                                }
                            }
                        }
                        Some(Ok(Message::Close(_))) | Some(Err(_)) | None => { break; }
                        _ => {}
                    }
                }
            }
        }
        let _ = app2.emit("aternos-console", serde_json::json!({"servid":sid,"line":"[console] disconnected"}));
    });

    *CONSOLE.lock().await = Some((servid, ConsoleCtx { stop: stop_tx, cmd_tx }));
    Ok(())
}

#[tauri::command]
pub async fn aternos_console_command(servid: String, cmd: String) -> Result<(), String> {
    let c = CONSOLE.lock().await;
    let (sid, ctx) = c.as_ref().ok_or("Console not open")?;
    if sid != &servid {
        return Err("Console open for different server".into());
    }
    ctx.cmd_tx
        .send(cmd)
        .await
        .map_err(|_| "Console channel closed".into())
}

#[tauri::command]
pub async fn aternos_console_close() -> Result<(), String> {
    let mut c = CONSOLE.lock().await;
    if let Some((_, ctx)) = c.take() {
        let _ = ctx.stop.send(true);
    }
    Ok(())
}

/* ------------------------------------------------------------------ */
/* AFK bot (join loop + keepalive; adaptive version on kick)           */
/* ------------------------------------------------------------------ */

static AFK: Lazy<tokio::sync::Mutex<Option<(String, tokio::sync::watch::Sender<bool>)>>> =
    Lazy::new(|| tokio::sync::Mutex::new(None));

#[tauri::command]
pub async fn aternos_afk_set(
    app: AppHandle,
    servid: String,
    enabled: bool,
    nickname: String,
    max_protocol: Option<i32>,
) -> Result<(), String> {
    let mut m = AFK.lock().await;
    if !enabled {
        if let Some((_, s)) = m.take() {
            let _ = s.send(true);
        }
        return Ok(());
    }
    if let Some((_, old)) = m.take() {
        let _ = old.send(true);
    }
    let (stop_tx, mut stop_rx) = tokio::sync::watch::channel(false);
    let sid = servid.clone();
    let app2 = app.clone();
    let maxp = max_protocol.unwrap_or(767).max(730);
    tauri::async_runtime::spawn(async move {
        loop {
            if *stop_rx.borrow() { break; }
            // fetch server host/port/version
            let info = match aternos_server_info(sid.clone()).await { Ok(i)=>i, Err(_)=>{tokio::time::sleep(Duration::from_secs(8)).await;continue} };
            if !info.online {
                tokio::time::sleep(Duration::from_secs(10)).await;
                continue;
            }
            let host = info.domain.as_deref().or(info.ip.as_deref()).unwrap_or("");
            let port = info.port.unwrap_or(25565) as u16;
            let proto = protocol_for_version(info.version.as_deref().unwrap_or("")).unwrap_or(maxp);
            if host.is_empty() { tokio::time::sleep(Duration::from_secs(5)).await; continue; }
            let _ = app2.emit("aternos-afk", serde_json::json!({"servid":sid,"event":"connecting","proto":proto}));
            match afk_run_loop(host, port, &nickname, proto, &mut stop_rx).await {
                Ok(()) => { let _ = app2.emit("aternos-afk", serde_json::json!({"servid":sid,"event":"stopped"})); break; }
                Err(reason) => { let _ = app2.emit("aternos-afk", serde_json::json!({"servid":sid,"event":"reconnecting","reason":reason})); }
            }
            tokio::time::sleep(Duration::from_secs(3)).await;
        }
    });
    *m = Some((servid, stop_tx));
    Ok(())
}

fn varint_len(v: u64) -> usize {
    let mut c = 0;
    let mut x = v as u32;
    loop {
        x >>= 7;
        c += 1;
        if x == 0 { break; }
    }
    c
}

fn write_varint(buf: &mut Vec<u8>, v: i32) {
    let mut u = ((v as u32) << 1) ^ ((v >> 31) as u32);
    loop {
        let mut b = (u & 0x7F) as u8;
        u >>= 7;
        if u != 0 { b |= 0x80; }
        buf.push(b);
        if u == 0 { break; }
    }
}

fn write_packet(buf: &mut Vec<u8>, id: i32, payload: &[u8]) {
    let id_len = varint_len(id as u64);
    let total_len = id_len + payload.len();
    write_varint(buf, total_len as i32);
    write_varint(buf, id);
    buf.extend_from_slice(payload);
}

fn write_str(s: &str) -> Vec<u8> {
    let mut out = Vec::new();
    write_varint(&mut out, s.len() as i32);
    out.extend_from_slice(s.as_bytes());
    out
}

fn offline_uuid(name: &str) -> String {
    use sha1::{Digest, Sha1};
    let mut h = Sha1::new();
    h.update(format!("OfflinePlayer:{name}").as_bytes());
    let mut r = h.finalize();
    // set variant bits (2 bits) to 10
    r[6] = (r[6] & 0x0F) | 0x80;
    r[8] = (r[8] & 0x3F) | 0x80;
    format!(
        "{:02x}{:02x}{:02x}{:02x}-{:02x}{:02x}-{:02x}{:02x}-{:02x}{:02x}-{:02x}{:02x}{:02x}{:02x}{:02x}{:02x}",
        r[0], r[1], r[2], r[3], r[4], r[5], r[6], r[7], r[8], r[9], r[10], r[11], r[12], r[13], r[14], r[15]
    )
}

fn protocol_for_version(ver: &str) -> Option<i32> {
    // map to known protocol IDs (1.14.4..1.21.0)
    let v = ver.trim();
    if v.is_empty() { return None; }
    let parts: Vec<&str> = v.split('.').collect();
    let major = parts.first().and_then(|s| s.parse::<u32>().ok())?;
    let minor = parts.get(1).and_then(|s| s.parse::<u32>().ok())?;
    let patch = parts.get(2).and_then(|s| s.parse::<u32>().ok()).unwrap_or(0);
    Some(match (major, minor, patch) {
        (1,21,0)|(1,21,1)|(1,21,2)|(1,21,3)|(1,21,4) => 767,
        (1,20,6) => 769,
        (1,20,4)|(1,20,5) => 765,
        (1,20,3) => 764,
        (1,20,2) => 763,
        (1,20,1) => 762,
        (1,20,0) => 761,
        (1,19,4) => 762,
        (1,19,3) => 761,
        (1,19,2) => 760,
        (1,19,1) => 760,
        (1,19,0) => 759,
        (1,18,2) => 758,
        (1,18,1) => 757,
        (1,18,0) => 757,
        (1,17,1) => 756,
        (1,17,0) => 755,
        (1,16,5) => 754,
        (1,16,4) => 754,
        (1,16,3) => 754,
        (1,16,2) => 754,
        (1,16,1) => 754,
        (1,16,0) => 754,
        _ => 767,
    })
}

async fn afk_run_loop(
    host: &str,
    port: u16,
    name: &str,
    proto: i32,
    stop: &mut tokio::sync::watch::Receiver<bool>,
) -> Result<(), &'static str> {
    use tokio::io::{AsyncReadExt, AsyncWriteExt};
    use tokio::net::TcpStream;

    let addr = format!("{}:{}", host, port);
    let mut stream = TcpStream::connect(&addr)
        .await
        .map_err(|_| "tcp connect failed")?;
    stream.set_nodelay(true).ok();

    // Handshake (next=2 login)
    let mut handshake = Vec::new();
    write_varint(&mut handshake, 0);
    write_varint(&mut handshake, proto);
    let mut hpayload = Vec::new();
    hpayload.extend_from_slice(&write_str(host));
    hpayload.extend_from_slice(&(port as u16).to_be_bytes());
    hpayload.push(2);
    let mut hb = Vec::new();
    write_packet(&mut hb, 0, &hpayload);
    let _ = stream.write_all(&hb).await.map_err(|_| "write handshake")?;

    // Login Start (offline uuid in 1.16+)
    let uuid_str = offline_uuid(name);
    let mut ls = Vec::new();
    ls.extend_from_slice(&write_str(name));
    // UUID as two i64 (MSB/LSB)
    let uuid_no_dash: String = uuid_str.chars().filter(|c| *c != '-').collect();
    let bytes = hex_decode_16(&uuid_no_dash).unwrap_or([0u8;16]);
    let msb = i64::from_be_bytes(bytes[..8].try_into().unwrap());
    let lsb = i64::from_be_bytes(bytes[8..].try_into().unwrap());
    ls.extend_from_slice(&msb.to_be_bytes());
    ls.extend_from_slice(&lsb.to_be_bytes());
    let mut lb = Vec::new();
    write_packet(&mut lb, 0, &ls);
    let _ = stream.write_all(&lb).await.map_err(|_| "write login start")?;

    // Read loop — respond to keep-alive and detect kick
    let mut buf = vec![0u8; 8192];
    let mut partial = Vec::new();
    loop {
        tokio::select! {
            _ = stop.changed() => { return Ok(()); }
            res = stream.read(&mut buf) => {
                match res {
                    Ok(0) => return Err("eof"),
                    Ok(n) => {
                        partial.extend_from_slice(&buf[..n]);
                        while let Some(pkt) = try_read_varint_packet(&mut partial) {
                            let id = pkt.0;
                            let payload = pkt.1;
                            // Play state: keep-alive serverbound IDs vary widely by version
                            // We respond if id looks like keepalive (common 0x1F for 1.16-1.17.1, 0x21 for 1.18-1.19.3, 0x20 for 1.20.0..1.20.1 etc.)
                            // For robustness: if 8-byte payload (i64 keepalive), respond with same id and 8 bytes
                            if payload.len() == 8 && (0x1A..=0x22).contains(&id) {
                                let mut ack = Vec::new();
                                write_packet(&mut ack, id - 15, &payload); // heuristic serverbound id = clientbound - 15 (works many versions); on miss server just kicks → we reconnect
                                let _ = stream.write_all(&ack).await;
                            }
                            // disconnect / kick packet 0x1A or 0x19 contains JSON reason
                            if (id == 0x1A || id == 0x19) && !payload.is_empty() {
                                let msg = String::from_utf8_lossy(&payload);
                                return Err("kicked");
                            }
                        }
                    }
                    Err(e) => {
                        let _ = e;
                        return Err("read error");
                    }
                }
            }
        }
    }
}

fn try_read_varint_packet(buf: &mut Vec<u8>) -> Option<(i32, Vec<u8>)> {
    let (vi, vi_len) = decode_varint(buf, 0)?;
    if buf.len() < vi_len + vi as usize {
        return None;
    }
    let packet_start = vi_len;
    let (id, id_len) = decode_varint(buf, packet_start)?;
    let payload_start = packet_start + id_len;
    let payload_end = packet_start + vi as usize;
    let payload = buf[payload_start..payload_end].to_vec();
    // consume
    let _ = buf.drain(..payload_end);
    Some((id, payload))
}

fn decode_varint(buf: &[u8], start: usize) -> Option<(i32, usize)> {
    let mut result: i32 = 0;
    let mut shift = 0;
    let mut i = start;
    loop {
        if i >= buf.len() || i - start >= 5 { return None; }
        let b = buf[i];
        result |= ((b & 0x7F) as i32) << shift;
        shift += 7;
        i += 1;
        if b & 0x80 == 0 { return Some((result, i - start)); }
    }
}

fn hex_decode_16(s: &str) -> Option<[u8; 16]> {
    let mut out = [0u8;16];
    if s.len() < 32 { return None; }
    for i in 0..16 {
        let hi = s.as_bytes()[i*2];
        let lo = s.as_bytes()[i*2+1];
        out[i] = (hex_digit(hi)? << 4) | hex_digit(lo)?;
    }
    Some(out)
}

fn hex_digit(b: u8) -> Option<u8> {
    match b {
        b'0'..=b'9' => Some(b - b'0'),
        b'a'..=b'f' => Some(b - b'a' + 10),
        b'A'..=b'F' => Some(b - b'A' + 10),
        _ => None,
    }
}

use keyring::Entry;
use serde::{Deserialize, Serialize};
use serde_json::Value;

const API: &str = "https://api.millida.net/v2";
const SERVICE: &str = "PortalLauncher-Millida";
const ACCESS_KEY: &str = "access";
const REFRESH_KEY: &str = "refresh";

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MillidaLoginInit {
    pub device_code: String,
    pub user_code: String,
    pub verify_url: String,
    pub expires_in_sec: u64,
    pub interval_sec: u64,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct MillidaPublicProfile {
    pub id: String,
    pub email: Option<String>,
    pub nickname: Option<String>,
    pub avatar_url: Option<String>,
    pub profile_url: Option<String>,
    pub status: Option<String>,
}

fn entry(key: &str) -> Result<Entry, String> {
    Entry::new(SERVICE, key).map_err(|e| format!("Millida keyring error: {e}"))
}

fn save(key: &str, value: &str) -> Result<(), String> {
    entry(key)?.set_password(value).map_err(|e| format!("Millida keyring write error: {e}"))
}

fn load(key: &str) -> Option<String> {
    entry(key).ok()?.get_password().ok().filter(|v| !v.is_empty())
}

fn clear(key: &str) -> Result<(), String> {
    match entry(key)?.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(e) => Err(format!("Millida keyring delete error: {e}")),
    }
}

async fn public_request(path: &str, method: reqwest::Method, body: Option<Value>, token: Option<String>) -> Result<Value, String> {
    let client = reqwest::Client::builder().timeout(std::time::Duration::from_secs(15)).build().map_err(|e| e.to_string())?;
    let mut request = client.request(method, format!("{API}{path}"));
    if let Some(token) = token.filter(|t| !t.is_empty()) { request = request.bearer_auth(token); }
    if let Some(body) = body { request = request.json(&body); }
    let response = request.send().await.map_err(|e| format!("Millida network error: {e}"))?;
    let status = response.status();
    let text = response.text().await.unwrap_or_default();
    if !status.is_success() { return Err(format!("Millida API {}", status.as_u16())); }
    if text.trim().is_empty() { return Ok(Value::Null); }
    serde_json::from_str(&text).map_err(|e| format!("Millida response error: {e}"))
}

#[tauri::command]
pub async fn millida_login_init() -> Result<MillidaLoginInit, String> {
    let result = public_request(
        "/auth/launcher/init",
        reqwest::Method::POST,
        Some(serde_json::json!({ "clientName": "Portal Launcher" })),
        None,
    ).await?;
    Ok(MillidaLoginInit {
        device_code: result["deviceCode"].as_str().unwrap_or_default().to_string(),
        user_code: result["userCode"].as_str().unwrap_or_default().to_string(),
        verify_url: result["verifyUrl"].as_str().unwrap_or("https://millida.net/auth/launcher").to_string(),
        expires_in_sec: result["expiresInSec"].as_u64().unwrap_or(600),
        interval_sec: result["intervalSec"].as_u64().unwrap_or(3),
    })
}

#[tauri::command]
pub async fn millida_login_poll(device_code: String) -> Result<Value, String> {
    if device_code.trim().is_empty() { return Err("Millida device code is empty".into()); }
    let result = public_request(
        "/auth/launcher/poll",
        reqwest::Method::POST,
        Some(serde_json::json!({ "deviceCode": device_code })),
        None,
    ).await?;
    if result["status"].as_str() == Some("ok") {
        let access = result["accessToken"].as_str().unwrap_or_default();
        if access.is_empty() { return Err("Millida response has no access token".into()); }
        save(ACCESS_KEY, access)?;
        if let Some(refresh) = result["refreshToken"].as_str().filter(|v| !v.is_empty()) { save(REFRESH_KEY, refresh)?; }
    }
    let mut safe = result.clone();
    if let Some(object) = safe.as_object_mut() { object.remove("accessToken"); object.remove("refreshToken"); }
    Ok(safe)
}

#[tauri::command]
pub fn millida_session_status() -> bool { load(ACCESS_KEY).is_some() || load(REFRESH_KEY).is_some() }

#[tauri::command]
pub async fn millida_profile() -> Result<MillidaPublicProfile, String> {
    let access = load(ACCESS_KEY).ok_or("Millida session is not connected")?;
    let value = public_request("/core/user/me", reqwest::Method::GET, None, Some(access)).await?;
    let source = value.get("user").unwrap_or(&value);
    Ok(serde_json::from_value(source.clone()).map_err(|e| format!("Millida profile response error: {e}"))?)
}

#[tauri::command]
pub async fn millida_friends_snapshot() -> Result<Value, String> {
    let access = load(ACCESS_KEY).ok_or("Millida session is not connected")?;
    let friends = public_request("/friends", reqwest::Method::GET, None, Some(access.clone())).await?;
    let requests = public_request("/friends/requests", reqwest::Method::GET, None, Some(access)).await.unwrap_or(Value::Array(Vec::new()));
    Ok(serde_json::json!({ "friends": friends, "requests": requests, "available": true }))
}

#[tauri::command]
pub async fn millida_upload_chat_file(filename: String, mime: String, bytes: Vec<u8>) -> Result<Value, String> {
    const MAX_CHAT_FILE_BYTES: usize = 25 * 1024 * 1024;
    if bytes.is_empty() { return Err("Файл пустой".into()); }
    if bytes.len() > MAX_CHAT_FILE_BYTES { return Err("Файл больше 25 МБ".into()); }
    let access = load(ACCESS_KEY).ok_or("Millida session is not connected")?;
    let client = reqwest::Client::builder().timeout(std::time::Duration::from_secs(60)).build().map_err(|e| e.to_string())?;
    let part = reqwest::multipart::Part::bytes(bytes).file_name(filename).mime_str(&mime).map_err(|e| e.to_string())?;
    let form = reqwest::multipart::Form::new().part("file", part);
    let response = client.post(format!("{API}/friends/chat/upload")).bearer_auth(access).multipart(form).send().await.map_err(|e| format!("Millida upload error: {e}"))?;
    let status = response.status();
    let text = response.text().await.unwrap_or_default();
    if !status.is_success() { return Err(format!("Millida upload API {}", status.as_u16())); }
    if text.trim().is_empty() { return Ok(Value::Null); }
    serde_json::from_str(&text).map_err(|e| format!("Millida upload response error: {e}"))
}

#[tauri::command]
pub async fn millida_send_friend_request(nickname: Option<String>, target_id: Option<String>) -> Result<Value, String> {
    let access = load(ACCESS_KEY).ok_or("Millida session is not connected")?;
    let mut body = serde_json::Map::new();
    if let Some(target_id) = target_id.filter(|value| !value.trim().is_empty()) { body.insert("targetId".into(), Value::String(target_id)); }
    if let Some(nickname) = nickname.filter(|value| !value.trim().is_empty()) { body.insert("nickname".into(), Value::String(nickname)); }
    if body.is_empty() { return Err("Укажи ник или идентификатор Millida".into()); }
    public_request("/friends/request", reqwest::Method::POST, Some(Value::Object(body)), Some(access)).await
}

/// Отправка текстового сообщения через Millida без раскрытия access token в WebView.
/// Relay остаётся transport для live-delivery; этот вызов даёт Millida возможность
/// синхронизировать историю там, где API сервиса поддерживает этот маршрут.
#[tauri::command]
pub async fn millida_send_chat_message(friend_uuid: String, text: String) -> Result<Value, String> {
    let access = load(ACCESS_KEY).ok_or("Millida session is not connected")?;
    if friend_uuid.trim().is_empty() { return Err("Millida friend ID is empty".into()); }
    if text.trim().is_empty() { return Err("Сообщение пустое".into()); }
    public_request(
        "/friends/chat/message",
        reqwest::Method::POST,
        Some(serde_json::json!({ "user_id": friend_uuid, "text": text })),
        Some(access),
    ).await
}

/// Удаляет реальную связь друзей в Millida. Локальный список должен обновиться
/// только после успешного ответа сервиса.
#[tauri::command]
pub async fn millida_remove_friend(friend_uuid: String) -> Result<Value, String> {
    let access = load(ACCESS_KEY).ok_or("Millida session is not connected")?;
    if friend_uuid.trim().is_empty() { return Err("Millida friend ID is empty".into()); }
    public_request(
        &format!("/friends/{}", urlencoding::encode(friend_uuid.trim())),
        reqwest::Method::DELETE,
        None,
        Some(access),
    ).await
}

#[tauri::command]
pub fn millida_logout() -> Result<(), String> { clear(ACCESS_KEY)?; clear(REFRESH_KEY) }

use keyring::Entry;
use serde::{Deserialize, Serialize};
use serde_json::Value;

const API: &str = "https://millida.net/v2/hosting/api";
const SERVICE: &str = "PortalLauncher-Millida-Hosting";
const KEY_NAME: &str = "hosting_api_key";

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct HostingServer {
    pub name: Option<String>,
    pub address: Option<String>,
    pub version: Option<String>,
    pub plan: Option<String>,
    pub status: Option<String>,
    pub players: Option<Value>,
}

fn key_entry() -> Result<Entry, String> {
    Entry::new(SERVICE, KEY_NAME).map_err(|e| format!("Hosting keyring error: {e}"))
}

fn load_key() -> Result<String, String> {
    let value = key_entry()?.get_password().map_err(|e| format!("Hosting keyring read error: {e}"))?;
    if value.trim().is_empty() { return Err("Millida Hosting API key is empty".into()); }
    Ok(value)
}

async fn request(method: reqwest::Method, path: &str, body: Option<Value>) -> Result<Value, String> {
    let token = load_key()?;
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(20))
        .user_agent("PortalLauncher/1.0 (Millida Hosting integration)")
        .build()
        .map_err(|e| format!("Hosting HTTP client error: {e}"))?;
    let mut req = client.request(method, format!("{API}{path}")).bearer_auth(token);
    if let Some(body) = body { req = req.json(&body); }
    let response = req.send().await.map_err(|e| format!("Millida Hosting network error: {e}"))?;
    let status = response.status();
    let text = response.text().await.unwrap_or_default();
    if !status.is_success() {
        return Err(match status.as_u16() {
            401 | 403 => "Millida Hosting API key is invalid, expired, or lacks permission".into(),
            404 => "Millida Hosting server endpoint was not found".into(),
            429 => "Millida Hosting rate limit reached; try again later".into(),
            _ => format!("Millida Hosting API returned HTTP {}", status.as_u16()),
        });
    }
    if text.trim().is_empty() { return Ok(Value::Null); }
    serde_json::from_str(&text).map_err(|e| format!("Millida Hosting response error: {e}"))
}

#[tauri::command]
pub fn millida_hosting_key_status() -> bool {
    key_entry().ok().and_then(|e| e.get_password().ok()).map(|v| !v.trim().is_empty()).unwrap_or(false)
}

#[tauri::command]
pub fn millida_hosting_save_key(api_key: String) -> Result<(), String> {
    let value = api_key.trim();
    if value.is_empty() { return Err("Millida Hosting API key is empty".into()); }
    key_entry()?.set_password(value).map_err(|e| format!("Hosting keyring write error: {e}"))
}

#[tauri::command]
pub fn millida_hosting_clear_key() -> Result<(), String> {
    match key_entry()?.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(e) => Err(format!("Hosting keyring delete error: {e}")),
    }
}

#[tauri::command]
pub async fn millida_hosting_get_server() -> Result<Value, String> {
    request(reqwest::Method::GET, "/server", None).await
}

#[tauri::command]
pub async fn millida_hosting_get_status() -> Result<Value, String> {
    request(reqwest::Method::GET, "/status", None).await
}

#[tauri::command]
pub async fn millida_hosting_start() -> Result<Value, String> {
    request(reqwest::Method::POST, "/start", None).await
}

#[tauri::command]
pub async fn millida_hosting_stop() -> Result<Value, String> {
    request(reqwest::Method::POST, "/stop", None).await
}

#[tauri::command]
pub async fn millida_hosting_restart() -> Result<Value, String> {
    request(reqwest::Method::POST, "/restart", None).await
}

#[tauri::command]
pub async fn millida_hosting_get_console() -> Result<String, String> {
    let token = load_key()?;
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(20))
        .user_agent("PortalLauncher/1.0 (Millida Hosting integration)")
        .build()
        .map_err(|e| format!("Hosting HTTP client error: {e}"))?;
    let response = client.get(format!("{API}/console")).bearer_auth(token).send().await
        .map_err(|e| format!("Millida Hosting console network error: {e}"))?;
    let status = response.status();
    if !status.is_success() { return Err(format!("Millida Hosting console returned HTTP {}", status.as_u16())); }
    response.text().await.map_err(|e| format!("Millida Hosting console read error: {e}"))
}

/// Список файлов сервера. Базовый путь пустой; API ограничивает доступ правами ключа.
#[tauri::command]
pub async fn millida_hosting_list_files(path: Option<String>) -> Result<Value, String> {
    let encoded = path
        .filter(|value| !value.trim().is_empty())
        .map(|value| format!("?path={}", urlencoding::encode(value.trim())))
        .unwrap_or_default();
    request(reqwest::Method::GET, &format!("/files{encoded}"), None).await
}

/// Возвращает резервные копии; их creation/status остаётся асинхронным на стороне Millida.
#[tauri::command]
pub async fn millida_hosting_get_backups() -> Result<Value, String> {
    request(reqwest::Method::GET, "/backups", None).await
}

/// Запрашивает создание резервной копии. Ответ может содержать pending id; готовность
/// проверяется отдельной загрузкой списка копий, без агрессивного polling.
#[tauri::command]
pub async fn millida_hosting_create_backup() -> Result<Value, String> {
    request(reqwest::Method::POST, "/backups", None).await
}

#[tauri::command]
pub async fn millida_hosting_command(command: String) -> Result<Value, String> {
    if command.trim().is_empty() { return Err("Command is empty".into()); }
    request(reqwest::Method::POST, "/command", Some(serde_json::json!({ "command": command }))).await
}

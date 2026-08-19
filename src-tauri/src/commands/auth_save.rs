use serde::{Deserialize, Serialize};

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct AuthInfo {
    pub username: String,
    pub uuid: String,
    pub access_token: String,
    pub refresh_token: String,
    pub expires_at: u64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub xuid: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub skin_url: Option<String>,
}

// IMPORTANT: Must match the path used in minecraft_lib::oauth::auth_json_path()
fn auth_path() -> std::path::PathBuf {
    crate::minecraft_lib::oauth::auth_json_path()
}

#[tauri::command]
pub async fn save_auth_info(
    username: String,
    uuid: String,
    access_token: String,
    refresh_token: String,
    expires_at: u64,
) -> Result<(), String> {
    log::info!("💾 Saving auth: username={}, uuid={}, token_len={}", username, uuid, access_token.len());
    let info = AuthInfo { username, uuid, access_token, refresh_token, expires_at, xuid: None, skin_url: None };
    let path = auth_path();
    log::info!("📁 Auth path: {:?}", path);
    let dir = path.parent().unwrap().to_path_buf();
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let json = serde_json::to_string_pretty(&info).map_err(|e| e.to_string())?;
    log::info!("📄 Auth JSON: {}", &json[..json.len().min(200)]);
    std::fs::write(&path, json).map_err(|e| format!("Failed to write auth.json: {}", e))
}

#[tauri::command]
pub async fn get_auth_info_cmd() -> Result<Option<AuthInfo>, String> {
    match std::fs::read_to_string(auth_path()) {
        Ok(s) => {
            log::info!("📖 Reading auth.json: {}", &s[..s.len().min(200)]);
            serde_json::from_str(&s).map(Some).map_err(|e| e.to_string())
        }
        Err(_) => {
            log::warn!("⚠️ auth.json not found");
            Ok(None)
        }
    }
}

/// Debug command to check auth file existence and content
#[tauri::command]
pub async fn debug_auth_info() -> Result<serde_json::Value, String> {
    let path = auth_path();
    let exists = path.exists();
    let content = std::fs::read_to_string(&path).unwrap_or_default();
    
    Ok(serde_json::json!({
        "path": path.to_string_lossy().to_string(),
        "exists": exists,
        "content_length": content.len(),
        "content_preview": if content.len() > 200 { &content[..200] } else { &content },
    }))
}

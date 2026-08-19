use serde::{Deserialize, Serialize};
use tauri::State;
use crate::AppState;

// Microsoft OAuth2 URLs
const MS_LOGIN_URL: &str = "https://login.live.com/oauth20_authorize.srf";
const MS_TOKEN_URL: &str = "https://login.live.com/oauth20_token.srf";

// Minecraft API URLs
const MC_AUTH_URL: &str = "https://api.minecraftservices.com/authentication/login_with_xbox";
const MC_PROFILE_URL: &str = "https://api.minecraftservices.com/minecraft/profile";

// Xbox Live API URLs
const XBL_AUTH_URL: &str = "https://user.auth.xboxlive.com/user/authenticate";
const XSTS_AUTH_URL: &str = "https://xsts.auth.xboxlive.com/xsts/authorize";

// Client ID для Minecraft Java Edition (публичный, из open-source проектов)
const MS_CLIENT_ID: &str = "d6d5ecd2-cfa8-4757-bcba-1d7bd7246383";
const MS_CLIENT_ID_FALLBACK: &str = "63792cab-8f22-423d-834c-37a509d48d9c2";
const MS_REDIRECT_URI: &str = "https://login.microsoftonline.com/common/oauth26/nativeclient.htm";
const MS_SCOPE: &str = "XboxLive.signin offline_access openid profile";

// Device Code Flow URLs
const MS_DEVICE_CODE_URL: &str = "https://login.microsoftonline.com/consumers/oauth2/v2.0/devicecode";
const MS_DEVICE_TOKEN_URL: &str = "https://login.microsoftonline.com/consumers/oauth2/v2.0/token";

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct McProfile {
    pub uuid: String,
    pub username: String,
    pub skin_url: Option<String>,
    pub access_token: String,
    pub refresh_token: String,
    pub expires_in: u64,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct MsTokenResponse {
    pub access_token: String,
    pub refresh_token: String,
    pub expires_in: u64,
    pub token_type: String,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct XblTokenResponse {
    pub token: String,
    pub display_claims: XblDisplayClaims,
    pub x_err: Option<u64>,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct XblDisplayClaims {
    pub xui: Vec<XuiUser>,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct XuiUser {
    pub uhs: String,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct XstsTokenResponse {
    pub token: String,
    pub x_err: Option<u64>,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct McAuthResponse {
    pub access_token: String,
    pub refresh_token: String,
    pub expires_in: u64,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct DeviceCodeResponse {
    pub user_code: String,
    pub device_code: String,
    pub verification_uri: String,
    pub expires_in: u64,
    pub interval: u64,
    pub message: String,
}

/// Start Device Code Flow — получает код для авторизации
#[tauri::command]
pub async fn start_device_code_flow(
    _app: tauri::AppHandle,
    _state: State<'_, AppState>,
) -> Result<DeviceCodeResponse, String> {
    log::info!("🔐 Starting Device Code Flow");
    
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(30))
        .build()
        .map_err(|e| format!("Failed to build client: {}", e))?;
    
    // Пробуем основной client_id
    let response = client.post(MS_DEVICE_CODE_URL)
        .form(&[
            ("client_id", MS_CLIENT_ID),
            ("scope", MS_SCOPE),
        ])
        .send()
        .await
        .map_err(|e| format!("Failed to send device code request: {}", e))?;
    
    if response.status().is_success() {
        let device_code: DeviceCodeResponse = response.json()
            .await
            .map_err(|e| format!("Failed to parse device code response: {}", e))?;
        
        log::info!("✅ Device code received: {}", device_code.user_code);
        return Ok(device_code);
    }
    
    // Если не получилось, пробуем fallback
    log::warn!("⚠️ Primary client failed, trying fallback...");
    let fallback_response = client.post(MS_DEVICE_CODE_URL)
        .form(&[
            ("client_id", MS_CLIENT_ID_FALLBACK),
            ("scope", MS_SCOPE),
        ])
        .send()
        .await
        .map_err(|e| format!("Failed to send fallback device code request: {}", e))?;
    
    if !fallback_response.status().is_success() {
        let error_text = fallback_response.text().await.unwrap_or_default();
        return Err(format!("Failed to get device code: {}", error_text));
    }
    
    let device_code: DeviceCodeResponse = fallback_response.json()
        .await
        .map_err(|e| format!("Failed to parse fallback device code response: {}", e))?;
    
    log::info!("✅ Fallback device code received: {}", device_code.user_code);
    Ok(device_code)
}

/// Poll for token using device code
#[tauri::command]
pub async fn poll_for_token(
    device_code: String,
    _state: State<'_, AppState>,
) -> Result<Option<McProfile>, String> {
    log::info!("🔄 Polling for token");
    
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(30))
        .build()
        .map_err(|e| format!("Failed to build client: {}", e))?;
    
    let response = client.post(MS_DEVICE_TOKEN_URL)
        .form(&[
            ("client_id", MS_CLIENT_ID),
            ("device_code", &device_code),
            ("grant_type", "urn:ietf:params:oauth:grant-type:device_code"),
        ])
        .send()
        .await
        .map_err(|e| format!("Failed to send token request: {}", e))?;
    
    let status = response.status();
    
    if status.is_success() {
        log::info!("✅ Token endpoint returned success");
    } else if status == reqwest::StatusCode::UNAUTHORIZED {
        log::info!("⏳ Waiting for user authorization");
        return Ok(None);
    } else {
        let error_text = response.text().await.unwrap_or_default();
        log::warn!("⚠️ Token request failed: {}", error_text);
        return Err(format!("Failed to get token: {}", error_text));
    }
    
    let ms_tokens: MsTokenResponse = response.json()
        .await
        .map_err(|e| format!("Failed to parse token response: {}", e))?;
    
    log::info!("✅ Microsoft tokens received");
    
    // Get Xbox Live token
    let xbl_token = get_xbl_token(&ms_tokens.access_token).await?;
    log::info!("✅ Xbox Live token received");
    
    // Get XSTS token
    let xsts_token = get_xsts_token(&xbl_token.token).await?;
    log::info!("✅ XSTS token received");
    
    // Get Minecraft authentication token
    let mc_token = get_mc_token(&xbl_token.display_claims.xui[0].uhs, &xsts_token.token).await?;
    log::info!("✅ Minecraft token received");
    
    // Get Minecraft profile
    let profile = get_mc_profile(&mc_token.access_token, &mc_token.refresh_token, mc_token.expires_in).await?;
    log::info!("✅ Minecraft profile received: {}", profile.username);
    
    // Save auth
    let xuid = xbl_token.display_claims.xui.first().map(|u| u.uhs.clone());
    save_auth(&profile.uuid, &profile.username, &mc_token.access_token, &mc_token.refresh_token, mc_token.expires_in, xuid.as_deref());
    
    Ok(Some(profile))
}

async fn get_mc_profile(access_token: &str, refresh_token: &str, expires_in: u64) -> Result<McProfile, String> {
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(30))
        .build()
        .map_err(|e| format!("Failed to build client: {}", e))?;
    
    let response = client.get(MC_PROFILE_URL)
        .header("Authorization", format!("Bearer {}", access_token))
        .send()
        .await
        .map_err(|e| format!("Failed to send profile request: {}", e))?;
    
    if !response.status().is_success() {
        let error_text = response.text().await.unwrap_or_default();
        return Err(format!("Failed to get profile: {}", error_text));
    }
    
    let profile_data: serde_json::Value = response.json()
        .await
        .map_err(|e| format!("Failed to parse profile response: {}", e))?;
    
    let uuid = profile_data["id"].as_str().ok_or("UUID not found")?.to_string();
    let username = profile_data["name"].as_str().ok_or("Username not found")?.to_string();
    
    let skin_url = profile_data["skins"]
        .as_array()
        .and_then(|skins| skins.iter().find(|s| s["state"] == "ACTIVE"))
        .and_then(|skin| skin["url"].as_str())
        .map(String::from);
    
    Ok(McProfile {
        uuid,
        username,
        skin_url,
        access_token: access_token.to_string(),
        refresh_token: refresh_token.to_string(),
        expires_in,
    })
}

async fn get_xbl_token(ms_token: &str) -> Result<XblTokenResponse, String> {
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(30))
        .build()
        .map_err(|e| format!("Failed to build client: {}", e))?;
    
    let response = client.post(XBL_AUTH_URL)
        .header("User-Agent", "PortalLauncher/1.0")
        .header("Accept", "application/json")
        .json(&serde_json::json!({
            "Properties": {
                "AuthMethod": "RPS",
                "SiteName": "user.auth.xboxlive.com",
                "RpsTicket": format!("d={}", ms_token)
            },
            "RelyingParty": "http://auth.xboxlive.com",
            "TokenType": "JWT"
        }))
        .send()
        .await
        .map_err(|e| format!("Failed to send XBL request: {}", e))?;
    
    if !response.status().is_success() {
        let error_text = response.text().await.unwrap_or_default();
        return Err(format!("XBL authentication failed: {}", error_text));
    }
    
    let xbl_response: XblTokenResponse = response.json()
        .await
        .map_err(|e| format!("Failed to parse XBL response: {}", e))?;
    
    if let Some(xerr) = xbl_response.x_err {
        return Err(format!("XBL error code: {}", xerr));
    }
    
    Ok(xbl_response)
}

async fn get_xsts_token(xbl_token: &str) -> Result<XstsTokenResponse, String> {
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(30))
        .build()
        .map_err(|e| format!("Failed to build client: {}", e))?;
    
    let response = client.post(XSTS_AUTH_URL)
        .header("User-Agent", "PortalLauncher/1.0")
        .header("Accept", "application/json")
        .json(&serde_json::json!({
            "Properties": {
                "SandboxId": "RETAIL",
                "UserTokens": [xbl_token]
            },
            "RelyingParty": "rp://api.minecraftservices.com/",
            "TokenType": "JWT"
        }))
        .send()
        .await
        .map_err(|e| format!("Failed to send XSTS request: {}", e))?;
    
    if !response.status().is_success() {
        let error_text = response.text().await.unwrap_or_default();
        return Err(format!("XSTS authentication failed: {}", error_text));
    }
    
    let xsts_response: XstsTokenResponse = response.json()
        .await
        .map_err(|e| format!("Failed to parse XSTS response: {}", e))?;
    
    if let Some(xerr) = xsts_response.x_err {
        return Err(format!("XSTS error code: {}", xerr));
    }
    
    Ok(xsts_response)
}

async fn get_mc_token(user_hash: &str, xsts_token: &str) -> Result<McAuthResponse, String> {
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(30))
        .build()
        .map_err(|e| format!("Failed to build client: {}", e))?;
    
    let response = client.post(MC_AUTH_URL)
        .header("User-Agent", "PortalLauncher/1.0")
        .header("Accept", "application/json")
        .json(&serde_json::json!({
            "identityToken": format!("XBL3.0 x={};{}", user_hash, xsts_token)
        }))
        .send()
        .await
        .map_err(|e| format!("Failed to send MC auth request: {}", e))?;
    
    if !response.status().is_success() {
        let error_text = response.text().await.unwrap_or_default();
        return Err(format!("Minecraft authentication failed: {}", error_text));
    }
    
    let mc_response: McAuthResponse = response.json()
        .await
        .map_err(|e| format!("Failed to parse MC response: {}", e))?;
    
    Ok(mc_response)
}

fn save_auth(uuid: &str, username: &str, access_token: &str, refresh_token: &str, expires_in: u64, xuid: Option<&str>) {
    let path = dirs_next::data_dir()
        .unwrap_or_else(|| std::path::PathBuf::from("."))
        .join("PortalLauncher")
        .join("auth.json");
    
    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir).ok();
    }
    
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs();
    
    let data = serde_json::json!({
        "uuid": uuid,
        "username": username,
        "access_token": access_token,
        "refresh_token": refresh_token,
        "xuid": xuid,
        "expires_at": now + expires_in,
    });
    
    if let Ok(json) = serde_json::to_string_pretty(&data) {
        if let Err(e) = std::fs::write(&path, json) {
            log::warn!("Failed to save auth.json: {}", e);
        } else {
            log::info!("✅ Auth saved to: {:?}", path);
        }
    }
}

/// Get cached profile from auth.json
#[tauri::command]
pub async fn get_cached_profile_oauth() -> Result<Option<McProfile>, String> {
    let path = dirs_next::data_dir()
        .unwrap_or_else(|| std::path::PathBuf::from("."))
        .join("PortalLauncher")
        .join("auth.json");
    
    let data = std::fs::read_to_string(&path)
        .map_err(|_| "No cached profile found".to_string())?;
    
    let json: serde_json::Value = serde_json::from_str(&data)
        .map_err(|e| format!("Failed to parse auth.json: {}", e))?;
    
    let uuid = json["uuid"].as_str().unwrap_or("").to_string();
    let username = json["username"].as_str().unwrap_or("").to_string();
    let access_token = json["access_token"].as_str().unwrap_or("").to_string();
    let refresh_token = json["refresh_token"].as_str().unwrap_or("").to_string();
    let expires_at = json["expires_at"].as_u64().unwrap_or(0);
    
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs();
    
    let expires_in = if expires_at > now {
        expires_at - now
    } else {
        0
    };
    
    Ok(Some(McProfile {
        uuid,
        username,
        skin_url: None,
        access_token,
        refresh_token,
        expires_in,
    }))
}

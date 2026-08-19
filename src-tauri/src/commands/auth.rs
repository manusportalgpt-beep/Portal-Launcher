// auth.rs — ТОЛЬКО облачные функции (cloud sync)
// OAuth Device Code Flow перенесён в minecraft_lib::oauth

use tauri::State;
use crate::AppState;
use crate::services::cloud_auth::CloudAuthData;
use crate::services::cloud_sync::CloudSyncService;
use crate::minecraft_lib::AuthMcProfile as McProfile;

fn auth_json_path() -> std::path::PathBuf {
    crate::minecraft_lib::oauth::auth_json_path()
}

#[tauri::command]
pub async fn clear_auth() -> Result<(), String> {
    let path = auth_json_path();
    if path.exists() {
        std::fs::remove_file(&path).map_err(|e| format!("Clear: {e}"))?;
    }
    Ok(())
}

#[tauri::command]
pub async fn save_auth_to_cloud(_state: State<'_, AppState>) -> Result<bool, String> {
    let profile = match crate::minecraft_lib::oauth::get_cached_profile() {
        Some(p) => p,
        None => return Err("No authenticated profile found".into()),
    };

    let cloud_data = CloudAuthData::new(
        profile.uuid.clone(),
        profile.username.clone(),
        profile.uuid.clone(),
        profile.access_token.clone(),
        profile.refresh_token.clone(),
        profile.access_token.clone(),
        profile.expires_in,
        profile.skin_url.clone(),
        true,
    );

    let data_dir = crate::commands::version_manager::mc_base_dir();

    let cloud_service = CloudSyncService::new(data_dir.clone());
    cloud_service.save_to_cloud(&cloud_data).await?;

    Ok(true)
}

#[tauri::command]
pub async fn load_auth_from_cloud(_state: State<'_, AppState>) -> Result<Option<McProfile>, String> {
    let data_dir = crate::commands::version_manager::mc_base_dir();

    let cloud_service = CloudSyncService::new(data_dir.clone());

    let local_auth = crate::minecraft_lib::oauth::load_auth();
    let user_id = local_auth
        .as_ref()
        .and_then(|a| a["uuid"].as_str())
        .map(|s| s.to_string());

    let user_id = match user_id {
        Some(id) => id,
        None => return Ok(None),
    };

    match cloud_service.load_from_cloud(&user_id).await? {
        Some(cloud_data) => {
            if cloud_data.is_expired() {
                return Ok(None);
            }

            Ok(Some(McProfile {
                uuid: cloud_data.mc_uuid,
                username: cloud_data.username,
                skin_url: cloud_data.skin_url,
                access_token: cloud_data.mc_access_token,
                refresh_token: cloud_data.ms_refresh_token,
                expires_in: cloud_data.expires_at.saturating_sub(
                    std::time::SystemTime::now()
                        .duration_since(std::time::UNIX_EPOCH)
                        .unwrap_or_default()
                        .as_secs()
                ),
            }))
        }
        None => Ok(None),
    }
}

#[tauri::command]
pub async fn sync_auth_cloud(_state: State<'_, AppState>) -> Result<String, String> {
    let local_auth = crate::minecraft_lib::oauth::load_auth();

    if local_auth.is_none() {
        return Err("No local auth to sync".into());
    }

    let auth = local_auth.unwrap();
    let user_id = auth["uuid"].as_str().unwrap_or("").to_string();

    if user_id.is_empty() {
        return Err("Invalid auth data".into());
    }

    let data_dir = crate::commands::version_manager::mc_base_dir();

    let cloud_service = CloudSyncService::new(data_dir.clone());

    let cloud_data = CloudAuthData::new(
        user_id.clone(),
        auth["username"].as_str().unwrap_or("").to_string(),
        auth["uuid"].as_str().unwrap_or("").to_string(),
        auth["access_token"].as_str().unwrap_or("").to_string(),
        auth["refresh_token"].as_str().unwrap_or("").to_string(),
        auth["access_token"].as_str().unwrap_or("").to_string(),
        auth["expires_at"].as_u64().unwrap_or(0),
        None,
        true,
    );

    cloud_service.save_to_cloud(&cloud_data).await?;

    Ok("Auth synced to cloud successfully".into())
}

#[tauri::command]
pub async fn get_cloud_sync_status() -> Result<serde_json::Value, String> {
    let local_auth = crate::minecraft_lib::oauth::load_auth();
    let user_id = local_auth
        .as_ref()
        .and_then(|a| a["uuid"].as_str())
        .map(|s| s.to_string());

    let data_dir = crate::commands::version_manager::mc_base_dir();

    let cloud_service = CloudSyncService::new(data_dir.clone());

    match user_id {
        Some(id) => {
            let status = cloud_service.get_status(&id).await;
            Ok(serde_json::to_value(status).unwrap_or_default())
        }
        None => Ok(serde_json::json!({
            "is_synced": false,
            "last_sync": null,
            "provider": "PortalCloud",
            "error": "No authenticated user"
        })),
    }
}

#[tauri::command]
pub async fn set_cloud_provider(provider_type: String, access_token: Option<String>) -> Result<(), String> {
    use crate::services::cloud_auth::CloudProvider;

    let data_dir = crate::commands::version_manager::mc_base_dir();

    let cloud_service = CloudSyncService::new(data_dir.clone());

    let provider = match provider_type.as_str() {
        "portal" => CloudProvider::PortalCloud { api_key: None },
        "google" => {
            let token = access_token.ok_or("Google Drive requires access_token")?;
            CloudProvider::GoogleDrive { access_token: token }
        }
        "dropbox" => {
            let token = access_token.ok_or("Dropbox requires access_token")?;
            CloudProvider::Dropbox { access_token: token }
        }
        "local" => {
            let path = access_token.unwrap_or_else(|| data_dir.join("cloud_auth.json").to_string_lossy().to_string());
            CloudProvider::Local { path }
        }
        _ => return Err("Unknown provider. Use: portal, google, dropbox, local".into()),
    };

    cloud_service.set_provider(provider).await;
    Ok(())
}

#[tauri::command]
pub async fn delete_cloud_auth() -> Result<(), String> {
    let local_auth = crate::minecraft_lib::oauth::load_auth();
    let user_id = local_auth
        .as_ref()
        .and_then(|a| a["uuid"].as_str())
        .map(|s| s.to_string());

    if let Some(id) = user_id {
        let data_dir = crate::commands::version_manager::mc_base_dir();

        let cloud_service = CloudSyncService::new(data_dir);
        cloud_service.delete_cloud_auth(&id).await?;
    }

    Ok(())
}

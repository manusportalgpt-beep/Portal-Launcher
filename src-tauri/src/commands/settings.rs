use std::path::PathBuf;
use std::collections::HashMap;

fn settings_path() -> PathBuf {
    let mut p = dirs_next::data_dir().unwrap_or_else(|| PathBuf::from("."));
    p.push("PortalLauncher");
    std::fs::create_dir_all(&p).ok();
    p.push("settings.json");
    p
}

fn load_raw() -> HashMap<String, serde_json::Value> {
    std::fs::read_to_string(settings_path())
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default()
}

#[tauri::command]
pub async fn get_all() -> Result<HashMap<String, serde_json::Value>, String> {
    Ok(load_raw())
}

#[tauri::command]
pub async fn set_setting(key: String, value: serde_json::Value) -> Result<(), String> {
    let mut map = load_raw();
    map.insert(key, value);
    let data = serde_json::to_string_pretty(&map).map_err(|e| e.to_string())?;
    std::fs::write(settings_path(), data).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn save_all_settings(settings: HashMap<String, serde_json::Value>) -> Result<(), String> {
    let data = serde_json::to_string_pretty(&settings).map_err(|e| e.to_string())?;
    std::fs::write(settings_path(), data).map_err(|e| e.to_string())
}

/// Get a specific setting with a default value
#[tauri::command]
pub async fn get_setting(key: String, default: serde_json::Value) -> Result<serde_json::Value, String> {
    let map = load_raw();
    Ok(map.get(&key).cloned().unwrap_or(default))
}

/// Get boolean setting
pub fn get_bool_setting(key: &str, default: bool) -> bool {
    load_raw().get(key).and_then(|v| v.as_bool()).unwrap_or(default)
}

/// Quickly read the CurseForge API key from settings (used by curseforge module)
pub fn read_curseforge_api_key() -> String {
    load_raw().get("curseforge_api_key")
        .and_then(|v| v.as_str()).unwrap_or("").to_string()
}

/// Get the relay server base URL (configured in Settings → API Keys)
pub fn read_relay_url() -> String {
    load_raw().get("relay_server_url")
        .and_then(|v| v.as_str())
        .unwrap_or("http://localhost:3000").to_string()
}

#[tauri::command]
pub async fn get_curseforge_api_key() -> Result<String, String> {
    Ok(read_curseforge_api_key())
}

#[tauri::command]
pub async fn get_relay_server_url() -> Result<String, String> {
    Ok(read_relay_url())
}

/// Check if snapshots should be shown
#[tauri::command]
pub async fn should_show_snapshots() -> Result<bool, String> {
    Ok(get_bool_setting("show_snapshots", false))
}

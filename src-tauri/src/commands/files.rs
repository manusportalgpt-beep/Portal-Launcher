use serde::{Serialize, Deserialize};
use std::path::PathBuf;
use tauri::{AppHandle, Manager, WebviewUrl, WebviewWindowBuilder};

fn launcher_base_dir() -> PathBuf {
    dirs_next::data_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join("PortalLauncher")
}

/// Open the PortalLauncher folder in the system file explorer
#[tauri::command]
pub async fn open_minecraft_folder() -> Result<(), String> {
    let mc_dir = launcher_base_dir();
    std::fs::create_dir_all(&mc_dir).ok();
    
    #[cfg(target_os = "windows")]
    crate::utils::create_hidden_command("explorer").arg(&mc_dir).spawn().map_err(|e| e.to_string())?;
    #[cfg(target_os = "macos")]
    crate::utils::create_hidden_command("open").arg(&mc_dir).spawn().map_err(|e| e.to_string())?;
    #[cfg(target_os = "linux")]
    crate::utils::create_hidden_command("xdg-open").arg(&mc_dir).spawn().map_err(|e| e.to_string())?;
    Ok(())
}

/// Get the path to the PortalLauncher folder
#[tauri::command]
pub async fn get_minecraft_folder_path() -> Result<String, String> {
    let mc_dir = launcher_base_dir();
    std::fs::create_dir_all(&mc_dir).ok();
    Ok(mc_dir.to_string_lossy().to_string())
}

#[tauri::command]
pub async fn open_folder(path: String) -> Result<(), String> {
    if path.is_empty() { return Err("Empty path".into()); }
    let p = std::path::Path::new(&path);
    if !p.exists() { std::fs::create_dir_all(p).map_err(|e| e.to_string())?; }

    #[cfg(target_os = "windows")]
    crate::utils::create_hidden_command("explorer").arg(&path).spawn().map_err(|e| e.to_string())?;
    #[cfg(target_os = "macos")]
    crate::utils::create_hidden_command("open").arg(&path).spawn().map_err(|e| e.to_string())?;
    #[cfg(target_os = "linux")]
    crate::utils::create_hidden_command("xdg-open").arg(&path).spawn().map_err(|e| e.to_string())?;
    Ok(())
}

#[derive(Serialize, Deserialize, Debug)]
pub struct FileFilter { pub name: String, pub extensions: Vec<String> }

#[tauri::command]
pub async fn pick_file(_filters: Option<Vec<FileFilter>>) -> Result<Option<String>, String> {
    // File picking is handled by Tauri's dialog plugin on the frontend.
    // This stub exists for completeness; the actual call goes through
    // @tauri-apps/plugin-dialog on the JS side.
    Ok(None)
}

#[tauri::command]
pub async fn read_file_bytes(path: String) -> Result<Vec<u8>, String> {
    std::fs::read(&path).map_err(|e| format!("Read error: {e}"))
}

#[tauri::command]
pub async fn write_file_bytes(path: String, data: Vec<u8>) -> Result<(), String> {
    if let Some(parent) = std::path::Path::new(&path).parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    std::fs::write(&path, &data).map_err(|e| format!("Write error: {e}"))
}

/// Open the live Modrinth server catalog inside a Tauri WebView window.
#[tauri::command]
pub fn open_modrinth_servers_webview(app: AppHandle) -> Result<(), String> {
    const URL: &str = "https://modrinth.com/discover/servers?sst=online";
    if let Some(window) = app.get_webview_window("modrinth-servers") {
        window.show().map_err(|e| e.to_string())?;
        window.set_focus().map_err(|e| e.to_string())?;
        return Ok(());
    }
    let webview_url = WebviewUrl::External(URL.parse().map_err(|e| format!("Invalid Modrinth URL: {e}"))?);
    WebviewWindowBuilder::new(&app, "modrinth-servers", webview_url)
        .title("Modrinth Servers · Portal Launcher")
        .inner_size(1240.0, 820.0)
        .min_inner_size(860.0, 600.0)
        .resizable(true)
        .build()
        .map(|_| ())
        .map_err(|e| format!("Failed to open Modrinth WebView: {e}"))
}

/// Open a URL in the system default browser
#[tauri::command]
pub async fn open_url(url: String) -> Result<(), String> {
    webbrowser::open(&url).map_err(|e| format!("Failed to open URL: {}", e))
}

/// Open a local file with the operating system's default application.
#[tauri::command]
pub async fn open_file_path(path: String) -> Result<(), String> {
    if path.trim().is_empty() { return Err("Empty file path".into()); }
    let file = std::path::Path::new(&path);
    if !file.exists() { return Err(format!("File not found: {}", file.display())); }
    #[cfg(target_os = "windows")]
    crate::utils::create_hidden_command("explorer").arg(&path).spawn().map_err(|e| e.to_string())?;
    #[cfg(target_os = "macos")]
    crate::utils::create_hidden_command("open").arg(&path).spawn().map_err(|e| e.to_string())?;
    #[cfg(target_os = "linux")]
    crate::utils::create_hidden_command("xdg-open").arg(&path).spawn().map_err(|e| e.to_string())?;
    Ok(())
}

/// Reveal a local file in the system file explorer.
#[tauri::command]
pub async fn reveal_file_path(path: String) -> Result<(), String> {
    if path.trim().is_empty() { return Err("Empty file path".into()); }
    let file = std::path::Path::new(&path);
    if !file.exists() { return Err(format!("File not found: {}", file.display())); }
    #[cfg(target_os = "windows")]
    crate::utils::create_hidden_command("explorer").args(["/select,", &path]).spawn().map_err(|e| e.to_string())?;
    #[cfg(target_os = "macos")]
    crate::utils::create_hidden_command("open").args(["-R", &path]).spawn().map_err(|e| e.to_string())?;
    #[cfg(target_os = "linux")]
    crate::utils::create_hidden_command("xdg-open").arg(file.parent().unwrap_or(file)).spawn().map_err(|e| e.to_string())?;
    Ok(())
}

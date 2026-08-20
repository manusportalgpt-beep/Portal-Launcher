use serde::{Serialize, Deserialize};
use std::path::PathBuf;
use tauri::{AppHandle, Manager, WebviewUrl, WebviewWindowBuilder};

fn player_face_assets_dir() -> PathBuf {
    let path = launcher_base_dir().join("assets").join("player-faces");
    std::fs::create_dir_all(&path).ok();
    path
}

#[tauri::command]
pub async fn cache_player_face(account_key: String, source_url: String) -> Result<String, String> {
    if !source_url.starts_with("https://") && !source_url.starts_with("http://") { return Err("Источник лица должен быть сетевым изображением".to_string()); }
    let safe_key: String = account_key.chars().filter(|ch| ch.is_ascii_alphanumeric() || matches!(ch, '-' | '_')).collect();
    if safe_key.is_empty() { return Err("Некорректный идентификатор аккаунта".to_string()); }
    let client = reqwest::Client::builder().timeout(std::time::Duration::from_secs(12)).build().map_err(|e| e.to_string())?;
    let response = client.get(&source_url).send().await.map_err(|e| format!("Не удалось скачать лицо игрока: {e}"))?.error_for_status().map_err(|e| format!("Сервер лица игрока вернул ошибку: {e}"))?;
    let content_type = response.headers().get(reqwest::header::CONTENT_TYPE).and_then(|value| value.to_str().ok()).unwrap_or("").to_string();
    if !content_type.starts_with("image/") { return Err("Сервер вернул не изображение лица".to_string()); }
    let bytes = response.bytes().await.map_err(|e| format!("Не удалось прочитать лицо игрока: {e}"))?;
    if bytes.is_empty() || bytes.len() > 2_000_000 { return Err("Размер изображения лица некорректен".to_string()); }
    let extension = if content_type.contains("jpeg") || content_type.contains("jpg") { "jpg" } else { "png" };
    let target = player_face_assets_dir().join(format!("{safe_key}.{extension}"));
    std::fs::write(&target, bytes).map_err(|e| format!("Не удалось сохранить лицо игрока: {e}"))?;
    Ok(target.to_string_lossy().to_string())
}

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
pub fn pick_local_modpack() -> Result<Option<String>, String> {
    let selected = rfd::FileDialog::new()
        .set_title("Выберите сборку Minecraft")
        .add_filter("Сборки Minecraft", &["mrpack", "zip"])
        .pick_file();
    Ok(selected.map(|path| path.to_string_lossy().to_string()))
}

#[tauri::command]
pub fn pick_local_files() -> Result<Vec<String>, String> {
    let selected = rfd::FileDialog::new()
        .set_title("Добавить файлы в сборку")
        .pick_files()
        .unwrap_or_default();
    Ok(selected.into_iter().map(|path| path.to_string_lossy().to_string()).collect())
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

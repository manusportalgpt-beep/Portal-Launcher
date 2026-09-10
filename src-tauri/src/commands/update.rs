use serde::Serialize;
use std::path::PathBuf;
use tauri::Emitter;

const REPO_OWNER: &str = "manusportalgpt-beep";
const REPO_NAME: &str = "Portal-Launcher";
const CURRENT_VERSION: &str = env!("CARGO_PKG_VERSION");

fn updates_dir() -> PathBuf {
    let base = dirs_next::data_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join("PortalLauncher");
    let dir = base.join("updates");
    std::fs::create_dir_all(&dir).ok();
    dir
}

fn parse_version(v: &str) -> Vec<u32> {
    v.trim_start_matches('v')
        .split('.')
        .filter_map(|s| s.parse().ok())
        .collect()
}

fn is_newer(remote: &str, local: &str) -> bool {
    let rv = parse_version(remote);
    let lv = parse_version(local);
    for i in 0..rv.len().max(lv.len()) {
        let r = rv.get(i).copied().unwrap_or(0);
        let l = lv.get(i).copied().unwrap_or(0);
        if r > l { return true; }
        if r < l { return false; }
    }
    false
}

#[derive(Serialize, Clone)]
pub struct UpdateInfo {
    pub version: String,
    pub body: String,
    pub published_at: String,
    pub html_url: String,
    pub download_url: String,
    pub file_name: String,
}

#[tauri::command]
pub async fn check_for_update() -> Result<Option<UpdateInfo>, String> {
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(15))
        .build()
        .map_err(|e| e.to_string())?;

    let res = client
        .get(format!(
            "https://api.github.com/repos/{}/{}/releases/latest",
            REPO_OWNER, REPO_NAME
        ))
        .header("Accept", "application/vnd.github.v3+json")
        .send()
        .await
        .map_err(|e| format!("Network error: {e}"))?;

    if !res.status().is_success() {
        return Err(format!("GitHub API returned {}", res.status()));
    }

    let data: serde_json::Value = res.json().await.map_err(|e| e.to_string())?;

    let tag = data["tag_name"]
        .as_str()
        .unwrap_or("")
        .trim_start_matches('v')
        .to_string();
    if tag.is_empty() {
        return Err("No tag_name in release".into());
    }

    if !is_newer(&tag, CURRENT_VERSION) {
        return Ok(None);
    }

    let body = data["body"].as_str().unwrap_or("").to_string();
    let published_at = data["published_at"].as_str().unwrap_or("").to_string();
    let html_url = data["html_url"].as_str().unwrap_or("").to_string();

    // Find the .exe asset
    let assets = data["assets"].as_array().cloned().unwrap_or_default();
    let exe_asset = assets.iter().find(|a| {
        a["name"]
            .as_str()
            .map(|n| n.ends_with(".exe"))
            .unwrap_or(false)
    });

    let (download_url, file_name) = match exe_asset {
        Some(a) => (
            a["browser_download_url"]
                .as_str()
                .unwrap_or("")
                .to_string(),
            a["name"].as_str().unwrap_or("update.exe").to_string(),
        ),
        None => {
            // Fallback: construct a download URL for a standard NSIS name
            (
                format!(
                    "https://github.com/{}/{}/releases/download/v{}/Portal-Launcher-{}.exe",
                    REPO_OWNER, REPO_NAME, tag, tag
                ),
                format!("Portal-Launcher-{}.exe", tag),
            )
        }
    };

    if download_url.is_empty() {
        return Err("No download URL found in release assets".into());
    }

    Ok(Some(UpdateInfo {
        version: tag,
        body,
        published_at,
        html_url,
        download_url,
        file_name,
    }))
}

#[derive(Clone, Serialize)]
pub struct DownloadProgress {
    pub percent: u8,
    pub downloaded: u64,
    pub total: u64,
}

#[tauri::command]
pub async fn download_update(
    app: tauri::AppHandle,
    download_url: String,
    file_name: String,
) -> Result<String, String> {
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(300))
        .build()
        .map_err(|e| e.to_string())?;

    let res = client
        .get(&download_url)
        .header("User-Agent", format!("Portal-Launcher/{}", CURRENT_VERSION))
        .send()
        .await
        .map_err(|e| format!("Download start failed: {e}"))?;

    if !res.status().is_success() {
        return Err(format!("Download failed: HTTP {}", res.status()));
    }

    let total = res.content_length().unwrap_or(0);
    let target = updates_dir().join(&file_name);

    let mut stream = res.bytes_stream();
    let mut downloaded: u64 = 0;
    let mut file_bytes = Vec::new();

    use futures::StreamExt;
    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|e| format!("Download stream error: {e}"))?;
        downloaded += chunk.len() as u64;
        file_bytes.extend_from_slice(&chunk);

        let percent = if total > 0 {
            ((downloaded as f64 / total as f64) * 100.0) as u8
        } else {
            0
        };

        app.emit(
            "update-download-progress",
            DownloadProgress {
                percent,
                downloaded,
                total,
            },
        )
        .ok();
    }

    std::fs::write(&target, &file_bytes)
        .map_err(|e| format!("Failed to write update file: {e}"))?;

    Ok(target.to_string_lossy().to_string())
}

#[tauri::command]
pub async fn install_update(file_path: String) -> Result<(), String> {
    let p = std::path::Path::new(&file_path);
    if !p.exists() {
        return Err(format!("Update file not found: {}", p.display()));
    }

    #[cfg(target_os = "windows")]
    {
        std::process::Command::new("cmd")
            .args(["/C", "start", "", &file_path])
            .spawn()
            .map_err(|e| format!("Failed to launch installer: {e}"))?;
        // Exit the current process after a short delay
        std::thread::spawn(|| {
            std::thread::sleep(std::time::Duration::from_secs(2));
            std::process::exit(0);
        });
    }

    #[cfg(not(target_os = "windows"))]
    {
        crate::utils::create_hidden_command("xdg-open")
            .arg(&file_path)
            .spawn()
            .map_err(|e| format!("Failed to launch installer: {e}"))?;
    }

    Ok(())
}

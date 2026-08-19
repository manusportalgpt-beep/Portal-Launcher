use serde::{Serialize, Deserialize};
use std::path::PathBuf;

#[derive(Serialize, Deserialize, Debug)]
pub struct VoiceUploadResult {
    pub url: String,
    pub duration_ms: u64,
}

fn get_voice_dir() -> PathBuf {
    let mut p = dirs_next::data_local_dir().unwrap_or_else(|| PathBuf::from("."));
    p.push("PortalLauncher");
    p.push("voice");
    std::fs::create_dir_all(&p).ok();
    p
}

/// Save a recorded voice message (PCM/OGG bytes) to local storage.
/// Returns a local file URL usable by the frontend audio player.
#[tauri::command]
pub async fn start_voice_message_upload(
    audio_data: Vec<u8>,
    from_uuid: String,
) -> Result<VoiceUploadResult, String> {
    let filename = format!("{}-{}.ogg", from_uuid, uuid::Uuid::new_v4());
    let mut path = get_voice_dir();
    path.push(&filename);

    std::fs::write(&path, &audio_data)
        .map_err(|e| format!("Write error: {e}"))?;

    // Estimate duration: OGG Opus at 48kHz 64kbps ≈ 8000 bytes/sec
    let duration_ms = (audio_data.len() as u64 * 1000) / 8000;

    let url = format!("asset://localhost/{}", path.to_string_lossy());
    Ok(VoiceUploadResult { url, duration_ms })
}

/// List all stored voice messages for a user (for cleanup/management)
#[tauri::command]
pub async fn list_voice_messages(from_uuid: String) -> Result<Vec<String>, String> {
    let dir = get_voice_dir();
    let mut files: Vec<String> = vec![];
    if let Ok(entries) = std::fs::read_dir(&dir) {
        for entry in entries.flatten() {
            let name = entry.file_name().to_string_lossy().to_string();
            if name.starts_with(&from_uuid) {
                files.push(format!("asset://localhost/{}", entry.path().to_string_lossy()));
            }
        }
    }
    Ok(files)
}

/// Delete a voice message file
#[tauri::command]
pub async fn delete_voice_message(url: String) -> Result<(), String> {
    // Extract path from asset URL
    let path = url.replace("asset://localhost/", "");
    std::fs::remove_file(&path)
        .map_err(|e| format!("Delete error: {e}"))?;
    Ok(())
}

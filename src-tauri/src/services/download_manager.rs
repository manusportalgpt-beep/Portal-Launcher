use reqwest::Client;
use tauri::AppHandle;
use tokio::{fs::File, io::AsyncWriteExt};
use std::path::Path;
use bytes::Bytes;

/// Скачивает файл по URL в dest_path, эмитит события прогресса в окно "main".
/// Возвращает Ok(()) или Err(String).
pub async fn download_with_progress(
  client: &Client,
  url: &str,
  dest_path: &Path,
  app: AppHandle,
  id: String,
) -> Result<(), String> {
  // Создаём временный файл рядом
  let tmp_path = dest_path.with_extension("part");
  let window = app.get_window("main").ok_or_else(|| "no main window".to_string())?;

  // Создаём request
  let resp = client
    .get(url)
    .send()
    .await
    .map_err(|e| format!("request failed: {}", e))?;

  if !resp.status().is_success() {
    return Err(format!("download failed: HTTP {}", resp.status()));
  }

  let total = resp
    .content_length()
    .unwrap_or(0);

  // Создаём директорию, если нужно
  if let Some(parent) = dest_path.parent() {
    if let Err(e) = tokio::fs::create_dir_all(parent).await {
      return Err(format!("failed create parent dir: {}", e));
    }
  }

  // Открываем временный файл
  let mut file = File::create(&tmp_path).await.map_err(|e| format!("failed create tmp file: {}", e))?;

  let mut stream = resp.bytes_stream();
  let mut downloaded: u64 = 0;
  let mut last_emit = std::time::Instant::now();

  while let Some(item) = stream.next().await {
    match item {
      Ok(chunk) => {
        // Записываем
        if let Err(e) = file.write_all(&chunk).await {
          let _ = std::fs::remove_file(&tmp_path);
          return Err(format!("write failed: {}", e));
        }
        downloaded = downloaded.saturating_add(chunk.len() as u64);

        // Эмитим прогресс не слишком часто
        if last_emit.elapsed().as_millis() > 150 {
          let payload = serde_json::json!({
            "id": id,
            "downloaded": downloaded,
            "total": total,
            "message": format!("Загружено {} bytes", downloaded)
          });
          let _ = window.emit("download-progress", payload);
          last_emit = std::time::Instant::now();
        }
      }
      Err(e) => {
        let _ = std::fs::remove_file(&tmp_path);
        return Err(format!("stream chunk error: {}", e));
      }
    }
  }

  // Флашим и закрываем файл
  if let Err(e) = file.flush().await {
    let _ = std::fs::remove_file(&tmp_path);
    return Err(format!("flush failed: {}", e));
  }
  drop(file);

  // Переименовываем временный файл в финальный
  if let Err(e) = tokio::fs::rename(&tmp_path, dest_path).await {
    // попытка синхронного переименования как fallback
    if let Err(e2) = std::fs::rename(&tmp_path, dest_path) {
      let _ = std::fs::remove_file(&tmp_path);
      return Err(format!("rename failed: {} / {}", e, e2));
    }
  }

  // Финальный эмит
  let complete = serde_json::json!({ "id": id, "dest": dest_path.to_string_lossy().to_string() });
  let _ = window.emit("download-complete", complete);

  Ok(())
}

use serde::{Serialize, Deserialize};
use std::path::PathBuf;

/// Cached CDN entry for Modrinth/CurseForge assets
#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct CdnCacheEntry {
    pub url: String,
    pub local_path: String,
    pub etag: Option<String>,
    pub last_modified: Option<String>,
    pub cached_at: u64,
    pub expires_at: u64,
}

/// Feed item (news, updates, activity)
#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct FeedItem {
    pub id: String,
    pub title: String,
    pub content: String,
    pub image_url: Option<String>,
    pub source: String, // "modrinth", "curseforge", "launcher"
    pub created_at: u64,
    pub read: bool,
}

/// Cache a CDN file (Modrinth/CurseForge icon, thumbnail, etc.)
#[tauri::command]
pub async fn cache_cdn_file(
    provider: String, // "modrinth" or "curseforge"
    url: String,
    data: Vec<u8>,
    etag: Option<String>,
    last_modified: Option<String>,
) -> Result<String, String> {
    let cache_dir = if provider.to_lowercase() == "modrinth" {
        crate::commands::version_manager::meta_cdn_modrinth_dir()
    } else {
        crate::commands::version_manager::meta_cdn_curseforge_dir()
    };
    
    // Generate deterministic filename from URL hash
    use sha1::{Sha1, Digest};
    let hash = format!("{:x}", Sha1::digest(url.as_bytes()));
    let ext = url.split('.').last().unwrap_or("bin");
    let filename = format!("{}.{:8}.{}", hash, &hash[..8], ext);
    let file_path = cache_dir.join(&filename);
    
    // Write file
    std::fs::write(&file_path, &data).map_err(|e| format!("Failed to write cache: {e}"))?;
    
    // Save metadata
    let now = chrono::Utc::now().timestamp() as u64;
    let entry = CdnCacheEntry {
        url,
        local_path: file_path.to_string_lossy().to_string(),
        etag,
        last_modified,
        cached_at: now,
        expires_at: now + 7 * 24 * 3600, // 7 days
    };
    
    let meta_path = cache_dir.join(format!("{}.meta.json", hash));
    std::fs::write(&meta_path, serde_json::to_string_pretty(&entry).map_err(|e| e.to_string())?)
        .map_err(|e| format!("Failed to write metadata: {e}"))?;
    
    Ok(file_path.to_string_lossy().to_string())
}

/// Get cached CDN file path
#[tauri::command]
pub async fn get_cached_cdn_file(provider: String, url: String) -> Result<Option<String>, String> {
    let cache_dir = if provider.to_lowercase() == "modrinth" {
        crate::commands::version_manager::meta_cdn_modrinth_dir()
    } else {
        crate::commands::version_manager::meta_cdn_curseforge_dir()
    };
    
    use sha1::{Sha1, Digest};
    let hash = format!("{:x}", Sha1::digest(url.as_bytes()));
    let meta_path = cache_dir.join(format!("{}.meta.json", hash));
    
    if !meta_path.exists() {
        return Ok(None);
    }
    
    let data = std::fs::read_to_string(&meta_path).map_err(|e| e.to_string())?;
    let entry: CdnCacheEntry = serde_json::from_str(&data).map_err(|e| e.to_string())?;
    
    let now = chrono::Utc::now().timestamp() as u64;
    if now > entry.expires_at {
        // Expired, remove
        std::fs::remove_file(&meta_path).ok();
        std::fs::remove_file(&entry.local_path).ok();
        return Ok(None);
    }
    
    Ok(Some(entry.local_path))
}

/// Add item to feed
#[tauri::command]
pub async fn add_feed_item(
    title: String,
    content: String,
    image_url: Option<String>,
    source: String,
) -> Result<String, String> {
    let feed_dir = crate::commands::version_manager::meta_feed_dir();
    let now = chrono::Utc::now().timestamp() as u64;
    let id = format!("feed_{now}");
    
    let item = FeedItem {
        id: id.clone(),
        title,
        content,
        image_url,
        source,
        created_at: now,
        read: false,
    };
    
    let file_path = feed_dir.join(format!("{}.json", id));
    std::fs::write(&file_path, serde_json::to_string_pretty(&item).map_err(|e| e.to_string())?)
        .map_err(|e| format!("Failed to write feed item: {e}"))?;
    
    Ok(id)
}

/// Get all feed items (newest first)
#[tauri::command]
pub async fn get_feed_items() -> Result<Vec<FeedItem>, String> {
    let feed_dir = crate::commands::version_manager::meta_feed_dir();
    
    if !feed_dir.exists() {
        return Ok(vec![]);
    }
    
    let mut items = vec![];
    for entry in std::fs::read_dir(&feed_dir).map_err(|e| e.to_string())? {
        let entry = entry.map_err(|e| e.to_string())?;
        let path = entry.path();
        if path.extension().and_then(|e| e.to_str()) == Some("json") {
            let data = std::fs::read_to_string(&path).map_err(|e| e.to_string())?;
            if let Ok(item) = serde_json::from_str::<FeedItem>(&data) {
                items.push(item);
            }
        }
    }
    
    // Sort by created_at descending
    items.sort_by(|a, b| b.created_at.cmp(&a.created_at));
    Ok(items)
}

/// Mark feed item as read
#[tauri::command]
pub async fn mark_feed_item_read(item_id: String) -> Result<(), String> {
    let feed_dir = crate::commands::version_manager::meta_feed_dir();
    let file_path = feed_dir.join(format!("{item_id}.json"));
    
    if !file_path.exists() {
        return Err("Feed item not found".to_string());
    }
    
    let data = std::fs::read_to_string(&file_path).map_err(|e| e.to_string())?;
    let mut item: FeedItem = serde_json::from_str(&data).map_err(|e| e.to_string())?;
    item.read = true;
    
    std::fs::write(&file_path, serde_json::to_string_pretty(&item).map_err(|e| e.to_string())?)
        .map_err(|e| format!("Failed to update feed item: {e}"))?;
    
    Ok(())
}

/// Clean expired CDN cache entries
#[tauri::command]
pub async fn clean_cdn_cache(provider: Option<String>) -> Result<u64, String> {
    let cache_dirs: Vec<PathBuf> = match provider.as_deref() {
        Some("modrinth") => vec![crate::commands::version_manager::meta_cdn_modrinth_dir()],
        Some("curseforge") => vec![crate::commands::version_manager::meta_cdn_curseforge_dir()],
        _ => vec![
            crate::commands::version_manager::meta_cdn_modrinth_dir(),
            crate::commands::version_manager::meta_cdn_curseforge_dir(),
        ],
    };
    
    let now = chrono::Utc::now().timestamp() as u64;
    let mut cleaned = 0u64;
    
    for cache_dir in cache_dirs {
        if !cache_dir.exists() {
            continue;
        }
        
        for entry in std::fs::read_dir(&cache_dir).map_err(|e| e.to_string())? {
            let entry = entry.map_err(|e| e.to_string())?;
            let path = entry.path();
            
            // Check .meta.json files
            if path.extension().and_then(|e| e.to_str()) == Some("meta.json") {
                let data = std::fs::read_to_string(&path).map_err(|e| e.to_string())?;
                if let Ok(entry_data) = serde_json::from_str::<CdnCacheEntry>(&data) {
                    if now > entry_data.expires_at {
                        // Remove cache file and metadata
                        std::fs::remove_file(&entry_data.local_path).ok();
                        std::fs::remove_file(&path).ok();
                        cleaned += 1;
                    }
                }
            }
        }
    }
    
    Ok(cleaned)
}

/// Get cache statistics
#[tauri::command]
pub async fn get_cache_stats() -> Result<serde_json::Value, String> {
    let dirs = [
        ("cdn_modrinth", crate::commands::version_manager::meta_cdn_modrinth_dir()),
        ("cdn_curseforge", crate::commands::version_manager::meta_cdn_curseforge_dir()),
        ("modrinth_packs", crate::commands::version_manager::meta_modrinth_packs_dir()),
        ("modrinth_modpacks", crate::commands::version_manager::meta_modrinth_modpacks_dir()),
        ("feed", crate::commands::version_manager::meta_feed_dir()),
    ];
    
    let mut stats = serde_json::Map::new();
    
    for (name, dir) in dirs {
        if !dir.exists() {
            stats.insert(name.to_string(), serde_json::json!({"files": 0, "size_bytes": 0}));
            continue;
        }
        
        let mut file_count = 0u64;
        let mut total_size = 0u64;
        
        for entry in std::fs::read_dir(&dir).map_err(|e| e.to_string())? {
            let entry = entry.map_err(|e| e.to_string())?;
            let metadata = entry.metadata().map_err(|e| e.to_string())?;
            if metadata.is_file() {
                file_count += 1;
                total_size += metadata.len();
            }
        }
        
        stats.insert(name.to_string(), serde_json::json!({
            "files": file_count,
            "size_bytes": total_size,
            "size_mb": total_size as f64 / 1_000_000.0,
        }));
    }
    
    Ok(serde_json::Value::Object(stats))
}

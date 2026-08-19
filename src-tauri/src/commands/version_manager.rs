use serde::{Serialize, Deserialize};
use std::path::PathBuf;
use sha1::{Sha1, Digest};
use tauri::Emitter;

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct McVersion {
    pub id: String,
    pub version_type: String,
    pub release_time: String,
    pub url: String,
    pub sha1: String,
    pub installed: bool,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ProgressEvent {
    pub stage: String,
    pub current: u64,
    pub total: u64,
    pub message: String,
    pub percent: u8,
}

pub fn mc_base_dir() -> PathBuf {
    let mut p = dirs_next::data_dir().unwrap_or_else(|| PathBuf::from("."));
    p.push("PortalLauncher");
    std::fs::create_dir_all(&p).ok();
    p
}

pub fn versions_dir() -> PathBuf {
    let p = mc_base_dir().join("versions");
    std::fs::create_dir_all(&p).ok();
    std::fs::create_dir_all(p.join("meta")).ok();
    std::fs::create_dir_all(p.join("cache")).ok();
    p
}

pub fn libraries_dir() -> PathBuf {
    let p = mc_base_dir().join("libraries");
    std::fs::create_dir_all(&p).ok();
    std::fs::create_dir_all(p.join("meta")).ok();
    std::fs::create_dir_all(p.join("cache")).ok();
    p
}

pub fn assets_dir() -> PathBuf {
    let p = mc_base_dir().join("assets");
    std::fs::create_dir_all(&p).ok();
    std::fs::create_dir_all(p.join("indexes")).ok();
    std::fs::create_dir_all(p.join("objects")).ok();
    std::fs::create_dir_all(p.join("meta")).ok();
    std::fs::create_dir_all(p.join("cache")).ok();
    p
}

pub fn assets_meta_dir() -> PathBuf {
    let p = assets_dir().join("meta");
    std::fs::create_dir_all(&p).ok(); p
}

pub fn assets_cache_dir() -> PathBuf {
    let p = assets_dir().join("cache");
    std::fs::create_dir_all(&p).ok(); p
}

pub fn versions_meta_dir() -> PathBuf {
    let p = versions_dir().join("meta");
    std::fs::create_dir_all(&p).ok(); p
}

pub fn versions_cache_dir() -> PathBuf {
    let p = versions_dir().join("cache");
    std::fs::create_dir_all(&p).ok(); p
}

pub fn libraries_meta_dir() -> PathBuf {
    let p = libraries_dir().join("meta");
    std::fs::create_dir_all(&p).ok(); p
}

pub fn libraries_cache_dir() -> PathBuf {
    let p = libraries_dir().join("cache");
    std::fs::create_dir_all(&p).ok(); p
}

/// Main meta directory for CDN caches, modpacks, and feed
pub fn meta_dir() -> PathBuf {
    let p = mc_base_dir().join("meta");
    std::fs::create_dir_all(&p).ok();
    p
}

/// CDN cache for Modrinth assets (icons, thumbnails, files)
pub fn meta_cdn_modrinth_dir() -> PathBuf {
    let p = meta_dir().join("cdn_modrinth");
    std::fs::create_dir_all(&p).ok();
    p
}

/// CDN cache for CurseForge assets (icons, thumbnails, files)
pub fn meta_cdn_curseforge_dir() -> PathBuf {
    let p = meta_dir().join("cdn_curseforge");
    std::fs::create_dir_all(&p).ok();
    p
}

/// Modrinth Packs (individual mods/plugins)
pub fn meta_modrinth_packs_dir() -> PathBuf {
    let p = meta_dir().join("ModrinthPacks");
    std::fs::create_dir_all(&p).ok();
    p
}

/// Modrinth Modpacks (complete modpacks with dependencies)
pub fn meta_modrinth_modpacks_dir() -> PathBuf {
    let p = meta_dir().join("ModrinthModpacks");
    std::fs::create_dir_all(&p).ok();
    p
}

/// Feed directory for news, updates, and activity log
pub fn meta_feed_dir() -> PathBuf {
    let p = meta_dir().join("feed");
    std::fs::create_dir_all(&p).ok();
    p
}

fn get_installed_version_ids() -> std::collections::HashSet<String> {
    let dir = versions_dir();
    let mut set = std::collections::HashSet::new();
    if let Ok(entries) = std::fs::read_dir(&dir) {
        for entry in entries.flatten() {
            if entry.file_type().map(|t| t.is_dir()).unwrap_or(false) {
                let id = entry.file_name().to_string_lossy().to_string();
                if entry.path().join(format!("{}.jar", id)).exists() { set.insert(id); }
            }
        }
    }
    set
}

pub fn get_os_name() -> &'static str {
    #[cfg(target_os = "windows")] { "windows" }
    #[cfg(target_os = "macos")]   { "osx" }
    #[cfg(all(not(target_os="windows"), not(target_os="macos")))] { "linux" }
}

fn get_os_classifier() -> &'static str {
    #[cfg(target_os = "windows")] { "natives-windows" }
    #[cfg(target_os = "macos")]   { "natives-macos" }
    #[cfg(all(not(target_os="windows"), not(target_os="macos")))] { "natives-linux" }
}

pub fn check_library_rules(lib: &serde_json::Value) -> bool {
    let rules = match lib["rules"].as_array() { Some(r) => r, None => return true };
    let os_name = get_os_name();
    let mut result = false;
    for rule in rules {
        let action = rule["action"].as_str().unwrap_or("allow");
        let os_match = if let Some(os_obj) = rule["os"].as_object() {
            os_obj.get("name").and_then(|n| n.as_str()) == Some(os_name)
        } else { true };
        if os_match { result = action == "allow"; }
    }
    result
}

async fn download_file_checked(client: &reqwest::Client, url: &str, path: &PathBuf, expected_sha1: Option<&str>) -> Result<bool, String> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| format!("mkdir: {e}"))?;
    }
    if path.exists() {
        if let Some(sha1) = expected_sha1 {
            if let Ok(data) = std::fs::read(path) {
                let mut hasher = Sha1::new();
                hasher.update(&data);
                if format!("{:x}", hasher.finalize()) == sha1 { return Ok(false); } // already ok
            }
        } else { return Ok(false); }
    }
    let bytes = client.get(url).send().await.map_err(|e| format!("GET {url}: {e}"))?.bytes().await.map_err(|e| format!("read: {e}"))?;
    std::fs::write(path, &bytes).map_err(|e| format!("write: {e}"))?;
    Ok(true)
}

#[tauri::command]
pub async fn get_available_versions(include_snapshots: Option<bool>) -> Result<Vec<McVersion>, String> {
    let client = reqwest::Client::builder().user_agent("PortalLauncher/1.3").build().map_err(|e| e.to_string())?;
    // Официальный манифест Mojang, при необходимости через выбранное зеркало (BMCLAPI и др.)
    const MANIFEST_URL: &str = "https://piston-meta.mojang.com/mc/game/version_manifest_v2.json";
    let mut manifest: Option<serde_json::Value> = None;
    let mut last_err = String::new();
    let mut urls = vec![crate::mc::mirrors::rewrite(MANIFEST_URL)];
    for fallback in [
        MANIFEST_URL,
        "https://launchermeta.mojang.com/mc/game/version_manifest_v2.json",
    ] {
        if !urls.iter().any(|u| u == fallback) {
            urls.push(fallback.to_string());
        }
    }
    for url in urls {
        match client.get(&url).send().await {
            Ok(r) => match r.json::<serde_json::Value>().await {
                Ok(v) if v["versions"].is_array() => {
                    manifest = Some(v);
                    break;
                }
                Ok(_) => last_err = format!("{url}: манифест без списка версий"),
                Err(e) => last_err = format!("{url}: разбор — {e}"),
            },
            Err(e) => last_err = format!("{url}: сеть — {e}"),
        }
    }
    let manifest = manifest.ok_or_else(|| format!("Не удалось получить список версий: {last_err}"))?;
    
    let snapshots = include_snapshots.unwrap_or(false);
    let installed = get_installed_version_ids();
    
    // Include ALL versions from official manifest
    // Types: release, snapshot, old_beta, old_alpha, experiment
    let versions: Vec<McVersion> = manifest["versions"].as_array().unwrap_or(&vec![]).iter()
        .filter(|v| { 
            let t = v["type"].as_str().unwrap_or(""); 
            // Always include releases and old versions
            if t == "release" || t == "old_beta" || t == "old_alpha" {
                return true;
            }
            // Include snapshots/experiments only if enabled
            if snapshots && (t == "snapshot" || t == "experiment") {
                return true;
            }
            false
        })
        .map(|v| McVersion {
            id: v["id"].as_str().unwrap_or("").to_string(),
            version_type: v["type"].as_str().unwrap_or("release").to_string(),
            release_time: v["releaseTime"].as_str().unwrap_or("").to_string(),
            url: v["url"].as_str().unwrap_or("").to_string(),
            sha1: v["sha1"].as_str().unwrap_or("").to_string(),
            installed: installed.contains(v["id"].as_str().unwrap_or("")),
        }).collect();
    
    // Sort by release time (newest first)
    let mut sorted = versions;
    sorted.sort_by(|a, b| b.release_time.cmp(&a.release_time));
    
    Ok(sorted)
}

/// Get versions filtered by snapshot setting
#[tauri::command]
pub async fn get_filtered_versions() -> Result<Vec<McVersion>, String> {
    let show_snapshots = super::settings::get_bool_setting("show_snapshots", false);
    get_available_versions(Some(show_snapshots)).await
}

#[tauri::command]
pub async fn get_installed_versions() -> Result<Vec<McVersion>, String> {
    let dir = versions_dir();
    let mut versions = vec![];
    if let Ok(entries) = std::fs::read_dir(&dir) {
        for entry in entries.flatten() {
            if entry.file_type().map(|t| t.is_dir()).unwrap_or(false) {
                let id = entry.file_name().to_string_lossy().to_string();
                let vtype = std::fs::read_to_string(entry.path().join(format!("{}.json", id))).ok()
                    .and_then(|d| serde_json::from_str::<serde_json::Value>(&d).ok())
                    .and_then(|v| v["type"].as_str().map(|s| s.to_string()))
                    .unwrap_or_else(|| "release".to_string());
                versions.push(McVersion { id, version_type: vtype, release_time: String::new(), url: String::new(), sha1: String::new(), installed: true });
            }
        }
    }
    Ok(versions)
}

#[tauri::command]
pub async fn download_minecraft_version(app: tauri::AppHandle, version_id: String) -> Result<(), String> {
    let emit = |stage: &str, current: u64, total: u64, msg: &str| {
        let pct = if total > 0 { ((current * 100) / total) as u8 } else { 0 };
        app.emit("download-progress", ProgressEvent {
            stage: stage.to_string(), current, total,
            message: msg.to_string(), percent: pct,
        }).ok();
    };

    emit("start", 0, 100, "Starting download...");

    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(300))
        .user_agent("PortalLauncher/1.1").build().map_err(|e| e.to_string())?;

    emit("manifest", 5, 100, "Fetching version manifest...");
    // Официальный манифест Mojang, при необходимости через выбранное зеркало (BMCLAPI и др.)
    const MANIFEST_URL: &str = "https://piston-meta.mojang.com/mc/game/version_manifest_v2.json";
    let mut manifest: Option<serde_json::Value> = None;
    let mut last_err = String::new();
    let mut urls = vec![crate::mc::mirrors::rewrite(MANIFEST_URL)];
    for fallback in [
        MANIFEST_URL,
        "https://launchermeta.mojang.com/mc/game/version_manifest_v2.json",
    ] {
        if !urls.iter().any(|u| u == fallback) {
            urls.push(fallback.to_string());
        }
    }
    for url in urls {
        match client.get(&url).send().await {
            Ok(r) => match r.json::<serde_json::Value>().await {
                Ok(v) if v["versions"].is_array() => {
                    manifest = Some(v);
                    break;
                }
                Ok(_) => last_err = format!("{url}: манифест без списка версий"),
                Err(e) => last_err = format!("{url}: разбор — {e}"),
            },
            Err(e) => last_err = format!("{url}: сеть — {e}"),
        }
    }
    let manifest = manifest.ok_or_else(|| format!("Не удалось получить список версий: {last_err}"))?;

    let version_url = manifest["versions"].as_array()
        .and_then(|a| a.iter().find(|v| v["id"].as_str() == Some(&version_id)))
        .and_then(|v| v["url"].as_str())
        .ok_or_else(|| format!("Version {} not found", version_id))?.to_string();

    emit("json", 10, 100, "Downloading version JSON...");
    let vj: serde_json::Value = client.get(&version_url).send().await.map_err(|e| e.to_string())?.json().await.map_err(|e| e.to_string())?;

    let vdir = versions_dir().join(&version_id);
    std::fs::create_dir_all(&vdir).map_err(|e| e.to_string())?;
    std::fs::write(vdir.join(format!("{}.json", version_id)), serde_json::to_string_pretty(&vj).map_err(|e| e.to_string())?).map_err(|e| e.to_string())?;

    emit("jar", 15, 100, "Downloading client jar...");
    let client_url = vj["downloads"]["client"]["url"].as_str().ok_or("No client URL")?;
    let client_sha1 = vj["downloads"]["client"]["sha1"].as_str();
    download_file_checked(&client, client_url, &vdir.join(format!("{}.jar", version_id)), client_sha1).await?;

    emit("libraries", 25, 100, "Downloading libraries...");
    if let Some(libs) = vj["libraries"].as_array() {
        let total_libs = libs.len() as u64;
        for (i, lib) in libs.iter().enumerate() {
            if !check_library_rules(lib) { continue; }
            if let Some(art) = lib["downloads"]["artifact"].as_object() {
                let url = art.get("url").and_then(|u| u.as_str()).unwrap_or("");
                let pth = art.get("path").and_then(|p| p.as_str()).unwrap_or("");
                let sha1 = art.get("sha1").and_then(|s| s.as_str());
                if !url.is_empty() && !pth.is_empty() {
                    download_file_checked(&client, url, &libraries_dir().join(pth), sha1).await.ok();
                }
            }
            let cls = get_os_classifier();
            if let Some(classifiers) = lib["downloads"]["classifiers"].as_object() {
                if let Some(nat) = classifiers.get(cls) {
                    let url = nat["url"].as_str().unwrap_or("");
                    let pth = nat["path"].as_str().unwrap_or("");
                    if !url.is_empty() && !pth.is_empty() {
                        download_file_checked(&client, url, &libraries_dir().join(pth), nat["sha1"].as_str()).await.ok();
                    }
                }
            }
            let pct = 25 + ((i as u64 * 30) / total_libs.max(1)) as u8;
            emit("libraries", pct as u64, 100, &format!("Libraries {}/{}", i+1, total_libs));
        }
    }

    emit("assets-index", 55, 100, "Downloading asset index...");
    let ai_id = vj["assetIndex"]["id"].as_str().or_else(|| vj["assets"].as_str()).unwrap_or(&version_id).to_string();
    let ai_url = vj["assetIndex"]["url"].as_str().unwrap_or("");
    if !ai_url.is_empty() {
        let idx_dir = assets_dir().join("indexes");
        std::fs::create_dir_all(&idx_dir).ok();
        let idx_path = idx_dir.join(format!("{}.json", ai_id));
        download_file_checked(&client, ai_url, &idx_path, vj["assetIndex"]["sha1"].as_str()).await?;

        if let Ok(idx_data) = std::fs::read_to_string(&idx_path) {
            if let Ok(idx) = serde_json::from_str::<serde_json::Value>(&idx_data) {
                if let Some(objects) = idx["objects"].as_object() {
                    let obj_dir = assets_dir().join("objects");
                    std::fs::create_dir_all(&obj_dir).ok();
                    let tasks: Vec<_> = objects.values().filter_map(|obj| {
                        let hash = obj["hash"].as_str()?.to_string();
                        if hash.len() < 2 { return None; }
                        let pfx = hash[..2].to_string();
                        Some((format!("https://resources.download.minecraft.net/{}/{}", pfx, hash), obj_dir.join(&pfx).join(&hash), hash))
                    }).collect();
                    let total_assets = tasks.len() as u64;
                    emit("assets", 60, 100, &format!("Downloading {} assets...", total_assets));
                    for (chunk_i, chunk) in tasks.chunks(30).enumerate() {
                        let futs: Vec<_> = chunk.iter().map(|(url, path, sha1)| {
                            let (c, u, p, s) = (client.clone(), url.clone(), path.clone(), sha1.clone());
                            async move { download_file_checked(&c, &u, &p, Some(&s)).await.ok(); }
                        }).collect();
                        futures::future::join_all(futs).await;
                        let pct = 60 + ((chunk_i as u64 * 35) / ((tasks.len() / 30 + 1) as u64).max(1)) as u8;
                        emit("assets", pct as u64, 100, &format!("Assets {}/{}...", (chunk_i+1)*30, total_assets));
                    }
                }
            }
        }
    }

    emit("done", 100, 100, &format!("Minecraft {} ready!", version_id));
    Ok(())
}

pub fn build_classpath(version_id: &str) -> Result<String, String> {
    let vdir = versions_dir().join(version_id);
    let data = std::fs::read_to_string(vdir.join(format!("{}.json", version_id)))
        .map_err(|_| format!("Version {} not downloaded. Download it first.", version_id))?;
    let vj: serde_json::Value = serde_json::from_str(&data).map_err(|e| e.to_string())?;
    let mut entries: Vec<String> = vec![];
    
    // Always add the main client jar FIRST (critical for Minecraft to launch)
    let jar = vdir.join(format!("{}.jar", version_id));
    if jar.exists() {
        log::info!("📦 Adding client jar to classpath: {:?}", jar);
        entries.push(jar.to_string_lossy().to_string());
    } else {
        log::warn!("⚠️ Client jar not found at: {:?}", jar);
    }
    
    // Then add libraries
    if let Some(libs) = vj["libraries"].as_array() {
        log::info!("📚 Processing {} libraries...", libs.len());
        let mut added_libs = 0;
        
        for lib in libs {
            if !check_library_rules(lib) { 
                log::debug!("⏭️ Skipping library (rules): {}", lib["name"].as_str().unwrap_or("unknown"));
                continue; 
            }
            
            // Try artifact first
            if let Some(art) = lib["downloads"]["artifact"].as_object() {
                let pth = art.get("path").and_then(|p| p.as_str()).unwrap_or("");
                let name = art.get("filename").and_then(|f| f.as_str()).unwrap_or(pth.split('/').last().unwrap_or(""));
                if !pth.is_empty() {
                    let lp = libraries_dir().join(pth);
                    if lp.exists() {
                        entries.push(lp.to_string_lossy().to_string());
                        added_libs += 1;
                        log::debug!("✅ Added library: {}", name);
                    } else {
                        log::warn!("⚠️ Library not found: {} (path: {:?})", name, lp);
                    }
                }
            }
            // Also check classifiers for natives
            else if let Some(classifiers) = lib["downloads"]["classifiers"].as_object() {
                let cls = get_os_classifier();
                if let Some(nat) = classifiers.get(cls) {
                    let pth = nat["path"].as_str().unwrap_or("");
                    if !pth.is_empty() {
                        let lp = libraries_dir().join(pth);
                        if lp.exists() {
                            entries.push(lp.to_string_lossy().to_string());
                            added_libs += 1;
                        }
                    }
                }
            }
        }
        log::info!("✅ Added {} libraries to classpath", added_libs);
    }
    
    // Ensure we have at least the client jar
    if entries.is_empty() {
        log::error!("❌ Classpath is EMPTY - will cause crash!");
        return Err(format!("Classpath empty for version {}. Version files may be corrupted. Try re-downloading.", version_id));
    }
    
    log::info!("📊 Total classpath entries: {}", entries.len());
    log::info!("📊 Classpath length: {} bytes", entries.len());
    
    let sep = if cfg!(windows) { ";" } else { ":" };
    let result = entries.join(sep);
    Ok(result)
}

pub fn get_version_meta(version_id: &str) -> Result<(String, String, Vec<String>), String> {
    let data = std::fs::read_to_string(versions_dir().join(version_id).join(format!("{}.json", version_id)))
        .map_err(|_| format!("Version JSON not found for {}", version_id))?;
    let v: serde_json::Value = serde_json::from_str(&data).map_err(|e| e.to_string())?;
    let main_class = v["mainClass"].as_str().unwrap_or("net.minecraft.client.main.Main").to_string();
    let asset_index = v["assetIndex"]["id"].as_str().or_else(|| v["assets"].as_str()).unwrap_or(version_id).to_string();
    let extra_jvm: Vec<String> = v["arguments"]["jvm"].as_array().map(|arr| {
        arr.iter().filter_map(|a| a.as_str()).filter(|s| !s.contains("${")).map(|s| s.to_string()).collect()
    }).unwrap_or_default();
    Ok((main_class, asset_index, extra_jvm))
}

#[tauri::command]
pub async fn delete_minecraft_version(version_id: String) -> Result<(), String> {
    let dir = versions_dir().join(&version_id);
    if dir.exists() { std::fs::remove_dir_all(&dir).map_err(|e| format!("Delete: {e}"))?; }
    Ok(())
}

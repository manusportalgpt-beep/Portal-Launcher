use serde::{Serialize, Deserialize};
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::io::Read;
use sha1::{Digest, Sha1};
use tauri::Emitter;
use which::which;

/// Try to extract an icon from a mod jar/zip and return it as a base64 data URI.
/// Best-effort — returns None if nothing reasonable is found.
fn extract_jar_icon(jar_path: &Path) -> Option<String> {
    let data = std::fs::read(jar_path).ok()?;
    let mut archive = zip::ZipArchive::new(std::io::Cursor::new(data)).ok()?;

    // 1. fabric.mod.json declares icon path
    let icon_candidates: Vec<String> = {
        let mut paths: Vec<String> = vec![];
        if let Ok(mut fm) = archive.by_name("fabric.mod.json") {
            let mut s = String::new();
            if fm.read_to_string(&mut s).is_ok() {
                if let Ok(v) = serde_json::from_str::<serde_json::Value>(&s) {
                    if let Some(icon) = v["icon"].as_str() { paths.push(icon.to_string()); }
                }
            }
        }
        paths.extend([
            "icon.png".to_string(),
            "pack.png".to_string(),
            "logo.png".to_string(),
            "logoFile.png".to_string(),
            "assets/icon.png".to_string(),
        ]);
        paths
    };

    for cand in &icon_candidates {
        if let Ok(mut entry) = archive.by_name(cand) {
            if entry.size() > 512 * 1024 { continue; } // skip huge images
            let mut buf = Vec::with_capacity(entry.size() as usize);
            if entry.read_to_end(&mut buf).is_ok() && !buf.is_empty() {
                let mime = if cand.ends_with(".png") || cand.ends_with(".PNG") { "image/png" }
                           else if cand.ends_with(".jpg") || cand.ends_with(".jpeg") { "image/jpeg" }
                           else { "image/png" };
                return Some(format!("data:{};base64,{}", mime, base64_encode(&buf)));
            }
        }
    }
    None
}

fn base64_encode(input: &[u8]) -> String {
    const T: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut out = String::with_capacity((input.len() + 2) / 3 * 4);
    let mut i = 0;
    while i + 3 <= input.len() {
        let n = ((input[i] as u32) << 16) | ((input[i+1] as u32) << 8) | (input[i+2] as u32);
        out.push(T[((n >> 18) & 0x3f) as usize] as char);
        out.push(T[((n >> 12) & 0x3f) as usize] as char);
        out.push(T[((n >>  6) & 0x3f) as usize] as char);
        out.push(T[( n        & 0x3f) as usize] as char);
        i += 3;
    }
    let rem = input.len() - i;
    if rem == 1 {
        let n = (input[i] as u32) << 16;
        out.push(T[((n >> 18) & 0x3f) as usize] as char);
        out.push(T[((n >> 12) & 0x3f) as usize] as char);
        out.push_str("==");
    } else if rem == 2 {
        let n = ((input[i] as u32) << 16) | ((input[i+1] as u32) << 8);
        out.push(T[((n >> 18) & 0x3f) as usize] as char);
        out.push(T[((n >> 12) & 0x3f) as usize] as char);
        out.push(T[((n >>  6) & 0x3f) as usize] as char);
        out.push('=');
    }
    out
}


#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct InstalledMod {
    pub id: String,
    pub name: String,
    pub version: String,
    pub version_id: String,
    pub source: String,
    pub enabled: bool,
    pub file_name: String,
    pub file_size: u64,
    pub mod_type: String,
    pub author: Option<String>,
    pub icon_url: Option<String>,
    pub update_available: bool,
    pub latest_version: Option<String>,
    pub latest_version_id: Option<String>,
    pub latest_download_url: Option<String>,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct ModConflict { pub mod_a: String, pub mod_b: String, pub reason: String }

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct UpdateResult { pub mod_id: String, pub mod_name: String, pub old_version: String, pub new_version: String, pub success: bool, pub error: Option<String> }

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct UpdateSnapshotEntry {
    pub mod_id: String,
    pub mod_name: String,
    pub previous: InstalledMod,
    pub updated: InstalledMod,
    pub backup_file: String,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct UpdateSnapshot {
    pub id: String,
    pub timestamp: String,
    pub entries: Vec<UpdateSnapshotEntry>,
}

fn mc_base_dir() -> PathBuf {
    crate::commands::version_manager::mc_base_dir()
}

fn instance_base(instance_id: &str) -> PathBuf {
    mc_base_dir().join("instances").join(instance_id)
}

fn update_snapshot_root(instance_id: &str) -> PathBuf {
    instance_base(instance_id).join(".portal-update-history")
}

fn safe_update_file_name(name: &str) -> Result<String, String> {
    let file_name = Path::new(name).file_name().and_then(|value| value.to_str()).unwrap_or("");
    if file_name.is_empty() || file_name != name || file_name.contains("..") {
        return Err("Invalid update history file name".to_string());
    }
    Ok(file_name.to_string())
}

fn snapshot_manifest_path(instance_id: &str, snapshot_id: &str) -> Result<PathBuf, String> {
    if snapshot_id.is_empty() || snapshot_id.contains('/') || snapshot_id.contains('\\') || snapshot_id.contains("..") {
        return Err("Invalid update snapshot id".to_string());
    }
    Ok(update_snapshot_root(instance_id).join(snapshot_id).join("snapshot.json"))
}

fn archive_previous_update_file(instance_id: &str, snapshot_id: &str, mod_info: &InstalledMod) -> Result<String, String> {
    let file_name = safe_update_file_name(&mod_info.file_name)?;
    let directory = mods_dir_for(instance_id, &mod_info.mod_type);
    let source = directory.join(&file_name);
    if !source.exists() {
        return Err(format!("Current file for rollback snapshot was not found: {file_name}"));
    }
    let target_dir = update_snapshot_root(instance_id).join(snapshot_id).join("files").join(mod_type_folder(&mod_info.mod_type));
    std::fs::create_dir_all(&target_dir).map_err(|e| format!("Create update snapshot directory: {e}"))?;
    let target = target_dir.join(&file_name);
    std::fs::copy(&source, &target).map_err(|e| format!("Save previous file for rollback: {e}"))?;
    Ok(format!("files/{}/{}", mod_type_folder(&mod_info.mod_type), file_name))
}

fn save_update_snapshot(instance_id: &str, snapshot: &UpdateSnapshot) -> Result<(), String> {
    let manifest = snapshot_manifest_path(instance_id, &snapshot.id)?;
    let parent = manifest.parent().ok_or("Invalid update snapshot directory")?;
    std::fs::create_dir_all(parent).map_err(|e| format!("Create update snapshot: {e}"))?;
    std::fs::write(&manifest, serde_json::to_string_pretty(snapshot).map_err(|e| e.to_string())?)
        .map_err(|e| format!("Write update snapshot: {e}"))
}

fn mod_type_folder(mod_type: &str) -> &'static str {
    match mod_type.trim().to_ascii_lowercase().as_str() {
        "resourcepack" | "resourcepacks" | "resource_pack" | "resource-pack" => "resourcepacks",
        "shaderpack" | "shaderpacks" | "shader" | "shaders" | "shader_pack" | "shader-pack" => "shaderpacks",
        "datapack" | "datapacks" | "data_pack" | "data-pack" => "datapacks",
        "saves" => "saves",
        _ => "mods",
    }
}

fn detect_mod_type(categories: &[String], project_type: Option<&str>) -> &'static str {
    if let Some(pt) = project_type {
        match pt {
            "resourcepack" => return "resourcepack",
            "shader" => return "shaderpack",
            "datapack" => return "datapack",
            _ => {}
        }
    }
    for cat in categories {
        if cat.contains("resourcepack") { return "resourcepack"; }
        if cat.contains("shader") { return "shaderpack"; }
        if cat.contains("datapack") { return "datapack"; }
    }
    "mod"
}

/// Detects common Minecraft ZIP layouts so legacy installs can be repaired on scan.
fn detect_zip_content_type(path: &Path) -> Option<&'static str> {
    let file = std::fs::File::open(path).ok()?;
    let mut archive = zip::ZipArchive::new(file).ok()?;
    let mut has_shader = false;
    let mut has_level = false;
    let mut has_assets = false;
    for index in 0..archive.len().min(400) {
        let entry = archive.by_index(index).ok()?;
        let name = entry.name().replace('\\', "/").to_ascii_lowercase();
        let clean = name.trim_start_matches("./");
        if clean == "level.dat" || clean.ends_with("/level.dat") { has_level = true; }
        if clean.starts_with("shaders/") || clean.contains("/shaders/") { has_shader = true; }
        if clean.starts_with("assets/") || clean.contains("/assets/") { has_assets = true; }
    }
    if has_shader { Some("shaderpack") }
    else if has_level { Some("saves") }
    else if has_assets { Some("resourcepack") }
    else { None }
}

fn instance_json_path(id: &str) -> PathBuf { instance_base(id).join("instance.json") }

fn get_instance_meta(id: &str) -> (String, String) {
    let path = instance_json_path(id);
    std::fs::read_to_string(&path).ok()
        .and_then(|d| serde_json::from_str::<serde_json::Value>(&d).ok())
        .map(|v| (v["mc_version"].as_str().unwrap_or("1.20.1").to_string(), v["loader"].as_str().unwrap_or("fabric").to_string()))
        .unwrap_or_else(|| ("1.20.1".to_string(), "fabric".to_string()))
}

fn game_dir(instance_id: &str) -> PathBuf {
    // Game files live in <instance>/.minecraft/ (Modrinth/MultiMC convention)
    instance_base(instance_id).join(".minecraft")
}

fn mods_dir_for(instance_id: &str, mod_type: &str) -> PathBuf {
    let p = game_dir(instance_id).join(mod_type_folder(mod_type));
    std::fs::create_dir_all(&p).ok(); p
}

/// Older builds could put resource packs and shader packs into mods. Once the
/// same file is installed successfully into its correct folder, remove only
/// that obsolete misplaced copy to avoid duplicate/confusing content.
fn remove_legacy_misplaced_content(instance_id: &str, file_name: &str, mod_type: &str) {
    if mod_type_folder(mod_type) == "mods" { return; }
    let correct = mods_dir_for(instance_id, mod_type).join(file_name);
    let legacy = game_dir(instance_id).join("mods").join(file_name);
    if correct.exists() && legacy.exists() {
        let _ = std::fs::remove_file(legacy);
    }
}

/// Resolve content files from the instance-local folder first, then from the
/// shared Minecraft content folder used by older Portal Launcher profiles.
fn content_dir_for_action(instance_id: &str, mod_type: &str, file_name: &str) -> PathBuf {
    let base_name = file_name.trim_end_matches(".disabled");
    let local = mods_dir_for(instance_id, mod_type);
    if local.join(base_name).exists() || local.join(format!("{base_name}.disabled")).exists() {
        return local;
    }
    let global = global_mc_dir().join(mod_type_folder(mod_type));
    if global.join(base_name).exists() || global.join(format!("{base_name}.disabled")).exists() {
        return global;
    }
    local
}

fn update_instance_mod_list(instance_id: &str, m: &InstalledMod) {
    let path = instance_json_path(instance_id);
    if let Ok(data) = std::fs::read_to_string(&path) {
        if let Ok(mut config) = serde_json::from_str::<serde_json::Value>(&data) {
            let new_mod = serde_json::to_value(m).unwrap_or_default();
            match config["mods"].as_array_mut() {
                Some(arr) => {
                    // ВАЖНО: раньше здесь был просто arr.push(new_mod) — при
                    // каждой (пере)установке мода в instance.json добавлялась
                    // ЕЩЁ ОДНА запись, а не заменяла старую. За несколько
                    // переустановок/обновлений набегала куча метаданных на
                    // один и тот же мод с разными версиями, из-за чего в
                    // списке контента он показывался несколько раз.
                    // Заменяем по id (project_id) + mod_type, если уже есть.
                    if let Some(existing) = arr.iter_mut().find(|e| {
                        e["id"].as_str() == Some(m.id.as_str())
                            && e["mod_type"].as_str() == Some(m.mod_type.as_str())
                    }) {
                        *existing = new_mod;
                    } else {
                        arr.push(new_mod);
                    }
                }
                None => config["mods"] = serde_json::json!([new_mod]),
            }
            if let Ok(json) = serde_json::to_string_pretty(&config) { std::fs::write(&path, json).ok(); }
        }
    }
}

#[tauri::command]
pub async fn search_mods(query: String, platform: String, limit: Option<u64>, curseforge_api_key: Option<String>) -> Result<serde_json::Value, String> {
    match platform.as_str() {
        "modrinth" => Ok(serde_json::to_value(super::modrinth::search_modrinth(query, limit, None, None, None, None, Some("relevance".into()), None).await?).unwrap()),
        "curseforge" => Ok(serde_json::to_value(super::curseforge::search_curseforge(query, limit, None, None, None, None, None, None, curseforge_api_key.unwrap_or_default(), None).await?).unwrap()),
        _ => {
            let (mr, cf) = tokio::join!(
                super::modrinth::search_modrinth(query.clone(), limit, None, None, None, None, None, None),
                super::curseforge::search_curseforge(query, limit, None, None, None, None, None, None, curseforge_api_key.unwrap_or_default(), None)
            );
            Ok(serde_json::json!({"modrinth":mr.ok(),"curseforge":cf.ok()}))
        }
    }
}

/// Install a Modrinth mod and auto-download its dependencies
#[tauri::command]
pub async fn install_mod(
    app: tauri::AppHandle,
    instance_id: String, download_url: String, file_name: String,
    mod_id: String, mod_name: String, mod_version: String, version_id: String,
    source: String, mod_type: Option<String>, project_id: Option<String>,
    author: Option<String>, icon_url: Option<String>,
) -> Result<Vec<InstalledMod>, String> {
    let mtype = mod_type.as_deref().unwrap_or("mod");

    // The external launcher does not receive a content type. Restrict it to
    // Java mods; resource packs, shader packs and datapacks use the local
    // writer below so they always reach the right Minecraft folder.
    if mod_type_folder(mtype) == "mods" && which("lighty-launcher").is_ok() {
        let mut cmd_opt = None;
        if which("lighty-launcher").is_ok() {
            let mut c = crate::utils::create_hidden_command("lighty-launcher");
            c.arg("mod").arg("install").arg("--instance").arg(&instance_id).arg("--url").arg(&download_url).arg("--file").arg(&file_name);
            cmd_opt = Some(c);
        }

        if let Some(mut cmd) = cmd_opt {
            let status = cmd.status().map_err(|e| format!("Failed to run lighty mod installer: {}", e))?;
            if status.success() {
                let mod_type_value = mod_type.as_deref().unwrap_or("mod").to_string();
                return Ok(vec![InstalledMod { id: mod_id.clone(), name: mod_name.clone(), version: mod_version.clone(), version_id: version_id.clone(), source: source.clone(), enabled: true, file_name: file_name.clone(), file_size: 0, mod_type: mod_type_value, author, icon_url, update_available: false, latest_version: None, latest_version_id: None, latest_download_url: None }]);
            }
            // If Lighty failed, fallthrough to manual install
        }
    }

    let client = reqwest::Client::builder().user_agent("PortalLauncher/1.1").build().map_err(|e| e.to_string())?;
    let dir = mods_dir_for(&instance_id, mtype);

    // Если этот же проект (по id) уже был установлен под другим именем файла
    // (другая версия), удаляем старый файл — иначе на диске останутся сразу
    // обе версии и мод будет показан дважды.
    if let Ok(data) = std::fs::read_to_string(instance_json_path(&instance_id)) {
        if let Ok(config) = serde_json::from_str::<serde_json::Value>(&data) {
            if let Some(arr) = config["mods"].as_array() {
                for entry in arr {
                    let same_project = entry["id"].as_str() == Some(mod_id.as_str())
                        || entry["id"].as_str() == project_id.as_deref();
                    if same_project {
                        if let Some(old_fname) = entry["file_name"].as_str() {
                            if old_fname != file_name {
                                std::fs::remove_file(dir.join(old_fname)).ok();
                            }
                        }
                    }
                }
            }
        }
    }

    app.emit("mod-progress", serde_json::json!({"name":mod_name,"percent":20,"message":"Downloading mod..."})).ok();

    let bytes = client.get(&download_url).send().await.map_err(|e| format!("Download: {e}"))?.bytes().await.map_err(|e| format!("Read: {e}"))?;
    let file_size = bytes.len() as u64;
    std::fs::write(dir.join(&file_name), &bytes).map_err(|e| format!("Write: {e}"))?;
    remove_legacy_misplaced_content(&instance_id, &file_name, mtype);

    let installed = InstalledMod {
        id: project_id.unwrap_or(mod_id), name: mod_name, version: mod_version, version_id: version_id.clone(),
        source: source.clone(), enabled: true, file_name, file_size,
        mod_type: mtype.to_string(), author, icon_url,
        update_available: false, latest_version: None, latest_version_id: None, latest_download_url: None,
    };
    update_instance_mod_list(&instance_id, &installed);

    app.emit("mod-progress", serde_json::json!({"name":installed.name,"percent":60,"message":"Checking dependencies..."})).ok();

    let mut all_installed = vec![installed.clone()];
    if source == "modrinth" && !version_id.is_empty() {
        let deps = install_mod_dependencies_internal(&client, &app, &instance_id, &version_id).await.unwrap_or_default();
        all_installed.extend(deps);
    }

    app.emit("mod-progress", serde_json::json!({"name":installed.name,"percent":100,"message":"Installed!"})).ok();
    Ok(all_installed)
}

/// Install a CurseForge mod by downloading its file via the API
#[tauri::command]
pub async fn install_curseforge_mod(
    app: tauri::AppHandle,
    instance_id: String,
    mod_id: u64,
    file_id: u64,
    file_name: String,
    mod_name: String,
    mod_version: String,
    mod_type: Option<String>,
    author: Option<String>,
    icon_url: Option<String>,
    api_key: String,
) -> Result<InstalledMod, String> {
    let client = reqwest::Client::builder().user_agent("PortalLauncher/1.1").build().map_err(|e| e.to_string())?;
    let mtype = mod_type.as_deref().unwrap_or("mod");
    let dir = mods_dir_for(&instance_id, mtype);

    app.emit("mod-progress", serde_json::json!({"name":mod_name,"percent":10,"message":"Getting download URL..."})).ok();

    // Get download URL from CurseForge API
    let download_url = super::curseforge::get_curseforge_file_download_url(
        mod_id, file_id, api_key.clone()
    ).await?;

    if download_url.is_empty() {
        return Err(format!("Could not get download URL for '{}'. This mod may restrict 3rd-party distribution.", mod_name));
    }

    // The external launcher does not receive a content type. Restrict it to
    // Java mods; resource packs, shader packs and datapacks use the local
    // writer below so they always reach the right Minecraft folder.
    if mod_type_folder(mtype) == "mods" && which("lighty-launcher").is_ok() {
        let mut cmd_opt = None;
        if which("lighty-launcher").is_ok() {
            let mut c = crate::utils::create_hidden_command("lighty-launcher");
            c.arg("mod").arg("install").arg("--instance").arg(&instance_id).arg("--url").arg(&download_url).arg("--file").arg(&file_name);
            cmd_opt = Some(c);
        }

        if let Some(mut cmd) = cmd_opt {
            let status = cmd.status().map_err(|e| format!("Failed to run lighty mod installer: {}", e))?;
            if status.success() {
                let installed = InstalledMod { id: mod_id.to_string(), name: mod_name.clone(), version: mod_version.clone(), version_id: file_id.to_string(), source: "curseforge".to_string(), enabled: true, file_name: file_name.clone(), file_size: 0, mod_type: mtype.to_string(), author, icon_url, update_available: false, latest_version: None, latest_version_id: None, latest_download_url: None };
                update_instance_mod_list(&instance_id, &installed);
                app.emit("mod-progress", serde_json::json!({"name":installed.name,"percent":100,"message":"Installed from CurseForge via Lighty!"})).ok();
                return Ok(installed);
            }
            // If Lighty failed, fallthrough to manual install
        }
    }

    app.emit("mod-progress", serde_json::json!({"name":mod_name,"percent":30,"message":"Downloading..."})).ok();

    let resp = client.get(&download_url)
        .header("x-api-key", &api_key)
        .header(reqwest::header::ACCEPT_ENCODING, "identity")
        .send().await.map_err(|e| format!("Download failed: {e}"))?;

    if !resp.status().is_success() {
        let status = resp.status();
        let detail = resp.text().await.unwrap_or_default();
        let preview: String = detail.chars().filter(|character| !character.is_control()).take(220).collect();
        return Err(if preview.is_empty() {
            format!("CurseForge download failed: HTTP {status}")
        } else {
            format!("CurseForge download failed: HTTP {status} — {preview}")
        });
    }

    let bytes = resp.bytes().await.map_err(|e| format!("CurseForge file body could not be read: {e}"))?;
    if bytes.is_empty() {
        return Err("CurseForge returned an empty file. Try another compatible version.".into());
    }
    let file_size = bytes.len() as u64;

    // Use a safe filename
    let safe_name = if file_name.is_empty() {
        format!("{}-cf-{}.jar", mod_name.replace(' ', "-"), file_id)
    } else {
        file_name.clone()
    };

    // Удаляем старый файл этого же мода (по CurseForge mod_id), если уже
    // установлена другая версия — та же причина дублей, что и в install_mod.
    if let Ok(data) = std::fs::read_to_string(instance_json_path(&instance_id)) {
        if let Ok(config) = serde_json::from_str::<serde_json::Value>(&data) {
            if let Some(arr) = config["mods"].as_array() {
                for entry in arr {
                    if entry["id"].as_str() == Some(mod_id.to_string().as_str()) {
                        if let Some(old_fname) = entry["file_name"].as_str() {
                            if old_fname != safe_name {
                                std::fs::remove_file(dir.join(old_fname)).ok();
                            }
                        }
                    }
                }
            }
        }
    }

    std::fs::write(dir.join(&safe_name), &bytes).map_err(|e| format!("Write error: {e}"))?;
    remove_legacy_misplaced_content(&instance_id, &safe_name, mtype);

    let installed = InstalledMod {
        id: mod_id.to_string(),
        name: mod_name,
        version: mod_version,
        version_id: file_id.to_string(),
        source: "curseforge".to_string(),
        enabled: true,
        file_name: safe_name,
        file_size,
        mod_type: mtype.to_string(),
        author,
        icon_url,
        // CurseForge mods: updates disabled to avoid conflicts
        update_available: false,
        latest_version: None,
        latest_version_id: None,
        latest_download_url: None,
    };

    update_instance_mod_list(&instance_id, &installed);

    app.emit("mod-progress", serde_json::json!({"name":installed.name,"percent":100,"message":"Installed from CurseForge!"})).ok();
    Ok(installed)
}

async fn install_mod_dependencies_internal(client: &reqwest::Client, app: &tauri::AppHandle, instance_id: &str, version_id: &str) -> Result<Vec<InstalledMod>, String> {
    let version_data: serde_json::Value = client.get(&format!("https://api.modrinth.com/v2/version/{}", version_id))
        .send().await.map_err(|e| e.to_string())?.json().await.map_err(|e| e.to_string())?;

    let (mc_version, loader) = get_instance_meta(instance_id);
    let mut installed = vec![];

    if let Some(deps) = version_data["dependencies"].as_array() {
        for dep in deps {
            if dep["dependency_type"].as_str() != Some("required") { continue; }
            let dep_pid = dep["project_id"].as_str().unwrap_or("").to_string();
            let dep_vid = dep["version_id"].as_str().map(|s| s.to_string());
            if dep_pid.is_empty() { continue; }

            let mods_folder = game_dir(instance_id).join("mods");
            let _already = std::fs::read_dir(&mods_folder).ok()
                .map(|e| e.count()).unwrap_or(0) > 0;

            let dep_version_url = dep_vid.as_ref()
                .map(|vid| format!("https://api.modrinth.com/v2/version/{}", vid))
                .unwrap_or_else(|| format!("https://api.modrinth.com/v2/project/{}/version?game_versions=[\"{}\"]&loaders=[\"{}\"]", dep_pid, mc_version, loader));

            if let Ok(dep_data) = (async { client.get(&dep_version_url).send().await?.json::<serde_json::Value>().await }).await {
                let dep_ver = if dep_vid.is_some() { dep_data.clone() } else {
                    dep_data.as_array().and_then(|a| a.first()).cloned().unwrap_or(dep_data)
                };

                if let Some(f) = dep_ver["files"].as_array().and_then(|a| a.first()) {
                    let url = f["url"].as_str().unwrap_or("").to_string();
                    let fname = f["filename"].as_str().unwrap_or("").to_string();
                    if url.is_empty() || fname.is_empty() { continue; }

                    let dir = game_dir(instance_id).join("mods");
                    std::fs::create_dir_all(&dir).ok();
                    if dir.join(&fname).exists() { continue; }

                    // Эта же зависимость (по id проекта) уже могла быть
                    // установлена вручную или другой зависимостью — под другим
                    // именем файла. Раньше проверялось только точное совпадение
                    // имени файла, из-за чего один и тот же мод оказывался
                    // установлен дважды под разными версиями/именами.
                    let already_installed = std::fs::read_to_string(instance_json_path(instance_id))
                        .ok()
                        .and_then(|d| serde_json::from_str::<serde_json::Value>(&d).ok())
                        .and_then(|c| c["mods"].as_array().map(|arr| {
                            arr.iter().any(|m| m["id"].as_str() == Some(dep_pid.as_str()))
                        }))
                        .unwrap_or(false);
                    if already_installed { continue; }

                    app.emit("mod-progress", serde_json::json!({"name":fname,"percent":70,"message":format!("Downloading dependency: {}", fname)})).ok();

                    if let Ok(bytes) = (async { client.get(&url).send().await?.bytes().await }).await {
                        let size = bytes.len() as u64;
                        std::fs::write(dir.join(&fname), &bytes).ok();

                        // ВАЖНО: dep_ver["name"] — это название КОНКРЕТНОЙ ВЕРСИИ
                        // ("Sodium 0.9.2 for 1.20.1"), а не проекта. Раньше оно
                        // писалось прямо в название мода — отсюда цифры в имени
                        // у зависимостей. Настоящее название/иконку/автора берём
                        // из /v2/project/{id}, как и для основного мода.
                        let (mut dep_title, mut dep_icon, mut dep_author) =
                            (dep_pid.clone(), None::<String>, None::<String>);
                        if let Ok(proj) = (async {
                            client.get(&format!("https://api.modrinth.com/v2/project/{dep_pid}"))
                                .send().await?.json::<serde_json::Value>().await
                        }).await {
                            if let Some(t) = proj["title"].as_str() { dep_title = t.to_string(); }
                            dep_icon = proj["icon_url"].as_str().map(String::from);
                            if let Some(team_id) = proj["team"].as_str() {
                                if let Ok(members) = (async {
                                    client.get(&format!("https://api.modrinth.com/v2/team/{team_id}/members"))
                                        .send().await?.json::<serde_json::Value>().await
                                }).await {
                                    dep_author = members.as_array()
                                        .and_then(|a| a.iter().find(|m| m["role"].as_str() == Some("Owner")).or_else(|| a.first()))
                                        .and_then(|m| m["user"]["username"].as_str())
                                        .map(String::from);
                                }
                            }
                        }

                        let dep_mod = InstalledMod {
                            id: dep_pid.clone(),
                            name: dep_title,
                            version: dep_ver["version_number"].as_str().unwrap_or("").to_string(),
                            version_id: dep_ver["id"].as_str().unwrap_or("").to_string(),
                            source: "modrinth".to_string(), enabled: true, file_name: fname,
                            file_size: size, mod_type: "mod".to_string(),
                            author: dep_author, icon_url: dep_icon,
                            update_available: false, latest_version: None, latest_version_id: None, latest_download_url: None,
                        };
                        update_instance_mod_list(instance_id, &dep_mod);
                        installed.push(dep_mod);
                    }
                }
            }
        }
    }
    Ok(installed)
}

/// Get the global PortalLauncher directory
fn global_mc_dir() -> PathBuf {
    dirs_next::data_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join("PortalLauncher")
}

fn normalize_content_identity(value: &str) -> String {
    value.to_ascii_lowercase().chars().filter(|ch| ch.is_ascii_alphanumeric()).collect()
}

/// Resourcify can download an archive directly into a content folder without
/// launcher metadata. Modrinth indexes releases by SHA-1, so we can recover an
/// exact project identity instead of guessing from a filename.
async fn resolve_resourcify_modrinth_file(
    client: &reqwest::Client,
    path: &Path,
    file_name: &str,
    mod_type: &str,
    enabled: bool,
    file_size: u64,
) -> Option<InstalledMod> {
    let data = tokio::fs::read(path).await.ok()?;
    if data.is_empty() { return None; }
    let hash = format!("{:x}", Sha1::digest(&data));
    let version: serde_json::Value = client
        .get(format!("https://api.modrinth.com/v2/version_file/{hash}?algorithm=sha1"))
        .send().await.ok()?.error_for_status().ok()?.json().await.ok()?;
    let project_id = version["project_id"].as_str()?.to_string();
    let project: serde_json::Value = client
        .get(format!("https://api.modrinth.com/v2/project/{project_id}"))
        .send().await.ok()?.error_for_status().ok()?.json().await.ok()?;
    let display = file_name.trim_end_matches(".disabled").trim_end_matches(".jar").trim_end_matches(".zip");
    Some(InstalledMod {
        id: project_id,
        name: project["title"].as_str().unwrap_or(display).to_string(),
        version: version["version_number"].as_str().unwrap_or("").to_string(),
        version_id: version["id"].as_str().unwrap_or("").to_string(),
        source: "modrinth".to_string(),
        enabled,
        file_name: file_name.to_string(),
        file_size,
        mod_type: mod_type.to_string(),
        author: project["team"].as_str().map(|author| author.to_string()),
        icon_url: project["icon_url"].as_str().map(|url| url.to_string()),
        update_available: false,
        latest_version: None,
        latest_version_id: None,
        latest_download_url: None,
    })
}

#[tauri::command]
pub async fn get_instance_mods(instance_id: String) -> Result<Vec<InstalledMod>, String> {
    let base = instance_base(&instance_id);
    let stored: Vec<serde_json::Value> = std::fs::read_to_string(base.join("instance.json")).ok()
        .and_then(|d| serde_json::from_str::<serde_json::Value>(&d).ok())
        .and_then(|v| v["mods"].as_array().cloned())
        .unwrap_or_default();

    let stored_by_file: HashMap<&str, &serde_json::Value> = stored.iter()
        .filter_map(|item| item["file_name"].as_str().map(|name| (name, item)))
        .collect();
    let mut mods = vec![];
    let metadata_client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(5))
        .user_agent("PortalLauncher/1.3")
        .build()
        .ok();

    // Content is intentionally listed only from this instance. Earlier builds
    // mixed in PortalLauncher's shared folders, which made a pack appear in the
    // launcher even though Minecraft could not see it in this particular world.
    // All new installations target the instance-local folders below.
    // Check instance-specific folders (inside .minecraft subfolder).
    let mc_dir = game_dir(&instance_id);
    for (folder, mtype) in &[("mods","mod"),("resourcepacks","resourcepack"),("shaderpacks","shaderpack"),("datapacks","datapack")] {
        let dir = mc_dir.join(folder);
        if !dir.exists() { continue; }
        if let Ok(entries) = std::fs::read_dir(&dir) {
            for entry in entries.flatten() {
                let entry_name = entry.file_name().to_string_lossy().to_string();
                // Skip kubejs folder (requires kubejs mod to work, useless without it)
                if entry_name == "kubejs" || entry_name.to_lowercase() == "kubejs" { continue; }
                let fname = entry_name;
                if *folder == "mods" && fname.to_ascii_lowercase().ends_with(".zip") {
                    if let Some(kind) = detect_zip_content_type(&entry.path()) {
                        let destination = mc_dir.join(mod_type_folder(kind));
                        let _ = std::fs::create_dir_all(&destination);
                        let target = destination.join(&fname);
                        if !target.exists() && std::fs::rename(entry.path(), target).is_ok() {
                            continue;
                        }
                    }
                }
                let is_disabled = fname.ends_with(".disabled");
                if !fname.ends_with(".jar") && !fname.ends_with(".zip") && !fname.ends_with(".disabled") { continue; }
                let base_name = fname.trim_end_matches(".disabled");
                let display = base_name.trim_end_matches(".jar").trim_end_matches(".zip").to_string();
                let fsize = entry.metadata().map(|m| m.len()).unwrap_or(0);
                let meta = stored_by_file.get(fname.as_str()).copied()
                    .or_else(|| stored_by_file.get(base_name).copied());
                if let Some(m) = meta {
                    mods.push(InstalledMod {
                        id: m["id"].as_str().unwrap_or(&display).to_string(),
                        name: m["name"].as_str().unwrap_or(&display).to_string(),
                        version: m["version"].as_str().unwrap_or("").to_string(),
                        version_id: m["version_id"].as_str().unwrap_or("").to_string(),
                        source: m["source"].as_str().unwrap_or("modrinth").to_string(),
                        enabled: !is_disabled,
                        file_name: fname, file_size: fsize,
                        mod_type: mtype.to_string(),
                        author: m["author"].as_str().map(|s| s.to_string()),
                        icon_url: m["icon_url"].as_str().map(|s| s.to_string()),
                        update_available: m["update_available"].as_bool().unwrap_or(false),
                        latest_version: m["latest_version"].as_str().map(|s| s.to_string()),
                        latest_version_id: m["latest_version_id"].as_str().map(|s| s.to_string()),
                        latest_download_url: m["latest_download_url"].as_str().map(|s| s.to_string()),
                    });
                } else {
                    let normalized_display = normalize_content_identity(&display);
                    let related_meta = stored.iter().find(|item| {
                        let same_type = item["mod_type"].as_str() == Some(*mtype);
                        let source = item["source"].as_str().unwrap_or("");
                        let known_name = item["name"].as_str().map(normalize_content_identity).unwrap_or_default();
                        same_type && matches!(source, "modrinth" | "curseforge") && known_name.len() >= 4
                            && (normalized_display.contains(&known_name) || known_name.contains(&normalized_display))
                    });
                    if let Some(known) = related_meta {
                        let matched = InstalledMod {
                            id: known["id"].as_str().unwrap_or(&display).to_string(),
                            name: known["name"].as_str().unwrap_or(&display).to_string(),
                            version: known["version"].as_str().unwrap_or("").to_string(),
                            version_id: known["version_id"].as_str().unwrap_or("").to_string(),
                            source: known["source"].as_str().unwrap_or("manual").to_string(),
                            enabled: !is_disabled,
                            file_name: fname.clone(),
                            file_size: fsize,
                            mod_type: mtype.to_string(),
                            author: known["author"].as_str().map(|value| value.to_string()),
                            icon_url: known["icon_url"].as_str().map(|value| value.to_string()),
                            update_available: false,
                            latest_version: None,
                            latest_version_id: None,
                            latest_download_url: None,
                        };
                        update_instance_mod_list(&instance_id, &matched);
                        mods.push(matched);
                        continue;
                    }
                    // Content installed by Resourcify often has no
                    // instance.json entry. For non-mod content we can use an
                    // exact Modrinth SHA-1 match and persist it for later
                    // scans, avoiding a permanent "local file" label.
                    if matches!(*mtype, "resourcepack" | "shaderpack" | "datapack") {
                        if let Some(client) = metadata_client.as_ref() {
                            if let Some(resolved) = resolve_resourcify_modrinth_file(client, &entry.path(), &fname, mtype, !is_disabled, fsize).await {
                                update_instance_mod_list(&instance_id, &resolved);
                                mods.push(resolved);
                                continue;
                            }
                        }
                    }
                    // Do not read and decompress every JAR during the initial scan.
                    // Icons for metadata-backed installs are already stored above;
                    // manual files receive the lightweight generic JAR icon in the UI.
                    let jar_icon: Option<String> = None;
                    mods.push(InstalledMod {
                        id: display.clone(), name: display, version: String::new(), version_id: String::new(),
                        source: "manual".to_string(), enabled: !is_disabled, file_name: fname, file_size: fsize,
                        mod_type: mtype.to_string(), author: None, icon_url: jar_icon,
                        update_available: false, latest_version: None, latest_version_id: None, latest_download_url: None,
                    });
                }
            }
        }
    }
    Ok(mods)
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct ModHistoryEntry {
    pub timestamp: String,
    pub action: String,
    pub file_name: String,
    pub mod_type: String,
    pub enabled: Option<bool>,
    pub trashed_name: Option<String>,
    pub was_disabled: bool,
}

fn mod_history_path(instance_id: &str) -> PathBuf { instance_base(instance_id).join("mod-history.json") }
fn load_mod_history(instance_id: &str) -> Vec<ModHistoryEntry> {
    std::fs::read_to_string(mod_history_path(instance_id)).ok().and_then(|v| serde_json::from_str(&v).ok()).unwrap_or_default()
}
fn push_mod_history(instance_id: &str, entry: ModHistoryEntry) {
    let mut history = load_mod_history(instance_id);
    history.push(entry);
    if history.len() > 100 { history.drain(0..history.len()-100); }
    let _ = std::fs::write(mod_history_path(instance_id), serde_json::to_string_pretty(&history).unwrap_or_default());
}

#[tauri::command]
pub async fn list_mod_history(instance_id: String) -> Result<Vec<ModHistoryEntry>, String> { Ok(load_mod_history(&instance_id)) }

#[tauri::command]
pub async fn toggle_mod(instance_id: String, file_name: String, mod_type: Option<String>, enabled: bool) -> Result<(), String> {
    let kind = mod_type.unwrap_or_else(|| "mod".to_string());
    let dir = content_dir_for_action(&instance_id, &kind, &file_name);
    let base_name = file_name.trim_end_matches(".disabled").to_string();
    let active = dir.join(&base_name);
    let disabled = dir.join(format!("{base_name}.disabled"));
    if enabled {
        if disabled.exists() {
            std::fs::rename(&disabled, &active).map_err(|e| e.to_string())?;
        } else if !active.exists() {
            return Err(format!("Content file not found: {base_name}"));
        }
    } else if active.exists() {
        std::fs::rename(&active, &disabled).map_err(|e| e.to_string())?;
    } else if !disabled.exists() {
        return Err(format!("Content file not found: {base_name}"));
    }
    push_mod_history(&instance_id, ModHistoryEntry { timestamp: chrono::Utc::now().to_rfc3339(), action: "toggle".to_string(), file_name: base_name, mod_type: kind, enabled: Some(enabled), trashed_name: None, was_disabled: !enabled });
    Ok(())
}

#[tauri::command]
pub async fn remove_mod(instance_id: String, file_name: String, mod_type: Option<String>) -> Result<(), String> {
    let kind = mod_type.unwrap_or_else(|| "mod".to_string());
    let dir = content_dir_for_action(&instance_id, &kind, &file_name);
    let base_name = file_name.trim_end_matches(".disabled").to_string();
    let active = dir.join(&base_name);
    let disabled = dir.join(format!("{base_name}.disabled"));
    let (source, was_disabled) = if active.exists() { (active, false) } else if disabled.exists() { (disabled, true) } else { return Ok(()); };
    // Удаление контента должно быть окончательным: игрок явно нажал на мусорку.
    // Старые версии перемещали файл в скрытую `.launcher-trash`, из-за чего
    // папка разрасталась и вводила в заблуждение при просмотре Files.
    std::fs::remove_file(&source).map_err(|e| format!("Delete content file: {e}"))?;
    let legacy_trash = instance_base(&instance_id).join(".launcher-trash");
    if legacy_trash.exists() {
        let _ = std::fs::remove_dir_all(legacy_trash);
    }
    push_mod_history(&instance_id, ModHistoryEntry { timestamp: chrono::Utc::now().to_rfc3339(), action: "remove".to_string(), file_name: base_name, mod_type: kind, enabled: None, trashed_name: None, was_disabled });
    Ok(())
}

#[tauri::command]
pub async fn undo_last_mod_action(instance_id: String) -> Result<Option<ModHistoryEntry>, String> {
    let mut history = load_mod_history(&instance_id);
    let Some(entry) = history.pop() else { return Ok(None); };
    let dir = mods_dir_for(&instance_id, &entry.mod_type);
    match entry.action.as_str() {
        "toggle" => {
            let enabled = entry.enabled.unwrap_or(true);
            if enabled {
                let active = dir.join(&entry.file_name);
                if active.exists() { std::fs::rename(active, dir.join(format!("{}.disabled", entry.file_name))).map_err(|e| e.to_string())?; }
            } else {
                let disabled = dir.join(format!("{}.disabled", entry.file_name));
                if disabled.exists() { std::fs::rename(disabled, dir.join(&entry.file_name)).map_err(|e| e.to_string())?; }
            }
        }
        // Removed content is deliberately permanent. Undo remains available for
        // enable/disable actions, while backup snapshots protect larger changes.
        "remove" => {},
        _ => {}
    }
    std::fs::write(mod_history_path(&instance_id), serde_json::to_string_pretty(&history).unwrap_or_default()).map_err(|e| e.to_string())?;
    Ok(Some(entry))
}

/// Check for updates — CurseForge mods are SKIPPED (no auto-update to avoid conflicts)
/// Enables or disables Safe Mode for an instance by temporarily renaming JAR mods.
/// Resource packs, shader packs, worlds and config are deliberately kept untouched.
#[tauri::command]
pub async fn set_instance_safe_mode(instance_id: String, enabled: bool) -> Result<u32, String> {
    let dir = mods_dir_for(&instance_id, "mod");
    if !dir.exists() { return Ok(0); }
    let mut changed = 0u32;
    for entry in std::fs::read_dir(&dir).map_err(|e| e.to_string())?.flatten() {
        let path = entry.path();
        let name = entry.file_name().to_string_lossy().to_string();
        if enabled && name.ends_with(".jar") {
            std::fs::rename(&path, dir.join(format!("{}.disabled", name))).map_err(|e| e.to_string())?;
            changed += 1;
        } else if !enabled && name.ends_with(".jar.disabled") {
            let restored = name.trim_end_matches(".disabled");
            std::fs::rename(&path, dir.join(restored)).map_err(|e| e.to_string())?;
            changed += 1;
        }
    }
    Ok(changed)
}

#[tauri::command]
pub async fn check_mod_updates(instance_id: String) -> Result<Vec<InstalledMod>, String> {
    let client = reqwest::Client::builder().user_agent("PortalLauncher/1.1").build().map_err(|e| e.to_string())?;
    let (mc_version, loader) = get_instance_meta(&instance_id);
    let mut mods = get_instance_mods(instance_id.clone()).await?;
    let stored: Vec<serde_json::Value> = std::fs::read_to_string(instance_json_path(&instance_id)).ok()
        .and_then(|d| serde_json::from_str::<serde_json::Value>(&d).ok())
        .and_then(|v| v["mods"].as_array().cloned()).unwrap_or_default();

    for m in &mut mods {
        // CurseForge mods: skip updates entirely (source separation)
        if m.source == "curseforge" || m.source == "manual" {
            m.update_available = false;
            continue;
        }

        let stored_entry = stored.iter().find(|s| s["file_name"].as_str() == Some(&m.file_name) || s["name"].as_str() == Some(&m.name));
        let project_id = stored_entry.and_then(|s| s["id"].as_str()).unwrap_or("").to_string();
        let current_vid = stored_entry.and_then(|s| s["version_id"].as_str()).unwrap_or("").to_string();
        if project_id.is_empty() { continue; }

        let url = format!("https://api.modrinth.com/v2/project/{}/version?game_versions=[\"{}\"]&loaders=[\"{}\"]", project_id, mc_version, loader);
        if let Ok(resp) = client.get(&url).send().await {
            if let Ok(versions) = resp.json::<serde_json::Value>().await {
                if let Some(latest) = versions.as_array().and_then(|a| a.first()) {
                    let latest_id = latest["id"].as_str().unwrap_or("").to_string();
                    if !latest_id.is_empty() && latest_id != current_vid {
                        m.update_available = true;
                        m.latest_version = latest["version_number"].as_str().map(|s| s.to_string());
                        m.latest_version_id = Some(latest_id);
                        m.latest_download_url = latest["files"].as_array().and_then(|f| f.first()).and_then(|f| f["url"].as_str()).map(|s| s.to_string());
                    }
                }
            }
        }
    }
    Ok(mods)
}

fn sanitize_update_component(value: &str) -> String {
    let cleaned: String = value.chars().map(|c| {
        if c.is_ascii_alphanumeric() || matches!(c, '-' | '_' | '.' | '+') { c } else { '-' }
    }).collect();
    let cleaned = cleaned.trim_matches(['.', '-', '_']).to_string();
    if cleaned.is_empty() { "mod".to_string() } else { cleaned }
}

fn update_file_name(mod_info: &InstalledMod, new_version: &str) -> String {
    let current_base = mod_info.file_name.trim_end_matches(".disabled");
    let extension = Path::new(current_base).extension().and_then(|e| e.to_str()).unwrap_or("jar");
    format!("{}-{}.{}", sanitize_update_component(&mod_info.name), sanitize_update_component(new_version), extension)
}

fn validate_downloaded_content(bytes: &[u8], file_name: &str) -> Result<(), String> {
    if bytes.is_empty() { return Err("Downloaded file is empty".to_string()); }
    let lower = file_name.to_ascii_lowercase();
    if lower.ends_with(".jar") || lower.ends_with(".zip") {
        zip::ZipArchive::new(std::io::Cursor::new(bytes))
            .map(|_| ())
            .map_err(|e| format!("Downloaded archive is invalid: {e}"))
    } else {
        Ok(())
    }
}

fn replace_mod_atomically(dir: &Path, old_file_name: &str, new_file_name: &str, bytes: &[u8]) -> Result<(), String> {
    let old_base = old_file_name.trim_end_matches(".disabled");
    let was_disabled = old_file_name.ends_with(".disabled");
    let target_name = if was_disabled { format!("{new_file_name}.disabled") } else { new_file_name.to_string() };
    let old_path = dir.join(old_base);
    let old_disabled_path = dir.join(format!("{old_base}.disabled"));
    let target_path = dir.join(&target_name);
    let temp_path = dir.join(format!(".{new_file_name}.portal-download-{}.tmp", std::process::id()));
    let backup_path = dir.join(format!(".{old_base}.portal-backup"));

    let _ = std::fs::remove_file(&temp_path);
    let _ = std::fs::remove_file(&backup_path);
    std::fs::write(&temp_path, bytes).map_err(|e| format!("Write temporary update: {e}"))?;

    let old_path_to_move = if old_path.exists() { Some(old_path.clone()) } else if old_disabled_path.exists() { Some(old_disabled_path.clone()) } else { None };
    if let Some(old_path_to_move) = old_path_to_move {
        std::fs::rename(&old_path_to_move, &backup_path).map_err(|e| {
            let _ = std::fs::remove_file(&temp_path);
            format!("Backup current mod before update: {e}")
        })?;
    }

    if target_path.exists() && target_path != backup_path {
        let _ = std::fs::remove_file(&target_path);
    }
    if let Err(error) = std::fs::rename(&temp_path, &target_path) {
        let _ = std::fs::remove_file(&temp_path);
        if backup_path.exists() {
            let restore_target = if was_disabled { old_disabled_path } else { old_path };
            let _ = std::fs::rename(&backup_path, restore_target);
        }
        return Err(format!("Activate updated mod: {error}"));
    }
    let _ = std::fs::remove_file(&backup_path);
    Ok(())
}

fn replace_instance_mod_entry(instance_id: &str, old_file_name: &str, updated: &InstalledMod) {
    let path = instance_json_path(instance_id);
    let Ok(data) = std::fs::read_to_string(&path) else { return; };
    let Ok(mut config) = serde_json::from_str::<serde_json::Value>(&data) else { return; };
    let Some(items) = config["mods"].as_array_mut() else { return; };
    let value = serde_json::to_value(updated).unwrap_or_default();
    let mut replaced = false;
    items.retain(|item| {
        let matches = item["file_name"].as_str() == Some(old_file_name)
            || (item["id"].as_str() == Some(updated.id.as_str()) && item["mod_type"].as_str() == Some(updated.mod_type.as_str()));
        if !matches { return true; }
        if !replaced { replaced = true; true } else { false }
    });
    if replaced {
        if let Some(existing) = items.iter_mut().find(|item| {
            item["file_name"].as_str() == Some(old_file_name)
                || (item["id"].as_str() == Some(updated.id.as_str()) && item["mod_type"].as_str() == Some(updated.mod_type.as_str()))
        }) { *existing = value; }
    } else {
        items.push(value);
    }
    if let Ok(json) = serde_json::to_string_pretty(&config) { let _ = std::fs::write(path, json); }
}

#[tauri::command]
pub async fn list_update_snapshots(instance_id: String) -> Result<Vec<UpdateSnapshot>, String> {
    let root = update_snapshot_root(&instance_id);
    let mut snapshots = Vec::new();
    let entries = match std::fs::read_dir(root) { Ok(entries) => entries, Err(_) => return Ok(snapshots) };
    for entry in entries.flatten() {
        let manifest = entry.path().join("snapshot.json");
        let Ok(raw) = std::fs::read_to_string(manifest) else { continue; };
        if let Ok(snapshot) = serde_json::from_str::<UpdateSnapshot>(&raw) { snapshots.push(snapshot); }
    }
    snapshots.sort_by(|a, b| b.timestamp.cmp(&a.timestamp));
    Ok(snapshots)
}

#[tauri::command]
pub async fn restore_update_snapshot(instance_id: String, snapshot_id: String, mod_id: Option<String>) -> Result<u32, String> {
    let manifest = snapshot_manifest_path(&instance_id, &snapshot_id)?;
    let raw = std::fs::read_to_string(&manifest).map_err(|e| format!("Read update snapshot: {e}"))?;
    let snapshot: UpdateSnapshot = serde_json::from_str(&raw).map_err(|e| format!("Read update snapshot data: {e}"))?;
    let selected: Vec<&UpdateSnapshotEntry> = snapshot.entries.iter().filter(|entry| {
        mod_id.as_deref().map(|id| id == entry.mod_id || id == entry.mod_name).unwrap_or(true)
    }).collect();
    if selected.is_empty() { return Err("No matching mod was found in this update snapshot".to_string()); }

    // Verify every old artifact before changing any current file.
    for entry in &selected {
        let backup = update_snapshot_root(&instance_id).join(&snapshot.id).join(&entry.backup_file);
        if !backup.exists() { return Err(format!("Rollback file is missing for {}", entry.mod_name)); }
    }

    let mut restored = 0u32;
    for entry in selected {
        let directory = mods_dir_for(&instance_id, &entry.previous.mod_type);
        std::fs::create_dir_all(&directory).map_err(|e| format!("Open content folder for rollback: {e}"))?;
        let updated_base = entry.updated.file_name.trim_end_matches(".disabled");
        let _ = std::fs::remove_file(directory.join(updated_base));
        let _ = std::fs::remove_file(directory.join(format!("{updated_base}.disabled")));

        let previous_file = safe_update_file_name(&entry.previous.file_name)?;
        let backup = update_snapshot_root(&instance_id).join(&snapshot.id).join(&entry.backup_file);
        let temp = directory.join(format!(".{previous_file}.portal-restore.tmp"));
        let target = directory.join(&previous_file);
        let _ = std::fs::remove_file(&temp);
        std::fs::copy(&backup, &temp).map_err(|e| format!("Restore previous file: {e}"))?;
        let _ = std::fs::remove_file(&target);
        std::fs::rename(&temp, &target).map_err(|e| format!("Activate restored file: {e}"))?;
        replace_instance_mod_entry(&instance_id, &entry.updated.file_name, &entry.previous);
        restored += 1;
    }
    Ok(restored)
}

/// Update all Modrinth mods — download, validate and activate each artifact atomically.
/// CurseForge and manual files are excluded from auto-update.
#[tauri::command]
pub async fn update_all_mods(app: tauri::AppHandle, instance_id: String, mod_id: Option<String>) -> Result<Vec<UpdateResult>, String> {
    let client = reqwest::Client::builder().user_agent("PortalLauncher/1.1").build().map_err(|e| e.to_string())?;
    let mods = check_mod_updates(instance_id.clone()).await?;
    let updatable: Vec<_> = mods.iter().filter(|m| {
        m.update_available
            && m.source == "modrinth"
            && mod_id.as_deref().map(|requested| requested == m.id || requested == m.name).unwrap_or(true)
    }).collect();
    let total = updatable.len();
    let mut results = vec![];
    let snapshot_id = chrono::Utc::now().format("%Y%m%dT%H%M%S%3fZ").to_string();
    let mut snapshot_entries: Vec<UpdateSnapshotEntry> = Vec::new();

    for (i, m) in updatable.iter().enumerate() {
        let url = match &m.latest_download_url { Some(u) => u.clone(), None => {
            results.push(UpdateResult { mod_id: m.id.clone(), mod_name: m.name.clone(), old_version: m.version.clone(), new_version: m.latest_version.clone().unwrap_or_default(), success: false, error: Some("No download URL returned".to_string()) });
            continue;
        }};
        let new_ver = m.latest_version.clone().unwrap_or_default();
        let new_file_name = update_file_name(m, &new_ver);
        let percent = if total == 0 { 100 } else { (i * 100 / total) as u8 };
        app.emit("mod-progress", serde_json::json!({"name":m.name,"percent":percent,"message":format!("Downloading {} ({}/{})", m.name, i+1, total)})).ok();

        let result: Result<InstalledMod, String> = match client.get(&url).send().await {
            Ok(response) => match response.error_for_status() {
                Ok(response) => match response.bytes().await {
                    Ok(bytes) => {
                        let dir = mods_dir_for(&instance_id, &m.mod_type);
                        if let Err(error) = validate_downloaded_content(&bytes, &new_file_name) {
                            Err(error)
                        } else if let Err(error) = archive_previous_update_file(&instance_id, &snapshot_id, m) {
                            Err(error)
                        } else if let Err(error) = replace_mod_atomically(&dir, &m.file_name, &new_file_name, &bytes) {
                            Err(error)
                        } else {
                            let mut updated = (*m).clone();
                            updated.file_name = if m.file_name.ends_with(".disabled") { format!("{new_file_name}.disabled") } else { new_file_name.clone() };
                            updated.file_size = bytes.len() as u64;
                            updated.version = new_ver.clone();
                            updated.version_id = m.latest_version_id.clone().unwrap_or_else(|| m.version_id.clone());
                            updated.update_available = false;
                            updated.latest_version = None;
                            updated.latest_version_id = None;
                            updated.latest_download_url = None;
                            replace_instance_mod_entry(&instance_id, &m.file_name, &updated);
                            Ok(updated)
                        }
                    }
                    Err(error) => Err(format!("Read downloaded update: {error}")),
                },
                Err(error) => Err(format!("Download returned HTTP error: {error}")),
            },
            Err(error) => Err(format!("Download update: {error}")),
        };
        match result {
            Ok(updated) => {
                let backup_file = format!("files/{}/{}", mod_type_folder(&m.mod_type), safe_update_file_name(&m.file_name)?);
                snapshot_entries.push(UpdateSnapshotEntry { mod_id: m.id.clone(), mod_name: m.name.clone(), previous: (*m).clone(), updated, backup_file });
                results.push(UpdateResult { mod_id: m.id.clone(), mod_name: m.name.clone(), old_version: m.version.clone(), new_version: new_ver, success: true, error: None });
            },
            Err(error) => results.push(UpdateResult { mod_id: m.id.clone(), mod_name: m.name.clone(), old_version: m.version.clone(), new_version: new_ver, success: false, error: Some(error) }),
        }
    }
    if !snapshot_entries.is_empty() {
        let snapshot = UpdateSnapshot { id: snapshot_id, timestamp: chrono::Utc::now().to_rfc3339(), entries: snapshot_entries };
        save_update_snapshot(&instance_id, &snapshot)?;
    }
    let success_count = results.iter().filter(|r| r.success).count();
    app.emit("mod-progress", serde_json::json!({"name":"All","percent":100,"message":format!("{} of {} mods updated", success_count, total)})).ok();
    Ok(results)
}

#[tauri::command]
pub async fn detect_mod_conflicts(instance_id: String) -> Result<Vec<ModConflict>, String> {
    let mods = get_instance_mods(instance_id).await?;
    let mut conflicts = vec![];
    for i in 0..mods.len() {
        for j in (i+1)..mods.len() {
            let (a, b) = (&mods[i], &mods[j]);
            let (na, nb) = (a.name.to_lowercase().replace(['-','_',' '], ""), b.name.to_lowercase().replace(['-','_',' '], ""));
            if na == nb { conflicts.push(ModConflict { mod_a: a.name.clone(), mod_b: b.name.clone(), reason: "Duplicate mod installed twice".to_string() }); }
            // Modrinth + CurseForge same mod conflict detection
            if (a.source == "modrinth" && b.source == "curseforge") || (a.source == "curseforge" && b.source == "modrinth") {
                if na.len() > 4 && nb.contains(&na[..na.len().min(8)]) {
                    conflicts.push(ModConflict { mod_a: a.name.clone(), mod_b: b.name.clone(), reason: "Possible duplicate: same mod from Modrinth and CurseForge".to_string() });
                }
            }
        }
    }
    let known: &[(&str, &str, &str)] = &[
        ("optifine","sodium","OptiFine and Sodium are incompatible — use Iris+Sodium instead"),
        ("optifine","rubidium","OptiFine and Rubidium are incompatible"),
        ("journeymap","xaeros","JourneyMap and Xaero's conflict — use one minimap only"),
    ];
    let names: Vec<_> = mods.iter().map(|m| m.name.to_lowercase().replace(['-','_',' '], "")).collect();
    for (a, b, reason) in known {
        if names.iter().any(|n| n.contains(a)) && names.iter().any(|n| n.contains(b)) {
            conflicts.push(ModConflict {
                mod_a: mods.iter().find(|m| m.name.to_lowercase().replace(['-','_',' '], "").contains(a)).map(|m| m.name.clone()).unwrap_or_else(|| a.to_string()),
                mod_b: mods.iter().find(|m| m.name.to_lowercase().replace(['-','_',' '], "").contains(b)).map(|m| m.name.clone()).unwrap_or_else(|| b.to_string()),
                reason: reason.to_string(),
            });
        }
    }
    Ok(conflicts)
}

#[tauri::command]
pub async fn check_mod_compatibility(instance_id: String, project_id: String) -> Result<serde_json::Value, String> {
    let client = reqwest::Client::builder().user_agent("PortalLauncher/1.1").build().map_err(|e| e.to_string())?;
    let (mc_version, loader) = get_instance_meta(&instance_id);
    let url = format!("https://api.modrinth.com/v2/project/{}/version?game_versions=[\"{}\"]&loaders=[\"{}\"]", project_id, mc_version, loader);
    let resp: serde_json::Value = client.get(&url).send().await.map_err(|e| e.to_string())?.json().await.map_err(|e| e.to_string())?;
    let compatible = resp.as_array().map(|a| !a.is_empty()).unwrap_or(false);
    Ok(serde_json::json!({"compatible":compatible,"mc_version":mc_version,"loader":loader,"latest_compatible_version":resp.as_array().and_then(|a| a.first()).cloned(),"message":if compatible { format!("Compatible with MC {} ({})", mc_version, loader) } else { format!("NOT compatible with MC {} ({})", mc_version, loader) }}))
}

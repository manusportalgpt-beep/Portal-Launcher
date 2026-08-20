use serde::{Serialize, Deserialize};
use std::path::{Path, PathBuf};
use std::io::{Write, Read};
use sha2::{Digest, Sha256, Sha512};
use tauri::Emitter;

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct InstanceMod {
    pub id: String,
    pub name: String,
    pub version: String,
    #[serde(default)]
    pub version_id: String,
    pub source: String,
    pub enabled: bool,
    #[serde(default)]
    pub file_name: String,
    #[serde(default)]
    pub mod_type: String,
    #[serde(default)]
    pub author: Option<String>,
    #[serde(default)]
    pub icon_url: Option<String>,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct Instance {
    pub id: String,
    pub name: String,
    pub description: String,
    pub mc_version: String,
    pub loader: String,
    pub loader_version: String,
    pub min_ram: u32,
    pub max_ram: u32,
    pub java_path: String,
    pub custom_jvm_args: String,
    pub play_time_minutes: u64,
    pub last_played: Option<String>,
    pub created_at: String,
    pub icon: Option<String>,
    pub color: Option<String>,
    pub mods: Vec<InstanceMod>,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct DeletedInstance {
    pub recovery_id: String,
    pub instance: Instance,
    pub deleted_at: String,
    pub size_bytes: u64,
}

fn mc_base_dir() -> PathBuf {
    crate::commands::version_manager::mc_base_dir()
}

fn cancel_requested(instance_id: &str) -> bool {
    crate::mc::launch::CANCELLED.lock().map(|set| set.contains(instance_id)).unwrap_or(false)
}

fn clear_cancel(instance_id: &str) {
    if let Ok(mut set) = crate::mc::launch::CANCELLED.lock() { set.remove(instance_id); }
}

fn instances_dir() -> PathBuf {
    let p = mc_base_dir().join("instances");
    std::fs::create_dir_all(&p).ok();
    p
}

fn deleted_instances_dir() -> PathBuf {
    let path = instances_dir().join(".portal-recovery");
    std::fs::create_dir_all(&path).ok();
    path
}

fn deleted_instance_meta_path(recovery_id: &str) -> PathBuf {
    deleted_instances_dir().join(recovery_id).join("deleted-instance.json")
}

fn safe_recovery_id(value: &str) -> bool {
    !value.is_empty() && !value.contains(&['/', '\\', ':'][..]) && !value.contains("..")
}

fn directory_size(path: &Path) -> u64 {
    let mut total = 0u64;
    if let Ok(entries) = std::fs::read_dir(path) {
        for entry in entries.flatten() {
            let item = entry.path();
            if item.is_dir() { total = total.saturating_add(directory_size(&item)); }
            else if let Ok(metadata) = item.metadata() { total = total.saturating_add(metadata.len()); }
        }
    }
    total
}

fn purge_deleted_instances(retention_minutes: u64) {
    let safe_minutes = retention_minutes.clamp(15, 525_600);
    let cutoff = chrono::Utc::now() - chrono::Duration::minutes(safe_minutes as i64);
    let Ok(entries) = std::fs::read_dir(deleted_instances_dir()) else { return; };
    for entry in entries.flatten() {
        let path = entry.path();
        if !path.is_dir() { continue; }
        let metadata = std::fs::read_to_string(path.join("deleted-instance.json"))
            .ok()
            .and_then(|raw| serde_json::from_str::<DeletedInstance>(&raw).ok());
        let expired = metadata
            .and_then(|item| chrono::DateTime::parse_from_rfc3339(&item.deleted_at).ok())
            .map(|time| time.with_timezone(&chrono::Utc) < cutoff)
            .unwrap_or(false);
        if expired { let _ = std::fs::remove_dir_all(path); }
    }
}

#[tauri::command]
pub fn get_launcher_storage_overview() -> serde_json::Value {
    let root = mc_base_dir();
    let used_bytes = directory_size(&root);
    #[cfg(target_os = "windows")]
    let free_bytes = {
        let escaped = root.to_string_lossy().replace('"', "\"");
        let script = format!("$p=Get-Item -LiteralPath \"{escaped}\"; (Get-PSDrive -Name $p.PSDrive.Name).Free");
        crate::utils::create_hidden_command("powershell")
            .args(["-NoProfile", "-NonInteractive", "-Command", &script])
            .output().ok()
            .and_then(|out| String::from_utf8(out.stdout).ok())
            .and_then(|text| text.trim().parse::<u64>().ok())
    };
    #[cfg(not(target_os = "windows"))]
    let free_bytes: Option<u64> = None;
    serde_json::json!({ "launcherPath": root, "usedBytes": used_bytes, "freeBytes": free_bytes })
}

fn instance_path(id: &str) -> PathBuf { instances_dir().join(id).join("instance.json") }

/// Convert an instance name into a filesystem-safe folder name
fn slugify_name(name: &str) -> String {
    let slug: String = name
        .chars()
        .map(|c| if c.is_alphanumeric() { c.to_ascii_lowercase() } else { '-' })
        .collect::<String>()
        .split('-')
        .filter(|s| !s.is_empty())
        .collect::<Vec<_>>()
        .join("-");
    if slug.is_empty() { "instance".to_string() } else { slug }
}

fn load_instance(id: &str) -> Option<Instance> {
    serde_json::from_str(&std::fs::read_to_string(instance_path(id)).ok()?).ok()
}

fn save_instance(instance: &Instance) -> Result<(), String> {
    let dir = instances_dir().join(&instance.id);
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    std::fs::write(dir.join("instance.json"), serde_json::to_string_pretty(instance).map_err(|e| e.to_string())?).map_err(|e| e.to_string())
}

/// Create the full instance folder structure like a real Minecraft install
fn create_instance_folders(instance_dir: &PathBuf) -> Result<(), String> {
    // Game data lives in <instance>/.minecraft/ — same as Modrinth/MultiMC convention
    let mc = instance_dir.join(".minecraft");
    let folders = [
        "mods", "resourcepacks", "shaderpacks", "datapacks",
        "saves", "config", "logs", "screenshots", "crash-reports",
        "schematics", "scripts",
    ];
    for folder in &folders {
        std::fs::create_dir_all(mc.join(folder)).map_err(|e| e.to_string())?;
    }
    // Create default options.txt inside .minecraft
    let options_path = mc.join("options.txt");
    if !options_path.exists() {
        let default_options = "version:3465\ngamma:0.0\nrenderDistance:12\nsimulationDistance:12\nguiScale:0\nfullscreen:false\nsoundCategory_master:1.0\nsoundCategory_music:1.0\n";
        std::fs::write(&options_path, default_options).ok();
    }
    Ok(())
}

#[tauri::command]
pub async fn get_instances() -> Result<Vec<Instance>, String> {
    let dir = instances_dir();
    let mut instances = vec![];
    if let Ok(entries) = std::fs::read_dir(&dir) {
        for entry in entries.flatten() {
            if entry.file_type().map(|t| t.is_dir()).unwrap_or(false) {
                if let Some(inst) = load_instance(&entry.file_name().to_string_lossy()) { instances.push(inst); }
            }
        }
    }
    instances.sort_by(|a, b| b.last_played.cmp(&a.last_played));
    Ok(instances)
}

#[tauri::command]
pub async fn create_instance(
    app: tauri::AppHandle,
    name: String, description: String, mc_version: String,
    loader: String, loader_version: String, min_ram: u32, max_ram: u32,
    color: Option<String>, icon: Option<String>,
) -> Result<Instance, String> {
    // Use human-readable folder name: "my-cool-pack-a1b2c3d4"
    let id = slugify_name(&name);
    let instance = Instance {
        id: id.clone(), name: name.clone(), description, mc_version: mc_version.clone(),
        loader, loader_version, min_ram, max_ram,
        java_path: String::new(), custom_jvm_args: String::new(),
        play_time_minutes: 0, last_played: None,
        created_at: chrono::Utc::now().to_rfc3339(),
        icon: icon.clone(), color, mods: vec![],
    };
    // Emit progress: creating folders
    app.emit("instance-progress", serde_json::json!({"stage":"creating","name":name,"percent":20,"message":"Creating instance folders..."})).ok();
    let instance_dir = instances_dir().join(&id);
    create_instance_folders(&instance_dir)?;
    // Java-сборки получают ту же постоянную иконку, что и Bedrock-сборки.
    if let Some(ref data_url) = icon {
        if let Some(data_part) = data_url.split(',').nth(1) {
            use base64::Engine as _;
            if let Ok(bytes) = base64::engine::general_purpose::STANDARD.decode(data_part) {
                std::fs::write(instance_dir.join("icon.png"), bytes).ok();
            }
        }
    }
    app.emit("instance-progress", serde_json::json!({"stage":"saving","name":name,"percent":80,"message":"Saving configuration..."})).ok();
    save_instance(&instance)?;
    app.emit("instance-progress", serde_json::json!({"stage":"done","name":name,"percent":100,"message":"Instance created!"})).ok();
    Ok(instance)
}

/// Creates a runnable OptiFine setup by installing the selected Forge version and
/// adding the user-provided official OptiFine JAR to this instance's mods folder.
/// This leaves Minecraft client JARs and shared libraries untouched.
#[tauri::command]
pub async fn create_optifine_instance(
    app: tauri::AppHandle,
    name: String,
    description: String,
    mc_version: String,
    forge_version: String,
    min_ram: u32,
    max_ram: u32,
    color: Option<String>,
    icon: Option<String>,
    optifine_file_name: String,
    optifine_data_url: String,
) -> Result<Instance, String> {
    let lower_name = optifine_file_name.to_lowercase();
    if !lower_name.ends_with(".jar") || !lower_name.contains("optifine") {
        return Err("Выберите официальный OptiFine JAR-файл (.jar).".to_string());
    }
    use base64::Engine as _;
    let encoded = optifine_data_url.split(',').nth(1).unwrap_or(&optifine_data_url);
    let optifine_bytes = base64::engine::general_purpose::STANDARD.decode(encoded)
        .map_err(|e| format!("Не удалось прочитать OptiFine JAR: {e}"))?;
    if optifine_bytes.len() > 100 * 1024 * 1024 {
        return Err("OptiFine JAR слишком большой (максимум 100 MB).".to_string());
    }
    if !optifine_bytes.starts_with(b"PK") {
        return Err("Выбранный файл не является корректным JAR-архивом OptiFine.".to_string());
    }
    if !lower_name.contains(&mc_version.to_lowercase()) {
        return Err(format!("Этот OptiFine JAR предназначен для другой версии Minecraft. Выберите файл для {}.", mc_version));
    }
    {
        let mut archive = zip::ZipArchive::new(std::io::Cursor::new(&optifine_bytes))
            .map_err(|e| format!("OptiFine JAR повреждён или не читается: {e}"))?;
        let has_manifest = archive.by_name("META-INF/MANIFEST.MF").is_ok();
        let has_optifine_entry = (0..archive.len()).any(|index| archive.by_index(index)
            .map(|entry| entry.name().to_ascii_lowercase().contains("optifine"))
            .unwrap_or(false));
        if !has_manifest || !has_optifine_entry {
            return Err("JAR не похож на официальный OptiFine: отсутствует манифест или OptiFine-класс.".to_string());
        }
    }

    let full_forge_version = if forge_version.contains('-') {
        forge_version.clone()
    } else {
        format!("{}-{}", mc_version, forge_version)
    };
    app.emit("instance-progress", serde_json::json!({"stage":"optifine","name":name,"percent":15,"message":"Installing Forge for OptiFine..."})).ok();
    let forge = crate::commands::loader_installer::install_forge(
        mc_version.clone(),
        full_forge_version.clone(),
        crate::commands::version_manager::mc_base_dir().to_string_lossy().to_string(),
    ).await?;
    if !forge.success {
        return Err(format!("Forge required by OptiFine was not installed: {}", forge.message));
    }

    let instance = create_instance(
        app.clone(), name, description, mc_version, "forge".to_string(), full_forge_version,
        min_ram, max_ram, color, icon,
    ).await?;
    let mods_dir = instances_dir().join(&instance.id).join(".minecraft").join("mods");
    std::fs::create_dir_all(&mods_dir).map_err(|e| format!("Create mods folder: {e}"))?;
    let safe_name = std::path::Path::new(&optifine_file_name).file_name()
        .and_then(|name| name.to_str()).ok_or("Некорректное имя OptiFine файла")?;
    let target_path = mods_dir.join(safe_name);
    std::fs::write(&target_path, optifine_bytes)
        .map_err(|e| format!("Save OptiFine JAR: {e}"))?;
    if !target_path.is_file() {
        return Err("OptiFine JAR не удалось сохранить в папку mods.".to_string());
    }
    app.emit("instance-progress", serde_json::json!({"stage":"done","name":instance.name,"percent":100,"message":"OptiFine setup created"})).ok();
    Ok(instance)
}

#[tauri::command]
pub async fn update_instance(id: String, updates: serde_json::Value) -> Result<Instance, String> {
    let mut inst = load_instance(&id).ok_or("Instance not found")?;
    if let Some(v) = updates["name"].as_str() { inst.name = v.to_string(); }
    if let Some(v) = updates["description"].as_str() { inst.description = v.to_string(); }
    if let Some(v) = updates["mc_version"].as_str().or_else(|| updates["minecraft_version"].as_str()) { inst.mc_version = v.to_string(); }
    if let Some(v) = updates["loader"].as_str().or_else(|| updates["mod_loader"].as_str()) { inst.loader = v.to_string(); }
    if let Some(v) = updates["min_ram"].as_u64() { inst.min_ram = v as u32; }
    if let Some(v) = updates["max_ram"].as_u64() { inst.max_ram = v as u32; }
    if let Some(v) = updates["java_path"].as_str() { inst.java_path = v.to_string(); }
    if let Some(v) = updates["custom_jvm_args"].as_str() { inst.custom_jvm_args = v.to_string(); }
    if let Some(v) = updates["loader_version"].as_str() { inst.loader_version = v.to_string(); }
    if let Some(v) = updates["color"].as_str() { inst.color = Some(v.to_string()); }
    save_instance(&inst)?;
    Ok(inst)
}

#[tauri::command]
pub async fn delete_instance(id: String) -> Result<(), String> {
    let dir = instances_dir().join(&id);
    if !dir.exists() { return Ok(()); }
    let instance = load_instance(&id).ok_or("Сборка не найдена или её instance.json повреждён")?;
    let recovery_id = format!("{}-{}", id, uuid::Uuid::new_v4());
    let recovery_dir = deleted_instances_dir().join(&recovery_id);
    std::fs::rename(&dir, &recovery_dir).map_err(|e| format!("Не удалось переместить сборку в удалённые: {e}"))?;
    let deleted = DeletedInstance { recovery_id: recovery_id.clone(), instance, deleted_at: chrono::Utc::now().to_rfc3339(), size_bytes: directory_size(&recovery_dir) };
    std::fs::write(deleted_instance_meta_path(&recovery_id), serde_json::to_string_pretty(&deleted).map_err(|e| e.to_string())?)
        .map_err(|e| format!("Не удалось сохранить запись удалённой сборки: {e}"))
}

#[tauri::command]
pub fn list_deleted_instances(retention_minutes: Option<u64>) -> Result<Vec<DeletedInstance>, String> {
    purge_deleted_instances(retention_minutes.unwrap_or(10_080));
    let mut items = Vec::new();
    let entries = std::fs::read_dir(deleted_instances_dir()).map_err(|e| e.to_string())?;
    for entry in entries.flatten() {
        let path = entry.path();
        if !path.is_dir() { continue; }
        if let Ok(raw) = std::fs::read_to_string(path.join("deleted-instance.json")) {
            if let Ok(item) = serde_json::from_str::<DeletedInstance>(&raw) { items.push(item); }
        }
    }
    items.sort_by(|a, b| b.deleted_at.cmp(&a.deleted_at));
    Ok(items)
}

#[tauri::command]
pub fn restore_deleted_instance(recovery_id: String) -> Result<Instance, String> {
    if !safe_recovery_id(&recovery_id) { return Err("Некорректный идентификатор удалённой сборки".to_string()); }
    let metadata: DeletedInstance = serde_json::from_str(&std::fs::read_to_string(deleted_instance_meta_path(&recovery_id)).map_err(|_| "Запись удалённой сборки не найдена")?)
        .map_err(|_| "Запись удалённой сборки повреждена")?;
    let destination = instances_dir().join(&metadata.instance.id);
    if destination.exists() { return Err("Нельзя восстановить: сборка с таким идентификатором уже существует".to_string()); }
    std::fs::rename(deleted_instances_dir().join(&recovery_id), destination)
        .map_err(|e| format!("Не удалось восстановить сборку: {e}"))?;
    Ok(metadata.instance)
}

#[tauri::command]
pub fn permanently_delete_instance(recovery_id: String) -> Result<(), String> {
    if !safe_recovery_id(&recovery_id) { return Err("Некорректный идентификатор удалённой сборки".to_string()); }
    let path = deleted_instances_dir().join(&recovery_id);
    if !path.exists() { return Ok(()); }
    std::fs::remove_dir_all(path).map_err(|e| format!("Не удалось удалить сборку окончательно: {e}"))
}

/// Make sure an instance.json exists on disk for the given id.
/// Used by the frontend right before launch, in case the instance was created
/// only in the local store (e.g. when `create_instance` failed earlier or the
/// app was offline). Idempotent: if instance.json already exists it is
/// returned untouched.
#[tauri::command]
pub async fn ensure_instance(
    id: String,
    name: String,
    mc_version: String,
    loader: String,
    loader_version: Option<String>,
    min_ram: Option<u32>,
    max_ram: Option<u32>,
    java_path: Option<String>,
    custom_jvm_args: Option<String>,
    color: Option<String>,
    icon: Option<String>,
) -> Result<Instance, String> {
    if let Some(existing) = load_instance(&id) {
        return Ok(existing);
    }
    let instance = Instance {
        id: id.clone(),
        name,
        description: String::new(),
        mc_version,
        loader,
        loader_version: loader_version.unwrap_or_default(),
        min_ram: min_ram.unwrap_or(1024),
        max_ram: max_ram.unwrap_or(4096),
        java_path: java_path.unwrap_or_default(),
        custom_jvm_args: custom_jvm_args.unwrap_or_default(),
        play_time_minutes: 0,
        last_played: None,
        created_at: chrono::Utc::now().to_rfc3339(),
        icon,
        color,
        mods: vec![],
    };
    let dir = instances_dir().join(&id);
    create_instance_folders(&dir)?;
    save_instance(&instance)?;
    Ok(instance)
}

#[tauri::command]
pub async fn duplicate_instance(app: tauri::AppHandle, id: String, new_name: String) -> Result<Instance, String> {
    let src_dir = instances_dir().join(&id);
    let mut inst = load_instance(&id).ok_or("Instance not found")?;
    inst.id = uuid::Uuid::new_v4().to_string();
    inst.name = new_name.clone();
    inst.created_at = chrono::Utc::now().to_rfc3339();
    inst.last_played = None;
    inst.play_time_minutes = 0;

    app.emit("instance-progress", serde_json::json!({"stage":"cloning","name":new_name,"percent":10,"message":"Cloning instance..."})).ok();

    let dst_dir = instances_dir().join(&inst.id);
    std::fs::create_dir_all(&dst_dir).map_err(|e| e.to_string())?;
    create_instance_folders(&dst_dir)?;

    // Copy mods, config, resourcepacks, shaderpacks
    for folder in &["mods", "config", "resourcepacks", "shaderpacks", "datapacks", "schematics"] {
        let src = src_dir.join(folder);
        if src.exists() { copy_dir_all(&src, &dst_dir.join(folder)).ok(); }
    }

    app.emit("instance-progress", serde_json::json!({"stage":"saving","name":new_name,"percent":90,"message":"Saving clone..."})).ok();
    save_instance(&inst)?;
    app.emit("instance-progress", serde_json::json!({"stage":"done","name":new_name,"percent":100,"message":"Cloned!"})).ok();
    Ok(inst)
}

fn copy_dir_all(src: &PathBuf, dst: &PathBuf) -> std::io::Result<()> {
    std::fs::create_dir_all(dst)?;
    for entry in std::fs::read_dir(src)? {
        let entry = entry?;
        if entry.file_type()?.is_dir() { copy_dir_all(&entry.path(), &dst.join(entry.file_name()))?; }
        else { std::fs::copy(entry.path(), dst.join(entry.file_name()))?; }
    }
    Ok(())
}

#[tauri::command]
pub async fn open_instance_folder(id: String) -> Result<(), String> {
    let dir = instances_dir().join(&id);
    #[cfg(target_os = "windows")] crate::utils::create_hidden_command("explorer").arg(&dir).spawn().map_err(|e| e.to_string())?;
    #[cfg(target_os = "macos")] crate::utils::create_hidden_command("open").arg(&dir).spawn().map_err(|e| e.to_string())?;
    #[cfg(target_os = "linux")] crate::utils::create_hidden_command("xdg-open").arg(&dir).spawn().map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub async fn export_instance_zip(app: tauri::AppHandle, id: String, dest_path: String) -> Result<String, String> {
    let src_dir = instances_dir().join(&id);
    if !src_dir.exists() { return Err(format!("Instance {} not found", id)); }
    let inst = load_instance(&id).ok_or("Instance not found")?;

    app.emit("instance-progress", serde_json::json!({"stage":"exporting","name":inst.name,"percent":10,"message":"Packing files..."})).ok();

    let dest = if dest_path.is_empty() {
        let n = inst.name.replace(|c: char| !c.is_alphanumeric() && c != '-', "_");
        instances_dir().parent().unwrap_or(&src_dir).join(format!("{}-export.zip", n))
    } else { PathBuf::from(&dest_path) };

    let file = std::fs::File::create(&dest).map_err(|e| format!("Create zip: {e}"))?;
    let mut zip = zip::ZipWriter::new(file);
    let options = zip::write::FileOptions::<()>::default()
        .compression_method(zip::CompressionMethod::Deflated).unix_permissions(0o755);
    add_dir_to_zip(&mut zip, &src_dir, &src_dir, &options)?;
    zip.finish().map_err(|e| format!("Zip finish: {e}"))?;

    app.emit("instance-progress", serde_json::json!({"stage":"done","name":inst.name,"percent":100,"message":"Export complete!"})).ok();
    Ok(dest.to_string_lossy().to_string())
}

fn add_dir_to_zip(zip: &mut zip::ZipWriter<std::fs::File>, base: &PathBuf, dir: &PathBuf, options: &zip::write::FileOptions<()>) -> Result<(), String> {
    if let Ok(entries) = std::fs::read_dir(dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            let rel = path.strip_prefix(base).map_err(|e| e.to_string())?.to_string_lossy().replace('\\', "/");
            if path.is_dir() {
                zip.add_directory(&rel, *options).map_err(|e| e.to_string())?;
                add_dir_to_zip(zip, base, &path, options)?;
            } else {
                zip.start_file(&rel, *options).map_err(|e| e.to_string())?;
                zip.write_all(&std::fs::read(&path).map_err(|e| e.to_string())?).map_err(|e| e.to_string())?;
            }
        }
    }
    Ok(())
}

/// Adds the portable part of an instance as a Modrinth `overrides/` tree.
/// Worlds, screenshots, logs and Portal Launcher recovery folders intentionally stay local.
fn add_mrpack_overrides(
    zip: &mut zip::ZipWriter<std::fs::File>,
    base: &PathBuf,
    dir: &PathBuf,
    options: &zip::write::FileOptions<()>,
    manifest_paths: &std::collections::HashSet<String>,
) -> Result<(), String> {
    const EXCLUDED_TOP_LEVEL: &[&str] = &["saves", "screenshots", "logs", "crash-reports", "server-resource-packs", ".launcher-trash"];
    if let Ok(entries) = std::fs::read_dir(dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            let rel_path = path.strip_prefix(base).map_err(|e| e.to_string())?;
            let first = rel_path.components().next().and_then(|c| c.as_os_str().to_str()).unwrap_or("");
            if EXCLUDED_TOP_LEVEL.contains(&first) { continue; }
            let manifest_path = rel_path.to_string_lossy().replace('\\', "/");
            if manifest_paths.contains(&manifest_path) { continue; }
            let archive_path = format!("overrides/{}", rel_path.to_string_lossy().replace('\\', "/"));
            if path.is_dir() {
                zip.add_directory(&archive_path, *options).map_err(|e| e.to_string())?;
                add_mrpack_overrides(zip, base, &path, options, manifest_paths)?;
            } else {
                zip.start_file(&archive_path, *options).map_err(|e| e.to_string())?;
                zip.write_all(&std::fs::read(&path).map_err(|e| e.to_string())?).map_err(|e| e.to_string())?;
            }
        }
    }
    Ok(())
}

fn mrpack_content_path(item: &InstanceMod) -> String {
    let folder = match item.mod_type.as_str() {
        "resourcepack" => "resourcepacks",
        "shaderpack" | "shader" => "shaderpacks",
        "datapack" => "datapacks",
        _ => "mods",
    };
    let fallback = if item.file_name.trim().is_empty() { format!("{}.jar", item.id) } else { item.file_name.clone() };
    format!("{folder}/{fallback}")
}

fn add_portal_mrpack_media(zip: &mut zip::ZipWriter<std::fs::File>, src_dir: &PathBuf, options: &zip::write::FileOptions<()>) -> Result<Vec<String>, String> {
    let screenshots_dir = src_dir.join(".minecraft").join("screenshots");
    let mut screenshots = Vec::new();
    if let Ok(entries) = std::fs::read_dir(screenshots_dir) {
        for (index, entry) in entries.flatten().take(16).enumerate() {
            let path = entry.path();
            let ext = path.extension().and_then(|value| value.to_str()).unwrap_or("").to_ascii_lowercase();
            if !matches!(ext.as_str(), "png" | "jpg" | "jpeg") { continue; }
            let name = format!("portal-launcher/screenshots/{:02}.{}", index + 1, ext);
            zip.start_file(&name, *options).map_err(|e| e.to_string())?;
            zip.write_all(&std::fs::read(path).map_err(|e| e.to_string())?).map_err(|e| e.to_string())?;
            screenshots.push(name);
        }
    }
    Ok(screenshots)
}

/// Exports a portable, self-contained Modrinth Pack into Downloads by default.
/// The local files are included as `overrides/`, so Portal Launcher can import the
/// package offline and no external library or Minecraft JAR needs to be altered.
#[tauri::command]
pub async fn export_instance_mrpack(app: tauri::AppHandle, id: String, dest_path: String) -> Result<String, String> {
    let src_dir = instances_dir().join(&id);
    if !src_dir.exists() { return Err(format!("Instance {} not found", id)); }
    let inst = load_instance(&id).ok_or("Instance not found")?;
    app.emit("instance-progress", serde_json::json!({"stage":"exporting","name":inst.name,"percent":10,"message":"Creating Modrinth Pack..."})).ok();

    let safe_name = inst.name.replace(|c: char| !c.is_alphanumeric() && c != '-' && c != '_', "_");
    let default_downloads = dirs_next::download_dir()
        .or_else(|| dirs_next::home_dir().map(|home| home.join("Downloads")))
        .ok_or("Unable to find the Downloads folder")?;
    let requested = if dest_path.trim().is_empty() { default_downloads } else { PathBuf::from(dest_path.trim()) };
    let dest = if requested.extension().and_then(|value| value.to_str()).map(|value| value.eq_ignore_ascii_case("mrpack")).unwrap_or(false) {
        requested
    } else {
        requested.join(format!("{}.mrpack", safe_name))
    };
    if let Some(parent) = dest.parent() { std::fs::create_dir_all(parent).map_err(|e| format!("Create export folder: {e}"))?; }

    let mut dependencies = serde_json::Map::new();
    dependencies.insert("minecraft".to_string(), serde_json::Value::String(inst.mc_version.clone()));
    match inst.loader.as_str() {
        "fabric" => { dependencies.insert("fabric-loader".to_string(), serde_json::Value::String(inst.loader_version.clone())); }
        "quilt" => { dependencies.insert("quilt-loader".to_string(), serde_json::Value::String(inst.loader_version.clone())); }
        "forge" => { dependencies.insert("forge".to_string(), serde_json::Value::String(inst.loader_version.clone())); }
        "neoforge" => { dependencies.insert("neoforge".to_string(), serde_json::Value::String(inst.loader_version.clone())); }
        _ => {}
    }
    let minecraft_dir = src_dir.join(".minecraft");
    let mut manifest_paths = std::collections::HashSet::new();
    let mut manifest_files = Vec::new();
    for item in &inst.mods {
        let content_path = mrpack_content_path(item);
        let disk_path = minecraft_dir.join(&content_path);
        if !item.enabled || !item.source.eq_ignore_ascii_case("modrinth") || item.id.trim().is_empty() || item.version_id.trim().is_empty() || !disk_path.exists() { continue; }
        let bytes = std::fs::read(&disk_path).map_err(|e| format!("Read {}: {e}", content_path))?;
        let hash = format!("{:x}", Sha512::digest(&bytes));
        let encoded_id = urlencoding::encode(&item.id);
        let encoded_version = urlencoding::encode(&item.version_id);
        let encoded_file = urlencoding::encode(disk_path.file_name().and_then(|value| value.to_str()).unwrap_or("mod.jar"));
        manifest_files.push(serde_json::json!({
            "path": content_path,
            "hashes": { "sha512": hash },
            "downloads": [format!("https://cdn.modrinth.com/data/{encoded_id}/versions/{encoded_version}/{encoded_file}")],
            "fileSize": bytes.len(),
            "env": { "client": "required", "server": "unsupported" }
        }));
        manifest_paths.insert(content_path);
    }
    let manifest = serde_json::json!({
        "formatVersion": 1,
        "game": "minecraft",
        "versionId": "1.0.0",
        "name": inst.name,
        "summary": inst.description,
        "files": manifest_files,
        "dependencies": dependencies,
    });

    let file = std::fs::File::create(&dest).map_err(|e| format!("Create .mrpack: {e}"))?;
    let mut zip = zip::ZipWriter::new(file);
    let options = zip::write::FileOptions::<()>::default().compression_method(zip::CompressionMethod::Deflated).unix_permissions(0o755);
    zip.start_file("modrinth.index.json", options).map_err(|e| e.to_string())?;
    zip.write_all(serde_json::to_string_pretty(&manifest).map_err(|e| e.to_string())?.as_bytes()).map_err(|e| e.to_string())?;
    let icon = src_dir.join("icon.png");
    if icon.exists() {
        zip.start_file("icon.png", options).map_err(|e| e.to_string())?;
        zip.write_all(&std::fs::read(&icon).map_err(|e| e.to_string())?).map_err(|e| e.to_string())?;
        zip.start_file("portal-launcher/icon.png", options).map_err(|e| e.to_string())?;
        zip.write_all(&std::fs::read(src_dir.join("icon.png")).map_err(|e| e.to_string())?).map_err(|e| e.to_string())?;
    }
    if minecraft_dir.exists() { add_mrpack_overrides(&mut zip, &minecraft_dir, &minecraft_dir, &options, &manifest_paths)?; }
    let screenshots = add_portal_mrpack_media(&mut zip, &src_dir, &options)?;
    let portal_metadata = serde_json::json!({
        "format": 1,
        "description": inst.description,
        "color": inst.color.clone(),
        "minRam": inst.min_ram,
        "maxRam": inst.max_ram,
        "javaPath": inst.java_path,
        "customJvmArgs": inst.custom_jvm_args,
        "icon": if icon.exists() { Some("portal-launcher/icon.png") } else { None::<&str> },
        "screenshots": screenshots,
        "mods": &inst.mods,
    });
    zip.start_file("portal-launcher/instance.json", options).map_err(|e| e.to_string())?;
    zip.write_all(serde_json::to_string_pretty(&portal_metadata).map_err(|e| e.to_string())?.as_bytes()).map_err(|e| e.to_string())?;
    zip.finish().map_err(|e| format!("Finish .mrpack: {e}"))?;
    app.emit("instance-progress", serde_json::json!({"stage":"done","name":inst.name,"percent":100,"message":"Modrinth Pack exported"})).ok();
    Ok(dest.to_string_lossy().to_string())
}

/// Normalizes common launcher/archive layouts into the data directory Portal Launcher actually launches: `<instance>/.minecraft`.
/// Generic ZIPs often contain `mods/`, `config/` and `resourcepacks/` at archive root or inside one wrapper folder.
fn normalize_imported_game_dir(instance_dir: &Path) -> Result<(), String> {
    let game_dir = instance_dir.join(".minecraft");
    std::fs::create_dir_all(&game_dir).map_err(|e| e.to_string())?;
    let content_names = ["mods", "config", "resourcepacks", "shaderpacks", "datapacks", "saves", "scripts", "kubejs", "defaultconfigs", "options.txt", "servers.dat"];

    // First take known folders/files from archive root.
    for name in content_names {
        let source = instance_dir.join(name);
        if source.exists() {
            let target = game_dir.join(name);
            if target.exists() {
                if source.is_dir() {
                    for entry in std::fs::read_dir(&source).map_err(|e| e.to_string())?.flatten() {
                        let child = entry.path();
                        let target_child = target.join(entry.file_name());
                        if !target_child.exists() { std::fs::rename(child, target_child).map_err(|e| e.to_string())?; }
                    }
                    let _ = std::fs::remove_dir_all(source);
                }
            } else {
                std::fs::rename(source, target).map_err(|e| e.to_string())?;
            }
        }
    }

    // Multi-launcher exports sometimes wrap the game data in a single top-level directory.
    let wrappers: Vec<PathBuf> = std::fs::read_dir(instance_dir).ok().into_iter().flatten()
        .flatten().map(|entry| entry.path())
        .filter(|path| path.is_dir() && path.file_name().map(|n| n != ".minecraft").unwrap_or(false))
        .collect();
    if wrappers.len() == 1 {
        let wrapper = &wrappers[0];
        if content_names.iter().any(|name| wrapper.join(name).exists()) {
            for name in content_names {
                let source = wrapper.join(name);
                if !source.exists() { continue; }
                let target = game_dir.join(name);
                if !target.exists() { std::fs::rename(source, target).map_err(|e| e.to_string())?; }
            }
            let _ = std::fs::remove_dir_all(wrapper);
        }
    }
    Ok(())
}

#[tauri::command]
pub async fn import_instance_zip(app: tauri::AppHandle, zip_path: String, new_name: Option<String>, excluded_paths: Option<Vec<String>>) -> Result<Instance, String> {
    app.emit("instance-progress", serde_json::json!({"stage":"importing","name":new_name.clone().unwrap_or("Instance".into()),"percent":10,"message":"Reading ZIP..."})).ok();
    let zip_file = std::fs::File::open(&zip_path).map_err(|e| format!("Open zip: {e}"))?;
    let mut archive = zip::ZipArchive::new(zip_file).map_err(|e| format!("Read zip: {e}"))?;

    // ── CurseForge modpack (manifest.json), не наш собственный экспорт ─────────
    // Раньше .zip без "instance.json" сразу проваливался с "No instance.json",
    // потому что настоящие CurseForge-модпаки (manifest.json + overrides/)
    // никогда instance.json не содержат — они просто не были поддержаны.
    let has_manifest = (0..archive.len())
        .filter_map(|i| archive.by_index(i).ok().map(|e| e.name().to_string()))
        .any(|n| n == "manifest.json");
    if has_manifest {
        return import_curseforge_modpack_from_archive(app, archive, new_name, excluded_paths.unwrap_or_default()).await;
    }

    let new_id = uuid::Uuid::new_v4().to_string();
    let dest_dir = instances_dir().join(&new_id);
    std::fs::create_dir_all(&dest_dir).map_err(|e| e.to_string())?;
    let total = archive.len();
    for i in 0..total {
        let mut entry = archive.by_index(i).map_err(|e| e.to_string())?;
        let outpath = dest_dir.join(entry.name());
        if entry.is_dir() { std::fs::create_dir_all(&outpath).ok(); }
        else {
            if let Some(p) = outpath.parent() { std::fs::create_dir_all(p).ok(); }
            let mut outf = std::fs::File::create(&outpath).map_err(|e| e.to_string())?;
            std::io::copy(&mut entry, &mut outf).map_err(|e| e.to_string())?;
        }
        if i % 20 == 0 {
            let pct = 10 + (i as u64 * 80) / total.max(1) as u64;
            app.emit("instance-progress", serde_json::json!({"stage":"extracting","name":"Instance","percent":pct,"message":format!("Extracting {}/{}", i, total)})).ok();
        }
    }
    normalize_imported_game_dir(&dest_dir)?;
    let json_path = dest_dir.join("instance.json");
    let archive_name = Path::new(&zip_path).file_stem().and_then(|v| v.to_str()).unwrap_or("Imported instance").to_string();
    let mut instance: Instance = if json_path.exists() {
        serde_json::from_str(&std::fs::read_to_string(&json_path).map_err(|e| e.to_string())?).map_err(|e| e.to_string())?
    } else {
        // A regular content archive is still a useful instance. The player can
        // select its exact Minecraft/loader version in Instance Settings later.
        Instance {
            id: new_id.clone(), name: new_name.clone().unwrap_or(archive_name),
            description: "Imported archive".to_string(), mc_version: "1.20.1".to_string(),
            loader: "vanilla".to_string(), loader_version: String::new(), min_ram: 1024, max_ram: 4096,
            java_path: String::new(), custom_jvm_args: String::new(), play_time_minutes: 0,
            last_played: None, created_at: chrono::Utc::now().to_rfc3339(), icon: None, color: None, mods: vec![],
        }
    };
    instance.id = new_id;
    if let Some(name) = new_name { instance.name = name; }
    instance.last_played = None;
    instance.play_time_minutes = 0;
    create_instance_folders(&dest_dir)?;
    save_instance(&instance)?;
    app.emit("instance-progress", serde_json::json!({"stage":"done","name":instance.name,"percent":100,"message":"Import complete!"})).ok();
    Ok(instance)
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct ModpackPreviewEntry {
    pub path: String,
    pub name: String,
    pub version: String,
    pub author: String,
    pub author_url: Option<String>,
    pub author_avatar_url: Option<String>,
    pub icon_url: Option<String>,
    pub required: bool,
    pub kind: String,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct ModpackPreview {
    pub name: String,
    pub version_id: String,
    pub minecraft_version: String,
    pub loader: String,
    pub source: String,
    pub author: Option<String>,
    pub author_url: Option<String>,
    pub author_avatar_url: Option<String>,
    pub icon_url: Option<String>,
    pub entries: Vec<ModpackPreviewEntry>,
}

fn modrinth_ids_from_download(url: &str) -> Option<(String, String)> {
    // CDN URL: https://cdn.modrinth.com/data/<project-id>/versions/<version-id>/<file>
    let parts: Vec<&str> = url.split('/').collect();
    let data = parts.iter().position(|part| *part == "data")?;
    let versions = parts.iter().position(|part| *part == "versions")?;
    Some((parts.get(data + 1)?.to_string(), parts.get(versions + 1)?.to_string()))
}

async fn hydrate_modrinth_instance_mods(client: &reqwest::Client, mods: &mut [InstanceMod]) {
    let lookup: Vec<(usize, String, String)> = mods.iter().enumerate()
        .filter(|(_, item)| item.source.eq_ignore_ascii_case("modrinth") && !item.version_id.trim().is_empty())
        .map(|(index, item)| (index, item.id.clone(), item.version_id.clone()))
        .collect();

    for chunk in lookup.chunks(6) {
        let results = futures::future::join_all(chunk.iter().map(|(index, project_id, version_id)| {
            let client = client.clone();
            let project_id = project_id.clone();
            let version_id = version_id.clone();
            let index = *index;
            async move {
                let project = match client.get(format!("https://api.modrinth.com/v2/project/{project_id}")).send().await {
                    Ok(response) => match response.error_for_status() { Ok(response) => response.json::<serde_json::Value>().await.ok(), Err(_) => None },
                    Err(_) => None,
                };
                let version = match client.get(format!("https://api.modrinth.com/v2/version/{version_id}")).send().await {
                    Ok(response) => match response.error_for_status() { Ok(response) => response.json::<serde_json::Value>().await.ok(), Err(_) => None },
                    Err(_) => None,
                };
                let author = if let Some(team_id) = project.as_ref().and_then(|value| value["team"].as_str()) {
                    match client.get(format!("https://api.modrinth.com/v2/team/{team_id}/members")).send().await {
                        Ok(response) => match response.error_for_status() {
                            Ok(response) => response.json::<serde_json::Value>().await.ok().and_then(|members| members.as_array().and_then(|people| people.iter().find(|person| person["role"].as_str() == Some("Owner")).or_else(|| people.first())).and_then(|member| member["user"]["username"].as_str().map(String::from))),
                            Err(_) => None,
                        },
                        Err(_) => None,
                    }
                } else { None };
                (index, project, version, author)
            }
        })).await;
        for (index, project, version, author) in results {
            let Some(item) = mods.get_mut(index) else { continue; };
            if let Some(project) = project {
                if let Some(title) = project["title"].as_str().filter(|value| !value.trim().is_empty()) { item.name = title.to_string(); }
                if let Some(icon) = project["icon_url"].as_str().filter(|value| !value.trim().is_empty()) { item.icon_url = Some(icon.to_string()); }
            }
            if let Some(author) = author { item.author = Some(author); }
            if let Some(version) = version {
                if let Some(number) = version["version_number"].as_str().filter(|value| !value.trim().is_empty()) { item.version = number.to_string(); }
            }
        }
    }
}

async fn resolve_modrinth_pack_icon_url(client: &reqwest::Client, version_id: &str) -> Option<String> {
    if version_id.trim().is_empty() { return None; }
    tokio::time::timeout(std::time::Duration::from_secs(6), async {
        let version = client.get(format!("https://api.modrinth.com/v2/version/{version_id}"))
            .send().await.ok()?.error_for_status().ok()?.json::<serde_json::Value>().await.ok()?;
        let project_id = version["project_id"].as_str()?;
        let project = client.get(format!("https://api.modrinth.com/v2/project/{project_id}"))
            .send().await.ok()?.error_for_status().ok()?.json::<serde_json::Value>().await.ok()?;
        project["icon_url"].as_str().filter(|url| !url.trim().is_empty()).map(String::from)
    }).await.ok().flatten()
}

/// Reads a Modrinth pack before installation. The archive is downloaded only once;
/// nothing is created in the instances directory until the user confirms installation.
#[tauri::command]
pub async fn preview_remote_modpack(
    download_url: String,
    file_name: String,
    source: String,
    api_key: Option<String>,
    project_name: Option<String>,
    project_author: Option<String>,
    project_author_url: Option<String>,
    project_author_avatar_url: Option<String>,
    project_icon_url: Option<String>,
) -> Result<ModpackPreview, String> {
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(120))
        .user_agent("PortalLauncher/1.3")
        .build().map_err(|e| e.to_string())?;
    let bytes = if download_url.starts_with("data:") {
        let encoded = download_url.split_once(',').map(|(_, value)| value).ok_or("Invalid local archive data URL")?;
        use base64::Engine as _;
        base64::engine::general_purpose::STANDARD.decode(encoded)
            .map_err(|e| format!("Read local pack preview: {e}"))?
    } else if Path::new(&download_url).is_file() {
        std::fs::read(&download_url).map_err(|e| format!("Read local pack preview: {e}"))?
    } else if !download_url.contains("://") {
        return Err("Локальный путь к выбранному архиву недоступен. Выберите .mrpack через системное окно ещё раз.".to_string());
    } else {
        client.get(&download_url).send().await
            .map_err(|e| format!("Download pack preview: {e}"))?
            .bytes().await.map_err(|e| format!("Read pack preview: {e}"))?
            .to_vec()
    };
    let mut archive = zip::ZipArchive::new(std::io::Cursor::new(bytes))
        .map_err(|e| format!("Не удалось открыть {file_name} как полный ZIP-архив: {e}"))?;

    let is_modrinth = source.eq_ignore_ascii_case("modrinth") || file_name.to_lowercase().ends_with(".mrpack");
    let index_data = {
        let manifest_name = if is_modrinth { "modrinth.index.json" } else { "manifest.json" };
        let archive_manifest_name = if is_modrinth {
            (0..archive.len())
                .filter_map(|index| archive.by_index(index).ok().map(|entry| entry.name().replace('\\', "/")))
                .find(|name| name == manifest_name || name.ends_with(&format!("/{manifest_name}")))
                .unwrap_or_else(|| manifest_name.to_string())
        } else { manifest_name.to_string() };
        let mut file = archive.by_name(&archive_manifest_name)
            .map_err(|_| format!("В этом архиве не найден {manifest_name}"))?;
        let mut text = String::new();
        file.read_to_string(&mut text).map_err(|e| e.to_string())?;
        text
    };
    let index: serde_json::Value = serde_json::from_str(&index_data)
        .map_err(|e| format!("Read modrinth.index.json: {e}"))?;
    let pack_name = project_name.filter(|value| !value.trim().is_empty()).unwrap_or_else(|| index["name"].as_str().unwrap_or(if is_modrinth { "Modrinth Pack" } else { "CurseForge Pack" }).to_string());
    let mc_version = if is_modrinth {
        index["dependencies"]["minecraft"].as_str().unwrap_or("Unknown").to_string()
    } else {
        index["minecraft"]["version"].as_str().unwrap_or("Unknown").to_string()
    };
    let loader = if is_modrinth {
        ["fabric", "forge", "neoforge", "quilt"].iter().find(|loader| index["dependencies"].get(**loader).is_some()).map(|loader| loader.to_string()).unwrap_or_else(|| "vanilla".to_string())
    } else {
        index["minecraft"]["modLoaders"].as_array().and_then(|items| items.first()).and_then(|item| item["id"].as_str()).map(|id| id.split('-').next().unwrap_or(id).to_string()).unwrap_or_else(|| "vanilla".to_string())
    };

    let mut entries: Vec<ModpackPreviewEntry> = Vec::new();
    let mut modrinth_lookup: Vec<(usize, String, String)> = Vec::new();
    let mut curseforge_lookup: Vec<(usize, i64)> = Vec::new();
    let manifest_files = index["files"].as_array().cloned().unwrap_or_default();
    for file in manifest_files {
        let path = if is_modrinth {
            file["path"].as_str().unwrap_or("").to_string()
        } else {
            format!("mods/curseforge-{}.jar", file["fileID"].as_i64().unwrap_or(0))
        };
        let required = file["env"]["client"].as_str().map(|v| v != "unsupported").unwrap_or(true);
        let kind = if path.starts_with("resourcepacks/") { "resourcepack" }
            else if path.starts_with("shaderpacks/") { "shaderpack" }
            else if path.starts_with("datapacks/") { "datapack" }
            else { "mod" }.to_string();
        let url = file["downloads"].as_array().and_then(|urls| urls.first()).and_then(|v| v.as_str()).unwrap_or("");
        let fallback = path.rsplit('/').next().unwrap_or("Unknown file").trim_end_matches(".jar").trim_end_matches(".zip").to_string();
        let index = entries.len();
        entries.push(ModpackPreviewEntry {
            path, name: fallback, version: "—".to_string(), author: "Loading metadata…".to_string(),
            author_url: None, author_avatar_url: None, icon_url: None, required, kind,
        });
        if is_modrinth {
            if let Some((project_id, version_id)) = modrinth_ids_from_download(url) {
                modrinth_lookup.push((index, project_id, version_id));
            }
        } else if file["projectID"].as_i64().is_some() {
            curseforge_lookup.push((index, file["projectID"].as_i64().unwrap_or_default()));
        }
    }

    if is_modrinth {
        modrinth_lookup.sort_by(|a, b| (a.1.as_str(), a.2.as_str()).cmp(&(b.1.as_str(), b.2.as_str())));
        modrinth_lookup.dedup_by(|a, b| a.1 == b.1 && a.2 == b.2);
        for chunk in modrinth_lookup.chunks(8) {
            let results = futures::future::join_all(chunk.iter().map(|(index, project_id, version_id)| {
                let client = client.clone();
                let index = *index;
                let project_id = project_id.clone();
                let version_id = version_id.clone();
                async move {
                    let mut name = None;
                    let mut author = None;
                    let mut author_url = None;
                    let mut author_avatar_url = None;
                    let mut icon_url = None;
                    let mut version = None;
                    if let Ok(response) = client.get(format!("https://api.modrinth.com/v2/project/{project_id}")).send().await {
                        if let Ok(response) = response.error_for_status() {
                            if let Ok(project) = response.json::<serde_json::Value>().await {
                                name = project["title"].as_str().map(String::from);
                                icon_url = project["icon_url"].as_str().map(String::from);
                                if let Some(team_id) = project["team"].as_str() {
                                    if let Ok(response) = client.get(format!("https://api.modrinth.com/v2/team/{team_id}/members")).send().await {
                                        if let Ok(response) = response.error_for_status() {
                                            if let Ok(members) = response.json::<serde_json::Value>().await {
                                                if let Some(member) = members.as_array().and_then(|members| members.iter().find(|member| member["role"].as_str() == Some("Owner")).or_else(|| members.first())) {
                                                    author = member["user"]["username"].as_str().map(String::from);
                                                    author_url = author.as_ref().map(|name| format!("https://modrinth.com/user/{}", urlencoding::encode(name)));
                                                    author_avatar_url = member["user"]["avatar_url"].as_str().map(String::from);
                                                }
                                            }
                                        }
                                    }
                                }
                            }
                        }
                    }
                    if let Ok(response) = client.get(format!("https://api.modrinth.com/v2/version/{version_id}")).send().await {
                        if let Ok(response) = response.error_for_status() {
                            if let Ok(version_data) = response.json::<serde_json::Value>().await {
                                version = version_data["version_number"].as_str().map(String::from);
                            }
                        }
                    }
                    (index, name, version, author, author_url, author_avatar_url, icon_url)
                }
            })).await;
            for (index, name, version, author, author_url, author_avatar_url, icon_url) in results {
                if let Some(entry) = entries.get_mut(index) {
                    if let Some(value) = name { entry.name = value; }
                    if let Some(value) = version { entry.version = value; }
                    if let Some(value) = author { entry.author = value; }
                    entry.author_url = author_url;
                    entry.author_avatar_url = author_avatar_url;
                    entry.icon_url = icon_url;
                }
            }
        }
    } else if let Some(key) = api_key.as_deref() {
        for chunk in curseforge_lookup.chunks(8) {
            let results = futures::future::join_all(chunk.iter().map(|(index, project_id)| {
                let client = client.clone();
                let key = key.to_string();
                let index = *index;
                let project_id = *project_id;
                async move {
                    let mut data_result = None;
                    if let Ok(response) = client.get(format!("https://api.curseforge.com/v1/mods/{project_id}")).header("x-api-key", key).send().await {
                        if let Ok(response) = response.error_for_status() {
                            data_result = response.json::<serde_json::Value>().await.ok();
                        }
                    }
                    (index, data_result)
                }
            })).await;
            for (index, data) in results {
                if let Some(project) = data.as_ref().map(|value| &value["data"]) {
                    if let Some(entry) = entries.get_mut(index) {
                        if let Some(value) = project["name"].as_str() { entry.name = value.to_string(); }
                        if let Some(author) = project["authors"].as_array().and_then(|a| a.first()) {
                            if let Some(value) = author["name"].as_str() { entry.author = value.to_string(); }
                            entry.author_url = author["url"].as_str().map(String::from).or_else(|| {
                                let name = entry.author.trim();
                                if name.is_empty() || name == "Loading metadata…" { None } else { Some(format!("https://www.curseforge.com/members/{}", urlencoding::encode(name))) }
                            });
                            entry.author_avatar_url = author["avatarUrl"].as_str().map(String::from);
                        }
                        entry.icon_url = project["logo"]["thumbnailUrl"].as_str().map(String::from);
                        entry.kind = match project["classId"].as_i64().unwrap_or(6) { 12 => "resourcepack", 6552 => "shaderpack", 5820 => "datapack", _ => "mod" }.to_string();
                    }
                }
            }
        }
    }

    Ok(ModpackPreview { name: pack_name, version_id: index["versionId"].as_str().or_else(|| index["version"].as_str()).unwrap_or("").to_string(), minecraft_version: mc_version, loader, source: if is_modrinth { "modrinth" } else { "curseforge" }.to_string(), author: project_author, author_url: project_author_url, author_avatar_url: project_author_avatar_url, icon_url: project_icon_url, entries })
}

#[tauri::command]
pub async fn import_modrinth_pack(app: tauri::AppHandle, mrpack_path: String, excluded_paths: Option<Vec<String>>) -> Result<Instance, String> {
    let client = reqwest::Client::builder().timeout(std::time::Duration::from_secs(300)).user_agent("PortalLauncher/1.3").build().map_err(|e| e.to_string())?;
    let file = std::fs::File::open(&mrpack_path).map_err(|e| format!("Open: {e}"))?;
    // ZipArchive читает центральный каталог, поэтому это единственный
    // корректный валидатор: он поддерживает допустимые ZIP-варианты, которые
    // нельзя надёжно определить только по первым двум байтам.
    let mut archive = zip::ZipArchive::new(file).map_err(|e| format!("Не удалось открыть .mrpack как ZIP-архив: {e}"))?;

    let index_data = {
        let index_name = (0..archive.len())
            .filter_map(|i| archive.by_index(i).ok().map(|entry| entry.name().replace('\\', "/")))
            .find(|name| name == "modrinth.index.json" || name.ends_with("/modrinth.index.json"));
        let Some(index_name) = index_name else {
            return Err("В этом .mrpack не найден modrinth.index.json. Это не Modrinth Pack либо архив создан неполностью.".to_string());
        };
        let mut f = archive.by_name(&index_name).map_err(|e| format!("Не удалось открыть modrinth.index.json: {e}"))?;
        let mut s = String::new(); f.read_to_string(&mut s).map_err(|e| e.to_string())?; s
    };
    let index: serde_json::Value = serde_json::from_str(&index_data).map_err(|e| format!("modrinth.index.json повреждён: {e}"))?;
    let portal_metadata: serde_json::Value = archive.by_name("portal-launcher/instance.json")
        .ok()
        .and_then(|mut file| {
            let mut text = String::new();
            file.read_to_string(&mut text).ok()?;
            serde_json::from_str(&text).ok()
        })
        .unwrap_or(serde_json::Value::Null);
    let portal_mods: Vec<InstanceMod> = serde_json::from_value(portal_metadata["mods"].clone()).unwrap_or_default();
    let pack_name = index["name"].as_str().unwrap_or("Modrinth Pack").to_string();
    app.emit("instance-progress", serde_json::json!({"stage":"importing","name":pack_name,"percent":5,"message":"Reading pack manifest..."})).ok();

    let mc_version = index["dependencies"]["minecraft"].as_str().unwrap_or("1.20.1").to_string();
    let (loader, loader_version) = if index["dependencies"]["fabric-loader"].is_string() {
        ("fabric", index["dependencies"]["fabric-loader"].as_str().unwrap_or(""))
    } else if index["dependencies"]["quilt-loader"].is_string() {
        ("quilt", index["dependencies"]["quilt-loader"].as_str().unwrap_or(""))
    } else if index["dependencies"]["neoforge"].is_string() {
        ("neoforge", index["dependencies"]["neoforge"].as_str().unwrap_or(""))
    } else if index["dependencies"]["forge"].is_string() {
        ("forge", index["dependencies"]["forge"].as_str().unwrap_or(""))
    } else { ("vanilla", "") };

    let source_hash = format!("{:x}", Sha256::digest(mrpack_path.as_bytes()));
    let new_id = format!("import-{}", &source_hash[..16]);
    clear_cancel(&new_id);
    let dest_dir = instances_dir().join(&new_id);
    create_instance_folders(&dest_dir)?;

    // The actual game files live inside .minecraft/ (MultiMC / Modrinth convention).
    let mc_dir = dest_dir.join(".minecraft");

    // ── Pack icon ──────────────────────────────────────────────────────────────
    // Try common icon filenames inside the mrpack archive.
    let mut icon_b64: Option<String> = {
        let mut found: Option<String> = None;
        for candidate in &["portal-launcher/icon.png", "icon.png", "pack.png", "icon.jpg"] {
            if let Ok(mut f) = archive.by_name(candidate) {
                let mut buf = vec![];
                std::io::Read::read_to_end(&mut f, &mut buf).ok();
                if !buf.is_empty() {
                    use base64::Engine as _;
                    let encoded = base64::engine::general_purpose::STANDARD.encode(&buf);
                    let mime = if candidate.ends_with(".jpg") { "image/jpeg" } else { "image/png" };
                    found = Some(format!("data:{};base64,{}", mime, encoded));
                    break;
                }
            }
        }
        found
    };
    // Standard Modrinth .mrpack archives normally do not embed their cover.
    // Resolve it with a short timeout and never make metadata block the install.
    if icon_b64.is_none() {
        let pack_version_id = index["versionId"].as_str().or_else(|| index["version_id"].as_str()).unwrap_or("");
        icon_b64 = resolve_modrinth_pack_icon_url(&client, pack_version_id).await;
    }
    // Save icon to disk as well so it persists between sessions
    if let Some(ref b64) = icon_b64 {
        let icon_path = dest_dir.join("icon.png");
        if let Some(data_part) = b64.split(',').nth(1) {
            use base64::Engine as _;
            if let Ok(bytes) = base64::engine::general_purpose::STANDARD.decode(data_part) {
                std::fs::write(&icon_path, bytes).ok();
            }
        }
    }

    // ── Extract overrides into .minecraft/ ────────────────────────────────────
    app.emit("instance-progress", serde_json::json!({"stage":"extracting","instance_id":new_id,"name":pack_name,"icon":icon_b64.as_deref(),"percent":15,"message":"Extracting overrides..."})).ok();
    let override_names: Vec<String> = (0..archive.len())
        .filter_map(|i| archive.by_index(i).ok().map(|e| e.name().to_string()))
        .filter(|n| (n.starts_with("overrides/") || n.starts_with("client-overrides/")) && !n.ends_with('/'))
        .collect();
    for name in &override_names {
        let mut entry = archive.by_name(name).map_err(|e| e.to_string())?;
        let strip = if name.starts_with("client-overrides/") { "client-overrides/".len() } else { "overrides/".len() };
        let rel = &name[strip..];
        // Overrides go into .minecraft/ (matches Modrinth Launcher behaviour)
        let out = mc_dir.join(rel);
        if let Some(p) = out.parent() { std::fs::create_dir_all(p).ok(); }
        let mut outf = std::fs::File::create(&out).map_err(|e| e.to_string())?;
        std::io::copy(&mut entry, &mut outf).map_err(|e| e.to_string())?;
    }

    let portal_screenshots = portal_metadata["screenshots"].as_array().cloned().unwrap_or_default();
    for (index, path) in portal_screenshots.iter().filter_map(|value| value.as_str()).filter(|path| path.starts_with("portal-launcher/screenshots/") && !path.contains("..")).take(16).enumerate() {
        if let Ok(mut entry) = archive.by_name(path) {
            let extension = Path::new(path).extension().and_then(|value| value.to_str()).unwrap_or("png");
            let target = mc_dir.join("screenshots").join(format!("pack-{:02}.{extension}", index + 1));
            if let Some(parent) = target.parent() { std::fs::create_dir_all(parent).ok(); }
            if let Ok(mut output) = std::fs::File::create(target) { let _ = std::io::copy(&mut entry, &mut output); }
        }
    }

    // ── Download files (mods, resource-packs, etc.) into .minecraft/ ──────────
    let files = index["files"].as_array().cloned().unwrap_or_default();
    let excluded_paths: std::collections::HashSet<String> = excluded_paths.unwrap_or_default().into_iter().collect();
    let total_files = files.len();
    app.emit("instance-progress", serde_json::json!({"stage":"downloading","instance_id":new_id,"name":pack_name,"percent":30,"message":format!("Downloading {} files...", total_files)})).ok();
    let mut mods = vec![];
    let mut failed = 0usize;
    let mut downloaded = 0usize;
    for (i, file_entry) in files.iter().enumerate() {
        if cancel_requested(&new_id) {
            clear_cancel(&new_id);
            app.emit("instance-progress", serde_json::json!({"stage":"cancelled","instance_id":new_id,"name":pack_name,"percent":0,"message":"Installation cancelled"})).ok();
            return Err("Pack installation cancelled".to_string());
        }
        let path = file_entry["path"].as_str().unwrap_or("");
        if excluded_paths.contains(path) { continue; }
        let urls: Vec<&str> = file_entry["downloads"].as_array()
            .map(|a| a.iter().filter_map(|u| u.as_str()).collect())
            .unwrap_or_default();
        if urls.is_empty() || path.is_empty() { continue; }
        // All paths in modrinth.index.json are relative to .minecraft/
        let out_path = mc_dir.join(path);
        if let Some(p) = out_path.parent() { std::fs::create_dir_all(p).ok(); }

        // Пробуем все зеркала по очереди — раньше бралось только первое,
        // и если конкретно оно было недоступно, файл молча пропускался.
        let mut got = out_path.is_file() && std::fs::metadata(&out_path).map(|meta| meta.len() > 0).unwrap_or(false);
        if got { downloaded += 1; }
        if !got {
            for url in &urls {
                match (async { client.get(*url).send().await?.error_for_status()?.bytes().await }).await {
                    Ok(bytes) => {
                        std::fs::write(&out_path, &bytes).map_err(|e| format!("Не удалось сохранить {path}: {e}"))?;
                        got = true;
                        downloaded += 1;
                        break;
                    }
                    Err(e) => log::warn!("mrpack: зеркало не сработало ({url}): {e}"),
                }
            }
        }
        if !got { failed += 1; log::warn!("mrpack: не удалось скачать {path} — все зеркала недоступны"); }
        else if ["mods/", "resourcepacks/", "shaderpacks/", "datapacks/"].iter().any(|prefix| path.starts_with(prefix)) {
            let fname = out_path.file_name().unwrap_or_default().to_string_lossy().to_string();
            let metadata = urls.first().and_then(|url| modrinth_ids_from_download(url));
            let project_id = metadata.as_ref().map(|(project, _)| project.clone()).unwrap_or_else(|| fname.clone());
            let version_id = metadata.as_ref().map(|(_, version)| version.clone()).unwrap_or_default();
            mods.push(InstanceMod {
                id: project_id.clone(),
                name: fname.trim_end_matches(".jar").trim_end_matches(".zip").to_string(),
                version: "—".to_string(),
                version_id,
                source: "modrinth".to_string(),
                enabled: true,
                file_name: fname.clone(),
                mod_type: if path.starts_with("resourcepacks/") { "resourcepack" } else if path.starts_with("shaderpacks/") { "shaderpack" } else if path.starts_with("datapacks/") { "datapack" } else { "mod" }.to_string(),
                author: None,
                icon_url: metadata.map(|(project, _)| format!("https://cdn.modrinth.com/data/{project}/icon.png")),
            });
        }
        let pct = 30 + (i as u64 * 65) / total_files.max(1) as u64;
        app.emit("instance-progress", serde_json::json!({"stage":"downloading","instance_id":new_id,"name":pack_name,"icon":icon_b64.as_deref(),"percent":pct,"message":format!("Downloaded {}/{}", i+1, total_files)})).ok();
    }

    // Пакет может состоять только из resourcepacks, shaders или datapacks.
    // Отсутствие JAR-модов не означает неудачный импорт, если файлы скачались.
    if downloaded == 0 && total_files > 0 {
        return Err(format!(
            "Не удалось скачать ни одного файла ({failed} из {total_files} не удались). Проверьте подключение к интернету."
        ));
    }

    let restored_mods: Vec<InstanceMod> = portal_mods.into_iter().filter(|item| !excluded_paths.contains(&mrpack_content_path(item))).collect();
    let instance = Instance {
        id: new_id, name: pack_name, description: portal_metadata["description"].as_str().unwrap_or("Imported from Modrinth Pack").to_string(),
        mc_version, loader: loader.to_string(), loader_version: loader_version.to_string(),
        min_ram: portal_metadata["minRam"].as_u64().unwrap_or(2048) as u32, max_ram: portal_metadata["maxRam"].as_u64().unwrap_or(6144) as u32, java_path: portal_metadata["javaPath"].as_str().unwrap_or("").to_string(), custom_jvm_args: portal_metadata["customJvmArgs"].as_str().unwrap_or("").to_string(),
        play_time_minutes: 0, last_played: None, created_at: chrono::Utc::now().to_rfc3339(),
        icon: icon_b64, color: portal_metadata["color"].as_str().map(String::from).or_else(|| Some("#6C5CE7".to_string())), mods: if restored_mods.is_empty() { mods } else { restored_mods },
    };
    save_instance(&instance)?;
    clear_cancel(&instance.id);
    app.emit("instance-progress", serde_json::json!({"stage":"done","instance_id":instance.id,"name":instance.name,"icon":instance.icon.as_deref(),"percent":100,"message":"Pack imported!"})).ok();
    // Metadata requests for a large pack can be slow or blocked. The game-ready
    // instance is saved first; names/authors refresh later without holding the
    // progress panel at 94%.
    let metadata_instance = instance.clone();
    let metadata_app = app.clone();
    tauri::async_runtime::spawn(async move {
        let Ok(metadata_client) = reqwest::Client::builder()
            .timeout(std::time::Duration::from_secs(8))
            .user_agent("PortalLauncher/1.3")
            .build() else { return; };
        let mut refreshed = metadata_instance;
        hydrate_modrinth_instance_mods(&metadata_client, &mut refreshed.mods).await;
        if save_instance(&refreshed).is_ok() {
            let _ = metadata_app.emit("instance-metadata-ready", serde_json::json!({"instance_id": refreshed.id}));
        }
    });
    Ok(instance)
}

/// Принимает содержимое архива из webview, сохраняет временную копию и
/// направляет её в соответствующий импортёр. Так не передаётся ошибочный
/// браузерный `File.name` вместо пути к файлу.
#[tauri::command]
pub async fn import_archive_data(
    app: tauri::AppHandle,
    file_name: String,
    data_url: String,
    excluded_paths: Option<Vec<String>>,
) -> Result<Instance, String> {
    let lower = file_name.to_lowercase();
    let ext = if lower.ends_with(".mrpack") { "mrpack" } else if lower.ends_with(".zip") { "zip" } else {
        return Err("Поддерживаются только .mrpack и .zip архивы".to_string());
    };
    if Path::new(&data_url).is_file() {
        let source = Path::new(&data_url);
        let metadata = std::fs::metadata(source).map_err(|e| format!("Не удалось прочитать выбранный архив: {e}"))?;
        if metadata.len() == 0 { return Err("Выбранный архив пуст. Исходный файл не был изменён.".to_string()); }
        return if ext == "mrpack" {
            import_modrinth_pack(app, data_url, excluded_paths).await
        } else {
            import_instance_zip(app, data_url, None, excluded_paths).await
        };
    }
    let encoded = data_url.strip_prefix("data:")
        .and_then(|value| value.split_once(',').map(|(_, payload)| payload))
        .unwrap_or(&data_url);
    use base64::Engine as _;
    let bytes = base64::engine::general_purpose::STANDARD.decode(encoded)
        .map_err(|e| format!("Не удалось прочитать архив: {e}"))?;
    let temp_dir = instances_dir().join(".imports");
    std::fs::create_dir_all(&temp_dir).map_err(|e| e.to_string())?;
    let temp_path = temp_dir.join(format!("{}.{ext}", uuid::Uuid::new_v4()));
    std::fs::write(&temp_path, bytes).map_err(|e| format!("Не удалось сохранить временный архив: {e}"))?;
    let path = temp_path.to_string_lossy().to_string();
    let result = if ext == "mrpack" {
        import_modrinth_pack(app.clone(), path, excluded_paths).await
    } else {
        import_instance_zip(app.clone(), path, None, excluded_paths).await
    };
    let _ = std::fs::remove_file(temp_path);
    result
}

/// Загружает архив модпака из Discover и передаёт его тому же импортеру,
/// что используется для локальных файлов. Это создаёт полноценную сборку со
/// всем содержимым модпака вместо пустой сборки с одиночным файлом.
#[tauri::command]
pub fn cancel_instance_install(instance_id: String) -> Result<(), String> {
    crate::mc::launch::CANCELLED.lock().map_err(|_| "Не удалось отменить установку")?.insert(instance_id);
    Ok(())
}

#[tauri::command]
pub async fn import_remote_modpack(
    app: tauri::AppHandle,
    download_url: String,
    file_name: String,
    source: String,
    excluded_paths: Option<Vec<String>>,
    project_icon_url: Option<String>,
    project_screenshots: Option<Vec<String>>,
) -> Result<Instance, String> {
    app.emit("instance-progress", serde_json::json!({"stage":"downloading","name":file_name,"percent":5,"message":"Downloading modpack archive..."})).ok();
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(300))
        .user_agent("PortalLauncher/1.3")
        .build().map_err(|e| e.to_string())?;
    let bytes = client.get(&download_url).send().await
        .map_err(|e| format!("Не удалось скачать модпак: {e}"))?
        .error_for_status().map_err(|e| format!("Сервер вернул ошибку: {e}"))?
        .bytes().await.map_err(|e| format!("Не удалось прочитать модпак: {e}"))?;
    let is_mrpack = source.eq_ignore_ascii_case("modrinth") || file_name.to_lowercase().ends_with(".mrpack");
    let temp_dir = instances_dir().join(".imports");
    std::fs::create_dir_all(&temp_dir).map_err(|e| e.to_string())?;
    let temp_path = temp_dir.join(format!("{}.{}", uuid::Uuid::new_v4(), if is_mrpack { "mrpack" } else { "zip" }));
    std::fs::write(&temp_path, bytes).map_err(|e| format!("Не удалось сохранить модпак: {e}"))?;
    let path = temp_path.to_string_lossy().to_string();
    let result = if is_mrpack {
        import_modrinth_pack(app.clone(), path, excluded_paths).await
    } else {
        import_instance_zip(app.clone(), path, None, excluded_paths).await
    };
    let _ = std::fs::remove_file(temp_path);
    let mut instance = result?;

    // Archive covers are preferred, but Discover metadata is a reliable fallback
    // for packs that ship without a local icon. Persist it exactly like a user
    // selected instance image so Library, header and Settings share one source.
    if instance.icon.is_none() {
        if let Some(icon_url) = project_icon_url.filter(|url| !url.trim().is_empty()) {
            if let Ok(response) = client.get(&icon_url).send().await {
                if let Ok(response) = response.error_for_status() {
                    if let Ok(bytes) = response.bytes().await {
                        if !bytes.is_empty() && bytes.len() <= 8 * 1024 * 1024 {
                            let icon_path = instances_dir().join(&instance.id).join("icon.png");
                            if std::fs::write(icon_path, &bytes).is_ok() {
                                use base64::Engine as _;
                                instance.icon = Some(format!("data:image/png;base64,{}", base64::engine::general_purpose::STANDARD.encode(bytes)));
                            }
                        }
                    }
                }
            }
        }
    }

    let screenshots_dir = instances_dir().join(&instance.id).join(".minecraft").join("screenshots");
    std::fs::create_dir_all(&screenshots_dir).ok();
    for (index, url) in project_screenshots.unwrap_or_default().into_iter().filter(|url| !url.trim().is_empty()).take(8).enumerate() {
        if let Ok(response) = client.get(&url).send().await {
            if let Ok(response) = response.error_for_status() {
                if let Ok(bytes) = response.bytes().await {
                    if !bytes.is_empty() && bytes.len() <= 16 * 1024 * 1024 {
                        let ext = if bytes.starts_with(&[0x89, b'P', b'N', b'G']) { "png" } else { "jpg" };
                        let _ = std::fs::write(screenshots_dir.join(format!("pack-{:02}.{ext}", index + 1)), bytes);
                    }
                }
            }
        }
    }
    save_instance(&instance)?;
    Ok(instance)
}

/// Импорт модпака CurseForge (manifest.json + overrides/). В отличие от
/// Modrinth-паков, файлы модов тут указаны не прямыми ссылками, а парами
/// (projectID, fileID) — реальный URL на каждый файл приходится отдельно
/// получать через CurseForge API.
async fn import_curseforge_modpack_from_archive(
    app: tauri::AppHandle,
    mut archive: zip::ZipArchive<std::fs::File>,
    new_name: Option<String>,
    excluded_paths: Vec<String>,
) -> Result<Instance, String> {
    let manifest_data = {
        let mut f = archive.by_name("manifest.json").map_err(|e| e.to_string())?;
        let mut s = String::new();
        std::io::Read::read_to_string(&mut f, &mut s).map_err(|e| e.to_string())?;
        s
    };
    let manifest: serde_json::Value = serde_json::from_str(&manifest_data).map_err(|e| e.to_string())?;

    let pack_name = new_name.unwrap_or_else(|| manifest["name"].as_str().unwrap_or("CurseForge Pack").to_string());
    app.emit("instance-progress", serde_json::json!({"stage":"importing","name":pack_name,"percent":5,"message":"Reading manifest..."})).ok();

    let mc_version = manifest["minecraft"]["version"].as_str().unwrap_or("1.20.1").to_string();
    // modLoaders[].id обычно вида "forge-47.2.0" / "fabric-0.15.11"
    let loader_id = manifest["minecraft"]["modLoaders"].as_array()
        .and_then(|arr| arr.iter().find(|m| m["primary"].as_bool().unwrap_or(false)).or_else(|| arr.first()))
        .and_then(|m| m["id"].as_str())
        .unwrap_or("forge-0");
    let (loader, loader_version) = match loader_id.split_once('-') {
        Some((name, ver)) => (name.to_string(), ver.to_string()),
        None => ("forge".to_string(), String::new()),
    };

    let new_id = uuid::Uuid::new_v4().to_string();
    clear_cancel(&new_id);
    let dest_dir = instances_dir().join(&new_id);
    create_instance_folders(&dest_dir)?;
    let icon_b64: Option<String> = ["icon.png", "pack.png", "icon.jpg"].iter().find_map(|candidate| {
        let mut entry = archive.by_name(candidate).ok()?;
        let mut bytes = Vec::new();
        std::io::Read::read_to_end(&mut entry, &mut bytes).ok()?;
        if bytes.is_empty() { return None; }
        use base64::Engine as _;
        let encoded = base64::engine::general_purpose::STANDARD.encode(&bytes);
        let mime = if candidate.ends_with(".jpg") { "image/jpeg" } else { "image/png" };
        let data = format!("data:{mime};base64,{encoded}");
        if let Some(part) = data.split(',').nth(1) {
            if let Ok(decoded) = base64::engine::general_purpose::STANDARD.decode(part) { std::fs::write(dest_dir.join("icon.png"), decoded).ok(); }
        }
        Some(data)
    });
    let mc_dir = dest_dir.join(".minecraft");

    // ── overrides/ → .minecraft/ (конфиги, ресурспаки и т.д., уже приложенные в архиве) ──
    let overrides_root = manifest["overrides"].as_str().unwrap_or("overrides").to_string();
    let prefix = format!("{overrides_root}/");
    app.emit("instance-progress", serde_json::json!({"stage":"extracting","instance_id":new_id,"name":pack_name,"icon":icon_b64.as_deref(),"percent":10,"message":"Extracting overrides..."})).ok();
    let override_names: Vec<String> = (0..archive.len())
        .filter_map(|i| archive.by_index(i).ok().map(|e| e.name().to_string()))
        .filter(|n| n.starts_with(&prefix) && !n.ends_with('/'))
        .collect();
    for name in &override_names {
        let mut entry = archive.by_name(name).map_err(|e| e.to_string())?;
        let rel = &name[prefix.len()..];
        let out = mc_dir.join(rel);
        if let Some(p) = out.parent() { std::fs::create_dir_all(p).ok(); }
        if let Ok(mut outf) = std::fs::File::create(&out) {
            std::io::copy(&mut entry, &mut outf).ok();
        }
    }

    // ── files: [{projectID, fileID, required}] → скачать через CurseForge API ──
    let files = manifest["files"].as_array().cloned().unwrap_or_default();
    let total = files.len();
    let mods_dir = mc_dir.join("mods");
    std::fs::create_dir_all(&mods_dir).ok();
    let mut mods = vec![];
    let mut failed = 0usize;
    let excluded_paths: std::collections::HashSet<String> = excluded_paths.into_iter().collect();
    for (i, f) in files.iter().enumerate() {
        if cancel_requested(&new_id) {
            clear_cancel(&new_id);
            let _ = std::fs::remove_dir_all(&dest_dir);
            app.emit("instance-progress", serde_json::json!({"stage":"cancelled","instance_id":new_id,"name":pack_name,"percent":0,"message":"Installation cancelled"})).ok();
            return Err("Pack installation cancelled".to_string());
        }
        let project_id = f["projectID"].as_u64().unwrap_or(0);
        let file_id = f["fileID"].as_u64().unwrap_or(0);
        if project_id == 0 || file_id == 0 { continue; }
        if excluded_paths.contains(&format!("mods/curseforge-{file_id}.jar")) { continue; }

        let pct = 15 + (i as u64 * 80) / total.max(1) as u64;
        app.emit("instance-progress", serde_json::json!({"stage":"downloading","instance_id":new_id,"name":pack_name,"icon":icon_b64.as_deref(),"percent":pct,"message":format!("Downloading {}/{}", i+1, total)})).ok();

        match crate::commands::curseforge::get_curseforge_file_download_url(project_id, file_id, String::new()).await {
            Ok(url) if !url.is_empty() => {
                let fname = url.rsplit('/').next().unwrap_or("mod.jar").to_string();
                match reqwest::get(&url).await {
                    Ok(resp) if resp.status().is_success() => {
                        if let Ok(bytes) = resp.bytes().await {
                            std::fs::write(mods_dir.join(&fname), &bytes).ok();
                            mods.push(InstanceMod {
                                id: project_id.to_string(),
                                name: fname.trim_end_matches(".jar").to_string(),
                                version: file_id.to_string(),
                                version_id: file_id.to_string(),
                                source: "curseforge".to_string(),
                                enabled: true,
                                file_name: fname.clone(),
                                mod_type: "mod".to_string(),
                                author: None,
                                icon_url: None,
                            });
                        } else { failed += 1; }
                    }
                    _ => { failed += 1; }
                }
            }
            Ok(_) => { failed += 1; }
            Err(e) => { log::warn!("CF modpack: не удалось получить ссылку для {project_id}/{file_id}: {e}"); failed += 1; }
        }
    }

    for item in &mut mods {
        let Ok(project_id) = item.id.parse::<u64>() else { continue; };
        if let Ok(project) = crate::commands::curseforge::get_curseforge_mod(project_id, String::new()).await {
            if !project.name.trim().is_empty() { item.name = project.name; }
            item.author = project.authors.first().map(|author| author.name.clone());
            item.icon_url = project.logo.map(|logo| logo.thumbnail_url);
        }
    }

    if mods.is_empty() && total > 0 {
        return Err(format!(
            "Не удалось скачать ни одного мода ({} из {} не удались). Проверьте CurseForge API-ключ в настройках.",
            failed, total
        ));
    }

    let instance = Instance {
        id: new_id, name: pack_name, description: "Imported from CurseForge modpack".to_string(),
        mc_version, loader, loader_version,
        min_ram: 2048, max_ram: 6144, java_path: String::new(), custom_jvm_args: String::new(),
        play_time_minutes: 0, last_played: None, created_at: chrono::Utc::now().to_rfc3339(),
        icon: icon_b64, color: Some("#F16436".to_string()), mods,
    };
    save_instance(&instance)?;
    clear_cancel(&instance.id);
    app.emit("instance-progress", serde_json::json!({"stage":"done","instance_id":instance.id,"name":instance.name,"icon":instance.icon.as_deref(),"percent":100,"message":format!("Pack imported! ({} failed)", failed)})).ok();
    Ok(instance)
}

/// Import instance from Prism Launcher ZIP export
#[tauri::command]
pub async fn import_prismlauncher_instance(app: tauri::AppHandle, zip_path: String) -> Result<Instance, String> {
    app.emit("instance-progress", serde_json::json!({"stage":"importing","name":"Prism Instance","percent":5,"message":"Reading ZIP..."})).ok();
    
    let file = std::fs::File::open(&zip_path).map_err(|e| format!("Open ZIP: {e}"))?;
    let mut archive = zip::ZipArchive::new(file).map_err(|e| format!("Read ZIP: {e}"))?;
    
    // Find instance.cfg (Prism Launcher config)
    let mut instance_name = "Prism Import".to_string();
    let mut mc_version = "1.20.1".to_string();
    let mut loader = "vanilla".to_string();
    let mut loader_version = String::new();
    let min_ram = 2048u32;
    let max_ram = 4096u32;
    
    // Try to read instance.cfg
    if let Ok(mut cfg_file) = archive.by_name("instance.cfg") {
        let mut cfg_content = String::new();
        if cfg_file.read_to_string(&mut cfg_content).is_ok() {
            // Parse INI-like format
            for line in cfg_content.lines() {
                let line = line.trim();
                if line.starts_with("name=") {
                    instance_name = line.trim_start_matches("name=").trim_matches('"').to_string();
                } else if line.starts_with("IntendedVersion=") {
                    mc_version = line.trim_start_matches("IntendedVersion=").trim_matches('"').to_string();
                } else if line.starts_with("Loader=") {
                    loader = line.trim_start_matches("Loader=").trim_matches('"').to_string().to_lowercase();
                } else if line.starts_with("LoaderVersion=") {
                    loader_version = line.trim_start_matches("LoaderVersion=").trim_matches('"').to_string();
                }
            }
        }
    }
    
    // Try to read mmc-pack.json for more accurate version info
    if let Ok(mut pack_file) = archive.by_name("mmc-pack.json") {
        let mut pack_content = String::new();
        if pack_file.read_to_string(&mut pack_content).is_ok() {
            if let Ok(pack_data) = serde_json::from_str::<serde_json::Value>(&pack_content) {
                if let Some(components) = pack_data["components"].as_array() {
                    for comp in components {
                        let uid = comp["uid"].as_str().unwrap_or("");
                        let version = comp["version"].as_str().unwrap_or("").to_string();
                        if uid.contains("net.minecraft") {
                            mc_version = version;
                        } else if uid.contains("net.fabricmc.fabric-loader") {
                            loader = "fabric".to_string();
                            loader_version = version;
                        } else if uid.contains("net.minecraftforge") {
                            loader = "forge".to_string();
                            loader_version = version;
                        } else if uid.contains("org.quiltmc.quilt-loader") {
                            loader = "quilt".to_string();
                            loader_version = version;
                        } else if uid.contains("net.neoforged") {
                            loader = "neoforge".to_string();
                            loader_version = version;
                        }
                    }
                }
            }
        }
    }
    
    let new_id = uuid::Uuid::new_v4().to_string();
    let dest_dir = instances_dir().join(&new_id);
    create_instance_folders(&dest_dir)?;
    
    // Extract all files from ZIP into the game directory used by Portal Launcher.
    let game_dir = dest_dir.join(".minecraft");
    let total = archive.len();
    app.emit("instance-progress", serde_json::json!({"stage":"extracting","name":instance_name,"percent":20,"message":format!("Extracting {} files...", total)})).ok();
    
    for i in 0..total {
        let mut entry = archive.by_index(i).map_err(|e| e.to_string())?;
        let name = entry.name().to_string();
        
        // Skip config files we already processed
        if name == "instance.cfg" || name == "mmc-pack.json" {
            continue;
        }
        
        // Prism stores actual game files under `minecraft/`. Some export tools
        // omit that wrapper, so known game folders are normalized as well.
        let (dest_name, is_game_content) = if name.starts_with("minecraft/") {
            (name["minecraft/".len()..].to_string(), true)
        } else {
            let first = name.split('/').next().unwrap_or("");
            let game_names = ["mods", "config", "resourcepacks", "shaderpacks", "datapacks", "saves", "scripts", "kubejs", "options.txt", "servers.dat"];
            (name.clone(), game_names.contains(&first))
        };
        if dest_name.is_empty() { continue; }
        let out_path = if is_game_content { game_dir.join(&dest_name) } else { dest_dir.join(&dest_name) };
        
        if entry.is_dir() {
            std::fs::create_dir_all(&out_path).ok();
        } else {
            if let Some(p) = out_path.parent() {
                std::fs::create_dir_all(p).ok();
            }
            let mut outf = std::fs::File::create(&out_path).map_err(|e| e.to_string())?;
            std::io::copy(&mut entry, &mut outf).map_err(|e| e.to_string())?;
        }
        
        if i % 20 == 0 {
            let pct = 20 + (i as u64 * 50) / total.max(1) as u64;
            app.emit("instance-progress", serde_json::json!({"stage":"extracting","name":instance_name,"percent":pct,"message":format!("Extracted {}/{}", i, total)})).ok();
        }
    }
    
    // Collect mod list
    let mut mods = vec![];
    let mods_dir = dest_dir.join(".minecraft").join("mods");
    if mods_dir.exists() {
        if let Ok(entries) = std::fs::read_dir(&mods_dir) {
            for entry in entries.flatten() {
                let fname = entry.file_name().to_string_lossy().to_string();
                if fname.ends_with(".jar") {
                    mods.push(InstanceMod {
                        id: fname.clone(),
                        name: fname.trim_end_matches(".jar").to_string(),
                        version: "imported".to_string(),
                        version_id: String::new(),
                        source: "prismlauncher".to_string(),
                        enabled: true,
                        file_name: fname.clone(),
                        mod_type: "mod".to_string(),
                        author: None,
                        icon_url: None,
                    });
                }
            }
        }
    }
    
    let instance = Instance {
        id: new_id,
        name: instance_name.clone(),
        description: "Imported from Prism Launcher".to_string(),
        mc_version,
        loader,
        loader_version,
        min_ram,
        max_ram,
        java_path: String::new(),
        custom_jvm_args: String::new(),
        play_time_minutes: 0,
        last_played: None,
        created_at: chrono::Utc::now().to_rfc3339(),
        icon: None,
        color: Some("#3B82F6".to_string()),
        mods,
    };
    
    save_instance(&instance)?;
    app.emit("instance-progress", serde_json::json!({"stage":"done","name":instance_name,"percent":100,"message":"Prism instance imported!"})).ok();
    
    Ok(instance)
}

/// Detect and list available Prism Launcher instances
#[tauri::command]
pub async fn detect_prismlauncher_instances() -> Result<Vec<serde_json::Value>, String> {
    let mut instances = vec![];
    
    // Common Prism Launcher data directories
    let prism_dirs = vec![
        dirs_next::data_dir().map(|d| d.join("PrismLauncher")),
        dirs_next::home_dir().map(|d| d.join("PrismLauncher")),
        dirs_next::data_local_dir().map(|d| d.join("PrismLauncher")),
    ];
    
    for prism_dir_opt in prism_dirs {
        if let Some(prism_dir) = prism_dir_opt {
            let instances_dir_prism = prism_dir.join("instances");
            if instances_dir_prism.exists() {
                if let Ok(entries) = std::fs::read_dir(&instances_dir_prism) {
                    for entry in entries.flatten() {
                        if entry.file_type().map(|t| t.is_dir()).unwrap_or(false) {
                            let instance_dir = entry.path();
                            let instance_name = entry.file_name().to_string_lossy().to_string();
                            
                            // Try to read instance.cfg
                            let cfg_path = instance_dir.join("instance.cfg");
                            let mut mc_ver = "Unknown".to_string();
                            let mut loader_name = "Unknown".to_string();
                            
                            if cfg_path.exists() {
                                if let Ok(cfg_data) = std::fs::read_to_string(&cfg_path) {
                                    for line in cfg_data.lines() {
                                        let line = line.trim();
                                        if line.starts_with("IntendedVersion=") {
                                            mc_ver = line.trim_start_matches("IntendedVersion=").trim_matches('"').to_string();
                                        }
                                        if line.starts_with("Loader=") {
                                            loader_name = line.trim_start_matches("Loader=").trim_matches('"').to_string();
                                        }
                                    }
                                }
                            }
                            
                            instances.push(serde_json::json!({
                                "name": instance_name,
                                "path": instance_dir.to_string_lossy().to_string(),
                                "mc_version": mc_ver,
                                "loader": loader_name,
                                "source": "prismlauncher"
                            }));
                        }
                    }
                }
            }
        }
    }
    
    Ok(instances)
}

/// Detect and list available Modrinth App instances
#[tauri::command]
pub async fn detect_modrinth_instances() -> Result<Vec<serde_json::Value>, String> {
    let mut instances = vec![];
    
    // Modrinth App stores instances in %APPDATA%/com.modrinth.mod/appdata/instances
    let modrinth_dir = dirs_next::data_dir()
        .map(|d| d.join("com.modrinth.mod").join("appdata").join("instances"));
    
    if let Some(instances_dir_mr) = modrinth_dir {
        if instances_dir_mr.exists() {
            if let Ok(entries) = std::fs::read_dir(&instances_dir_mr) {
                for entry in entries.flatten() {
                    if entry.file_type().map(|t| t.is_dir()).unwrap_or(false) {
                        let instance_dir = entry.path();
                        let instance_name = entry.file_name().to_string_lossy().to_string();
                        
                        // Try to read modrinth.index.json or pack.json
                        let index_path = instance_dir.join("modrinth.index.json");
                        let mut mc_ver = "Unknown".to_string();
                        let mut loader_name = "Unknown".to_string();
                        
                        if index_path.exists() {
                            if let Ok(index_data) = std::fs::read_to_string(&index_path) {
                                if let Ok(index_json) = serde_json::from_str::<serde_json::Value>(&index_data) {
                                    if let Some(minecraft) = index_json["dependencies"]["minecraft"].as_str() {
                                        mc_ver = minecraft.to_string();
                                    }
                                    if index_json["dependencies"]["fabric-loader"].is_string() {
                                        loader_name = "Fabric".to_string();
                                    } else if index_json["dependencies"]["forge"].is_string() {
                                        loader_name = "Forge".to_string();
                                    } else if index_json["dependencies"]["neoforge"].is_string() {
                                        loader_name = "NeoForge".to_string();
                                    } else if index_json["dependencies"]["quilt-loader"].is_string() {
                                        loader_name = "Quilt".to_string();
                                    }
                                }
                            }
                        }
                        
                        instances.push(serde_json::json!({
                            "name": instance_name,
                            "path": instance_dir.to_string_lossy().to_string(),
                            "mc_version": mc_ver,
                            "loader": loader_name,
                            "source": "modrinth"
                        }));
                    }
                }
            }
        }
    }
    
    Ok(instances)
}

#[tauri::command]
pub async fn backup_instance(app: tauri::AppHandle, id: String) -> Result<String, String> {
    let inst = load_instance(&id).ok_or("Instance not found")?;
    let ts = chrono::Utc::now().format("%Y%m%d_%H%M%S");
    let bdir = { let mut p = mc_base_dir(); p.push("backups"); std::fs::create_dir_all(&p).ok(); p };
    let dest = bdir.join(format!("{}_{}.zip", inst.name.replace(' ', "_"), ts));
    export_instance_zip(app, id, dest.to_string_lossy().to_string()).await
}

#[tauri::command]
pub async fn list_backups() -> Result<Vec<serde_json::Value>, String> {
    let bdir = { let mut p = mc_base_dir(); p.push("backups"); p };
    let mut result = vec![];
    if let Ok(entries) = std::fs::read_dir(&bdir) {
        for entry in entries.flatten() {
            let name = entry.file_name().to_string_lossy().to_string();
            let size = entry.metadata().map(|m| m.len()).unwrap_or(0);
            let modified = entry.metadata().ok().and_then(|m| m.modified().ok()).and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok()).map(|d| d.as_secs()).unwrap_or(0);
            result.push(serde_json::json!({"name":name,"path":entry.path().to_string_lossy(),"size_bytes":size,"modified":modified}));
        }
    }
    result.sort_by(|a, b| b["modified"].as_u64().cmp(&a["modified"].as_u64()));
    Ok(result)
}

/// List screenshots from an instance's .minecraft/screenshot folder
#[tauri::command]
pub fn delete_instance_screenshot(id: String, file_name: String) -> Result<(), String> {
    let _inst = load_instance(&id).ok_or("Instance not found")?;
    if file_name.contains('/') || file_name.contains('\\') || file_name.contains("..") {
        return Err("Invalid screenshot name".to_string());
    }
    let path = instances_dir().join(&id).join(".minecraft").join("screenshots").join(&file_name);
    if path.exists() { std::fs::remove_file(path).map_err(|e| e.to_string())?; }
    Ok(())
}

#[tauri::command]
pub fn list_screenshots(id: String) -> Result<Vec<String>, String> {
    let _inst = load_instance(&id).ok_or("Instance not found")?;
    let inst_dir = instances_dir().join(&id);
    let screenshot_dir = inst_dir.join(".minecraft").join("screenshots");
    
    if !screenshot_dir.exists() {
        return Ok(vec![]);
    }
    
    let mut result = vec![];
    if let Ok(entries) = std::fs::read_dir(&screenshot_dir) {
        for entry in entries.flatten() {
            let ext = entry.path().extension().and_then(|e| e.to_str()).unwrap_or("").to_lowercase();
            if ext == "png" || ext == "jpg" || ext == "jpeg" {
                result.push(entry.path().to_string_lossy().to_string());
            }
        }
    }
    result.sort();
    Ok(result)
}

/// Reads one screenshot from the selected instance as bytes for the WebView.
/// Keeping the file-name-only contract prevents directory traversal while
/// avoiding the platform-specific asset protocol scope that broke previews.
#[tauri::command]
pub fn read_instance_screenshot(id: String, file_name: String) -> Result<Vec<u8>, String> {
    let _inst = load_instance(&id).ok_or("Instance not found")?;
    if file_name.is_empty() || file_name.contains('/') || file_name.contains('\\') || file_name.contains("..") {
        return Err("Invalid screenshot name".to_string());
    }
    let lower = file_name.to_ascii_lowercase();
    if !matches!(lower.as_str(), value if value.ends_with(".png") || value.ends_with(".jpg") || value.ends_with(".jpeg")) {
        return Err("Only PNG and JPEG screenshots can be opened".to_string());
    }
    let path = instances_dir().join(&id).join(".minecraft").join("screenshots").join(&file_name);
    let metadata = std::fs::metadata(&path).map_err(|e| format!("Screenshot not found: {e}"))?;
    if metadata.len() > 24 * 1024 * 1024 {
        return Err("Screenshot is too large to preview (limit: 24 MB)".to_string());
    }
    std::fs::read(path).map_err(|e| format!("Could not read screenshot: {e}"))
}

/// Save an edited screenshot back into the selected instance's screenshots folder.
/// The filename is deliberately restricted to a basename so the frontend cannot
/// escape the instance directory through this command.
#[tauri::command]
pub fn save_instance_screenshot(id: String, file_name: String, data: Vec<u8>) -> Result<(), String> {
    let _inst = load_instance(&id).ok_or("Instance not found")?;
    if file_name.is_empty() || file_name.contains('/') || file_name.contains('\\') || file_name.contains("..") {
        return Err("Invalid screenshot name".to_string());
    }
    let ext = std::path::Path::new(&file_name)
        .extension().and_then(|e| e.to_str()).unwrap_or("").to_lowercase();
    if !matches!(ext.as_str(), "png" | "jpg" | "jpeg") {
        return Err("Only PNG and JPEG screenshots can be saved".to_string());
    }
    let screenshot_dir = instances_dir().join(&id).join(".minecraft").join("screenshots");
    std::fs::create_dir_all(&screenshot_dir).map_err(|e| e.to_string())?;
    std::fs::write(screenshot_dir.join(file_name), data).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn download_project_screenshot(url: String, file_name: String, instance_id: Option<String>) -> Result<String, String> {
    if !url.starts_with("https://") && !url.starts_with("http://") { return Err("Скриншот должен быть доступен по HTTP(S)-адресу".to_string()); }
    let client = reqwest::Client::builder().timeout(std::time::Duration::from_secs(20)).user_agent("PortalLauncher/1.3").build().map_err(|e| e.to_string())?;
    let response = client.get(&url).send().await.map_err(|e| format!("Не удалось скачать скриншот: {e}"))?.error_for_status().map_err(|e| format!("Сервер скриншота вернул ошибку: {e}"))?;
    let content_type = response.headers().get(reqwest::header::CONTENT_TYPE).and_then(|value| value.to_str().ok()).unwrap_or("").to_ascii_lowercase();
    if !content_type.starts_with("image/") { return Err("Сервер вернул не изображение".to_string()); }
    let bytes = response.bytes().await.map_err(|e| format!("Не удалось прочитать скриншот: {e}"))?;
    if bytes.is_empty() || bytes.len() > 24 * 1024 * 1024 { return Err("Размер скриншота должен быть от 1 байта до 24 МБ".to_string()); }
    let extension = if content_type.contains("jpeg") || content_type.contains("jpg") { "jpg" } else if content_type.contains("webp") { "webp" } else { "png" };
    let stem: String = file_name.chars().filter(|value| value.is_ascii_alphanumeric() || matches!(value, '-' | '_')).collect();
    let name = format!("{}.{}", if stem.is_empty() { format!("project-screenshot-{}", chrono::Utc::now().timestamp()) } else { stem }, extension);
    let target_dir = match instance_id.filter(|id| !id.trim().is_empty()) {
        Some(id) => {
            let _instance = load_instance(&id).ok_or("Сборка для сохранения скриншота не найдена")?;
            instances_dir().join(id).join(".minecraft").join("screenshots")
        }
        None => dirs_next::download_dir().or_else(|| dirs_next::home_dir().map(|home| home.join("Downloads"))).ok_or("Не удалось найти системную папку «Загрузки»")?,
    };
    std::fs::create_dir_all(&target_dir).map_err(|e| format!("Не удалось открыть папку сохранения: {e}"))?;
    let target = target_dir.join(name);
    std::fs::write(&target, bytes).map_err(|e| format!("Не удалось сохранить скриншот: {e}"))?;
    Ok(target.to_string_lossy().to_string())
}

/// Import a detected external launcher instance by copying its complete game directory.
/// `source_kind` is `prism` when the source has a `minecraft/` child directory;
/// otherwise the selected directory itself is treated as the game root.
#[tauri::command]
pub async fn import_external_instance(
    app: tauri::AppHandle,
    source_path: String,
    source_kind: String,
    name: String,
    mc_version: String,
    loader: String,
    loader_version: String,
) -> Result<Instance, String> {
    let source = PathBuf::from(&source_path);
    if !source.is_dir() { return Err("External instance folder not found".into()); }
    let game_source = if source_kind.eq_ignore_ascii_case("prism") && source.join("minecraft").is_dir() {
        source.join("minecraft")
    } else if source.join(".minecraft").is_dir() {
        source.join(".minecraft")
    } else { source.clone() };
    let new_id = uuid::Uuid::new_v4().to_string();
    let dest_dir = instances_dir().join(&new_id);
    create_instance_folders(&dest_dir)?;
    let game_dest = dest_dir.join(".minecraft");
    app.emit("instance-progress", serde_json::json!({"stage":"importing","name":name,"percent":10,"message":"Copying external instance files…"})).ok();
    copy_external_tree(&game_source, &game_dest, &app, &name)?;
    let mut mods = Vec::new();
    let mods_dir = game_dest.join("mods");
    if let Ok(entries) = std::fs::read_dir(mods_dir) {
        for entry in entries.flatten() {
            let file_name = entry.file_name().to_string_lossy().to_string();
            if file_name.to_lowercase().ends_with(".jar") {
                    mods.push(InstanceMod { id:file_name.clone(), name:file_name.trim_end_matches(".jar").to_string(), version:"imported".into(), version_id:String::new(), source:source_kind.clone(), enabled:true, file_name:file_name.clone(), mod_type:"mod".into(), author:None, icon_url:None });
            }
        }
    }
    let instance = Instance {
        id:new_id, name:name.clone(), description:format!("Imported from {}", source_kind),
        mc_version: if mc_version.is_empty() { "Unknown".into() } else { mc_version },
        loader: if loader.is_empty() { "vanilla".into() } else { loader.to_lowercase() },
        loader_version, min_ram:2048, max_ram:6144, java_path:String::new(), custom_jvm_args:String::new(),
        play_time_minutes:0, last_played:None, created_at:chrono::Utc::now().to_rfc3339(), icon:None, color:Some("#3B82F6".into()), mods,
    };
    save_instance(&instance)?;
    app.emit("instance-progress", serde_json::json!({"stage":"done","name":name,"percent":100,"message":"External instance imported"})).ok();
    Ok(instance)
}

fn copy_external_tree(source: &Path, dest: &Path, app: &tauri::AppHandle, name: &str) -> Result<(), String> {
    std::fs::create_dir_all(dest).map_err(|e| e.to_string())?;
    let entries = std::fs::read_dir(source).map_err(|e| e.to_string())?;
    for entry in entries.flatten() {
        let from = entry.path(); let to = dest.join(entry.file_name());
        if from.is_dir() { copy_external_tree(&from, &to, app, name)?; }
        else { std::fs::copy(&from, &to).map_err(|e| format!("Copy {}: {e}", from.display()))?; }
    }
    app.emit("instance-progress", serde_json::json!({"stage":"copying","name":name,"percent":60,"message":"Copying files…"})).ok();
    Ok(())
}


/// Detect instances from XMCL and CurseForge App in addition to the existing
/// Prism and Modrinth adapters. The returned records use the same shape as the
/// existing import dialog, so all four launchers share one migration flow.
#[tauri::command]
pub async fn detect_supported_launcher_instances() -> Result<Vec<serde_json::Value>, String> {
    let mut result: Vec<serde_json::Value> = Vec::new();
    let mut roots: Vec<(String, PathBuf)> = Vec::new();
    let data = dirs_next::data_dir();
    let config = dirs_next::config_dir();
    let home = dirs_next::home_dir();

    for base in [data.clone(), config.clone(), home.clone()].into_iter().flatten() {
        roots.push(("xmcl".into(), base.join("xmcl").join("instances")));
        roots.push(("xmcl".into(), base.join("XMCL").join("instances")));
        roots.push(("xmcl".into(), base.join(".xmcl").join("instances")));
        roots.push(("curseforge".into(), base.join("CurseForge").join("Minecraft").join("Instances")));
        roots.push(("curseforge".into(), base.join("curseforge").join("minecraft").join("Instances")));
    }

    for (source, root) in roots {
        if !root.is_dir() { continue; }
        let entries = match std::fs::read_dir(&root) { Ok(value) => value, Err(_) => continue };
        for entry in entries.flatten() {
            if !entry.file_type().map(|t| t.is_dir()).unwrap_or(false) { continue; }
            let path = entry.path();
            let name = entry.file_name().to_string_lossy().to_string();
            let game_root = if path.join(".minecraft").is_dir() {
                path.join(".minecraft")
            } else if path.join("minecraft").is_dir() {
                path.join("minecraft")
            } else {
                path.clone()
            };
            let mut mc_version = "Unknown".to_string();
            let mut loader = "vanilla".to_string();
            for config_name in ["instance.json", "profile.json", "manifest.json", "minecraftinstance.json"] {
                let cfg = path.join(config_name);
                if let Ok(text) = std::fs::read_to_string(cfg) {
                    if let Ok(value) = serde_json::from_str::<serde_json::Value>(&text) {
                        for key in ["mcVersion", "minecraftVersion", "gameVersion", "version"] {
                            if let Some(v) = value.get(key).and_then(|v| v.as_str()) { mc_version = v.to_string(); break; }
                        }
                        for key in ["loader", "modLoader", "modLoaderType"] {
                            if let Some(v) = value.get(key).and_then(|v| v.as_str()) { loader = v.to_lowercase(); break; }
                        }
                    }
                }
            }
            let path_string = path.to_string_lossy().to_string();
            let duplicate = result.iter().any(|item| item["path"].as_str() == Some(path_string.as_str()));
            if !duplicate {
                result.push(serde_json::json!({
                    "name": name,
                    "path": path_string,
                    "game_root": game_root.to_string_lossy().to_string(),
                    "mc_version": mc_version,
                    "loader": loader,
                    "loader_version": "",
                    "source": source,
                }));
            }
        }
    }
    Ok(result)
}

/// Import wrapper used by the unified migration dialog. It accepts all four
/// supported source labels while preserving the old Prism/Modrinth command.
#[tauri::command]
pub async fn import_supported_launcher_instance(
    app: tauri::AppHandle,
    source_path: String,
    source_kind: String,
    name: String,
    mc_version: String,
    loader: String,
    loader_version: String,
) -> Result<Instance, String> {
    import_external_instance(app, source_path, source_kind, name, mc_version, loader, loader_version).await
}

// XMCL and CurseForge use the same complete-tree migration as Prism and Modrinth.

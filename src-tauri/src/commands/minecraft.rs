// Интегрированная версия minecraft.rs с minecraft_lib для реального запуска
use serde::{Serialize, Deserialize};
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use std::collections::HashMap;
use std::io::{BufRead, BufReader, Write};
use tauri::Emitter;
use crate::minecraft_lib::{self, AuthProfile, LoaderType};
use which::which;
use super::version_manager::{versions_dir, libraries_dir, assets_dir};
use super::jvm::{find_java, java_base_dir};

/// Generate a deterministic offline UUID from a Minecraft username (SHA-1 v5 style).
fn offline_uuid(username: &str) -> String {
    use sha1::{Sha1, Digest};
    let input = format!("OfflinePlayer:{}", username);
    let full = Sha1::digest(input.as_bytes());
    let mut b = [0u8; 16];
    b.copy_from_slice(&full[..16]);
    b[6] = (b[6] & 0x0f) | 0x50; // version 5
    b[8] = (b[8] & 0x3f) | 0x80; // variant RFC 4122
    format!(
        "{:02x}{:02x}{:02x}{:02x}-{:02x}{:02x}-{:02x}{:02x}-{:02x}{:02x}-{:02x}{:02x}{:02x}{:02x}{:02x}{:02x}",
        b[0],b[1],b[2],b[3], b[4],b[5], b[6],b[7], b[8],b[9],
        b[10],b[11],b[12],b[13],b[14],b[15]
    )
}

/// Returns true when the stored access token indicates offline / demo mode.
fn is_offline_token(token: &str) -> bool {
    token.is_empty() || token == "0" || token == "null" || token == "offline"
}

lazy_static::lazy_static! {
    static ref RUNNING: Arc<Mutex<HashMap<String, u32>>> = Arc::new(Mutex::new(HashMap::new()));
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct LaunchResult {
    pub success: bool,
    pub pid: Option<u32>,
    pub message: String,
}

fn mc_base_dir() -> PathBuf {
    crate::commands::version_manager::mc_base_dir()
}

fn instance_dir(instance_id: &str) -> PathBuf {
    mc_base_dir().join("instances").join(instance_id)
}

fn get_auth_info() -> (String, String, String) {
    let profile_path = crate::minecraft_lib::oauth::auth_json_path();
    
    log::info!("🔑 Reading auth from: {:?}", profile_path);
    
    if let Ok(data) = std::fs::read_to_string(&profile_path) {
        log::info!("📄 Auth file content: {}", &data[..data.len().min(200)]);
        if let Ok(v) = serde_json::from_str::<serde_json::Value>(&data) {
            let username = v["username"].as_str().unwrap_or("Player").to_string();
            let uuid = v["uuid"].as_str().unwrap_or("00000000-0000-0000-0000-000000000000").to_string();
            let access_token = v["access_token"].as_str().unwrap_or("").to_string();
            log::info!("✅ Auth loaded: username={}, uuid={}, token_len={}", username, uuid, access_token.len());
            return (username, uuid, access_token);
        } else {
            log::warn!("⚠️ Failed to parse auth.json as JSON");
        }
    } else {
        log::warn!("⚠️ auth.json not found or cannot be read");
    }
    
    log::warn!("⚠️ Using fallback auth: Player / offline");
    ("Player".to_string(), "00000000-0000-0000-0000-000000000000".to_string(), "0".to_string())
}

fn select_java(version_id: &str, loader: &str, custom_java_path: &str) -> String {
    if !custom_java_path.is_empty() && std::path::Path::new(custom_java_path).exists() {
        return custom_java_path.to_string();
    }
    let base_java = required_java_version(version_id);
    let java_major = if (loader == "forge" || loader == "neoforge") && base_java < 17 { 17 } else { base_java };
    let managed = java_base_dir();
    for entry in std::fs::read_dir(&managed).into_iter().flatten().flatten() {
        let name = entry.file_name().to_string_lossy().to_string();
        if name.contains(&format!("java{}", java_major)) || name.contains(&format!("jdk-{}", java_major)) {
            let bin = if cfg!(windows) {
                entry.path().join("bin").join("java.exe")
            } else {
                entry.path().join("bin").join("java")
            };
            if bin.exists() { return bin.to_string_lossy().to_string(); }
        }
    }
    find_java(java_major)
}

pub fn required_java_version(version_id: &str) -> u32 {
    let parts: Vec<u32> = version_id.split('.').filter_map(|p| p.parse().ok()).collect();
    let minor = parts.get(1).copied().unwrap_or(0);
    if minor <= 16 { 8 } else if minor <= 17 { 16 } else if minor <= 20 { 17 } else { 21 }
}

fn detect_log_level(line: &str) -> &'static str {
    let u = line.to_uppercase();
    if u.contains("[FATAL]") || u.contains("FATAL") { "fatal" }
    else if u.contains("[ERROR]") || u.contains("ERROR]") { "error" }
    else if u.contains("[WARN]") || u.contains("WARNING]") { "warn" }
    else if u.contains("[DEBUG]") { "debug" }
    else { "info" }
}

#[allow(dead_code)]
pub async fn legacy_launch_instance(
    app: tauri::AppHandle,
    instance_id: String,
    access_token: Option<String>,
    uuid: Option<String>,
    username: Option<String>,
) -> Result<LaunchResult, String> {
    log::info!("🚀 ===== LAUNCH INSTANCE STARTED (minecraft_lib) =====");
    log::info!("📋 Instance ID: {}", instance_id);

    if instance_id.is_empty() {
        return Err("instance_id is required. Please select an instance to launch.".into());
    }
    
    // 1. Загружаем конфигурацию инстанса через minecraft_lib
    let instance = minecraft_lib::load_instance_config(&instance_id)
        .ok_or_else(|| format!("Instance {} not found. Create it first.", instance_id))?;

    let mc_version = &instance.mc_version;
    let _loader_type = LoaderType::from_str(&instance.loader);
    let _min_ram = instance.min_ram;
    let _max_ram = instance.max_ram;

    app.emit("launch-status", serde_json::json!({
        "instance_id": &instance_id,
        "status": "preparing",
        "message": "Preparing launch with minecraft_lib..."
    })).ok();

    // 2. Загружаем OAuth/Xbox профиль
    let mut auth = minecraft_lib::load_auth_profile().unwrap_or_else(|| AuthProfile {
        uuid: "00000000-0000-0000-0000-000000000000".to_string(),
        username: username.clone().unwrap_or("Player".to_string()),
        access_token: access_token.clone().unwrap_or_default(),
        refresh_token: String::new(),
        xuid: None,
        skin_url: None,
    });

    // Переопределяем данные, если переданы явно
    if let Some(u) = username { auth.username = u; }
    if let Some(u) = uuid { auth.uuid = u; }
    if let Some(t) = access_token { auth.access_token = t; }

    log::info!("🔑 Auth: username={}, token_len={}", auth.username, auth.access_token.len());

    // 3. Скачиваем Minecraft если нужно
    let vdir = versions_dir().join(mc_version);
    if !vdir.join(format!("{}.jar", mc_version)).exists() {
        app.emit("launch-status", serde_json::json!({
            "instance_id": &instance_id,
            "status": "downloading",
            "message": "Downloading Minecraft..."
        })).ok();
        super::version_manager::download_minecraft_version(app.clone(), mc_version.clone()).await?;
    }

    // 4. Выбираем Java — ИСПОЛЬЗУЕМ find_java() для поиска Zulu/Temurin
    let java_major = required_java_version(mc_version);
    let loader_type = LoaderType::from_str(&instance.loader);
    let required_java = if (loader_type == LoaderType::Forge || loader_type == LoaderType::NeoForge) && java_major < 17 {
        17
    } else {
        java_major
    };

    log::info!("🔍 Required Java version: {}", required_java);
    log::info!("🔍 Custom java_path from instance: {}", instance.java_path);

    // Сначала проверяем кастомный путь
    let mut java_path = if !instance.java_path.is_empty() && std::path::Path::new(&instance.java_path).exists() {
        log::info!("✅ Using custom Java path: {}", instance.java_path);
        instance.java_path.clone()
    } else {
        // Ищем в managed Java (Zulu/Temurin)
        let managed = find_java(required_java);
        if !managed.is_empty() && managed != "java" {
            log::info!("✅ Found managed Java: {}", managed);
            managed
        } else {
            // Ищем системную Java
            log::info!("🔍 Searching system Java...");
            "java".to_string()
        }
    };

    // Если Java не найдена — скачиваем
    if java_path.is_empty() || java_path == "java" {
        log::info!("⬇️ Java {} not found, downloading...", required_java);
        app.emit("launch-status", serde_json::json!({
            "instance_id": &instance_id,
            "status": "java_downloading",
            "message": format!("Downloading Java {} (Zulu/Temurin)...", required_java)
        })).ok();

        let download_path = super::jvm::download_java(app.clone(), required_java).await
            .map_err(|e| format!("Failed to install Java {}: {}", required_java, e))?;

        log::info!("✅ Java downloaded to: {}", download_path);
        java_path.clone_from(&download_path);
    } else {
        log::info!("✅ Using Java: {}", java_path);
    }

    // Проверяем что Java работает
    let java_check = crate::utils::create_hidden_command(&java_path)
        .arg("-version")
        .output();
    
    match java_check {
        Ok(output) => {
            if output.status.success() {
                let stderr = String::from_utf8_lossy(&output.stderr);
                log::info!("✅ Java verified: {}", stderr.lines().next().unwrap_or(""));
            } else {
                log::warn!("⚠️ Java path exists but failed to run: {}", java_path);
            }
        }
        Err(e) => {
            log::warn!("⚠️ Cannot execute Java at {}: {}", java_path, e);
        }
    }

    // 5. Строим аргументы запуска через minecraft_lib
    app.emit("launch-status", serde_json::json!({
        "instance_id": &instance_id,
        "status": "classpath",
        "message": "Building classpath and arguments..."
    })).ok();

    let instance_dir = instance_dir(&instance_id);
    let natives_dir = versions_dir().join(mc_version).join("natives");
    std::fs::create_dir_all(&natives_dir).ok();

    // Извлекаем natives
    extract_natives_for_version(mc_version, &natives_dir)?;

    // Строим аргументы через minecraft_lib
    let launch_args = minecraft_lib::build_launch_args(
        &instance,
        &auth,
        &versions_dir(),
        &libraries_dir(),
        &assets_dir(),
        &instance_dir,
    )?;

    log::info!("📦 Main class: {}", launch_args.main_class);
    log::info!("📦 Classpath entries: {}", launch_args.classpath.len());
    log::info!("📦 JVM args: {}", launch_args.jvm_args.len());
    log::info!("📦 Game args: {}", launch_args.game_args.len());

    // 6. Создаём директории игры
    let game_dir = instance_dir.join(".minecraft");
    std::fs::create_dir_all(&game_dir).ok();
    std::fs::create_dir_all(game_dir.join("logs")).ok();

    // 7. Запускаем процесс
    app.emit("launch-status", serde_json::json!({
        "instance_id": &instance_id,
        "status": "launching",
        "message": "Launching Minecraft..."
    })).ok();
    // Prefer using lighty-launcher if available — it handles loaders, mods and JVM better.
    let mut use_lighty = false;
    if which("lighty-launcher").is_ok() || which("npx").is_ok() {
        use_lighty = true;
    }

    if use_lighty {
        // Try to launch via lighty-cli: `lighty-launcher launch --instance <path>`
        let mut cmd_opt = None;
        if which("lighty-launcher").is_ok() {
            let mut c = crate::utils::create_hidden_command("lighty-launcher");
            c.arg("launch");
            c.arg("--instance");
            c.arg(instance_dir.to_string_lossy().to_string());
            cmd_opt = Some(c);
        } else if which("npx").is_ok() {
            let mut c = crate::utils::create_hidden_command("npx");
            c.arg("lighty-launcher");
            c.arg("launch");
            c.arg("--instance");
            c.arg(instance_dir.to_string_lossy().to_string());
            cmd_opt = Some(c);
        }

        if let Some(mut cmd) = cmd_opt {
            cmd.current_dir(&game_dir);
            cmd.stdout(std::process::Stdio::piped());
            cmd.stderr(std::process::Stdio::piped());

            let mut child = cmd.spawn().map_err(|e| {
                log::error!("❌ Failed to spawn lighty process: {}", e);
                format!("Failed to start lighty-launcher: {e}")
            })?;

            let pid = child.id();
            log::info!("✅ lighty-launcher started with PID: {}", pid);
            RUNNING.lock().unwrap().insert(instance_id.clone(), pid);

            // Stream stdout
            if let Some(stdout) = child.stdout.take() {
                let app_s = app.clone();
                let iid_s = instance_id.clone();
                std::thread::spawn(move || {
                    let reader = BufReader::new(stdout);
                    for line in reader.lines().flatten() {
                        let level = detect_log_level(&line);
                        app_s.emit("game-log", serde_json::json!({"source": "minecraft", "instance_id": iid_s, "pid": pid, "stream": "stdout", "line": line, "level": level})).ok();
                    }
                });
            }

            if let Some(stderr) = child.stderr.take() {
                let app_e = app.clone();
                let iid_e = instance_id.clone();
                std::thread::spawn(move || {
                    let reader = BufReader::new(stderr);
                    for line in reader.lines().flatten() {
                        let level = if line.to_uppercase().contains("ERROR") { "error" } else { "stderr" };
                        app_e.emit("game-log", serde_json::json!({"source": "minecraft", "instance_id": iid_e, "pid": pid, "stream": "stderr", "line": line, "level": level})).ok();
                    }
                });
            }

            // Wait asynchronously for the launcher process to exit and report
            let app2 = app.clone();
            let iid = instance_id.clone();
            tokio::task::spawn_blocking(move || {
                match child.wait() {
                    Ok(status) => {
                        RUNNING.lock().unwrap().remove(&iid);
                        let code = status.code().unwrap_or(-1);
                        let status_str = if code == 0 { "stopped" } else { "crashed" };
                        let msg_str = if code == 0 { "Game closed".to_string() } else { format!("Launcher exited with code {}", code) };
                        app2.emit("launch-status", serde_json::json!({"instance_id": iid, "status": status_str, "exit_code": code, "message": msg_str})).ok();
                    }
                    Err(e) => {
                        RUNNING.lock().unwrap().remove(&iid);
                        app2.emit("launch-status", serde_json::json!({"instance_id": iid, "status": "error", "message": format!("Process error: {e}") })).ok();
                    }
                }
            });

            return Ok(LaunchResult { success: true, pid: Some(pid), message: format!("Launched via lighty-launcher (PID {})", pid) });
        }
    }

    // Fallback: launch the Java process directly (original behavior)
    let mut full_args = launch_args.jvm_args.clone();
    
    if launch_args.use_jar {
        // Vanilla Minecraft: используем -jar
        full_args.push("-jar".to_string());
        full_args.push(launch_args.jar_path.clone());
        full_args.extend(launch_args.game_args);
    } else {
        // Forge/Fabric/NeoForge/Quilt: используем -cp
        full_args.push("-cp".to_string());
        full_args.push(launch_args.classpath.join(if cfg!(windows) { ";" } else { ":" }));
        full_args.push(launch_args.main_class.clone());
        full_args.extend(launch_args.game_args);
    }

    log::info!("🚀 Launch command: {} {}", launch_args.java_path, full_args.iter().take(3).cloned().collect::<Vec<String>>().join(" "));

    let mut cmd = crate::utils::create_hidden_command(&launch_args.java_path);
    cmd.args(&full_args);
    cmd.current_dir(&game_dir);
    cmd.stdout(std::process::Stdio::piped());
    cmd.stderr(std::process::Stdio::piped());

    let mut child = cmd.spawn().map_err(|e| {
        log::error!("❌ Failed to spawn Java process: {}", e);
        format!("Failed to start Java: {e}. Java path: {}", launch_args.java_path)
    })?;
    
    let pid = child.id();
    log::info!("✅ Java process started with PID: {}", pid);

    RUNNING.lock().unwrap().insert(instance_id.clone(), pid);

    // Логирование и обработка выхода (оставляем как было)
    let log_ts = chrono::Utc::now().format("%Y%m%d_%H%M%S").to_string();
    let log_path = game_dir.join("logs").join(format!("game-{}.log", log_ts));
    let log_file: Arc<Mutex<Option<std::fs::File>>> = Arc::new(Mutex::new(std::fs::File::create(&log_path).ok()));

    if let Some(stdout) = child.stdout.take() {
        let app_s = app.clone();
        let iid_s = instance_id.clone();
        let lf_s = log_file.clone();
        std::thread::spawn(move || {
            let reader = BufReader::new(stdout);
            for line in reader.lines().flatten() {
                let level = detect_log_level(&line);
                app_s.emit("game-log", serde_json::json!({
                    "source": "minecraft", "instance_id": iid_s, "pid": pid, "stream": "stdout", "line": line, "level": level,
                })).ok();
                if let Some(f) = lf_s.lock().unwrap().as_mut() {
                    writeln!(f, "{}", line).ok();
                }
            }
        });
    }

    if let Some(stderr) = child.stderr.take() {
        let app_e = app.clone();
        let iid_e = instance_id.clone();
        let lf_e = log_file.clone();
        std::thread::spawn(move || {
            let reader = BufReader::new(stderr);
            for line in reader.lines().flatten() {
                let level = if line.to_uppercase().contains("ERROR") || line.to_uppercase().contains("FATAL") { "error" }
                            else if line.to_uppercase().contains("WARN") { "warn" }
                            else { "stderr" };
                app_e.emit("game-log", serde_json::json!({
                    "source": "minecraft", "instance_id": iid_e, "pid": pid, "stream": "stderr", "line": line, "level": level,
                })).ok();
                if let Some(f) = lf_e.lock().unwrap().as_mut() {
                    writeln!(f, "[STDERR] {}", line).ok();
                }
            }
        });
    }

    let app2 = app.clone();
    let iid = instance_id.clone();
    tokio::task::spawn_blocking(move || {
        match child.wait() {
            Ok(status) => {
                RUNNING.lock().unwrap().remove(&iid);
                let code = status.code().unwrap_or(-1);
                let status_str = if code == 0 { "stopped" } else { "crashed" };
                let msg_str = if code == 0 { "Game closed".to_string() } else { format!("Crashed with code {}", code) };
                app2.emit("launch-status", serde_json::json!({
                    "instance_id": iid, "status": status_str, "exit_code": code, "message": msg_str
                })).ok();
            }
            Err(e) => {
                RUNNING.lock().unwrap().remove(&iid);
                app2.emit("launch-status", serde_json::json!({
                    "instance_id": iid, "status": "error", "message": format!("Process error: {e}")
                })).ok();
            }
        }
    });

    Ok(LaunchResult { 
        success: true, 
        pid: Some(pid), 
        message: format!("Minecraft {} launched (PID {})", mc_version, pid) 
    })
}

fn extract_natives_for_version(version: &str, natives_dir: &PathBuf) -> Result<(), String> {
    let vj_path = versions_dir().join(version).join(format!("{}.json", version));
    if let Ok(data) = std::fs::read_to_string(&vj_path) {
        if let Ok(vj) = serde_json::from_str::<serde_json::Value>(&data) {
            let os_cls = super::version_manager::get_os_name();
            let natives_key = format!("natives-{}", os_cls);
            if let Some(libs) = vj["libraries"].as_array() {
                for lib in libs {
                    if !super::version_manager::check_library_rules(lib) { continue; }
                    if let Some(classifiers) = lib["downloads"]["classifiers"].as_object() {
                        if let Some(nat) = classifiers.get(&natives_key) {
                            let lib_path = libraries_dir().join(nat["path"].as_str().unwrap_or(""));
                            if lib_path.exists() { 
                                extract_natives(&lib_path, natives_dir); 
                                log::info!("✅ Extracted natives: {}", lib_path.display());
                            }
                        }
                    }
                }
            }
        }
    }
    Ok(())
}

fn check_asset_mode(version_id: &str) -> String {
    let vj = versions_dir().join(version_id).join(format!("{}.json", version_id));
    std::fs::read_to_string(&vj).ok()
        .and_then(|d| serde_json::from_str::<serde_json::Value>(&d).ok())
        .and_then(|v| {
            let ai = &v["assetIndex"];
            if ai["totalSize"].is_null() { Some("virtual".to_string()) } else { None }
        })
        .unwrap_or_else(|| "new".to_string())
}

fn extract_natives(jar_path: &PathBuf, natives_dir: &PathBuf) {
    if let Ok(data) = std::fs::read(jar_path) {
        if let Ok(mut archive) = zip::ZipArchive::new(std::io::Cursor::new(data)) {
            for i in 0..archive.len() {
                if let Ok(mut entry) = archive.by_index(i) {
                    let name = entry.name().to_string();
                    if name.ends_with(".so") || name.ends_with(".dll") || name.ends_with(".dylib") {
                        let out = natives_dir.join(name.split('/').last().unwrap_or(&name));
                        if !out.exists() {
                            if let Ok(mut f) = std::fs::File::create(&out) {
                                std::io::copy(&mut entry, &mut f).ok();
                            }
                        }
                    }
                }
            }
        }
    }
}

#[allow(dead_code)]
pub async fn legacy_kill_instance(instance_id: String) -> Result<(), String> {
    let pid = { RUNNING.lock().unwrap().remove(&instance_id) };
    if let Some(pid) = pid {
        #[cfg(unix)] unsafe { libc::kill(pid as i32, libc::SIGTERM); }
        #[cfg(windows)] { 
            crate::utils::create_hidden_command("taskkill")
                .args(&["/PID", &pid.to_string(), "/F"])
                .spawn()
                .ok(); 
        }
    }
    Ok(())
}

#[allow(dead_code)]
pub async fn legacy_get_game_logs(instance_id: String) -> Result<String, String> {
    let log_dir = mc_base_dir().join("instances").join(&instance_id).join(".minecraft").join("logs");

    if !log_dir.exists() { return Ok(String::new()); }

    let mut entries: Vec<_> = std::fs::read_dir(&log_dir)
        .map_err(|e| e.to_string())?
        .flatten()
        .filter(|e| {
            let n = e.file_name().to_string_lossy().to_string();
            n.starts_with("game-") && n.ends_with(".log")
        })
        .collect();

    entries.sort_by(|a, b| {
        let ta = a.metadata().ok().and_then(|m| m.modified().ok());
        let tb = b.metadata().ok().and_then(|m| m.modified().ok());
        tb.cmp(&ta)
    });

    if let Some(latest) = entries.first() {
        std::fs::read_to_string(latest.path()).map_err(|e| e.to_string())
    } else {
        Ok(String::new())
    }
}

use serde::{Serialize, Deserialize};
use std::path::{Path, PathBuf};
use tauri::Emitter;

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct JavaInfo {
    pub path: String,
    pub version: String,
    pub major_version: u32,
    pub vendor: String,
    pub managed: bool,
    pub architecture: String,
}

pub fn java_base_dir() -> PathBuf {
    crate::commands::dirs::java_dir()
}

pub fn java_meta_dir() -> PathBuf {
    let p = java_base_dir().join("meta");
    std::fs::create_dir_all(&p).ok(); p
}

pub fn java_cache_dir() -> PathBuf {
    let p = java_base_dir().join("cache");
    std::fs::create_dir_all(&p).ok(); p
}

fn managed_runtime_priority(path: &Path) -> u8 {
    let name = path.to_string_lossy().to_ascii_lowercase();
    if name.contains("temurin") || name.contains("adoptium") { 0 }
    else if name.contains("zulu") { 1 }
    else { 2 }
}

/// Find best available Java for the given major version.
/// Priority: managed Portal Launcher runtime → user JAVA_HOME → validated
/// system PATH → platform JVM paths. A manually selected per-instance/runtime
/// path is handled by the launcher before this automatic resolver is called.
pub fn find_java(major: u32) -> String {
    // 1. Use an exact, 64-bit managed runtime when it is available. These
    // runtimes are tested with Portal Launcher and keep automatic launches
    // stable even if JAVA_HOME changes after another application update.
    let base = java_base_dir();
    if let Ok(entries) = std::fs::read_dir(&base) {
        let mut candidates: Vec<PathBuf> = entries
            .filter_map(|e| e.ok())
            .filter(|e| e.file_type().map(|t| t.is_dir()).unwrap_or(false))
            .map(|e| {
                if cfg!(windows) { e.path().join("bin").join("java.exe") }
                else { e.path().join("bin").join("java") }
            })
            .filter(|p| p.exists())
            .collect();
        
        // Temurin is the automatic Portal Launcher runtime. Zulu remains
        // compatible for users who have selected it explicitly.
        candidates.sort_by_key(|path| managed_runtime_priority(path));
        
        for bin in &candidates {
            if let Some(info) = run_java(&bin.to_string_lossy()) {
                log::info!("🔍 Found managed Java: {} (version={}, vendor={}, managed={})", 
                    bin.display(), info.major_version, info.vendor, info.managed);
                if (info.major_version == major || major == 0) && !info.architecture.eq_ignore_ascii_case("x86") {
                    log::info!("✅ Using managed Java: {}", bin.display());
                    return bin.to_string_lossy().to_string();
                }
            }
        }
    }

    // 2. A compatible user-installed Java is a fallback, so a launcher with no
    // managed runtime does not download another copy unnecessarily.
    if let Ok(jh) = std::env::var("JAVA_HOME") {
        let bin = if cfg!(windows) { PathBuf::from(&jh).join("bin").join("java.exe") }
                  else { PathBuf::from(&jh).join("bin").join("java") };
        if bin.exists() {
            if let Some(info) = run_java(&bin.to_string_lossy()) {
                log::info!("🔍 Found JAVA_HOME Java: {} (version={})", bin.display(), info.major_version);
                if (info.major_version == major || major == 0) && !info.architecture.eq_ignore_ascii_case("x86") {
                    log::info!("Using user-installed Java from JAVA_HOME: {}", bin.display());
                    return bin.to_string_lossy().to_string();
                }
            }
        }
    }

    // 3. System PATH. Deliberately skip Oracle javapath indirection: it can
    // target an unrelated Java after a Windows update even when Java 21 is
    // installed inside Portal Launcher.
    #[cfg(windows)]
    {
        if let Ok(output) = crate::utils::create_hidden_command("where").arg("java").output() {
            for candidate in String::from_utf8_lossy(&output.stdout).lines().map(|line| PathBuf::from(line.trim())) {
                let normalized = candidate.to_string_lossy().replace('/', "\\").to_ascii_lowercase();
                if normalized.contains("\\common files\\oracle\\java\\javapath\\") { continue; }
                if let Some(info) = run_java(&candidate.to_string_lossy()) {
                    if (info.major_version == major || major == 0) && !info.architecture.eq_ignore_ascii_case("x86") {
                        log::info!("Using validated system Java: {}", candidate.display());
                        return candidate.to_string_lossy().to_string();
                    }
                }
            }
        }
    }

    // 4. macOS: /Library/Java/JavaVirtualMachines (Zulu, Temurin, etc.)
    #[cfg(target_os = "macos")]
    {
        let jvm_dir = PathBuf::from("/Library/Java/JavaVirtualMachines");
        if jvm_dir.exists() {
            let mut candidates: Vec<PathBuf> = std::fs::read_dir(&jvm_dir)
                .into_iter()
                .flatten()
                .flatten()
                .map(|e| e.path().join("Contents").join("Home").join("bin").join("java"))
                .filter(|p| p.exists())
                .collect();
            candidates.sort_by_key(|path| managed_runtime_priority(path));
            for bin in candidates {
                if let Some(info) = run_java(&bin.to_string_lossy()) {
                    if info.major_version == major || major == 0 {
                        log::info!("✅ Using macOS system Java: {}", bin.display());
                        return bin.to_string_lossy().to_string();
                    }
                }
            }
        }
    }

    // 5. Linux: /usr/lib/jvm
    #[cfg(target_os = "linux")]
    {
        let jvm_dir = PathBuf::from("/usr/lib/jvm");
        if jvm_dir.exists() {
            if let Ok(entries) = std::fs::read_dir(&jvm_dir) {
                let mut bins: Vec<PathBuf> = entries
                    .filter_map(|e| e.ok())
                    .map(|e| e.path().join("bin").join("java"))
                    .filter(|p| p.exists())
                    .collect();
                bins.sort_by_key(|path| managed_runtime_priority(path));
                for bin in bins {
                    if let Some(info) = run_java(&bin.to_string_lossy()) {
                        if info.major_version == major || major == 0 {
                            log::info!("✅ Using Linux system Java: {}", bin.display());
                            return bin.to_string_lossy().to_string();
                        }
                    }
                }
            }
        }
    }

    log::warn!("No validated Java found for required version {}", major);
    String::new()
}

pub fn run_java(java_path: &str) -> Option<JavaInfo> {
    // Use -version only — -XshowSettings:all is Java 9+ only and fails on Java 8
    // with "Unrecognized option", producing no version output and causing
    // run_java to return None, which leads to infinite re-downloads.
    let out = crate::utils::create_hidden_command(java_path)
        .arg("-version")
        .output().ok()?;
    // java -version prints version info to stderr by spec
    let text = String::from_utf8_lossy(&out.stderr).to_string()
             + &String::from_utf8_lossy(&out.stdout);
    
    // Определяем версию: ищем строку с "java.version =" (не specification/runtime)
    let ver_line = text.lines().find(|l| {
        let trimmed = l.trim();
        trimmed.starts_with("java.version =") || trimmed.contains("version \"")
    })?;
    let ver = ver_line.split('"').nth(1)
        .or_else(|| ver_line.split('=').nth(1))
        .map(|s| s.trim().to_string())
        .unwrap_or_else(|| "unknown".to_string());
    
    // Определяем мажорную версию
    let major = if ver.starts_with("1.") {
        ver.split('.').nth(1).and_then(|s| s.parse().ok()).unwrap_or(8)
    } else {
        ver.split('.').next().and_then(|s| s.parse().ok()).unwrap_or(0)
    };
    
    // Определяем вендора из вывода -version
    // -version выводит: "OpenJDK Runtime Environment Temurin-17.0.9+9"
    let vendor = if text.contains("Temurin") { "Temurin".to_string() }
        else if text.contains("Zulu") { "Zulu".to_string() }
        else if text.contains("Oracle") { "Oracle".to_string() }
        else if text.contains("OpenJDK") { "OpenJDK".to_string() }
        else { String::new() };
    
    // Определяем архитектуру из вывода -version
    // -version выводит: "OpenJDK 64-Bit Server VM" или "OpenJDK Server VM" (32-bit)
    let arch = if text.contains("64-Bit") || text.contains("x86_64") || text.contains("amd64") { "x86_64".to_string() }
        else if text.contains("32-Bit") || text.contains("i386") { "x86".to_string() }
        else if text.contains("aarch64") { "aarch64".to_string() }
        else { std::env::consts::ARCH.to_string() };
    
    // Определяем, является ли Java управляемой (managed)
    let managed = java_path.contains("PortalLauncher")
        || (java_path.contains("java") && !java_path.contains("Program"));
    
    log::info!("🔍 Java detected: path={}, version={}, major={}, vendor={}, managed={}", 
        java_path, ver, major, vendor, managed);
    
    Some(JavaInfo { 
        path: java_path.to_string(), 
        version: ver, 
        major_version: major, 
        vendor, 
        managed, 
        architecture: arch 
    })
}

#[tauri::command]
pub async fn get_java_info(java_path: String) -> Result<JavaInfo, String> {
    let path = if java_path.is_empty() { "java".to_string() } else { java_path };
    run_java(&path).ok_or_else(|| format!("Could not run Java at '{}'", path))
}

/// Detect a validated, 64-bit Java runtime of one exact major version.
/// The strict version match prevents a newer system Java from silently being
/// used for an older Minecraft generation.
#[tauri::command]
pub async fn detect_java_for_version(major_version: u32) -> Result<Option<JavaInfo>, String> {
    let path = find_java(major_version);
    let Some(info) = run_java(&path) else { return Ok(None); };
    if info.major_version == major_version && !info.architecture.eq_ignore_ascii_case("x86") {
        Ok(Some(info))
    } else {
        Ok(None)
    }
}

#[tauri::command]
pub async fn get_managed_java_versions() -> Result<Vec<JavaInfo>, String> {
    let base = java_base_dir();
    let mut result = vec![];
    if let Ok(entries) = std::fs::read_dir(&base) {
        for entry in entries.flatten() {
            if !entry.file_type().map(|t| t.is_dir()).unwrap_or(false) { continue; }
            let bin = if cfg!(windows) { entry.path().join("bin").join("java.exe") }
                      else { entry.path().join("bin").join("java") };
            if let Some(mut info) = run_java(&bin.to_string_lossy()) {
                info.managed = true;
                result.push(info);
            }
        }
    }
    // Also include system java
    if let Some(sys) = run_java("java") { result.push(sys); }
    Ok(result)
}

// ─── Shared extraction helper ──────────────────────────────────────────────────
fn extract_archive<F: Fn(u8, &str) + Send + Sync>(data: &[u8], dest: &PathBuf, ext: &str,
    emit: &F) -> Result<(), String>
{
    std::fs::create_dir_all(dest).map_err(|e| e.to_string())?;
    if ext == "zip" {
        use std::io::{Cursor, Read};
        let mut archive = zip::ZipArchive::new(Cursor::new(data)).map_err(|e| e.to_string())?;
        let total = archive.len();
        for i in 0..total {
            let mut entry = archive.by_index(i).map_err(|e| e.to_string())?;
            let name = entry.name().to_string();
            let rel = if name.starts_with("bin/") || name.starts_with("Contents/") { name.as_str() } else { name.splitn(2, '/').nth(1).unwrap_or(&name) };
            if rel.is_empty() { continue; }
            let out = dest.join(rel);
            if entry.is_dir() { std::fs::create_dir_all(&out).ok(); }
            else {
                if let Some(p) = out.parent() { std::fs::create_dir_all(p).ok(); }
                let mut buf = vec![];
                entry.read_to_end(&mut buf).ok();
                std::fs::write(&out, buf).ok();
            }
            if i % 50 == 0 { emit(60 + (i * 35 / total.max(1)) as u8, &format!("Extracting {}/{}", i, total)); }
        }
    } else {
        use flate2::read::GzDecoder;
        use tar::Archive;
        let gz = GzDecoder::new(std::io::Cursor::new(data));
        let mut archive = Archive::new(gz);
        let entries_v: Vec<_> = archive.entries().map_err(|e| e.to_string())?.collect::<Result<Vec<_>,_>>().map_err(|e| e.to_string())?;
        let total_f = entries_v.len();
        // Re-open for extraction
        let gz2 = GzDecoder::new(std::io::Cursor::new(data));
        let mut archive2 = Archive::new(gz2);
        for (i, entry) in archive2.entries().map_err(|e| e.to_string())?.enumerate() {
            let mut e = entry.map_err(|e| e.to_string())?;
            let path = e.path().map_err(|e| e.to_string())?.to_path_buf();
            let first = path.components().next().and_then(|part| part.as_os_str().to_str()).unwrap_or("");
            let rel: PathBuf = if first == "bin" || first == "Contents" { path.clone() } else { path.components().skip(1).collect() };
            if rel.as_os_str().is_empty() { continue; }
            let out = dest.join(&rel);
            if let Some(p) = out.parent() { std::fs::create_dir_all(p).ok(); }
            e.unpack(&out).ok();
            #[cfg(unix)] {
                use std::os::unix::fs::PermissionsExt;
                if let Ok(mode) = e.header().mode() {
                    std::fs::set_permissions(&out, std::fs::Permissions::from_mode(mode)).ok();
                }
            }
            if i % 50 == 0 { emit(60 + (i * 35 / total_f.max(1)) as u8, &format!("Extracting {}/{}", i, total_f)); }
        }
    }
    Ok(())
}

fn locate_java_binary(root: &Path) -> Option<PathBuf> {
    let binary = if cfg!(windows) { "java.exe" } else { "java" };
    let direct = root.join("bin").join(binary);
    if direct.exists() { return Some(direct); }
    let mut stack = vec![(root.to_path_buf(), 0u8)];
    while let Some((dir, depth)) = stack.pop() {
        if depth > 5 { continue; }
        let entries = std::fs::read_dir(&dir).ok()?;
        for entry in entries.flatten() {
            let path = entry.path();
            if path.is_dir() {
                if path.file_name().and_then(|name| name.to_str()) == Some("bin") {
                    let candidate = path.join(binary);
                    if candidate.exists() { return Some(candidate); }
                } else {
                    stack.push((path, depth + 1));
                }
            }
        }
    }
    None
}

// ─── Zulu download ────────────────────────────────────────────────────────────
/// Download Azul Zulu JDK — preferred for ARM (Apple Silicon M1/M2/M3) and Windows/Linux.
/// Returns the path to the java binary, or an error string.
async fn download_zulu<F: Fn(u8, &str) + Send + Sync>(
    client: &reqwest::Client,
    major_version: u32,
    emit: &F,
) -> Result<String, String> {
    let (zulu_os, zulu_arch, ext) = if cfg!(target_os = "windows") {
        ("windows", "x86_64", "zip")
    } else if cfg!(target_os = "macos") {
        ("macos", if cfg!(target_arch = "aarch64") { "aarch64" } else { "x86_64" }, "tar.gz")
    } else {
        ("linux", if cfg!(target_arch = "aarch64") { "aarch64" } else { "x86_64" }, "tar.gz")
    };

    let api_url = format!(
        "https://api.azul.com/metadata/v1/zulu/packages/?java_version={}&os={}&arch={}&java_package=jdk&release_type=ga&archive_type={}&page_size=1",
        major_version, zulu_os, zulu_arch, ext
    );

    emit(5, &format!("Fetching Zulu JDK {} for {} {}...", major_version, zulu_os, zulu_arch));

    let pkgs: serde_json::Value = client.get(&api_url).send().await
        .map_err(|e| format!("Zulu API: {e}"))?.json().await
        .map_err(|e| format!("Zulu parse: {e}"))?;

    let pkg = pkgs.as_array().and_then(|a| a.first()).ok_or("No Zulu release found for this platform")?;
    let download_url = pkg["download_url"].as_str().ok_or("Zulu: missing download_url")?.to_string();
    let java_ver = pkg["java_version"].as_array()
        .and_then(|v| v.first()).and_then(|v| v.as_u64()).unwrap_or(major_version as u64);
    let pkg_name = pkg["name"].as_str().unwrap_or("zulu-jdk").to_string();

    emit(10, &format!("Downloading Zulu JDK {} ({})...", java_ver, pkg_name));

    let resp = client.get(&download_url).send().await.map_err(|e| format!("Download: {e}"))?
        .error_for_status().map_err(|e| format!("Zulu download HTTP error: {e}"))?;
    let data: Vec<u8> = resp.bytes().await.map_err(|e| e.to_string())?.to_vec();

    emit(55, "Extracting Zulu JDK...");
    let base = java_base_dir();
    let dir_name = format!("zulu-jdk{}-{}", major_version, zulu_arch);
    let dest = base.join(&dir_name);
    let _ = std::fs::remove_dir_all(&dest);

    extract_archive(&data, &dest, ext, emit)?;

    let java_bin = locate_java_binary(&dest).ok_or_else(|| format!("Zulu Java binary was not found after extracting {}", dest.display()))?;

    emit(100, &format!("Azul Zulu JDK {} installed!", java_ver));
    Ok(java_bin.to_string_lossy().to_string())
}

// ─── Adoptium Temurin fallback ────────────────────────────────────────────────
async fn download_temurin<F: Fn(u8, &str) + Send + Sync>(
    client: &reqwest::Client,
    major_version: u32,
    emit: &F,
) -> Result<String, String> {
    let (os, arch, ext) = if cfg!(target_os = "windows") { ("windows", "x64", "zip") }
        else if cfg!(target_os = "macos") { ("mac", if cfg!(target_arch = "aarch64") { "aarch64" } else { "x64" }, "tar.gz") }
        else { ("linux", "x64", "tar.gz") };

    emit(5, &format!("Fetching Temurin JDK {}...", major_version));

    let api_url = format!(
        "https://api.adoptium.net/v3/assets/latest/{}/hotspot?os={}&architecture={}&image_type=jdk",
        major_version, os, arch
    );
    let releases: serde_json::Value = client.get(&api_url).send().await
        .map_err(|e| format!("Adoptium: {e}"))?.json().await
        .map_err(|e| format!("Adoptium parse: {e}"))?;

    let release = releases.as_array().and_then(|a| a.first()).ok_or("No Temurin release found")?;
    let bin_obj = release["binary"].as_object().ok_or("No binary")?;
    let pkg = bin_obj["package"].as_object().ok_or("No package")?;
    let download_url = pkg["link"].as_str().ok_or("No download link")?.to_string();
    let actual_version = release["version"]["semver"].as_str().unwrap_or("").to_string();

    emit(10, &format!("Downloading Temurin {}...", actual_version));

    let resp = client.get(&download_url).send().await.map_err(|e| format!("Download: {e}"))?
        .error_for_status().map_err(|e| format!("Temurin download HTTP error: {e}"))?;
    let data: Vec<u8> = resp.bytes().await.map_err(|e| e.to_string())?.to_vec();

    emit(55, "Extracting Temurin JDK...");
    let base = java_base_dir();
    let dir_name = format!("temurin-jdk{}-{}", major_version, actual_version.replace('.', "_"));
    let dest = base.join(&dir_name);
    let _ = std::fs::remove_dir_all(&dest);
    extract_archive(&data, &dest, ext, emit)?;

    let java_bin = locate_java_binary(&dest).ok_or_else(|| format!("Temurin Java binary was not found after extracting {}", dest.display()))?;

    emit(100, &format!("Temurin JDK {} installed!", actual_version));
    Ok(java_bin.to_string_lossy().to_string())
}

/// Download the automatic Portal Launcher runtime: Adoptium Temurin JDK.
/// Azul Zulu remains available through the explicit user-facing command, but
/// automatic Minecraft and loader preparation must use the same Temurin build.
#[tauri::command]
pub async fn download_java(app: tauri::AppHandle, major_version: u32) -> Result<String, String> {
    // Check if a managed runtime for this version already exists.
    // This prevents the infinite re-download loop where the launcher
    // downloads Java, returns "prepared", and then re-downloads on
    // the next launch attempt because run_java couldn't detect the
    // version string in the expected format.
    let base = java_base_dir();
    if let Ok(entries) = std::fs::read_dir(&base) {
        for entry in entries.flatten() {
            if !entry.file_type().map(|t| t.is_dir()).unwrap_or(false) { continue; }
            let bin = if cfg!(windows) { entry.path().join("bin").join("java.exe") }
                      else { entry.path().join("bin").join("java") };
            if !bin.exists() { continue; }
            if let Some(info) = run_java(&bin.to_string_lossy()) {
                if info.major_version == major_version {
                    log::info!("✅ Reusing already-downloaded Java {} at {}", major_version, bin.display());
                    return Ok(bin.to_string_lossy().to_string());
                }
            } else {
                // run_java failed to parse version, but the binary exists.
                // Try to infer the version from the directory name.
                let dir_name = entry.file_name().to_string_lossy().to_string();
                if dir_name.contains(&format!("jdk{}", major_version))
                    || dir_name.contains(&format!("temurin-jdk{}", major_version))
                    || dir_name.contains(&format!("zulu-jdk{}", major_version))
                {
                    log::info!("✅ Reusing Java {} (inferred from dir name) at {}", major_version, bin.display());
                    return Ok(bin.to_string_lossy().to_string());
                }
            }
        }
    }

    let emit = move |pct: u8, msg: &str| {
        app.emit("java-download", serde_json::json!({
            "percent": pct, "message": msg, "version": major_version
        })).ok();
    };

    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(600))
        .user_agent("PortalLauncher/1.3")
        .build().map_err(|e| e.to_string())?;

    download_temurin(&client, major_version, &emit).await
}

/// Explicitly download Azul Zulu JDK (for ARM / Apple Silicon preference).
#[tauri::command]
pub async fn download_java_zulu(app: tauri::AppHandle, major_version: u32) -> Result<String, String> {
    let emit = move |pct: u8, msg: &str| {
        app.emit("java-download", serde_json::json!({
            "percent": pct, "message": msg, "version": major_version, "vendor": "zulu"
        })).ok();
    };
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(600))
        .user_agent("PortalLauncher/1.3")
        .build().map_err(|e| e.to_string())?;
    download_zulu(&client, major_version, &emit).await
}

/// Explicitly download Eclipse Adoptium Temurin JDK chosen by the player.
#[tauri::command]
pub async fn download_java_temurin(app: tauri::AppHandle, major_version: u32) -> Result<String, String> {
    let emit = move |pct: u8, msg: &str| {
        app.emit("java-download", serde_json::json!({
            "percent": pct, "message": msg, "version": major_version, "vendor": "temurin"
        })).ok();
    };
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(600))
        .user_agent("PortalLauncher/1.3")
        .build().map_err(|e| e.to_string())?;
    download_temurin(&client, major_version, &emit).await
}

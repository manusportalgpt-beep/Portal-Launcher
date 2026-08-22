use serde::{Serialize, Deserialize};
use std::path::PathBuf;

#[derive(Serialize, Deserialize, Debug)]
pub struct LoaderInstallResult {
    pub success: bool,
    pub loader: String,
    pub version: String,
    pub message: String,
}

fn mc_base_dir() -> PathBuf {
    crate::commands::version_manager::mc_base_dir()
}

/// Official Forge-family client installers create a launcher profile in the
/// shared Minecraft root. Portal Launcher keeps game data per instance, so a
/// minimal profile store must exist in that shared root before invoking them.
fn ensure_launcher_profile_store(base_dir: &std::path::Path) -> Result<(), String> {
    std::fs::create_dir_all(base_dir)
        .map_err(|error| format!("Не удалось подготовить папку Minecraft {}: {error}", base_dir.display()))?;
    let profile_path = base_dir.join("launcher_profiles.json");
    if !profile_path.exists() {
        std::fs::write(&profile_path, r#"{"profiles":{},"settings":{},"version":3}"#)
            .map_err(|error| format!("Не удалось создать launcher_profiles.json: {error}"))?;
    }
    Ok(())
}

/// Required Java major version for a given MC version string (1.7.2 – latest).
fn java_major_for_mc(mc_version: &str) -> u32 {
    let parts: Vec<u32> = mc_version.split('.').filter_map(|part| part.parse::<u32>().ok()).collect();
    // Minecraft 26.x (including 26.2) is built for Java 25.
    if parts.first().copied().unwrap_or(1) >= 26 {
        25
    } else {
        let minor = parts.get(1).copied().unwrap_or(0);
        if minor <= 16 { 8 }
        else if minor == 17 { 16 }
        else if minor == 20 && parts.get(2).copied().unwrap_or(0) < 5 { 17 }
        else { 21 }
    }
}

fn installer_failure(output: &std::process::Output) -> String {
    let details = format!(
        "{}\n{}",
        String::from_utf8_lossy(&output.stdout),
        String::from_utf8_lossy(&output.stderr),
    );
    let tail = details
        .lines()
        .map(str::trim)
        .filter(|line| !line.is_empty())
        .rev()
        .take(8)
        .collect::<Vec<_>>()
        .into_iter()
        .rev()
        .collect::<Vec<_>>()
        .join("\n");
    let code = output.status.code().map(|value| value.to_string()).unwrap_or_else(|| "неизвестен".to_string());
    if tail.is_empty() { format!("установщик завершился с кодом {code} без вывода") }
    else { format!("код {code}: {tail}") }
}

fn installer_failure_with_network_hint(output: &std::process::Output) -> String {
    let details = format!(
        "{}\n{}",
        String::from_utf8_lossy(&output.stdout),
        String::from_utf8_lossy(&output.stderr),
    );
    if details.contains("libraries.minecraft.net")
        || details.contains("launchermeta.mojang.com")
        || details.contains("piston-meta.mojang.com")
        || details.contains("sessionserver.mojang.com")
    {
        "Нет соединения с серверами Minecraft, нужными установщику. Проверьте доступ к Minecraft/Mojang и повторите запуск: профиль загрузчика не был создан.".to_string()
    } else {
        installer_failure(output)
    }
}

/// Return only a verified, exact and 64-bit Java. Running a loader installer
/// through Oracle javapath with an unrelated major version produces an opaque
/// installer failure, so refuse it before launching the installer process.
fn verified_java(major: u32, purpose: &str) -> Result<String, String> {
    let path = super::jvm::find_java(major);
    let Some(info) = super::jvm::run_java(&path) else {
        return Err(format!("Для {purpose} требуется Java {major}, но Java не удалось запустить. Установите или выберите Java {major} в Настройки → Minecraft."));
    };
    if info.major_version != major || info.architecture.eq_ignore_ascii_case("x86") {
        return Err(format!("Для {purpose} требуется 64-битная Java {major}, но найдено Java {} ({}, {}). Выберите Java {major} в Настройки → Minecraft; Oracle javapath не будет использован.", info.major_version, info.vendor, info.architecture));
    }
    Ok(path)
}

fn find_java_for_mc(mc_version: &str) -> Result<String, String> {
    let major = java_major_for_mc(mc_version);
    verified_java(major, &format!("установки загрузчика для Minecraft {mc_version}"))
}

fn is_modern_quilt_target(mc_version: &str) -> bool {
    mc_version.split('.').next().and_then(|part| part.parse::<u32>().ok()).unwrap_or(0) >= 26
}

async fn download_bytes(client: &reqwest::Client, url: &str) -> Result<bytes::Bytes, String> {
    client.get(url).send().await
        .map_err(|e| format!("GET {url}: {e}"))?.bytes().await
        .map_err(|e| format!("read: {e}"))
}

/// Maven mirrors and captive/error pages can return HTTP-success HTML that was
/// previously written straight to `*-installer.jar`. Java then only reports an
/// opaque "Invalid or corrupt jarfile" error. Validate the response before it
/// reaches disk, atomically replace the target, and retry once from a clean
/// path for Forge-family installers.
async fn download_verified_installer_jar(
    client: &reqwest::Client,
    loader: &str,
    url: &str,
    jar_path: &std::path::Path,
) -> Result<(), String> {
    let mut last_error = String::new();
    for attempt in 1..=2 {
        let result = async {
            let response = client
                .get(url)
                .header(reqwest::header::ACCEPT, "application/java-archive, application/octet-stream;q=0.9, */*;q=0.1")
                .send()
                .await
                .map_err(|error| format!("GET {url}: {error}"))?;
            let status = response.status();
            let content_type = response
                .headers()
                .get(reqwest::header::CONTENT_TYPE)
                .and_then(|value| value.to_str().ok())
                .unwrap_or("")
                .to_ascii_lowercase();
            if !status.is_success() {
                return Err(format!("сервер вернул HTTP {status}"));
            }
            if content_type.contains("text/html") || content_type.contains("text/plain") || content_type.contains("application/json") {
                return Err(format!("сервер вернул {content_type}, а не Java-архив"));
            }

            let bytes = response.bytes().await.map_err(|error| format!("не удалось прочитать ответ: {error}"))?;
            let jar_magic = bytes.starts_with(b"PK\x03\x04") || bytes.starts_with(b"PK\x05\x06") || bytes.starts_with(b"PK\x07\x08");
            if bytes.len() < 4096 || !jar_magic {
                return Err(format!("получен невалидный JAR ({} байт, отсутствует ZIP-сигнатура)", bytes.len()));
            }

            let part_path = jar_path.with_extension(format!("jar.part-{attempt}"));
            std::fs::remove_file(&part_path).ok();
            std::fs::write(&part_path, &bytes).map_err(|error| format!("не удалось записать временный JAR: {error}"))?;
            std::fs::remove_file(jar_path).ok();
            std::fs::rename(&part_path, jar_path).map_err(|error| format!("не удалось заменить installer JAR: {error}"))?;
            Ok::<(), String>(())
        }.await;

        match result {
            Ok(()) => return Ok(()),
            Err(error) => {
                std::fs::remove_file(jar_path).ok();
                std::fs::remove_file(jar_path.with_extension(format!("jar.part-{attempt}"))).ok();
                last_error = error;
            }
        }
    }
    Err(format!("{loader}: {last_error}. Повреждённый installer JAR удалён; повторная чистая загрузка не дала корректный архив"))
}

fn maven_versions(xml: &str) -> Vec<String> {
    let mut versions = Vec::new();
    let mut remainder = xml;
    while let Some(start) = remainder.find("<version>") {
        let after_start = &remainder[start + 9..];
        let Some(end) = after_start.find("</version>") else { break; };
        let version = after_start[..end].trim();
        if !version.is_empty() { versions.push(version.to_string()); }
        remainder = &after_start[end + 10..];
    }
    versions
}

/// Forge build numbers are scoped to the complete Minecraft version. Comparing
/// split coordinates prevents 1.21.1 from accepting a build for 1.21.11.
fn forge_builds_for_mc(xml: &str, mc_version: &str) -> Vec<String> {
    maven_versions(xml)
        .into_iter()
        .filter_map(|coordinate| {
            let (candidate_mc, build) = coordinate.split_once('-')?;
            (candidate_mc == mc_version && !build.is_empty()).then(|| build.to_string())
        })
        .collect()
}

async fn forge_builds_for_mc_from_maven(client: &reqwest::Client, mc_version: &str) -> Result<Vec<String>, String> {
    let response = client
        .get("https://maven.minecraftforge.net/net/minecraftforge/forge/maven-metadata.xml")
        .send().await.map_err(|error| format!("Forge metadata: {error}"))?;
    if !response.status().is_success() {
        return Err(format!("Forge metadata: HTTP {}", response.status()));
    }
    let xml = response.text().await.map_err(|error| format!("Forge metadata: {error}"))?;
    let builds = forge_builds_for_mc(&xml, mc_version);
    if builds.is_empty() { Err(format!("Для Forge нет совместимой версии под Minecraft {mc_version}")) }
    else { Ok(builds) }
}

fn neoforge_versions_for_mc(xml: &str, mc_version: &str) -> Vec<String> {
    let prefix = format!("{}.", mc_version.trim_start_matches("1."));
    let mut versions: Vec<String> = maven_versions(xml).into_iter().filter(|version| version.starts_with(&prefix)).collect();
    versions.sort_by(|left, right| compare_neoforge_versions(right, left));
    versions.dedup();
    versions
}

/// NeoForge's build component is numeric. Lexicographic ordering is incorrect:
/// `21.1.99` sorts above `21.1.219` as text, which can launch an outdated
/// profile even though installed mods require the newer runtime.
fn compare_neoforge_versions(left: &str, right: &str) -> std::cmp::Ordering {
    let numeric_parts = |version: &str| {
        version
            .split('.')
            .map(|part| {
                part.chars()
                    .take_while(|character| character.is_ascii_digit())
                    .collect::<String>()
                    .parse::<u32>()
                    .unwrap_or(0)
            })
            .collect::<Vec<_>>()
    };
    let left_parts = numeric_parts(left);
    let right_parts = numeric_parts(right);
    let length = left_parts.len().max(right_parts.len());
    for index in 0..length {
        match left_parts.get(index).copied().unwrap_or(0).cmp(&right_parts.get(index).copied().unwrap_or(0)) {
            std::cmp::Ordering::Equal => {}
            ordering => return ordering,
        }
    }
    left.cmp(right)
}

pub fn neoforge_version_satisfies(candidate: &str, minimum: &str) -> bool {
    compare_neoforge_versions(candidate, minimum) != std::cmp::Ordering::Less
}

pub async fn latest_neoforge_version_at_least(mc_version: &str, minimum: &str) -> Result<String, String> {
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(30))
        .user_agent("PortalLauncher/1.3")
        .build()
        .map_err(|error| error.to_string())?;
    let xml = client
        .get("https://maven.neoforged.net/releases/net/neoforged/neoforge/maven-metadata.xml")
        .send()
        .await
        .map_err(|error| format!("NeoForge metadata: {error}"))?
        .text()
        .await
        .map_err(|error| format!("NeoForge metadata: {error}"))?;
    neoforge_versions_for_mc(&xml, mc_version)
        .into_iter()
        .find(|candidate| neoforge_version_satisfies(candidate, minimum))
        .ok_or_else(|| format!("Для Minecraft {mc_version} нет NeoForge версии не ниже {minimum}"))
}

async fn latest_forge_version(client: &reqwest::Client, mc_version: &str) -> Result<String, String> {
    forge_builds_for_mc_from_maven(client, mc_version).await?
        .into_iter()
        .last()
        .ok_or_else(|| format!("Для Forge нет совместимой версии под Minecraft {mc_version}"))
}

/// Install Fabric loader – 1.14+ to latest snapshots.
#[tauri::command]
pub async fn install_fabric(mc_version: String, loader_version: String, instance_dir: String) -> Result<LoaderInstallResult, String> {
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(180))
        .user_agent("PortalLauncher/1.3").build().map_err(|e| e.to_string())?;

    let mc_minor: u32 = mc_version.split('.').nth(1).unwrap_or("0").parse().unwrap_or(0);
    if mc_minor < 14 {
        return Ok(LoaderInstallResult {
            success: false, loader: "fabric".into(), version: loader_version,
            message: "Fabric не поддерживает версии ниже 1.14. Используйте Forge.".into(),
        });
    }

    let lv = if loader_version.is_empty() {
        let meta_url = format!("https://meta.fabricmc.net/v2/versions/loader/{}", mc_version);
        let meta: serde_json::Value = client.get(&meta_url)
            .send().await.map_err(|e| e.to_string())?.json().await.map_err(|e| e.to_string())?;
        meta.as_array().and_then(|a| a.first())
            .and_then(|v| v["loader"]["version"].as_str().or_else(|| v["version"].as_str()))
            .unwrap_or("0.16.9").to_string()
    } else { loader_version };

    let installer_url = "https://maven.fabricmc.net/net/fabricmc/fabric-installer/1.0.1/fabric-installer-1.0.1.jar";
    let jar_path = mc_base_dir().join("fabric-installer.jar");
    std::fs::write(&jar_path, &download_bytes(&client, installer_url).await?).map_err(|e| e.to_string())?;

    // Use the exact runtime required by the selected Minecraft version. A
    // fixed Java 17 installer path breaks current Fabric targets that require
    // Java 21 or Java 25, even though the launcher itself resolves them
    // correctly at game start.
    let java = find_java_for_mc(&mc_version)?;
    let output = crate::utils::create_hidden_command(&java)
        .args(&["-jar", &jar_path.to_string_lossy(), "client",
            "-mcversion", &mc_version, "-loader", &lv,
            "-dir", &instance_dir, "-noprofile"])
        .output().map_err(|e| format!("Run Fabric ({java}): {e}"))?;

    std::fs::remove_file(&jar_path).ok();
    Ok(LoaderInstallResult {
        success: output.status.success(), loader: "fabric".into(), version: lv,
        message: if output.status.success() { "Fabric installed successfully".into() }
                 else { format!("Не удалось установить Fabric: {}", installer_failure(&output)) },
    })
}

/// Install Forge – 1.7.2 to latest (full installer flow).
#[tauri::command]
pub async fn install_forge(mc_version: String, forge_version: String, _instance_dir: String) -> Result<LoaderInstallResult, String> {
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(300))
        .user_agent("PortalLauncher/1.3").build().map_err(|e| e.to_string())?;

    // Forge does not ship releases for snapshots
    if mc_version.contains('w') || mc_version.contains("-pre") || mc_version.contains("-rc") {
        return Ok(LoaderInstallResult {
            success: false, loader: "forge".into(), version: forge_version,
            message: "Forge не поддерживает снапшоты. Используйте Fabric/Quilt.".into(),
        });
    }

    let available_builds = forge_builds_for_mc_from_maven(&client, &mc_version).await?;
    let requested_version = forge_version.trim().to_string();
    let requested_build = requested_version
        .strip_prefix(&format!("{mc_version}-"))
        .unwrap_or(&requested_version)
        .to_string();
    let fallback_notice = !requested_build.is_empty() && !available_builds.contains(&requested_build);
    let selected_version = if requested_build.is_empty() {
        available_builds.last().cloned().ok_or_else(|| format!("Для Forge нет совместимой версии под Minecraft {mc_version}"))?
    } else if available_builds.contains(&requested_build) {
        requested_build
    } else {
        // Stale instances may retain a build from another Minecraft branch.
        // Use the latest exact build rather than requesting a guaranteed-404 URL.
        available_builds.last().cloned().ok_or_else(|| format!("Для Forge нет совместимой версии под Minecraft {mc_version}"))?
    };
    let full_ver = if selected_version.starts_with(&format!("{mc_version}-")) { selected_version }
                   else { format!("{}-{}", mc_version, selected_version) };

    let installer_url = format!(
        "https://maven.minecraftforge.net/net/minecraftforge/forge/{v}/forge-{v}-installer.jar",
        v = full_ver
    );

    let safe_ver = full_ver.replace(':', "-");
    let jar_path = mc_base_dir().join(format!("forge-{}-installer.jar", safe_ver));
    if let Err(error) = download_verified_installer_jar(&client, "Forge", &installer_url, &jar_path).await {
        return Ok(LoaderInstallResult {
            success: false, loader: "forge".into(), version: full_ver,
            message: format!("Не удалось получить корректный installer JAR Forge: {error}"),
        });
    }

    let shared_base = mc_base_dir();
    ensure_launcher_profile_store(&shared_base)?;
    let java = find_java_for_mc(&mc_version)?;
    let jar_str = jar_path.to_string_lossy().to_string();

    // Pre-1.13 Forge installers don't accept a target directory; they install to ~/.minecraft.
    let mc_minor: u32 = mc_version.split('.').nth(1).unwrap_or("0").parse().unwrap_or(0);
    let args: Vec<String> = if mc_minor <= 12 {
        vec!["-jar".into(), jar_str, "--installClient".into()]
    } else {
        vec!["-jar".into(), jar_str, "--installClient".into(), shared_base.to_string_lossy().to_string()]
    };

    let output = crate::utils::create_hidden_command(&java)
        .args(&args)
        .output().map_err(|e| format!("Run Forge ({java}): {e}"))?;

    std::fs::remove_file(&jar_path).ok();
    Ok(LoaderInstallResult {
        success: output.status.success(), loader: "forge".into(), version: full_ver.clone(),
        message: if output.status.success() {
            if fallback_notice {
                format!("Запрошенная Forge {} несовместима с Minecraft {}; установлена совместимая {}", requested_version, mc_version, full_ver)
            } else { "Forge installed".into() }
        }
                 else { format!("Не удалось установить Forge: {}", installer_failure_with_network_hint(&output)) },
    })
}

/// Install Quilt loader – 1.14+ to latest.
#[tauri::command]
pub async fn install_quilt(mc_version: String, loader_version: String, _instance_dir: String) -> Result<LoaderInstallResult, String> {
    // Quilt is installed through the official installer below. Do not route it
    // through lighty/npx: that path can reuse a stale loader version and does
    // not guarantee the release-specific Quilt metadata or gameDir arguments.
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(180))
        .user_agent("PortalLauncher/1.3").build().map_err(|e| e.to_string())?;

    let requested_is_old = !loader_version.trim().is_empty()
        && is_modern_quilt_target(&mc_version)
        && (loader_version.contains("beta") || loader_version.contains("alpha")
            || loader_version.starts_with("0.20.") || loader_version.starts_with("0.21.")
            || loader_version.starts_with("0.22.") || loader_version.starts_with("0.23.")
            || loader_version.starts_with("0.24.") || loader_version.starts_with("0.25."));
    let lv = if loader_version.trim().is_empty() || requested_is_old {
        let meta_url = format!("https://meta.quiltmc.org/v3/versions/loader/{mc_version}");
        let meta: serde_json::Value = client.get(&meta_url)
            .send().await.map_err(|e| format!("Quilt metadata: {e}"))?
            .json().await.map_err(|e| format!("Quilt metadata JSON: {e}"))?;
        let versions = meta.as_array().ok_or_else(|| format!("Quilt has no loader builds for Minecraft {mc_version}"))?;
        versions.iter()
            .filter(|entry| entry["loader"]["stable"].as_bool().unwrap_or(false)
                && entry["loader"]["version"].as_str().is_some())
            .chain(versions.iter())
            .find_map(|entry| entry["loader"]["version"].as_str())
            .ok_or_else(|| format!("Quilt has no compatible loader for Minecraft {mc_version}"))?
            .to_string()
    } else { loader_version };

    let installer_url = "https://quiltmc.org/api/v1/download-latest-installer/java-universal";
    let jar_path = mc_base_dir().join("quilt-installer.jar");
    if let Err(error) = download_verified_installer_jar(&client, "Quilt", installer_url, &jar_path).await {
        return Ok(LoaderInstallResult {
            success: false, loader: "quilt".into(), version: lv,
            message: format!("Не удалось получить корректный installer JAR Quilt: {error}"),
        });
    }

    let shared_base = mc_base_dir();
    ensure_launcher_profile_store(&shared_base)?;
    let java = find_java_for_mc(&mc_version)?;
    let output = crate::utils::create_hidden_command(&java)
        .args(&["-jar", &jar_path.to_string_lossy(), "install", "client",
            &mc_version, &lv, "--install-dir", &shared_base.to_string_lossy()])
        .output().map_err(|e| format!("Run Quilt ({java}): {e}"))?;

    std::fs::remove_file(&jar_path).ok();
    Ok(LoaderInstallResult {
        success: output.status.success(), loader: "quilt".into(), version: lv,
        message: if output.status.success() { "Quilt installed".into() }
                 else { format!("Не удалось установить Quilt: {}", installer_failure(&output)) },
    })
}

/// Install NeoForge – 1.20.1+ including 26.x snapshots.
#[tauri::command]
pub async fn install_neoforge(mc_version: String, neoforge_version: String, _instance_dir: String) -> Result<LoaderInstallResult, String> {
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(300))
        .user_agent("PortalLauncher/1.3").build().map_err(|e| e.to_string())?;

    let mc_minor: u32 = mc_version.split('.').nth(1).unwrap_or("0").parse().unwrap_or(0);
    if mc_minor < 20 {
        return Ok(LoaderInstallResult {
            success: false, loader: "neoforge".into(), version: neoforge_version,
            message: "NeoForge требует Minecraft 1.20.1 или новее.".into(),
        });
    }

    let nfv = if neoforge_version.is_empty() {
        let xml = client.get("https://maven.neoforged.net/releases/net/neoforged/neoforge/maven-metadata.xml")
            .send().await.map_err(|e| e.to_string())?.text().await.map_err(|e| e.to_string())?;
        neoforge_versions_for_mc(&xml, &mc_version).into_iter().next()
            .ok_or_else(|| format!("Для NeoForge нет совместимой сборки под Minecraft {mc_version}. Выберите другую версию Minecraft или загрузчик."))?
    } else { neoforge_version };

    let installer_url = format!(
        "https://maven.neoforged.net/releases/net/neoforged/neoforge/{v}/neoforge-{v}-installer.jar",
        v = nfv
    );
    let jar_path = mc_base_dir().join(format!("neoforge-{}-installer.jar", nfv));
    if let Err(error) = download_verified_installer_jar(&client, "NeoForge", &installer_url, &jar_path).await {
        return Ok(LoaderInstallResult {
            success: false, loader: "neoforge".into(), version: nfv,
            message: format!("Не удалось получить корректный installer JAR NeoForge: {error}"),
        });
    }

    // NeoForge follows the Minecraft runtime requirement: 1.20.1 uses Java
    // 17, modern 1.21.x uses Java 21, and 26.x uses Java 25. Keep installer
    // and game launch on the same verified managed runtime.
    let shared_base = mc_base_dir();
    ensure_launcher_profile_store(&shared_base)?;
    let java = find_java_for_mc(&mc_version)?;
    let output = crate::utils::create_hidden_command(&java)
        .args(&["-jar", &jar_path.to_string_lossy(), "--installClient", &shared_base.to_string_lossy()])
        .output().map_err(|e| format!("Run NeoForge ({java}): {e}"))?;

    std::fs::remove_file(&jar_path).ok();
    Ok(LoaderInstallResult {
        success: output.status.success(), loader: "neoforge".into(), version: nfv,
        message: if output.status.success() { "NeoForge installed successfully".into() }
                 else { format!("Не удалось установить NeoForge: {}", installer_failure_with_network_hint(&output)) },
    })
}

/// Get available Fabric loader versions for a given MC version.
#[tauri::command]
pub async fn get_fabric_versions(mc_version: String) -> Result<Vec<serde_json::Value>, String> {
    let client = reqwest::Client::builder().user_agent("PortalLauncher/1.3").build().map_err(|e| e.to_string())?;
    let url = format!("https://meta.fabricmc.net/v2/versions/loader/{}", mc_version);
    let data: serde_json::Value = client.get(&url).send().await.map_err(|e| e.to_string())?.json().await.map_err(|e| e.to_string())?;
    Ok(data.as_array().cloned().unwrap_or_default())
}

/// Get ALL available Forge versions for a given MC version from Maven metadata (1.7.2 – latest).
/// Results are returned newest-first, with promoted (recommended/latest) pinned to the top.
#[tauri::command]
pub async fn get_forge_versions(mc_version: String) -> Result<Vec<String>, String> {
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(30))
        .user_agent("PortalLauncher/1.3").build().map_err(|e| e.to_string())?;
    // 1. All builds from Maven metadata XML
    let mut versions: Vec<String> =
        match client.get("https://maven.minecraftforge.net/net/minecraftforge/forge/maven-metadata.xml")
            .send().await.and_then(|r| Ok(r))
        {
            Ok(resp) => {
                match resp.text().await {
                    Ok(xml) => {
                        let mut vs = forge_builds_for_mc(&xml, &mc_version);
                        vs.dedup();
                        vs.reverse(); // newest first
                        vs
                    }
                    Err(_) => vec![],
                }
            }
            Err(_) => vec![],
        };

    // 2. Merge promoted versions at the front
    if let Ok(resp) = client.get("https://files.minecraftforge.net/net/minecraftforge/forge/promotions_slim.json").send().await {
        if let Ok(data) = resp.json::<serde_json::Value>().await {
            if let Some(promos) = data["promos"].as_object() {
                for (key, val) in promos {
                    if key.rsplit_once('-').map(|(promo_mc, _)| promo_mc == mc_version).unwrap_or(false) {
                        if let Some(v) = val.as_str() {
                            let fv = v.to_string();
                            if !versions.contains(&fv) { versions.insert(0, fv); }
                        }
                    }
                }
            }
        }
    }

    Ok(versions)
}

/// Get available NeoForge versions for a given MC version (includes 26.x snapshots).
#[tauri::command]
pub async fn get_neoforge_versions(mc_version: String) -> Result<Vec<String>, String> {
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(30))
        .user_agent("PortalLauncher/1.3").build().map_err(|e| e.to_string())?;
    let xml = client.get("https://maven.neoforged.net/releases/net/neoforged/neoforge/maven-metadata.xml")
        .send().await.map_err(|e| e.to_string())?.text().await.map_err(|e| e.to_string())?;
    Ok(neoforge_versions_for_mc(&xml, &mc_version))
}

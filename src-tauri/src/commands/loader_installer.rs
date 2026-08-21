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

/// Required Java major version for a given MC version string (1.7.2 – latest).
fn java_major_for_mc(mc_version: &str) -> u32 {
    let parts: Vec<u32> = mc_version.split('.').filter_map(|part| part.parse::<u32>().ok()).collect();
    // Minecraft 26.x (including 26.2) is built for Java 25.
    if parts.first().copied().unwrap_or(1) >= 26 {
        25
    } else {
        let minor = parts.get(1).copied().unwrap_or(0);
        if minor <= 16 { 8 } else if minor == 17 { 16 } else if minor <= 20 { 17 } else { 21 }
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

fn find_java_17() -> Result<String, String> {
    verified_java(17, "установщика Fabric")
}

fn is_modern_quilt_target(mc_version: &str) -> bool {
    mc_version.split('.').next().and_then(|part| part.parse::<u32>().ok()).unwrap_or(0) >= 26
}

fn find_java_21() -> Result<String, String> {
    verified_java(21, "установщика NeoForge")
}

async fn download_bytes(client: &reqwest::Client, url: &str) -> Result<bytes::Bytes, String> {
    client.get(url).send().await
        .map_err(|e| format!("GET {url}: {e}"))?.bytes().await
        .map_err(|e| format!("read: {e}"))
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

fn neoforge_versions_for_mc(xml: &str, mc_version: &str) -> Vec<String> {
    let prefix = format!("{}.", mc_version.trim_start_matches("1."));
    let mut versions: Vec<String> = maven_versions(xml).into_iter().filter(|version| version.starts_with(&prefix)).collect();
    versions.sort_by(|left, right| right.cmp(left));
    versions.dedup();
    versions
}

async fn latest_forge_version(client: &reqwest::Client, mc_version: &str) -> Result<String, String> {
    let xml = client
        .get("https://maven.minecraftforge.net/net/minecraftforge/forge/maven-metadata.xml")
        .send().await.map_err(|error| format!("Forge metadata: {error}"))?
        .text().await.map_err(|error| format!("Forge metadata: {error}"))?;
    let prefix = format!("{mc_version}-");
    maven_versions(&xml).into_iter()
        .filter_map(|full| full.strip_prefix(&prefix).map(str::to_string))
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

    let java = find_java_17()?;
    let output = crate::utils::create_hidden_command(&java)
        .args(&["-jar", &jar_path.to_string_lossy(), "client",
            "-mcversion", &mc_version, "-loader", &lv,
            "-dir", &instance_dir, "-noprofile"])
        .output().map_err(|e| format!("Run Fabric ({java}): {e}"))?;

    std::fs::remove_file(&jar_path).ok();
    Ok(LoaderInstallResult {
        success: output.status.success(), loader: "fabric".into(), version: lv,
        message: if output.status.success() { "Fabric installed successfully".into() }
                 else { format!("Не удалось установить Fabric: {}", String::from_utf8_lossy(&output.stderr).lines().last().unwrap_or("установщик завершился с ошибкой")) },
    })
}

/// Install Forge – 1.7.2 to latest (full installer flow).
#[tauri::command]
pub async fn install_forge(mc_version: String, forge_version: String, instance_dir: String) -> Result<LoaderInstallResult, String> {
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

    let selected_version = if forge_version.trim().is_empty() {
        latest_forge_version(&client, &mc_version).await?
    } else { forge_version };
    let full_ver = if selected_version.starts_with(&format!("{mc_version}-")) { selected_version }
                   else { format!("{}-{}", mc_version, selected_version) };

    let installer_url = format!(
        "https://maven.minecraftforge.net/net/minecraftforge/forge/{v}/forge-{v}-installer.jar",
        v = full_ver
    );

    let safe_ver = full_ver.replace(':', "-");
    let jar_path = mc_base_dir().join(format!("forge-{}-installer.jar", safe_ver));
    std::fs::write(&jar_path, &download_bytes(&client, &installer_url).await?)
        .map_err(|e| format!("Download Forge installer: {e}"))?;

    let java = find_java_for_mc(&mc_version)?;
    let jar_str = jar_path.to_string_lossy().to_string();

    // Pre-1.13 Forge installers don't accept a target directory; they install to ~/.minecraft.
    let mc_minor: u32 = mc_version.split('.').nth(1).unwrap_or("0").parse().unwrap_or(0);
    let args: Vec<String> = if mc_minor <= 12 {
        vec!["-jar".into(), jar_str, "--installClient".into()]
    } else {
        vec!["-jar".into(), jar_str, "--installClient".into(), instance_dir.clone()]
    };

    let output = crate::utils::create_hidden_command(&java)
        .args(&args)
        .output().map_err(|e| format!("Run Forge ({java}): {e}"))?;

    std::fs::remove_file(&jar_path).ok();
    Ok(LoaderInstallResult {
        success: output.status.success(), loader: "forge".into(), version: full_ver,
        message: if output.status.success() { "Forge installed".into() }
                 else { format!("Не удалось установить Forge: {}", String::from_utf8_lossy(&output.stderr).lines().last().unwrap_or("установщик завершился с ошибкой")) },
    })
}

/// Install Quilt loader – 1.14+ to latest.
#[tauri::command]
pub async fn install_quilt(mc_version: String, loader_version: String, instance_dir: String) -> Result<LoaderInstallResult, String> {
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
    std::fs::write(&jar_path, &download_bytes(&client, installer_url).await?).map_err(|e| e.to_string())?;

    let java = find_java_for_mc(&mc_version)?;
    let output = crate::utils::create_hidden_command(&java)
        .args(&["-jar", &jar_path.to_string_lossy(), "install", "client",
            &mc_version, &lv, "--install-dir", &instance_dir])
        .output().map_err(|e| format!("Run Quilt ({java}): {e}"))?;

    std::fs::remove_file(&jar_path).ok();
    Ok(LoaderInstallResult {
        success: output.status.success(), loader: "quilt".into(), version: lv,
        message: if output.status.success() { "Quilt installed".into() }
                 else { format!("Не удалось установить Quilt: {}", String::from_utf8_lossy(&output.stderr).lines().last().unwrap_or("установщик завершился с ошибкой")) },
    })
}

/// Install NeoForge – 1.20.1+ including 26.x snapshots.
#[tauri::command]
pub async fn install_neoforge(mc_version: String, neoforge_version: String, instance_dir: String) -> Result<LoaderInstallResult, String> {
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
    match download_bytes(&client, &installer_url).await {
        Ok(bytes) => { std::fs::write(&jar_path, &bytes).map_err(|e| e.to_string())?; }
        Err(e) => return Ok(LoaderInstallResult {
            success: false, loader: "neoforge".into(), version: nfv,
            message: format!("Download failed: {e}"),
        })
    }

    let java = find_java_21()?;
    let output = crate::utils::create_hidden_command(&java)
        .args(&["-jar", &jar_path.to_string_lossy(), "--installClient", &instance_dir])
        .output().map_err(|e| format!("Run NeoForge ({java}): {e}"))?;

    std::fs::remove_file(&jar_path).ok();
    Ok(LoaderInstallResult {
        success: output.status.success(), loader: "neoforge".into(), version: nfv,
        message: if output.status.success() { "NeoForge installed successfully".into() }
                 else { format!("Не удалось установить NeoForge: {}", String::from_utf8_lossy(&output.stderr).lines().last().unwrap_or("установщик завершился с ошибкой")) },
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
    let prefix = format!("{}-", mc_version);

    // 1. All builds from Maven metadata XML
    let mut versions: Vec<String> =
        match client.get("https://maven.minecraftforge.net/net/minecraftforge/forge/maven-metadata.xml")
            .send().await.and_then(|r| Ok(r))
        {
            Ok(resp) => {
                match resp.text().await {
                    Ok(xml) => {
                        let mut vs: Vec<String> = xml.lines()
                            .filter(|l| l.contains("<version>"))
                            .filter_map(|l| {
                                let s = l.find("<version>")? + 9;
                                let e = l.find("</version>")?;
                                let v = l[s..e].trim().to_string();
                                if v.starts_with(&prefix) { Some(v[prefix.len()..].to_string()) } else { None }
                            })
                            .collect();
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
                    if key.starts_with(&mc_version) {
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

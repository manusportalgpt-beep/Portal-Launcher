//! Реальная установка Minecraft: version.json (с наследованием), client.jar,
//! библиотеки с правилами ОС, natives, asset index и объекты ассетов,
//! профили загрузчиков (Fabric / Quilt / Forge / NeoForge).
//!
//! Все загрузки идут через выбранное зеркало (`mc::mirrors`) с проверкой SHA-1.

use futures::stream::{self, StreamExt};
use serde::{Deserialize, Serialize};
use sha1::{Digest, Sha1};
use std::path::{Path, PathBuf};
use tauri::Emitter;

use super::mirrors;
use crate::commands::version_manager::{assets_dir, libraries_dir, mc_base_dir, versions_dir};

const VERSION_MANIFEST: &str = "https://piston-meta.mojang.com/mc/game/version_manifest_v2.json";
const FABRIC_META: &str = "https://meta.fabricmc.net/v2/versions/loader";
const QUILT_META: &str = "https://meta.quiltmc.org/v3/versions/loader";

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct InstallProgress {
    pub stage: String,
    pub message: String,
    pub current: u64,
    pub total: u64,
    pub percent: u8,
}

fn emit(app: &tauri::AppHandle, stage: &str, message: &str, current: u64, total: u64) {
    let percent = if total == 0 {
        0
    } else {
        ((current as f64 / total as f64) * 100.0).round().min(100.0) as u8
    };
    app.emit(
        "install-progress",
        InstallProgress {
            stage: stage.to_string(),
            message: message.to_string(),
            current,
            total,
            percent,
        },
    )
    .ok();
}

pub fn http() -> reqwest::Client {
    reqwest::Client::builder()
        .user_agent("PortalLauncher/1.2")
        .timeout(std::time::Duration::from_secs(180))
        .build()
        .unwrap_or_default()
}

fn sha1_hex(bytes: &[u8]) -> String {
    let mut h = Sha1::new();
    h.update(bytes);
    format!("{:x}", h.finalize())
}

fn file_sha1(path: &Path) -> Option<String> {
    let data = std::fs::read(path).ok()?;
    Some(sha1_hex(&data))
}

/// Скачивает файл с проверкой SHA-1 и кэшированием (не качает повторно).
pub async fn download_file(
    client: &reqwest::Client,
    url: &str,
    dest: &Path,
    sha1: Option<&str>,
) -> Result<(), String> {
    if dest.exists() {
        match sha1 {
            Some(expected) => {
                if file_sha1(dest).as_deref() == Some(expected) {
                    return Ok(());
                }
            }
            None => {
                if std::fs::metadata(dest).map(|m| m.len() > 0).unwrap_or(false) {
                    return Ok(());
                }
            }
        }
    }
    if let Some(parent) = dest.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }

    let mirrored = mirrors::rewrite(url);
    let mut last_err = String::new();
    for attempt_url in [mirrored.as_str(), url] {
        for attempt in 0..3 {
            match client.get(attempt_url).send().await {
                Ok(resp) if resp.status().is_success() => match resp.bytes().await {
                    Ok(bytes) => {
                        if let Some(expected) = sha1 {
                            let got = sha1_hex(&bytes);
                            if got != expected {
                                last_err = format!("SHA-1 не совпал для {attempt_url}");
                                continue;
                            }
                        }
                        std::fs::write(dest, &bytes).map_err(|e| e.to_string())?;
                        return Ok(());
                    }
                    Err(e) => last_err = format!("чтение тела: {e}"),
                },
                Ok(resp) => last_err = format!("HTTP {} для {attempt_url}", resp.status()),
                Err(e) => last_err = format!("сеть: {e}"),
            }
            tokio::time::sleep(std::time::Duration::from_millis(250 * (attempt + 1))).await;
        }
    }
    Err(format!("Не удалось скачать {url}: {last_err}"))
}

// ─────────────────────────────────────────────────────────────────────────────
// version.json
// ─────────────────────────────────────────────────────────────────────────────

pub fn version_json_path(id: &str) -> PathBuf {
    versions_dir().join(id).join(format!("{id}.json"))
}

pub fn version_jar_path(id: &str) -> PathBuf {
    versions_dir().join(id).join(format!("{id}.jar"))
}

/// Скачивает манифест версий Mojang.
pub async fn fetch_manifest(client: &reqwest::Client) -> Result<serde_json::Value, String> {
    let url = mirrors::rewrite(VERSION_MANIFEST);
    let text = client
        .get(&url)
        .send()
        .await
        .map_err(|e| format!("Манифест версий недоступен: {e}"))?
        .text()
        .await
        .map_err(|e| e.to_string())?;
    serde_json::from_str(&text).map_err(|e| format!("Разбор манифеста: {e}"))
}

/// Загружает (или берёт из кэша) version.json конкретной версии.
pub async fn ensure_version_json(
    client: &reqwest::Client,
    version_id: &str,
) -> Result<serde_json::Value, String> {
    let path = version_json_path(version_id);
    if path.exists() {
        if let Ok(raw) = std::fs::read_to_string(&path) {
            if let Ok(v) = serde_json::from_str::<serde_json::Value>(&raw) {
                // A previous loader install used to be able to leave a merged
                // loader profile in the vanilla-version slot. That makes every
                // loader start against the wrong parent metadata and Fabric can
                // fail much later with TinyRemapper "Unfixable conflicts".
                // Never reuse a cached vanilla file unless it is demonstrably
                // the requested Minecraft release and contains its client JAR.
                let is_requested_vanilla = v["id"].as_str() == Some(version_id)
                    && v["downloads"]["client"]["url"].as_str().is_some();
                if is_requested_vanilla {
                    return Ok(v);
                }
                log::warn!(
                    "Игнорирую несовместимый кэш version.json для {}: id={:?}",
                    version_id,
                    v["id"].as_str()
                );
            }
        }
        // Keep user instances untouched: only the globally cached metadata is
        // replaced on the next download.
        let _ = std::fs::remove_file(&path);
    }
    let manifest = fetch_manifest(client).await?;
    let entry = manifest["versions"]
        .as_array()
        .and_then(|arr| {
            arr.iter()
                .find(|v| v["id"].as_str() == Some(version_id))
                .cloned()
        })
        .ok_or_else(|| format!("Версия {version_id} не найдена в манифесте Mojang"))?;
    let url = entry["url"].as_str().ok_or("нет url версии")?.to_string();
    let mirrored = mirrors::rewrite(&url);
    let text = client
        .get(&mirrored)
        .send()
        .await
        .map_err(|e| format!("version.json: {e}"))?
        .text()
        .await
        .map_err(|e| e.to_string())?;
    let json: serde_json::Value =
        serde_json::from_str(&text).map_err(|e| format!("Разбор version.json: {e}"))?;
    std::fs::create_dir_all(path.parent().unwrap()).ok();
    std::fs::write(&path, &text).ok();
    Ok(json)
}

/// Склеивает профиль загрузчика с родительской версией (`inheritsFrom`).
pub fn merge_inherited(child: &serde_json::Value, parent: &serde_json::Value) -> serde_json::Value {
    let mut out = parent.clone();

    if let Some(mc) = child.get("mainClass") {
        out["mainClass"] = mc.clone();
    }
    if let Some(id) = child.get("id") {
        out["id"] = id.clone();
    }

    // libraries: библиотеки загрузчика идут первыми (приоритет в classpath)
    let mut libs = child["libraries"].as_array().cloned().unwrap_or_default();
    libs.extend(parent["libraries"].as_array().cloned().unwrap_or_default());
    out["libraries"] = serde_json::Value::Array(libs);

    // arguments
    for key in ["game", "jvm"] {
        let mut merged = parent["arguments"][key].as_array().cloned().unwrap_or_default();
        merged.extend(child["arguments"][key].as_array().cloned().unwrap_or_default());
        if !merged.is_empty() {
            out["arguments"][key] = serde_json::Value::Array(merged);
        }
    }
    if let Some(legacy) = child.get("minecraftArguments") {
        out["minecraftArguments"] = legacy.clone();
    }
    out
}

/// Полностью разрешённый version.json (с наследованием) для инстанса.
pub async fn resolve_version(
    client: &reqwest::Client,
    version_id: &str,
    loader: &str,
    loader_version: &str,
) -> Result<(serde_json::Value, String), String> {
    let vanilla = ensure_version_json(client, version_id).await?;
    let requested_loader = loader.trim().to_lowercase();
    // An OptiFine setup created by Portal Launcher is technically a Forge
    // instance with the official OptiFine JAR in mods. Resolve the Forge
    // profile, not a fictional optifine-loader profile.
    let loader = if requested_loader == "optifine" { "forge".to_string() } else { requested_loader };
    if loader.is_empty() || loader == "vanilla" {
        return Ok((vanilla, version_id.to_string()));
    }
    // LabyMod is an independently licensed client, not a standard Minecraft
    // loader profile. Launching it as vanilla would be misleading, so explain
    // the official route instead of a false missing-profile error.
    if loader == "labymod" {
        return Err("LabyMod запускается только через официальный Laby Launcher с лицензированным Microsoft-аккаунтом. Portal Launcher не создаёт поддельный loader-профиль LabyMod.".to_string());
    }

    // 1. Локально установленный профиль (Forge / NeoForge / ручная установка).
    // A blank Fabric/Quilt version means "latest", so it must not reuse an
    // arbitrary old profile from the shared cache. An exact loader version can
    // reuse only a profile that explicitly inherits from this Minecraft version.
    if !loader_version.trim().is_empty() || loader == "forge" || loader == "neoforge" {
        if let Some(profile_id) = find_local_loader_profile(&loader, version_id, loader_version) {
            let raw = std::fs::read_to_string(version_json_path(&profile_id))
                .map_err(|e| format!("Профиль {profile_id}: {e}"))?;
            let child: serde_json::Value =
                serde_json::from_str(&raw).map_err(|e| format!("Разбор {profile_id}: {e}"))?;
            return Ok((merge_inherited(&child, &vanilla), profile_id));
        }
    }

    // 2. Fabric / Quilt — получаем профиль из meta API
    if loader == "fabric" || loader == "quilt" {
        let base = if loader == "fabric" { FABRIC_META } else { QUILT_META };
        let lv = if loader_version.trim().is_empty() {
            fetch_latest_loader(client, base, version_id).await?
        } else {
            loader_version.to_string()
        };
        let url = format!("{base}/{version_id}/{lv}/profile/json");
        let url = mirrors::rewrite(&url);
        let text = client
            .get(&url)
            .send()
            .await
            .map_err(|e| format!("{loader} meta: {e}"))?
            .text()
            .await
            .map_err(|e| e.to_string())?;
        let child: serde_json::Value =
            serde_json::from_str(&text).map_err(|e| format!("Разбор профиля {loader}: {e}"))?;
        if !loader_profile_matches(&child, &loader, version_id, &lv) {
            return Err(format!(
                "Получен несовместимый профиль {loader} {lv} для Minecraft {version_id}; кэш не изменён. Повторите установку загрузчика."
            ));
        }
        let profile_id = child["id"]
            .as_str()
            .unwrap_or(&format!("{loader}-loader-{lv}-{version_id}"))
            .to_string();
        // Кэшируем профиль на диск
        let path = version_json_path(&profile_id);
        std::fs::create_dir_all(path.parent().unwrap()).ok();
        std::fs::write(&path, &text).ok();
        return Ok((merge_inherited(&child, &vanilla), profile_id));
    }

    // Forge and NeoForge installers create profile JSON in the shared versions
    // directory. Older instances can lose that profile after cleanup or may
    // have been created with a blank recommended version, so recover it before
    // reporting a launch error. This leaves worlds, mods and instance files
    // untouched.
    if loader == "forge" || loader == "neoforge" {
        let target_dir = crate::commands::version_manager::mc_base_dir().to_string_lossy().to_string();
        let result = if loader == "forge" {
            crate::commands::loader_installer::install_forge(version_id.to_string(), loader_version.to_string(), target_dir).await?
        } else {
            crate::commands::loader_installer::install_neoforge(version_id.to_string(), loader_version.to_string(), target_dir).await?
        };
        if !result.success {
            return Err(format!("Не удалось автоматически установить {loader} для {version_id}: {}", result.message));
        }
        // Re-open precisely the profile produced by this installer run. A blank
        // lookup can otherwise select an older Forge/NeoForge profile with the
        // same Minecraft parent, which leaves the instance on stale launch
        // metadata after a fallback or installer repair.
        let installed_loader_version = if loader == "forge" {
            result
                .version
                .strip_prefix(&format!("{version_id}-"))
                .unwrap_or(&result.version)
        } else {
            result.version.as_str()
        };
        if let Some(profile_id) = find_local_loader_profile(&loader, version_id, installed_loader_version) {
            let raw = std::fs::read_to_string(version_json_path(&profile_id))
                .map_err(|e| format!("Профиль {profile_id}: {e}"))?;
            let child: serde_json::Value = serde_json::from_str(&raw)
                .map_err(|e| format!("Разбор {profile_id}: {e}"))?;
            return Ok((merge_inherited(&child, &vanilla), profile_id));
        }
        return Err(format!("{loader} {} установлен, но не создал профиль запуска для {version_id}. Повторите запуск.", result.version));
    }

    Err(format!(
        "Профиль загрузчика {loader} {loader_version} не установлен для {version_id}. \
Установите загрузчик в настройках сборки."
    ))
}

async fn fetch_latest_loader(
    client: &reqwest::Client,
    base: &str,
    version_id: &str,
) -> Result<String, String> {
    let url = format!("{base}/{version_id}");
    let text = client
        .get(&url)
        .send()
        .await
        .map_err(|e| format!("meta: {e}"))?
        .text()
        .await
        .map_err(|e| e.to_string())?;
    let arr: serde_json::Value = serde_json::from_str(&text).map_err(|e| e.to_string())?;
    arr[0]["loader"]["version"]
        .as_str()
        .map(String::from)
        .ok_or_else(|| format!("Нет доступных версий загрузчика для {version_id}"))
}

fn find_local_loader_profile(loader: &str, mc: &str, loader_version: &str) -> Option<String> {
    let dir = versions_dir();
    let entries = std::fs::read_dir(dir).ok()?;
    for e in entries.flatten() {
        let name = e.file_name().to_string_lossy().to_string();
        let lower = name.to_lowercase();
        if !lower.contains(loader) || (!loader_version.trim().is_empty() && !name.contains(loader_version)) {
            continue;
        }
        let path = version_json_path(&name);
        if !path.exists() {
            continue;
        }
        let Ok(raw) = std::fs::read_to_string(&path) else {
            continue;
        };
        let Ok(profile) = serde_json::from_str::<serde_json::Value>(&raw) else {
            continue;
        };
        // Matching folder names alone is unsafe: e.g. 1.21.1 is a substring
        // of 1.21.10. The profile itself must name this exact parent version
        // and its own id must describe the selected loader/version.
        if loader_profile_matches(&profile, loader, mc, loader_version) {
            return Some(name);
        }
    }
    None
}

fn loader_profile_matches(
    profile: &serde_json::Value,
    loader: &str,
    mc_version: &str,
    loader_version: &str,
) -> bool {
    let Some(id) = profile["id"].as_str() else {
        return false;
    };
    let normalized_id = id.to_lowercase();
    normalized_id.contains(loader)
        && profile["inheritsFrom"].as_str() == Some(mc_version)
        && (loader_version.trim().is_empty() || id.contains(loader_version))
}

#[cfg(test)]
mod loader_profile_tests {
    use super::loader_profile_matches;
    use serde_json::json;

    #[test]
    fn rejects_a_similar_but_different_minecraft_parent() {
        let profile = json!({
            "id": "fabric-loader-0.19.3-1.21.10",
            "inheritsFrom": "1.21.10"
        });

        assert!(!loader_profile_matches(&profile, "fabric", "1.21.1", "0.19.3"));
    }

    #[test]
    fn accepts_the_exact_loader_and_minecraft_parent() {
        let profile = json!({
            "id": "fabric-loader-0.19.3-1.21.1",
            "inheritsFrom": "1.21.1"
        });

        assert!(loader_profile_matches(&profile, "fabric", "1.21.1", "0.19.3"));
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Правила ОС и библиотеки
// ─────────────────────────────────────────────────────────────────────────────

pub fn os_name() -> &'static str {
    if cfg!(target_os = "windows") {
        "windows"
    } else if cfg!(target_os = "macos") {
        "osx"
    } else {
        "linux"
    }
}

pub fn os_arch() -> &'static str {
    if cfg!(target_arch = "x86_64") {
        "x64"
    } else if cfg!(target_arch = "aarch64") {
        "arm64"
    } else {
        "x86"
    }
}

/// Вычисление правил (`rules`) библиотеки/аргумента.
pub fn rules_allow(rules: Option<&Vec<serde_json::Value>>, features: &[&str]) -> bool {
    let Some(rules) = rules else { return true };
    if rules.is_empty() {
        return true;
    }
    let mut allowed = false;
    for rule in rules {
        let action = rule["action"].as_str().unwrap_or("allow");
        let mut matches = true;

        if let Some(os) = rule.get("os") {
            if let Some(name) = os["name"].as_str() {
                if name != os_name() {
                    matches = false;
                }
            }
            if let Some(arch) = os["arch"].as_str() {
                let want = if arch == "x86" { "x86" } else { arch };
                if want != os_arch() && !(want == "x86" && os_arch() == "x86") {
                    matches = false;
                }
            }
        }
        if let Some(feat) = rule.get("features").and_then(|f| f.as_object()) {
            for (k, v) in feat {
                let enabled = features.contains(&k.as_str());
                if v.as_bool().unwrap_or(false) != enabled {
                    matches = false;
                }
            }
        }
        if matches {
            allowed = action == "allow";
        }
    }
    allowed
}

/// Путь Maven-артефакта (`group:artifact:version[:classifier]`) в libraries.
pub fn maven_path(name: &str) -> Option<PathBuf> {
    let mut parts = name.split(':');
    let group = parts.next()?.replace('.', "/");
    let artifact = parts.next()?;
    let version = parts.next()?;
    let classifier = parts.next();
    let file = match classifier {
        Some(c) => format!("{artifact}-{version}-{c}.jar"),
        None => format!("{artifact}-{version}.jar"),
    };
    Some(
        libraries_dir()
            .join(group)
            .join(artifact)
            .join(version)
            .join(file),
    )
}

fn maven_url(base: &str, name: &str) -> Option<String> {
    let mut parts = name.split(':');
    let group = parts.next()?.replace('.', "/");
    let artifact = parts.next()?;
    let version = parts.next()?;
    let classifier = parts.next();
    let file = match classifier {
        Some(c) => format!("{artifact}-{version}-{c}.jar"),
        None => format!("{artifact}-{version}.jar"),
    };
    let base = base.trim_end_matches('/');
    Some(format!("{base}/{group}/{artifact}/{version}/{file}"))
}

#[derive(Debug, Clone)]
pub struct LibraryTarget {
    pub coordinate: String,
    pub path: PathBuf,
    pub url: String,
    pub sha1: Option<String>,
    pub native: bool,
}

/// Собирает список файлов библиотек, нужных на этой ОС.
pub fn collect_libraries(version: &serde_json::Value) -> Vec<LibraryTarget> {
    let mut out: Vec<LibraryTarget> = Vec::new();
    let libs = version["libraries"].as_array().cloned().unwrap_or_default();

    for lib in libs {
        let rules = lib["rules"].as_array().cloned();
        if !rules_allow(rules.as_ref(), &[]) {
            continue;
        }
        let name = lib["name"].as_str().unwrap_or("").to_string();
        // Современный формат (1.19+, LWJGL 3.3.x): natives — это ОБЫЧНАЯ
        // библиотека с classifier'ом прямо в имени, вида
        // "org.lwjgl:lwjgl:3.3.3:natives-windows", отфильтрованная через
        // rules по ОС. Раньше это никак не отличалось от обычных библиотек —
        // classifiers-детект ниже понимает только СТАРЫЙ формат (до 1.18),
        // из-за чего .dll/.so из современных LWJGL-джарников никогда не
        // распаковывались, и игра падала с "Failed to locate library: lwjgl.dll"
        // на любой версии 1.19+ и любом загрузчике.
        let is_modern_native = name.contains(":natives-");

        // Классический artifact
        if let Some(artifact) = lib["downloads"]["artifact"].as_object() {
            let rel = artifact
                .get("path")
                .and_then(|p| p.as_str())
                .map(|p| libraries_dir().join(p))
                .or_else(|| maven_path(&name));
            if let (Some(path), Some(url)) = (
                rel,
                artifact.get("url").and_then(|u| u.as_str()).map(String::from),
            ) {
                out.push(LibraryTarget {
                    coordinate: name.clone(),
                    path,
                    url,
                    sha1: artifact.get("sha1").and_then(|s| s.as_str()).map(String::from),
                    native: is_modern_native,
                });
            }
        } else if !name.is_empty() {
            // Библиотека загрузчика: только name + url базы maven
            let base = lib["url"]
                .as_str()
                .unwrap_or("https://libraries.minecraft.net/");
            if let (Some(path), Some(url)) = (maven_path(&name), maven_url(base, &name)) {
                out.push(LibraryTarget {
                    coordinate: name.clone(),
                    path,
                    url,
                    sha1: None,
                    native: false,
                });
            }
        }

        // Natives (старый формат с classifiers)
        let native_key = lib["natives"][os_name()].as_str().map(|k| {
            k.replace("${arch}", if os_arch() == "x86" { "32" } else { "64" })
        });
        if let Some(key) = native_key {
            if let Some(classifier) = lib["downloads"]["classifiers"][&key].as_object() {
                let path = classifier
                    .get("path")
                    .and_then(|p| p.as_str())
                    .map(|p| libraries_dir().join(p));
                if let (Some(path), Some(url)) = (
                    path,
                    classifier.get("url").and_then(|u| u.as_str()).map(String::from),
                ) {
                    out.push(LibraryTarget {
                        coordinate: format!("{name}:{key}"),
                        path,
                        url,
                        sha1: classifier.get("sha1").and_then(|s| s.as_str()).map(String::from),
                        native: true,
                    });
                }
            }
        }
    }
    out
}

/// Распаковывает natives рядом с версией.
pub fn extract_natives(natives: &[PathBuf], target: &Path) -> Result<(), String> {
    std::fs::create_dir_all(target).map_err(|e| e.to_string())?;
    for jar in natives {
        let file = std::fs::File::open(jar).map_err(|e| format!("{jar:?}: {e}"))?;
        let mut archive = zip::ZipArchive::new(file).map_err(|e| format!("{jar:?}: {e}"))?;
        for i in 0..archive.len() {
            let mut entry = archive.by_index(i).map_err(|e| e.to_string())?;
            let name = entry.name().to_string();
            if name.ends_with('/') || name.starts_with("META-INF") {
                continue;
            }
            let file_name = Path::new(&name)
                .file_name()
                .map(|n| n.to_string_lossy().to_string())
                .unwrap_or(name.clone());
            let ext_ok = ["dll", "so", "dylib", "jnilib"]
                .iter()
                .any(|e| file_name.ends_with(e));
            if !ext_ok {
                continue;
            }
            let dest = target.join(&file_name);
            if dest.exists() {
                continue;
            }
            let mut out = std::fs::File::create(&dest).map_err(|e| e.to_string())?;
            std::io::copy(&mut entry, &mut out).map_err(|e| e.to_string())?;
        }
    }
    Ok(())
}

// ─────────────────────────────────────────────────────────────────────────────
// Полная установка версии
// ─────────────────────────────────────────────────────────────────────────────

/// Устанавливает всё, что нужно для запуска: client.jar, библиотеки, natives, ассеты.
pub async fn install_version(
    app: &tauri::AppHandle,
    version: &serde_json::Value,
    profile_id: &str,
    vanilla_id: &str,
) -> Result<(), String> {
    let client = http();
    // ВАЖНО: client.jar и natives всегда живут в папке ВАНИЛЬНОЙ версии
    // (versions/<vanilla_id>/...), даже когда мы ставим Fabric/Quilt/Forge.
    // Раньше здесь брался version["id"] — а после мёрджа профиля загрузчика
    // это ID САМОГО ПРОФИЛЯ (например "fabric-loader-0.15.11-1.20.1"), а не
    // версии игры. Клиент качался/искался по несуществующему пути, поэтому
    // Fabric падал с "Minecraft game provider couldn't locate the game".
    let mc_id = vanilla_id.to_string();
    let _ = profile_id; // оставлен для обратной совместимости сигнатуры

    // 1. client.jar (берём из родительской vanilla-версии)
    emit(app, "client", "Скачиваю клиент Minecraft…", 0, 1);
    let jar_url = version["downloads"]["client"]["url"]
        .as_str()
        .map(String::from);
    let jar_sha = version["downloads"]["client"]["sha1"].as_str().map(String::from);
    let jar_path = version_jar_path(&mc_id);
    if let Some(url) = jar_url {
        download_file(&client, &url, &jar_path, jar_sha.as_deref()).await?;
    } else if !jar_path.exists() {
        return Err(format!("Нет ссылки на client.jar для {mc_id}"));
    }
    emit(app, "client", "Клиент готов", 1, 1);

    // 2. Библиотеки (параллельно, 8 потоков)
    let libs = collect_libraries(version);
    let total = libs.len() as u64;
    emit(app, "libraries", "Скачиваю библиотеки…", 0, total);

    let done = std::sync::Arc::new(std::sync::atomic::AtomicU64::new(0));
    let mut natives: Vec<PathBuf> = Vec::new();
    for l in libs.iter().filter(|l| l.native) {
        natives.push(l.path.clone());
    }

    let lib_tasks: Vec<LibraryTarget> = libs.clone();
    let lib_client = client.clone();
    let lib_app = app.clone();
    let lib_done = done.clone();
    let results: Vec<Result<(), String>> = stream::iter(lib_tasks.into_iter())
        .map(move |lib| {
            let client = lib_client.clone();
            let done = lib_done.clone();
            let app = lib_app.clone();
            async move {
                let res = download_file(&client, &lib.url, &lib.path, lib.sha1.as_deref()).await;
                let n = done.fetch_add(1, std::sync::atomic::Ordering::Relaxed) + 1;
                if n % 5 == 0 || n == total {
                    emit(&app, "libraries", "Скачиваю библиотеки…", n, total);
                }
                res
            }
        })
        .buffer_unordered(8)
        .collect()
        .await;
    let failed: Vec<String> = results.into_iter().filter_map(|r| r.err()).collect();
    if !failed.is_empty() {
        log::warn!("Часть библиотек не скачалась: {}", failed.len());
        if failed.len() > total as usize / 4 {
            return Err(format!(
                "Не удалось скачать библиотеки ({} из {}). Первая ошибка: {}",
                failed.len(),
                total,
                failed[0]
            ));
        }
    }

    // 3. Natives
    if !natives.is_empty() {
        emit(app, "natives", "Распаковываю natives…", 0, 1);
        let dir = natives_dir(&mc_id);
        extract_natives(&natives, &dir)?;
        emit(app, "natives", "Natives готовы", 1, 1);
    }

    // 4. Ассеты
    install_assets(app, &client, version).await?;

    // 5. Логгер-конфиг (устраняет уязвимость log4j на старых версиях)
    if let Some(file) = version["logging"]["client"]["file"].as_object() {
        if let (Some(url), Some(id)) = (
            file.get("url").and_then(|u| u.as_str()),
            file.get("id").and_then(|i| i.as_str()),
        ) {
            let dest = assets_dir().join("log_configs").join(id);
            download_file(&client, url, &dest, file.get("sha1").and_then(|s| s.as_str())).await.ok();
        }
    }

    emit(app, "done", "Установка завершена", 1, 1);
    Ok(())
}

pub fn natives_dir(mc_id: &str) -> PathBuf {
    versions_dir().join(mc_id).join("natives")
}

pub async fn install_assets(
    app: &tauri::AppHandle,
    client: &reqwest::Client,
    version: &serde_json::Value,
) -> Result<(), String> {
    let Some(index_url) = version["assetIndex"]["url"].as_str() else {
        return Ok(());
    };
    let index_id = version["assetIndex"]["id"].as_str().unwrap_or("legacy");
    let index_path = assets_dir().join("indexes").join(format!("{index_id}.json"));
    emit(app, "assets", "Скачиваю индекс ассетов…", 0, 1);
    download_file(
        client,
        index_url,
        &index_path,
        version["assetIndex"]["sha1"].as_str(),
    )
    .await?;

    let raw = std::fs::read_to_string(&index_path).map_err(|e| e.to_string())?;
    let index: serde_json::Value = serde_json::from_str(&raw).map_err(|e| e.to_string())?;
    let objects = index["objects"].as_object().cloned().unwrap_or_default();
    let total = objects.len() as u64;
    emit(app, "assets", "Скачиваю ассеты…", 0, total);

    let done = std::sync::Arc::new(std::sync::atomic::AtomicU64::new(0));
    let tasks: Vec<(String, String)> = objects
        .iter()
        .filter_map(|(k, v)| v["hash"].as_str().map(|h| (k.clone(), h.to_string())))
        .collect();

    let a_client = client.clone();
    let a_app = app.clone();
    let a_done = done.clone();
    let results: Vec<Result<(), String>> = stream::iter(tasks.into_iter())
        .map(move |(name, hash)| {
            let client = a_client.clone();
            let done = a_done.clone();
            let app = a_app.clone();
            async move {
                let prefix = &hash[..2];
                let dest = assets_dir().join("objects").join(prefix).join(&hash);
                let url = format!("https://resources.download.minecraft.net/{prefix}/{hash}");
                let res = download_file(&client, &url, &dest, Some(&hash)).await;

                // virtual/legacy ассеты (версии <= 1.7) требуют копий по именам
                if res.is_ok() {
                    if let Some(legacy_root) = legacy_assets_root(&app) {
                        let target = legacy_root.join(&name);
                        if !target.exists() {
                            if let Some(p) = target.parent() {
                                std::fs::create_dir_all(p).ok();
                            }
                            std::fs::copy(&dest, &target).ok();
                        }
                    }
                }
                let n = done.fetch_add(1, std::sync::atomic::Ordering::Relaxed) + 1;
                if n % 50 == 0 || n == total {
                    emit(&app, "assets", "Скачиваю ассеты…", n, total);
                }
                res
            }
        })
        .buffer_unordered(16)
        .collect()
        .await;

    let failed = results.iter().filter(|r| r.is_err()).count();
    if failed > 0 {
        log::warn!("{failed} ассетов не скачалось (игра всё равно запустится)");
    }
    Ok(())
}

fn legacy_assets_root(_app: &tauri::AppHandle) -> Option<PathBuf> {
    None
}

/// Публичная команда: установить версию (vanilla или с загрузчиком).
#[tauri::command]
pub async fn install_minecraft(
    app: tauri::AppHandle,
    version: String,
    loader: Option<String>,
    loader_version: Option<String>,
) -> Result<String, String> {
    let client = http();
    let (resolved, profile_id) = resolve_version(
        &client,
        &version,
        loader.as_deref().unwrap_or("vanilla"),
        loader_version.as_deref().unwrap_or(""),
    )
    .await?;
    install_version(&app, &resolved, &profile_id, &version).await?;
    Ok(profile_id)
}

/// Проверка целостности установленной версии.
#[tauri::command]
pub async fn verify_installation(version: String) -> Result<serde_json::Value, String> {
    let jar = version_jar_path(&version);
    let json = version_json_path(&version);
    let assets_ok = assets_dir().join("indexes").exists();
    Ok(serde_json::json!({
        "version": version,
        "jar": jar.exists(),
        "json": json.exists(),
        "assets": assets_ok,
        "base_dir": mc_base_dir().to_string_lossy(),
    }))
}

use serde::{Deserialize, Serialize};
use std::io::Read;
use std::path::PathBuf;

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct BedrockInstallResult {
    pub installed: Vec<String>, // человекочитаемые описания того, что и куда легло
}

/// %LOCALAPPDATA%\Packages\<PackageFamilyName>\LocalState\games\com.mojang
/// `family` — это то, что хранится в instance.modLoaderVersion: полный AUMID
/// вида "Microsoft.MinecraftUWP_8wekyb3d8bbwe!App" — берём часть до "!".
fn com_mojang_dir(family: &str) -> Result<PathBuf, String> {
    #[cfg(target_os = "windows")]
    {
        let pkg_family = family.split('!').next().unwrap_or(family);
        let local = std::env::var("LOCALAPPDATA").map_err(|_| "LOCALAPPDATA не найден".to_string())?;
        let dir = PathBuf::from(local)
            .join("Packages")
            .join(pkg_family)
            .join("LocalState")
            .join("games")
            .join("com.mojang");
        if !dir.exists() {
            return Err(format!(
                "Не найдена папка com.mojang для {pkg_family}. Запустите Bedrock Edition хотя бы раз, чтобы Windows создала LocalState."
            ));
        }
        Ok(dir)
    }
    #[cfg(not(target_os = "windows"))]
    {
        let _ = family;
        Err("Bedrock content is only supported on Windows.".into())
    }
}

/// Тип пака по modules[].type в его manifest.json — это то, чем сама Mojang
/// определяет, куда пак нужно класть, а не наше собственное предположение.
fn target_subfolder_for_manifest(manifest: &serde_json::Value) -> &'static str {
    let types: Vec<String> = manifest["modules"].as_array()
        .map(|arr| arr.iter().filter_map(|m| m["type"].as_str().map(|s| s.to_lowercase())).collect())
        .unwrap_or_default();
    if types.iter().any(|t| t == "skin_pack") { "skin_packs" }
    else if types.iter().any(|t| t == "resources") { "resource_packs" }
    else if types.iter().any(|t| t == "data" || t == "javascript" || t == "script") { "behavior_packs" }
    else { "behavior_packs" } // по умолчанию — аддон/поведение, самый частый случай
}

fn safe_dir_name(name: &str) -> String {
    name.chars().map(|c| if "\\/:*?\"<>|".contains(c) { '_' } else { c }).collect::<String>().trim().to_string()
}

/// Извлекает один .mcpack (zip с manifest.json в корне) в нужную подпапку com.mojang.
fn extract_mcpack(bytes: &[u8], com_mojang: &PathBuf, fallback_name: &str) -> Result<String, String> {
    let reader = std::io::Cursor::new(bytes);
    let mut archive = zip::ZipArchive::new(reader).map_err(|e| format!("Не читается .mcpack: {e}"))?;

    let manifest: serde_json::Value = {
        let mut f = archive.by_name("manifest.json")
            .map_err(|_| "В .mcpack нет manifest.json — это не валидный Bedrock-пак".to_string())?;
        let mut s = String::new();
        f.read_to_string(&mut s).map_err(|e| e.to_string())?;
        serde_json::from_str(&s).map_err(|e| format!("manifest.json битый: {e}"))?
    };

    let subfolder = target_subfolder_for_manifest(&manifest);
    let pack_name = manifest["header"]["name"].as_str().unwrap_or(fallback_name);
    let dir_name = safe_dir_name(pack_name);
    let out_dir = com_mojang.join(subfolder).join(&dir_name);
    std::fs::create_dir_all(&out_dir).map_err(|e| e.to_string())?;

    for i in 0..archive.len() {
        let mut entry = archive.by_index(i).map_err(|e| e.to_string())?;
        if entry.is_dir() { continue; }
        let out_path = out_dir.join(entry.name());
        if let Some(p) = out_path.parent() { std::fs::create_dir_all(p).ok(); }
        let mut outf = std::fs::File::create(&out_path).map_err(|e| e.to_string())?;
        std::io::copy(&mut entry, &mut outf).map_err(|e| e.to_string())?;
    }

    Ok(format!("{pack_name} → {subfolder}/{dir_name}"))
}

/// .mcaddon — zip, где на верхнем уровне лежат ОДНА ИЛИ НЕСКОЛЬКО папок,
/// каждая — по сути отдельный .mcpack (behavior+resource обычно вместе).
fn extract_mcaddon(bytes: &[u8], com_mojang: &PathBuf, fallback_name: &str) -> Result<Vec<String>, String> {
    let reader = std::io::Cursor::new(bytes);
    let mut outer = zip::ZipArchive::new(reader).map_err(|e| format!("Не читается .mcaddon: {e}"))?;

    // Собираем список подпапок верхнего уровня, содержащих manifest.json
    let mut top_dirs: Vec<String> = vec![];
    for i in 0..outer.len() {
        let name = outer.by_index(i).map_err(|e| e.to_string())?.name().to_string();
        if let Some(idx) = name.find('/') {
            let top = &name[..idx];
            if name.ends_with("manifest.json") && name.matches('/').count() == 1 && !top_dirs.contains(&top.to_string()) {
                top_dirs.push(top.to_string());
            }
        }
    }

    if top_dirs.is_empty() {
        // Нет вложенных папок — возможно, это на самом деле одиночный .mcpack
        // с расширением .mcaddon. Пробуем как один пак.
        return extract_mcpack(bytes, com_mojang, fallback_name).map(|s| vec![s]);
    }

    let mut results = vec![];
    for top in &top_dirs {
        let manifest: serde_json::Value = {
            let mut f = outer.by_name(&format!("{top}/manifest.json")).map_err(|e| e.to_string())?;
            let mut s = String::new();
            f.read_to_string(&mut s).map_err(|e| e.to_string())?;
            serde_json::from_str(&s).map_err(|e| format!("manifest.json в {top} битый: {e}"))?
        };
        let subfolder = target_subfolder_for_manifest(&manifest);
        let pack_name = manifest["header"]["name"].as_str().unwrap_or(top);
        let dir_name = safe_dir_name(pack_name);
        let out_dir = com_mojang.join(subfolder).join(&dir_name);
        std::fs::create_dir_all(&out_dir).map_err(|e| e.to_string())?;

        let prefix = format!("{top}/");
        let entry_names: Vec<String> = (0..outer.len())
            .filter_map(|i| outer.by_index(i).ok().map(|e| e.name().to_string()))
            .filter(|n| n.starts_with(&prefix) && !n.ends_with('/'))
            .collect();
        for name in entry_names {
            let mut entry = outer.by_name(&name).map_err(|e| e.to_string())?;
            let rel = &name[prefix.len()..];
            let out_path = out_dir.join(rel);
            if let Some(p) = out_path.parent() { std::fs::create_dir_all(p).ok(); }
            let mut outf = std::fs::File::create(&out_path).map_err(|e| e.to_string())?;
            std::io::copy(&mut entry, &mut outf).map_err(|e| e.to_string())?;
        }
        results.push(format!("{pack_name} → {subfolder}/{dir_name}"));
    }
    Ok(results)
}

/// .mcworld — zip с level.dat и т.п. в корне, целиком копируется в minecraftWorlds/<name>/.
fn extract_mcworld(bytes: &[u8], com_mojang: &PathBuf, fallback_name: &str) -> Result<String, String> {
    let reader = std::io::Cursor::new(bytes);
    let mut archive = zip::ZipArchive::new(reader).map_err(|e| format!("Не читается .mcworld: {e}"))?;
    let dir_name = safe_dir_name(fallback_name);
    let out_dir = com_mojang.join("minecraftWorlds").join(&dir_name);
    std::fs::create_dir_all(&out_dir).map_err(|e| e.to_string())?;
    for i in 0..archive.len() {
        let mut entry = archive.by_index(i).map_err(|e| e.to_string())?;
        if entry.is_dir() { continue; }
        let out_path = out_dir.join(entry.name());
        if let Some(p) = out_path.parent() { std::fs::create_dir_all(p).ok(); }
        let mut outf = std::fs::File::create(&out_path).map_err(|e| e.to_string())?;
        std::io::copy(&mut entry, &mut outf).map_err(|e| e.to_string())?;
    }
    Ok(format!("{fallback_name} → minecraftWorlds/{dir_name}"))
}

/// Скачивает контент с CurseForge и ставит его в правильную папку com.mojang
/// для указанного (по AUMID) установленного издания Bedrock.
#[tauri::command]
pub async fn install_bedrock_content(
    family: String,
    download_url: String,
    file_name: String,
) -> Result<BedrockInstallResult, String> {
    let com_mojang = com_mojang_dir(&family)?;

    let resp = reqwest::get(&download_url).await.map_err(|e| format!("Скачивание: {e}"))?;
    if !resp.status().is_success() {
        return Err(format!("Скачивание не удалось: HTTP {}", resp.status()));
    }
    let bytes = resp.bytes().await.map_err(|e| format!("Чтение файла: {e}"))?;

    let lower = file_name.to_lowercase();
    let base_name = file_name.trim_end_matches(".mcpack").trim_end_matches(".mcaddon")
        .trim_end_matches(".mcworld").trim_end_matches(".zip").to_string();

    let installed = if lower.ends_with(".mcworld") {
        vec![extract_mcworld(&bytes, &com_mojang, &base_name)?]
    } else if lower.ends_with(".mcaddon") {
        extract_mcaddon(&bytes, &com_mojang, &base_name)?
    } else if lower.ends_with(".mcpack") || lower.ends_with(".zip") {
        vec![extract_mcpack(&bytes, &com_mojang, &base_name)?]
    } else {
        return Err(format!("Неизвестный формат файла Bedrock-контента: {file_name}"));
    };

    Ok(BedrockInstallResult { installed })
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct BedrockContentEntry {
    pub name: String,
    pub kind: String, // "behavior_packs" | "resource_packs" | "skin_packs"
}

/// Список уже установленного Bedrock-контента (сканирует папки на диске —
/// это не наша выдумка, а то же самое место, куда сама игра кладёт паки).
#[tauri::command]
pub async fn list_bedrock_content(family: String) -> Result<Vec<BedrockContentEntry>, String> {
    let com_mojang = com_mojang_dir(&family)?;
    let mut out = vec![];
    for kind in ["behavior_packs", "resource_packs", "skin_packs"] {
        let dir = com_mojang.join(kind);
        if let Ok(entries) = std::fs::read_dir(&dir) {
            for e in entries.flatten() {
                if e.path().is_dir() {
                    if let Some(name) = e.file_name().to_str() {
                        out.push(BedrockContentEntry { name: name.to_string(), kind: kind.to_string() });
                    }
                }
            }
        }
    }
    Ok(out)
}

#[tauri::command]
pub async fn remove_bedrock_content(family: String, kind: String, name: String) -> Result<(), String> {
    let com_mojang = com_mojang_dir(&family)?;
    let dir = com_mojang.join(&kind).join(&name);
    std::fs::remove_dir_all(&dir).map_err(|e| format!("Не удалось удалить: {e}"))
}

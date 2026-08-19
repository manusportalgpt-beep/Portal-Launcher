//! Зеркала CDN. Поддержаны официальные серверы Mojang и **BMCLAPI**
//! (bmclapi2.bangbang93.com) — быстрый доступ из РФ/СНГ и Китая.

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum Mirror {
    Official,
    Bmclapi,
    /// Резервное зеркало BMCLAPI (bmclapi.bangbang93.com)
    BmclapiRu,
}

impl Mirror {
    pub fn from_setting(s: &str) -> Self {
        match s.trim().to_lowercase().as_str() {
            "bmclapi" => Mirror::Bmclapi,
            "bmclapi_ru" | "bmclapi-ru" | "ru" => Mirror::BmclapiRu,
            _ => Mirror::Official,
        }
    }

    pub fn host(&self) -> &'static str {
        match self {
            Mirror::Official => "",
            Mirror::Bmclapi => "https://bmclapi2.bangbang93.com",
            Mirror::BmclapiRu => "https://bmclapi.bangbang93.com",
        }
    }
}

/// Текущее зеркало из settings.json (ключ `cdn_mirror`).
pub fn current() -> Mirror {
    let path = crate::commands::version_manager::mc_base_dir().join("settings.json");
    let Ok(raw) = std::fs::read_to_string(path) else {
        return Mirror::Official;
    };
    let Ok(v) = serde_json::from_str::<serde_json::Value>(&raw) else {
        return Mirror::Official;
    };
    Mirror::from_setting(v.get("cdn_mirror").and_then(|x| x.as_str()).unwrap_or("official"))
}

/// Переписывает официальный URL на выбранное зеркало.
pub fn rewrite(url: &str) -> String {
    let m = current();
    rewrite_with(url, m)
}

pub fn rewrite_with(url: &str, m: Mirror) -> String {
    let base = m.host();
    if base.is_empty() {
        return url.to_string();
    }
    let map: [(&str, String); 9] = [
        ("https://piston-meta.mojang.com", base.to_string()),
        ("https://launchermeta.mojang.com", base.to_string()),
        ("https://piston-data.mojang.com", base.to_string()),
        ("https://launcher.mojang.com", base.to_string()),
        ("https://resources.download.minecraft.net", format!("{base}/assets")),
        ("https://libraries.minecraft.net", format!("{base}/maven")),
        ("https://maven.fabricmc.net", format!("{base}/maven")),
        ("https://meta.fabricmc.net", format!("{base}/fabric-meta")),
        ("https://maven.minecraftforge.net", format!("{base}/maven")),
    ];
    for (from, to) in map.iter() {
        if let Some(rest) = url.strip_prefix(*from) {
            return format!("{to}{rest}");
        }
    }
    url.to_string()
}

/// Список зеркал для UI настроек.
#[tauri::command]
pub fn list_cdn_mirrors() -> Vec<serde_json::Value> {
    vec![
        serde_json::json!({
            "id": "official",
            "name": "Mojang (официальное)",
            "description": "piston-meta / libraries.minecraft.net",
            "region": "global"
        }),
        serde_json::json!({
            "id": "bmclapi",
            "name": "BMCLAPI",
            "description": "bmclapi2.bangbang93.com — быстрое зеркало для РФ/СНГ и Азии",
            "region": "ru/cn"
        }),
        serde_json::json!({
            "id": "bmclapi_ru",
            "name": "BMCLAPI (резерв)",
            "description": "bmclapi.bangbang93.com — резервный узел",
            "region": "ru/cn"
        }),
    ]
}

/// Проверка доступности зеркала — возвращает задержку в мс.
#[tauri::command]
pub async fn test_cdn_mirror(mirror: String) -> Result<u64, String> {
    let m = Mirror::from_setting(&mirror);
    let url = rewrite_with("https://piston-meta.mojang.com/mc/game/version_manifest_v2.json", m);
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(12))
        .build()
        .map_err(|e| e.to_string())?;
    let start = std::time::Instant::now();
    let resp = client.get(&url).send().await.map_err(|e| format!("Недоступно: {e}"))?;
    if !resp.status().is_success() {
        return Err(format!("HTTP {}", resp.status()));
    }
    Ok(start.elapsed().as_millis() as u64)
}

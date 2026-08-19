use serde::{Deserialize, Serialize};

use base64::Engine as _;

#[derive(Serialize, Deserialize, Debug)]
pub struct SkinInfo {
    pub url: String,
    pub variant: String, // "classic" or "slim"
    pub texture_id: String,
}

#[derive(Serialize, Deserialize, Debug)]
pub struct PublicSkinTexture {
    pub uuid: String,
    pub name: String,
    pub skin_url: String,
    pub skin_variant: String,
    pub skin_bytes: Vec<u8>,
}

/// Resolve a publicly visible Minecraft skin by player nickname. This is
/// read-only: it requests Mojang's public profile and texture payload, then
/// returns the signed texture URL and declared model for a local preset preview.
#[tauri::command]
pub async fn lookup_public_skin(username: String) -> Result<PublicSkinTexture, String> {
    let name = username.trim();
    if name.is_empty() || name.len() > 16 || !name.chars().all(|c| c.is_ascii_alphanumeric() || c == '_') {
        return Err("Введите корректный Minecraft ник: 1–16 символов, буквы, цифры и _.".to_string());
    }

    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(10))
        .user_agent("PortalLauncher/1.3")
        .build()
        .map_err(|e| format!("Не удалось создать HTTP client: {e}"))?;
    let profile = client
        .get(format!("https://api.mojang.com/users/profiles/minecraft/{name}"))
        .send().await
        .map_err(|e| format!("Не удалось найти игрока: {e}"))?;
    if profile.status() == reqwest::StatusCode::NO_CONTENT || profile.status() == reqwest::StatusCode::NOT_FOUND {
        return Err("Игрок с таким ником не найден или не имеет публичного профиля.".to_string());
    }
    if !profile.status().is_success() {
        return Err(format!("Minecraft profile API вернул HTTP {}", profile.status()));
    }
    let profile: serde_json::Value = profile.json().await
        .map_err(|e| format!("Не удалось прочитать профиль игрока: {e}"))?;
    let uuid = profile["id"].as_str().unwrap_or("").to_string();
    let resolved_name = profile["name"].as_str().unwrap_or(name).to_string();
    if uuid.is_empty() { return Err("Minecraft profile не вернул UUID игрока.".to_string()); }

    let session = client
        .get(format!("https://sessionserver.mojang.com/session/minecraft/profile/{uuid}"))
        .send().await
        .map_err(|e| format!("Не удалось получить texture profile: {e}"))?;
    if !session.status().is_success() {
        return Err(format!("Minecraft texture API вернул HTTP {}", session.status()));
    }
    let session: serde_json::Value = session.json().await
        .map_err(|e| format!("Не удалось прочитать texture profile: {e}"))?;
    let value = session["properties"].as_array()
        .and_then(|items| items.iter().find(|item| item["name"].as_str() == Some("textures")))
        .and_then(|item| item["value"].as_str())
        .ok_or("У игрока нет доступной public skin texture.")?;
    let decoded = base64::engine::general_purpose::STANDARD.decode(value)
        .map_err(|e| format!("Не удалось decode texture payload: {e}"))?;
    let textures: serde_json::Value = serde_json::from_slice(&decoded)
        .map_err(|e| format!("Не удалось прочитать texture payload: {e}"))?;
    let skin = &textures["textures"]["SKIN"];
    let skin_url = skin["url"].as_str().unwrap_or("").to_string();
    if skin_url.is_empty() { return Err("У игрока нет public skin texture.".to_string()); }
    let skin_variant = if skin["metadata"]["model"].as_str() == Some("slim") { "slim" } else { "classic" };
    let skin_bytes = client.get(&skin_url).send().await
        .map_err(|e| format!("Не удалось скачать skin texture: {e}"))?
        .bytes().await
        .map_err(|e| format!("Не удалось прочитать skin texture: {e}"))?
        .to_vec();
    validate_minecraft_skin_png(&skin_bytes)?;
    Ok(PublicSkinTexture { uuid, name: resolved_name, skin_url, skin_variant: skin_variant.to_string(), skin_bytes })
}

/// Get the active skin for the current authenticated user.
#[tauri::command]
pub async fn get_current_skin(access_token: Option<String>) -> Result<Option<SkinInfo>, String> {
    let token = match access_token {
        Some(t) if !t.is_empty() => t,
        _ => return Ok(None),
    };

    let client = reqwest::Client::new();
    let resp: serde_json::Value = client
        .get("https://api.minecraftservices.com/minecraft/profile")
        .header("Authorization", format!("Bearer {}", token))
        .send()
        .await
        .map_err(|e| format!("Network error: {e}"))?
        .json()
        .await
        .map_err(|e| format!("Parse error: {e}"))?;

    let skin = resp["skins"]
        .as_array()
        .and_then(|skins| skins.iter().find(|s| s["state"] == "ACTIVE"));

    match skin {
        Some(s) => Ok(Some(SkinInfo {
            url: s["url"].as_str().unwrap_or("").to_string(),
            variant: s["variant"].as_str().unwrap_or("CLASSIC").to_lowercase(),
            texture_id: s["id"].as_str().unwrap_or("").to_string(),
        })),
        None => Ok(None),
    }
}

/// Upload a skin PNG from raw bytes — avoids temp-file path issues in the frontend.
#[tauri::command]
pub async fn upload_skin_bytes(
    access_token: String,
    data: Vec<u8>,
    variant: String, // "classic" or "slim"
) -> Result<ProfileTextures, String> {
    upload_bytes_inner(access_token, data, variant).await
}

/// Upload a new skin PNG file to the Microsoft/Minecraft API.
/// Reads the file at `path` and sends the documented multipart POST request.
#[tauri::command]
pub async fn upload_skin(
    access_token: String,
    path: String,
    variant: String, // "classic" or "slim"
) -> Result<ProfileTextures, String> {
    let data = std::fs::read(&path)
        .map_err(|e| format!("Failed to read skin file: {e}"))?;
    upload_bytes_inner(access_token, data, variant).await
}

async fn upload_bytes_inner(access_token: String, data: Vec<u8>, variant: String) -> Result<ProfileTextures, String> {
    validate_minecraft_skin_png(&data)?;

    let part = reqwest::multipart::Part::bytes(data)
        .file_name("skin.png")
        .mime_str("image/png")
        .map_err(|e| format!("MIME error: {e}"))?;

    let form = reqwest::multipart::Form::new()
        .text("variant", variant.to_uppercase())
        .part("file", part);

    let client = reqwest::Client::new();
    let resp = client
        .post("https://api.minecraftservices.com/minecraft/profile/skins")
        .header("Authorization", format!("Bearer {}", access_token))
        .multipart(form)
        .send()
        .await
        .map_err(|e| format!("Upload error: {e}"))?;

    if resp.status().is_success() {
        // The API returns the refreshed profile. Fetch it once more from the
        // authoritative profile endpoint if an empty success response is ever
        // returned, so the frontend never has to guess whether a change stuck.
        let text = resp.text().await.unwrap_or_default();
        if text.trim().is_empty() {
            let profile = fetch_profile(&access_token).await?;
            let textures = profile_textures_from_value(&profile);
            persist_texture_snapshot(&access_token, &textures);
            return Ok(textures);
        }
        let profile: serde_json::Value = serde_json::from_str(&text)
            .map_err(|e| format!("Upload succeeded but profile response was invalid: {e}"))?;
        let textures = profile_textures_from_value(&profile);
        persist_texture_snapshot(&access_token, &textures);
        Ok(textures)
    } else {
        let status = resp.status();
        let body = resp.text().await.unwrap_or_default();
        Err(format!("Upload failed ({}): {}", status, body))
    }
}

/// Minecraft profile skins use a fixed-width PNG texture sheet.  Validate the
/// IHDR header here as well as in the frontend so arbitrary PNGs cannot be
/// sent to Minecraft Services through another invocation path.
fn validate_minecraft_skin_png(data: &[u8]) -> Result<(), String> {
    const PNG_SIGNATURE: [u8; 8] = [137, 80, 78, 71, 13, 10, 26, 10];
    if data.len() < 24 || data[..8] != PNG_SIGNATURE {
        return Err("Skin must be a valid PNG image".to_string());
    }
    if &data[12..16] != b"IHDR" {
        return Err("Skin PNG has no valid IHDR header".to_string());
    }
    let width = u32::from_be_bytes([data[16], data[17], data[18], data[19]]);
    let height = u32::from_be_bytes([data[20], data[21], data[22], data[23]]);
    if width != 64 || (height != 64 && height != 32) {
        return Err("Minecraft skin PNG must be 64×64 or legacy 64×32".to_string());
    }
    Ok(())
}

// ───────────────────────────── Capes ─────────────────────────────

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct CapeInfo {
    pub id: String,
    pub url: String,
    pub alias: String,
    pub active: bool,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct ProfileTextures {
    pub uuid: String,
    pub name: String,
    pub skin_url: String,
    pub skin_variant: String,
    pub capes: Vec<CapeInfo>,
}

fn profile_textures_from_value(v: &serde_json::Value) -> ProfileTextures {
    let skin = v["skins"]
        .as_array()
        .and_then(|skins| skins.iter().find(|skin| skin["state"].as_str() == Some("ACTIVE")))
        .cloned()
        .unwrap_or(serde_json::Value::Null);
    ProfileTextures {
        uuid: v["id"].as_str().unwrap_or("").to_string(),
        name: v["name"].as_str().unwrap_or("").to_string(),
        skin_url: skin["url"].as_str().unwrap_or("").to_string(),
        skin_variant: skin["variant"].as_str().unwrap_or("CLASSIC").to_lowercase(),
        capes: parse_capes(v),
    }
}

/// Keep the launcher's saved account snapshot aligned with confirmed Minecraft
/// Services textures. It never changes the token; it only stores data returned
/// by the official profile endpoint for the active Microsoft account.
fn persist_texture_snapshot(access_token: &str, textures: &ProfileTextures) {
    let Some(mut account) = crate::auth::msa::load_account() else { return; };
    if account.provider.as_deref() != Some("microsoft") || account.access_token != access_token {
        return;
    }
    account.skin_url = (!textures.skin_url.is_empty()).then(|| textures.skin_url.clone());
    account.cape_url = textures.capes.iter()
        .find(|cape| cape.active)
        .map(|cape| cape.url.clone());
    let _ = crate::auth::msa::save_account(&account);
}

async fn fetch_profile(token: &str) -> Result<serde_json::Value, String> {
    let client = reqwest::Client::new();
    let resp = client
        .get("https://api.minecraftservices.com/minecraft/profile")
        .header("Authorization", format!("Bearer {}", token))
        .send()
        .await
        .map_err(|e| format!("Network error: {e}"))?;
    if !resp.status().is_success() {
        let status = resp.status();
        let body = resp.text().await.unwrap_or_default();
        return Err(format!("Profile request failed ({status}): {body}"));
    }
    resp.json().await.map_err(|e| format!("Parse error: {e}"))
}

fn parse_capes(v: &serde_json::Value) -> Vec<CapeInfo> {
    v["capes"]
        .as_array()
        .map(|arr| {
            arr.iter()
                .map(|c| CapeInfo {
                    id: c["id"].as_str().unwrap_or("").to_string(),
                    url: c["url"].as_str().unwrap_or("").to_string(),
                    alias: c["alias"].as_str().unwrap_or("Cape").to_string(),
                    active: c["state"].as_str().unwrap_or("") == "ACTIVE",
                })
                .filter(|c| !c.id.is_empty() && !c.url.is_empty())
                .collect()
        })
        .unwrap_or_default()
}

/// Full texture state of the signed-in account: skin + every owned cape.
#[tauri::command]
pub async fn get_profile_textures(access_token: String) -> Result<ProfileTextures, String> {
    let v = fetch_profile(&access_token).await?;
    Ok(profile_textures_from_value(&v))
}

/// Читает скин/плащ для Ely.by-аккаунта через их публичный skinsystem-прокси
/// (документированный, read-only сервис — https://docs.ely.by/en/skins-system.html).
/// ВАЖНО: авторизованного эндпоинта для ЗАГРУЗКИ скина через Ely.by в открытой
/// документации нет, поэтому здесь только чтение — загрузка для Ely.by-аккаунтов
/// сознательно не реализована, чтобы не городить угаданный (и вероятно нерабочий) API.
#[tauri::command]
pub async fn get_elyby_textures(username: String) -> Result<ProfileTextures, String> {
    let client = reqwest::Client::new();
    let resp = client
        .get(&format!("https://skinsystem.ely.by/textures/{}", username))
        .send()
        .await
        .map_err(|e| format!("Ely.by network error: {e}"))?;

    if resp.status() == reqwest::StatusCode::NO_CONTENT {
        return Ok(ProfileTextures {
            uuid: String::new(), name: username, skin_url: String::new(),
            skin_variant: "classic".to_string(), capes: vec![],
        });
    }
    if !resp.status().is_success() {
        let status = resp.status();
        return Err(format!("Ely.by textures request failed ({status})"));
    }
    let v: serde_json::Value = resp.json().await.map_err(|e| format!("Ely.by parse error: {e}"))?;

    let skin_url = v["SKIN"]["url"].as_str().unwrap_or("").to_string();
    let is_slim = v["SKIN"]["metadata"]["model"].as_str() == Some("slim");
    let cape_url = v["CAPE"]["url"].as_str().unwrap_or("").to_string();
    let capes = if cape_url.is_empty() { vec![] } else {
        vec![CapeInfo { id: "elyby-cape".to_string(), url: cape_url, alias: "Ely.by Cape".to_string(), active: true }]
    };

    Ok(ProfileTextures {
        uuid: String::new(),
        name: username,
        skin_url,
        skin_variant: if is_slim { "slim".to_string() } else { "classic".to_string() },
        capes,
    })
}

/// Every cape owned by the account (checked against Mojang, drawn by the UI).
#[tauri::command]
pub async fn get_profile_capes(access_token: String) -> Result<Vec<CapeInfo>, String> {
    let v = fetch_profile(&access_token).await?;
    Ok(parse_capes(&v))
}

/// Equip a cape by its Mojang cape id.
#[tauri::command]
pub async fn set_active_cape(access_token: String, cape_id: String) -> Result<Vec<CapeInfo>, String> {
    if cape_id.trim().is_empty() {
        return Err("У выбранного плаща нет корректного ID Minecraft Services.".to_string());
    }
    let client = reqwest::Client::new();
    let resp = client
        .put("https://api.minecraftservices.com/minecraft/profile/capes/active")
        .header("Authorization", format!("Bearer {}", access_token))
        .json(&serde_json::json!({ "capeId": cape_id }))
        .send()
        .await
        .map_err(|e| format!("Network error: {e}"))?;
    if !resp.status().is_success() {
        let status = resp.status();
        let body = resp.text().await.unwrap_or_default();
        return Err(format!("Cape change failed ({status}): {body}"));
    }
    let text = resp.text().await.unwrap_or_default();
    if text.trim().is_empty() {
        let profile = fetch_profile(&access_token).await?;
        let textures = profile_textures_from_value(&profile);
        persist_texture_snapshot(&access_token, &textures);
        return Ok(textures.capes);
    }
    let profile: serde_json::Value = serde_json::from_str(&text)
        .map_err(|e| format!("Cape change succeeded but profile response was invalid: {e}"))?;
    let textures = profile_textures_from_value(&profile);
    persist_texture_snapshot(&access_token, &textures);
    Ok(textures.capes)
}

/// Hide the currently equipped cape.
#[tauri::command]
pub async fn hide_active_cape(access_token: String) -> Result<(), String> {
    let client = reqwest::Client::new();
    let resp = client
        .delete("https://api.minecraftservices.com/minecraft/profile/capes/active")
        .header("Authorization", format!("Bearer {}", access_token))
        .send()
        .await
        .map_err(|e| format!("Network error: {e}"))?;
    if resp.status().is_success() { Ok(()) } else {
        let status = resp.status();
        let body = resp.text().await.unwrap_or_default();
        Err(format!("Cape hide failed ({status}): {body}"))
    }
}

/// minecraft_lib::oauth — OAuth2 аутентификация для Minecraft Java Edition
/// Работает через Device Code Flow (без регистрации Azure AD)
/// Сохраняет auth.json который используется minecraft_lib для запуска игры

use serde::{Deserialize, Serialize};
use std::time::Duration;
use std::path::PathBuf;

// ─────────────────────────────────────────────────────────────────────────────
// 1. Константы и типы
// ─────────────────────────────────────────────────────────────────────────────

// Публичный client ID (Prism Launcher), одобрен Mojang для Minecraft API
// и с включённым Device Code Flow. Проверен: /consumers/devicecode выдаёт код.
const MS_CLIENT_ID: &str = "c36a9fb6-4f2a-41ff-90bd-ae7cc92031eb";
const MS_SCOPE: &str = "XboxLive.signin offline_access";
const DEVICE_CODE_URL: &str = "https://login.microsoftonline.com/consumers/oauth2/v2.0/devicecode";
const TOKEN_URL: &str = "https://login.microsoftonline.com/consumers/oauth2/v2.0/token";
const XBL_URL: &str = "https://user.auth.xboxlive.com/user/authenticate";
const XSTS_URL: &str = "https://xsts.auth.xboxlive.com/xsts/authorize";
const MC_AUTH_URL: &str = "https://api.minecraftservices.com/authentication/login_with_xbox";
const MC_PROFILE_URL: &str = "https://api.minecraftservices.com/minecraft/profile";

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DeviceCodeResponse {
    pub device_code: String,
    pub user_code: String,
    pub verification_uri: String,
    pub expires_in: u64,
    pub interval: u64,
    pub message: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct McProfile {
    pub uuid: String,
    pub username: String,
    pub skin_url: Option<String>,
    pub access_token: String,
    pub refresh_token: String,
    pub expires_in: u64,
}

// ─────────────────────────────────────────────────────────────────────────────
// 2. Путь к auth.json
// ─────────────────────────────────────────────────────────────────────────────

pub fn auth_json_path() -> PathBuf {
    dirs_next::data_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join("PortalLauncher")
        .join("auth.json")
}

// ─────────────────────────────────────────────────────────────────────────────
// 3. Сохранение и загрузка auth
// ─────────────────────────────────────────────────────────────────────────────

pub fn save_auth(uuid: &str, username: &str, access_token: &str, refresh_token: &str, expires_in: u64, xuid: Option<&str>, skin_url: Option<&str>) {
    let path = auth_json_path();
    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir).ok();
    }

    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs();

    let data = serde_json::json!({
        "uuid": uuid,
        "username": username,
        "access_token": access_token,
        "refresh_token": refresh_token,
        "xuid": xuid,
        "skin_url": skin_url,
        "expires_at": now + expires_in,
        "refresh_expires_at": now + 31536000,
    });

    if let Ok(json) = serde_json::to_string_pretty(&data) {
        if let Err(e) = std::fs::write(&path, json) {
            log::warn!("Failed to save auth.json: {}", e);
        } else {
            log::info!("✅ Auth saved to: {:?}", path);
        }
    }
}

pub fn load_auth() -> Option<serde_json::Value> {
    let path = auth_json_path();
    std::fs::read_to_string(&path).ok()
        .and_then(|d| serde_json::from_str(&d).ok())
}

fn http_client() -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .user_agent("PortalLauncher/0.1 (Minecraft launcher)")
        .timeout(Duration::from_secs(30))
        .build()
        .map_err(|e| format!("HTTP client error: {e}"))
}

// ─────────────────────────────────────────────────────────────────────────────
// 4. Device Code Flow
// ─────────────────────────────────────────────────────────────────────────────

#[tauri::command]
pub async fn start_device_code_flow() -> Result<DeviceCodeResponse, String> {
    let client = http_client()?;

    let response = client.post(DEVICE_CODE_URL)
        .form(&[("client_id", MS_CLIENT_ID), ("scope", MS_SCOPE)])
        .send()
        .await
        .map_err(|e| format!("Ошибка сети при получении кода: {e}"))?;

    let status = response.status();
    let text = response.text().await.map_err(|e| format!("Ошибка чтения ответа: {e}"))?;

    let raw: serde_json::Value = serde_json::from_str(&text)
        .map_err(|e| format!("Ошибка парсинга device code: {e}"))?;

    if !status.is_success() {
        let desc = raw["error_description"].as_str()
            .or(raw["error"].as_str())
            .unwrap_or(&text);
        log::warn!("Device code request failed: {}", desc);
        return Err(format!("Не удалось получить код входа: {desc}"));
    }

    let device_code = raw["device_code"]
        .as_str()
        .ok_or("Microsoft не вернул device_code")?
        .to_string();
    let user_code = raw["user_code"]
        .as_str()
        .ok_or("Microsoft не вернул user_code")?
        .to_string();
    let verification_uri = raw["verification_uri"]
        .as_str()
        .or(raw["verification_url"].as_str())
        .unwrap_or("https://www.microsoft.com/link")
        .to_string();
    let expires_in = raw["expires_in"].as_u64().unwrap_or(900);
    let interval = raw["interval"].as_u64().unwrap_or(5);

    let msg = format!(
        "1. Откройте {}\n2. Введите код: {}\n3. Войдите в Microsoft аккаунт",
        &verification_uri, &user_code
    );

    log::info!("🔑 Device code issued: {} (expires in {}s)", user_code, expires_in);

    Ok(DeviceCodeResponse {
        device_code,
        user_code,
        verification_uri,
        expires_in,
        interval,
        message: msg,
    })
}

/// Один шаг опроса токена. Фронтенд вызывает это раз в `interval` секунд.
/// - Пользователь ещё не ввёл код → Ok(None)  (authorization_pending / slow_down)
/// - Пользователь вошёл          → Ok(Some(McProfile))  (полная цепочка MSA→XBL→XSTS→MC)
/// - Реальная ошибка             → Err(описание)
#[tauri::command]
pub async fn poll_for_token(device_code: String) -> Result<Option<McProfile>, String> {
    let client = http_client()?;

    let text = client.post(TOKEN_URL)
        .form(&[
            ("client_id", MS_CLIENT_ID),
            ("grant_type", "urn:ietf:params:oauth:grant-type:device_code"),
            ("device_code", device_code.as_str()),
        ])
        .send()
        .await
        .map_err(|e| format!("Ошибка запроса токена: {e}"))?
        .text()
        .await
        .map_err(|e| format!("Ошибка чтения токена: {e}"))?;

    let resp: serde_json::Value = serde_json::from_str(&text)
        .map_err(|e| format!("Ошибка парсинга токена: {e}"))?;

    if let Some(err) = resp["error"].as_str() {
        // Ещё ждём вход пользователя в браузере — это не ошибка
        if err == "authorization_pending" || err == "slow_down" {
            return Ok(None);
        }
        if err == "expired_token" {
            return Err("Код истёк. Нажмите \"Получить новый код\".".into());
        }
        if err == "authorization_declined" {
            return Err("Вход отклонён пользователем.".into());
        }
        let desc = resp["error_description"].as_str().unwrap_or(err);
        return Err(format!("Ошибка аутентификации: {desc}"));
    }

    // Токен получен — пользователь вошёл в браузере!
    let ms_token = resp["access_token"]
        .as_str()
        .ok_or("Нет access_token в ответе")?
        .to_string();

    let ms_refresh = resp["refresh_token"]
        .as_str()
        .unwrap_or("")
        .to_string();

    let ms_expires = resp["expires_in"].as_u64().unwrap_or(86400);

    log::info!("✅ MSA токен получен, финализирую вход...");

    finalize_msa_login(&client, &ms_token, &ms_refresh, ms_expires).await.map(Some)
}

async fn finalize_msa_login(
    client: &reqwest::Client,
    ms_token: &str,
    refresh_token: &str,
    ms_expires: u64,
) -> Result<McProfile, String> {
    log::info!("🔄 Получаю XBL токен...");
    
    // MS → XBL
    // ВАЖНО: RpsTicket должен начинаться с "d=" для современного OAuth-токена
    // (consumers tenant). Префикс "t=" — это формат СТАРОГО live.com-тикета
    // и с текущим access_token Xbox Live отвечает ошибкой с пустым телом,
    // из-за чего JSON-парсер падает с "EOF while parsing a value" — эта
    // невнятная ошибка и была на самом деле "неверный формат RpsTicket".
    let xbl_resp = client.post(XBL_URL)
        .json(&serde_json::json!({
            "Properties": {
                "AuthMethod": "RPS",
                "SiteName": "user.auth.xboxlive.com",
                "RpsTicket": format!("d={ms_token}")
            },
            "RelyingParty": "http://auth.xboxlive.com",
            "TokenType": "JWT"
        }))
        .header("Accept", "application/json")
        .send()
        .await
        .map_err(|e| format!("XBL запрос: {e}"))?;
    let xbl_status = xbl_resp.status();
    let xbl_text = xbl_resp.text()
        .await
        .map_err(|e| format!("XBL чтение: {e}"))?;

    if !xbl_status.is_success() {
        return Err(format!("XBL authentication failed ({xbl_status}): {xbl_text}"));
    }
    let xbl: serde_json::Value = serde_json::from_str(&xbl_text)
        .map_err(|e| format!("XBL ответ ({xbl_status}, body: {xbl_text:?}): {e}"))?;

    if let Some(x) = xbl.get("XErr") {
        return Err(format!("XBL error code: {}", x.as_u64().unwrap_or(0)));
    }
    
    let xbl_token = xbl["Token"].as_str().ok_or("Нет XBL токена")?;
    let user_hash = xbl["DisplayClaims"]["xui"][0]["uhs"].as_str().ok_or("Нет user hash")?;

    log::info!("🔄 Получаю XSTS токен...");
    
    // XBL → XSTS
    let xsts_resp = client.post(XSTS_URL)
        .json(&serde_json::json!({
            "Properties": {
                "SandboxId": "RETAIL",
                "UserTokens": [xbl_token]
            },
            "RelyingParty": "rp://api.minecraftservices.com/",
            "TokenType": "JWT"
        }))
        .header("Accept", "application/json")
        .send()
        .await
        .map_err(|e| format!("XSTS запрос: {e}"))?;
    let xsts_status = xsts_resp.status();
    let xsts_text = xsts_resp.text()
        .await
        .map_err(|e| format!("XSTS чтение: {e}"))?;

    if !xsts_status.is_success() {
        return Err(format!("XSTS authentication failed ({xsts_status}): {xsts_text}"));
    }
    let xsts: serde_json::Value = serde_json::from_str(&xsts_text)
        .map_err(|e| format!("XSTS ответ ({xsts_status}, body: {xsts_text:?}): {e}"))?;

    if let Some(x) = xsts.get("XErr") {
        return Err(format!("XSTS error code: {}", x.as_u64().unwrap_or(0)));
    }
    
    let xsts_token = xsts["Token"].as_str().ok_or("Нет XSTS токена")?;

    log::info!("🔄 Получаю Minecraft токен...");
    
    // XSTS → MC
    let mc_resp = client.post(MC_AUTH_URL)
        .json(&serde_json::json!({
            "identityToken": format!("XBL3.0 x={user_hash};{xsts_token}")
        }))
        .send()
        .await
        .map_err(|e| format!("MC auth запрос: {e}"))?;
    let mc_status = mc_resp.status();
    let mc_text = mc_resp.text()
        .await
        .map_err(|e| format!("MC auth чтение: {e}"))?;

    if !mc_status.is_success() {
        return Err(format!("Minecraft authentication failed ({mc_status}): {mc_text}"));
    }
    let mc: serde_json::Value = serde_json::from_str(&mc_text)
        .map_err(|e| format!("MC auth ответ ({mc_status}, body: {mc_text:?}): {e}"))?;

    let mc_token = mc["access_token"].as_str()
        .ok_or("Нет Minecraft токена. Убедитесь что у вас Minecraft Java Edition.")?;

    log::info!("🔄 Получаю профиль Minecraft...");
    
    // Получаем профиль
    let profile_text = client.get(MC_PROFILE_URL)
        .header("Authorization", format!("Bearer {mc_token}"))
        .send()
        .await
        .map_err(|e| format!("Profile запрос: {e}"))?
        .text()
        .await
        .map_err(|e| format!("Profile чтение: {e}"))?;

    let profile: serde_json::Value = serde_json::from_str(&profile_text)
        .map_err(|e| format!("Profile ответ: {e}"))?;

    if let Some(err) = profile["error"].as_str() {
        if err == "NOT_FOUND" {
            return Err("Minecraft профиль не найден. Убедитесь что у вас куплен Minecraft Java Edition.".into());
        }
        return Err(format!("Profile error: {err}"));
    }

    let uuid = profile["id"].as_str().ok_or("Нет UUID в профиле")?.to_string();
    let username = profile["name"].as_str().ok_or("Нет имени в профиле")?.to_string();
    let skin_url = profile["skins"].as_array()
        .and_then(|s| s.iter().find(|s| s["state"] == "ACTIVE"))
        .and_then(|s| s["url"].as_str())
        .map(String::from);

    let xuid = xbl["DisplayClaims"]["xui"][0]["uhs"].as_str().map(String::from);

    log::info!("✅ Аутентификация успешна: {} ({})", username, uuid);

    // Сохраняем auth.json
    save_auth(&uuid, &username, mc_token, refresh_token, ms_expires, xuid.as_deref(), skin_url.as_deref());

    Ok(McProfile {
        uuid,
        username,
        skin_url,
        access_token: mc_token.to_string(),
        refresh_token: refresh_token.to_string(),
        expires_in: ms_expires,
    })
}

// ─────────────────────────────────────────────────────────────────────────────
// 5. Refresh token
// ─────────────────────────────────────────────────────────────────────────────

#[tauri::command]
pub async fn refresh_token(refresh_token: &str) -> Result<McProfile, String> {
    let client = reqwest::Client::builder()
        .user_agent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36")
        .timeout(Duration::from_secs(30))
        .build()
        .map_err(|e| format!("HTTP client error: {e}"))?;

    let text = client.post(TOKEN_URL)
        .form(&[
            ("client_id", MS_CLIENT_ID),
            ("refresh_token", refresh_token),
            ("grant_type", "refresh_token"),
            ("scope", MS_SCOPE),
        ])
        .send()
        .await
        .map_err(|e| format!("Network: {e}"))?
        .text()
        .await
        .map_err(|e| format!("Read: {e}"))?;

    let resp: serde_json::Value = serde_json::from_str(&text)
        .map_err(|e| format!("Parse: {e}"))?;

    if let Some(err) = resp["error"].as_str() {
        let desc = resp["error_description"].as_str().unwrap_or(err);
        return Err(format!("Refresh error: {desc}"));
    }

    let ms_token = resp["access_token"]
        .as_str()
        .ok_or("No MS access_token after refresh")?
        .to_string();
    
    let new_refresh = resp["refresh_token"]
        .as_str()
        .unwrap_or(refresh_token)
        .to_string();
    
    let ms_expires = resp["expires_in"].as_u64().unwrap_or(86400);

    finalize_msa_login(&client, &ms_token, &new_refresh, ms_expires).await
}

// ─────────────────────────────────────────────────────────────────────────────
// 6. Проверка и авто-обновление токена
// ─────────────────────────────────────────────────────────────────────────────

#[tauri::command]
pub fn is_token_expired() -> bool {
    let v = match load_auth() {
        Some(v) => v,
        None => return true,
    };

    let expires_at = v["expires_at"].as_u64().unwrap_or(0);
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs();

    expires_at <= now + 1800 // Запас 30 минут
}

#[tauri::command]
pub async fn auto_refresh_if_needed() -> Result<Option<McProfile>, String> {
    let v = match load_auth() {
        Some(v) => v,
        None => return Ok(None),
    };

    let stored_refresh = match v["refresh_token"].as_str() {
        Some(r) if !r.is_empty() && r != "0" => r.to_string(),
        _ => {
            // No refresh token (offline/demo mode)
            return Ok(Some(McProfile {
                uuid: v["uuid"].as_str().unwrap_or("").to_string(),
                username: v["username"].as_str().unwrap_or("").to_string(),
                skin_url: v["skin_url"].as_str().map(String::from),
                access_token: v["access_token"].as_str().unwrap_or("").to_string(),
                refresh_token: String::new(),
                expires_in: 0,
            }));
        }
    };

    let expires_at = v["expires_at"].as_u64().unwrap_or(0);
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs();

    if expires_at > now + 1800 {
        // Token still valid
        log::info!("✅ Token valid, returning cached profile");
        return Ok(Some(McProfile {
            uuid: v["uuid"].as_str().unwrap_or("").to_string(),
            username: v["username"].as_str().unwrap_or("").to_string(),
            skin_url: v["skin_url"].as_str().map(String::from),
            access_token: v["access_token"].as_str().unwrap_or("").to_string(),
            refresh_token: stored_refresh,
            expires_in: expires_at.saturating_sub(now),
        }));
    }

    // Token expired or about to expire — try to refresh
    log::info!("⏰ Token expired, refreshing...");
    match refresh_token(&stored_refresh).await {
        Ok(p) => {
            log::info!("✅ Token refreshed successfully");
            Ok(Some(p))
        }
        Err(e) => {
            log::warn!("❌ Token refresh failed: {}", e);
            // Return cached profile even if expired (for offline mode)
            Ok(Some(McProfile {
                uuid: v["uuid"].as_str().unwrap_or("").to_string(),
                username: v["username"].as_str().unwrap_or("").to_string(),
                skin_url: v["skin_url"].as_str().map(String::from),
                access_token: v["access_token"].as_str().unwrap_or("").to_string(),
                refresh_token: stored_refresh,
                expires_in: 0,
            }))
        }
    }
}

#[tauri::command]
pub fn get_cached_profile() -> Option<McProfile> {
    let v = load_auth()?;
    
    let expires_at = v["expires_at"].as_u64().unwrap_or(0);
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs();

    if expires_at > now {
        Some(McProfile {
            uuid: v["uuid"].as_str().unwrap_or("").to_string(),
            username: v["username"].as_str().unwrap_or("").to_string(),
            skin_url: v["skin_url"].as_str().map(String::from),
            access_token: v["access_token"].as_str().unwrap_or("").to_string(),
            refresh_token: v["refresh_token"].as_str().unwrap_or("").to_string(),
            expires_in: expires_at.saturating_sub(now),
        })
    } else {
        None
    }
}

// ── Офлайн-вход и Ely.by ─────────────────────────────────────────────────

/// Вычисляет offline-UUID так же, как это делает ванильный клиент:
/// UUID.nameUUIDFromBytes(("OfflinePlayer:" + name).getBytes(UTF_8)) —
/// это MD5 от СТРОКИ БЕЗ NAMESPACE (не путать со стандартным RFC4122 v3,
/// который добавляет 16 байт namespace перед именем — тут их нет).
fn offline_uuid(username: &str) -> String {
    let data = format!("OfflinePlayer:{username}");
    let digest = md5::compute(data.as_bytes());
    let mut bytes: [u8; 16] = digest.0;
    bytes[6] = (bytes[6] & 0x0f) | 0x30; // версия 3
    bytes[8] = (bytes[8] & 0x3f) | 0x80; // вариант RFC4122
    let hex: String = bytes.iter().map(|b| format!("{:02x}", b)).collect();
    format!(
        "{}-{}-{}-{}-{}",
        &hex[0..8], &hex[8..12], &hex[12..16], &hex[16..20], &hex[20..32]
    )
}

/// Вход "по нику" без какой-либо проверки владения игрой — то же самое,
/// что делает ЛЮБОЙ сторонний лаунчер (Prism, MultiMC и т.д.) в offline-режиме.
/// Работает только на серверах с online-mode=false или в одиночной игре/LAN —
/// это не обход покупки игры, а стандартная функция для тестирования/LAN.
#[tauri::command]
pub async fn login_offline(username: String) -> Result<McProfile, String> {
    let username = username.trim().to_string();
    if username.is_empty() || username.len() > 16 {
        return Err("Ник должен быть от 1 до 16 символов.".into());
    }
    Ok(McProfile {
        uuid: offline_uuid(&username),
        username,
        skin_url: None,
        access_token: String::new(),
        refresh_token: String::new(),
        expires_in: 0,
    })
}

/// Вход через Ely.by — сторонний авторизационный сервис для Minecraft,
/// использующий legacy Yggdrasil-совместимый протокол. Работает на серверах,
/// которые сами настроили проверку через Ely.by (authlib-injector).
/// ВАЖНО: это даёт валидный access-токен и профиль, но для полноценной
/// работы скинов/плащей на Ely-серверах нужен ещё JVM-агент authlib-injector
/// при запуске игры — это отдельная задача, здесь только сам вход.
#[tauri::command]
pub async fn login_elyby(username: String, password: String) -> Result<McProfile, String> {
    let client = reqwest::Client::builder()
        .user_agent("PortalLauncher/1.1")
        .build()
        .map_err(|e| e.to_string())?;

    let client_token = uuid::Uuid::new_v4().to_string();
    let resp = client
        .post("https://authserver.ely.by/auth/authenticate")
        .json(&serde_json::json!({
            "agent": { "name": "Minecraft", "version": 1 },
            "username": username,
            "password": password,
            "clientToken": client_token,
            "requestUser": true
        }))
        .send()
        .await
        .map_err(|e| format!("Ely.by запрос: {e}"))?;

    let status = resp.status();
    let text = resp.text().await.map_err(|e| format!("Ely.by чтение: {e}"))?;

    if !status.is_success() {
        // Ely.by возвращает {"error":"...","errorMessage":"человекочитаемое сообщение"}
        let msg = serde_json::from_str::<serde_json::Value>(&text)
            .ok()
            .and_then(|v| v["errorMessage"].as_str().map(String::from))
            .unwrap_or(text);
        return Err(format!("Ely.by: {msg}"));
    }

    let v: serde_json::Value =
        serde_json::from_str(&text).map_err(|e| format!("Ely.by ответ ({status}): {e}"))?;

    let access_token = v["accessToken"].as_str().ok_or("Ely.by: нет accessToken")?.to_string();
    let profile = &v["selectedProfile"];
    let raw_id = profile["id"].as_str().ok_or("Ely.by: нет профиля")?.to_string();
    let name = profile["name"].as_str().unwrap_or(&username).to_string();
    // Ely.by отдаёт UUID без дефисов — приводим к обычному формату.
    let uuid = if raw_id.len() == 32 && !raw_id.contains('-') {
        format!(
            "{}-{}-{}-{}-{}",
            &raw_id[0..8], &raw_id[8..12], &raw_id[12..16], &raw_id[16..20], &raw_id[20..32]
        )
    } else {
        raw_id
    };

    Ok(McProfile {
        uuid,
        username: name,
        skin_url: Some(format!("https://ely.by/skin/{username}.png")),
        access_token,
        refresh_token: client_token,
        expires_in: 86400,
    })
}

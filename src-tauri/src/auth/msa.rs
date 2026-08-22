//! Полный Microsoft OAuth 2.0 **Authorization Code Flow** для Minecraft Java Edition.
//!
//! Цепочка (официальная, как в Mojang Launcher):
//!   1. Microsoft OAuth  (authorize -> code -> access_token / refresh_token)
//!   2. Xbox Live        (user.auth.xboxlive.com/user/authenticate)
//!   3. XSTS             (xsts.auth.xboxlive.com/xsts/authorize)
//!   4. Minecraft        (api.minecraftservices.com/authentication/login_with_xbox)
//!   5. Entitlements     (проверка лицензии game_minecraft / product_minecraft)
//!   6. Profile          (uuid, username, skin)
//!
//! Код авторизации получается во встроенном окне WebView: пользователь входит в
//! Microsoft, редирект на `https://login.live.com/oauth20_desktop.srf?code=...`
//! перехватывается, окно закрывается. Дополнительно поддержан свой Azure
//! client_id + PKCE + loopback-редирект (настройка `msa_client_id`).

use base64::Engine;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::path::PathBuf;
use std::time::Duration;
use tauri::{Emitter, Manager, WebviewUrl, WebviewWindowBuilder};

/// Публичный client_id клиента Minecraft (Mojang). Поддерживает
/// desktop-редирект без регистрации приложения в Azure.
/// Публичный Azure client_id Prism Launcher (open-source, public client).
const PRISM_CLIENT_ID: &str = "c36a9fb6-4f2a-41ff-90bd-ae7cc92031eb";
/// Устаревший публичный client_id Mojang Launcher — рабочий резерв,
/// если Azure-приложение отклоняет redirect_uri.
const LEGACY_CLIENT_ID: &str = "00000000402b5328";
const DESKTOP_REDIRECT: &str = "https://login.live.com/oauth20_desktop.srf";
/// Redirect для публичных Azure-клиентов (Prism и др.).
const NATIVE_REDIRECT: &str = "https://login.microsoftonline.com/common/oauth2/nativeclient";
const LIVE_AUTHORIZE: &str = "https://login.live.com/oauth20_authorize.srf";
const LIVE_TOKEN: &str = "https://login.live.com/oauth20_token.srf";
const AAD_AUTHORIZE: &str = "https://login.microsoftonline.com/consumers/oauth2/v2.0/authorize";
const AAD_TOKEN: &str = "https://login.microsoftonline.com/consumers/oauth2/v2.0/token";
const SCOPE: &str = "XboxLive.signin offline_access";

const XBL_URL: &str = "https://user.auth.xboxlive.com/user/authenticate";
const XSTS_URL: &str = "https://xsts.auth.xboxlive.com/xsts/authorize";
const MC_LOGIN_URL: &str = "https://api.minecraftservices.com/authentication/login_with_xbox";
const MC_ENTITLEMENTS_URL: &str = "https://api.minecraftservices.com/entitlements/mcstore";
const MC_PROFILE_URL: &str = "https://api.minecraftservices.com/minecraft/profile";

const LOGIN_WINDOW: &str = "msa-login";

// ─────────────────────────────────────────────────────────────────────────────
// Модели
// ─────────────────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Account {
    pub uuid: String,
    pub username: String,
    pub skin_url: Option<String>,
    pub cape_url: Option<String>,
    pub access_token: String,
    pub refresh_token: String,
    pub xuid: Option<String>,
    /// Unix-время истечения Minecraft-токена
    pub expires_at: u64,
    /// true — купленная (лицензионная) копия Minecraft Java Edition
    pub licensed: bool,
    pub demo: bool,
    /// Источник сессии: microsoft, elyby или offline. Необязателен в старых auth.json.
    pub provider: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct MsTokens {
    access_token: String,
    refresh_token: String,
    expires_in: u64,
}

fn now() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs()
}

pub fn auth_json_path() -> PathBuf {
    crate::commands::version_manager::mc_base_dir().join("auth.json")
}

fn client() -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .user_agent("PortalLauncher/1.2 (Minecraft launcher)")
        .timeout(Duration::from_secs(45))
        .build()
        .map_err(|e| format!("HTTP client error: {e}"))
}

/// Свой Azure client_id из настроек (если пользователь его задал).
fn custom_client_id() -> Option<String> {
    let raw = std::fs::read_to_string(
        crate::commands::version_manager::mc_base_dir().join("settings.json"),
    )
    .ok()?;
    let v: serde_json::Value = serde_json::from_str(&raw).ok()?;
    v.get("msa_client_id")
        .and_then(|x| x.as_str())
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
}

fn pkce_pair() -> (String, String) {
    let raw: [u8; 32] = {
        let mut out = [0u8; 32];
        let seed = uuid::Uuid::new_v4().as_bytes().to_vec();
        let seed2 = uuid::Uuid::new_v4().as_bytes().to_vec();
        out[..16].copy_from_slice(&seed);
        out[16..].copy_from_slice(&seed2);
        out
    };
    let verifier = base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(raw);
    let challenge =
        base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(Sha256::digest(verifier.as_bytes()));
    (verifier, challenge)
}

// ─────────────────────────────────────────────────────────────────────────────
// Сохранение / чтение аккаунта
// ─────────────────────────────────────────────────────────────────────────────

pub fn save_account(acc: &Account) -> Result<(), String> {
    let path = auth_json_path();
    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir).ok();
    }
    // Формат совместим со старым auth.json (username/uuid/access_token/...)
    let json = serde_json::json!({
        "uuid": acc.uuid,
        "username": acc.username,
        "access_token": acc.access_token,
        "refresh_token": acc.refresh_token,
        "xuid": acc.xuid,
        "skin_url": acc.skin_url,
        "cape_url": acc.cape_url,
        "expires_at": acc.expires_at,
        "licensed": acc.licensed,
        "demo": acc.demo,
        "provider": acc.provider,
    });
    std::fs::write(
        &path,
        serde_json::to_string_pretty(&json).map_err(|e| e.to_string())?,
    )
    .map_err(|e| format!("Не удалось сохранить auth.json: {e}"))
}

pub fn load_account() -> Option<Account> {
    let raw = std::fs::read_to_string(auth_json_path()).ok()?;
    let v: serde_json::Value = serde_json::from_str(&raw).ok()?;
    Some(Account {
        uuid: v["uuid"].as_str()?.to_string(),
        username: v["username"].as_str().unwrap_or("Player").to_string(),
        skin_url: v["skin_url"].as_str().map(String::from),
        cape_url: v["cape_url"].as_str().map(String::from),
        access_token: v["access_token"].as_str().unwrap_or("").to_string(),
        refresh_token: v["refresh_token"].as_str().unwrap_or("").to_string(),
        xuid: v["xuid"].as_str().map(String::from),
        expires_at: v["expires_at"].as_u64().unwrap_or(0),
        licensed: v["licensed"].as_bool().unwrap_or(true),
        demo: v["demo"].as_bool().unwrap_or(false),
        // Старые файлы не содержали provider: до Ely.by единственным
        // лицензированным потоком был Microsoft, поэтому сохраняем совместимость.
        provider: v["provider"].as_str().map(String::from).or_else(|| {
            if v["demo"].as_bool().unwrap_or(false) { Some("offline".to_string()) }
            else { Some("microsoft".to_string()) }
        }),
    })
}

// ─────────────────────────────────────────────────────────────────────────────
// 1. Вход: встроенное окно WebView + перехват ?code=
// ─────────────────────────────────────────────────────────────────────────────

fn login_candidates() -> Vec<(String, bool, &'static str)> {
    if let Some(custom) = custom_client_id() {
        return vec![(custom, true, NATIVE_REDIRECT)];
    }
    vec![
        (PRISM_CLIENT_ID.to_string(), true, NATIVE_REDIRECT),
        (LEGACY_CLIENT_ID.to_string(), false, DESKTOP_REDIRECT),
    ]
}

/// Сохраняем client_id, которым вошли, чтобы refresh шёл тем же приложением.
fn save_used_client_id(client_id: &str, use_aad: bool) {
    let path = crate::commands::version_manager::mc_base_dir().join("auth_client.json");
    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir).ok();
    }
    std::fs::write(
        path,
        serde_json::json!({ "client_id": client_id, "aad": use_aad }).to_string(),
    )
    .ok();
}

fn used_client_id() -> (String, bool) {
    let path = crate::commands::version_manager::mc_base_dir().join("auth_client.json");
    if let Some(v) = std::fs::read_to_string(path)
        .ok()
        .and_then(|raw| serde_json::from_str::<serde_json::Value>(&raw).ok())
    {
        if let Some(cid) = v["client_id"].as_str() {
            return (cid.to_string(), v["aad"].as_bool().unwrap_or(cid != LEGACY_CLIENT_ID));
        }
    }
    if let Some(custom) = custom_client_id() {
        return (custom, true);
    }
    (PRISM_CLIENT_ID.to_string(), true)
}

#[tauri::command]
pub async fn msa_login(app: tauri::AppHandle) -> Result<Account, String> {
    let mut last_err = String::new();
    for (client_id, use_aad, redirect) in login_candidates() {
        match msa_login_with(&app, &client_id, use_aad, redirect).await {
            Ok(acc) => {
                save_used_client_id(&client_id, use_aad);
                return Ok(acc);
            }
            Err(e) => {
                // Ошибки регистрации приложения (redirect_uri/клиент) — пробуем следующий client_id.
                let retryable = e.contains("AADSTS")
                    || e.contains("unauthorized_client")
                    || e.contains("invalid_client")
                    || e.contains("invalid_request")
                    || e.contains("redirect");
                last_err = e;
                if !retryable {
                    return Err(last_err);
                }
                log::warn!("client_id {client_id} не подошёл: {last_err}");
            }
        }
    }
    Err(if last_err.is_empty() {
        "Не удалось войти в Microsoft".to_string()
    } else {
        last_err
    })
}

async fn msa_login_with(
    app: &tauri::AppHandle,
    client_id: &str,
    use_aad: bool,
    redirect: &str,
) -> Result<Account, String> {
    let (verifier, challenge) = pkce_pair();
    let state = uuid::Uuid::new_v4().to_string();

    let authorize_url = if use_aad {
        format!(
            "{AAD_AUTHORIZE}?client_id={cid}&response_type=code&redirect_uri={redir}&scope={scope}\
&response_mode=query&state={state}&code_challenge={challenge}&code_challenge_method=S256&prompt=select_account",
            cid = urlencoding::encode(client_id),
            redir = urlencoding::encode(redirect),
            scope = urlencoding::encode(SCOPE),
        )
    } else {
        format!(
            "{LIVE_AUTHORIZE}?client_id={cid}&response_type=code&redirect_uri={redir}&scope={scope}&state={state}&prompt=select_account",
            cid = urlencoding::encode(client_id),
            redir = urlencoding::encode(redirect),
            scope = urlencoding::encode("service::user.auth.xboxlive.com::MBI_SSL"),
        )
    };

    // Закрываем предыдущее окно логина, если оно осталось
    if let Some(w) = app.get_webview_window(LOGIN_WINDOW) {
        w.close().ok();
        tokio::time::sleep(Duration::from_millis(200)).await;
    }

    let window = WebviewWindowBuilder::new(
        app,
        LOGIN_WINDOW,
        WebviewUrl::External(authorize_url.parse().map_err(|e| format!("bad url: {e}"))?),
    )
    .title("Вход в Microsoft")
    .inner_size(520.0, 720.0)
    .resizable(true)
    .center()
    .build()
    .map_err(|e| format!("Не удалось открыть окно входа: {e}"))?;

    // Ждём редирект на redirect_uri?code=... (или ?error=...)
    let deadline = now() + 300;
    let mut code: Option<String> = None;
    loop {
        tokio::time::sleep(Duration::from_millis(350)).await;

        if app.get_webview_window(LOGIN_WINDOW).is_none() {
            return Err("Окно входа закрыто до завершения авторизации.".into());
        }
        if now() > deadline {
            window.close().ok();
            return Err("Время входа истекло (5 минут). Попробуйте снова.".into());
        }

        let url = match window.url() {
            Ok(u) => u,
            Err(_) => continue,
        };
        let url_str = url.as_str().to_string();

        // Ошибка Azure может прийти прямо на странице authorize
        if url_str.contains("error=") && url_str.contains("AADSTS") {
            let pairs: std::collections::HashMap<String, String> = url
                .query_pairs()
                .map(|(k, v)| (k.to_string(), v.to_string()))
                .collect();
            let desc = pairs
                .get("error_description")
                .cloned()
                .unwrap_or_else(|| "AADSTS".to_string());
            window.close().ok();
            return Err(desc);
        }

        let hit_redirect = url_str.starts_with(redirect)
            || url_str.contains("oauth20_desktop.srf")
            || url_str.contains("oauth2/nativeclient");
        if !hit_redirect {
            continue;
        }
        let pairs: std::collections::HashMap<String, String> = url
            .query_pairs()
            .map(|(k, v)| (k.to_string(), v.to_string()))
            .collect();
        if let Some(err) = pairs.get("error") {
            let desc = pairs
                .get("error_description")
                .cloned()
                .unwrap_or_else(|| err.clone());
            window.close().ok();
            return Err(format!("Microsoft отклонил вход: {desc}"));
        }
        if let Some(c) = pairs.get("code") {
            code = Some(c.clone());
            break;
        }
    }
    window.close().ok();
    let code = code.ok_or("Microsoft не вернул код авторизации")?;

    app.emit(
        "auth-progress",
        serde_json::json!({ "step": "microsoft", "message": "Обмениваю код на токен…" }),
    )
    .ok();

    let http = client()?;
    let tokens = exchange_code(&http, client_id, &code, &verifier, use_aad, redirect).await?;
    finish_login(app, &http, tokens).await
}

async fn exchange_code(
    http: &reqwest::Client,
    client_id: &str,
    code: &str,
    verifier: &str,
    use_aad: bool,
    redirect: &str,
) -> Result<MsTokens, String> {
    let url = if use_aad { AAD_TOKEN } else { LIVE_TOKEN };
    let mut form: Vec<(&str, &str)> = vec![
        ("client_id", client_id),
        ("code", code),
        ("grant_type", "authorization_code"),
        ("redirect_uri", redirect),
    ];
    if use_aad {
        form.push(("scope", SCOPE));
        form.push(("code_verifier", verifier));
    }

    let resp = http
        .post(url)
        .form(&form)
        .send()
        .await
        .map_err(|e| format!("Сеть (token): {e}"))?;
    let text = resp.text().await.map_err(|e| format!("Ответ (token): {e}"))?;
    let v: serde_json::Value =
        serde_json::from_str(&text).map_err(|e| format!("Разбор токена: {e} — {text}"))?;

    if let Some(err) = v["error"].as_str() {
        let desc = v["error_description"].as_str().unwrap_or(err);
        return Err(format!("Ошибка получения токена Microsoft: {desc}"));
    }
    Ok(MsTokens {
        access_token: v["access_token"]
            .as_str()
            .ok_or("нет access_token")?
            .to_string(),
        refresh_token: v["refresh_token"].as_str().unwrap_or("").to_string(),
        expires_in: v["expires_in"].as_u64().unwrap_or(3600),
    })
}

// ─────────────────────────────────────────────────────────────────────────────
// 2. Xbox Live -> XSTS -> Minecraft -> Entitlements -> Profile
// ─────────────────────────────────────────────────────────────────────────────

async fn finish_login(
    app: &tauri::AppHandle,
    http: &reqwest::Client,
    tokens: MsTokens,
) -> Result<Account, String> {
    let progress = |step: &str, msg: &str| {
        app.emit(
            "auth-progress",
            serde_json::json!({ "step": step, "message": msg }),
        )
        .ok();
    };

    progress("xbox", "Вход в Xbox Live…");
    let (xbl_token, _uhs0) = xbox_authenticate(http, &tokens.access_token).await?;

    progress("xsts", "Получение XSTS-токена…");
    let (xsts_token, uhs) = xsts_authorize(http, &xbl_token).await?;

    progress("minecraft", "Авторизация в Minecraft Services…");
    let (mc_token, mc_expires) = minecraft_login(http, &uhs, &xsts_token).await?;

    progress("entitlements", "Проверка лицензии Minecraft…");
    let licensed = check_entitlements(http, &mc_token).await?;
    if !licensed {
        return Err(
            "На этом аккаунте Microsoft нет лицензии Minecraft: Java Edition. \
Купите игру на minecraft.net или войдите другим аккаунтом."
                .into(),
        );
    }

    progress("profile", "Загрузка профиля…");
    let (uuid, username, skin_url, cape_url) = minecraft_profile(http, &mc_token).await?;

    let account = Account {
        uuid,
        username,
        skin_url,
        cape_url,
        access_token: mc_token,
        refresh_token: tokens.refresh_token,
        xuid: Some(uhs),
        expires_at: now() + mc_expires.min(tokens.expires_in.max(mc_expires)),
        licensed: true,
        demo: false,
        provider: Some("microsoft".to_string()),
    };
    save_account(&account)?;
    app.emit("auth-success", &account).ok();
    Ok(account)
}

async fn xbox_authenticate(
    http: &reqwest::Client,
    ms_access_token: &str,
) -> Result<(String, String), String> {
    let body = serde_json::json!({
        "Properties": {
            "AuthMethod": "RPS",
            "SiteName": "user.auth.xboxlive.com",
            "RpsTicket": format!("d={ms_access_token}")
        },
        "RelyingParty": "http://auth.xboxlive.com",
        "TokenType": "JWT"
    });
    let resp = http
        .post(XBL_URL)
        .header("Accept", "application/json")
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("Сеть (Xbox Live): {e}"))?;
    let status = resp.status();
    let text = resp.text().await.unwrap_or_default();
    if !status.is_success() {
        return Err(format!("Xbox Live отказал ({status}): {text}"));
    }
    let v: serde_json::Value =
        serde_json::from_str(&text).map_err(|e| format!("Разбор Xbox Live: {e}"))?;
    let token = v["Token"].as_str().ok_or("Xbox Live не вернул Token")?.to_string();
    let uhs = v["DisplayClaims"]["xui"][0]["uhs"]
        .as_str()
        .unwrap_or("")
        .to_string();
    Ok((token, uhs))
}

async fn xsts_authorize(
    http: &reqwest::Client,
    xbl_token: &str,
) -> Result<(String, String), String> {
    let body = serde_json::json!({
        "Properties": { "SandboxId": "RETAIL", "UserTokens": [xbl_token] },
        "RelyingParty": "rp://api.minecraftservices.com/",
        "TokenType": "JWT"
    });
    let resp = http
        .post(XSTS_URL)
        .header("Accept", "application/json")
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("Сеть (XSTS): {e}"))?;
    let status = resp.status();
    let text = resp.text().await.unwrap_or_default();

    if status == reqwest::StatusCode::UNAUTHORIZED || status == reqwest::StatusCode::FORBIDDEN {
        let v: serde_json::Value = serde_json::from_str(&text).unwrap_or_default();
        let xerr = v["XErr"].as_i64().unwrap_or(0);
        let msg = match xerr {
            2148916233 => "У этого аккаунта Microsoft нет профиля Xbox. Создайте его на xbox.com и повторите вход.",
            2148916235 => "Xbox Live недоступен в стране вашего аккаунта.",
            2148916236 | 2148916237 => "Требуется подтверждение возраста/родительское согласие (Xbox).",
            2148916238 => "Аккаунт принадлежит ребёнку и должен быть добавлен в семейную группу.",
            _ => "XSTS отклонил запрос.",
        };
        return Err(format!("{msg} (XErr {xerr})"));
    }
    if !status.is_success() {
        return Err(format!("XSTS отказал ({status}): {text}"));
    }
    let v: serde_json::Value =
        serde_json::from_str(&text).map_err(|e| format!("Разбор XSTS: {e}"))?;
    let token = v["Token"].as_str().ok_or("XSTS не вернул Token")?.to_string();
    let uhs = v["DisplayClaims"]["xui"][0]["uhs"]
        .as_str()
        .ok_or("XSTS не вернул uhs")?
        .to_string();
    Ok((token, uhs))
}

async fn minecraft_login(
    http: &reqwest::Client,
    uhs: &str,
    xsts_token: &str,
) -> Result<(String, u64), String> {
    let body = serde_json::json!({
        "identityToken": format!("XBL3.0 x={uhs};{xsts_token}")
    });
    let resp = http
        .post(MC_LOGIN_URL)
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("Сеть (Minecraft login): {e}"))?;
    let status = resp.status();
    let text = resp.text().await.unwrap_or_default();
    if !status.is_success() {
        return Err(format!("Minecraft Services отказал ({status}): {text}"));
    }
    let v: serde_json::Value =
        serde_json::from_str(&text).map_err(|e| format!("Разбор Minecraft login: {e}"))?;
    Ok((
        v["access_token"]
            .as_str()
            .ok_or("Minecraft не вернул access_token")?
            .to_string(),
        v["expires_in"].as_u64().unwrap_or(86400),
    ))
}

/// Проверка лицензии (лицензионный Minecraft Java Edition).
async fn check_entitlements(http: &reqwest::Client, mc_token: &str) -> Result<bool, String> {
    let resp = http
        .get(MC_ENTITLEMENTS_URL)
        .bearer_auth(mc_token)
        .send()
        .await
        .map_err(|e| format!("Сеть (entitlements): {e}"))?;
    let text = resp.text().await.unwrap_or_default();
    let v: serde_json::Value = serde_json::from_str(&text).unwrap_or_default();
    let items = v["items"].as_array().cloned().unwrap_or_default();
    let owns = items.iter().any(|i| {
        matches!(
            i["name"].as_str(),
            Some("product_minecraft") | Some("game_minecraft")
                | Some("product_minecraft_bedrock") | Some("game_minecraft_bedrock")
        )
    });
    Ok(owns)
}

async fn minecraft_profile(
    http: &reqwest::Client,
    mc_token: &str,
) -> Result<(String, String, Option<String>, Option<String>), String> {
    let resp = http
        .get(MC_PROFILE_URL)
        .bearer_auth(mc_token)
        .send()
        .await
        .map_err(|e| format!("Сеть (profile): {e}"))?;
    let status = resp.status();
    let text = resp.text().await.unwrap_or_default();
    if status == reqwest::StatusCode::NOT_FOUND {
        return Err("У аккаунта нет профиля Minecraft (не создан игровой ник).".into());
    }
    if !status.is_success() {
        return Err(format!("Профиль Minecraft недоступен ({status}): {text}"));
    }
    let v: serde_json::Value =
        serde_json::from_str(&text).map_err(|e| format!("Разбор профиля: {e}"))?;
    let raw_id = v["id"].as_str().ok_or("нет id профиля")?.to_string();
    let uuid = if raw_id.len() == 32 {
        format!(
            "{}-{}-{}-{}-{}",
            &raw_id[0..8],
            &raw_id[8..12],
            &raw_id[12..16],
            &raw_id[16..20],
            &raw_id[20..32]
        )
    } else {
        raw_id
    };
    let username = v["name"].as_str().unwrap_or("Player").to_string();
    let skin_url = v["skins"]
        .as_array()
        .and_then(|s| s.iter().find(|x| x["state"].as_str() == Some("ACTIVE")).or(s.first()))
        .and_then(|s| s["url"].as_str())
        .map(String::from);
    let cape_url = v["capes"]
        .as_array()
        .and_then(|s| s.iter().find(|x| x["state"].as_str() == Some("ACTIVE")))
        .and_then(|s| s["url"].as_str())
        .map(String::from);
    Ok((uuid, username, skin_url, cape_url))
}

// ─────────────────────────────────────────────────────────────────────────────
// 3. Refresh / профиль / выход
// ─────────────────────────────────────────────────────────────────────────────

#[tauri::command]
pub async fn msa_refresh(app: tauri::AppHandle) -> Result<Account, String> {
    let stored = load_account().ok_or("Нет сохранённого аккаунта")?;
    if stored.refresh_token.is_empty() {
        return Err("Нет refresh_token — требуется повторный вход.".into());
    }
    let (client_id, use_aad) = used_client_id();
    let redirect = if use_aad { NATIVE_REDIRECT } else { DESKTOP_REDIRECT };
    let http = client()?;

    let mut form: Vec<(&str, &str)> = vec![
        ("client_id", client_id.as_str()),
        ("refresh_token", stored.refresh_token.as_str()),
        ("grant_type", "refresh_token"),
        ("redirect_uri", redirect),
    ];
    if use_aad {
        form.push(("scope", SCOPE));
    }
    let url = if use_aad { AAD_TOKEN } else { LIVE_TOKEN };
    let text = http
        .post(url)
        .form(&form)
        .send()
        .await
        .map_err(|e| format!("Сеть (refresh): {e}"))?
        .text()
        .await
        .map_err(|e| format!("Ответ (refresh): {e}"))?;
    let v: serde_json::Value =
        serde_json::from_str(&text).map_err(|e| format!("Разбор refresh: {e}"))?;
    if let Some(err) = v["error"].as_str() {
        let desc = v["error_description"].as_str().unwrap_or(err);
        return Err(format!("Не удалось обновить сессию: {desc}. Войдите заново."));
    }
    let tokens = MsTokens {
        access_token: v["access_token"].as_str().ok_or("нет access_token")?.to_string(),
        refresh_token: v["refresh_token"]
            .as_str()
            .unwrap_or(&stored.refresh_token)
            .to_string(),
        expires_in: v["expires_in"].as_u64().unwrap_or(3600),
    };
    finish_login(&app, &http, tokens).await
}

/// Возвращает валидный аккаунт, при необходимости обновляя токен.
#[tauri::command]
pub async fn msa_get_account(app: tauri::AppHandle) -> Result<Option<Account>, String> {
    let Some(acc) = load_account() else {
        return Ok(None);
    };
    if acc.access_token.is_empty() || acc.provider.as_deref() == Some("elyby") {
        // Ely.by использует Yggdrasil-токен, а не Microsoft refresh-flow.
        return Ok(Some(acc));
    }
    // 5 минут запаса
    if acc.expires_at > now() + 300 {
        return Ok(Some(acc));
    }
    match msa_refresh(app).await {
        Ok(fresh) => Ok(Some(fresh)),
        Err(e) => {
            log::warn!("refresh failed: {e}");
            Ok(Some(acc))
        }
    }
}

/// Гарантирует свежий Minecraft-токен перед запуском игры (используется launch).
pub async fn ensure_fresh_token(app: &tauri::AppHandle) -> Option<Account> {
    let acc = load_account()?;
    if acc.access_token.is_empty() {
        return Some(acc);
    }
    if acc.expires_at > now() + 120 {
        return Some(acc);
    }
    msa_refresh(app.clone()).await.ok().or(Some(acc))
}

#[tauri::command]
pub fn msa_logout() -> Result<(), String> {
    let path = auth_json_path();
    if path.exists() {
        std::fs::remove_file(&path).map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// Мост от фронтенда (реальный, используемый флоу входа — Microsoft/Ely.by/
/// офлайн) к auth.json. Раньше этот файл фактически никогда не заполнялся
/// настоящим логином (им никто не пользовался), а на старте лаунчера что-то
/// пыталось из него восстановить аккаунт — отсюда и путаница с
/// "не сохраняется"/"воскресает после выхода". Теперь фронтенд сам explicitно
/// сохраняет и чистит этот файл в нужные моменты.
#[tauri::command]
pub fn save_frontend_account(
    uuid: String,
    username: String,
    skin_url: Option<String>,
    access_token: String,
    refresh_token: String,
    expires_at: u64,
    provider: Option<String>,
) -> Result<(), String> {
    let provider = match provider.as_deref() {
        Some("elyby") => "elyby",
        Some("offline") => "offline",
        Some("nickname") => "nickname",
        _ => "microsoft",
    }.to_string();
    let acc = Account {
        uuid,
        username,
        skin_url,
        cape_url: None,
        access_token,
        refresh_token,
        xuid: None,
        expires_at,
        // Nickname lookup intentionally has no Minecraft token or licence. It
        // may launch Java in legacy/offline mode but must never unlock Bedrock.
        licensed: provider != "offline" && provider != "nickname",
        demo: provider == "offline" || provider == "nickname",
        provider: Some(provider),
    };
    save_account(&acc)
}

/// Офлайн-профиль (без лицензии) — только для локальной игры.
#[tauri::command]
pub fn set_offline_account(username: String) -> Result<Account, String> {
    if username.trim().len() < 3 {
        return Err("Ник должен быть не короче 3 символов".into());
    }
    let uuid = offline_uuid(username.trim());
    let acc = Account {
        uuid,
        username: username.trim().to_string(),
        skin_url: None,
        cape_url: None,
        access_token: String::new(),
        refresh_token: String::new(),
        xuid: None,
        expires_at: now() + 315_360_000,
        licensed: false,
        demo: true,
        provider: Some("offline".to_string()),
    };
    save_account(&acc)?;
    Ok(acc)
}

pub fn offline_uuid(username: &str) -> String {
    use sha1::Sha1 as Sha1Hasher;
    let full = <Sha1Hasher as sha1::Digest>::digest(format!("OfflinePlayer:{username}").as_bytes());
    let mut b = [0u8; 16];
    b.copy_from_slice(&full[..16]);
    b[6] = (b[6] & 0x0f) | 0x30;
    b[8] = (b[8] & 0x3f) | 0x80;
    format!(
        "{:02x}{:02x}{:02x}{:02x}-{:02x}{:02x}-{:02x}{:02x}-{:02x}{:02x}-{:02x}{:02x}{:02x}{:02x}{:02x}{:02x}",
        b[0], b[1], b[2], b[3], b[4], b[5], b[6], b[7], b[8], b[9], b[10], b[11], b[12], b[13], b[14], b[15]
    )
}

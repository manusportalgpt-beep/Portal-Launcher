//! Встроенный ИИ-помощник на Grok (xAI). Основное применение — разбор краша:
//! после падения игры лаунчер предлагает отправить лог, Grok отвечает,
//! где именно ошибка и как её исправить.

use serde::{Deserialize, Serialize};

const XAI_URL: &str = "https://api.x.ai/v1/chat/completions";
const DEFAULT_MODEL: &str = "grok-4-fast-reasoning";

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct CrashAnalysis {
    pub summary: String,
    pub cause: String,
    pub fix: String,
    pub culprits: Vec<String>,
    pub raw: String,
    pub model: String,
}

fn settings_value(key: &str) -> Option<String> {
    let path = crate::commands::version_manager::mc_base_dir().join("settings.json");
    let raw = std::fs::read_to_string(path).ok()?;
    let v: serde_json::Value = serde_json::from_str(&raw).ok()?;
    v.get(key)
        .and_then(|x| x.as_str())
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
}

/// Ключ Grok: настройки лаунчера → переменная окружения XAI_API_KEY → сборочный ключ.
fn api_key() -> Result<String, String> {
    if let Some(k) = settings_value("xai_api_key") {
        return Ok(k);
    }
    if let Ok(k) = std::env::var("XAI_API_KEY") {
        if !k.trim().is_empty() {
            return Ok(k.trim().to_string());
        }
    }
    if let Some(k) = option_env!("XAI_API_KEY") {
        if !k.trim().is_empty() {
            return Ok(k.trim().to_string());
        }
    }
    Err("Не задан API-ключ Grok. Укажите его в Настройки → ИИ-помощник.".into())
}

fn model() -> String {
    settings_value("ai_model").unwrap_or_else(|| DEFAULT_MODEL.to_string())
}

fn http() -> reqwest::Client {
    reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(120))
        .build()
        .unwrap_or_default()
}

async fn grok(system: &str, user: &str) -> Result<String, String> {
    let key = api_key()?;
    let model = model();
    let body = serde_json::json!({
        "model": model,
        "temperature": 0.2,
        "messages": [
            { "role": "system", "content": system },
            { "role": "user", "content": user }
        ]
    });
    let resp = http()
        .post(XAI_URL)
        .bearer_auth(key)
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("Сеть (Grok): {e}"))?;
    let status = resp.status();
    let text = resp.text().await.unwrap_or_default();
    if !status.is_success() {
        return Err(format!("Grok вернул ошибку {status}: {text}"));
    }
    let v: serde_json::Value =
        serde_json::from_str(&text).map_err(|e| format!("Разбор ответа Grok: {e}"))?;
    v["choices"][0]["message"]["content"]
        .as_str()
        .map(|s| s.to_string())
        .ok_or_else(|| format!("Grok не вернул текст: {text}"))
}

/// Разбор краш-лога. `log` — хвост консоли, `crash_report` — файл crash-reports.
#[tauri::command]
pub async fn analyze_crash_with_ai(
    log: String,
    crash_report: Option<String>,
    mc_version: Option<String>,
    loader: Option<String>,
    mods: Option<Vec<String>>,
) -> Result<CrashAnalysis, String> {
    let system = "Ты — эксперт по Minecraft Java Edition, модам (Fabric/Forge/NeoForge/Quilt) и JVM. \
Тебе дают лог краша. Найди настоящую причину и объясни коротко и по делу, по-русски. \
Ответ строго в JSON без markdown: \
{\"summary\":\"1 строка\",\"cause\":\"что именно упало и почему\",\"fix\":\"пошаговое решение\",\"culprits\":[\"мод/файл\"]}";

    let mut prompt = String::new();
    if let Some(v) = mc_version {
        prompt.push_str(&format!("Версия Minecraft: {v}\n"));
    }
    if let Some(l) = loader {
        prompt.push_str(&format!("Загрузчик: {l}\n"));
    }
    if let Some(m) = mods {
        if !m.is_empty() {
            prompt.push_str(&format!("Моды ({}): {}\n", m.len(), m.join(", ")));
        }
    }
    if let Some(report) = crash_report.filter(|r| !r.trim().is_empty()) {
        prompt.push_str("\n=== crash-report ===\n");
        prompt.push_str(&tail(&report, 16_000));
    }
    prompt.push_str("\n=== консоль ===\n");
    prompt.push_str(&tail(&log, 20_000));

    let raw = grok(system, &prompt).await?;
    let cleaned = raw
        .trim()
        .trim_start_matches("```json")
        .trim_start_matches("```")
        .trim_end_matches("```")
        .trim()
        .to_string();

    let parsed: serde_json::Value = serde_json::from_str(&cleaned).unwrap_or(serde_json::json!({}));
    Ok(CrashAnalysis {
        summary: parsed["summary"]
            .as_str()
            .unwrap_or("Grok разобрал лог — подробности ниже")
            .to_string(),
        cause: parsed["cause"].as_str().unwrap_or(&cleaned).to_string(),
        fix: parsed["fix"].as_str().unwrap_or("").to_string(),
        culprits: parsed["culprits"]
            .as_array()
            .map(|a| {
                a.iter()
                    .filter_map(|x| x.as_str().map(String::from))
                    .collect()
            })
            .unwrap_or_default(),
        raw: cleaned,
        model: model(),
    })
}

fn tail(s: &str, max: usize) -> String {
    if s.len() <= max {
        return s.to_string();
    }
    let start = s.len() - max;
    // не режем посередине utf8-символа
    let mut idx = start;
    while idx < s.len() && !s.is_char_boundary(idx) {
        idx += 1;
    }
    s[idx..].to_string()
}

/// Свободный чат с Grok внутри лаунчера.
#[tauri::command]
pub async fn ai_chat(prompt: String, context: Option<String>) -> Result<String, String> {
    let system = "Ты — встроенный ИИ-помощник Portal Launcher. Помогаешь с Minecraft, \
модами, производительностью и настройками. Отвечай кратко, по-русски.";
    let user = match context {
        Some(c) if !c.trim().is_empty() => format!("Контекст:\n{}\n\nВопрос: {prompt}", tail(&c, 8000)),
        _ => prompt,
    };
    grok(system, &user).await
}

/// Есть ли рабочий ключ (для UI).
#[tauri::command]
pub fn ai_is_configured() -> bool {
    api_key().is_ok()
}

#[tauri::command]
pub fn ai_set_api_key(key: String) -> Result<(), String> {
    let path = crate::commands::version_manager::mc_base_dir().join("settings.json");
    let mut v: serde_json::Value = std::fs::read_to_string(&path)
        .ok()
        .and_then(|r| serde_json::from_str(&r).ok())
        .unwrap_or(serde_json::json!({}));
    v["xai_api_key"] = serde_json::Value::String(key.trim().to_string());
    std::fs::write(
        &path,
        serde_json::to_string_pretty(&v).map_err(|e| e.to_string())?,
    )
    .map_err(|e| e.to_string())
}

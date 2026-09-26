use serde::Serialize;
use std::path::PathBuf;
use tauri::Emitter;

const REPO_OWNER: &str = "manusportalgpt-beep";
const REPO_NAME: &str = "Portal-Launcher";
const CURRENT_VERSION: &str = env!("CARGO_PKG_VERSION");

/// Собирает UpdateInfo из номера версии. Пустые поля оставляем пустыми —
/// при резервной проверке через страницу GitHub их просто нет.
fn build_update_info_from_tag(
    tag: &str,
    body: &str,
    published_at: &str,
    html_url: &str,
) -> Option<UpdateInfo> {
    if tag.is_empty() {
        return None;
    }
    if !is_newer(tag, CURRENT_VERSION) {
        return None;
    }
    let download_url = format!(
        "https://github.com/{}/{}/releases/download/v{}/Portal-Launcher-{}.exe",
        REPO_OWNER, REPO_NAME, tag, tag
    );
    Some(UpdateInfo {
        version: tag.to_string(),
        body: body.to_string(),
        published_at: published_at.to_string(),
        html_url: if html_url.is_empty() {
            format!("https://github.com/{}/{}/releases/tag/v{}", REPO_OWNER, REPO_NAME, tag)
        } else {
            html_url.to_string()
        },
        download_url,
        file_name: format!("Portal-Launcher-{tag}.exe"),
    })
}

fn updates_dir() -> PathBuf {
    let base = dirs_next::data_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join("PortalLauncher");
    let dir = base.join("updates");
    std::fs::create_dir_all(&dir).ok();
    dir
}

/// Достаёт номер версии из тега релиза.
///
/// Раньше требовался строгий `vX.Y.Z`, и теги вроде «Тест», «LAN», «NeW»
/// или «v1.0.4-beta» молча давали пустой результат — обновление не находилось
/// никогда. Теперь берём первое число с точками, поэтому `v1.2.3`,
/// `1.2.3`, `Portal 1.2.3` и `release-1.2.3` работают одинаково.
fn parse_version(v: &str) -> Vec<u32> {
    let cleaned = v.trim().trim_start_matches('v').trim_start_matches('V');
    // Ищем первый фрагмент вида 1.2.3 — можно с суффиксами после него.
    let mut best: Vec<u32> = Vec::new();
    for part in cleaned.split(|c: char| !(c.is_ascii_digit() || c == '.')) {
        if part.is_empty() || !part.contains('.') {
            continue;
        }
        let parsed: Vec<u32> = part
            .trim_matches('.')
            .split('.')
            .map(|s| s.parse().unwrap_or(0))
            .collect();
        if parsed.len() > best.len() {
            best = parsed;
        }
    }
    if best.is_empty() {
        // Версии вида «v2024» без точек тоже считаем — одной компонентой хватит.
        return cleaned
            .split(|c: char| !c.is_ascii_digit())
            .next()
            .and_then(|s| s.parse().ok())
            .map(|n| vec![n])
            .unwrap_or_default();
    }
    best
}

fn is_newer(remote: &str, local: &str) -> bool {
    let rv = parse_version(remote);
    let lv = parse_version(local);
    for i in 0..rv.len().max(lv.len()) {
        let r = rv.get(i).copied().unwrap_or(0);
        let l = lv.get(i).copied().unwrap_or(0);
        if r > l { return true; }
        if r < l { return false; }
    }
    false
}

#[derive(Serialize, Clone)]
pub struct UpdateInfo {
    pub version: String,
    pub body: String,
    pub published_at: String,
    pub html_url: String,
    pub download_url: String,
    pub file_name: String,
}

/// Заголовки для GitHub API.
///
/// Без `User-Agent` GitHub отвечает 403 на любой запрос — это была причина
/// надписи «GitHub API returned 403 Forbidden» в разделе «Обновление».
fn github_headers() -> (String, String, String) {
    let version = CURRENT_VERSION;
    (
        format!("PortalLauncher/{version} (+https://github.com/{}/{}/releases)", REPO_OWNER, REPO_NAME),
        "application/vnd.github+json".to_string(),
        "2022-11-28".to_string(),
    )
}

/// Понятное объяснение вместо голого «GitHub API returned 403».
/// Ответ принимается по значению: `Response::text()` забирает сам объект.
async fn github_error_message(res: reqwest::Response) -> String {
    let status = res.status();
    // String, а не &str: ниже res забирается целиком через text(),
    // и ссылка на заголовки перестала бы быть валидной.
    let remaining = res
        .headers()
        .get("x-ratelimit-remaining")
        .and_then(|v| v.to_str().ok())
        .unwrap_or("")
        .to_string();
    let body = res.text().await.unwrap_or_default();
    let detail: serde_json::Value = serde_json::from_str(&body).unwrap_or(serde_json::Value::Null);
    let api_message = detail["message"].as_str().unwrap_or("").to_string();

    if status.as_u16() == 403 || status.as_u16() == 429 {
        // Лимит API: либо счётчик исчерпан, либо в тексте ошибки GitHub прямо
        // об этом написано. Сравниваем строкой — литерал регулярного выражения
        // в этом месте ломал разбор.
        let lowered = api_message.to_lowercase();
        if remaining == "0" || lowered.contains("rate limit") || lowered.contains("abuse") {
            return "GitHub временно ограничил число запросов (лимит API исчерпан). \
                    Проверка обновлений вернётся через несколько минут — можно подождать и нажать «Проверить обновления» ещё раз."
                .to_string();
        }
        if !api_message.is_empty() {
            return format!("GitHub API отклонил запрос: {api_message} (HTTP {}).", status.as_u16());
        }
    }
    if status.as_u16() == 404 {
        return "Релизы не найдены. Проверьте, что у репозитория есть опубликованный релиз.".to_string();
    }
    if status.as_u16() == 401 {
        return "GitHub требует авторизацию для чтения релизов. Опубликуйте релиз публично или проверьте доступ.".to_string();
    }
    let snippet: String = body.chars().take(200).collect();
    if snippet.trim().is_empty() {
        format!("GitHub API вернул HTTP {}.", status.as_u16())
    } else {
        format!("GitHub API вернул HTTP {}: {snippet}", status.as_u16())
    }
}

/// Резервная проверка через обычную страницу GitHub, а не через API.
/// `/releases/latest` отдаёт 302 на тег, поэтому версию можно достать из
/// адреса. Этот путь не ограничен лимитом API и работает, когда API закрыт.
async fn fetch_latest_tag_via_page(client: &reqwest::Client) -> Option<String> {
    let url = format!("https://github.com/{}/{}/releases/latest", REPO_OWNER, REPO_NAME);
    let res = client
        .get(&url)
        .header("User-Agent", github_headers().0)
        .send()
        .await
        .ok()?;
    if !res.status().is_success() {
        return None;
    }
    let final_url = res.url().to_string();
    // .../releases/tag/v1.2.3 → 1.2.3
    let tag = final_url
        .rsplit("/tag/")
        .next()?
        .split(['?', '#'])
        .next()?
        .trim_start_matches('v')
        .to_string();
    if tag.is_empty() { None } else { Some(tag) }
}

#[tauri::command]
pub async fn check_for_update() -> Result<Option<UpdateInfo>, String> {
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(15))
        .redirect(reqwest::redirect::Policy::limited(5))
        .build()
        .map_err(|e| e.to_string())?;

    let (user_agent, accept, api_version) = github_headers();
    let res = client
        .get(format!(
            "https://api.github.com/repos/{}/{}/releases/latest",
            REPO_OWNER, REPO_NAME
        ))
        .header("User-Agent", user_agent.clone())
        .header("Accept", accept)
        .header("X-GitHub-Api-Version", api_version)
        .send()
        .await
        .map_err(|e| format!("Нет связи с GitHub: {e}"))?;

    if !res.status().is_success() {
        let message = github_error_message(res).await;
        // API может быть закрыт или лимит исчерпан — проверяем через страницу.
        if let Some(tag) = fetch_latest_tag_via_page(&client).await {
            log::info!("[update] GitHub API недоступен ({message}), версия получена через страницу: {tag}");
            return Ok(build_update_info_from_tag(&tag, "", "", ""));
        }
        return Err(message);
    }

    let data: serde_json::Value = res.json().await.map_err(|e| e.to_string())?;

    let tag = data["tag_name"]
        .as_str()
        .unwrap_or("")
        .trim_start_matches('v')
        .to_string();
    if tag.is_empty() {
        return Err("GitHub не вернул номер версии релиза".into());
    }

    if !is_newer(&tag, CURRENT_VERSION) {
        return Ok(None);
    }

    let body = data["body"].as_str().unwrap_or("").to_string();
    let published_at = data["published_at"].as_str().unwrap_or("").to_string();
    let html_url = data["html_url"].as_str().unwrap_or("").to_string();

    // Find the .exe asset
    let assets = data["assets"].as_array().cloned().unwrap_or_default();
    let exe_asset = assets.iter().find(|a| {
        a["name"]
            .as_str()
            .map(|n| n.ends_with(".exe"))
            .unwrap_or(false)
    });

    let (download_url, file_name) = match exe_asset {
        Some(a) => (
            a["browser_download_url"]
                .as_str()
                .unwrap_or("")
                .to_string(),
            a["name"].as_str().unwrap_or("update.exe").to_string(),
        ),
        None => {
            // Fallback: construct a download URL for a standard NSIS name
            (
                format!(
                    "https://github.com/{}/{}/releases/download/v{}/Portal-Launcher-{}.exe",
                    REPO_OWNER, REPO_NAME, tag, tag
                ),
                format!("Portal-Launcher-{}.exe", tag),
            )
        }
    };

    if download_url.is_empty() {
        // Релиз есть, но без .exe — показываем карточку без кнопки установки
        // (ссылка на страницу релиза остаётся рабочей).
        return Ok(Some(UpdateInfo {
            version: tag,
            body,
            published_at,
            html_url,
            download_url: String::new(),
            file_name: String::new(),
        }));
    }

    Ok(Some(UpdateInfo {
        version: tag,
        body,
        published_at,
        html_url,
        download_url,
        file_name,
    }))
}

#[derive(Clone, Serialize)]
pub struct DownloadProgress {
    pub percent: u8,
    pub downloaded: u64,
    pub total: u64,
}

#[tauri::command]
pub async fn download_update(
    app: tauri::AppHandle,
    download_url: String,
    file_name: String,
) -> Result<String, String> {
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(300))
        .build()
        .map_err(|e| e.to_string())?;

    let res = client
        .get(&download_url)
        .header("User-Agent", format!("Portal-Launcher/{}", CURRENT_VERSION))
        .send()
        .await
        .map_err(|e| format!("Download start failed: {e}"))?;

    if !res.status().is_success() {
        return Err(format!("Download failed: HTTP {}", res.status()));
    }

    let total = res.content_length().unwrap_or(0);
    let target = updates_dir().join(&file_name);

    let mut stream = res.bytes_stream();
    let mut downloaded: u64 = 0;
    let mut file_bytes = Vec::new();

    use futures::StreamExt;
    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|e| format!("Download stream error: {e}"))?;
        downloaded += chunk.len() as u64;
        file_bytes.extend_from_slice(&chunk);

        let percent = if total > 0 {
            ((downloaded as f64 / total as f64) * 100.0) as u8
        } else {
            0
        };

        app.emit(
            "update-download-progress",
            DownloadProgress {
                percent,
                downloaded,
                total,
            },
        )
        .ok();
    }

    std::fs::write(&target, &file_bytes)
        .map_err(|e| format!("Failed to write update file: {e}"))?;

    Ok(target.to_string_lossy().to_string())
}

#[tauri::command]
pub async fn install_update(file_path: String) -> Result<(), String> {
    let p = std::path::Path::new(&file_path);
    if !p.exists() {
        return Err(format!("Update file not found: {}", p.display()));
    }

    #[cfg(target_os = "windows")]
    {
        std::process::Command::new("cmd")
            .args(["/C", "start", "", &file_path])
            .spawn()
            .map_err(|e| format!("Failed to launch installer: {e}"))?;
        // Exit the current process after a short delay
        std::thread::spawn(|| {
            std::thread::sleep(std::time::Duration::from_secs(2));
            std::process::exit(0);
        });
    }

    #[cfg(not(target_os = "windows"))]
    {
        crate::utils::create_hidden_command("xdg-open")
            .arg(&file_path)
            .spawn()
            .map_err(|e| format!("Failed to launch installer: {e}"))?;
    }

    Ok(())
}

#[cfg(test)]
mod version_tests {
    use super::{is_newer, parse_version};

    #[test]
    fn reads_plain_semver_tags() {
        assert_eq!(parse_version("v1.2.3"), vec![1, 2, 3]);
        assert_eq!(parse_version("1.2.3"), vec![1, 2, 3]);
    }

    #[test]
    fn reads_version_inside_a_noisy_tag() {
        // Релизы в репозитории подписывались как «Тест», «LAN», «NeW» —
        // такие теги не должны ломать проверку обновлений.
        assert_eq!(parse_version("Portal 1.2.3"), vec![1, 2, 3]);
        assert_eq!(parse_version("release-1.2.3-beta"), vec![1, 2, 3]);
    }

    #[test]
    fn junk_tag_has_no_version() {
        assert!(parse_version("Тест").is_empty());
        assert!(parse_version("LAN").is_empty());
    }

    #[test]
    fn compares_versions_component_wise() {
        assert!(is_newer("1.0.4", "1.0.3"));
        assert!(is_newer("1.1.0", "1.0.9"));
        assert!(!is_newer("1.0.3", "1.0.3"));
        assert!(!is_newer("1.0.2", "1.0.3"));
    }
}
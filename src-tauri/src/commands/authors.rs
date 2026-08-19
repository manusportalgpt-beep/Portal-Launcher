//! Профили авторов модификаций: Modrinth (пользователь) и CurseForge (автор).
//! Открываются прямо в лаунчере — без браузера.

use serde::{Deserialize, Serialize};

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct AuthorProfile {
    pub source: String,
    pub id: String,
    pub username: String,
    pub display_name: Option<String>,
    pub avatar_url: Option<String>,
    pub bio: Option<String>,
    pub created: Option<String>,
    pub url: String,
    pub projects: Vec<AuthorProject>,
    pub total_downloads: u64,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct AuthorProject {
    pub id: String,
    pub slug: String,
    pub name: String,
    pub summary: String,
    pub icon_url: Option<String>,
    pub downloads: u64,
    pub follows: u64,
    pub source: String,
    pub categories: Vec<String>,
}

fn http() -> reqwest::Client {
    reqwest::Client::builder()
        .user_agent("PortalLauncher/1.2 (github.com/portal-launcher)")
        .timeout(std::time::Duration::from_secs(30))
        .build()
        .unwrap_or_default()
}

/// Профиль автора Modrinth + все его проекты.
#[tauri::command]
pub async fn get_modrinth_author(user: String) -> Result<AuthorProfile, String> {
    let client = http();
    let u: serde_json::Value = client
        .get(format!("https://api.modrinth.com/v2/user/{user}"))
        .send()
        .await
        .map_err(|e| format!("Modrinth: {e}"))?
        .json()
        .await
        .map_err(|e| format!("Modrinth (разбор): {e}"))?;

    let id = u["id"].as_str().unwrap_or(&user).to_string();
    let projects_raw: serde_json::Value = client
        .get(format!("https://api.modrinth.com/v2/user/{id}/projects"))
        .send()
        .await
        .map_err(|e| format!("Modrinth projects: {e}"))?
        .json()
        .await
        .unwrap_or(serde_json::json!([]));

    let mut projects = Vec::new();
    let mut total = 0u64;
    for p in projects_raw.as_array().cloned().unwrap_or_default() {
        let downloads = p["downloads"].as_u64().unwrap_or(0);
        total += downloads;
        projects.push(AuthorProject {
            id: p["id"].as_str().unwrap_or("").to_string(),
            slug: p["slug"].as_str().unwrap_or("").to_string(),
            name: p["title"].as_str().unwrap_or("").to_string(),
            summary: p["description"].as_str().unwrap_or("").to_string(),
            icon_url: p["icon_url"].as_str().map(String::from),
            downloads,
            follows: p["followers"].as_u64().unwrap_or(0),
            source: "modrinth".into(),
            categories: p["categories"]
                .as_array()
                .map(|a| a.iter().filter_map(|c| c.as_str().map(String::from)).collect())
                .unwrap_or_default(),
        });
    }
    projects.sort_by(|a, b| b.downloads.cmp(&a.downloads));

    let username = u["username"].as_str().unwrap_or(&user).to_string();
    Ok(AuthorProfile {
        source: "modrinth".into(),
        id,
        url: format!("https://modrinth.com/user/{username}"),
        username,
        display_name: u["name"].as_str().map(String::from),
        avatar_url: u["avatar_url"].as_str().map(String::from),
        bio: u["bio"].as_str().map(String::from),
        created: u["created"].as_str().map(String::from),
        projects,
        total_downloads: total,
    })
}

/// Профиль автора CurseForge. CurseForge не отдаёт публичный /users,
/// поэтому собираем профиль через поиск проектов по автору.
#[tauri::command]
pub async fn get_curseforge_author(
    author: String,
    author_id: Option<u64>,
) -> Result<AuthorProfile, String> {
    let key = crate::commands::settings::read_curseforge_api_key();
    let client = http();
    let mut projects = Vec::new();
    let mut total = 0u64;

    if !key.is_empty() {
        let mut req = client
            .get("https://api.curseforge.com/v1/mods/search")
            .header("x-api-key", key)
            .query(&[("gameId", "432"), ("pageSize", "50"), ("sortField", "6"), ("sortOrder", "desc")]);
        if let Some(id) = author_id {
            req = req.query(&[("authorId", id.to_string())]);
        } else {
            req = req.query(&[("searchFilter", author.clone())]);
        }
        let resp: serde_json::Value = req
            .send()
            .await
            .map_err(|e| format!("CurseForge: {e}"))?
            .json()
            .await
            .unwrap_or(serde_json::json!({}));

        for p in resp["data"].as_array().cloned().unwrap_or_default() {
            let authors: Vec<String> = p["authors"]
                .as_array()
                .map(|a| {
                    a.iter()
                        .filter_map(|x| x["name"].as_str().map(String::from))
                        .collect()
                })
                .unwrap_or_default();
            if author_id.is_none()
                && !authors
                    .iter()
                    .any(|a| a.eq_ignore_ascii_case(author.trim()))
            {
                continue;
            }
            let downloads = p["downloadCount"].as_u64().unwrap_or(0);
            total += downloads;
            projects.push(AuthorProject {
                id: p["id"].as_u64().map(|i| i.to_string()).unwrap_or_default(),
                slug: p["slug"].as_str().unwrap_or("").to_string(),
                name: p["name"].as_str().unwrap_or("").to_string(),
                summary: p["summary"].as_str().unwrap_or("").to_string(),
                icon_url: p["logo"]["thumbnailUrl"].as_str().map(String::from),
                downloads,
                follows: 0,
                source: "curseforge".into(),
                categories: p["categories"]
                    .as_array()
                    .map(|a| {
                        a.iter()
                            .filter_map(|c| c["name"].as_str().map(String::from))
                            .collect()
                    })
                    .unwrap_or_default(),
            });
        }
        projects.sort_by(|a, b| b.downloads.cmp(&a.downloads));
    }

    Ok(AuthorProfile {
        source: "curseforge".into(),
        id: author_id.map(|i| i.to_string()).unwrap_or_else(|| author.clone()),
        username: author.clone(),
        display_name: Some(author.clone()),
        avatar_url: None,
        bio: if projects.is_empty() {
            Some("Не удалось получить проекты автора — проверьте ключ CurseForge API в настройках.".into())
        } else {
            None
        },
        created: None,
        url: format!("https://www.curseforge.com/members/{author}/projects"),
        projects,
        total_downloads: total,
    })
}

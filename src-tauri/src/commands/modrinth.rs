use serde::{Serialize, Deserialize};

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct ModrinthMod {
    pub project_id: String,
    pub title: String,
    pub description: String,
    pub author: String,
    pub downloads: u64,
    pub follows: u64,
    pub icon_url: Option<String>,
    pub categories: Vec<String>,
    pub versions: Vec<String>,
    pub game_versions: Vec<String>,
    pub loaders: Vec<String>,
    pub date_modified: String,
    pub color: Option<i64>,
    pub slug: String,
}

#[derive(Serialize, Deserialize, Debug)]
pub struct ModrinthSearchResult {
    pub hits: Vec<ModrinthMod>,
    pub total_hits: u64,
    pub offset: u64,
    pub limit: u64,
}

fn parse_hit(h: &serde_json::Value) -> ModrinthMod {
    let arr = |key: &str| -> Vec<String> {
        h[key].as_array().map(|a| a.iter().filter_map(|v| v.as_str().map(String::from)).collect()).unwrap_or_default()
    };
    ModrinthMod {
        project_id: h["project_id"].as_str().unwrap_or("").to_string(),
        title: h["title"].as_str().unwrap_or("").to_string(),
        description: h["description"].as_str().unwrap_or("").to_string(),
        author: h["author"].as_str().unwrap_or("").to_string(),
        downloads: h["downloads"].as_u64().unwrap_or(0),
        follows: h["follows"].as_u64().unwrap_or(0),
        icon_url: h["icon_url"].as_str().map(String::from),
        categories: arr("categories"),
        versions: arr("versions"),
        game_versions: arr("game_versions"),
        loaders: arr("loaders"),
        date_modified: h["date_modified"].as_str().unwrap_or("").to_string(),
        color: h["color"].as_i64(),
        slug: h["slug"].as_str().unwrap_or("").to_string(),
    }
}

fn urlencode(s: &str) -> String {
    // Use UTF-8 percent encoding; the previous code encoded a Cyrillic
    // character as one Unicode code point instead of its UTF-8 bytes.
    urlencoding::encode(s).into_owned()
}

fn modrinth_client() -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(20))
        .connect_timeout(std::time::Duration::from_secs(8))
        .user_agent("PortalLauncher/1.3 (https://portalrolls.dev)")
        .build().map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn search_modrinth(
    query: String,
    limit: Option<u64>,
    offset: Option<u64>,
    categories: Option<Vec<String>>,
    versions: Option<Vec<String>>,
    loaders: Option<Vec<String>>,
    sort: Option<String>,
    project_type: Option<String>,
) -> Result<ModrinthSearchResult, String> {
    let client = modrinth_client()?;
    let limit = limit.unwrap_or(20).min(100);
    let offset = offset.unwrap_or(0);
    let index = match sort.as_deref() {
        Some("Downloads") | Some("downloads") => "downloads",
        Some("Stars") | Some("Follows") | Some("follows") => "follows",
        Some("Updated") | Some("updated") => "updated",
        Some("Newest") | Some("newest") => "newest",
        _ => "relevance",
    };

    let mut facet_groups: Vec<Vec<String>> = vec![];
    let pt = project_type.as_deref().unwrap_or("mod");
    facet_groups.push(vec![format!("\"project_type:{}\"", pt)]);

    if let Some(cats) = &categories {
        let filtered: Vec<_> = cats.iter()
            .filter(|c| *c != "All")
            .map(|c| format!("\"categories:{}\"", c.to_lowercase()))
            .collect();
        if !filtered.is_empty() { facet_groups.push(filtered); }
    }
    if let Some(vers) = &versions {
        let filtered: Vec<_> = vers.iter()
            .filter(|v| *v != "All")
            .map(|v| format!("\"versions:{}\"", v))
            .collect();
        if !filtered.is_empty() { facet_groups.push(filtered); }
    }
    if let Some(ldrs) = &loaders {
        let filtered: Vec<_> = ldrs.iter()
            .filter(|l| *l != "vanilla" && *l != "All")
            .map(|l| format!("\"categories:{}\"", l.to_lowercase()))
            .collect();
        if !filtered.is_empty() { facet_groups.push(filtered); }
    }

    let facets = if !facet_groups.is_empty() {
        let inner: Vec<String> = facet_groups.iter()
            .map(|g| format!("[{}]", g.join(",")))
            .collect();
        format!("[{}]", inner.join(","))
    } else {
        String::new()
    };

    let mut url = format!(
        "https://api.modrinth.com/v2/search?query={}&limit={}&offset={}&index={}",
        urlencode(&query), limit, offset, index
    );
    if !facets.is_empty() {
        url.push_str(&format!("&facets={}", urlencode(&facets)));
    }

    let response = client.get(&url)
        .send().await
        .map_err(|e| format!("Modrinth search request failed: {e}"))?;
    let status = response.status();
    let body = response.text().await
        .map_err(|e| format!("Modrinth search response failed: {e}"))?;
    if !status.is_success() {
        return Err(format!("Modrinth API returned HTTP {}: {}", status.as_u16(), body.chars().take(240).collect::<String>()));
    }
    let resp: serde_json::Value = serde_json::from_str(&body)
        .map_err(|e| format!("Modrinth returned invalid JSON: {e}"))?;

    let hits = resp["hits"].as_array().map(|a| a.iter().map(parse_hit).collect()).unwrap_or_default();
    Ok(ModrinthSearchResult {
        hits,
        total_hits: resp["total_hits"].as_u64().unwrap_or(0),
        offset: resp["offset"].as_u64().unwrap_or(0),
        limit: resp["limit"].as_u64().unwrap_or(limit),
    })
}

/// Get full project details by slug or ID
#[tauri::command]
pub async fn get_modrinth_project(project_id: String) -> Result<serde_json::Value, String> {
    let client = modrinth_client()?;
    let mut resp = client
        .get(&format!("https://api.modrinth.com/v2/project/{}", project_id))
        .send().await.map_err(|e| e.to_string())?
        .json::<serde_json::Value>().await.map_err(|e| e.to_string())?;

    // ВАЖНО: у проекта нет прямого поля "author" — только "team" (id команды).
    // Раньше страница мода вообще не знала автора (значит и не могла
    // передать его при установке прямо со своей страницы) — обогащаем здесь,
    // один раз, для всех потребителей этой команды.
    if let Some(team_id) = resp["team"].as_str() {
        if let Ok(members) = client
            .get(&format!("https://api.modrinth.com/v2/team/{team_id}/members"))
            .send().await
            .map_err(|e| e.to_string())?
            .json::<serde_json::Value>().await
        {
            let author = members.as_array()
                .and_then(|a| a.iter().find(|m| m["role"].as_str() == Some("Owner")).or_else(|| a.first()))
                .and_then(|m| m["user"]["username"].as_str())
                .map(String::from);
            if let Some(a) = author {
                resp["author"] = serde_json::Value::String(a);
            }
        }
    }
    Ok(resp)
}

/// Get versions for a project, optionally filtered by game version and loader
#[tauri::command]
pub async fn get_modrinth_versions(
    project_id: String,
    game_version: Option<String>,
    loader: Option<String>,
) -> Result<serde_json::Value, String> {
    let client = modrinth_client()?;
    let mut url = format!("https://api.modrinth.com/v2/project/{}/version", project_id);
    let mut params: Vec<String> = vec![];
    if let Some(gv) = &game_version {
        params.push(format!("game_versions={}", urlencode(&format!("[\"{}\"]", gv))));
    }
    if let Some(l) = &loader {
        if l != "vanilla" && !l.is_empty() {
            params.push(format!("loaders={}", urlencode(&format!("[\"{}\"]", l))));
        }
    }
    if !params.is_empty() {
        url.push_str(&format!("?{}", params.join("&")));
    }

    let mut resp = client.get(&url)
        .send().await.map_err(|e| e.to_string())?
        .json::<serde_json::Value>().await.map_err(|e| e.to_string())?;

    // Гарантируем порядок «новейшая версия первой»: сортируем по date_published
    // по убыванию. Modrinth обычно уже отдаёт так, но полагаться на это нельзя —
    // именно из этого списка фронтенд берёт [0] как последнюю сборку.
    if let Some(arr) = resp.as_array_mut() {
        arr.sort_by(|a, b| {
            let da = a["date_published"].as_str().unwrap_or("");
            let db = b["date_published"].as_str().unwrap_or("");
            db.cmp(da)
        });
    }
    Ok(resp)
}

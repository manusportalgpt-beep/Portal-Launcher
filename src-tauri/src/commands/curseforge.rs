use super::settings::read_curseforge_api_key;
use serde::{Serialize, Deserialize};

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct CfAuthor { pub name: String, pub id: Option<u64> }
#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct CfLogo { pub thumbnail_url: String }
#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct CfCategory { pub name: String }
#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct CfScreenshot { pub url: String, pub title: Option<String>, pub description: Option<String> }
#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct CfFileIndex { pub game_version: String, pub mod_loader_type: u32 }
#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct CurseforgeMod {
    pub id: u64,
    pub name: String,
    pub summary: String,
    pub authors: Vec<CfAuthor>,
    pub download_count: u64,
    pub thumbs_up_count: u64,
    pub logo: Option<CfLogo>,
    pub categories: Vec<CfCategory>,
    pub screenshots: Vec<CfScreenshot>,
    pub latest_files_indexes: Vec<CfFileIndex>,
    pub date_modified: String,
    pub slug: String,
}

#[derive(Serialize, Deserialize, Debug)]
pub struct CfPagination { pub total_count: u64 }
#[derive(Serialize, Deserialize, Debug)]
pub struct CurseforgeSearchResult {
    pub data: Vec<CurseforgeMod>,
    pub pagination: CfPagination,
    /// How many results this query can actually page through.
    pub reachable_count: u64,
    /// True when the CurseForge index window blocked the requested offset.
    pub capped: bool,
}

/// CurseForge refuses `index + pageSize > 10000`. We page the tail of a result
/// set by flipping `sortOrder` and mirroring the index, which doubles the
/// reachable window to 20 000 per query without any client-side guessing.
const CF_WINDOW: u64 = 10_000;

fn parse_mod(m: &serde_json::Value) -> CurseforgeMod {
    CurseforgeMod {
        id: m["id"].as_u64().unwrap_or(0),
        name: m["name"].as_str().unwrap_or("").to_string(),
        summary: m["summary"].as_str().unwrap_or("").to_string(),
        authors: m["authors"].as_array().map(|a| a.iter().map(|au| CfAuthor {
            name: au["name"].as_str().unwrap_or("").to_string(),
            id: au["id"].as_u64(),
        }).collect()).unwrap_or_default(),
        download_count: m["downloadCount"].as_u64().unwrap_or(0),
        thumbs_up_count: m["thumbsUpCount"].as_u64().unwrap_or(0),
        logo: m["logo"]["thumbnailUrl"].as_str().map(|u| CfLogo { thumbnail_url: u.to_string() }),
        categories: m["categories"].as_array().map(|a| a.iter().map(|c| CfCategory {
            name: c["name"].as_str().unwrap_or("").to_string()
        }).collect()).unwrap_or_default(),
        screenshots: m["screenshots"].as_array().map(|items| items.iter().filter_map(|item| {
            let url = item["url"].as_str().or_else(|| item["thumbnailUrl"].as_str())?.to_string();
            Some(CfScreenshot { url, title: item["title"].as_str().map(String::from), description: item["description"].as_str().map(String::from) })
        }).collect()).unwrap_or_default(),
        latest_files_indexes: m["latestFilesIndexes"].as_array().map(|a| a.iter().map(|f| CfFileIndex {
            game_version: f["gameVersion"].as_str().unwrap_or("").to_string(),
            mod_loader_type: f["modLoaderType"].as_u64().unwrap_or(0) as u32,
        }).collect()).unwrap_or_default(),
        date_modified: m["dateModified"].as_str().unwrap_or("").to_string(),
        slug: m["slug"].as_str().unwrap_or("").to_string(),
    }
}

fn cf_client(api_key: &str) -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .user_agent("PortalLauncher/1.0.0")
        .default_headers({
            let mut h = reqwest::header::HeaderMap::new();
            h.insert("x-api-key", reqwest::header::HeaderValue::from_str(api_key).unwrap_or_else(|_| reqwest::header::HeaderValue::from_static("")));
            h.insert(reqwest::header::ACCEPT_ENCODING, reqwest::header::HeaderValue::from_static("identity"));
            h
        })
        .build().map_err(|e| e.to_string())
}

/// CurseForge can return an HTML/proxy failure instead of JSON. Read the body
/// only once so the launcher reports the actual status and short explanation.
async fn cf_json_response(req: reqwest::RequestBuilder, operation: &str) -> Result<serde_json::Value, String> {
    let response = req.send().await.map_err(|e| format!("CurseForge {operation} request failed: {e}"))?;
    let status = response.status();
    let body = response.text().await.map_err(|e| format!("CurseForge {operation} response body could not be read: {e}"))?;
    if !status.is_success() {
        let detail = serde_json::from_str::<serde_json::Value>(&body).ok()
            .and_then(|value| value["error"].as_str().map(str::to_owned))
            .unwrap_or_else(|| body.chars().filter(|character| !character.is_control()).take(220).collect());
        return Err(if detail.is_empty() {
            format!("CurseForge {operation} failed: HTTP {status}")
        } else {
            format!("CurseForge {operation} failed: HTTP {status} — {detail}")
        });
    }
    serde_json::from_str(&body).map_err(|e| {
        let preview: String = body.chars().filter(|character| !character.is_control()).take(160).collect();
        format!("CurseForge {operation} returned invalid JSON: {e}. {preview}")
    })
}

#[tauri::command]
pub async fn get_curseforge_mod(project_id: u64, api_key: String) -> Result<CurseforgeMod, String> {
    let api_key = if api_key.is_empty() { read_curseforge_api_key() } else { api_key };
    if api_key.is_empty() { return Err("CurseForge API key not configured".into()); }
    let client = cf_client(&api_key)?;
    let value = cf_json_response(
        client.get(format!("https://api.curseforge.com/v1/mods/{}", project_id)),
        "project lookup",
    ).await?;
    if let Some(error) = value["error"].as_str() { return Err(format!("CurseForge API error: {}", error)); }
    Ok(parse_mod(&value["data"]))
}

#[tauri::command]
pub async fn search_curseforge(
    query: String,
    limit: Option<u64>,
    offset: Option<u64>,
    category_id: Option<u64>,
    class_id: Option<u64>,
    game_version: Option<String>,
    mod_loader_type: Option<u32>,
    sort_field: Option<u32>,
    api_key: String,
    game_id: Option<u64>,
) -> Result<CurseforgeSearchResult, String> {
    let api_key = if api_key.is_empty() { read_curseforge_api_key() } else { api_key };
    if api_key.is_empty() {
        return Err("CurseForge API key not configured. Add it in Settings → Advanced.".into());
    }

    let client = cf_client(&api_key)?;
    let limit = limit.unwrap_or(20).clamp(1, 50);
    let offset = offset.unwrap_or(0);
    let effective_class = class_id.unwrap_or(6).to_string();
    let sort_field = sort_field.unwrap_or(2).to_string();
    let game_version = game_version.filter(|v| !v.is_empty() && v != "All");
    let mod_loader_type = mod_loader_type.filter(|l| *l > 0);
    let game_id_str = game_id.unwrap_or(432).to_string();

    let build = |index: u64, order: &'static str| {
        let mut req = client
            .get("https://api.curseforge.com/v1/mods/search")
            .query(&[
                ("gameId", game_id_str.as_str()),
                ("classId", &effective_class),
                ("pageSize", &limit.to_string()),
                ("index", &index.to_string()),
                ("searchFilter", &query),
                ("sortField", &sort_field),
                ("sortOrder", &order.to_string()),
            ]);
        if let Some(cat) = category_id { req = req.query(&[("categoryId", cat.to_string())]); }
        if let Some(ver) = &game_version { req = req.query(&[("gameVersion", ver.as_str())]); }
        if let Some(ldr) = mod_loader_type { req = req.query(&[("modLoaderType", ldr.to_string())]); }
        req
    };


    async fn run(req: reqwest::RequestBuilder) -> Result<(Vec<CurseforgeMod>, u64), String> {
        let resp = cf_json_response(req, "search").await?;
        if let Some(error) = resp["error"].as_str() {
            return Err(format!("CurseForge API error: {}", error));
        }
        let data: Vec<CurseforgeMod> = resp["data"].as_array()
            .map(|a| a.iter().map(parse_mod).collect()).unwrap_or_default();
        let total = resp["pagination"]["totalCount"].as_u64().unwrap_or(data.len() as u64);
        Ok((data, total))
    }

    // Fast path: the requested page fits inside the forward index window.
    if offset + limit <= CF_WINDOW {
        let (data, total) = run(build(offset, "desc")).await?;
        let reachable = total.min(CF_WINDOW * 2);
        return Ok(CurseforgeSearchResult {
            data,
            pagination: CfPagination { total_count: total },
            reachable_count: reachable,
            capped: false,
        });
    }

    // Tail path: ask for the same slice from the other end, then un-reverse it.
    let (_, total) = run(build(0, "desc")).await?;
    let reachable = total.min(CF_WINDOW * 2);
    if offset >= reachable {
        return Ok(CurseforgeSearchResult {
            data: vec![],
            pagination: CfPagination { total_count: total },
            reachable_count: reachable,
            capped: true,
        });
    }

    let end = (offset + limit).min(total);
    let mirror_index = total.saturating_sub(end);
    let mirror_take = (end - offset).min(limit);
    if mirror_index + mirror_take > CF_WINDOW {
        return Ok(CurseforgeSearchResult {
            data: vec![],
            pagination: CfPagination { total_count: total },
            reachable_count: reachable,
            capped: true,
        });
    }

    let (mut data, _) = run(build(mirror_index, "asc")).await?;
    data.reverse();
    data.truncate(mirror_take as usize);
    Ok(CurseforgeSearchResult {
        data,
        pagination: CfPagination { total_count: total },
        reachable_count: reachable,
        capped: false,
    })
}

/// Get files for a CurseForge mod (filtered by game version / loader)
#[tauri::command]
pub async fn get_curseforge_mod_files(
    mod_id: u64,
    game_version: Option<String>,
    mod_loader_type: Option<u32>,
    api_key: String,
) -> Result<serde_json::Value, String> {
    let api_key = if api_key.is_empty() { read_curseforge_api_key() } else { api_key };
    if api_key.is_empty() {
        return Err("CurseForge API key not configured.".into());
    }
    let client = cf_client(&api_key)?;
    let mut req = client.get(&format!("https://api.curseforge.com/v1/mods/{}/files", mod_id))
        .query(&[("pageSize", "50"), ("sortOrder", "desc")]);
    if let Some(v) = &game_version { req = req.query(&[("gameVersion", v.as_str())]); }
    if let Some(l) = mod_loader_type { req = req.query(&[("modLoaderType", l.to_string())]); }
    let resp = cf_json_response(req, "file lookup").await?;
    Ok(resp)
}

/// Get the direct download URL for a specific CurseForge file
#[tauri::command]
pub async fn get_curseforge_file_download_url(
    mod_id: u64,
    file_id: u64,
    api_key: String,
    prefer_resource_pack_cdn: Option<bool>,
) -> Result<String, String> {
    let api_key = if api_key.is_empty() { read_curseforge_api_key() } else { api_key };
    if api_key.is_empty() {
        return Err("CurseForge API key not configured.".into());
    }
    let client = cf_client(&api_key)?;
    let resp = cf_json_response(
        client.get(&format!("https://api.curseforge.com/v1/mods/{}/files/{}/download-url", mod_id, file_id)),
        "download URL lookup",
    ).await?;
    let url = resp["data"].as_str().unwrap_or("").to_string();
    let resource_pack_cdn = prefer_resource_pack_cdn.unwrap_or(false);
    if url.is_empty() {
        // The retired edge host can reject texture-pack archives even though
        // CurseForge returned valid file metadata. Keep the established host
        // for other content; resource packs explicitly use the current CDN.
        let id_str = file_id.to_string();
        let part1 = &id_str[..4];
        let part2 = &id_str[4..];
        let file_resp = cf_json_response(
            client.get(&format!("https://api.curseforge.com/v1/mods/{}/files/{}", mod_id, file_id)),
            "file metadata lookup",
        ).await?;
        let fname = file_resp["data"]["fileName"].as_str().unwrap_or("mod.jar");
        let host = if resource_pack_cdn { "mediafilez.forgecdn.net" } else { "edge.forgecdn.net" };
        Ok(format!("https://{host}/files/{}/{}/{}", part1, part2.trim_start_matches('0'), fname))
    } else {
        if resource_pack_cdn {
            Ok(url.replace("edge.forgecdn.net", "mediafilez.forgecdn.net"))
        } else {
            Ok(url)
        }
    }
}


// ── Bedrock: игру и классы (Addons/Texture Packs/Scripts/Skins/Maps) ──────
// ВАЖНО: numeric gameId и classId для Minecraft Bedrock на CurseForge нигде
// в открытой документации не зафиксированы (только слаги вроде "addons" в
// URL сайта). Поэтому не хардкодим их, а спрашиваем у самого CurseForge API
// через официальные /v1/games и /v1/games/{id}/categories — так корректно,
// даже если CurseForge когда-нибудь поменяет внутренние ID.

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct BedrockTaxonomy {
    pub game_id: u64,
    /// slug ("addons","texture-packs","scripts","skins","maps") → classId
    pub classes: std::collections::HashMap<String, u64>,
}

#[tauri::command]
pub async fn get_bedrock_curseforge_taxonomy(api_key: String) -> Result<BedrockTaxonomy, String> {
    let api_key = if api_key.is_empty() { read_curseforge_api_key() } else { api_key };
    if api_key.is_empty() {
        return Err("CurseForge API key not configured. Add it in Settings → Advanced.".into());
    }
    let client = cf_client(&api_key)?;

    let games: serde_json::Value = client
        .get("https://api.curseforge.com/v1/games")
        .query(&[("pageSize", "50")])
        .send().await.map_err(|e| format!("CurseForge games request: {e}"))?
        .json().await.map_err(|e| format!("CurseForge games parse: {e}"))?;

    let game_id = games["data"].as_array()
        .and_then(|arr| arr.iter().find(|g| {
            g["name"].as_str().map(|n| n.to_lowercase().contains("bedrock")).unwrap_or(false)
        }))
        .and_then(|g| g["id"].as_u64())
        .ok_or("CurseForge: игра 'Minecraft Bedrock' не найдена в /v1/games — возможно, API-ключ не даёт к ней доступа.")?;

    let cats: serde_json::Value = client
        .get(&format!("https://api.curseforge.com/v1/games/{game_id}/categories"))
        .send().await.map_err(|e| format!("CurseForge categories request: {e}"))?
        .json().await.map_err(|e| format!("CurseForge categories parse: {e}"))?;

    let mut classes = std::collections::HashMap::new();
    if let Some(arr) = cats["data"].as_array() {
        for c in arr {
            if c["isClass"].as_bool() == Some(true) {
                if let (Some(slug), Some(id)) = (c["slug"].as_str(), c["id"].as_u64()) {
                    classes.insert(slug.to_string(), id);
                }
            }
        }
    }
    if classes.is_empty() {
        return Err("CurseForge: не удалось получить категории Bedrock (пустой список classId).".into());
    }

    Ok(BedrockTaxonomy { game_id, classes })
}

#[derive(serde::Serialize, serde::Deserialize, Debug)]
pub struct FriendEntry {
    pub id: String,
    pub uuid: String,
    pub username: String,
    pub status: String,
    pub current_instance: Option<String>,
    pub server_address: Option<String>,
    pub last_seen: Option<String>,
}

/// Get friend list for the current user.
/// In a full implementation this calls Portal's backend API.
#[tauri::command]
pub async fn get_friends(_access_token: Option<String>) -> Result<Vec<FriendEntry>, String> {
    Ok(vec![]) // Real data comes from the React store (mock) or WebSocket push
}

/// Add a friend by Minecraft username.
/// 1. Resolve username -> UUID via Mojang API
/// 2. POST friend request to Portal backend
#[tauri::command]
pub async fn add_friend(username: String, _access_token: Option<String>) -> Result<String, String> {
    let client = reqwest::Client::new();

    // Resolve UUID
    let url = format!("https://api.mojang.com/users/profiles/minecraft/{}", username);
    let resp = client
        .get(&url)
        .send()
        .await
        .map_err(|e| format!("Network error: {}", e))?;

    if resp.status() == 404 {
        return Err(format!("Player '{}' not found", username));
    }

    let profile: serde_json::Value = resp
        .json()
        .await
        .map_err(|e| format!("Parse error: {}", e))?;

    let uuid = profile["id"].as_str().unwrap_or("").to_string();
    Ok(uuid)
}

/// Remove a friend by UUID.
#[tauri::command]
pub async fn remove_friend(uuid: String, _access_token: Option<String>) -> Result<(), String> {
    log::info!("Removing friend: {}", uuid);
    Ok(())
}

/// Join a friend's world via LAN or dedicated server.
///
/// Logic:
/// 1. Look up the selected instance config
/// 2. If server_address is Some -> pass --server flag to Minecraft launch
/// 3. If server_address is None -> launch Minecraft normally, LAN world will appear
///    in Multiplayer -> the user selects it (Radmin/Hamachi handles VPN tunneling)
#[tauri::command]
pub async fn join_friend_world(
    friend_uuid: String,
    instance_id: String,
    server_address: Option<String>,
    _access_token: Option<String>,
) -> Result<(), String> {
    log::info!(
        "Joining friend {} on instance {} (server: {:?})",
        friend_uuid, instance_id, server_address
    );

    // In a real implementation:
    // 1. Load instance config from disk
    // 2. Build JVM launch command (same as launch_instance)
    // 3. Append --server <address> --port <port> if server_address is set
    // 4. Spawn the process

    // For now, delegate to the launch command (stub)
    Ok(())
}

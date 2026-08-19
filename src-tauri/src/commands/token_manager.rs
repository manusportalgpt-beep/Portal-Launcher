const SERVICE_NAME: &str = "PortalLauncher";

/// Store Microsoft/Minecraft tokens in the OS keychain (Windows Credential Store)
#[tauri::command]
pub async fn store_tokens(
    uuid: String,
    access_token: String,
    refresh_token: String,
    expires_at: u64,
) -> Result<(), String> {
    // Store refresh token in keychain (access token is too short-lived)
    let entry = keyring::Entry::new(SERVICE_NAME, &format!("refresh_{}", uuid))
        .map_err(|e| format!("Keychain error: {e}"))?;
    let payload = serde_json::json!({
        "access_token": access_token,
        "refresh_token": refresh_token,
        "expires_at": expires_at,
    }).to_string();
    entry.set_password(&payload).map_err(|e| format!("Store error: {e}"))?;
    log::info!("Tokens stored for UUID: {}", uuid);
    Ok(())
}

/// Retrieve stored refresh token from OS keychain
#[tauri::command]
pub async fn get_stored_refresh_token(uuid: String) -> Result<Option<String>, String> {
    let entry = keyring::Entry::new(SERVICE_NAME, &format!("refresh_{}", uuid))
        .map_err(|e| format!("Keychain error: {e}"))?;
    match entry.get_password() {
        Ok(payload) => {
            let parsed: serde_json::Value = serde_json::from_str(&payload).map_err(|e| e.to_string())?;
            let expires_at = parsed["expires_at"].as_u64().unwrap_or(0);
            // Revoke if expired
            if expires_at > 0 && expires_at < std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH).unwrap_or_default().as_secs() {
                log::info!("Refresh token expired for UUID: {}", uuid);
                return Ok(None);
            }
            Ok(parsed["refresh_token"].as_str().map(String::from))
        }
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(e) => Err(format!("Keychain read error: {e}")),
    }
}

/// Delete all stored tokens for a user (on logout)
#[tauri::command]
pub async fn delete_stored_tokens(uuid: String) -> Result<(), String> {
    let entry = keyring::Entry::new(SERVICE_NAME, &format!("refresh_{}", uuid))
        .map_err(|e| format!("Keychain error: {e}"))?;
    match entry.delete_credential() {
        Ok(_) => Ok(()),
        Err(keyring::Error::NoEntry) => Ok(()), // already gone
        Err(e) => Err(format!("Delete error: {e}")),
    }
}

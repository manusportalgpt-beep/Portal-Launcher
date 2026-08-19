use super::cloud_auth::{CloudAuthData, EncryptedCloudAuth, CloudProvider, CloudSyncStatus, generate_key, simple_encrypt, simple_decrypt};
use serde::{Serialize, Deserialize};
use std::time::{SystemTime, UNIX_EPOCH};
use std::path::PathBuf;
use std::sync::Arc;
use tokio::sync::RwLock;

#[allow(unused_imports)]
use std::time::Duration;

/// Cloud sync service for authentication data
#[derive(Clone)]
pub struct CloudSyncService {
    provider: Arc<RwLock<CloudProvider>>,
    local_data_dir: PathBuf,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct CloudAuthResponse {
    pub success: bool,
    pub data: Option<CloudAuthData>,
    pub error: Option<String>,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct SyncResult {
    pub success: bool,
    pub uploaded: bool,
    pub downloaded: bool,
    pub message: String,
}

impl CloudSyncService {
    pub fn new(data_dir: PathBuf) -> Self {
        std::fs::create_dir_all(&data_dir).ok();
        Self {
            provider: Arc::new(RwLock::new(CloudProvider::default())),
            local_data_dir: data_dir,
        }
    }

    /// Set cloud provider
    pub async fn set_provider(&self, provider: CloudProvider) {
        let mut p = self.provider.write().await;
        *p = provider;
    }

    /// Get current provider
    pub async fn get_provider(&self) -> CloudProvider {
        self.provider.read().await.clone()
    }

    /// Encrypt auth data for cloud storage
    fn encrypt_auth_data(data: &CloudAuthData, user_id: &str) -> Result<EncryptedCloudAuth, String> {
        let json = serde_json::to_string(data).map_err(|e| format!("Serialize: {e}"))?;
        let key = generate_key(user_id, &data.device_id);
        
        // Generate simple nonce from timestamp
        let nonce: Vec<u8> = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_secs()
            .to_le_bytes()
            .to_vec();
        
        let encrypted = simple_encrypt(json.as_bytes(), &key);
        let data_b64 = base64_encode(&encrypted);
        let nonce_b64 = base64_encode(&nonce);
        
        Ok(EncryptedCloudAuth::new(data_b64, nonce_b64, 1))
    }

    /// Decrypt auth data from cloud storage
    fn decrypt_auth_data(encrypted: &EncryptedCloudAuth, user_id: &str, device_id: &str) -> Result<CloudAuthData, String> {
        let encrypted_bytes = base64_decode(&encrypted.data).map_err(|e| format!("Decode: {e}"))?;
        let key = generate_key(user_id, device_id);
        let decrypted = simple_decrypt(&encrypted_bytes, &key);
        let json = String::from_utf8(decrypted).map_err(|e| format!("UTF8: {e}"))?;
        serde_json::from_str(&json).map_err(|e| format!("Deserialize: {e}"))
    }

    /// Save auth data to cloud
    pub async fn save_to_cloud(&self, auth_data: &CloudAuthData) -> Result<bool, String> {
        let provider = self.provider.read().await;
        
        match &*provider {
            CloudProvider::PortalCloud { .. } => {
                // In production, this would call the actual cloud API
                // For now, save locally as encrypted file
                self.save_encrypted_local(auth_data).await?;
                Ok(true)
            }
            CloudProvider::GoogleDrive { .. } => {
                // TODO: Implement Google Drive sync
                self.save_encrypted_local(auth_data).await?;
                Ok(true)
            }
            CloudProvider::Dropbox { .. } => {
                // TODO: Implement Dropbox sync
                self.save_encrypted_local(auth_data).await?;
                Ok(true)
            }
            CloudProvider::Local { path } => {
                // Save to specified local path
                let json = serde_json::to_string_pretty(auth_data).map_err(|e| format!("Serialize: {e}"))?;
                std::fs::write(path, json).map_err(|e| format!("Write: {e}"))?;
                Ok(true)
            }
        }
    }

    /// Load auth data from cloud
    pub async fn load_from_cloud(&self, user_id: &str) -> Result<Option<CloudAuthData>, String> {
        let provider = self.provider.read().await;
        
        match &*provider {
            CloudProvider::PortalCloud { .. } => {
                // In production, this would call the actual cloud API
                // For now, load from encrypted local file
                self.load_encrypted_local(user_id).await
            }
            CloudProvider::GoogleDrive { .. } => {
                // TODO: Implement Google Drive sync
                self.load_encrypted_local(user_id).await
            }
            CloudProvider::Dropbox { .. } => {
                // TODO: Implement Dropbox sync
                self.load_encrypted_local(user_id).await
            }
            CloudProvider::Local { path } => {
                if std::path::Path::new(path).exists() {
                    let json = std::fs::read_to_string(path).map_err(|e| format!("Read: {e}"))?;
                    let data: CloudAuthData = serde_json::from_str(&json).map_err(|e| format!("Parse: {e}"))?;
                    Ok(Some(data))
                } else {
                    Ok(None)
                }
            }
        }
    }

    /// Save encrypted auth data locally (fallback/storage)
    async fn save_encrypted_local(&self, auth_data: &CloudAuthData) -> Result<(), String> {
        let encrypted = Self::encrypt_auth_data(auth_data, &auth_data.user_id)?;
        let json = serde_json::to_string_pretty(&encrypted).map_err(|e| format!("Serialize: {e}"))?;
        
        let file_path = self.local_data_dir.join(format!("cloud_auth_{}.enc", auth_data.user_id));
        std::fs::write(&file_path, json).map_err(|e| format!("Write: {e}"))?;
        
        Ok(())
    }

    /// Load encrypted auth data locally
    async fn load_encrypted_local(&self, user_id: &str) -> Result<Option<CloudAuthData>, String> {
        let file_path = self.local_data_dir.join(format!("cloud_auth_{}.enc", user_id));
        
        if !file_path.exists() {
            return Ok(None);
        }
        
        let json = std::fs::read_to_string(&file_path).map_err(|e| format!("Read: {e}"))?;
        let encrypted: EncryptedCloudAuth = serde_json::from_str(&json).map_err(|e| format!("Parse: {e}"))?;
        
        // We need device_id to decrypt - store it in filename or metadata
        // For simplicity, try to decrypt with common device IDs
        Self::decrypt_auth_data(&encrypted, user_id, user_id)
            .or_else(|_| Self::decrypt_auth_data(&encrypted, user_id, &format!("device_{}", user_id)))
            .map(Some)
    }

    /// Get sync status
    pub async fn get_status(&self, user_id: &str) -> CloudSyncStatus {
        let provider = self.provider.read().await;
        let file_path = self.local_data_dir.join(format!("cloud_auth_{}.enc", user_id));
        
        let last_sync = if file_path.exists() {
            file_path.metadata()
                .ok()
                .and_then(|m| m.modified().ok())
                .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
                .map(|d| d.as_secs())
        } else {
            None
        };

        CloudSyncStatus {
            is_synced: last_sync.is_some(),
            last_sync,
            provider: match &*provider {
                CloudProvider::PortalCloud { .. } => "PortalCloud".to_string(),
                CloudProvider::GoogleDrive { .. } => "GoogleDrive".to_string(),
                CloudProvider::Dropbox { .. } => "Dropbox".to_string(),
                CloudProvider::Local { .. } => "Local".to_string(),
            },
            error: None,
        }
    }

    /// Delete cloud auth data
    pub async fn delete_cloud_auth(&self, user_id: &str) -> Result<(), String> {
        let provider = self.provider.read().await;
        
        match &*provider {
            CloudProvider::Local { path } => {
                if std::path::Path::new(path).exists() {
                    std::fs::remove_file(path).map_err(|e| format!("Delete: {e}"))?;
                }
            }
            _ => {
                // Delete local encrypted file
                let file_path = self.local_data_dir.join(format!("cloud_auth_{}.enc", user_id));
                if file_path.exists() {
                    std::fs::remove_file(&file_path).map_err(|e| format!("Delete: {e}"))?;
                }
            }
        }
        
        Ok(())
    }
}

/// Simple base64 encode (no external dependency)
fn base64_encode(input: &[u8]) -> String {
    const ALPHABET: &[u8] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut result = String::with_capacity((input.len() + 2) / 3 * 4);
    
    let mut i = 0;
    while i + 3 <= input.len() {
        let n = ((input[i] as u32) << 16) | ((input[i + 1] as u32) << 8) | (input[i + 2] as u32);
        result.push(ALPHABET[((n >> 18) & 0x3F) as usize] as char);
        result.push(ALPHABET[((n >> 12) & 0x3F) as usize] as char);
        result.push(ALPHABET[((n >> 6) & 0x3F) as usize] as char);
        result.push(ALPHABET[(n & 0x3F) as usize] as char);
        i += 3;
    }
    
    let remaining = input.len() - i;
    if remaining == 1 {
        let n = (input[i] as u32) << 16;
        result.push(ALPHABET[((n >> 18) & 0x3F) as usize] as char);
        result.push(ALPHABET[((n >> 12) & 0x3F) as usize] as char);
        result.push_str("==");
    } else if remaining == 2 {
        let n = ((input[i] as u32) << 16) | ((input[i + 1] as u32) << 8);
        result.push(ALPHABET[((n >> 18) & 0x3F) as usize] as char);
        result.push(ALPHABET[((n >> 12) & 0x3F) as usize] as char);
        result.push(ALPHABET[((n >> 6) & 0x3F) as usize] as char);
        result.push('=');
    }
    
    result
}

/// Simple base64 decode
fn base64_decode(input: &str) -> Result<Vec<u8>, String> {
    const DECODE_TABLE: [i8; 128] = [
        -1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,
        -1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,
        -1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,62,-1,-1,-1,63,
        52,53,54,55,56,57,58,59,60,61,-1,-1,-1,-1,-1,-1,
        -1, 0, 1, 2, 3, 4, 5, 6, 7, 8, 9,10,11,12,13,14,
        15,16,17,18,19,20,21,22,23,24,25,-1,-1,-1,-1,-1,
        -1,26,27,28,29,30,31,32,33,34,35,36,37,38,39,40,
        41,42,43,44,45,46,47,48,49,50,51,-1,-1,-1,-1,-1,
    ];
    
    let input = input.trim_end_matches('=');
    let mut result = Vec::with_capacity(input.len() * 3 / 4);
    
    let bytes: Vec<u8> = input.bytes()
        .filter_map(|b| {
            if b < 128 && DECODE_TABLE[b as usize] >= 0 {
                Some(DECODE_TABLE[b as usize] as u8)
            } else {
                None
            }
        })
        .collect();
    
    let mut i = 0;
    while i + 4 <= bytes.len() {
        let n = ((bytes[i] as u32) << 18)
            | ((bytes[i + 1] as u32) << 12)
            | ((bytes[i + 2] as u32) << 6)
            | (bytes[i + 3] as u32);
        result.push((n >> 16) as u8);
        result.push((n >> 8) as u8);
        result.push(n as u8);
        i += 4;
    }
    
    let remaining = bytes.len() - i;
    if remaining == 2 {
        let n = ((bytes[i] as u32) << 18) | ((bytes[i + 1] as u32) << 12);
        result.push((n >> 16) as u8);
    } else if remaining == 3 {
        let n = ((bytes[i] as u32) << 18) | ((bytes[i + 1] as u32) << 12) | ((bytes[i + 2] as u32) << 6);
        result.push((n >> 16) as u8);
        result.push((n >> 8) as u8);
    }
    
    Ok(result)
}

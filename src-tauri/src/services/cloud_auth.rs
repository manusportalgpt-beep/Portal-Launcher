use serde::{Serialize, Deserialize};
use std::time::{SystemTime, UNIX_EPOCH};

/// Cloud-stored authentication data with encryption support
#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct CloudAuthData {
    /// Unique user identifier (UUID)
    pub user_id: String,
    /// Minecraft username
    pub username: String,
    /// Minecraft UUID
    pub mc_uuid: String,
    /// Microsoft access token (encrypted)
    pub ms_access_token: String,
    /// Microsoft refresh token (encrypted) - LONG LIVED!
    pub ms_refresh_token: String,
    /// Minecraft access token (encrypted)
    pub mc_access_token: String,
    /// Token expiration timestamp (Unix seconds)
    pub expires_at: u64,
    /// When this was created (Unix seconds)
    pub created_at: u64,
    /// Last synchronized (Unix seconds)
    pub last_synced: u64,
    /// Device identifier that created this auth
    pub device_id: String,
    /// Skin URL
    pub skin_url: Option<String>,
    /// Whether this is a premium (paid) account
    pub is_premium: bool,
}

impl CloudAuthData {
    /// Create new cloud auth data
    pub fn new(
        user_id: String,
        username: String,
        mc_uuid: String,
        ms_access_token: String,
        ms_refresh_token: String,
        mc_access_token: String,
        expires_in: u64,
        skin_url: Option<String>,
        is_premium: bool,
    ) -> Self {
        let now = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_secs();
        
        // Generate a simple device ID from hostname + timestamp
        let device_id = format!("device_{}_{}", 
            hostname::get().unwrap_or_default().to_string_lossy().replace('-', "_"),
            now
        );

        Self {
            user_id,
            username,
            mc_uuid,
            ms_access_token,
            ms_refresh_token,
            mc_access_token,
            expires_at: now + expires_in,
            created_at: now,
            last_synced: now,
            device_id,
            skin_url,
            is_premium,
        }
    }

    /// Check if tokens are expired
    pub fn is_expired(&self) -> bool {
        let now = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_secs();
        // Consider expired 5 minutes before actual expiration
        now >= self.expires_at.saturating_sub(300)
    }

    /// Check if refresh is needed (less than 1 hour remaining)
    pub fn needs_refresh(&self) -> bool {
        let now = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_secs();
        // Refresh if less than 1 hour remaining
        self.expires_at.saturating_sub(now) < 3600
    }

    /// Update tokens after refresh
    pub fn update_tokens(
        &mut self,
        ms_access_token: String,
        ms_refresh_token: String,
        mc_access_token: String,
        expires_in: u64,
    ) {
        let now = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_secs();
        
        self.ms_access_token = ms_access_token;
        self.ms_refresh_token = ms_refresh_token;
        self.mc_access_token = mc_access_token;
        self.expires_at = now + expires_in;
        self.last_synced = now;
    }

    /// Sync timestamp
    pub fn mark_synced(&mut self) {
        let now = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_secs();
        self.last_synced = now;
    }
}

/// Encrypted cloud auth payload for transmission/storage
#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct EncryptedCloudAuth {
    /// Encrypted data (base64)
    pub data: String,
    /// Nonce for encryption (base64)
    pub nonce: String,
    /// Version of encryption scheme
    pub version: u8,
    /// Timestamp when encrypted
    pub encrypted_at: u64,
}

impl EncryptedCloudAuth {
    pub fn new(data: String, nonce: String, version: u8) -> Self {
        let now = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_secs();
        
        Self {
            data,
            nonce,
            version,
            encrypted_at: now,
        }
    }
}

/// Cloud storage provider types
#[derive(Serialize, Deserialize, Debug, Clone, PartialEq)]
#[serde(tag = "type")]
pub enum CloudProvider {
    /// Portal Launcher Cloud (default)
    PortalCloud { api_key: Option<String> },
    /// Google Drive
    GoogleDrive { access_token: String },
    /// Dropbox
    Dropbox { access_token: String },
    /// Local encrypted file (fallback)
    Local { path: String },
}

impl Default for CloudProvider {
    fn default() -> Self {
        CloudProvider::PortalCloud { api_key: None }
    }
}

/// Cloud sync status
#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct CloudSyncStatus {
    pub is_synced: bool,
    pub last_sync: Option<u64>,
    pub provider: String,
    pub error: Option<String>,
}

/// Simple XOR encryption for local storage (NOT for transmission!)
/// For production, use proper AES-GCM via ring or aes-gcm crate
pub fn simple_encrypt(data: &[u8], key: &[u8]) -> Vec<u8> {
    data.iter()
        .zip(key.iter().cycle())
        .map(|(&d, &k)| d ^ k)
        .collect()
}

pub fn simple_decrypt(data: &[u8], key: &[u8]) -> Vec<u8> {
    // XOR is symmetric
    simple_encrypt(data, key)
}

/// Generate encryption key from device ID and user ID
pub fn generate_key(user_id: &str, device_id: &str) -> Vec<u8> {
    use sha2::{Sha256, Digest};
    let mut hasher = Sha256::new();
    hasher.update(user_id.as_bytes());
    hasher.update(device_id.as_bytes());
    hasher.update(b"portal_launcher_cloud_auth_v1");
    hasher.finalize().to_vec()
}

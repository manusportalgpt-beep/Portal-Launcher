use serde::{Serialize, Deserialize};
use std::path::PathBuf;

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct ChatMessage {
    pub id: String,
    pub from_uuid: String,
    pub to_uuid: String,
    pub text: Option<String>,
    pub voice_url: Option<String>,
    pub image_url: Option<String>,
    pub timestamp: String,
    pub delivered: bool,
    pub read: bool,
    pub deleted_for_sender: bool,
    pub deleted_for_everyone: bool,
}

use super::settings::read_relay_url;

/// Fire-and-forget: send message to relay server so other user receives it in real-time.
/// Failures are silently ignored (local SQLite is the source of truth).
async fn relay_send_message(relay_url: &str, msg: &ChatMessage) {
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(5))
        .build().unwrap_or_default();
    let _ = client.post(format!("{}/api/messages", relay_url))
        .json(&serde_json::json!({
            "fromUserId": msg.from_uuid,
            "toUserId":   msg.to_uuid,
            "type":       "text",
            "text":       msg.text,
            "fileUrl":    msg.voice_url.as_ref().or(msg.image_url.as_ref()),
            "timestamp":  msg.timestamp,
        }))
        .send().await;
}

/// Poll relay server for new messages from a friend.
pub async fn relay_poll_messages(relay_url: &str, my_uuid: &str, friend_uuid: &str) -> Vec<ChatMessage> {
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(5))
        .build().unwrap_or_default();
    match client.get(format!("{}/api/messages/{}/{}", relay_url, my_uuid, friend_uuid))
        .send().await {
        Ok(resp) => resp.json::<Vec<serde_json::Value>>().await.unwrap_or_default()
            .into_iter().filter_map(|v| {
                Some(ChatMessage {
                    id: v["id"].as_str()?.to_string(),
                    from_uuid: v["fromUserId"].as_str()?.to_string(),
                    to_uuid: v["toUserId"].as_str()?.to_string(),
                    text: v["text"].as_str().map(String::from),
                    voice_url: None,
                    image_url: v["fileUrl"].as_str().map(String::from),
                    timestamp: v["timestamp"].as_str()?.to_string(),
                    delivered: v["delivered"].as_bool().unwrap_or(false),
                    read: v["read"].as_bool().unwrap_or(false),
                    deleted_for_sender: v["deletedForSender"].as_bool().unwrap_or(false),
                    deleted_for_everyone: v["deletedForEveryone"].as_bool().unwrap_or(false),
                })
            }).collect(),
        Err(_) => vec![],
    }
}

fn get_db_path() -> PathBuf {
    let mut p = dirs_next::data_local_dir().unwrap_or_else(|| PathBuf::from("."));
    p.push("PortalLauncher");
    std::fs::create_dir_all(&p).ok();
    p.push("chat.sqlite");
    p
}

fn open_db() -> Result<rusqlite::Connection, String> {
    let conn = rusqlite::Connection::open(get_db_path())
        .map_err(|e| format!("DB open error: {e}"))?;
    conn.execute_batch("
        CREATE TABLE IF NOT EXISTS messages (
            id TEXT PRIMARY KEY,
            from_uuid TEXT NOT NULL,
            to_uuid TEXT NOT NULL,
            text TEXT,
            voice_url TEXT,
            image_url TEXT,
            timestamp TEXT NOT NULL,
            delivered INTEGER NOT NULL DEFAULT 0,
            read_flag INTEGER NOT NULL DEFAULT 0,
            deleted_sender INTEGER NOT NULL DEFAULT 0,
            deleted_everyone INTEGER NOT NULL DEFAULT 0
        );
        CREATE INDEX IF NOT EXISTS idx_msg_convo ON messages(from_uuid, to_uuid);
        CREATE TABLE IF NOT EXISTS offline_queue (
            id TEXT PRIMARY KEY,
            to_uuid TEXT NOT NULL,
            payload TEXT NOT NULL,
            created_at TEXT NOT NULL
        );
    ").map_err(|e| format!("Schema error: {e}"))?;
    Ok(conn)
}

#[derive(Serialize, Deserialize, Debug)]
pub struct SendResult {
    pub id: String,
    pub timestamp: String,
}

#[tauri::command]
pub async fn send_message(
    from_uuid: String,
    to_uuid: String,
    text: Option<String>,
    voice_url: Option<String>,
    image_url: Option<String>,
) -> Result<SendResult, String> {
    let id = uuid::Uuid::new_v4().to_string();
    let timestamp = chrono::Utc::now().to_rfc3339();

    let conn = open_db()?;
    conn.execute(
        "INSERT INTO messages (id, from_uuid, to_uuid, text, voice_url, image_url, timestamp, delivered, read_flag)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, 0, 0)",
        rusqlite::params![&id, &from_uuid, &to_uuid, &text, &voice_url, &image_url, &timestamp],
    ).map_err(|e| format!("Insert error: {e}"))?;

    // Queue for offline delivery if recipient is offline (always queue, deliver on reconnect)
    let payload = serde_json::json!({
        "id": &id, "from_uuid": &from_uuid, "to_uuid": &to_uuid,
        "text": &text, "voice_url": &voice_url, "image_url": &image_url,
        "timestamp": &timestamp
    }).to_string();
    conn.execute(
        "INSERT OR REPLACE INTO offline_queue (id, to_uuid, payload, created_at) VALUES (?1, ?2, ?3, ?4)",
        rusqlite::params![&id, &to_uuid, &payload, &timestamp],
    ).map_err(|e| format!("Queue error: {e}"))?;

    // Relay to backend server (best-effort, non-blocking)
    let relay_url = read_relay_url();
    if !relay_url.is_empty() {
        let relay_msg = ChatMessage {
            id: id.clone(), from_uuid: from_uuid.clone(), to_uuid: to_uuid.clone(),
            text: text.clone(), voice_url: voice_url.clone(), image_url: image_url.clone(),
            timestamp: timestamp.clone(), delivered: false, read: false,
            deleted_for_sender: false, deleted_for_everyone: false,
        };
        tokio::spawn(async move { relay_send_message(&relay_url, &relay_msg).await; });
    }
    Ok(SendResult { id, timestamp })
}

#[tauri::command]
pub async fn get_messages(
    my_uuid: String,
    friend_uuid: String,
    limit: Option<u32>,
    before_id: Option<String>,
) -> Result<Vec<ChatMessage>, String> {
    let conn = open_db()?;
    let limit = limit.unwrap_or(50);

    let rows = if let Some(bid) = &before_id {
        let ts: String = conn.query_row(
            "SELECT timestamp FROM messages WHERE id = ?1", rusqlite::params![bid],
            |r| r.get(0)
        ).unwrap_or_else(|_| chrono::Utc::now().to_rfc3339());
        conn.prepare(&format!(
            "SELECT id,from_uuid,to_uuid,text,voice_url,image_url,timestamp,delivered,read_flag,deleted_sender,deleted_everyone
             FROM messages WHERE ((from_uuid=?1 AND to_uuid=?2) OR (from_uuid=?2 AND to_uuid=?1))
             AND timestamp < '{ts}' AND deleted_sender=0 AND deleted_everyone=0
             ORDER BY timestamp DESC LIMIT {limit}"
        )).and_then(|mut s| {
            s.query_map(rusqlite::params![&my_uuid, &friend_uuid], row_to_msg)?.collect()
        }).map_err(|e| format!("Query error: {e}"))?
    } else {
        conn.prepare(&format!(
            "SELECT id,from_uuid,to_uuid,text,voice_url,image_url,timestamp,delivered,read_flag,deleted_sender,deleted_everyone
             FROM messages WHERE ((from_uuid=?1 AND to_uuid=?2) OR (from_uuid=?2 AND to_uuid=?1))
             AND deleted_sender=0 AND deleted_everyone=0
             ORDER BY timestamp DESC LIMIT {limit}"
        )).and_then(|mut s| {
            s.query_map(rusqlite::params![&my_uuid, &friend_uuid], row_to_msg)?.collect()
        }).map_err(|e| format!("Query error: {e}"))?
    };

    let mut msgs: Vec<ChatMessage> = rows;
    msgs.reverse();
    Ok(msgs)
}

fn row_to_msg(row: &rusqlite::Row) -> rusqlite::Result<ChatMessage> {
    Ok(ChatMessage {
        id: row.get(0)?,
        from_uuid: row.get(1)?,
        to_uuid: row.get(2)?,
        text: row.get(3)?,
        voice_url: row.get(4)?,
        image_url: row.get(5)?,
        timestamp: row.get(6)?,
        delivered: row.get::<_, i32>(7)? != 0,
        read: row.get::<_, i32>(8)? != 0,
        deleted_for_sender: row.get::<_, i32>(9)? != 0,
        deleted_for_everyone: row.get::<_, i32>(10)? != 0,
    })
}

#[tauri::command]
pub async fn delete_message(
    message_id: String,
    my_uuid: String,
    for_everyone: bool,
) -> Result<(), String> {
    let conn = open_db()?;
    if for_everyone {
        conn.execute(
            "UPDATE messages SET deleted_everyone=1, text=NULL, voice_url=NULL, image_url=NULL WHERE id=?1 AND from_uuid=?2",
            rusqlite::params![&message_id, &my_uuid],
        ).map_err(|e| format!("Delete error: {e}"))?;
    } else {
        conn.execute(
            "UPDATE messages SET deleted_sender=1 WHERE id=?1 AND (from_uuid=?2 OR to_uuid=?2)",
            rusqlite::params![&message_id, &my_uuid],
        ).map_err(|e| format!("Delete error: {e}"))?;
    }
    Ok(())
}

#[tauri::command]
pub async fn mark_messages_read(my_uuid: String, friend_uuid: String) -> Result<(), String> {
    let conn = open_db()?;
    conn.execute(
        "UPDATE messages SET read_flag=1, delivered=1 WHERE to_uuid=?1 AND from_uuid=?2 AND read_flag=0",
        rusqlite::params![&my_uuid, &friend_uuid],
    ).map_err(|e| format!("Update error: {e}"))?;
    Ok(())
}

#[tauri::command]
pub async fn flush_offline_queue(to_uuid: String) -> Result<Vec<ChatMessage>, String> {
    let conn = open_db()?;
    // Mark queued messages as delivered
    conn.execute(
        "UPDATE messages SET delivered=1 WHERE to_uuid=?1 AND delivered=0",
        rusqlite::params![&to_uuid],
    ).map_err(|e| format!("Flush error: {e}"))?;
    // Clear from queue
    conn.execute(
        "DELETE FROM offline_queue WHERE to_uuid=?1",
        rusqlite::params![&to_uuid],
    ).map_err(|e| format!("Queue clear error: {e}"))?;
    Ok(vec![])
}

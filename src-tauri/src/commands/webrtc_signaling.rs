use serde::{Serialize, Deserialize};
use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::RwLock;

/// In-memory store for WebRTC offers/answers (for LAN/P2P signaling).
/// In production this would be a WebSocket relay server.
static SIGNALING: once_cell::sync::Lazy<Arc<RwLock<HashMap<String, SignalingEntry>>>> =
    once_cell::sync::Lazy::new(|| Arc::new(RwLock::new(HashMap::new())));

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct SdpPayload {
    pub from_uuid: String,
    pub to_uuid: String,
    pub sdp: String,
    pub sdp_type: String, // "offer" | "answer"
    pub created_at: String,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct IceCandidate {
    pub from_uuid: String,
    pub to_uuid: String,
    pub candidate: String,
    pub sdp_mid: Option<String>,
    pub sdp_m_line_index: Option<u32>,
}

#[derive(Debug, Clone)]
struct SignalingEntry {
    pub sdp: Option<SdpPayload>,
    pub ice_candidates: Vec<IceCandidate>,
}

/// Send a WebRTC offer (caller → callee)
#[tauri::command]
pub async fn send_offer(payload: SdpPayload) -> Result<(), String> {
    let key = format!("{}->{}", payload.from_uuid, payload.to_uuid);
    let mut store = SIGNALING.write().await;
    store.insert(key, SignalingEntry { sdp: Some(payload), ice_candidates: vec![] });
    Ok(())
}

/// Send a WebRTC answer (callee → caller)
#[tauri::command]
pub async fn send_answer(payload: SdpPayload) -> Result<(), String> {
    let key = format!("{}->{}", payload.to_uuid, payload.from_uuid);
    let mut store = SIGNALING.write().await;
    if let Some(entry) = store.get_mut(&key) {
        entry.sdp = Some(payload);
    } else {
        store.insert(key, SignalingEntry { sdp: Some(payload), ice_candidates: vec![] });
    }
    Ok(())
}

/// Poll for a pending offer/answer
#[tauri::command]
pub async fn poll_signaling(my_uuid: String, peer_uuid: String) -> Result<Option<SdpPayload>, String> {
    let key = format!("{}->{}", peer_uuid, my_uuid);
    let store = SIGNALING.read().await;
    Ok(store.get(&key).and_then(|e| e.sdp.clone()))
}

/// Send an ICE candidate
#[tauri::command]
pub async fn send_ice_candidate(candidate: IceCandidate) -> Result<(), String> {
    let key = format!("{}->{}", candidate.from_uuid, candidate.to_uuid);
    let mut store = SIGNALING.write().await;
    store.entry(key).or_insert(SignalingEntry { sdp: None, ice_candidates: vec![] })
        .ice_candidates.push(candidate);
    Ok(())
}

/// Poll for pending ICE candidates
#[tauri::command]
pub async fn poll_ice_candidates(my_uuid: String, peer_uuid: String) -> Result<Vec<IceCandidate>, String> {
    let key = format!("{}->{}", peer_uuid, my_uuid);
    let mut store = SIGNALING.write().await;
    if let Some(entry) = store.get_mut(&key) {
        let candidates = std::mem::take(&mut entry.ice_candidates);
        Ok(candidates)
    } else {
        Ok(vec![])
    }
}

/// Clear signaling state when call ends
#[tauri::command]
pub async fn clear_signaling(my_uuid: String, peer_uuid: String) -> Result<(), String> {
    let mut store = SIGNALING.write().await;
    store.remove(&format!("{}->{}", my_uuid, peer_uuid));
    store.remove(&format!("{}->{}", peer_uuid, my_uuid));
    Ok(())
}

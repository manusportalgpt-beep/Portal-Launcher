use discord_rich_presence::DiscordIpc;
use discord_rich_presence::DiscordIpcClient;
use discord_rich_presence::models::{Activity, ActivityAssets, ActivityButton, ActivityTimestamps};
use log::{info, warn, error};
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Manager, State};

const DISCORD_APPLICATION_ID: &str = "1548634472554037368";

// Структура для хранения состояния Discord RPC
pub struct DiscordRpcState {
    pub client: Arc<Mutex<Option<DiscordIpcClient>>>,
    pub is_connected: Arc<Mutex<bool>>,
}

impl DiscordRpcState {
    pub fn new() -> Self {
        Self {
            client: Arc::new(Mutex::new(None)),
            is_connected: Arc::new(Mutex::new(false)),
        }
    }

    // Инициализация подключения к Discord
    pub fn initialize(&self) -> Result<(), String> {
        let mut client_opt = self.client.lock().map_err(|e| e.to_string())?;
        
        if client_opt.is_some() {
            info!("Discord RPC уже инициализирован");
            return Ok(());
        }

        match DiscordIpcClient::new(DISCORD_APPLICATION_ID) {
            Ok(mut client) => {
                match client.connect() {
                    Ok(_) => {
                        info!("Успешное подключение к Discord RPC");
                        *client_opt = Some(client);
                        let mut connected = self.is_connected.lock().map_err(|e| e.to_string())?;
                        *connected = true;
                        Ok(())
                    }
                    Err(e) => {
                        warn!("Не удалось подключиться к Discord (возможно, Discord не запущен): {}", e);
                        Err(format!("Ошибка подключения: {}", e))
                    }
                }
            }
            Err(e) => {
                warn!("Не удалось создать клиент Discord RPC: {}", e);
                Err(format!("Ошибка создания клиента: {}", e))
            }
        }
    }

    // Обновление статуса активности
    pub fn update_activity(
        &self,
        state: Option<String>,
        details: Option<String>,
        start_timestamp: Option<i64>,
        large_image_key: Option<String>,
        large_image_text: Option<String>,
        small_image_key: Option<String>,
        small_image_text: Option<String>,
        buttons: Option<Vec<(String, String)>>,
    ) -> Result<(), String> {
        let client_guard = self.client.lock().map_err(|e| e.to_string())?;
        let client = client_guard.as_ref().ok_or("Discord RPC клиент не инициализирован")?;
        
        let connected = self.is_connected.lock().map_err(|e| e.to_string())?;
        if !*connected {
            return Err("Discord RPC не подключен".to_string());
        }

        // Создаем активити
        let mut activity = Activity::new();
        
        if let Some(s) = state {
            activity = activity.state(s);
        }
        
        if let Some(d) = details {
            activity = activity.details(d);
        }
        
        if let Some(ts) = start_timestamp {
            activity = activity.timestamps(ActivityTimestamps::new().start(ts));
        }
        
        // Настройка изображений
        let mut assets = ActivityAssets::new();
        if let Some(large_key) = large_image_key {
            assets = assets.large_image(large_key);
            if let Some(large_text) = large_image_text {
                assets = assets.large_text(large_text);
            }
        }
        if let Some(small_key) = small_image_key {
            assets = assets.small_image(small_key);
            if let Some(small_text) = small_image_text {
                assets = assets.small_text(small_text);
            }
        }
        activity = activity.assets(assets);

        // Настройка кнопок
        if let Some(btns) = buttons {
            let mut activity_buttons = Vec::new();
            for (label, url) in btns {
                activity_buttons.push(ActivityButton::new(label, url));
            }
            activity = activity.buttons(activity_buttons);
        }

        // Отправляем обновление
        match client.set_activity(Some(activity)) {
            Ok(_) => {
                info!("Discord RPC активность обновлена");
                Ok(())
            }
            Err(e) => {
                error!("Ошибка обновления Discord RPC: {}", e);
                Err(format!("Ошибка обновления: {}", e))
            }
        }
    }

    // Очистка активности
    pub fn clear_activity(&self) -> Result<(), String> {
        let client_guard = self.client.lock().map_err(|e| e.to_string())?;
        let client = client_guard.as_ref().ok_or("Discord RPC клиент не инициализирован")?;
        
        match client.clear_activity() {
            Ok(_) => {
                info!("Discord RPC активность очищена");
                Ok(())
            }
            Err(e) => {
                error!("Ошибка очистки Discord RPC: {}", e);
                Err(format!("Ошибка очистки: {}", e))
            }
        }
    }

    // Закрытие соединения
    pub fn close(&self) {
        let mut client_opt = self.client.lock().unwrap();
        if let Some(mut client) = client_opt.take() {
            let _ = client.close();
            let mut connected = self.is_connected.lock().unwrap();
            *connected = false;
            info!("Discord RPC соединение закрыто");
        }
    }
}

// Tauri команды для вызова из фронтенда

#[tauri::command]
pub fn discord_rpc_initialize(state: State<DiscordRpcState>) -> Result<(), String> {
    state.initialize()
}

#[tauri::command]
pub fn discord_rpc_update_activity(
    state: State<DiscordRpcState>,
    app_state: Option<String>,
    details: Option<String>,
    start_timestamp: Option<i64>,
    large_image_key: Option<String>,
    large_image_text: Option<String>,
    small_image_key: Option<String>,
    small_image_text: Option<String>,
    buttons: Option<Vec<(String, String)>>,
) -> Result<(), String> {
    state.update_activity(
        app_state,
        details,
        start_timestamp,
        large_image_key,
        large_image_text,
        small_image_key,
        small_image_text,
        buttons,
    )
}

#[tauri::command]
pub fn discord_rpc_clear_activity(state: State<DiscordRpcState>) -> Result<(), String> {
    state.clear_activity()
}

// Инициализация при запуске приложения
pub fn init_discord_rpc(app: &AppHandle) {
    let rpc_state = DiscordRpcState::new();
    app.manage(rpc_state);
    
    // Пытаемся подключиться асинхронно
    let state = app.state::<DiscordRpcState>();
    if let Err(e) = state.initialize() {
        warn!("Не удалось инициализировать Discord RPC при старте: {}", e);
    }
}

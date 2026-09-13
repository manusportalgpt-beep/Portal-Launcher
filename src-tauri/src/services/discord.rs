use discord_rich_presence::DiscordIpc;
use discord_rich_presence::DiscordIpcClient;
use discord_rich_presence::model::RichPresence;
use std::sync::Mutex;
use once_cell::sync::Lazy;
use tauri::State;

// Структура для хранения клиента Discord
pub struct DiscordState {
    pub client: Mutex<Option<DiscordIpcClient>>,
    pub application_id: String,
}

impl DiscordState {
    pub fn new(application_id: String) -> Self {
        Self {
            client: Mutex::new(None),
            application_id,
        }
    }

    // Инициализация подключения к Discord
    pub fn connect(&self) -> Result<(), String> {
        let mut client_opt = self.client.lock().map_err(|e| e.to_string())?;
        
        if client_opt.is_some() {
            return Ok(()); // Уже подключено
        }

        let mut client = DiscordIpcClient::new(&self.application_id)
            .map_err(|e| format!("Failed to create Discord client: {}", e))?;
        
        client.connect()
            .map_err(|e| format!("Failed to connect to Discord: {}", e))?;
        
        *client_opt = Some(client);
        log::info!("Discord Rich Presence connected");
        Ok(())
    }

    // Обновление статуса
    pub fn update_presence(&self, presence: RichPresence) -> Result<(), String> {
        let mut client_opt = self.client.lock().map_err(|e| e.to_string())?;
        
        if let Some(client) = client_opt.as_mut() {
            client.set_activity(presence)
                .map_err(|e| format!("Failed to update Discord presence: {}", e))?;
            Ok(())
        } else {
            Err("Discord client not connected".to_string())
        }
    }

    // Очистка статуса
    pub fn clear_presence(&self) -> Result<(), String> {
        let mut client_opt = self.client.lock().map_err(|e| e.to_string())?;
        
        if let Some(client) = client_opt.as_mut() {
            client.clear_activity()
                .map_err(|e| format!("Failed to clear Discord presence: {}", e))?;
            Ok(())
        } else {
            Err("Discord client not connected".to_string())
        }
    }

    // Закрытие соединения
    pub fn close(&self) {
        let mut client_opt = self.client.lock().unwrap();
        if let Some(mut client) = client_opt.take() {
            let _ = client.close();
            log::info!("Discord Rich Presence disconnected");
        }
    }
}

// Команда для инициализации Discord Rich Presence
#[tauri::command]
pub fn init_discord(state: State<DiscordState>) -> Result<(), String> {
    state.connect()
}

// Команда для обновления статуса в лаунчере
#[tauri::command]
pub fn set_launcher_status(
    state: State<DiscordState>,
    page: String,
    details: Option<String>,
) -> Result<(), String> {
    let mut presence = RichPresence::new()
        .state(&page);

    if let Some(d) = details {
        presence = presence.details(&d);
    }

    // Добавляем изображения
    presence = presence
        .assets(
            discord_rich_presence::model::Assets::new()
                .large_image("launcher_icon") // Имя картинки из Discord Developer Portal
                .large_text("Portal Launcher")
        );

    state.update_presence(presence)
}

// Команда для обновления статуса в игре
#[tauri::command]
pub fn set_game_status(
    state: State<DiscordState>,
    version: String,
    mode: String, // "solo" или "multiplayer"
    server_name: Option<String>,
    players_online: Option<u32>,
    max_players: Option<u32>,
) -> Result<(), String> {
    let state_text = if mode == "multiplayer" {
        if let Some(server) = &server_name {
            format!("Playing on {}", server)
        } else {
            "Playing Multiplayer".to_string()
        }
    } else {
        "Playing Solo".to_string()
    };

    let mut presence = RichPresence::new()
        .state(&state_text)
        .details(&format!("Minecraft {}", version));

    // Добавляем изображения
    let mut assets = discord_rich_presence::model::Assets::new()
        .large_image("game_icon") // Имя картинки из Discord Developer Portal
        .large_text(&format!("Minecraft {}", version));

    // Маленькая иконка для режима
    if mode == "multiplayer" {
        assets = assets.small_image("multiplayer_icon").small_text("Multiplayer");
    } else {
        assets = assets.small_image("solo_icon").small_text("Singleplayer");
    }

    presence = presence.assets(assets);

    // Добавляем информацию о партии (для приглашений)
    if let (Some(current), Some(max)) = (players_online, max_players) {
        presence = presence.party(
            discord_rich_presence::model::Party::new()
                .size((current, max))
        );
    }

    state.update_presence(presence)
}

// Команда для очистки статуса
#[tauri::command]
pub fn clear_discord_status(state: State<DiscordState>) -> Result<(), String> {
    state.clear_presence()
}

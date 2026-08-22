#![cfg_attr(all(not(debug_assertions), target_os = "windows"), windows_subsystem = "windows")]

pub mod api;
pub mod commands;
pub mod models;
pub mod services;
pub mod utils;
pub mod minecraft_lib;
pub mod auth;
pub mod mc;

pub use services::cloud_sync::CloudSyncService;

use std::sync::Arc;
use std::collections::HashMap;
use tokio::sync::RwLock;

pub struct AppState {
    pub pending_auth:  Arc<RwLock<Option<String>>>,
    pub auth_results:  Arc<RwLock<HashMap<String, Result<minecraft_lib::AuthMcProfile, String>>>>,
}
impl AppState {
    pub fn new() -> Self {
        Self {
            pending_auth: Arc::new(RwLock::new(None)),
            auth_results: Arc::new(RwLock::new(HashMap::new())),
        }
    }
}

fn main() {
    env_logger::init();
    
    // Create ALL required directories on startup
    commands::dirs::ensure_all_dirs();
    // Refresh only the launcher-owned desktop link so it moves off a cached
    // old EXE icon when a newer bundled Portal icon is installed.
    commands::shortcuts::refresh_portal_launcher_desktop_shortcut().ok();
    
    let app_state = AppState::new();
    
    let _polling_handle = std::thread::spawn(move || {
        let rt = tokio::runtime::Runtime::new().unwrap();
        rt.block_on(async {
            // Polling is handled per-request
        });
    });
    
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_oauth::init())
        .manage(app_state)
        .invoke_handler(tauri::generate_handler![
            // Minecraft OAuth через minecraft_lib::oauth
            minecraft_lib::oauth::start_device_code_flow,
            minecraft_lib::oauth::poll_for_token,
            minecraft_lib::oauth::login_offline,
            minecraft_lib::oauth::login_elyby,
            minecraft_lib::oauth::refresh_token,
            minecraft_lib::oauth::auto_refresh_if_needed,
            minecraft_lib::oauth::get_cached_profile,
            minecraft_lib::oauth::is_token_expired,
            // Auth save
            commands::auth_save::save_auth_info,
            commands::auth_save::get_auth_info_cmd,
            commands::auth_save::debug_auth_info,
            // Cloud sync
            commands::auth::save_auth_to_cloud,
            commands::auth::load_auth_from_cloud,
            commands::auth::sync_auth_cloud,
            commands::auth::get_cloud_sync_status,
            commands::auth::set_cloud_provider,
            commands::auth::delete_cloud_auth,
            commands::auth::clear_auth,
            // Token manager
            commands::token_manager::store_tokens,
            commands::token_manager::get_stored_refresh_token,
            commands::token_manager::delete_stored_tokens,
            // Instances
            commands::instances::get_instances,
            commands::instances::get_launcher_storage_overview,
            commands::instances::create_instance,
            commands::instances::create_optifine_instance,
            commands::instances::update_instance,
            commands::instances::delete_instance,
            commands::instances::list_deleted_instances,
            commands::instances::restore_deleted_instance,
            commands::instances::permanently_delete_instance,
            commands::instances::ensure_instance,
            commands::instances::apply_global_runtime_settings,
            commands::instances::duplicate_instance,
            commands::instances::open_instance_folder,
            commands::instances::export_instance_zip,
            commands::instances::export_instance_mrpack,
            commands::instances::import_instance_zip,
            commands::instances::import_modrinth_pack,
            commands::instances::cancel_instance_install,
            commands::instances::import_archive_data,
            commands::instances::preview_remote_modpack,
            commands::instances::import_remote_modpack,
            commands::instances::import_prismlauncher_instance,
            commands::instances::import_external_instance,
            commands::instances::detect_prismlauncher_instances,
            commands::instances::detect_modrinth_instances,
            commands::instances::detect_supported_launcher_instances,
            commands::instances::import_supported_launcher_instance,
            commands::instances::backup_instance,
            commands::instances::list_backups,
            commands::instances::delete_instance_screenshot,
            commands::instances::list_screenshots,
            commands::instances::read_instance_screenshot,
            commands::instances::save_instance_screenshot,
            commands::instances::download_project_screenshot,
            // Minecraft
            // Реальный запуск Minecraft (mc::launch)
            mc::launch::launch_instance,
            mc::launch::kill_instance,
            mc::launch::cancel_launch,
            mc::launch::get_game_logs,
            mc::launch::get_running_instances,
            // Установка версий/загрузчиков и зеркала CDN
            mc::install::install_minecraft,
            mc::install::verify_installation,
            mc::mirrors::list_cdn_mirrors,
            mc::mirrors::test_cdn_mirror,
            // Microsoft OAuth (Authorization Code Flow)
            auth::msa::msa_login,
            auth::msa::msa_refresh,
            auth::msa::msa_get_account,
            auth::msa::msa_logout,
            auth::msa::save_frontend_account,
            auth::msa::set_offline_account,
            // ИИ-помощник (Grok)
            commands::ai::analyze_crash_with_ai,
            commands::ai::ai_chat,
            commands::ai::ai_is_configured,
            commands::ai::ai_set_api_key,
            // Темы .prtheme
            commands::themes::list_prthemes,
            commands::themes::import_prtheme,
            commands::themes::save_prtheme,
            commands::themes::delete_prtheme,
            commands::themes::get_prtheme,
            commands::themes::open_themes_folder,
            // Авторы модов
            commands::authors::get_modrinth_author,
            commands::authors::get_curseforge_author,
            // Файловая система сборки
            commands::instance_fs::instance_list_dir,
            commands::instance_fs::instance_read_text,
            commands::instance_fs::instance_write_text,
            commands::instance_fs::instance_mkdir,
            commands::instance_fs::instance_delete_path,
            commands::instance_fs::instance_rename_path,
            commands::instance_fs::instance_move_path,
            commands::instance_fs::instance_drop_files,
            commands::instance_fs::instance_list_worlds,
            commands::instance_fs::instance_list_servers,
            commands::instance_fs::instance_delete_world,
            commands::instance_fs::instance_add_server,
            commands::instance_fs::instance_open_dir,
            commands::instance_fs::instance_overview,
            commands::instance_fs::publish_log_mclogs,
            // Lighty launcher adapter
            commands::launcher::launch_with_lighty,
            commands::launcher::lighty_available,
            // Version manager
            commands::version_manager::get_installed_versions,
            commands::version_manager::get_available_versions,
            commands::version_manager::get_filtered_versions,
            commands::version_manager::download_minecraft_version,
            commands::version_manager::delete_minecraft_version,
            // Loader installer
            commands::loader_installer::install_forge,
            commands::loader_installer::install_fabric,
            commands::loader_installer::install_quilt,
            commands::loader_installer::install_neoforge,
            commands::loader_installer::get_fabric_versions,
            commands::loader_installer::get_forge_versions,
            commands::loader_installer::get_neoforge_versions,
            // Mods
            commands::mods::search_mods,
            commands::mods::install_mod,
            commands::mods::install_curseforge_mod,
            commands::mods::get_instance_mods,
            commands::mods::toggle_mod,
            commands::mods::remove_mod,
            commands::mods::list_mod_history,
            commands::mods::list_deleted_mods,
            commands::mods::restore_deleted_mod,
            commands::mods::permanently_delete_deleted_mod,
            commands::mods::permanently_delete_all_deleted_mods,
            commands::mods::undo_last_mod_action,
            commands::mods::set_instance_safe_mode,
            commands::mods::check_mod_updates,
            commands::mods::update_all_mods,
            commands::mods::list_update_snapshots,
            commands::mods::restore_update_snapshot,
            commands::mods::detect_mod_conflicts,
            commands::mods::check_mod_compatibility,
            commands::mods::check_instance_target_mod_compatibility,
            // Modrinth
            commands::modrinth::search_modrinth,
            commands::modrinth::get_modrinth_project,
            commands::modrinth::get_modrinth_versions,
            // CurseForge
            commands::curseforge::search_curseforge,
            commands::curseforge::get_bedrock_curseforge_taxonomy,
            commands::curseforge::get_curseforge_mod_files,
            commands::curseforge::get_curseforge_file_download_url,
            commands::curseforge::get_curseforge_mod,
            // Skins
            commands::skins::get_current_skin,
            commands::skins::lookup_public_skin,
            commands::skins::upload_skin,
            commands::skins::upload_skin_bytes,
            commands::skins::get_profile_textures,
            commands::skins::get_elyby_textures,
            commands::skins::get_profile_capes,
            commands::skins::set_active_cape,
            commands::skins::hide_active_cape,
            // Platform (Windows Developer Mode / Bedrock)
            commands::platform::get_developer_mode,
            commands::platform::open_developer_mode_settings,
            commands::platform::enable_developer_mode,
            commands::bedrock_content::install_bedrock_content,
            commands::bedrock_content::list_bedrock_content,
            commands::bedrock_content::remove_bedrock_content,
            commands::platform::list_bedrock_versions,
            commands::platform::launch_bedrock,
            // Audio
            commands::audio::list_audio_devices,
            // JVM
            commands::jvm::get_java_info,
            commands::jvm::detect_java_for_version,
            commands::jvm::download_java,
            commands::jvm::get_managed_java_versions,
            commands::jvm::download_java_zulu,
            commands::jvm::download_java_temurin,
            // Files
            commands::files::open_folder,
            commands::files::open_minecraft_folder,
            commands::files::get_minecraft_folder_path,
            commands::files::cache_player_face,
            commands::files::pick_local_modpack,
            commands::files::pick_local_files,
            commands::files::pick_java_executable,
            commands::files::read_file_bytes,
            commands::files::write_file_bytes,
            commands::files::open_url,
            commands::files::open_modrinth_servers_webview,
            commands::files::open_file_path,
            commands::files::reveal_file_path,
            // Meta cache
            commands::meta_cache::cache_cdn_file,
            commands::meta_cache::get_cached_cdn_file,
            commands::meta_cache::add_feed_item,
            commands::meta_cache::get_feed_items,
            commands::meta_cache::mark_feed_item_read,
            commands::meta_cache::clean_cdn_cache,
            commands::meta_cache::get_cache_stats,
            // Settings
            commands::settings::get_all,
            commands::settings::set_setting,
            commands::settings::save_all_settings,
            commands::settings::get_setting,
            commands::settings::should_show_snapshots,
            commands::settings::get_curseforge_api_key,
            commands::settings::get_relay_server_url,
            // Desktop shortcuts and direct instance launch
            commands::shortcuts::get_startup_launch_instance,
            commands::shortcuts::create_instance_shortcut,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

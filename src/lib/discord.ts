import { invoke } from '@tauri-apps/api/core';

/**
 * Инициализация Discord Rich Presence
 * Вызывать при старте приложения
 */
export async function initDiscord(): Promise<void> {
  try {
    await invoke('init_discord');
    console.log('[Discord] Rich Presence initialized');
  } catch (error) {
    console.warn('[Discord] Failed to initialize:', error);
  }
}

/**
 * Установка статуса лаунчера
 * @param page - текущая страница (Главная, Настройки, Сборки и т.д.)
 * @param details - дополнительные детали (опционально)
 */
export async function setLauncherStatus(
  page: string,
  details?: string
): Promise<void> {
  try {
    await invoke('set_launcher_status', { page, details });
  } catch (error) {
    console.warn('[Discord] Failed to set launcher status:', error);
  }
}

/**
 * Установка статуса игры
 * @param version - версия Minecraft
 * @param mode - режим игры ("solo" или "multiplayer")
 * @param serverName - название сервера (для multiplayer)
 * @param playersOnline - количество игроков онлайн
 * @param maxPlayers - максимальное количество игроков
 */
export async function setGameStatus(
  version: string,
  mode: string,
  serverName?: string,
  playersOnline?: number,
  maxPlayers?: number
): Promise<void> {
  try {
    await invoke('set_game_status', {
      version,
      mode,
      serverName,
      playersOnline,
      maxPlayers,
    });
  } catch (error) {
    console.warn('[Discord] Failed to set game status:', error);
  }
}

/**
 * Очистка статуса Discord
 */
export async function clearDiscordStatus(): Promise<void> {
  try {
    await invoke('clear_discord_status');
  } catch (error) {
    console.warn('[Discord] Failed to clear status:', error);
  }
}

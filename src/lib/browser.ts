import { WebviewWindow } from '@tauri-apps/api/webviewWindow';

/** Метка окна браузера: по ней же окно находится и фокусируется повторно. */
const BROWSER_LABEL = 'portal-browser';

/** Стартовая страница: полная страница DuckDuckGo со своим поиском. */
export const BROWSER_HOME = 'https://duckduckgo.com/';

/**
 * Открывает (или фокусирует уже открытое) окно встроенного браузера.
 *
 * Это отдельное окно вебвью Tauri, поэтому у него собственные cookie и
 * localStorage в каталоге данных приложения — история и авторизация
 * сохраняются между запусками. Внутри работает полная страница
 * DuckDuckGo со своей строкой поиска.
 */
export async function openBrowserWindow(): Promise<void> {
  const existing = await WebviewWindow.getByLabel(BROWSER_LABEL);
  if (existing) {
    await existing.show();
    await existing.setFocus();
    return;
  }

  new WebviewWindow(BROWSER_LABEL, {
    url: BROWSER_HOME,
    title: 'Браузер — DuckDuckGo',
    width: 1180,
    height: 820,
    minWidth: 480,
    minHeight: 400,
    center: true,
    resizable: true,
  });
}

/** Закрывает окно браузера, если оно открыто. */
export async function closeBrowserWindow(): Promise<void> {
  const existing = await WebviewWindow.getByLabel(BROWSER_LABEL);
  await existing.close();
}

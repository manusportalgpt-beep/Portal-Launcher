import { convertFileSrc } from '@/lib/invoke-shim';

/**
 * Instance icons are saved as a raw filesystem path by the Rust backend
 * (e.g. "C:\\Users\\...\\instances\\myinstance\\icon.png"). A plain
 * <img src="C:\...\icon.png"> never loads in the webview — Tauri needs the
 * path run through convertFileSrc() so it becomes an asset:// URL the
 * webview is actually allowed to fetch. Before this helper existed, every
 * instance-icon <img> just silently failed to render.
 *
 * Remote/data URLs (http, https, data:, blob:) are already loadable as-is
 * and are passed through unchanged.
 */
export function toIconSrc(path?: string | null): string | undefined {
  if (!path) return undefined;
  if (/^(https?:|data:|blob:|asset:)/i.test(path)) return path;
  try {
    return convertFileSrc(path);
  } catch {
    return undefined;
  }
}

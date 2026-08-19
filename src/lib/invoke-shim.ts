/**
 * Drop-in replacement for `@tauri-apps/api/core` `invoke`.
 *
 * Tauri v2 commands expect argument keys in **camelCase** by default
 * (a Rust arg `device_code: String` must be passed as `deviceCode` from JS,
 * unless the command uses `rename_all = "snake_case"` — ours don't).
 *
 * This shim converts TOP-LEVEL snake_case keys to camelCase so call sites can
 * use either style. Nested objects are left untouched, because nested payloads
 * are deserialized by serde with each struct's own field naming (usually
 * snake_case in this codebase).
 */
import { invoke as tauriInvoke } from '@tauri-apps/api/core';

function snakeToCamel(s: string): string {
  return s.replace(/_([a-z0-9])/g, (_, c: string) => c.toUpperCase());
}

export function invoke<T = unknown>(
  cmd: string,
  args?: Record<string, unknown>,
): Promise<T> {
  let normalized: Record<string, unknown> | undefined;
  if (args) {
    normalized = {};
    for (const [k, v] of Object.entries(args)) {
      normalized[k.includes('_') ? snakeToCamel(k) : k] = v;
    }
  }
  return tauriInvoke<T>(cmd, normalized);
}

// Re-export everything else from core untouched so this is a true drop-in.
export {
  convertFileSrc,
  transformCallback,
  Channel,
  PluginListener,
  addPluginListener,
  isTauri,
} from '@tauri-apps/api/core';

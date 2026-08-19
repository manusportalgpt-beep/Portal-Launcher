import { invoke } from '@/lib/invoke-shim';

export interface McVersionMeta {
  id: string;
  version_type: string;
  release_time?: string;
  installed?: boolean;
}

const MANIFEST = 'https://piston-meta.mojang.com/mc/game/version_manifest_v2.json';
const MANIFEST_FALLBACK = 'https://launchermeta.mojang.com/mc/game/version_manifest_v2.json';

/** Минимальный офлайн-резерв. Реальный список всегда берётся с CDN Mojang. */
export const MC_VERSIONS_FALLBACK = [
  '1.21.8', '1.21.7', '1.21.6', '1.21.5', '1.21.4', '1.21.3', '1.21.1', '1.21',
  '1.20.6', '1.20.4', '1.20.1', '1.19.4', '1.19.2', '1.18.2', '1.17.1',
  '1.16.5', '1.12.2', '1.8.9', '1.7.10',
];

let cache: McVersionMeta[] | null = null;

/** Все версии Minecraft из официального манифеста Mojang (release + old + snapshot). */
export async function fetchAllMcVersions(): Promise<McVersionMeta[]> {
  if (cache) return cache;

  // 1. Через Rust (учитывает зеркало CDN и отметку «установлено»)
  try {
    const list = await invoke<McVersionMeta[]>('get_available_versions', { includeSnapshots: true, include_snapshots: true });
    if (Array.isArray(list) && list.length > 0) {
      cache = list;
      return list;
    }
  } catch { /* нет Tauri или сети — идём напрямую */ }

  // 2. Напрямую с CDN Mojang
  for (const url of [MANIFEST, MANIFEST_FALLBACK]) {
    try {
      const res = await fetch(url);
      const json = await res.json();
      const list: McVersionMeta[] = (json.versions ?? []).map((v: any) => ({
        id: v.id,
        version_type: v.type,
        release_time: v.releaseTime,
      }));
      if (list.length > 0) {
        cache = list;
        return list;
      }
    } catch { /* пробуем следующее зеркало */ }
  }

  return MC_VERSIONS_FALLBACK.map(id => ({ id, version_type: 'release' }));
}

/** Список id версий с учётом настройки снапшотов. */
export async function fetchMcVersionIds(includeSnapshots = false): Promise<string[]> {
  const all = await fetchAllMcVersions();
  return all
    .filter(v =>
      includeSnapshots
        ? true
        : v.version_type === 'release' || v.version_type === 'old_beta' || v.version_type === 'old_alpha')
    .map(v => v.id);
}

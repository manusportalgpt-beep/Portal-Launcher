// These caches are written with a try/catch "optional cache" pattern, so when
// localStorage fills up they silently keep growing with no eviction. That leaves
// the ~5 MB quota exhausted, which then makes the next zustand persist write (e.g.
// portal-instances-v2) throw QuotaExceededError and crash the launcher to a gray
// screen. Prune them on startup to keep headroom for real persisted state.

const FIND_PROJECTS_MAX_AGE = 30 * 60_000;
const GATEWAY_MAX_AGE = 60 * 60_000;
const INSTANCE_MODS_MAX_AGE = 24 * 60 * 60_000;
const SMALL_CACHE_MAX_AGE = 7 * 24 * 60 * 60_000;

function isExpired(raw: string | null, maxAgeMs: number): boolean {
  if (!raw) return false;
  try {
    const entry = JSON.parse(raw);
    const savedAt = Number(entry?.savedAt ?? entry?.at ?? 0);
    return Number.isFinite(savedAt) && savedAt > 0 && Date.now() - savedAt > maxAgeMs;
  } catch {
    return false;
  }
}

export function pruneLocalStorageCaches() {
  try {
    const findProjects: string[] = [];
    const gateway: string[] = [];
    const instanceMods: string[] = [];
    const small: string[] = [];
    for (let i = 0; i < window.localStorage.length; i++) {
      const key = window.localStorage.key(i);
      if (!key) continue;
      if (key.startsWith('portal-find-projects-cache:v2:')) findProjects.push(key);
      else if (key.startsWith('portal-modrinth-gateway:v2:')) gateway.push(key);
      else if (key.startsWith('portal-instance-mods:v2:')) instanceMods.push(key);
      else if (key.startsWith('portal-project-meta:v1:')) small.push(key);
      else if (key.startsWith('portal-player-face-v1:')) small.push(key);
    }
    const drop = (keys: string[]) => {
      for (const key of keys) {
        try { window.localStorage.removeItem(key); } catch { /* ignore */ }
      }
    };
    drop(findProjects.filter(k => isExpired(window.localStorage.getItem(k), FIND_PROJECTS_MAX_AGE)));
    drop(gateway.filter(k => isExpired(window.localStorage.getItem(k), GATEWAY_MAX_AGE)));
    drop(instanceMods.filter(k => isExpired(window.localStorage.getItem(k), INSTANCE_MODS_MAX_AGE)));
    drop(small.filter(k => isExpired(window.localStorage.getItem(k), SMALL_CACHE_MAX_AGE)));
  } catch {
    // Pruning is best-effort; never let it break startup.
  }
}
import { useEffect, useState } from 'react';

// In-memory cache shared across every row that renders an author avatar,
// so the same username is only fetched once per session, no matter how
// many mod rows reference it.
const cache = new Map<string, string | null>();
const inflight = new Map<string, Promise<string | null>>();
const FETCH_TTL = 5 * 60 * 1000; // 5 minutes — retry after transient failures
const cacheTimestamps = new Map<string, number>();

async function fetchAvatar(username: string, source?: string): Promise<string | null> {
  // CurseForge: use crafatar as fallback (CurseForge authors have Minecraft usernames)
  if (source === 'curseforge') {
    // Try crafatar first (works for Minecraft usernames)
    return `https://crafatar.com/avatars/${encodeURIComponent(username)}?size=64&overlay`;
  }

  if (cache.has(username)) {
    const ts = cacheTimestamps.get(username) ?? 0;
    // Retry after TTL if the cached value is null (failed fetch)
    if (Date.now() - ts < FETCH_TTL || cache.get(username) !== null) {
      return cache.get(username)!;
    }
  }
  if (inflight.has(username)) return inflight.get(username)!;

  const p = (async () => {
    try {
      // Modrinth has no dedicated avatar-image endpoint — the real avatar
      // URL is a field on the user object itself.
      const res = await fetch(`https://api.modrinth.com/v2/user/${encodeURIComponent(username)}`, {
        headers: { 'User-Agent': 'PortalLauncher/1.2 (github.com/portal-launcher)' },
      });
      if (!res.ok) {
        // Fallback to crafatar for Modrinth users too (they have MC usernames)
        const fallback = `https://crafatar.com/avatars/${encodeURIComponent(username)}?size=64&overlay`;
        cache.set(username, fallback);
        cacheTimestamps.set(username, Date.now());
        return fallback;
      }
      const data = await res.json();
      const url = typeof data?.avatar_url === 'string' && data.avatar_url.length > 0
        ? data.avatar_url
        : `https://crafatar.com/avatars/${encodeURIComponent(username)}?size=64&overlay`;
      cache.set(username, url);
      cacheTimestamps.set(username, Date.now());
      return url;
    } catch {
      // Fallback to crafatar instead of caching null permanently
      const fallback = `https://crafatar.com/avatars/${encodeURIComponent(username)}?size=64&overlay`;
      cache.set(username, fallback);
      cacheTimestamps.set(username, Date.now());
      return fallback;
    } finally {
      inflight.delete(username);
    }
  })();

  inflight.set(username, p);
  return p;
}

/** Returns the author's real avatar URL, or a crafatar fallback, or null while loading. */
export function useAuthorAvatar(username: string | undefined, source: string | undefined): string | null {
  const [url, setUrl] = useState<string | null>(username ? cache.get(username) ?? null : null);

  useEffect(() => {
    if (!username) { setUrl(null); return; }
    let cancelled = false;
    fetchAvatar(username, source).then(u => { if (!cancelled) setUrl(u); });
    return () => { cancelled = true; };
  }, [username, source]);

  return url;
}

/** Clear the avatar cache (e.g. when the user changes network/proxy). */
export function clearAuthorAvatarCache() {
  cache.clear();
  cacheTimestamps.clear();
}

import { useEffect, useState } from 'react';

// In-memory cache shared across every row that renders an author avatar,
// so the same username is only fetched once per session, no matter how
// many mod rows reference it.
const cache = new Map<string, string | null>();
const inflight = new Map<string, Promise<string | null>>();
const FETCH_TTL = 5 * 60 * 1000; // 5 minutes — retry after transient failures
const cacheTimestamps = new Map<string, number>();

async function fetchAvatar(username: string, source?: string): Promise<string | null> {
  const cacheKey = `${source ?? 'unknown'}:${username}`;
  // CurseForge: use crafatar as fallback (CurseForge authors have Minecraft usernames)
  if (source === 'curseforge') {
    // CurseForge exposes an author id/name but usually no avatar URL. Use a
    // stable Minecraft-head provider instead of the often blocked Crafatar
    // endpoint, which rendered as a gray placeholder in the WebView.
    return `https://mc-heads.net/avatar/${encodeURIComponent(username)}/64.png`;
  }

  if (cache.has(cacheKey)) {
    const ts = cacheTimestamps.get(cacheKey) ?? 0;
    // Retry after TTL if the cached value is null (failed fetch)
    if (Date.now() - ts < FETCH_TTL || cache.get(cacheKey) !== null) {
      return cache.get(cacheKey)!;
    }
  }
  if (inflight.has(cacheKey)) return inflight.get(cacheKey)!;

  const p = (async () => {
    try {
      // Modrinth has no dedicated avatar-image endpoint — the real avatar
      // URL is a field on the user object itself.
      const res = await fetch(`https://api.modrinth.com/v2/user/${encodeURIComponent(username)}`, {
        headers: { 'User-Agent': 'PortalLauncher/1.2 (github.com/portal-launcher)' },
      });
      if (!res.ok) {
        // Fallback to crafatar for Modrinth users too (they have MC usernames)
        const fallback = `https://mc-heads.net/avatar/${encodeURIComponent(username)}/64.png`;
        cache.set(cacheKey, fallback);
        cacheTimestamps.set(cacheKey, Date.now());
        return fallback;
      }
      const data = await res.json();
      const url = typeof data?.avatar_url === 'string' && data.avatar_url.length > 0
        ? data.avatar_url
        : `https://mc-heads.net/avatar/${encodeURIComponent(username)}/64.png`;
      cache.set(cacheKey, url);
      cacheTimestamps.set(cacheKey, Date.now());
      return url;
    } catch {
      // Fallback to crafatar instead of caching null permanently
      const fallback = `https://mc-heads.net/avatar/${encodeURIComponent(username)}/64.png`;
      cache.set(cacheKey, fallback);
      cacheTimestamps.set(cacheKey, Date.now());
      return fallback;
    } finally {
      inflight.delete(cacheKey);
    }
  })();

  inflight.set(cacheKey, p);
  return p;
}

/** Returns the author's real avatar URL, or a crafatar fallback, or null while loading. */
export function useAuthorAvatar(username: string | undefined, source: string | undefined): string | null {
  const cacheKey = username ? `${source ?? 'unknown'}:${username}` : '';
  const [url, setUrl] = useState<string | null>(cacheKey ? cache.get(cacheKey) ?? null : null);

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

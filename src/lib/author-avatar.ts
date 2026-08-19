import { useEffect, useState } from 'react';

// In-memory cache shared across every row that renders an author avatar,
// so the same username is only fetched once per session, no matter how
// many mod rows reference it.
const cache = new Map<string, string | null>();
const inflight = new Map<string, Promise<string | null>>();

async function fetchAvatar(username: string): Promise<string | null> {
  if (cache.has(username)) return cache.get(username)!;
  if (inflight.has(username)) return inflight.get(username)!;

  const p = (async () => {
    try {
      // Modrinth has no dedicated avatar-image endpoint — the real avatar
      // URL is a field on the user object itself.
      const res = await fetch(`https://api.modrinth.com/v2/user/${encodeURIComponent(username)}`);
      if (!res.ok) { cache.set(username, null); return null; }
      const data = await res.json();
      const url = typeof data?.avatar_url === 'string' ? data.avatar_url : null;
      cache.set(username, url);
      return url;
    } catch {
      cache.set(username, null);
      return null;
    } finally {
      inflight.delete(username);
    }
  })();

  inflight.set(username, p);
  return p;
}

/** Returns the author's real Modrinth avatar URL, or null while loading/unavailable. */
export function useAuthorAvatar(username: string | undefined, source: string | undefined): string | null {
  const [url, setUrl] = useState<string | null>(username ? cache.get(username) ?? null : null);

  useEffect(() => {
    if (!username || source === 'curseforge') { setUrl(null); return; }
    let cancelled = false;
    fetchAvatar(username).then(u => { if (!cancelled) setUrl(u); });
    return () => { cancelled = true; };
  }, [username, source]);

  return url;
}

import { useEffect, useMemo, useState } from 'react';
import { getAvatarFallbackUrl, getAvatarUrl } from '@/lib/avatar';
import type { UserProfile } from '@/stores/authStore';
import { useAuthStore } from '@/stores/authStore';
import { invoke } from '@/lib/invoke-shim';
import { toIconSrc } from '@/lib/icon-src';

const CACHE_PREFIX = 'portal-player-face-v1:';

function accountKey(user: Pick<UserProfile, 'uuid' | 'username' | 'provider'>) {
  const provider = user.provider || 'offline';
  const identity = user.uuid || user.username;
  return `${CACHE_PREFIX}${provider}:${encodeURIComponent(identity)}`;
}

function readCached(key: string) {
  try { return localStorage.getItem(key) || ''; } catch { return ''; }
}

function saveCached(key: string, value: string) {
  try { localStorage.setItem(key, value); } catch {
    // Keep rendering the network image even when browser storage is full.
  }
}

async function toDataUrl(url: string) {
  const response = await fetch(url, { cache: 'no-cache' });
  if (!response.ok) throw new Error(`Face request failed: ${response.status}`);
  const blob = await response.blob();
  if (!blob.type.startsWith('image/')) throw new Error('Face response is not an image');
  return await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(reader.error || new Error('Face cache read failed'));
    reader.readAsDataURL(blob);
  });
}

export function CachedPlayerFace({
  user,
  className,
  style,
  alt = '',
}: {
  user: Pick<UserProfile, 'uuid' | 'username' | 'provider' | 'avatarUrl' | 'faceCacheRevision'> | null | undefined;
  className?: string;
  style?: React.CSSProperties;
  alt?: string;
}) {
  const updateAccount = useAuthStore(state => state.updateAccount);
  const source = useMemo(() => getAvatarUrl(user), [user?.uuid, user?.username, user?.provider, user?.avatarUrl, user?.faceCacheRevision]);
  const fallback = useMemo(() => getAvatarFallbackUrl(user), [user?.uuid, user?.username, user?.provider]);
  const key = useMemo(() => user ? accountKey(user) : '', [user?.uuid, user?.username, user?.provider]);
  const [cached, setCached] = useState(() => key ? readCached(key) : '');
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let active = true;
    setFailed(false);
    setCached(key ? readCached(key) : '');
    if (!key || !source) return () => { active = false; };
    const cacheLocalFace = async () => {
      if (/^https?:/i.test(source)) {
        try {
          const localPath = await invoke<string>('cache_player_face', { accountKey: key, sourceUrl: source });
          if (!active || !localPath) return;
          saveCached(key, localPath);
          setCached(localPath);
          if (user?.uuid && user.avatarUrl !== localPath) updateAccount(user.uuid, { avatarUrl: localPath });
          return;
        } catch { /* Preserve the existing WebView fallback below. */ }
      }
      const dataUrl = await toDataUrl(source);
      if (!active || !dataUrl) return;
      saveCached(key, dataUrl);
      setCached(dataUrl);
      if (user?.uuid && user.avatarUrl !== dataUrl) updateAccount(user.uuid, { avatarUrl: dataUrl });
    };
    void cacheLocalFace().catch(() => undefined);
    return () => { active = false; };
  }, [key, source]);

  const src = toIconSrc(cached || source || fallback);
  if (!src || failed) {
    return <span className={className} style={style}>{user?.username?.[0]?.toUpperCase() || '?'}</span>;
  }
  return <img src={src} alt={alt || user?.username || ''} className={className} style={{ imageRendering: 'pixelated', ...style }} onError={() => { if (src !== fallback && fallback) setCached(fallback); else setFailed(true); }} />;
}

export default CachedPlayerFace;

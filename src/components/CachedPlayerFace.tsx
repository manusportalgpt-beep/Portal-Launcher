import { useEffect, useMemo, useState } from 'react';
import { getAvatarFallbackUrl, getAvatarUrl } from '@/lib/avatar';
import type { UserProfile } from '@/stores/authStore';

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
  user: Pick<UserProfile, 'uuid' | 'username' | 'provider' | 'avatarUrl'> | null | undefined;
  className?: string;
  style?: React.CSSProperties;
  alt?: string;
}) {
  const source = useMemo(() => getAvatarUrl(user), [user?.uuid, user?.username, user?.provider, user?.avatarUrl]);
  const fallback = useMemo(() => getAvatarFallbackUrl(user), [user?.uuid, user?.username, user?.provider]);
  const key = useMemo(() => user ? accountKey(user) : '', [user?.uuid, user?.username, user?.provider]);
  const [cached, setCached] = useState(() => key ? readCached(key) : '');
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let active = true;
    setFailed(false);
    setCached(key ? readCached(key) : '');
    if (!key || !source) return () => { active = false; };
    void toDataUrl(source).then(dataUrl => {
      if (!active || !dataUrl) return;
      saveCached(key, dataUrl);
      setCached(dataUrl);
    }).catch(() => undefined);
    return () => { active = false; };
  }, [key, source]);

  const src = cached || source || fallback;
  if (!src || failed) {
    return <span className={className} style={style}>{user?.username?.[0]?.toUpperCase() || '?'}</span>;
  }
  return <img src={src} alt={alt || user?.username || ''} className={className} style={{ imageRendering: 'pixelated', ...style }} onError={() => { if (src !== fallback && fallback) setCached(fallback); else setFailed(true); }} />;
}

export default CachedPlayerFace;

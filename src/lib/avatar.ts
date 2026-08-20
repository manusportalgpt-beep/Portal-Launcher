import type { UserProfile } from '@/stores/authStore';
import { useUiStore } from '@/stores/uiStore';

/**
 * Возвращает источник аватара для учётной записи. Для Ely.by используем
 * документированный skin-system, который работает и для Ely-скинов, и для
 * проксируемых Premium-текстур; Microsoft продолжает использовать mc-heads.
 */
export function getAvatarUrl(
  user: Pick<UserProfile, 'uuid' | 'username' | 'provider' | 'avatarUrl' | 'faceCacheRevision'> | null | undefined,
): string | null {
  if (!user) return null;
  const provider = String(user.provider ?? '').toLowerCase();
  const isMicrosoft = provider === 'microsoft' || provider === 'msa' || provider === 'mojang';
  if (user.provider === 'elyby' && user.username) {
    return `https://skinsystem.ely.by/heads/${encodeURIComponent(user.username)}/64`;
  }
  if (isMicrosoft && user.uuid) {
    const style = useUiStore.getState().avatarStyle;
    const revision = user.faceCacheRevision ? `&portal-face=${user.faceCacheRevision}` : '';
    return style === 'face'
      ? `https://crafatar.com/avatars/${encodeURIComponent(user.uuid)}?size=64&overlay${revision}`
      : `https://crafatar.com/renders/head/${encodeURIComponent(user.uuid)}?scale=4&overlay${revision}`;
  }
  if (user.avatarUrl) return user.avatarUrl;
  if (user.uuid) {
    return `https://crafatar.com/avatars/${encodeURIComponent(user.uuid)}?size=64&overlay`;
  }
  return null;
}

export function getAvatarFallbackUrl(user: Pick<UserProfile, 'uuid' | 'username' | 'provider'> | null | undefined): string | null {
  if (!user) return null;
  if (user.provider === 'elyby' && user.username) return `https://visage.surgeplay.com/face/64/${encodeURIComponent(user.username)}`;
  if (!user.uuid) return null;
  return `https://visage.surgeplay.com/face/64/${encodeURIComponent(user.uuid)}`;
}

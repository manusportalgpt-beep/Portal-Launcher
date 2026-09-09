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
    // mc-heads.net стабильнее skinsystem.ely.by для иконок головы.
    return `https://mc-heads.net/avatar/${encodeURIComponent(user.username)}/64`;
  }
  if (isMicrosoft && user.uuid) {
    const style = useUiStore.getState().avatarStyle;
    // mc-heads.net стабильнее Crafatar (который часто отдаёт 403).
    if (style === 'face') {
      return `https://mc-heads.net/avatar/${encodeURIComponent(user.uuid)}/64`;
    }
    return `https://mc-heads.net/head/${encodeURIComponent(user.uuid)}/64`;
  }
  if (user.avatarUrl) return user.avatarUrl;
  if (user.uuid) {
    return `https://mc-heads.net/avatar/${encodeURIComponent(user.uuid)}/64`;
  }
  return null;
}

export function getAvatarFallbackUrl(user: Pick<UserProfile, 'uuid' | 'username' | 'provider'> | null | undefined): string | null {
  if (!user) return null;
  if (user.provider === 'elyby' && user.username) return `https://mc-heads.net/avatar/${encodeURIComponent(user.username)}/64`;
  if (!user.uuid) return null;
  return `https://mc-heads.net/avatar/${encodeURIComponent(user.uuid)}/64`;
}

import { useCallback, useEffect, useState } from 'react';
import { invoke } from '@/lib/invoke-shim';
import { listen } from '@tauri-apps/api/event';
import { useAuthStore } from '@/stores/authStore';

/**
 * Второй способ входа в Microsoft: OAuth 2.0 Authorization Code с PKCE.
 *
 * Отличие от основного способа (код подтверждения): браузер сразу открывает
 * страницу выбора аккаунта Microsoft, где виден уже залогиненный аккаунт —
 * вводить код вручную не нужно. Локальный callback-сервер на 127.0.0.1:5000
 * принимает код, после чего токены обмениваются на профиль Minecraft.
 *
 * Текущий основной способ не изменяется — он вызывается из рамки выбора.
 */
export function MicrosoftAuthBrowser({ onSuccess, onCancel }: {
  onSuccess?: () => void;
  onCancel?: () => void;
}) {
  const addAccount = useAuthStore(s => s.addAccount);
  const setLoading = useAuthStore(s => s.setLoading);
  const [status, setStatus] = useState<'idle' | 'waiting' | 'exchanging' | 'success' | 'error'>('idle');
  const [error, setError] = useState('');

  const finish = useCallback((profile: any) => {
    setStatus('success');
    addAccount({
      uuid: profile.uuid,
      username: profile.username,
      skinUrl: profile.skin_url ?? null,
      avatarUrl: `https://mc-heads.net/head/${profile.uuid}/64`,
      accessToken: profile.access_token ?? '',
      refreshToken: profile.refresh_token ?? '',
      tokenExpiry: Date.now() + (profile.expires_in ?? 86400) * 1000,
      isDemo: false,
      provider: 'microsoft',
    });
    void invoke('save_frontend_account', {
      uuid: profile.uuid,
      username: profile.username,
      skinUrl: profile.skin_url ?? null,
      accessToken: profile.access_token ?? '',
      refreshToken: profile.refresh_token ?? '',
      expiresAt: Math.floor(Date.now() / 1000) + (profile.expires_in ?? 86400),
      provider: 'microsoft',
    }).catch(() => undefined);
    setTimeout(() => onSuccess?.(), 900);
  }, [addAccount, onSuccess]);

  // Rust эмитит oauth-code-received, когда callback-сервер принял код.
  useEffect(() => {
    let disposed = false;
    let unlisten: (() => void) | undefined;

    void listen<any>('oauth-code-received', event => {
      if (disposed) return;
      const code = String(event.payload?.code ?? '');
      const codeVerifier = String(event.payload?.code_verifier ?? '');
      if (!code || !codeVerifier) return;
      setStatus('exchanging');
      void invoke<any>('exchange_code_for_token', { code, codeVerifier })
        .then(profile => {
          if (disposed) return;
          if (!profile) { setStatus('error'); setError('Microsoft не вернул профиль аккаунта.'); return; }
          finish(profile);
        })
        .catch(e => {
          if (disposed) return;
          setStatus('error');
          setError(String(e));
        });
    }).then(fn => { unlisten = fn; }).catch(() => undefined);

    return () => { disposed = true; unlisten?.(); };
  }, [finish]);

  const start = useCallback(async () => {
    setStatus('waiting');
    setError('');
    setLoading(true);
    try {
      await invoke('start_oauth_web_flow');
    } catch (e) {
      setLoading(false);
      setStatus('error');
      setError(String(e));
    }
  }, [setLoading]);

  useEffect(() => { if (status === 'success' || status === 'error') setLoading(false); }, [status, setLoading]);

  return (
    <div className="flex flex-col gap-3">
      <p className="text-xs leading-5" style={{ color: 'var(--color-text-secondary)' }}>
        Откроется браузер со страницей входа Microsoft — там можно выбрать уже
        залогиненный аккаунт. Код вводить не нужно: лаунчер сам примет ответ.
      </p>

      {status === 'idle' && (
        <button onClick={() => void start()} className="flex w-full items-center justify-center gap-2 rounded-lg px-4 py-2.5 text-sm font-bold"
          style={{ background: 'var(--color-primary)', color: 'var(--color-primary-text)' }}>
          Открыть выбор аккаунта Microsoft
        </button>
      )}

      {status === 'waiting' && (
        <div className="flex items-center gap-2 rounded-lg px-3 py-2.5 text-xs" style={{ background: 'var(--color-surface-2)', color: 'var(--color-text-secondary)' }}>
          <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-[var(--color-primary)] border-t-transparent" />
          Ждём выбора аккаунта в браузере…
        </div>
      )}

      {status === 'exchanging' && (
        <div className="flex items-center gap-2 rounded-lg px-3 py-2.5 text-xs" style={{ background: 'var(--color-surface-2)', color: 'var(--color-text-secondary)' }}>
          <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-[var(--color-primary)] border-t-transparent" />
          Получаем профиль Minecraft…
        </div>
      )}

      {status === 'success' && (
        <div className="rounded-lg px-3 py-2.5 text-xs font-bold" style={{ background: 'var(--color-surface-2)', color: 'var(--color-success)' }}>
          Готово — аккаунт добавлен.
        </div>
      )}

      {status === 'error' && (
        <div className="rounded-lg px-3 py-2.5 text-xs" style={{ background: 'var(--color-surface-2)', color: 'var(--color-error)' }}>
          Не удалось войти: {error}
        </div>
      )}

      {status !== 'success' && (
        <button onClick={onCancel} className="self-center text-xs font-semibold" style={{ color: 'var(--color-text-tertiary)' }}>
          Назад к выбору способа
        </button>
      )}
    </div>
  );
}

export default MicrosoftAuthBrowser;

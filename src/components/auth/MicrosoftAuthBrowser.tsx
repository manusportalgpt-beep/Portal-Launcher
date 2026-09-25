import { useCallback, useEffect, useMemo, useState } from 'react';
import { invoke } from '@/lib/invoke-shim';
import { listen } from '@tauri-apps/api/event';
import { useAuthStore } from '@/stores/authStore';
import { safeLocalStorage } from '@/lib/safe-storage';

/**
 * Второй способ входа в Microsoft: OAuth 2.0 Authorization Code с PKCE.
 *
 * Отличие от основного способа (код подтверждения): браузер сразу открывает
 * страницу выбора аккаунта Microsoft, где виден уже залогиненный аккаунт —
 * вводить код вручную не нужно. Локальный callback-сервер принимает код,
 * после чего токены обмениваются на профиль Minecraft.
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

  // Client ID и redirect URI можно задать вручную: если в Azure приложение
  // зарегистрировано с другим redirect URI, вход иначе не пройдёт.
  const [showSetup, setShowSetup] = useState(false);
  const [clientId, setClientId] = useState('');
  const [redirectUri, setRedirectUri] = useState('http://localhost:5000');

  // safeLocalStorage — асинхронная обёртка, поэтому читаем через effect.
  useEffect(() => {
    let alive = true;
    void (async () => {
      const [savedClient, savedRedirect] = await Promise.all([
        safeLocalStorage().getItem('portal.msOAuthClientId'),
        safeLocalStorage().getItem('portal.msOAuthRedirectUri'),
      ]);
      if (!alive) return;
      if (typeof savedClient === 'string') setClientId(savedClient);
      if (typeof savedRedirect === 'string' && savedRedirect) setRedirectUri(savedRedirect);
    })();
    return () => { alive = false; };
  }, []);

  const credentials = useMemo(
    () => ({ clientId: clientId.trim(), redirectUri: redirectUri.trim() }),
    [clientId, redirectUri],
  );

  const saveCredentials = useCallback(() => {
    if (credentials.clientId) void safeLocalStorage().setItem('portal.msOAuthClientId', credentials.clientId);
    if (credentials.redirectUri) void safeLocalStorage().setItem('portal.msOAuthRedirectUri', credentials.redirectUri);
  }, [credentials]);

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
      void invoke<any>('exchange_code_for_token', {
        code,
        codeVerifier,
        clientId: credentials.clientId || null,
        redirectUri: credentials.redirectUri || null,
      })
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
  }, [finish, credentials]);

  const start = useCallback(async () => {
    setStatus('waiting');
    setError('');
    setLoading(true);
    saveCredentials();
    try {
      await invoke('start_oauth_web_flow', {
        clientId: credentials.clientId || null,
        redirectUri: credentials.redirectUri || null,
      });
    } catch (e) {
      setLoading(false);
      setStatus('error');
      setError(String(e));
    }
  }, [setLoading, credentials, saveCredentials]);

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
        <div className="flex flex-col gap-2">
          <button onClick={() => setShowSetup(v => !v)} className="self-start text-[11px] font-semibold"
            style={{ color: 'var(--color-text-tertiary)' }}>
            {showSetup ? 'Скрыть настройку Azure' : 'Ошибка входа? Задать Client ID и Redirect URI'}
          </button>

          {showSetup && (
            <div className="flex flex-col gap-2 rounded-lg p-2.5"
              style={{ background: 'var(--color-surface-2)', border: '1px solid var(--color-border)' }}>
              <p className="text-[10px] leading-4" style={{ color: 'var(--color-text-tertiary)' }}>
                В Azure Portal → «Регистрация приложений» → ваше приложение → «Аутентификация» добавьте
                тип «Общедоступный клиент (мобильные и настольные приложения)» с URI вида{' '}
                <code className="font-mono">http://localhost:5000</code>. Значение отсюда должно совпадать
                с тем, что указано в Azure. Поля можно оставить пустыми, чтобы использовать встроенный Client ID.
              </p>
              <label className="flex flex-col gap-1">
                <span className="text-[10px] font-bold" style={{ color: 'var(--color-text-secondary)' }}>Client ID (Application client ID)</span>
                <input value={clientId} onChange={e => setClientId(e.target.value)} placeholder="не задан — используется встроенный"
                  className="rounded px-2 py-1.5 font-mono text-[11px] outline-none"
                  style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', color: 'var(--color-text)' }} />
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-[10px] font-bold" style={{ color: 'var(--color-text-secondary)' }}>Redirect URI</span>
                <input value={redirectUri} onChange={e => setRedirectUri(e.target.value)} placeholder="http://localhost:5000"
                  className="rounded px-2 py-1.5 font-mono text-[11px] outline-none"
                  style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', color: 'var(--color-text)' }} />
              </label>
              <p className="text-[10px] leading-4" style={{ color: 'var(--color-text-tertiary)' }}>
                Значения сохраняются на этом компьютере. Порт из Redirect URI используется для локального
                приёма ответа — можно выбрать любой свободный от 1024.
              </p>
            </div>
          )}

          <button onClick={onCancel} className="self-center text-xs font-semibold" style={{ color: 'var(--color-text-tertiary)' }}>
            Назад к выбору способа
          </button>
        </div>
      )}
    </div>
  );
}

export default MicrosoftAuthBrowser;

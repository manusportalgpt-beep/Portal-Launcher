import { invoke } from '@/lib/invoke-shim';
import { useState, useCallback, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Check, ExternalLink, X, Shield, Loader2, Copy, Shirt } from 'lucide-react';
import { useAuthStore } from '@/stores/authStore';

function MicrosoftMark({ className = '' }: { className?: string }) {
  return <span aria-hidden="true" className={`grid grid-cols-2 gap-[2px] ${className}`}><i className="block bg-current" /><i className="block bg-current" /><i className="block bg-current" /><i className="block bg-current" /></span>;
}

function ElybyMark({ className = '' }: { className?: string }) {
  return <span aria-hidden="true" className={`grid place-items-center border text-[10px] font-black leading-none ${className}`} style={{ borderColor: 'currentColor' }}>E</span>;
}

export function MicrosoftAuthOAuth({ onSuccess, onCancel, preview = false }: {
  onSuccess?: () => void;
  onCancel?: () => void;
  preview?: boolean;
}) {
  const { addAccount, setLoading } = useAuthStore();
  const [step, setStep] = useState<'idle' | 'enter_code' | 'polling' | 'success' | 'error' | 'offline_form' | 'elyby_form' | 'nickname_form'>('idle');
  const [errorMsg, setErrorMsg] = useState('');
  const [userCode, setUserCode] = useState('');
  const [verificationUri, setVerificationUri] = useState('');
  const [countdown, setCountdown] = useState(0);
  const [pollAttempts, setPollAttempts] = useState(0);
  const [offlineName, setOfflineName] = useState('');
  const [elybyUser, setElybyUser] = useState('');
  const [elybyPass, setElybyPass] = useState('');
  const [nickname, setNickname] = useState('');
  const [altBusy, setAltBusy] = useState(false);

  const blockPreview = useCallback(() => {
    setErrorMsg('Это предпросмотр');
    setStep('error');
  }, []);

  const addProfile = useCallback((profile: any, provider: 'elyby' | 'offline' | 'nickname') => {
    addAccount({
      uuid: profile.uuid,
      username: profile.username,
      skinUrl: profile.skin_url,
      avatarUrl: provider === 'elyby'
        ? `https://skinsystem.ely.by/skins/${encodeURIComponent(profile.username)}.png`
        : `https://mc-heads.net/head/${profile.uuid}/64`,
      accessToken: profile.access_token,
      refreshToken: profile.refresh_token,
      tokenExpiry: Date.now() + (profile.expires_in ?? 86400) * 1000,
      isDemo: provider !== 'elyby' && !profile.access_token,
      provider,
    });
    setStep('success');
    setTimeout(() => onSuccess?.(), 1000);
  }, [addAccount, onSuccess]);

  const doOfflineLogin = useCallback(async () => {
    if (preview) { blockPreview(); return; }
    if (!offlineName.trim()) return;
    setAltBusy(true); setErrorMsg('');
    try {
      const profile = await invoke<any>('login_offline', { username: offlineName.trim() });
      addProfile(profile, 'offline');
    } catch (e: any) {
      setErrorMsg(e?.message || (typeof e === 'string' ? e : String(e)));
      setStep('error');
    } finally { setAltBusy(false); }
  }, [offlineName, addProfile, blockPreview, preview]);

  const doElybyLogin = useCallback(async () => {
    if (preview) { blockPreview(); return; }
    if (!elybyUser.trim() || !elybyPass) return;
    setAltBusy(true); setErrorMsg('');
    try {
      const profile = await invoke<any>('login_elyby', { username: elybyUser.trim(), password: elybyPass });
      await invoke('save_frontend_account', {
        uuid: profile.uuid,
        username: profile.username,
        skinUrl: profile.skin_url ?? `https://skinsystem.ely.by/skins/${encodeURIComponent(profile.username)}.png`,
        accessToken: profile.access_token,
        refreshToken: profile.refresh_token,
        expiresAt: Math.floor(Date.now() / 1000) + (profile.expires_in ?? 86400),
        provider: 'elyby',
      });
      addProfile(profile, 'elyby');
    } catch (e: any) {
      setErrorMsg(e?.message || (typeof e === 'string' ? e : String(e)));
      setStep('error');
    } finally { setAltBusy(false); }
  }, [elybyUser, elybyPass, addProfile, blockPreview, preview]);

  const doNicknameLogin = useCallback(async () => {
    if (preview) { blockPreview(); return; }
    const username = nickname.trim();
    if (!username) return;
    setAltBusy(true); setErrorMsg('');
    try {
      const skin = await invoke<any>('lookup_public_skin', { username });
      await invoke('save_frontend_account', {
        uuid: skin.uuid,
        username: skin.name,
        skinUrl: skin.skin_url ?? null,
        accessToken: '',
        refreshToken: '',
        expiresAt: 0,
        provider: 'nickname',
      });
      addProfile({
        uuid: skin.uuid,
        username: skin.name,
        skin_url: skin.skin_url,
        access_token: '',
        refresh_token: '',
        expires_in: 0,
      }, 'nickname');
    } catch (e: any) {
      setErrorMsg(e?.message || (typeof e === 'string' ? e : String(e)));
      setStep('error');
    } finally { setAltBusy(false); }
  }, [nickname, addProfile, blockPreview, preview]);

  // Start Device Code Flow
  const startOAuthFlow = useCallback(async () => {
    if (preview) { blockPreview(); return; }
    setLoading(true);
    setStep('enter_code');
    setErrorMsg('');
    
    try {
      console.log('[MicrosoftAuthOAuth] 🔐 Starting Device Code Flow...');
      
      const response = await invoke<any>('start_device_code_flow');
      
      setUserCode(response.user_code);
      setVerificationUri(response.verification_uri);
      // expires_in приходит в СЕКУНДАХ (обычно 900). Таймер ниже тикает раз в
      // секунду, поэтому храним оставшееся время тоже в секундах — иначе окно
      // «истекает» через ~15 секунд и вход не успевает завершиться.
      setCountdown(response.expires_in ?? 900);
      
      console.log('[MicrosoftAuthOAuth] ✅ Device code received:', response.user_code);
      
      // Start polling
      pollForToken(response.device_code, response.interval, response.expires_in);
      
    } catch (e: any) {
      console.log('[MicrosoftAuthOAuth] ❌ Failed to start OAuth flow:', e);
      setStep('error');
      setErrorMsg(e?.message || String(e) || 'Failed to start authentication');
      setLoading(false);
    }
  }, [setLoading, blockPreview, preview]);

  // Poll for token
  const pollForToken = async (deviceCode: string, interval: number, expiresIn: number) => {
    let attempts = 0;
    const maxAttempts = Math.floor(expiresIn / (interval || 5));
    let pollingActive = true;
    
    const poll = async () => {
      if (!pollingActive) return;
      
      attempts++;
      setPollAttempts(attempts);
      console.log(`[MicrosoftAuthOAuth] 🔄 Poll attempt ${attempts}/${maxAttempts}`);
      
      try {
        const profile = await invoke<any>('poll_for_token', { device_code: deviceCode });
        
        if (profile) {
          console.log('[MicrosoftAuthOAuth] ✅ Authentication successful!');
          pollingActive = false;
          
          // Add account to store
          addAccount({
            uuid: profile.uuid,
            username: profile.username,
            skinUrl: profile.skin_url,
            avatarUrl: `https://mc-heads.net/head/${profile.uuid}/64`,
            accessToken: profile.access_token,
            refreshToken: profile.refresh_token,
            tokenExpiry: Date.now() + (profile.expires_in ?? 86400) * 1000,
            provider: 'microsoft',
          });
          invoke('save_frontend_account', {
            uuid: profile.uuid,
            username: profile.username,
            skinUrl: profile.skin_url ?? null,
            accessToken: profile.access_token,
            refreshToken: profile.refresh_token,
            expiresAt: Math.floor(Date.now() / 1000) + (profile.expires_in ?? 86400),
            provider: 'microsoft',
          }).catch(() => {});
          
          setStep('success');
          setLoading(false);
          setTimeout(() => onSuccess?.(), 1500);
          return;
        }
          
        // Continue polling
        if (attempts < maxAttempts) {
          console.log(`[MicrosoftAuthOAuth] ⏳ Waiting for user authorization... (${attempts}/${maxAttempts})`);
          setTimeout(poll, (interval || 5) * 1000);
        } else {
          throw new Error('Authentication timed out. Please try again.');
        }
        
      } catch (err: any) {
        if (!pollingActive) return;
        console.log('[MicrosoftAuthOAuth] ❌ Poll error:', err);
        setStep('error');
        setErrorMsg(err?.message || (typeof err === 'string' ? err : String(err)) || 'Authentication failed');
        setLoading(false);
      }
    };
    
    // Start polling immediately
    poll();
  };

  // Countdown timer
  useEffect(() => {
    if (step !== 'enter_code' || countdown <= 0) return;
    
    const timer = setInterval(() => {
      setCountdown(prev => {
        if (prev <= 1) {
          clearInterval(timer);
          setStep('error');
          setErrorMsg('Authentication expired. Please try again.');
          setLoading(false);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
    
    return () => clearInterval(timer);
  }, [step, countdown, setLoading]);

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  const copyUserCode = () => {
    navigator.clipboard.writeText(userCode);
    console.log('[MicrosoftAuthOAuth] 📋 User code copied to clipboard');
  };

  return (
    <div className="flex flex-col items-center text-center w-full">
      <AnimatePresence mode="wait">

        {/* IDLE: Start button */}
        {step === 'idle' && (
          <motion.div
            key="idle"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            className="flex flex-col items-center gap-4 w-full"
          >
            <div className="w-12 h-12 flex items-center justify-center"
              style={{ background: 'transparent', border:'1px solid var(--color-border)', borderRadius:2, color:'var(--color-text)' }}>
              <MicrosoftMark className="h-5 w-5" />
            </div>
            <div>
              <p className="font-bold text-base" style={{ color: 'var(--color-text)' }}>
                Войти в аккаунт
              </p>
              <p className="text-sm mt-1" style={{ color: 'var(--color-text-secondary)' }}>
                Используйте Microsoft аккаунт для лицензионного Minecraft
              </p>
            </div>
            <button
              onClick={startOAuthFlow}
              className="w-full py-3 font-semibold text-sm flex items-center justify-center gap-2"
              style={{ background: 'var(--color-surface)', color: 'var(--color-text)', border:'1px solid var(--color-border)', borderRadius:2 }}
            >
              <MicrosoftMark className="h-4 w-4" />
              Войти через Microsoft
            </button>
            <button
              onClick={() => preview ? blockPreview() : setStep('elyby_form')}
              className="w-full py-3 font-semibold text-sm flex items-center justify-center gap-2"
              style={{ background: 'var(--color-surface)', color: 'var(--color-text)', border: '1px solid var(--color-border)', borderRadius:2 }}
            >
              <ElybyMark className="h-4 w-4" />
              Войти через Ely.by
            </button>
            <button
              onClick={() => preview ? blockPreview() : setStep('nickname_form')}
              className="w-full py-3 font-semibold text-sm flex items-center justify-center gap-2"
              style={{ background: 'var(--color-surface)', color: 'var(--color-text)', border: '1px solid var(--color-border)', borderRadius:2 }}
            >
              <Shirt className="h-4 w-4" />
              Войти по нику
            </button>
            {!navigator.onLine && (
              <>
                <p className="text-xs text-center" style={{ color: 'var(--color-warning)' }}>
                  Нет подключения к интернету — доступен только оффлайн-вход.
                </p>
                <button
                  onClick={() => setStep('offline_form')}
                  className="w-full py-3 font-semibold text-sm flex items-center justify-center gap-2"
                  style={{ background: 'var(--color-surface)', color: 'var(--color-text)', border: '1px solid var(--color-border)', borderRadius:2 }}
                >
                  Войти оффлайн (по нику)
                </button>
              </>
            )}
            {onCancel && (
              <button onClick={onCancel} className="text-sm" style={{ color: 'var(--color-text-tertiary)' }}>
                Отмена
              </button>
            )}
          </motion.div>
        )}

        {/* OFFLINE: nickname-only login */}
        {step === 'offline_form' && (
          <motion.div key="offline_form" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }}
            className="flex flex-col items-center gap-4 w-full">
            <div>
              <p className="font-bold text-base text-center" style={{ color: 'var(--color-text)' }}>Оффлайн-вход</p>
              <p className="text-sm mt-1 text-center" style={{ color: 'var(--color-text-secondary)' }}>
                Только для одиночной игры и серверов с online-mode=false — без реального Minecraft-аккаунта.
              </p>
            </div>
            <input autoFocus value={offlineName} onChange={e => setOfflineName(e.target.value.replace(/[^a-zA-Z0-9_]/g,''))}
              placeholder="Ник (до 16 символов)" maxLength={16}
              onKeyDown={e => e.key === 'Enter' && doOfflineLogin()}
              className="w-full px-3 py-2.5 rounded-xl text-sm text-center font-semibold"
              style={{ background: 'var(--color-surface-2)', border: '1px solid var(--color-border)', color: 'var(--color-text)' }} />
            <button onClick={doOfflineLogin} disabled={altBusy || !offlineName.trim()}
              className="w-full py-3 rounded-xl font-semibold text-sm disabled:opacity-50"
              style={{ background: 'var(--color-surface)', color: 'var(--color-text)', border:'1px solid var(--color-border)', borderRadius:2 }}>
              {altBusy ? 'Вход...' : 'Войти'}
            </button>
            <button onClick={() => setStep('idle')} className="text-sm" style={{ color: 'var(--color-text-tertiary)' }}>Назад</button>
          </motion.div>
        )}

        {/* NICKNAME: public Mojang profile lookup, with no account token and no skin-write permission. */}
        {step === 'nickname_form' && (
          <motion.div key="nickname_form" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }}
            className="flex flex-col items-center gap-4 w-full">
            <div className="w-10 h-10 flex items-center justify-center" style={{ background:'transparent', border:'1px solid var(--color-border)', borderRadius:2 }}><Shirt className="w-5 h-5" /></div>
            <div>
              <p className="font-bold text-base text-center" style={{ color:'var(--color-text)' }}>Вход по нику</p>
              <p className="text-sm mt-1 text-center" style={{ color:'var(--color-text-secondary)' }}>Подгружает существующий публичный скин. Редактирование скина и Bedrock Edition требуют Microsoft-лицензию.</p>
            </div>
            <input autoFocus value={nickname} onChange={event => setNickname(event.target.value.replace(/[^a-zA-Z0-9_]/g, ''))}
              placeholder="Ник Minecraft (до 16 символов)" maxLength={16} onKeyDown={event => event.key === 'Enter' && doNicknameLogin()}
              className="w-full px-3 py-2.5 rounded-sm text-sm text-center font-semibold"
              style={{ background:'var(--color-surface-2)', border:'1px solid var(--color-border)', color:'var(--color-text)' }} />
            <button onClick={doNicknameLogin} disabled={altBusy || !nickname.trim()} className="w-full py-3 rounded-sm font-semibold text-sm disabled:opacity-50"
              style={{ background:'var(--color-surface)', color:'var(--color-text)', border:'1px solid var(--color-border)' }}>{altBusy ? 'Загружаю скин...' : 'Продолжить'}</button>
            <button onClick={() => setStep('idle')} className="text-sm" style={{ color:'var(--color-text-tertiary)' }}>Назад</button>
          </motion.div>
        )}

        {/* ELY.BY login form */}
        {step === 'elyby_form' && (
          <motion.div key="elyby_form" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }}
            className="flex flex-col items-center gap-3 w-full">
            <div>
              <p className="font-bold text-base text-center" style={{ color: 'var(--color-text)' }}>Вход через Ely.by</p>
              <p className="text-sm mt-1 text-center" style={{ color: 'var(--color-text-secondary)' }}>
                Работает на серверах, настроенных под Ely.by.
              </p>
            </div>
            <input autoFocus value={elybyUser} onChange={e => setElybyUser(e.target.value)} placeholder="Логин или email"
              className="w-full px-3 py-2.5 rounded-xl text-sm"
              style={{ background: 'var(--color-surface-2)', border: '1px solid var(--color-border)', color: 'var(--color-text)' }} />
            <input value={elybyPass} onChange={e => setElybyPass(e.target.value)} type="password" placeholder="Пароль"
              onKeyDown={e => e.key === 'Enter' && doElybyLogin()}
              className="w-full px-3 py-2.5 rounded-xl text-sm"
              style={{ background: 'var(--color-surface-2)', border: '1px solid var(--color-border)', color: 'var(--color-text)' }} />
            <button onClick={doElybyLogin} disabled={altBusy || !elybyUser.trim() || !elybyPass}
              className="w-full py-3 rounded-xl font-semibold text-sm disabled:opacity-50"
              style={{ background: 'var(--color-surface)', color: 'var(--color-text)', border:'1px solid var(--color-border)', borderRadius:2 }}>
              {altBusy ? 'Вход...' : 'Войти'}
            </button>
            <button onClick={() => setStep('idle')} className="text-sm" style={{ color: 'var(--color-text-tertiary)' }}>Назад</button>
          </motion.div>
        )}

        {/* ENTER_CODE: Show user code and verification URI */}
        {step === 'enter_code' && (
          <motion.div
            key="enter_code"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            className="flex flex-col items-center gap-5 w-full"
          >
            <div className="w-16 h-16 rounded-full flex items-center justify-center"
              style={{ background: 'rgba(0, 120, 212, 0.15)' }}>
              <Loader2 className="w-8 h-8 animate-spin" style={{ color: 'var(--color-primary)' }} />
            </div>
            <div>
              <p className="font-bold text-base" style={{ color: 'var(--color-text)' }}>
                Авторизация...
              </p>
              <p className="text-sm mt-1" style={{ color: 'var(--color-text-secondary)' }}>
                Откройте браузер и войдите в Microsoft аккаунт
              </p>
            </div>
            
            {/* Timer */}
            <div className="text-xs font-mono px-3 py-1 rounded-lg"
              style={{ background: 'var(--color-surface-2)', color: 'var(--color-text-secondary)' }}>
              Осталось времени: {formatTime(countdown)}
            </div>

            {/* User Code */}
            <div className="w-full p-4 rounded-xl text-left"
              style={{ background: 'var(--color-surface-2)', border: '1px solid var(--color-border)' }}>
              <p className="text-xs font-bold uppercase tracking-widest mb-2" style={{ color: 'var(--color-text-tertiary)' }}>
                Шаг 1 — Скопируйте код
              </p>
              <div className="flex items-center gap-2">
                <code className="flex-1 text-lg font-mono font-bold tracking-widest"
                  style={{ color: 'var(--color-text)' }}>
                  {userCode}
                </code>
                <button onClick={copyUserCode}
                  className="p-2 rounded-lg hover:bg-white/5 transition-colors"
                  style={{ color: 'var(--color-text-secondary)' }}>
                  <Copy className="w-4 h-4" />
                </button>
              </div>
            </div>

            {/* Verification URI */}
            <div className="w-full p-4 rounded-xl text-left"
              style={{ background: 'var(--color-surface-2)', border: '1px solid var(--color-border)' }}>
              <p className="text-xs font-bold uppercase tracking-widest mb-2" style={{ color: 'var(--color-text-tertiary)' }}>
                Шаг 2 — Перейдите на сайт
              </p>
              <p className="text-xs mb-2" style={{ color: 'var(--color-text-secondary)' }}>
                Откройте эту ссылку и введите код:
              </p>
              <a href={verificationUri} target="_blank" rel="noopener noreferrer"
                className="text-xs font-mono break-all block mb-2"
                style={{ color: 'var(--color-primary)' }}>
                {verificationUri}
              </a>
              <button onClick={() => invoke('open_url', { url: verificationUri })}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold w-full"
                style={{ background: 'var(--color-surface)', color: 'var(--color-text)', border:'1px solid var(--color-border)', borderRadius:2 }}>
                <ExternalLink className="w-3 h-3" />
                Открыть в браузере
              </button>
            </div>

            <div className="flex items-center gap-3 py-2">
              <span className="w-5 h-5 border-2 border-t-transparent rounded-full animate-spin"
                style={{ borderColor: 'var(--color-primary)', borderTopColor: 'transparent' }} />
              <p className="text-sm" style={{ color: 'var(--color-text-secondary)' }}>
                Ожидание подтверждения...
              </p>
            </div>
            
            {pollAttempts > 0 && (
              <div className="text-xs font-mono px-3 py-1 rounded-lg"
                style={{ background: 'var(--color-surface-2)', color: 'var(--color-text-secondary)' }}>
                Попыток: {pollAttempts}
              </div>
            )}
            <button
              onClick={() => { setStep('idle'); setErrorMsg(''); }}
              className="text-xs flex items-center gap-1 hover:opacity-80"
              style={{ color: 'var(--color-text-tertiary)' }}
            >
              Отменить
            </button>
          </motion.div>
        )}

        {/* SUCCESS: Show success message */}
        {step === 'success' && (
          <motion.div
            key="success"
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0 }}
            className="flex flex-col items-center gap-4"
          >
            <div className="w-16 h-16 rounded-full flex items-center justify-center"
              style={{ background: 'rgba(46, 204, 113, 0.15)', border: '2px solid var(--color-success)' }}>
              <Check className="w-8 h-8" style={{ color: 'var(--color-success)' }} />
            </div>
            <div>
              <p className="font-bold text-base" style={{ color: 'var(--color-text)' }}>
                Вход выполнен!
              </p>
              <p className="text-sm mt-1" style={{ color: 'var(--color-text-secondary)' }}>
                Добро пожаловать в Portal Launcher
              </p>
            </div>
          </motion.div>
        )}

        {/* ERROR: Show error message */}
        {step === 'error' && (
          <motion.div
            key="error"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            className="flex flex-col items-center gap-4 w-full"
          >
            <div className="w-16 h-16 rounded-full flex items-center justify-center"
              style={{ background: 'rgba(231, 76, 60, 0.1)', border: '2px solid var(--color-error)' }}>
              <X className="w-8 h-8" style={{ color: 'var(--color-error)' }} />
            </div>
            <div className="w-full">
              <p className="font-bold" style={{ color: 'var(--color-text)' }}>
                Ошибка входа
              </p>
              <p className="text-sm mt-2 p-3 rounded-xl text-left"
                style={{ color: 'var(--color-text-secondary)', background: 'var(--color-surface-2)', border: '1px solid var(--color-border)' }}>
                {errorMsg}
              </p>
            </div>
            <div className="flex gap-2 w-full">
              <button
                onClick={() => { setStep('idle'); setErrorMsg(''); }}
                className="flex-1 py-2.5 rounded-xl text-sm font-semibold"
                style={{ background: 'var(--color-surface)', color: 'var(--color-text)', border:'1px solid var(--color-border)', borderRadius:2 }}
              >
                Попробовать снова
              </button>
              {onCancel && (
                <button
                  onClick={onCancel}
                  className="flex-1 py-2.5 rounded-xl text-sm font-semibold"
                  style={{ background: 'var(--color-surface-2)', color: 'var(--color-text-secondary)', border: '1px solid var(--color-border)' }}
                >
                  Отмена
                </button>
              )}
            </div>
          </motion.div>
        )}

      </AnimatePresence>
    </div>
  );
}

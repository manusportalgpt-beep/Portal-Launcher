import { invoke } from '@/lib/invoke-shim';
import { open as shellOpen } from '@tauri-apps/plugin-shell';
import { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Check, Copy, RefreshCw, ExternalLink, X, Shield, UserCircle } from 'lucide-react';
import { useAuthStore } from '@/stores/authStore';
import { tauriAuth } from '@/lib/tauri-bridge';

export function MicrosoftAuth({ onSuccess, onCancel }: {
  onSuccess?: () => void;
  onCancel?: () => void;
}) {
  const { setDeviceCode, clearDeviceCode, addAccount, setLoading } = useAuthStore();
  const [step, setStep] = useState<'idle' | 'code' | 'waiting' | 'success' | 'error' | 'offline'>('idle');
  const [userCode, setUserCode] = useState('');
  const [verUri, setVerUri] = useState('');
  const [deviceCodeVal, setDCode] = useState('');
  const [copied, setCopied] = useState(false);
  const [expiresAt, setExpiresAt] = useState(0);
  const [timeLeft, setTimeLeft] = useState(0);
  const [errorMsg, setErrorMsg] = useState('');
  const [pollInterval, setPollInterval] = useState<ReturnType<typeof setInterval> | null>(null);
  // Offline mode state
  const [offlineNick, setOfflineNick] = useState('');
  const [offlineError, setOfflineError] = useState('');

  // Countdown timer
  useEffect(() => {
    if (step !== 'code' && step !== 'waiting') return;
    const iv = setInterval(() => {
      const left = Math.max(0, Math.floor((expiresAt - Date.now()) / 1000));
      setTimeLeft(left);
      if (left === 0) {
        clearInterval(iv);
        // Останавливаем и опрос токена — код больше не действителен
        setPollInterval(prev => { if (prev) clearInterval(prev); return null; });
        setStep('error');
        setErrorMsg('Код истёк. Нажмите "Попробовать снова".');
      }
    }, 1000);
    return () => clearInterval(iv);
  }, [step, expiresAt]);

  useEffect(() => () => { if (pollInterval) clearInterval(pollInterval); }, [pollInterval]);

  const startFlow = useCallback(async () => {
    if (pollInterval) clearInterval(pollInterval);
    setPollInterval(null);
    setLoading(true);
    setStep('code');
    setErrorMsg('');
    setUserCode('');
    setVerUri('');
    try {
      const res = await tauriAuth.startDeviceCodeFlow();
      setUserCode(res.user_code);
      setVerUri(res.verification_uri);
      setDCode(res.device_code);
      setExpiresAt(Date.now() + res.expires_in * 1000);
      setTimeLeft(res.expires_in);
      setDeviceCode(res.device_code, res.verification_uri, res.user_code, res.expires_in);
      setStep('waiting');

      const iv = setInterval(async () => {
        try {
          const profile = await tauriAuth.pollForToken(res.device_code);
          if (profile) {
            clearInterval(iv);
            setPollInterval(null);
            addAccount({
              uuid: profile.uuid,
              username: profile.username,
              skinUrl: profile.skin_url,
              // Always render a 3D-rendered head from the player's actual
              // Minecraft skin (served by Crafatar via Mojang/Xbox skin CDN).
              // This avoids the "P" letter placeholder and matches Prism.
              avatarUrl: `https://mc-heads.net/head/${profile.uuid}/64`,
              accessToken: profile.access_token,
              refreshToken: profile.refresh_token,
              tokenExpiry: Date.now() + profile.expires_in * 1000,
            });
            try {
              await invoke('save_auth_info', {
                username: profile.username, uuid: profile.uuid,
                accessToken: profile.access_token, refreshToken: profile.refresh_token,
                expiresAt: Math.floor((Date.now() + profile.expires_in * 1000) / 1000),
              });
              console.log('✅ Auth saved to auth.json');
            } catch (saveErr: any) {
              console.error('❌ Failed to save auth:', saveErr);
              setErrorMsg('Failed to save auth data locally: ' + (saveErr?.message || String(saveErr)));
            }
            clearDeviceCode();
            setStep('success');
            setLoading(false);
            setTimeout(() => onSuccess?.(), 1500);
          }
        } catch (pollErr) {
          // Real error (not just pending) — stop polling and show it
          const msg = typeof pollErr === 'string' ? pollErr
            : (pollErr as any)?.message || String(pollErr);
          if (msg && !msg.toLowerCase().includes('pending') && !msg.toLowerCase().includes('slow_down')) {
            clearInterval(iv);
            setPollInterval(null);
            setStep('error');
            setErrorMsg(msg);
            setLoading(false);
          }
        }
      }, (res.interval ?? 5) * 1000);
      setPollInterval(iv);
    } catch (e: any) {
      setStep('error');
      const msg = typeof e === 'string' ? e : e?.message || String(e) || 'Unknown error';
      setErrorMsg(msg || 'Failed to start authentication. Check your internet connection.');
    } finally {
      setLoading(false);
    }
  }, [addAccount, clearDeviceCode, setDeviceCode, setLoading, onSuccess, pollInterval]);

  // Offline / no-license mode
  const loginOffline = useCallback(async () => {
    const nick = offlineNick.trim();
    if (!nick) { setOfflineError('Введите никнейм'); return; }
    if (nick.length < 3 || nick.length > 16) { setOfflineError('Никнейм должен быть от 3 до 16 символов'); return; }
    if (!/^[a-zA-Z0-9_]+$/.test(nick)) { setOfflineError('Только латинские буквы, цифры и _'); return; }
    setOfflineError('');

    // Deterministic UUID v3-like from nickname
    const encoded = new TextEncoder().encode(nick.toLowerCase());
    const hashBuf = await crypto.subtle.digest('SHA-1', encoded);
    const h = new Uint8Array(hashBuf);
    const uuid = [
      h.slice(0,4), h.slice(4,6),
      new Uint8Array([((h[6] & 0x0f) | 0x30), h[7]]),
      new Uint8Array([((h[8] & 0x3f) | 0x80), h[9]]),
      h.slice(10,16),
    ].map(b => Array.from(b).map(x => x.toString(16).padStart(2,'0')).join('')).join('-');

    addAccount({
      uuid,
      username: nick,
      isDemo: true,
      accessToken: '0',
    });

    try {
      await invoke('save_auth_info', {
        username: nick, uuid,
        accessToken: '0', refreshToken: '',
        expiresAt: 0,
      });
      console.log('✅ Offline auth saved');
    } catch (saveErr: any) {
      console.error('❌ Failed to save offline auth:', saveErr);
    }

    setStep('success');
    setTimeout(() => onSuccess?.(), 1200);
  }, [offlineNick, addAccount, onSuccess]);

  const copyCode = () => {
    navigator.clipboard.writeText(userCode);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const openBrowser = () => shellOpen(verUri).catch(() => window.open(verUri, '_blank'));

  const fmt = (s: number) => `${Math.floor(s / 60)}:${(s % 60).toString().padStart(2,'0')}`;

  return (
    <div className="flex flex-col items-center text-center w-full">
      <AnimatePresence mode="wait">

        {/* ── IDLE: initial choice ─────────────────────────── */}
        {step === 'idle' && (
          <motion.div key="idle" initial={{ opacity:0, y:8 }} animate={{ opacity:1, y:0 }} exit={{ opacity:0, y:-8 }}
            className="flex flex-col items-center gap-4 w-full">
            <div className="w-16 h-16 rounded-2xl flex items-center justify-center"
              style={{ background:'linear-gradient(135deg,#0078D4,#00BCF2)' }}>
              <Shield className="w-8 h-8 text-white" />
            </div>
            <div>
              <p className="font-bold text-base" style={{ color:'var(--color-text)' }}>Войти в аккаунт</p>
              <p className="text-sm mt-1" style={{ color:'var(--color-text-secondary)' }}>
                Выберите способ входа
              </p>
            </div>
            <button onClick={startFlow}
              className="w-full py-3 rounded-xl font-semibold text-sm flex items-center justify-center gap-2"
              style={{ background:'#0078D4', color:'white' }}>
              <svg viewBox="0 0 21 21" className="w-4 h-4 fill-white">
                <rect x="1" y="1" width="9" height="9"/><rect x="11" y="1" width="9" height="9"/>
                <rect x="1" y="11" width="9" height="9"/><rect x="11" y="11" width="9" height="9"/>
              </svg>
              Войти через Microsoft
            </button>
            <button onClick={() => setStep('offline')}
              className="w-full py-3 rounded-xl font-semibold text-sm flex items-center justify-center gap-2 transition-all hover:opacity-80"
              style={{ background:'var(--color-surface-2)', color:'var(--color-text-secondary)', border:'1px solid var(--color-border)' }}>
              <UserCircle className="w-4 h-4" />
              Другой Способ (без лицензии)
            </button>
            {onCancel && (
              <button onClick={onCancel} className="text-sm" style={{ color:'var(--color-text-tertiary)' }}>Отмена</button>
            )}
          </motion.div>
        )}

        {/* ── OFFLINE: nickname entry ───────────────────────── */}
        {step === 'offline' && (
          <motion.div key="offline" initial={{ opacity:0, y:8 }} animate={{ opacity:1, y:0 }} exit={{ opacity:0, y:-8 }}
            className="flex flex-col items-center gap-4 w-full">
            <div className="w-16 h-16 rounded-2xl flex items-center justify-center"
              style={{ background:'linear-gradient(135deg,#6C5CE7,#a29bfe)' }}>
              <UserCircle className="w-8 h-8 text-white" />
            </div>
            <div>
              <p className="font-bold text-base" style={{ color:'var(--color-text)' }}>Вход без лицензии</p>
              <p className="text-sm mt-1" style={{ color:'var(--color-text-secondary)' }}>
                Введите никнейм для игры (только латиница, 3–16 символов)
              </p>
            </div>
            <input
              type="text"
              value={offlineNick}
              onChange={e => { setOfflineNick(e.target.value); setOfflineError(''); }}
              onKeyDown={e => e.key === 'Enter' && loginOffline()}
              placeholder="Steve"
              maxLength={16}
              className="w-full px-4 py-3 rounded-xl text-sm font-bold text-center outline-none"
              style={{ background:'var(--color-surface-2)', border:`1px solid ${offlineError ? 'var(--color-error)' : 'var(--color-border)'}`, color:'var(--color-text)', letterSpacing:'0.05em' }}
              autoFocus
            />
            {offlineError && (
              <p className="text-xs" style={{ color:'var(--color-error)' }}>{offlineError}</p>
            )}
            <button onClick={loginOffline}
              className="w-full py-3 rounded-xl font-semibold text-sm"
              style={{ background:'var(--color-primary)', color:'var(--color-primary-text, #fff)' }}>
              Войти как {offlineNick.trim() || '…'}
            </button>
            <button onClick={() => { setStep('idle'); setOfflineNick(''); setOfflineError(''); }}
              className="text-sm flex items-center gap-1" style={{ color:'var(--color-text-tertiary)' }}>
              ← Назад
            </button>
          </motion.div>
        )}

        {/* ── CODE / WAITING ────────────────────────────────── */}
        {(step === 'code' || step === 'waiting') && (
          <motion.div key="code" initial={{ opacity:0, y:8 }} animate={{ opacity:1, y:0 }} exit={{ opacity:0, y:-8 }}
            className="flex flex-col items-center gap-5 w-full">
            <div className="w-full p-4 rounded-xl text-left"
              style={{ background:'var(--color-surface-2)', border:'1px solid var(--color-border)' }}>
              <p className="text-xs font-bold uppercase tracking-widest mb-2" style={{ color:'var(--color-text-tertiary)' }}>
                Шаг 1 — Скопируйте код
              </p>
              <div className="flex items-center gap-3">
                <div className="flex-1 flex items-center justify-center py-3 rounded-xl"
                  style={{ background:'var(--color-surface)', border:'1px solid var(--color-border)' }}>
                  <span className="text-2xl font-bold tracking-[0.3em]"
                    style={{ color:'var(--color-primary)', fontFamily:'monospace' }}>
                    {userCode || '— — — —'}
                  </span>
                </div>
                <button onClick={copyCode}
                  className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 transition-all"
                  style={{ background:copied?'rgba(46,204,113,0.15)':'var(--color-surface)', border:'1px solid var(--color-border)', color:copied?'var(--color-success)':'var(--color-text-secondary)' }}>
                  {copied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
                </button>
              </div>
            </div>

            <div className="w-full p-4 rounded-xl text-left"
              style={{ background:'var(--color-surface-2)', border:'1px solid var(--color-border)' }}>
              <p className="text-xs font-bold uppercase tracking-widest mb-2" style={{ color:'var(--color-text-tertiary)' }}>
                Шаг 2 — Откройте браузер
              </p>
              <button onClick={openBrowser}
                className="w-full py-2.5 rounded-xl text-sm font-semibold flex items-center justify-center gap-2"
                style={{ background:'#0078D4', color:'white' }}>
                <ExternalLink className="w-4 h-4" /> Открыть microsoft.com/link
              </button>
            </div>

            <div className="flex items-center gap-3 py-2">
              <span className="w-5 h-5 border-2 border-t-transparent rounded-full animate-spin"
                style={{ borderColor:'var(--color-primary)', borderTopColor:'transparent' }} />
              <p className="text-sm" style={{ color:'var(--color-text-secondary)' }}>Ожидание входа…</p>
              <span className="text-xs font-mono" style={{ color:'var(--color-text-tertiary)' }}>{fmt(timeLeft)}</span>
            </div>

            <button onClick={() => { if (pollInterval) clearInterval(pollInterval); startFlow(); }}
              className="text-xs flex items-center gap-1 hover:opacity-80"
              style={{ color:'var(--color-text-tertiary)' }}>
              <RefreshCw className="w-3 h-3" /> Получить новый код
            </button>
          </motion.div>
        )}

        {/* ── SUCCESS ───────────────────────────────────────── */}
        {step === 'success' && (
          <motion.div key="success" initial={{ opacity:0, scale:0.9 }} animate={{ opacity:1, scale:1 }} exit={{ opacity:0 }}
            className="flex flex-col items-center gap-4">
            <div className="w-16 h-16 rounded-full flex items-center justify-center"
              style={{ background:'rgba(46,204,113,0.15)', border:'2px solid var(--color-success)' }}>
              <Check className="w-8 h-8" style={{ color:'var(--color-success)' }} />
            </div>
            <div>
              <p className="font-bold text-base" style={{ color:'var(--color-text)' }}>Вход выполнен!</p>
              <p className="text-sm mt-1" style={{ color:'var(--color-text-secondary)' }}>Добро пожаловать в Portal Launcher</p>
            </div>
          </motion.div>
        )}

        {/* ── ERROR ─────────────────────────────────────────── */}
        {step === 'error' && (
          <motion.div key="error" initial={{ opacity:0, y:8 }} animate={{ opacity:1, y:0 }} exit={{ opacity:0 }}
            className="flex flex-col items-center gap-4 w-full">
            <div className="w-16 h-16 rounded-full flex items-center justify-center"
              style={{ background:'rgba(231,76,60,0.1)', border:'2px solid var(--color-error)' }}>
              <X className="w-8 h-8" style={{ color:'var(--color-error)' }} />
            </div>
            <div className="w-full">
              <p className="font-bold" style={{ color:'var(--color-text)' }}>Ошибка входа</p>
              <p className="text-sm mt-2 p-3 rounded-xl text-left"
                style={{ color:'var(--color-text-secondary)', background:'var(--color-surface-2)', border:'1px solid var(--color-border)' }}>
                {errorMsg}
              </p>
            </div>
            <div className="flex gap-2 w-full">
              <button onClick={() => { setStep('idle'); setErrorMsg(''); }}
                className="flex-1 py-2.5 rounded-xl text-sm font-semibold"
                style={{ background:'var(--color-primary)', color:'var(--color-primary-text, #fff)' }}>
                Попробовать снова
              </button>
              <button onClick={() => { setStep('offline'); setErrorMsg(''); }}
                className="flex-1 py-2.5 rounded-xl text-sm font-semibold"
                style={{ background:'var(--color-surface-2)', color:'var(--color-text-secondary)', border:'1px solid var(--color-border)' }}>
                Другой Способ
              </button>
            </div>
          </motion.div>
        )}

      </AnimatePresence>
    </div>
  );
}

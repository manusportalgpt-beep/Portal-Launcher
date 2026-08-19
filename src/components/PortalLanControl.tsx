import { useEffect, useRef, useState } from 'react';
import { Check, Link2, Loader2, Shield, Unplug, Wifi, X } from 'lucide-react';
import { usePortalLanStore } from '@/stores/portalLanStore';
import { useTranslation } from 'react-i18next';
import { relayWS } from '@/lib/relay-ws';
import { acceptPortalLanOffer, connectPortalLan, type PortalLanConnection, type PortalLanPath } from '@/lib/portal-lan-webrtc';

interface Props { myUuid?: string; peerUuid?: string; peerName?: string; }

export function PortalLanControl({ myUuid, peerUuid, peerName }: Props) {
  const { t } = useTranslation();
  const [showConsent, setShowConsent] = useState(false);
  const [incoming, setIncoming] = useState<string | null>(null);
  const connection = useRef<PortalLanConnection | null>(null);
  const timeout = useRef<number | null>(null);
  const abortController = useRef<AbortController | null>(null);
  const attemptId = useRef(0);
  const { state, path, consentGranted, error, grantConsent, beginConnection, markChecking, markConnected, markError, disconnect } = usePortalLanStore();

  const cleanup = () => {
    attemptId.current += 1;
    abortController.current?.abort();
    abortController.current = null;
    if (timeout.current !== null) window.clearTimeout(timeout.current);
    timeout.current = null;
    connection.current?.close();
    connection.current = null;
  };
  const handlePath = (next: PortalLanPath) => next === 'checking' ? markChecking() : markConnected(next);
  useEffect(() => {
    if (!myUuid || !peerUuid) return;
    const unsubscribe = relayWS.subscribe(msg => {
      if (msg.type === 'portal_lan_offer' && msg.toId === myUuid && msg.fromId === peerUuid && typeof msg.sdp === 'string') setIncoming(msg.sdp);
    });
    return unsubscribe;
  }, [myUuid, peerUuid]);
  useEffect(() => () => cleanup(), []);

  const connect = async () => {
    if (!myUuid || !peerUuid) { markError('Нет идентификатора Millida друга'); return; }
    if (!consentGranted) { setShowConsent(true); return; }
    cleanup();
    const currentAttempt = attemptId.current;
    const controller = new AbortController();
    abortController.current = controller;
    beginConnection(peerUuid); markChecking();
    timeout.current = window.setTimeout(() => {
      if (attemptId.current !== currentAttempt) return;
      controller.abort();
      cleanup();
      markError('Portal LAN: тайм-аут соединения (20 секунд)');
    }, 20000);
    try {
      const next = await connectPortalLan(myUuid, peerUuid, nextPath => {
        if (attemptId.current === currentAttempt && !controller.signal.aborted) handlePath(nextPath);
      }, controller.signal);
      if (attemptId.current !== currentAttempt || controller.signal.aborted) { next.close(); return; }
      connection.current = next;
      connection.current.channel.onopen = () => {
        if (attemptId.current !== currentAttempt || controller.signal.aborted) return;
        if (timeout.current !== null) window.clearTimeout(timeout.current);
        timeout.current = null;
        markConnected('direct');
      };
    } catch (e) {
      if (attemptId.current !== currentAttempt) return;
      cleanup();
      markError(e instanceof Error ? e.message : 'Не удалось начать Portal LAN');
    }
  };

  const accept = () => {
    if (!myUuid || !peerUuid || !incoming) return;
    cleanup(); beginConnection(peerUuid); setIncoming(null);
    const currentAttempt = attemptId.current;
    const controller = new AbortController();
    abortController.current = controller;
    timeout.current = window.setTimeout(() => {
      if (attemptId.current !== currentAttempt) return;
      controller.abort();
      cleanup();
      markError('Portal LAN: входящее соединение истекло (20 секунд)');
    }, 20000);
    acceptPortalLanOffer(myUuid, peerUuid, incoming, nextPath => {
      if (attemptId.current === currentAttempt && !controller.signal.aborted) handlePath(nextPath);
    }, next => {
      if (attemptId.current !== currentAttempt || controller.signal.aborted) { next.close(); return; }
      connection.current = next;
      next.channel.onopen = () => {
        if (attemptId.current !== currentAttempt || controller.signal.aborted) return;
        if (timeout.current !== null) window.clearTimeout(timeout.current);
        timeout.current = null;
        markConnected('direct');
      };
    }, controller.signal);
  };
  const disconnectNow = () => { cleanup(); disconnect(); };

  if (state === 'connected') {
    return <button onClick={disconnectNow} title={t('friends.lanDisconnect', 'Отключить Portal LAN')}
      className="flex items-center gap-1.5 rounded-lg px-2 py-1 text-[10px] font-semibold"
      style={{ color: 'var(--color-success)', background: 'rgba(46,204,113,.10)', border: '1px solid rgba(46,204,113,.25)' }}>
      <Wifi className="h-3 w-3" /> {path === 'direct' ? t('friends.lanDirect', 'Прямое соединение') : 'Relay'}
    </button>;
  }

  return <>
    <div className="flex items-center gap-2">
    {incoming && state !== 'connecting' && <button onClick={accept} className="flex items-center gap-1.5 rounded-lg px-2 py-1 text-[10px] font-semibold" style={{ color: 'var(--color-primary)', background: 'var(--color-primary-dim)', border: '1px solid var(--color-primary)' }}><Wifi className="h-3 w-3" />{t('friends.lanAccept', 'Принять LAN')}</button>}
    <button onClick={() => void connect()} disabled={!peerUuid || state === 'connecting'} title={t('friends.lanConnect', 'Подключиться через Portal LAN')}
      className="flex items-center gap-1.5 rounded-lg px-2 py-1 text-[10px] font-semibold"
      style={{ color: 'var(--color-text-secondary)', background: 'var(--color-surface-2)', border: '1px solid var(--color-border)', opacity: peerUuid ? 1 : .55 }}>
      {state === 'connecting' ? <Loader2 className="h-3 w-3 animate-spin" /> : <Link2 className="h-3 w-3" />}
      {state === 'connecting' ? t('friends.lanChecking', 'Проверка сети…') : t('friends.lanConnect', 'Portal LAN')}
    </button>
    {state === 'connecting' && <button onClick={disconnectNow} className="rounded-lg p-1" title={t('common.cancel', 'Отмена')}><Unplug className="h-3 w-3" /></button>}
    </div>
    {error && <span className="text-[10px]" style={{ color: 'var(--color-error)' }}>{error}</span>}
    {showConsent && <div className="fixed inset-0 z-[70] flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,.68)' }}>
      <div className="w-full max-w-sm rounded-2xl p-5" style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', boxShadow: 'var(--shadow-lg)' }}>
        <div className="flex items-start gap-3"><Shield className="mt-0.5 h-5 w-5" style={{ color: 'var(--color-primary)' }} /><div>
          <h3 className="font-semibold" style={{ color: 'var(--color-text)' }}>{t('friends.lanTitle', 'Portal LAN')}</h3>
          <p className="mt-1 text-xs leading-5" style={{ color: 'var(--color-text-secondary)' }}>{t('friends.lanConsent', 'Разрешить прямое WebRTC-соединение с другом? Сначала используется STUN/NAT traversal; relay включается только при наличии TURN-конфигурации.')}</p>
          {peerName && <p className="mt-2 text-xs font-semibold" style={{ color: 'var(--color-text)' }}>{peerName}</p>}
        </div></div>
        <div className="mt-4 flex justify-end gap-2"><button onClick={() => setShowConsent(false)} className="rounded-lg px-3 py-2 text-xs" style={{ color: 'var(--color-text-secondary)' }}><X className="mr-1 inline h-3 w-3" />{t('common.cancel', 'Отмена')}</button><button onClick={() => { grantConsent(); setShowConsent(false); window.setTimeout(connect, 0); }} className="rounded-lg px-3 py-2 text-xs font-semibold" style={{ background: 'var(--color-primary)', color: 'var(--color-primary-text)' }}><Check className="mr-1 inline h-3 w-3" />{t('friends.lanAllow', 'Разрешить')}</button></div>
      </div>
    </div>}
  </>;
}

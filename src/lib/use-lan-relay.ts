import { useCallback, useEffect, useState } from 'react';
import { invoke } from '@/lib/invoke-shim';
import { useCurrentUser } from '@/stores/authStore';
import { listen } from '@tauri-apps/api/event';

export type LanRelayInfo = {
  active: boolean;
  public_host?: string;
  public_port?: number;
  local_port?: number;
  session_id?: string;
  error?: string;
};

export function useLanRelay(instanceId: string) {
  const currentUser = useCurrentUser();
  const [relay, setRelay] = useState<LanRelayInfo | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const refresh = () => {
      void invoke<LanRelayInfo>('get_lan_relay_status', { instanceId })
        .then(status => { if (!cancelled) setRelay(status); })
        .catch(() => undefined);
    };
    refresh();
    const timer = window.setInterval(refresh, 1500);

    // Когда Minecraft закрывается — останавливаем relay, чтобы при следующем
    // запуске и «Открыть для сети» выдался свежий адрес.
    let unlistenGameExit: (() => void) | undefined;
    let listenReady = false;
    void listen<{ instance_id?: string; code?: number }>('game-exited', async (event) => {
      if (String(event.payload?.instance_id ?? '') !== instanceId) return;
      if (cancelled) return;
      try {
        await invoke('stop_lan_relay', { token: currentUser?.accessToken ?? '' });
      } catch { /* ignore */ }
      setRelay({ active: false });
    }).then(fn => { if (cancelled) { fn(); } else { unlistenGameExit = fn; listenReady = true; } });

    return () => {
      cancelled = true;
      window.clearInterval(timer);
      if (listenReady) unlistenGameExit?.();
    };
  }, [instanceId, currentUser?.accessToken]);

  const toggle = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      if (relay?.active) {
        await invoke('stop_lan_relay', { token: currentUser?.accessToken ?? '' });
        setRelay({ active: false });
      } else {
        const status = await invoke<LanRelayInfo>('start_lan_relay', {
          instanceId,
          token: currentUser?.accessToken ?? '',
          accountUuid: currentUser?.uuid,
        });
        setRelay(status);
      }
    } catch (reason) {
      setError(typeof reason === 'string' ? reason : String(reason));
    } finally {
      setBusy(false);
    }
  }, [currentUser?.accessToken, currentUser?.uuid, instanceId, relay?.active]);

  return { relay, busy, error, setError, toggle };
}

import { create } from 'zustand';
import { invoke } from '@/lib/invoke-shim';

export interface MillidaProfile {
  id: string;
  email?: string | null;
  nickname?: string | null;
  avatarUrl?: string | null;
  profileUrl?: string | null;
  status?: string | null;
}

interface LoginInit {
  deviceCode: string;
  userCode: string;
  verifyUrl: string;
  expiresInSec: number;
  intervalSec: number;
}

interface PollResult { status: 'ok' | 'pending' | 'denied' | 'expired' | string; user?: MillidaProfile | null }

interface MillidaAuthState {
  profile: MillidaProfile | null;
  connected: boolean;
  busy: boolean;
  deviceCode: string;
  userCode: string;
  verifyUrl: string;
  expiresAt: number | null;
  error: string | null;
  startLogin: () => Promise<void>;
  cancelLogin: () => void;
  refresh: () => Promise<void>;
  logout: () => Promise<void>;
}

let pollTimer: number | null = null;
const clearPoll = () => { if (pollTimer !== null) window.clearTimeout(pollTimer); pollTimer = null; };

export const useMillidaAuthStore = create<MillidaAuthState>((set, get) => ({
  profile: null,
  connected: false,
  busy: false,
  deviceCode: '',
  userCode: '',
  verifyUrl: '',
  expiresAt: null,
  error: null,

  startLogin: async () => {
    clearPoll();
    set({ busy: true, error: null, deviceCode: '', userCode: '', verifyUrl: '', expiresAt: null });
    try {
      const init = await invoke<LoginInit>('millida_login_init');
      if (!init.deviceCode || !init.userCode) throw new Error('Millida не вернул код входа');
      const expiresAt = Date.now() + Math.max(60, init.expiresInSec || 600) * 1000;
      set({ deviceCode: init.deviceCode, userCode: init.userCode, verifyUrl: init.verifyUrl, expiresAt });
      window.open(init.verifyUrl, '_blank', 'noopener,noreferrer');
      const poll = async () => {
        const current = get();
        if (!current.busy || current.deviceCode !== init.deviceCode) return;
        if (Date.now() >= expiresAt) { clearPoll(); set({ busy: false, error: 'Код входа устарел. Начни вход ещё раз.' }); return; }
        try {
          const result = await invoke<PollResult>('millida_login_poll', { deviceCode: init.deviceCode });
          if (result.status === 'ok') {
            clearPoll();
            set({ busy: false, connected: true, profile: result.user ?? null, error: null });
            await get().refresh();
            return;
          }
          if (result.status === 'denied') { clearPoll(); set({ busy: false, error: 'Вход отклонён на сайте Millida.' }); return; }
          if (result.status === 'expired') { clearPoll(); set({ busy: false, error: 'Код входа устарел. Начни вход ещё раз.' }); return; }
        } catch { /* transient network error: continue polling until expiry */ }
        pollTimer = window.setTimeout(() => void poll(), Math.max(2000, init.intervalSec * 1000));
      };
      pollTimer = window.setTimeout(() => void poll(), Math.max(2000, init.intervalSec * 1000));
    } catch (error) {
      set({ busy: false, error: error instanceof Error ? error.message : 'Не удалось начать вход Millida' });
    }
  },

  cancelLogin: () => { clearPoll(); set({ busy: false, deviceCode: '', userCode: '', verifyUrl: '', expiresAt: null }); },

  refresh: async () => {
    try {
      const connected = await invoke<boolean>('millida_session_status');
      if (!connected) { set({ connected: false, profile: null }); return; }
      const profile = await invoke<MillidaProfile>('millida_profile');
      set({ connected: true, profile, error: null });
    } catch (error) {
      set({ connected: false, profile: null, error: error instanceof Error ? error.message : 'Профиль Millida недоступен' });
    }
  },

  logout: async () => {
    clearPoll();
    try { await invoke('millida_logout'); } finally { set({ profile: null, connected: false, busy: false, deviceCode: '', userCode: '', verifyUrl: '', expiresAt: null }); }
  },
}));

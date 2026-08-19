import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export type PortalLanPath = 'direct' | 'relay' | 'checking' | 'offline';
export type PortalLanState = 'disconnected' | 'consent_required' | 'connecting' | 'connected' | 'error';

interface PortalLanStore {
  state: PortalLanState;
  path: PortalLanPath;
  peerUuid: string | null;
  roomCode: string | null;
  error: string | null;
  consentGranted: boolean;
  grantConsent: () => void;
  revokeConsent: () => void;
  beginConnection: (peerUuid: string, roomCode?: string) => void;
  markChecking: () => void;
  markConnected: (path: Exclude<PortalLanPath, 'checking' | 'offline'>) => void;
  markError: (message: string) => void;
  disconnect: () => void;
}

export const usePortalLanStore = create<PortalLanStore>()(persist((set) => ({
  state: 'disconnected',
  path: 'offline',
  peerUuid: null,
  roomCode: null,
  error: null,
  consentGranted: false,

  grantConsent: () => set({ consentGranted: true, error: null }),
  revokeConsent: () => set({ consentGranted: false, state: 'disconnected', path: 'offline', peerUuid: null, roomCode: null }),
  beginConnection: (peerUuid, roomCode) => set((current) => current.consentGranted
    ? { state: 'connecting', path: 'checking', peerUuid, roomCode: roomCode ?? null, error: null }
    : { state: 'consent_required', error: null, peerUuid, roomCode: roomCode ?? null }),
  markChecking: () => set({ state: 'connecting', path: 'checking', error: null }),
  markConnected: (path) => set({ state: 'connected', path, error: null }),
  markError: (error) => set({ state: 'error', path: 'offline', error }),
  disconnect: () => set({ state: 'disconnected', path: 'offline', peerUuid: null, roomCode: null, error: null }),
}), {
  name: 'portal-lan-v1',
  partialize: (state) => ({ consentGranted: state.consentGranted }),
}));

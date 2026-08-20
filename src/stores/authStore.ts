import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export interface UserProfile {
  uuid: string;
  username: string;
  avatarUrl?: string;
  faceCacheRevision?: number;
  skinUrl?: string;
  accessToken?: string;
  refreshToken?: string;
  tokenExpiry?: number;
  isDemo?: boolean;
  provider?: 'microsoft' | 'elyby' | 'offline';
}

interface AuthState {
  accounts: UserProfile[];
  activeAccountUuid: string | null;
  isLoading: boolean;
  deviceCode: string | null;
  verificationUri: string | null;
  userCode: string | null;
  codeExpiresAt: number | null;
  // Derived
  user: UserProfile | null;
  isAuthenticated: boolean;
  // Actions
  addAccount: (u: UserProfile) => void;
  switchAccount: (uuid: string) => void;
  removeAccount: (uuid: string) => void;
  updateAccount: (uuid: string, partial: Partial<UserProfile>) => void;
  setDeviceCode: (code: string, uri: string, userCode: string, expiresIn: number) => void;
  clearDeviceCode: () => void;
  setLoading: (v: boolean) => void;
  logout: () => void;
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set, get) => ({
      accounts: [],
      activeAccountUuid: null,
      isLoading: false,
      deviceCode: null,
      verificationUri: null,
      userCode: null,
      codeExpiresAt: null,

      get user() {
        const s = get();
        return s.accounts.find(a => a.uuid === s.activeAccountUuid) ?? null;
      },
      get isAuthenticated() {
        return get().activeAccountUuid !== null && get().accounts.length > 0;
      },

      addAccount: (u) => set(s => {
        const exists = s.accounts.find(a => a.uuid === u.uuid);
        const accounts = exists
          ? s.accounts.map(a => a.uuid === u.uuid ? { ...a, ...u } : a)
          : [...s.accounts, u];
        return { accounts, activeAccountUuid: u.uuid };
      }),

      switchAccount: (uuid) => set({ activeAccountUuid: uuid }),

      removeAccount: (uuid) => set(s => {
        const accounts = s.accounts.filter(a => a.uuid !== uuid);
        const activeAccountUuid = s.activeAccountUuid === uuid
          ? (accounts[0]?.uuid ?? null)
          : s.activeAccountUuid;
        return { accounts, activeAccountUuid };
      }),

      updateAccount: (uuid, partial) => set(s => ({
        accounts: s.accounts.map(a => a.uuid === uuid ? { ...a, ...partial } : a),
      })),

      setDeviceCode: (deviceCode, verificationUri, userCode, expiresIn) => set({
        deviceCode, verificationUri, userCode,
        codeExpiresAt: Date.now() + expiresIn * 1000,
      }),

      clearDeviceCode: () => set({
        deviceCode: null, verificationUri: null,
        userCode: null, codeExpiresAt: null,
      }),

      setLoading: (isLoading) => set({ isLoading }),

      logout: () => set(s => {
        if (!s.activeAccountUuid) return s;
        const accounts = s.accounts.filter(a => a.uuid !== s.activeAccountUuid);
        return {
          accounts,
          activeAccountUuid: accounts[0]?.uuid ?? null,
          deviceCode: null, verificationUri: null,
          userCode: null, codeExpiresAt: null,
        };
      }),
    }),
    {
      name: 'portal-auth-v3',
      // Persist full account data including tokens so session survives restart.
      // Rust also persists to auth.json via persist_auth() and auto_refresh_if_needed()
      // is called on launch to keep the token fresh.
      partialize: (s) => ({
        accounts: s.accounts,
        activeAccountUuid: s.activeAccountUuid,
      }),
    }
  )
);

// Convenience selector
export const useCurrentUser = () => {
  const { accounts, activeAccountUuid } = useAuthStore();
  return accounts.find(a => a.uuid === activeAccountUuid) ?? null;
};
export const useIsAuthenticated = () => useAuthStore(s => s.accounts.length > 0 && s.activeAccountUuid !== null);

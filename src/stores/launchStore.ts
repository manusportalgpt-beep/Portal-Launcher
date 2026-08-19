import { create } from 'zustand';

export type LaunchState = 'idle' | 'launching' | 'running';

interface LaunchStore {
  status: Record<string, LaunchState>;
  setStatus: (instanceId: string, state: LaunchState) => void;
  getStatus: (instanceId: string) => LaunchState;
}

export const useLaunchStore = create<LaunchStore>((set, get) => ({
  status: {},
  setStatus: (instanceId, state) =>
    set(s => ({ status: { ...s.status, [instanceId]: state } })),
  getStatus: (instanceId) => get().status[instanceId] ?? 'idle',
}));

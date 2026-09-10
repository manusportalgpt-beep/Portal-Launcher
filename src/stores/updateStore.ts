import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export interface UpdateNotification {
  version: string;
  body: string;
  publishedAt: string;
  htmlUrl: string;
  seenAt: number;
}

interface UpdateState {
  lastCheckedVersion: string | null;
  notifications: UpdateNotification[];
  dismissedIds: string[];
  snoozedUntil: number | null;
  addNotification: (n: UpdateNotification) => void;
  dismiss: (version: string) => void;
  snooze: (minutes: number) => void;
  isSnoozed: () => boolean;
  isDismissed: (version: string) => boolean;
  setLastChecked: (v: string) => void;
}

export const useUpdateStore = create<UpdateState>()(
  persist(
    (set, get) => ({
      lastCheckedVersion: null,
      notifications: [],
      dismissedIds: [],
      snoozedUntil: null,
      addNotification: (n) => set(s => {
        if (s.dismissedIds.includes(n.version)) return s;
        const exists = s.notifications.find(x => x.version === n.version);
        if (exists) return s;
        return { notifications: [n, ...s.notifications].slice(0, 20) };
      }),
      dismiss: (version) => set(s => ({
        dismissedIds: [...s.dismissedIds, version],
        notifications: s.notifications.filter(n => n.version !== version),
      })),
      snooze: (minutes) => set({
        snoozedUntil: Date.now() + minutes * 60 * 1000,
      }),
      isSnoozed: () => {
        const { snoozedUntil } = get();
        return snoozedUntil !== null && Date.now() < snoozedUntil;
      },
      isDismissed: (version) => get().dismissedIds.includes(version),
      setLastChecked: (v) => set({ lastCheckedVersion: v }),
    }),
    { name: 'portal-updates-v1' }
  )
);

import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { safeLocalStorage } from '@/lib/safe-storage';

export type AchievementUnlock = { unlockedAt: string };

type AchievementState = {
  unlocked: Record<string, AchievementUnlock>;
  unlock: (id: string) => void;
};

export const useAchievementStore = create<AchievementState>()(persist(
  (set, get) => ({
    unlocked: {},
    unlock: (id) => {
      if (get().unlocked[id]) return;
      set(state => ({ unlocked: { ...state.unlocked, [id]: { unlockedAt: new Date().toISOString() } } }));
    },
  }),
  { name: 'portal-achievements', storage: createJSONStorage(() => safeLocalStorage()) },
));

export default useAchievementStore;

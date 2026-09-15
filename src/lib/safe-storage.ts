import type { StateStorage } from 'zustand/middleware';

// localStorage adapter that never lets a quota/write failure take down the app.
// Most persisted zustand stores are caches of backend data, so on overflow we
// degrade to in-memory storage instead of throwing QuotaExceededError.
export function safeStateStorage(storage: () => Storage): StateStorage {
  return {
    getItem: (name) => {
      try {
        return storage().getItem(name);
      } catch {
        return null;
      }
    },
    setItem: (name, value) => {
      try {
        storage().setItem(name, value);
      } catch (err) {
        console.warn(`[persist:${name}] localStorage write failed — keeping state in memory only`, err);
      }
    },
    removeItem: (name) => {
      try {
        storage().removeItem(name);
      } catch {
        /* ignore */
      }
    },
  };
}

export const safeLocalStorage = () => safeStateStorage(() => window.localStorage);
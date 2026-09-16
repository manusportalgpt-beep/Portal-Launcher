import type { StateStorage } from 'zustand/middleware';

// localStorage adapter that never lets a quota/write failure take down the app.
// Persisted stores are caches of backend state, so on overflow we degrade to
// in-memory storage instead of letting QuotaExceededError escape and crash the UI.
export function safeLocalStorage(): StateStorage {
  return {
    getItem: (name) => {
      try {
        return window.localStorage.getItem(name);
      } catch {
        return null;
      }
    },
    setItem: (name, value) => {
      try {
        window.localStorage.setItem(name, value);
      } catch {
        console.warn(`[persist:${name}] localStorage write failed — keeping state in memory only`);
      }
    },
    removeItem: (name) => {
      try {
        window.localStorage.removeItem(name);
      } catch {
        /* ignore */
      }
    },
  };
}
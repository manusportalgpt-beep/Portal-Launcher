import { create } from 'zustand';

export type NotifType = 'mod_update' | 'system' | 'friend_request' | 'message' | 'friend_online';

export interface Notification {
  id: string;
  type: NotifType;
  title: string;
  body: string;
  avatarUrl?: string;
  fromUuid?: string;
  fromUsername?: string;
  read: boolean;
  createdAt: string;
  action?: { label: string; route: string };
}

interface NotifState {
  notifications: Notification[];
  panelOpen: boolean;
  add: (n: Omit<Notification, 'id' | 'read' | 'createdAt'>) => void;
  markRead: (id: string) => void;
  markAllRead: () => void;
  remove: (id: string) => void;
  clear: () => void;
  setPanel: (open: boolean) => void;
  unreadCount: () => number;
}

export const useNotifStore = create<NotifState>((set, get) => ({
  notifications: [],
  panelOpen: false,

  add: (n) => {
    set(s => ({
      notifications: [{
        ...n,
        id: `notif-${Date.now()}-${Math.random()}`,
        read: false,
        createdAt: new Date().toISOString(),
      }, ...s.notifications].slice(0, 50),
    }));
  },

  markRead: (id) => set(s => ({
    notifications: s.notifications.map(n => n.id === id ? { ...n, read: true } : n),
  })),

  markAllRead: () => set(s => ({
    notifications: s.notifications.map(n => ({ ...n, read: true })),
  })),

  remove: (id) => set(s => ({
    notifications: s.notifications.filter(n => n.id !== id),
  })),

  clear: () => set({ notifications: [] }),
  setPanel: (open) => set({ panelOpen: open }),
  unreadCount: () => get().notifications.filter(n => !n.read).length,
}));

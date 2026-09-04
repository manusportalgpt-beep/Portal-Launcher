import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export interface ChatAttachment {
  name: string;
  type: string;
  size: number;
  dataUrl?: string;
  base64?: string;
  url?: string;
}

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
  timestamp: number;
  attachments?: ChatAttachment[];
}

export interface ChatSession {
  id: string;
  title: string;
  messages: ChatMessage[];
  instanceId?: string;
  createdAt: number;
  updatedAt: number;
}

interface ChatHistoryState {
  sessions: ChatSession[];
  activeSessionId: string | null;
  createSession: (instanceId?: string) => string;
  deleteSession: (id: string) => void;
  renameSession: (id: string, title: string) => void;
  setActiveSession: (id: string) => void;
  addMessage: (sessionId: string, msg: ChatMessage) => void;
  getActiveSession: () => ChatSession | null;
  setInstanceForSession: (sessionId: string, instanceId: string | undefined) => void;
}

export const useChatHistory = create<ChatHistoryState>()(
  persist(
    (set, get) => ({
      sessions: [],
      activeSessionId: null,

      createSession: (instanceId?: string) => {
        const id = `chat-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
        const session: ChatSession = {
          id, title: 'New chat', messages: [], instanceId,
          createdAt: Date.now(), updatedAt: Date.now(),
        };
        set(s => ({ sessions: [session, ...s.sessions], activeSessionId: id }));
        return id;
      },

      deleteSession: (id) => set(s => ({
        sessions: s.sessions.filter(x => x.id !== id),
        activeSessionId: s.activeSessionId === id ? (s.sessions[0]?.id ?? null) : s.activeSessionId,
      })),

      renameSession: (id, title) => set(s => ({
        sessions: s.sessions.map(x => x.id === id ? { ...x, title } : x),
      })),

      setActiveSession: (id) => set({ activeSessionId: id }),

      addMessage: (sessionId, msg) => set(s => ({
        sessions: s.sessions.map(x => x.id === sessionId ? {
          ...x, messages: [...x.messages, msg], updatedAt: Date.now(),
          title: x.messages.length === 0 && msg.role === 'user'
            ? msg.content.slice(0, 40) + (msg.content.length > 40 ? '...' : '')
            : x.title,
        } : x),
      })),

      getActiveSession: () => {
        const s = get();
        return s.sessions.find(x => x.id === s.activeSessionId) ?? null;
      },

      setInstanceForSession: (sessionId, instanceId) => set(s => ({
        sessions: s.sessions.map(x => x.id === sessionId ? { ...x, instanceId } : x),
      })),
    }),
    {
      name: 'portal-chat-history-v1',
      version: 1,
      // Compress: only store last 50 messages per session, strip dataUrls > 10KB
      partialize: (state) => ({
        ...state,
        sessions: state.sessions.map(s => ({
          ...s,
          messages: s.messages.slice(-50).map(m => ({
            ...m,
            attachments: m.attachments?.map(a => ({
              ...a,
              dataUrl: (a.dataUrl?.length ?? 0) > 10000 ? a.dataUrl?.slice(0, 50) + '...' : a.dataUrl,
            })),
          })),
        })),
      }),
    }
  )
);

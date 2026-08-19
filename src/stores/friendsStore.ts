import { create } from 'zustand';

export type FriendStatus = 'online' | 'offline' | 'playing';

export interface Friend {
  id: string;
  uuid: string;
  username: string;
  status: FriendStatus;
  currentInstance?: string;
  serverAddress?: string;
  lastSeen?: string;
  unread: number;
  friendsSince: string;
  avatarColor: string;
  avatarUrl?: string;
}

export interface Message {
  id: string;
  senderId: string;
  text?: string;
  timestamp: string;
  isMe: boolean;
  type: 'text' | 'image' | 'voice' | 'file';
  status: 'sending' | 'sent' | 'delivered' | 'read';
  deleted?: boolean;
  deletedForMe?: boolean;
  imageUrl?: string;
  fileName?: string;
  fileSize?: number;
  voiceUrl?: string;
}

interface FriendsState {
  friends: Friend[];
  selectedId: string | null;
  messages: Record<string, Message[]>;
  typingState: Record<string, boolean>;
  select: (id: string | null) => void;
  addMessage: (friendId: string, msg: Message) => void;
  updateMessageStatus: (friendId: string, msgId: string, status: Message['status']) => void;
  markRead: (friendId: string) => void;
  deleteForMe: (friendId: string, msgId: string) => void;
  deleteForAll: (friendId: string, msgId: string) => void;
  setFriendStatus: (friendId: string, status: FriendStatus, extra?: Partial<Friend>) => void;
  setTyping: (friendId: string, isTyping: boolean) => void;
  addFriend: (friend: Friend) => void;
  removeFriend: (id: string) => void;
  incrementUnread: (friendId: string) => void;
  hydrateFriends: (friends: Friend[]) => void;
  clearFriends: () => void;
}

const AVATAR_COLORS = ['#E74C3C','#3498DB','#9B59B6','#2ECC71','#F39C12','#1ABC9C','#E91E63','#FF5722'];
export function randomAvatarColor(): string {
  return AVATAR_COLORS[Math.floor(Math.random() * AVATAR_COLORS.length)];
}

export const useFriendsStore = create<FriendsState>((set) => ({
  // Friends are hydrated only from the authenticated Millida snapshot or a real
  // user-created local record. Never seed demo users or fabricated conversations.
  friends: [],
  selectedId: null,
  typingState: {},
  messages: {},

  select: (id) => set((s) => ({
    selectedId: id,
    friends: s.friends.map(f => f.id === id ? { ...f, unread: 0 } : f),
  })),

  addMessage: (friendId, msg) => set((s) => ({
    messages: { ...s.messages, [friendId]: [...(s.messages[friendId] ?? []), msg] },
  })),

  updateMessageStatus: (friendId, msgId, status) => set((s) => ({
    messages: {
      ...s.messages,
      [friendId]: (s.messages[friendId] ?? []).map(m => m.id === msgId ? { ...m, status } : m),
    },
  })),

  markRead: (friendId) => set((s) => ({
    friends: s.friends.map(f => f.id === friendId ? { ...f, unread: 0 } : f),
    messages: {
      ...s.messages,
      [friendId]: (s.messages[friendId] ?? []).map(m => ({ ...m, status: m.isMe ? m.status : 'read' as const })),
    },
  })),

  deleteForMe: (friendId, msgId) => set((s) => ({
    messages: {
      ...s.messages,
      [friendId]: (s.messages[friendId] ?? []).map(m =>
        m.id === msgId ? { ...m, deletedForMe: true, text: undefined, imageUrl: undefined } : m),
    },
  })),

  deleteForAll: (friendId, msgId) => set((s) => ({
    messages: {
      ...s.messages,
      [friendId]: (s.messages[friendId] ?? []).map(m =>
        m.id === msgId ? { ...m, deleted: true, text: undefined, imageUrl: undefined } : m),
    },
  })),

  setFriendStatus: (friendId, status, extra) => set((s) => ({
    friends: s.friends.map(f => f.id === friendId ? { ...f, status, ...extra } : f),
  })),

  setTyping: (friendId, isTyping) => set((s) => ({
    typingState: { ...s.typingState, [friendId]: isTyping },
  })),

  addFriend: (friend) => set((s) => ({
    friends: s.friends.find(f => f.uuid === friend.uuid) ? s.friends : [...s.friends, friend],
    messages: s.messages[friend.id] ? s.messages : { ...s.messages, [friend.id]: [] },
  })),

  removeFriend: (id) => set((s) => ({
    friends: s.friends.filter(f => f.id !== id),
    selectedId: s.selectedId === id ? null : s.selectedId,
  })),

  incrementUnread: (friendId) => set((s) => ({
    friends: s.friends.map(f =>
      f.id === friendId && s.selectedId !== friendId ? { ...f, unread: f.unread + 1 } : f),
  })),

  hydrateFriends: (friends) => set((s) => ({
    friends,
    selectedId: friends.some(friend => friend.id === s.selectedId) ? s.selectedId : null,
    messages: Object.fromEntries(friends.map(friend => [friend.id, s.messages[friend.id] ?? []])),
  })),

  clearFriends: () => set({ friends: [], selectedId: null, messages: {}, typingState: {} }),
}));

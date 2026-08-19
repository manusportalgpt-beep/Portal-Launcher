import type { Friend, FriendStatus, Message } from '@/stores/friendsStore';
import { invoke } from '@/lib/invoke-shim';

const MILLIDA_API = (import.meta.env.VITE_MILLIDA_API_URL || 'https://api.millida.net/v2').replace(/\/$/, '');
const REQUEST_TIMEOUT_MS = 12_000;

export interface MillidaFriendRequest {
  id: string;
  username: string;
  uuid: string;
  createdAt?: string;
}

export interface MillidaFriendsSnapshot {
  friends: Friend[];
  requests: MillidaFriendRequest[];
  available: boolean;
}

function statusOf(value: unknown): FriendStatus {
  const status = String(value || '').toLowerCase();
  if (status === 'playing' || status === 'in_game' || status === 'game') return 'playing';
  if (status === 'online' || status === 'available') return 'online';
  return 'offline';
}

function avatarColorFor(id: string) {
  const colors = ['#E74C3C', '#3498DB', '#9B59B6', '#2ECC71', '#F39C12', '#1ABC9C', '#E91E63', '#FF5722'];
  let hash = 0;
  for (const char of id) hash = (hash * 31 + char.charCodeAt(0)) | 0;
  return colors[Math.abs(hash) % colors.length];
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? value as Record<string, unknown> : {};
}

function listFrom(value: unknown, keys: string[]) {
  if (Array.isArray(value)) return value;
  const record = asRecord(value);
  for (const key of keys) if (Array.isArray(record[key])) return record[key];
  return [];
}

function normalizeFriend(value: unknown): Friend | null {
  const item = asRecord(value);
  const uuid = String(item.uuid ?? item.user_id ?? item.userId ?? item.id ?? '').trim();
  const username = String(item.username ?? item.name ?? item.user_name ?? '').trim();
  if (!uuid || !username) return null;
  const id = String(item.id ?? uuid);
  return {
    id,
    uuid,
    username,
    status: statusOf(item.status ?? item.presence),
    currentInstance: typeof item.current_instance === 'string' ? item.current_instance : typeof item.currentInstance === 'string' ? item.currentInstance : undefined,
    serverAddress: typeof item.server_address === 'string' ? item.server_address : typeof item.serverAddress === 'string' ? item.serverAddress : undefined,
    lastSeen: typeof item.last_seen === 'string' ? item.last_seen : typeof item.lastSeen === 'string' ? item.lastSeen : undefined,
    unread: Number(item.unread ?? item.unread_count ?? 0) || 0,
    friendsSince: String(item.friends_since ?? item.friendsSince ?? item.created_at ?? new Date().toISOString()),
    avatarColor: typeof item.avatar_color === 'string' ? item.avatar_color : avatarColorFor(uuid),
    avatarUrl: typeof item.avatar_url === 'string' ? item.avatar_url : typeof item.avatarUrl === 'string' ? item.avatarUrl : undefined,
  };
}

async function request<T>(path: string, accessToken: string, init: RequestInit = {}): Promise<T> {
  if (!accessToken) throw new Error('Millida account is not connected');
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(`${MILLIDA_API}${path}`, {
      ...init,
      signal: controller.signal,
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${accessToken}`,
        ...(init.body ? { 'Content-Type': 'application/json' } : {}),
        ...(init.headers || {}),
      },
    });
    if (!response.ok) throw new Error(`Millida API ${response.status}`);
    return await response.json() as T;
  } finally {
    window.clearTimeout(timeout);
  }
}

export async function loadMillidaFriendsFromCore(): Promise<MillidaFriendsSnapshot> {
  const result = await invoke<unknown>('millida_friends_snapshot');
  const record = asRecord(result);
  const friends = listFrom(record.friends, ['friends', 'items']).map(normalizeFriend).filter(Boolean) as Friend[];
  const requests = listFrom(record.requests, ['requests', 'items']).map(value => {
    const item = asRecord(value);
    const uuid = String(item.uuid ?? item.user_id ?? item.userId ?? item.id ?? '');
    return { id: String(item.id ?? uuid), uuid, username: String(item.username ?? item.name ?? ''), createdAt: typeof item.created_at === 'string' ? item.created_at : undefined };
  }).filter(request => request.uuid && request.username);
  return { friends, requests, available: record.available !== false };
}

export async function loadMillidaFriends(accessToken: string): Promise<MillidaFriendsSnapshot> {
  const [friendsResult, requestsResult] = await Promise.all([
    request<unknown>('/friends', accessToken),
    request<unknown>('/friends/requests', accessToken).catch(() => []),
  ]);
  const friends = listFrom(friendsResult, ['friends', 'items']).map(normalizeFriend).filter(Boolean) as Friend[];
  const requests = listFrom(requestsResult, ['requests', 'items']).map(value => {
    const item = asRecord(value);
    const uuid = String(item.uuid ?? item.user_id ?? item.userId ?? item.id ?? '');
    return { id: String(item.id ?? uuid), uuid, username: String(item.username ?? item.name ?? ''), createdAt: typeof item.created_at === 'string' ? item.created_at : undefined };
  }).filter(request => request.uuid && request.username);
  return { friends, requests, available: true };
}

export function isMillidaConfigured(accessToken?: string | null) {
  return Boolean(accessToken && accessToken.trim());
}

export async function sendMillidaMessage(accessToken: string, friendUuid: string, text: string) {
  return request<{ id?: string; timestamp?: string }>('/friends/chat/message', accessToken, {
    method: 'POST',
    body: JSON.stringify({ user_id: friendUuid, text }),
  });
}

export async function removeMillidaFriend(accessToken: string, friendUuid: string) {
  return request<void>(`/friends/${encodeURIComponent(friendUuid)}`, accessToken, { method: 'DELETE' });
}

export { MILLIDA_API };

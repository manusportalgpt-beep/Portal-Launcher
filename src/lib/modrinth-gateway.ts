import { invoke } from '@/lib/invoke-shim';
import type { ModrinthSearchResult } from '@/lib/tauri-bridge';
import { useSettingsStore } from '@/stores/settingsStore';

const ENV_GATEWAY_URL = (import.meta.env.VITE_PORTAL_MODRINTH_GATEWAY_URL || '').replace(/\/$/, '');
function configuredGatewayUrl() { const settings = useSettingsStore.getState(); const raw = settings.modrinthProxyEnabled && settings.modrinthProxyUrl ? settings.modrinthProxyUrl : ENV_GATEWAY_URL; return raw.replace(/\/$/, '').replace(/\/v2$/, ''); }
function allowOfficialFallback() { return useSettingsStore.getState().modrinthProxyAllowOfficialFallback !== false; }
const DIRECT_URL = 'https://api.modrinth.com/v2';
const REQUEST_TIMEOUT_MS = 22_000;
const MODRINTH_BLACK_HOST = 'modrinth.black';
const MODRINTH_BLACK_PROBE_TIMEOUT_MS = 4_500;
const MODRINTH_BLACK_COOLDOWN_MS = 10 * 60_000;
const MODRINTH_BLACK_COOLDOWN_KEY = 'portal-modrinth-black-unhealthy-until';
const unhealthyGatewayUntil = new Map<string, number>();

export interface ModrinthGatewayQuery {
  query: string;
  limit: number;
  offset: number;
  categories?: string[];
  versions?: string[];
  loaders?: string[];
  sort?: string;
  projectType?: string;
}

export type ModrinthSource = 'gateway' | 'rust' | 'official';
export interface ModrinthGatewayResult { data: ModrinthSearchResult; source: ModrinthSource; stale: boolean; }
const memoryCache = new Map<string, { at: number; data: ModrinthSearchResult }>();
const CACHE_TTL_MS = 60_000;
const STALE_TTL_MS = 10 * 60_000;
const PERSISTENT_CACHE_PREFIX = 'portal-modrinth-gateway:v2:';

function cacheKey(query: ModrinthGatewayQuery) { return JSON.stringify(query); }
function readPersistentCache(key: string): { at: number; data: ModrinthSearchResult } | null {
  try {
    const raw = localStorage.getItem(`${PERSISTENT_CACHE_PREFIX}${key}`);
    if (!raw) return null;
    const entry = JSON.parse(raw) as { at: number; data: ModrinthSearchResult };
    return entry?.data ? entry : null;
  } catch { return null; }
}
function writePersistentCache(key: string, entry: { at: number; data: ModrinthSearchResult }) {
  try { localStorage.setItem(`${PERSISTENT_CACHE_PREFIX}${key}`, JSON.stringify(entry)); } catch { /* optional cache */ }
}
function storeSearchCache(key: string, data: ModrinthSearchResult) {
  const entry = { at: Date.now(), data };
  memoryCache.set(key, entry);
  writePersistentCache(key, entry);
}

function withTimeout<T>(promise: Promise<T>, ms: number) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error('Modrinth request timed out')), ms);
  });
  return Promise.race([promise, timeout]).finally(() => timer && clearTimeout(timer)) as Promise<T>;
}

function gatewayHost(base: string): string {
  try { return new URL(base).hostname.toLowerCase(); } catch { return ''; }
}

function isModrinthBlack(base: string): boolean {
  return gatewayHost(base) === MODRINTH_BLACK_HOST;
}

function assertGatewayReady(base: string): void {
  let until = unhealthyGatewayUntil.get(base) ?? 0;
  if (!until && isModrinthBlack(base)) {
    try { until = Number(localStorage.getItem(MODRINTH_BLACK_COOLDOWN_KEY) || 0); } catch { /* optional cache */ }
  }
  if (until > Date.now()) throw new Error(`gateway cooling down for ${Math.ceil((until - Date.now()) / 1000)}s`);
}

function markGatewayUnavailable(base: string): void {
  if (!isModrinthBlack(base)) return;
  const until = Date.now() + MODRINTH_BLACK_COOLDOWN_MS;
  unhealthyGatewayUntil.set(base, until);
  try { localStorage.setItem(MODRINTH_BLACK_COOLDOWN_KEY, String(until)); } catch { /* optional cache */ }
}

async function gatewayFetch(base: string, path: string, body?: unknown): Promise<Response> {
  assertGatewayReady(base);
  try {
    const response = await withTimeout(fetch(`${base}${path}`, {
      method: body === undefined ? 'GET' : 'POST',
      headers: { ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), Accept: 'application/json', 'User-Agent': 'PortalLauncher/1.0' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    }), isModrinthBlack(base) ? MODRINTH_BLACK_PROBE_TIMEOUT_MS : REQUEST_TIMEOUT_MS);
    const contentType = response.headers.get('content-type') || '';
    if (!response.ok || !contentType.includes('application/json')) {
      markGatewayUnavailable(base);
      throw new Error(`gateway:${response.status || 'non-json'}`);
    }
    return response;
  } catch (error) {
    markGatewayUnavailable(base);
    throw error;
  }
}

function appendParam(params: URLSearchParams, key: string, values?: string[]) {
  if (values?.length) params.set(key, JSON.stringify(values));
}

async function officialFetch(url: string): Promise<Response> {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const response = await fetch(url, { headers: { Accept: 'application/json', 'User-Agent': 'PortalLauncher/1.0 (+https://github.com/Portalrolls/Portal-Launcher)' } });
    if (response.ok) return response;
    const retryable = response.status === 429 || response.status >= 500;
    if (!retryable || attempt === 2) return response;
    const retryAfter = Number(response.headers.get('Retry-After') || 0);
    await new Promise(resolve => setTimeout(resolve, Math.min(4000, retryAfter > 0 ? retryAfter * 1000 : 500 * (attempt + 1))));
  }
  throw new Error('Modrinth official request exhausted');
}

function directSearch(query: ModrinthGatewayQuery) {
  const params = new URLSearchParams({
    query: query.query,
    limit: String(query.limit),
    offset: String(query.offset),
    index: query.sort?.toLowerCase() === 'relevance' ? 'relevance' : query.sort?.toLowerCase() || 'relevance',
  });
  appendParam(params, 'facets', [
    ...(query.projectType ? [`project_type:${query.projectType}`] : []),
    ...(query.categories ?? []).map(value => `categories:${value}`),
    ...(query.versions ?? []).map(value => `versions:${value}`),
    ...(query.loaders ?? []).map(value => `categories:${value}`),
  ]);
  return withTimeout(officialFetch(`${DIRECT_URL}/search?${params.toString()}`).then(async response => {
    if (!response.ok) throw new Error(`Modrinth API ${response.status}`);
    return response.json() as Promise<ModrinthSearchResult>;
  }), REQUEST_TIMEOUT_MS);
}

async function gatewayJson<T>(path: string, body?: unknown): Promise<T> {
  const base = configuredGatewayUrl();
  if (!base) throw new Error('gateway not configured');
  const response = await gatewayFetch(base, path, body);
  return response.json() as Promise<T>;
}

export async function getModrinthProjectGateway(projectId: string | undefined): Promise<any> {
  const normalized = projectId || '';
  const id = encodeURIComponent(normalized);
  const attempts: Array<Promise<any>> = [withTimeout(invoke<any>('get_modrinth_project', { projectId: normalized }), REQUEST_TIMEOUT_MS)];
  if (configuredGatewayUrl()) attempts.unshift(gatewayJson<any>(`/v2/project/${id}`));
  try { return await Promise.any(attempts); }
  catch { throw new Error('Modrinth project metadata is unavailable'); }
}

export async function getModrinthVersionsGateway(projectId: string | undefined, gameVersion?: string, loader?: string): Promise<any[]> {
  const normalized = projectId || '';
  const id = encodeURIComponent(normalized);
  const params = new URLSearchParams();
  if (gameVersion) params.set('game_version', gameVersion);
  if (loader) params.set('loader', loader);
  const suffix = `/v2/project/${id}/version${params.toString() ? `?${params.toString()}` : ''}`;
  const attempts: Array<Promise<any[]>> = [withTimeout(invoke<any[]>('get_modrinth_versions', { projectId: normalized, gameVersion: gameVersion || null, loader: loader || null }), REQUEST_TIMEOUT_MS)];
  if (configuredGatewayUrl()) attempts.unshift(gatewayJson<any[]>(suffix));
  try { return await Promise.any(attempts); }
  catch { throw new Error('Modrinth versions are unavailable'); }
}

export async function searchModrinthGateway(query: ModrinthGatewayQuery): Promise<ModrinthSearchResult> {
  const key = cacheKey(query);
  const cached = memoryCache.get(key) ?? readPersistentCache(key);
  if (cached) memoryCache.set(key, cached);
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) return cached.data;
  const failures: string[] = [];
  const gatewayUrl = configuredGatewayUrl();
  const attempts: Array<Promise<ModrinthSearchResult>> = [
    withTimeout(invoke<ModrinthSearchResult>('search_modrinth', query as unknown as Record<string, unknown>), REQUEST_TIMEOUT_MS),
  ];
  if (gatewayUrl) attempts.unshift(gatewayFetch(gatewayUrl, '/v2/search', query).then(response => response.json() as Promise<ModrinthSearchResult>));
  if (allowOfficialFallback()) attempts.push(directSearch(query));
  try {
    const result = await Promise.any(attempts);
    storeSearchCache(key, result);
    return result;
  } catch (error) {
    failures.push(error instanceof AggregateError ? error.errors.map((item: unknown) => item instanceof Error ? item.message : String(item)).join(' → ') : error instanceof Error ? error.message : 'transport failed');
  }
  if (cached && Date.now() - cached.at < STALE_TTL_MS) return cached.data;
  throw new Error(`Modrinth недоступен: ${failures.join(' → ')}`);
}

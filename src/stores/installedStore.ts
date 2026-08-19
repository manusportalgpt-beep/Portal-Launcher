import { create } from 'zustand';
import { invoke } from '@/lib/invoke-shim';

/**
 * Единый источник правды о том, что уже установлено в сборку.
 *
 * Раньше список модов и страница мода считали «установлено» каждая по-своему
 * (список — по project id, страница — по названию файла ещё до загрузки
 * проекта), из-за чего установленный мод на своей странице снова предлагал
 * «Install». Теперь обе поверхности читают этот store.
 */

export interface InstalledIndex {
  /** project id / slug / имя — всё в нижнем регистре */
  keys: Set<string>;
  loading: boolean;
  loadedAt: number;
}

interface InstalledState {
  byInstance: Record<string, InstalledIndex>;
  refresh: (instanceId: string, force?: boolean) => Promise<InstalledIndex>;
  mark: (instanceId: string, keys: (string | undefined | null)[]) => void;
  unmark: (instanceId: string, keys: (string | undefined | null)[]) => void;
  isInstalled: (instanceId: string | null | undefined, keys: (string | undefined | null)[]) => boolean;
}

const EMPTY: InstalledIndex = { keys: new Set(), loading: false, loadedAt: 0 };
const norm = (v: unknown) => String(v ?? '').trim().toLowerCase();

function collectKeys(mods: any[]): Set<string> {
  const keys = new Set<string>();
  for (const m of mods) {
    for (const v of [m?.id, m?.name, m?.slug, m?.project_id, m?.file_name]) {
      const k = norm(v);
      if (k) keys.add(k);
    }
    // «fabric-api-0.100.0.jar» → «fabric-api»
    const file = norm(m?.file_name).replace(/\.(jar|zip)(\.disabled)?$/, '');
    if (file) {
      keys.add(file);
      const stem = file.replace(/[-_ ]v?\d[\d.+\-a-z]*$/i, '');
      if (stem.length > 2) keys.add(stem);
    }
  }
  return keys;
}

export const useInstalledStore = create<InstalledState>((set, get) => ({
  byInstance: {},

  refresh: async (instanceId, force = false) => {
    if (!instanceId) return EMPTY;
    const cached = get().byInstance[instanceId];
    if (cached && !force && Date.now() - cached.loadedAt < 4000) return cached;
    set(s => ({ byInstance: { ...s.byInstance, [instanceId]: { ...(cached ?? EMPTY), loading: true } } }));
    try {
      const mods = await invoke<any[]>('get_instance_mods', { instanceId });
      const next: InstalledIndex = { keys: collectKeys(mods ?? []), loading: false, loadedAt: Date.now() };
      set(s => ({ byInstance: { ...s.byInstance, [instanceId]: next } }));
      return next;
    } catch {
      const next: InstalledIndex = { ...(cached ?? EMPTY), loading: false, loadedAt: Date.now() };
      set(s => ({ byInstance: { ...s.byInstance, [instanceId]: next } }));
      return next;
    }
  },

  mark: (instanceId, keys) => {
    if (!instanceId) return;
    set(s => {
      const cur = s.byInstance[instanceId] ?? EMPTY;
      const next = new Set(cur.keys);
      keys.map(norm).filter(Boolean).forEach(k => next.add(k));
      return { byInstance: { ...s.byInstance, [instanceId]: { ...cur, keys: next } } };
    });
  },

  unmark: (instanceId, keys) => {
    if (!instanceId) return;
    set(s => {
      const cur = s.byInstance[instanceId] ?? EMPTY;
      const next = new Set(cur.keys);
      keys.map(norm).filter(Boolean).forEach(k => next.delete(k));
      return { byInstance: { ...s.byInstance, [instanceId]: { ...cur, keys: next } } };
    });
  },

  isInstalled: (instanceId, keys) => {
    if (!instanceId) return false;
    const idx = get().byInstance[instanceId];
    if (!idx) return false;
    return keys.map(norm).filter(Boolean).some(k => idx.keys.has(k));
  },
}));

/** Хук: подписка на статус установки конкретного проекта. */
export function useIsInstalled(instanceId: string | null | undefined, keys: (string | undefined | null)[]) {
  return useInstalledStore(s => {
    if (!instanceId) return false;
    const idx = s.byInstance[instanceId];
    if (!idx) return false;
    return keys.map(k => String(k ?? '').trim().toLowerCase()).filter(Boolean).some(k => idx.keys.has(k));
  });
}

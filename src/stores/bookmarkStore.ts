import { create } from 'zustand';
import { invoke } from '@/lib/invoke-shim';

export interface BookmarkMod {
  source: string;
  project_id: string;
  version_id: string;
  file_id: string;
  name: string;
  author?: string | null;
  icon_url?: string | null;
  kind: string;
  mc_version?: string | null;
  loader?: string | null;
  file_name: string;
  url?: string | null;
}

export interface Bookmark {
  id: string;
  name: string;
  loader: string;
  mc_version: string;
  loader_version: string;
  created_at: string;
  mods: BookmarkMod[];
}

export interface BookmarkModReport {
  project_id: string;
  name: string;
  author?: string | null;
  icon_url?: string | null;
  description: string;
  kind: string;
  resolved_version?: string | null;
  resolved_file_name?: string | null;
  resolved_url?: string | null;
  bookmark_version?: string | null;
  compatible: boolean;
  reason: string;
}

export interface BookmarkCompatReport {
  mc_version: string;
  loader: string;
  exact_match: boolean;
  loader_match: boolean;
  version_match: boolean;
  total: number;
  compatible: number;
  incompatible: number;
  mods: BookmarkModReport[];
}

export interface BookmarkApplyResult {
  installed: number;
  skipped: number;
  failed: string[];
}

interface BookmarkState {
  bookmarks: Bookmark[];
  activeId: string | null;
  loading: boolean;
  /** Отчёт совместимости для выбранной сборки, показывается в подтверждении. */
  report: BookmarkCompatReport | null;
  reportLoading: boolean;
  /** Итог последнего применения — показывается после завершения. */
  applied: BookmarkApplyResult | null;
  refresh: () => Promise<void>;
  create: (name: string, loader: string, mcVersion: string, loaderVersion: string) => Promise<Bookmark>;
  rename: (id: string, name: string) => Promise<void>;
  remove: (id: string) => Promise<void>;
  select: (id: string | null) => void;
  addMod: (id: string, projectId: string, kind: string) => Promise<void>;
  removeMod: (id: string, projectId: string) => Promise<void>;
  checkCompatibility: (id: string, instanceId: string) => Promise<BookmarkCompatReport | null>;
  apply: (id: string, instanceId: string, force: boolean) => Promise<BookmarkApplyResult | null>;
  clearReport: () => void;
}

/**
 * Закладки — не сборки, поэтому и стор отдельный: здесь нет ни папки игры, ни
 * настроек запуска. Хранит только список и последний отчёт о применении.
 * Источник истины — диск, стор — кэш поверх него, чтобы после записи не
 * приходилось перечитывать файл.
 */
export const useBookmarkStore = create<BookmarkState>((set, get) => ({
  bookmarks: [],
  activeId: null,
  loading: false,
  report: null,
  reportLoading: false,
  applied: null,

  refresh: async () => {
    set({ loading: true });
    try {
      const list = await invoke<Bookmark[]>('get_bookmarks');
      set({ bookmarks: Array.isArray(list) ? list : [] });
    } catch {
      set({ bookmarks: [] });
    } finally {
      set({ loading: false });
    }
  },

  create: async (name, loader, mcVersion, loaderVersion) => {
    const bookmark = await invoke<Bookmark>('create_bookmark', {
      name, loader, mcVersion, loaderVersion,
    });
    await get().refresh();
    set({ activeId: bookmark.id });
    return bookmark;
  },

  rename: async (id, name) => {
    await invoke<Bookmark[]>('rename_bookmark', { id, name });
    await get().refresh();
  },

  remove: async (id) => {
    await invoke('delete_bookmark', { id });
    const next = { ...get(), activeId: get().activeId === id ? null : get().activeId };
    set({ report: null, applied: null });
    await next.refresh();
  },

  select: (id) => set({ activeId: id, report: null, applied: null }),

  addMod: async (id, projectId, kind) => {
    const updated = await invoke<Bookmark>('add_mod_to_bookmark', {
      bookmarkId: id, projectId, kind,
    });
    set({ bookmarks: get().bookmarks.map(b => (b.id === id ? updated : b)) });
  },

  removeMod: async (id, projectId) => {
    const updated = await invoke<Bookmark>('remove_mod_from_bookmark', {
      bookmarkId: id, projectId,
    });
    set({ bookmarks: get().bookmarks.map(b => (b.id === id ? updated : b)) });
  },

  checkCompatibility: async (id, instanceId) => {
    set({ reportLoading: true, applied: null });
    try {
      const report = await invoke<BookmarkCompatReport>('bookmark_compatibility', {
        bookmarkId: id, instanceId,
      });
      set({ report, reportLoading: false });
      return report;
    } catch (e) {
      set({ reportLoading: false });
      console.warn('bookmark_compatibility failed', e);
      return null;
    }
  },

  apply: async (id, instanceId, force) => {
    set({ reportLoading: true });
    try {
      const result = await invoke<BookmarkApplyResult>('apply_bookmark', {
        bookmarkId: id, instanceId, force,
      });
      set({ applied: result, reportLoading: false, report: null });
      return result;
    } catch (e) {
      set({ reportLoading: false });
      console.warn('apply_bookmark failed', e);
      return null;
    }
  },

  clearReport: () => set({ report: null, applied: null }),
}));
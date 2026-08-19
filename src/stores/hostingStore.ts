import { create } from 'zustand';
import { invoke } from '@/lib/invoke-shim';

export interface HostingState {
  keyConfigured: boolean;
  server: Record<string, unknown> | null;
  status: Record<string, unknown> | null;
  console: string;
  files: Array<Record<string, unknown>>;
  backups: Array<Record<string, unknown>>;
  busy: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  loadConsole: () => Promise<void>;
  loadFiles: (path?: string) => Promise<void>;
  loadBackups: () => Promise<void>;
  createBackup: () => Promise<void>;
  saveKey: (value: string) => Promise<void>;
  clearKey: () => Promise<void>;
  start: () => Promise<void>;
  stop: () => Promise<void>;
  restart: () => Promise<void>;
  sendCommand: (command: string) => Promise<void>;
}

export const useHostingStore = create<HostingState>((set, get) => ({
  keyConfigured: false,
  server: null,
  status: null,
  console: '',
  files: [],
  backups: [],
  busy: false,
  error: null,

  refresh: async () => {
    set({ error: null });
    try {
      const keyConfigured = await invoke<boolean>('millida_hosting_key_status');
      if (!keyConfigured) { set({ keyConfigured: false, server: null, status: null, console: '', files: [], backups: [] }); return; }
      const [server, status] = await Promise.all([
        invoke<Record<string, unknown>>('millida_hosting_get_server'),
        invoke<Record<string, unknown>>('millida_hosting_get_status'),
      ]);
      set({ keyConfigured: true, server, status });
    } catch (error) {
      set({ keyConfigured: true, error: error instanceof Error ? error.message : String(error) });
    }
  },

  loadConsole: async () => {
    set({ busy: true, error: null });
    try {
      const consoleText = await invoke<string>('millida_hosting_get_console');
      set({ console: consoleText });
    } catch (error) {
      set({ error: error instanceof Error ? error.message : String(error) });
    } finally { set({ busy: false }); }
  },

  loadFiles: async (path) => {
    set({ busy: true, error: null });
    try {
      const result = await invoke<unknown>('millida_hosting_list_files', { path: path || null });
      const record = result && typeof result === 'object' ? result as Record<string, unknown> : {};
      const files = Array.isArray(result) ? result : Array.isArray(record.files) ? record.files : Array.isArray(record.items) ? record.items : [];
      set({ files: files as Array<Record<string, unknown>> });
    } catch (error) { set({ error: error instanceof Error ? error.message : String(error) }); }
    finally { set({ busy: false }); }
  },

  loadBackups: async () => {
    set({ busy: true, error: null });
    try {
      const result = await invoke<unknown>('millida_hosting_get_backups');
      const record = result && typeof result === 'object' ? result as Record<string, unknown> : {};
      const backups = Array.isArray(result) ? result : Array.isArray(record.backups) ? record.backups : Array.isArray(record.items) ? record.items : [];
      set({ backups: backups as Array<Record<string, unknown>> });
    } catch (error) { set({ error: error instanceof Error ? error.message : String(error) }); }
    finally { set({ busy: false }); }
  },

  createBackup: async () => {
    set({ busy: true, error: null });
    try { await invoke('millida_hosting_create_backup'); await get().loadBackups(); }
    catch (error) { set({ error: error instanceof Error ? error.message : String(error) }); }
    finally { set({ busy: false }); }
  },

  saveKey: async (value) => {
    set({ busy: true, error: null });
    try { await invoke('millida_hosting_save_key', { apiKey: value }); await get().refresh(); }
    catch (error) { set({ error: error instanceof Error ? error.message : String(error) }); }
    finally { set({ busy: false }); }
  },

  clearKey: async () => {
    set({ busy: true, error: null });
    try { await invoke('millida_hosting_clear_key'); set({ keyConfigured: false, server: null, status: null, console: '', files: [], backups: [] }); }
    catch (error) { set({ error: error instanceof Error ? error.message : String(error) }); }
    finally { set({ busy: false }); }
  },

  start: async () => { set({ busy: true, error: null }); try { await invoke('millida_hosting_start'); await get().refresh(); } catch (error) { set({ error: error instanceof Error ? error.message : String(error) }); } finally { set({ busy: false }); } },
  stop: async () => { set({ busy: true, error: null }); try { await invoke('millida_hosting_stop'); await get().refresh(); } catch (error) { set({ error: error instanceof Error ? error.message : String(error) }); } finally { set({ busy: false }); } },
  restart: async () => { set({ busy: true, error: null }); try { await invoke('millida_hosting_restart'); await get().refresh(); } catch (error) { set({ error: error instanceof Error ? error.message : String(error) }); } finally { set({ busy: false }); } },
  sendCommand: async (command) => { set({ busy: true, error: null }); try { await invoke('millida_hosting_command', { command }); } catch (error) { set({ error: error instanceof Error ? error.message : String(error) }); } finally { set({ busy: false }); } },
}));

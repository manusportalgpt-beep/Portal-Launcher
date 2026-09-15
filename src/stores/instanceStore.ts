import { create } from 'zustand';
import { persist, type StateStorage, type StorageValue } from 'zustand/middleware';

export interface Instance {
  id: string;
  name: string;
  description: string;
  iconPath?: string;
  minecraftVersion: string;
  modLoader: 'vanilla' | 'forge' | 'fabric' | 'quilt' | 'neoforge' | 'optifine' | 'labymod' | 'bedrock';
  modLoaderVersion?: string;
  javaPath?: string;
  jvmArgs?: string;
  minRam: number;
  maxRam: number;
  gameDir: string;
  createdAt: string;
  lastPlayed?: string;
  totalPlayTime: number;
  color: string;
  group?: string;
  installStatus?: 'idle' | 'partial';
}

interface InstanceState {
  instances: Instance[];
  selectedId: string | null;
  add: (inst: Instance) => void;
  update: (id: string, partial: Partial<Instance>) => void;
  remove: (id: string) => void;
  select: (id: string | null) => void;
  duplicate: (id: string) => void;
  syncFromBackend: (backendInstances: any[]) => void;
}

const COLORS = ['#6C5CE7','#E74C3C','#2ECC71','#3498DB','#F39C12','#E91E63','#1BD96A','#9B59B6'];

// Lightweight serializer that strips heavy fields before saving to localStorage
function serializeLightweight(state: InstanceState): StorageValue<InstanceState> {
  const lightInstances = state.instances.map(inst => ({
    ...inst,
    // Remove base64 icons and other heavy data - they'll be re-synced from backend
    iconPath: undefined,
    description: inst.description || '',
  }));
  return {
    state: { ...state, instances: lightInstances },
  };
}

// Slim the persisted payload down to fit the localStorage quota when it overflows.
type SlimInstance = {
  id: string; name: string; description: string;
  minecraftVersion: string; modLoader: Instance['modLoader'];
  modLoaderVersion?: string; javaPath?: string; jvmArgs?: string;
  minRam: number; maxRam: number; createdAt: string;
  lastPlayed?: string; totalPlayTime: number; color: string;
  group?: string; installStatus?: 'idle' | 'partial';
};
function slimInstances(value: string): string | null {
  try {
    const parsed = JSON.parse(value);
    const state = parsed?.state ?? {};
    const instances = Array.isArray(state.instances) ? state.instances : [];
    const slimmed: SlimInstance[] = instances.map((inst: any) => ({
      id: String(inst?.id ?? ''),
      name: String(inst?.name ?? ''),
      description: String(inst?.description ?? '').slice(0, 200),
      minecraftVersion: String(inst?.minecraftVersion ?? ''),
      modLoader: ((inst?.modLoader || 'vanilla') as Instance['modLoader']),
      modLoaderVersion: String(inst?.modLoaderVersion ?? ''),
      javaPath: String(inst?.javaPath ?? ''),
      jvmArgs: String(inst?.jvmArgs ?? ''),
      minRam: Number(inst?.minRam ?? 0),
      maxRam: Number(inst?.maxRam ?? 0),
      createdAt: String(inst?.createdAt ?? ''),
      lastPlayed: inst?.lastPlayed ? String(inst.lastPlayed) : undefined,
      totalPlayTime: Number(inst?.totalPlayTime ?? 0),
      color: String(inst?.color ?? ''),
      group: inst?.group ? String(inst.group) : undefined,
      installStatus: inst?.installStatus || undefined,
    }));
    return JSON.stringify({ ...parsed, state: { ...state, instances: slimmed } });
  } catch {
    return null;
  }
}

// localStorage wrapper that NEVER lets a quota/write failure take down the app.
// Instances are a cache anyway — the Rust backend re-syncs them on every launch,
// so on overflow we drop the least-important fields, then degrade to in-memory.
function instanceLocalStorage(): StateStorage {
  return {
    getItem: (key) => {
      try { return window.localStorage.getItem(key); } catch { return null; }
    },
    setItem: (key, value) => {
      try {
        window.localStorage.setItem(key, value);
      } catch {
        const slimmed = slimInstances(value);
        try {
          if (slimmed !== null) window.localStorage.setItem(key, slimmed);
        } catch {
          console.warn('[instances] localStorage quota exceeded — keeping instances in memory only');
        }
      }
    },
    removeItem: (key) => {
      try { window.localStorage.removeItem(key); } catch { /* ignore */ }
    },
  };
}

export const useInstanceStore = create<InstanceState>()(
  persist(
    (set, get) => ({
      instances: [],
      selectedId: null,
      add: (inst) => set((s) => ({ instances: [...s.instances, inst] })),
      update: (id, partial) => set((s) => ({ instances: s.instances.map(i => i.id === id ? { ...i, ...partial } : i) })),
      remove: (id) => set((s) => ({ instances: s.instances.filter(i => i.id !== id) })),
      select: (id) => set({ selectedId: id }),
      duplicate: (id) => {
        const orig = get().instances.find(i => i.id === id);
        if (!orig) return;
        // Use a folder-name-shaped id ("name-XXXXXXXX") so the on-disk folder
        // gets a human-readable name and matches what the Rust backend creates.
        const slug = orig.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'instance';
        const shortId = Math.random().toString(36).slice(2, 10);
        const copy: Instance = {
          ...orig,
          id: `${slug}-copy-${shortId}`,
          name: `${orig.name} (Copy)`,
          createdAt: new Date().toISOString(),
          totalPlayTime: 0,
          color: COLORS[Math.floor(Math.random() * COLORS.length)],
        };
        set((s) => ({ instances: [...s.instances, copy] }));
      },
      // Sync instances from Rust backend - called on app mount
      syncFromBackend: (backendInstances) => {
        const mapped = backendInstances.map(b => ({
          id: b.id,
          name: b.name,
          description: b.description || '',
          iconPath: b.icon,
          minecraftVersion: b.mc_version,
          modLoader: (b.loader || 'vanilla') as Instance['modLoader'],
          modLoaderVersion: b.loader_version || '',
          javaPath: b.java_path || '',
          jvmArgs: b.custom_jvm_args || '',
          minRam: b.min_ram,
          maxRam: b.max_ram,
          gameDir: '',
          createdAt: b.created_at,
          lastPlayed: b.last_played,
          totalPlayTime: b.play_time_minutes || 0,
          color: b.color || COLORS[Math.floor(Math.random() * COLORS.length)],
          group: undefined,
          installStatus: 'idle' as const,
        }));
        set({ instances: mapped });
      },
    }),
    {
      name: 'portal-instances-v2',
      storage: instanceLocalStorage(),
      // Persist only the essential fields; icons and long descriptions live on
      // disk via the backend and are re-synced through syncFromBackend().
      partialize: (state) => ({
        selectedId: state.selectedId,
        instances: state.instances.map(inst => ({
          id: inst.id,
          name: inst.name,
          description: (inst.description || '').slice(0, 500),
          minecraftVersion: inst.minecraftVersion,
          modLoader: inst.modLoader,
          modLoaderVersion: inst.modLoaderVersion || '',
          javaPath: inst.javaPath || '',
          jvmArgs: inst.jvmArgs || '',
          minRam: inst.minRam,
          maxRam: inst.maxRam,
          createdAt: inst.createdAt,
          lastPlayed: inst.lastPlayed,
          totalPlayTime: inst.totalPlayTime,
          color: inst.color,
          group: inst.group,
          installStatus: inst.installStatus,
        })),
      }),
    }
  )
);

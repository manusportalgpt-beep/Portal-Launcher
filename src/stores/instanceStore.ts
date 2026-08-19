import { create } from 'zustand';
import { persist } from 'zustand/middleware';

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
}

interface InstanceState {
  instances: Instance[];
  selectedId: string | null;
  add: (inst: Instance) => void;
  update: (id: string, partial: Partial<Instance>) => void;
  remove: (id: string) => void;
  select: (id: string | null) => void;
  duplicate: (id: string) => void;
}

const COLORS = ['#6C5CE7','#E74C3C','#2ECC71','#3498DB','#F39C12','#E91E63','#1BD96A','#9B59B6'];

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
    }),
    { name: 'portal-instances-v2' }
  )
);

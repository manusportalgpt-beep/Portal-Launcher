import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export type LayoutMode = 'standard' | 'innovative' | 'extended';

export interface ExtendedLayoutConfig {
  sidebarIcons: Record<string, string>;
  sidebarOrder: string[];
  colorAccent: string;
  compactMode: boolean;
}

interface LayoutState {
  mode: LayoutMode;
  setMode: (mode: LayoutMode) => void;
  extended: ExtendedLayoutConfig;
  updateExtended: (partial: Partial<ExtendedLayoutConfig>) => void;
}

export const useLayoutStore = create<LayoutState>()(
  persist(
    (set) => ({
      mode: 'standard',
      setMode: (mode) => set({ mode }),
      extended: {
        sidebarIcons: {},
        sidebarOrder: ['home', 'discover', 'library', 'skins', 'settings'],
        colorAccent: '#DA2A3F',
        compactMode: false,
      },
      updateExtended: (partial) => set((s) => ({ extended: { ...s.extended, ...partial } })),
    }),
    { name: 'portal-layout-mode' },
  ),
);

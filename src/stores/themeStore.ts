import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { themes, type CustomThemeDefinition, type ThemeId } from '@/lib/theme-engine';

type CustomThemeColors = {
  background: string;
  surface: string;
  surfaceHover: string;
  surfaceActive: string;
  primary: string;
  outline: string;
  outlineStrong: string;
  text: string;
  mutedText: string;
  success: string;
  warning: string;
  error: string;
  info: string;
};

export type CustomThemeOptions = {
  radiusScale: number;
  shadowStrength: number;
  glowStrength: number;
  font: string;
};

interface ThemeState {
  themeId: ThemeId;
  customThemes: Record<string, CustomThemeDefinition>;
  setTheme: (themeId: ThemeId) => void;
  addCustomTheme: (name: string, colors: CustomThemeColors, options?: Partial<CustomThemeOptions>) => string;
  deleteCustomTheme: (themeId: string) => void;
}

function mix(hex: string, amount: number): string {
  const clean = hex.replace('#', '').padEnd(6, '0').slice(0, 6);
  const n = Number.parseInt(clean, 16) || 0;
  const target = amount >= 0 ? 255 : 0;
  const a = Math.min(Math.abs(amount), 1);
  const r = Math.round(((n >> 16) & 255) + (target - ((n >> 16) & 255)) * a);
  const g = Math.round(((n >> 8) & 255) + (target - ((n >> 8) & 255)) * a);
  const b = Math.round((n & 255) + (target - (n & 255)) * a);
  return `#${[r, g, b].map(v => v.toString(16).padStart(2, '0')).join('')}`;
}

function buildCustomTheme(id: string, name: string, c: CustomThemeColors, options: CustomThemeOptions): CustomThemeDefinition {
  const dark = true;
  return {
    id,
    name,
    isDark: dark,
    colors: {
      background: c.background,
      surface: c.surface,
      surfaceHover: c.surfaceHover,
      surfaceActive: c.surfaceActive,
      border: c.outline,
      borderStrong: c.outlineStrong,
      text: c.text,
      textSecondary: c.mutedText,
      textTertiary: mix(c.mutedText, -0.2),
      primary: c.primary,
      primaryHover: mix(c.primary, 0.18),
      primaryText: '#FFFFFF',
      success: c.success,
      warning: c.warning,
      error: c.error,
      info: c.info,
      curseforge: '#F16436',
      modrinth: '#1BD96A',
    },
    radii: Object.fromEntries(Object.entries(themes.dark.radii).map(([key, value]) => [key, `${Math.max(0, Math.round(Number.parseFloat(value) * options.radiusScale))}px`])) as typeof themes.dark.radii,
    shadows: {
      sm: `0 1px 3px rgba(0,0,0,${0.28 * options.shadowStrength})`,
      md: `0 4px 18px rgba(0,0,0,${0.26 * options.shadowStrength})`,
      lg: `0 16px 44px rgba(0,0,0,${0.42 * options.shadowStrength})`,
      glow: `0 0 ${Math.round(28 * options.glowStrength)}px ${c.primary}66`,
    },
    font: options.font,
  };
}

export const useThemeStore = create<ThemeState>()(
  persist(
    (set) => ({
      themeId: 'system' as ThemeId,
      customThemes: {},
      setTheme: (themeId) => set({ themeId }),
      addCustomTheme: (name, colors, options) => {
        const id = `custom-${Date.now()}`;
        const resolvedOptions: CustomThemeOptions = { radiusScale: 1, shadowStrength: 1, glowStrength: 1, font: themes.dark.font, ...options };
        set(state => ({ customThemes: { ...state.customThemes, [id]: buildCustomTheme(id, name.trim() || 'My Theme', colors, resolvedOptions) }, themeId: id }));
        return id;
      },
      deleteCustomTheme: (themeId) => set(state => {
        const next = { ...state.customThemes };
        delete next[themeId];
        return { customThemes: next, themeId: state.themeId === themeId ? 'system' : state.themeId };
      }),
    }),
    { name: 'portal-launcher-theme' },
  ),
);

export type { CustomThemeColors };

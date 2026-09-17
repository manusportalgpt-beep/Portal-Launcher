import { useEffect } from 'react';

export type StylePreset = 'dawn' | 'standard' | 'glass' | 'quadral' | 'falloff' | 'abouts';

export const STYLE_PRESETS: Array<{ id: StylePreset; title: string; description: string }> = [
  { id: 'dawn', title: 'Dawn', description: 'Фирменная схема Portal Launcher: воздух Dawn + чёткие панели OreUI с мягкими тенями и свечением.' },
  { id: 'standard', title: 'Standard', description: 'Мягкие скругления во всём — как в iOS, macOS и современных лаунчерах.' },
  { id: 'glass', title: 'Glassmorphism', description: 'Прозрачные круглые панели с размытием и защищённой читаемостью.' },
  { id: 'quadral', title: 'Quadral', description: 'Чёткая квадратная схема Portal Launcher: линии, плотность и всё под рукой.' },
  { id: 'falloff', title: 'FallOff', description: 'Мягкая обычная схема с ромбовидными акцентами и наклонными маркерами.' },
  { id: 'abouts', title: 'AboutS', description: 'Спокойная системная схема: прямые окна, умеренные скругления и знакомая иерархия.' },
];

const styleTokens: Record<StylePreset, Record<string, string>> = {
  dawn: {
    '--radius-xs': '6px', '--radius-sm': '8px', '--radius-md': '10px', '--radius-lg': '12px', '--radius-xl': '16px',
    '--radius-button': '10px', '--radius-card': '14px', '--radius-modal': '18px',
    '--shadow-sm': '0 1px 2px rgba(0,0,0,0.28), 0 1px 0 rgba(255,255,255,0.03) inset',
    '--shadow-md': '0 6px 18px rgba(0,0,0,0.32), 0 0 0 1px rgba(255,255,255,0.045)',
    '--shadow-lg': '0 18px 44px rgba(0,0,0,0.40), 0 0 0 1px rgba(255,255,255,0.06)',
    '--shadow-glow': '0 0 0 1px color-mix(in srgb, var(--color-primary) 26%, transparent), 0 8px 26px color-mix(in srgb, var(--color-primary) 20%, transparent)',
    '--portal-glass-blur': '8px',
  },
  standard: {
    '--radius-xs': '8px', '--radius-sm': '10px', '--radius-md': '12px', '--radius-lg': '16px', '--radius-xl': '20px',
    '--radius-button': '10px', '--radius-card': '14px', '--radius-modal': '18px',
    '--shadow-sm': '0 1px 3px rgba(0,0,0,0.10)', '--shadow-md': '0 4px 12px rgba(0,0,0,0.14)',
    '--shadow-lg': '0 12px 32px rgba(0,0,0,0.20)', '--portal-glass-blur': '0px',
  },
  glass: {
    '--radius-xs': '8px', '--radius-sm': '10px', '--radius-md': '14px', '--radius-lg': '18px', '--radius-xl': '24px',
    '--radius-button': '14px', '--radius-card': '18px', '--radius-modal': '24px',
    '--shadow-sm': '0 2px 12px rgba(0, 0, 0, 0.18)', '--shadow-md': '0 12px 36px rgba(0, 0, 0, 0.22)',
    '--shadow-lg': '0 24px 64px rgba(0, 0, 0, 0.30)', '--portal-glass-blur': '32px',
    '--portal-glass-panel': 'rgba(255, 255, 255, 0.15)', '--portal-glass-panel-strong': 'rgba(255, 255, 255, 0.24)',
    '--portal-glass-edge': 'rgba(255, 255, 255, 0.42)', '--portal-glass-edge-soft': 'rgba(255, 255, 255, 0.17)',
    '--portal-glass-shadow': 'rgba(0, 0, 0, 0.30)',
  },
  quadral: {
    '--radius-xs': '0px', '--radius-sm': '1px', '--radius-md': '2px', '--radius-lg': '2px', '--radius-xl': '3px',
    '--radius-button': '2px', '--radius-card': '2px', '--radius-modal': '2px',
    '--shadow-sm': 'none', '--shadow-md': 'none', '--shadow-lg': 'none', '--portal-glass-blur': '0px',
  },
  falloff: {
    '--radius-xs': '10px', '--radius-sm': '14px', '--radius-md': '20px', '--radius-lg': '28px', '--radius-xl': '36px',
    '--radius-button': '9999px', '--radius-card': '24px', '--radius-modal': '32px',
    '--shadow-sm': '0 2px 8px rgba(0, 0, 0, 0.14)', '--shadow-md': '0 10px 30px rgba(0, 0, 0, 0.20)',
    '--shadow-lg': '0 24px 56px rgba(0, 0, 0, 0.28)', '--portal-glass-blur': '0px',
  },
  abouts: {
    '--radius-xs': '2px', '--radius-sm': '3px', '--radius-md': '4px', '--radius-lg': '6px', '--radius-xl': '8px',
    '--radius-button': '3px', '--radius-card': '4px', '--radius-modal': '8px',
    '--shadow-sm': '0 1px 2px rgba(0, 0, 0, 0.12)', '--shadow-md': '0 4px 14px rgba(0, 0, 0, 0.16)',
    '--shadow-lg': '0 14px 36px rgba(0, 0, 0, 0.22)', '--portal-glass-blur': '0px',
  },
};

export function applyStylePreset(preset: StylePreset) {
  const root = document.documentElement;
  Object.entries(styleTokens[preset]).forEach(([name, value]) => root.style.setProperty(name, value));
  root.dataset.portalStyle = preset;
}

export function useStylePreset(preset: StylePreset, themeRefreshKey?: string) {
  useEffect(() => applyStylePreset(preset), [preset, themeRefreshKey]);
}

/** Акцент по умолчанию для схемы Dawn — зелёная база интерфейса. */
export const DAWN_DEFAULT_ACCENT = '#2ECC71';

const ACCENT_PRESETS: Array<[string, string]> = [
  ['#2ECC71', '#27AE60'],
  ['#3c8527', '#347428'],
  ['#DA2A3F', '#EE3A50'],
  ['#4299E1', '#3182CE'],
  ['#8B5CF6', '#7C3AED'],
  ['#F59E0B', '#E08E0B'],
  ['#14B8A6', '#0D9488'],
  ['#E91E63', '#D81B60'],
];

/** Применяет цвет акцента схемы Dawn (или зелёный по умолчанию) ко всем токенам интерфейса. */
export function applyAccentColor(preset: StylePreset, accent: string | null) {
  const root = document.documentElement;
  const base = preset === 'dawn' ? (accent ?? DAWN_DEFAULT_ACCENT) : null;
  if (!base) {
    root.style.removeProperty('--color-primary');
    root.style.removeProperty('--color-primary-hover');
    root.style.removeProperty('--color-primary-dim');
    root.style.removeProperty('--color-primary-text');
    return;
  }
  const hover = ACCENT_PRESETS.find(([c]) => c.toLowerCase() === base.toLowerCase())?.[1]
    ?? `color-mix(in srgb, ${base} 84%, #000)`;
  root.style.setProperty('--color-primary', base);
  root.style.setProperty('--color-primary-hover', hover);
  root.style.setProperty('--color-primary-dim', base + '26');
  root.style.setProperty('--color-primary-text', '#FFFFFF');
}

export function useAccentColor(preset: StylePreset, accentColor: string | null, themeId?: string) {
  useEffect(() => applyAccentColor(preset, accentColor), [preset, accentColor, themeId]);
}

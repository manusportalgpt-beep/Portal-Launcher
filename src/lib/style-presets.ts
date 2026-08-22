import { useEffect } from 'react';

export type StylePreset = 'glass' | 'quadral' | 'falloff' | 'abouts';

export const STYLE_PRESETS: Array<{ id: StylePreset; title: string; description: string }> = [
  { id: 'glass', title: 'Glassmorphism', description: 'Прозрачные круглые панели с размытием и защищённой читаемостью.' },
  { id: 'quadral', title: 'Quadral', description: 'Чёткая квадратная схема Portal Launcher: линии, плотность и всё под рукой.' },
  { id: 'falloff', title: 'FallOff', description: 'Мягкая обычная схема с ромбовидными акцентами и наклонными маркерами.' },
  { id: 'abouts', title: 'AboutS', description: 'Спокойная системная схема: прямые окна, умеренные скругления и знакомая иерархия.' },
];

const styleTokens: Record<StylePreset, Record<string, string>> = {
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
    '--radius-xs': '4px', '--radius-sm': '6px', '--radius-md': '10px', '--radius-lg': '14px', '--radius-xl': '18px',
    '--radius-button': '8px', '--radius-card': '12px', '--radius-modal': '16px',
    '--shadow-sm': '0 2px 5px rgba(0, 0, 0, 0.13)', '--shadow-md': '0 8px 22px rgba(0, 0, 0, 0.18)',
    '--shadow-lg': '0 20px 48px rgba(0, 0, 0, 0.24)', '--portal-glass-blur': '0px',
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

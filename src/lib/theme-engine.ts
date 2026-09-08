import { useEffect } from 'react';
import type { FontFamily } from '@/stores/uiStore';

export type ThemeId = 'system' | 'light' | 'dark' | 'oled' | (string & {});

export interface ThemeDefinition {
  id: ThemeId;
  name: string;
  isDark: boolean;
  colors: {
    background: string; surface: string; surfaceHover: string; surfaceActive: string;
    border: string; borderStrong: string;
    text: string; textSecondary: string; textTertiary: string;
    primary: string; primaryHover: string; primaryText: string;
    success: string; warning: string; error: string; info: string;
    curseforge: string; modrinth: string;
  };
  radii: { xs:string; sm:string; md:string; lg:string; xl:string; full:string; button:string; card:string; modal:string; };
  shadows: { sm:string; md:string; lg:string; glow:string; };
  font: string;
}

const accents = {
  success:'#2ECC71', warning:'#F39C12', error:'#E74C3C', info:'#3498DB',
  curseforge:'#F16436', modrinth:'#1BD96A', primaryText:'#FFFFFF',
};
const radii = { xs:'2px', sm:'3px', md:'4px', lg:'6px', xl:'8px', full:'9999px', button:'5px', card:'8px', modal:'10px' };
const cleanRadii = { xs:'2px', sm:'3px', md:'4px', lg:'6px', xl:'8px', full:'9999px', button:'5px', card:'8px', modal:'10px' };
const cleanShadows = { sm:'0 1px 1px rgba(15,23,42,0.04)', md:'0 2px 8px rgba(15,23,42,0.06)', lg:'0 10px 24px rgba(15,23,42,0.10)', glow:'none' };
const cleanFont = "'Segoe UI Variable','Segoe UI',system-ui,-apple-system,sans-serif";

export const themes: Record<Exclude<ThemeId,'system'>, ThemeDefinition> = {
  light: {
    id:'light', name:'Light', isDark:false,
    colors:{
      background:'#FFFFFF', surface:'#F8F9FA', surfaceHover:'#F1F3F5', surfaceActive:'#E9ECEF',
      border:'#DEE2E6', borderStrong:'#CED4DA', text:'#1A1F26', textSecondary:'#5C6873', textTertiary:'#9AA5B1',
      primary:'#4299E1', primaryHover:'#3182CE', ...accents,
    },
    radii,
    shadows:{ sm:'0 1px 2px rgba(15,23,42,0.06)', md:'0 8px 24px rgba(15,23,42,0.08)', lg:'0 24px 48px rgba(15,23,42,0.12)', glow:'0 0 24px rgba(66,153,225,0.35)' },
    font:"'Inter',system-ui,sans-serif",
  },
  dark: {
    id:'dark', name:'Dark', isDark:true,
    colors:{
      background:'#16161A', surface:'#1D1D22', surfaceHover:'#26262C', surfaceActive:'#2E2E35',
      border:'#2E2E35', borderStrong:'#45454F',
      text:'#EDEDF0', textSecondary:'#9A9AA5', textTertiary:'#5C5C68',
      primary:'#DA2A3F', primaryHover:'#EE3A50', ...accents,
    },
    radii,
    shadows:{ sm:'0 1px 2px rgba(0,0,0,0.3)', md:'0 4px 16px rgba(0,0,0,0.4)', lg:'0 16px 40px rgba(0,0,0,0.6)', glow:'0 0 24px rgba(218,42,63,0.35)' },
    font:"'Inter',system-ui,sans-serif",
  },
  oled: {
    id:'oled', name:'OLED', isDark:true,
    colors:{
      background:'#000000', surface:'#0A0A0A', surfaceHover:'#141414', surfaceActive:'#1E1E1E',
      border:'#1A1A1A', borderStrong:'#2A2A2A',
      text:'#EDEDF0', textSecondary:'#8A8A95', textTertiary:'#555560',
      primary:'#DA2A3F', primaryHover:'#EE3A50', ...accents,
    },
    radii,
    shadows:{ sm:'0 1px 2px rgba(0,0,0,0.5)', md:'0 4px 16px rgba(0,0,0,0.6)', lg:'0 16px 40px rgba(0,0,0,0.8)', glow:'0 0 24px rgba(218,42,63,0.3)' },
    font:"'Inter',system-ui,sans-serif",
  },
};

const FONT_STACKS: Record<Exclude<FontFamily, 'theme'>, string> = {
  inter: "'Inter', system-ui, -apple-system, sans-serif",
  'space-grotesk': "'Space Grotesk', 'Inter', system-ui, sans-serif",
  manrope: "'Manrope', 'Inter', system-ui, sans-serif",
  montserrat: "'Montserrat', 'Inter', system-ui, sans-serif",
  outfit: "'Outfit', 'Inter', system-ui, sans-serif",
  play: "'Play', 'Inter', system-ui, sans-serif",
  comfortaa: "'Comfortaa', 'Inter', system-ui, sans-serif",
  oswald: "'Oswald', 'Inter', system-ui, sans-serif",
  'jetbrains-mono': "'JetBrains Mono', 'Courier New', monospace",
  pixel: "'Press Start 2P', 'Courier New', monospace",
};

function resolveSystemTheme(): Exclude<ThemeId,'system'> {
  if (typeof window === 'undefined') return 'dark';
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

export type CustomThemeDefinition = ThemeDefinition;

export function applyTheme(
  themeId: ThemeId,
  textOverride: 'auto' | 'black' | 'white' = 'auto',
  fontFamily: FontFamily = 'theme',
  customThemes: Record<string, CustomThemeDefinition> = {},
) {
  const resolved = themeId === 'system' ? resolveSystemTheme() : themeId;
  const t = customThemes[resolved] ?? themes[resolved as keyof typeof themes] ?? themes.dark;
  const r = document.documentElement.style;
  r.setProperty('--color-bg', t.colors.background);
  r.setProperty('--color-surface', t.colors.surface);
  r.setProperty('--color-surface-2', t.colors.surfaceHover);
  r.setProperty('--color-surface-hover', t.colors.surfaceHover);
  r.setProperty('--color-surface-active', t.colors.surfaceActive);
  r.setProperty('--color-border', t.colors.border);
  r.setProperty('--color-border-strong', t.colors.borderStrong);
  const textColor = textOverride === 'black' ? '#000000' : textOverride === 'white' ? '#FFFFFF' : t.colors.text;
  r.setProperty('--color-text', textColor);
  r.setProperty('--color-text-secondary', textOverride === 'auto' ? t.colors.textSecondary : (textOverride === 'black' ? '#2A2A2A' : '#D8D8D8'));
  r.setProperty('--color-text-tertiary', textOverride === 'auto' ? t.colors.textTertiary : (textOverride === 'black' ? '#5A5A5A' : '#AAAAAA'));
  r.setProperty('--color-primary', t.colors.primary);
  r.setProperty('--color-primary-hover', t.colors.primaryHover);
  r.setProperty('--color-primary-dim', t.colors.primary + '26');
  r.setProperty('--color-primary-text', t.colors.primaryText);
  r.setProperty('--color-success', t.colors.success);
  r.setProperty('--color-warning', t.colors.warning);
  r.setProperty('--color-error', t.colors.error);
  r.setProperty('--color-info', t.colors.info);
  r.setProperty('--color-curseforge', t.colors.curseforge);
  r.setProperty('--color-modrinth', t.colors.modrinth);
  r.setProperty('--radius-xs', cleanRadii.xs);
  r.setProperty('--radius-sm', cleanRadii.sm);
  r.setProperty('--radius-md', cleanRadii.md);
  r.setProperty('--radius-lg', cleanRadii.lg);
  r.setProperty('--radius-xl', cleanRadii.xl);
  r.setProperty('--radius-full', cleanRadii.full);
  r.setProperty('--radius-button', cleanRadii.button);
  r.setProperty('--radius-card', cleanRadii.card);
  r.setProperty('--radius-modal', cleanRadii.modal);
  r.setProperty('--shadow-sm', cleanShadows.sm);
  r.setProperty('--shadow-md', cleanShadows.md);
  r.setProperty('--shadow-lg', cleanShadows.lg);
  r.setProperty('--shadow-glow', cleanShadows.glow);
  r.setProperty('--font-ui', fontFamily === 'theme' ? cleanFont : FONT_STACKS[fontFamily]);
  document.documentElement.classList.toggle('dark', t.isDark);
  document.documentElement.dataset.theme = resolved;
  document.documentElement.dataset.designSystem = 'clean';
}

export function useTheme(
  themeId: ThemeId,
  textOverride: 'auto' | 'black' | 'white' = 'auto',
  fontFamily: FontFamily = 'theme',
  customThemes: Record<string, CustomThemeDefinition> = {},
) {
  useEffect(() => {
    applyTheme(themeId, textOverride, fontFamily, customThemes);
    if (themeId !== 'system') return;
    const mql = window.matchMedia('(prefers-color-scheme: dark)');
    const h = () => applyTheme('system', textOverride, fontFamily, customThemes);
    mql.addEventListener('change', h);
    return () => mql.removeEventListener('change', h);
  }, [themeId, textOverride, fontFamily, customThemes]);
}

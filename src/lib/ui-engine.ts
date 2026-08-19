import { useEffect } from 'react';
import { useUiStore } from '@/stores/uiStore';

const STYLE_ID = 'portal-prtheme';

/** Применяет пользовательский CSS (.prtheme) в head. */
export function applyCustomCss(css: string, enabled: boolean) {
  let el = document.getElementById(STYLE_ID) as HTMLStyleElement | null;
  if (!el) {
    el = document.createElement('style');
    el.id = STYLE_ID;
    document.head.appendChild(el);
  }
  el.textContent = enabled ? css : '';
}

/** Читает .prtheme / .css файл и возвращает его содержимое. */
export function readThemeFile(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result ?? ''));
    r.onerror = () => reject(new Error('Не удалось прочитать файл темы'));
    r.readAsText(file);
  });
}

/** Глобальные визуальные настройки: масштаб, радиусы, фон, анимации, custom CSS. */
export function useUiEffects() {
  const s = useUiStore();

  useEffect(() => {
    const root = document.documentElement;
    // Масштабируем типографику, но не сам document: CSS zoom сжимает Tauri
    // viewport и оставляет пустую область справа, особенно на широких экранах.
    root.style.setProperty('--ui-scale', String(s.uiScale / 100));
    root.style.fontSize = `${(16 * s.uiScale) / 100}px`;
    (root.style as any).zoom = '1';
  }, [s.uiScale]);

  useEffect(() => {
    const root = document.documentElement;
    root.style.setProperty('--radius-button', `${Math.max(0, s.cornerRadius - 2)}px`);
    root.style.setProperty('--radius-card', `${s.cornerRadius}px`);
    root.style.setProperty('--radius-modal', `${s.cornerRadius + 6}px`);
  }, [s.cornerRadius]);

  useEffect(() => {
    const root = document.documentElement;
    document.documentElement.classList.toggle('no-transition', !s.animations);
    root.dataset.blur = s.blur ? 'on' : 'off';
    root.dataset.density = s.compact ? 'compact' : 'normal';
    root.dataset.uiMode = s.uiMode;
    root.style.setProperty('--portal-motion-multiplier', String(Math.max(0.5, s.motionSpeed / 100)));
    root.style.setProperty('--portal-interface-opacity', String(Math.max(10, Math.min(100, s.interfaceOpacity)) / 100));
    root.style.setProperty('--portal-surface-opacity', String(Math.max(0, Math.min(100, s.surfaceOpacity)) / 100));
    root.style.setProperty('--portal-border-opacity', String(Math.max(0, Math.min(160, s.borderStrength)) / 100));
    root.style.setProperty('--portal-shadow-strength', String(Math.max(0, Math.min(160, s.shadowStrength)) / 100));
    root.style.setProperty('--portal-accent-glow-opacity', s.accentGlow ? String(Math.max(0, Math.min(160, s.accentGlowStrength)) / 100) : '0');
  }, [s.animations, s.blur, s.compact, s.uiMode, s.motionSpeed, s.interfaceOpacity, s.surfaceOpacity, s.borderStrength, s.shadowStrength, s.accentGlow, s.accentGlowStrength]);

  useEffect(() => {
    const root = document.documentElement;
    root.style.setProperty('--custom-bg', s.backgroundImage ? `url("${s.backgroundImage}")` : 'none');
    root.style.setProperty('--custom-bg-opacity', String(s.backgroundOpacity / 100));
    root.style.setProperty('--custom-bg-size', s.backgroundFit === 'stretch' ? '100% 100%' : s.backgroundFit === 'tile' ? 'auto' : s.backgroundFit);
    root.style.setProperty('--custom-bg-repeat', s.backgroundFit === 'tile' ? 'repeat' : 'no-repeat');
    root.style.setProperty('--custom-bg-position', s.backgroundPosition);
    root.style.setProperty('--custom-bg-blur', `${Math.max(0, s.backgroundBlur)}px`);
    root.style.setProperty('--custom-bg-saturation', `${Math.max(0, s.backgroundSaturation)}%`);
    root.style.setProperty('--custom-bg-scale', String(1 + Math.min(0.08, Math.max(0, s.backgroundBlur) / 300)));
    root.style.setProperty('--custom-bg-readability', String(Math.max(0, Math.min(90, s.backgroundReadability)) / 100));
  }, [s.backgroundImage, s.backgroundOpacity, s.backgroundFit, s.backgroundPosition, s.backgroundBlur, s.backgroundSaturation, s.backgroundReadability]);

  useEffect(() => {
    applyCustomCss(s.customCss, s.customCssEnabled);
  }, [s.customCss, s.customCssEnabled]);
}

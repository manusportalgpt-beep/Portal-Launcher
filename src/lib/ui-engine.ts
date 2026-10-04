import { useEffect } from 'react';
import { invoke } from '@/lib/invoke-shim';
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

/** CSS-файл пользователя, найденный на диске. */
export interface UiCssFile {
  css: string;
  name: string;
  path: string;
  origin: string;
}

/**
 * Подхватывает CSS-файл с диска, если в настройках его ещё нет.
 *
 * Раньше оформление лежало только в localStorage, и файл, положенный
 * пользователем (в том числе оставшийся от первой версии лаунчера), просто
 * игнорировался — отсюда «наш CSS файл не работает».
 */
export async function adoptUiCssFileFromDisk(): Promise<boolean> {
  const ui = useUiStore.getState();
  // Пользовательский выбор важнее файла на диске: если CSS уже есть, не трогаем.
  if (ui.customCss.trim()) return false;
  // Если пользователь сам выключил оформление, файл с диска больше не
  // включает его обратно. Раньше этот путь срабатывал при каждом запуске,
  // если текст CSS в хранилище оказывался пустым, и переключатель
  // «выглядел выключенным», а на следующем запуске оформление снова
  // включалось само.
  if (ui.customCssOptOut) return false;
  try {
    const found = await invoke<UiCssFile | null>('load_ui_css');
    if (!found || !found.css.trim()) return false;
    ui.set('customCss', found.css);
    ui.set('customCssName', found.name);
    ui.set('customCssEnabled', true);
    return true;
  } catch {
    return false;
  }
}

/**
 * Включение/выключение оформления из настроек.
 *
 * Флаг выключения ставится явно, а CSS применяется сразу, не дожидаясь
 * эффекта на стороне: иначе состояние переключателя и реально применённый
 * CSS расходились до следующего рендера.
 */
export function setCustomCssEnabled(enabled: boolean): void {
  const ui = useUiStore.getState();
  ui.set('customCssEnabled', enabled);
  ui.set('customCssOptOut', !enabled);
applyCustomCss(ui.customCss, enabled);
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
    // Выключенный фоновый режим должен полностью прятать и картинку, и видео.
    // Для картинки достаточно --custom-bg:none, а --custom-bg-opacity:1 делает
    // защитный слой body::after непрозрачным (он красит --color-bg поверх).
    const on = s.backgroundEnabled;
    // Если фон загружен файлом (IndexedDB) или это видео, его рисует
    // BackgroundMedia-компонент — CSS-слой должен быть пустым, иначе
    // картинка и видео накладываются друг на друга.
    const hasStoredMedia = Boolean(s.backgroundImageStored) || Boolean(s.backgroundVideo);
    const cssImage = on && !hasStoredMedia ? s.backgroundImage : '';
    root.style.setProperty('--custom-bg', cssImage ? `url("${cssImage}")` : 'none');
    root.style.setProperty('--custom-bg-opacity', on && !hasStoredMedia ? String(s.backgroundOpacity / 100) : '1');
    root.style.setProperty('--custom-bg-size', s.backgroundFit === 'stretch' ? '100% 100%' : s.backgroundFit === 'tile' ? 'auto' : s.backgroundFit);
    root.style.setProperty('--custom-bg-repeat', s.backgroundFit === 'tile' ? 'repeat' : 'no-repeat');
    root.style.setProperty('--custom-bg-position', s.backgroundPosition);
    root.style.setProperty('--custom-bg-blur', `${Math.max(0, s.backgroundBlur)}px`);
    root.style.setProperty('--custom-bg-saturation', `${Math.max(0, s.backgroundSaturation)}%`);
    root.style.setProperty('--custom-bg-scale', String(1 + Math.min(0.08, Math.max(0, s.backgroundBlur) / 300)));
    root.style.setProperty('--custom-bg-readability', String(Math.max(0, Math.min(90, s.backgroundReadability)) / 100));
  }, [s.backgroundEnabled, s.backgroundImage, s.backgroundImageStored, s.backgroundVideo, s.backgroundOpacity, s.backgroundFit, s.backgroundPosition, s.backgroundBlur, s.backgroundSaturation, s.backgroundReadability]);

  useEffect(() => {
    applyCustomCss(s.customCss, s.customCssEnabled);
  }, [s.customCss, s.customCssEnabled]);

  useEffect(() => {
    void adoptUiCssFileFromDisk();
  }, []);
}

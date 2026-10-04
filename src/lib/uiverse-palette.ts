/**
 * Палитры градиента интерфейса.
 *
 * Пользователь просил чёрно-красный градиент слева направо как основной, но с
 * возможностью выбрать другой. Палитра задаёт два цвета градиента
 * (`--grad-from` → `--grad-to`) и производное свечение. Значения хранятся в
 * localStorage и применяются атрибутом `data-palette` на <html>, поэтому
 * переключение мгновенное и не требует перерисовки React-дерева.
 *
 * Компоненты обязаны брать цвета из переменных, а не писать их в коде:
 * только так смена палитры реально влияет на всё оформление.
 */

import { create } from 'zustand';

export type PaletteId = 'crimson' | 'ember' | 'blood' | 'ice' | 'toxic' | 'mono' | 'rainbow';
/** Направление градиента: обычный слева направо или снизу вверх. */
export type AccentMode = 'default' | 'vertical' | 'rainbow';

export interface Palette {
  id: PaletteId;
  name: string;
  /** Начало градиента (левая сторона). */
  from: string;
  /** Конец градиента (правая сторона). */
  to: string;
  /** Цвет свечения/акцента для парящих элементов. */
  glow: string;
}

export const palettes: Palette[] = [
  { id: 'crimson', name: 'Crimson', from: '#000000', to: '#8B0000', glow: '#E01F26' },
  { id: 'ember', name: 'Ember', from: '#0A0000', to: '#C2410C', glow: '#FB923C' },
  { id: 'blood', name: 'Blood', from: '#1A0000', to: '#B00020', glow: '#FF2D55' },
  { id: 'ice', name: 'Ice', from: '#000000', to: '#0B3D91', glow: '#3B82F6' },
  { id: 'toxic', name: 'Toxic', from: '#000000', to: '#14532D', glow: '#22C55E' },
  { id: 'mono', name: 'Mono', from: '#0A0A0A', to: '#4B5563', glow: '#9CA3AF' },
  { id: 'rainbow', name: 'Rainbow', from: '#ff0040', to: '#2f80ed', glow: '#ff2d55' },
];

export const DEFAULT_PALETTE: PaletteId = 'crimson';
export const DEFAULT_ACCENT_MODE: AccentMode = 'default';

const STORAGE_KEY = 'portal.palette';

function safeRead(): string | null {
  try {
    return window.localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

function safeWrite(value: string): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, value);
  } catch {
    /* приватный режим — просто не сохраняем */
  }
}

export function getPalette(id: PaletteId): Palette {
  return palettes.find(p => p.id === id) ?? palettes[0];
}

/** Навешивает палитру на <html>: CSS-переменные иdata-атрибут для узнавания. */
export function applyPalette(id: PaletteId): void {
  const p = getPalette(id);
  const root = document.documentElement;
  root.setAttribute('data-palette', p.id);
  root.style.setProperty('--grad-from', p.from);
  root.style.setProperty('--grad-to', p.to);
  root.style.setProperty('--grad-glow', p.glow);
  root.style.setProperty('--grad', `linear-gradient(90deg, ${p.from} 0%, ${p.to} 100%)`);
  root.style.setProperty(
    '--grad-soft',
    `linear-gradient(90deg, ${p.from} 0%, ${p.to} 55%, ${p.from} 100%)`,
  );
  safeWrite(p.id);
}

export function loadPalette(): PaletteId {
  const raw = safeRead();
  const found = palettes.find(p => p.id === raw);
  const id = found ? found.id : DEFAULT_PALETTE;
  applyPalette(id);
  applyAccentMode((safeReadMode() ?? DEFAULT_ACCENT_MODE) === 'rainbow' && id !== 'rainbow' ? 'default' : safeReadMode() ?? DEFAULT_ACCENT_MODE);
  return id;
}

const MODE_KEY = 'portal.accentMode';

function safeReadMode(): AccentMode | null {
  try {
    const raw = window.localStorage.getItem(MODE_KEY);
    return raw === 'vertical' || raw === 'rainbow' || raw === 'default' ? raw : null;
  } catch {
    return null;
  }
}

/**
 * Режим акцента. Радуга и вертикальный градиент задаются атрибутом на <html>,
 * потому что переопределяют --grad целиком и должны побеждать обычную палитру
 * по каскаду — а не зависеть от порядка применения.
 */
export function applyAccentMode(mode: AccentMode): void {
  document.documentElement.setAttribute('data-accent-mode', mode);
  try {
    window.localStorage.setItem(MODE_KEY, mode);
  } catch {
    /* приватный режим */
  }
}

/**
 * Хранилище палитры. Отдельный стор, потому что палитра влияет и на темы,
 * и на компоненты uiverse, и на пользовательские темы — держать её в
 * themeStore значило бы смешивать две разные ответственности.
 */
interface PaletteState {
  paletteId: PaletteId;
  accentMode: AccentMode;
  setPalette: (id: PaletteId) => void;
  setAccentMode: (mode: AccentMode) => void;
}

export const usePaletteStore = create<PaletteState>(set => ({
  paletteId: DEFAULT_PALETTE,
  accentMode: DEFAULT_ACCENT_MODE,
  setPalette: id => {
    applyPalette(id);
    set({ paletteId: id });
  },
  setAccentMode: mode => {
    applyAccentMode(mode);
    set({ accentMode: mode });
  },
}));

/** Подставляет палитру в стор после гидрации — вызывается один раз при старте. */
export function initPaletteStore(): void {
  usePaletteStore.setState({ paletteId: loadPalette() });
}
/** Режимы градиента для выбора в оформлении. */
export const ACCENT_MODES: Array<{ id: AccentMode; label: string }> = [
  { id: 'default', label: 'Слева направо' },
  { id: 'vertical', label: 'Снизу вверх' },
  { id: 'rainbow', label: 'Радуга' },
];
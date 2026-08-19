import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export type HotkeyAction = 'home' | 'discover' | 'library' | 'settings' | 'librarySearch' | 'newInstance';
export type HotkeyBindings = Record<HotkeyAction, string>;

export const HOTKEY_LABELS: Record<HotkeyAction, { label: string; description: string }> = {
  home: { label: 'Открыть главную', description: 'Переход на домашнюю страницу' },
  discover: { label: 'Открыть Discover', description: 'Переход к поиску проектов' },
  library: { label: 'Открыть библиотеку', description: 'Переход к списку сборок' },
  settings: { label: 'Открыть настройки', description: 'Переход к настройкам лаунчера' },
  librarySearch: { label: 'Поиск в библиотеке', description: 'Открыть Library и поставить фокус в умный поиск' },
  newInstance: { label: 'Новая сборка', description: 'Открыть мастер создания сборки' },
};

export const HOTKEY_DEFAULTS: HotkeyBindings = {
  home: 'Alt+H', discover: 'Alt+D', library: 'Alt+L', settings: 'Alt+S', librarySearch: 'Ctrl+F', newInstance: 'Ctrl+N',
};

export function normaliseHotkey(event: KeyboardEvent): string | null {
  if (['Control', 'Alt', 'Shift', 'Meta'].includes(event.key)) return null;
  const parts = [event.ctrlKey ? 'Ctrl' : '', event.altKey ? 'Alt' : '', event.shiftKey ? 'Shift' : '', event.metaKey ? 'Meta' : '', event.key.length === 1 ? event.key.toUpperCase() : event.key].filter(Boolean);
  return parts.join('+');
}

interface HotkeyState { bindings: HotkeyBindings; setBinding: (action: HotkeyAction, binding: string) => void; reset: () => void; }
export const useHotkeyStore = create<HotkeyState>()(persist((set) => ({ bindings: HOTKEY_DEFAULTS, setBinding: (action, binding) => set(state => ({ bindings: { ...state.bindings, [action]: binding } })), reset: () => set({ bindings: HOTKEY_DEFAULTS }) }), { name:'portal-launcher-hotkeys' }));

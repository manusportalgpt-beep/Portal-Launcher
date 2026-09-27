import { useSyncExternalStore } from 'react';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { useLaunchStore } from '@/stores/launchStore';

/**
 * Одна пауза для всей отрисовки лаунчера.
 *
 * Жалоба игрока: «месяц назад 100+ FPS, сейчас не больше 50». Окно лаунчера
 * рисовало лобби (анимации плиток, луч света, 3D-персонаж) каждый кадр
 * монитора — и тогда, когда поверх шла игра. Убранное в трей окно WebView2
 * остаётся «видимым», поэтому одного `visibilitychange` мало. На встроенной
 * видеокарте эти кадры забирает у Minecraft.
 *
 * Тихо (ничего не анимируется), когда:
 *   - окно не видно: свёрнуто, в трей, вкладка скрыта;
 *   - идёт игра, а лаунчер не в фокусе — человек смотрит в игру.
 * Пока в лаунчере работают руками (фокус), он живой даже при запущенной игре:
 * Minecraft без фокуса сам сбрасывает частоту кадров.
 *
 * Приём взят из millida/launcher (GPL-3.0), файл src/lib/renderGate.ts.
 */

interface GateState {
  hidden: boolean;
  focused: boolean;
  game: boolean;
}

const state: GateState = {
  hidden: typeof document !== 'undefined' ? document.hidden : false,
  focused: typeof document !== 'undefined' ? document.hasFocus() : true,
  game: false,
};

const quietFor = (s: GateState) => s.hidden || (s.game && !s.focused);

let quiet = quietFor(state);
const subs = new Set<() => void>();

function update(patch: Partial<GateState>) {
  Object.assign(state, patch);
  const next = quietFor(state);
  if (next === quiet) return;
  quiet = next;
  if (typeof document !== 'undefined') {
    document.documentElement.classList.toggle('m-quiet', quiet);
  }
  subs.forEach(fn => fn());
}

/** Можно ли сейчас рисовать анимацию. */
export const renderLive = () => !quiet;

function onRenderGate(cb: () => void): () => void {
  subs.add(cb);
  return () => { subs.delete(cb); };
}

/** Хук: true — рисуем, false — окно не видно или игра поверх. */
export function useRenderLive(): boolean {
  return useSyncExternalStore(onRenderGate, renderLive, renderLive);
}

let started = false;

/** Вызывается один раз при старте окна лаунчера. */
export function initRenderGate() {
  if (started || typeof window === 'undefined') return;
  started = true;

  document.addEventListener('visibilitychange', () => update({ hidden: document.hidden }));
  window.addEventListener('focus', () => update({ focused: true }));
  window.addEventListener('blur', () => update({ focused: false }));

  // Фокус окна: DOM-события WebView2 приходят не всегда, когда фокус уходит
  // в игру из соседнего процесса.
  try {
    const w = getCurrentWindow() as unknown as {
      onFocusChanged?: (h: (e: { payload: boolean }) => void) => Promise<() => void>;
    };
    if (w?.onFocusChanged) {
      void w.onFocusChanged(e => update({ focused: !!e.payload })).catch(() => {});
    }
  } catch { /* не Tauri — работаем по DOM-событиям */ }

  // Игра идёт, если хотя бы у одной сборки статус launching/running.
  const readGame = () => {
    const status = useLaunchStore.getState().status;
    const busy = Object.values(status).some(s => s === 'launching' || s === 'running');
    update({ game: busy });
  };
  readGame();
  useLaunchStore.subscribe(readGame);
}

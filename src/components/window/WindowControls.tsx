import { useEffect, useState } from 'react';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { Minus, Square, Copy, X, PanelsTopLeft } from 'lucide-react';
import { useLocation } from 'react-router-dom';
import { isTauri } from '@/lib/invoke-shim';
import { useUiStore } from '@/stores/uiStore';

// Keep the custom title bar on the same cache-busted public asset as About
// and Sidebar. This avoids a stale Vite-imported image when the native EXE
// resource has already been refreshed by a new Windows installation.
const portalIcon = '/launcher-icon.png?rev=portal-square-2';

/** Работает ли окно Tauri. В браузере (разработка, предпросмотр) — нет. */
function safeWindow() {
  if (!isTauri()) return null;
  try {
    return getCurrentWindow();
  } catch {
    return null;
  }
}

/** Три кастомные кнопки Windows: свернуть / развернуть / закрыть. */
export function WindowControls() {
  const [maximized, setMaximized] = useState(false);
  // Вне Tauri getCurrentWindow() бросает исключение прямо в рендере, и без
  // границы ошибок это гасило весь интерфейс до чёрного экрана. Поэтому окно
  // достаём безопасно, а кнопки вне Tauri просто не рисуем.
  const win = safeWindow();

  useEffect(() => {
    if (!win) return;
    win.isMaximized().then(setMaximized).catch(() => {});
  }, [win]);

  if (!win) return null;

  const btn =
    'ore-flat h-[20px] w-7 inline-flex items-center justify-center text-[var(--color-text)]/65 transition-colors duration-150 hover:text-[var(--color-text)] hover:bg-white/10 active:scale-[0.96]';

  return (
    <div className="flex items-center select-none" data-tauri-drag-region-exclude>
      <button className={btn} title="Свернуть" onClick={() => win.minimize()}>
        <Minus size={10} strokeWidth={2} />
      </button>
      <button
        className={btn}
        title={maximized ? 'Восстановить' : 'Развернуть'}
        onClick={async () => {
          await win.toggleMaximize();
          setMaximized(await win.isMaximized());
        }}
      >
        {maximized ? <Copy size={9} /> : <Square size={9} />}
      </button>
      <button className={`${btn} hover:bg-[#e81123] hover:text-white`} title="Закрыть" onClick={() => win.close()}>
        <X size={10} strokeWidth={2} />
      </button>
    </div>
  );
}

/**
 * Кнопка «в лобби» — переключает режим панели на лету.
 *
 * Нужна, потому что настройки — это лишний поход в Настройки, чтобы просто
 * убрать панель на широком экране или вернуть её обратно. Порядок:
 * «без панели» → Notch → боковая → снова «без панели».
 */
function LobbyButton() {
  const navMode = useUiStore(s => s.navMode);
  const set = useUiStore(s => s.set);
  const next: Record<string, typeof navMode> = {
    none: 'notch',
    notch: 'sidebar',
    sidebar: 'none',
  };
  const label: Record<string, string> = {
    none: 'Панели нет — вернуть',
    notch: 'Notch-панель → боковая',
    sidebar: 'Боковая панель → без панели',
  };
  return (
    <button
      type="button"
      onClick={() => set('navMode', next[navMode] ?? 'notch')}
      title={label[navMode] ?? 'Переключить панель'}
      className="flex h-5 items-center gap-1 px-1.5 text-[10px] font-bold transition-colors hover:bg-white/10"
      style={{ color: 'var(--color-text-secondary)' }}>
      <PanelsTopLeft size={11} />
      в лобби
    </button>
  );
}

/** Тонкая полоса заголовка: drag только в компактной области рядом с брендом. */
export function TitleBar({ title = 'Portal Launcher' }: { title?: string }) {
  const titlebarHeight = useUiStore(state => state.titlebarHeight);
  const adaptiveTitlebarColor = useUiStore(state => state.adaptiveTitlebarColor);
  const location = useLocation();
  const routeTone = location.pathname.startsWith('/discover') ? 5
    : location.pathname.startsWith('/library') ? 4
      : location.pathname.startsWith('/skins') ? 6
        : location.pathname.startsWith('/settings') ? 3
          : 2;
  const pageColor = `color-mix(in srgb, var(--color-surface) ${100 - routeTone}%, var(--color-primary) ${routeTone}%)`;
  return (
    <div
      className="relative z-[200] flex shrink-0 items-center justify-between pl-2 pr-0"
      style={{ height: titlebarHeight, backgroundColor: adaptiveTitlebarColor ? pageColor : 'var(--color-surface)', backgroundImage:'none', isolation:'isolate', borderBottom: `1px solid ${adaptiveTitlebarColor ? `color-mix(in srgb, var(--color-primary) ${routeTone * 4}%, var(--color-border))` : 'var(--color-border)'}`, transition:'background-color 180ms var(--ease-out, ease), border-color 180ms var(--ease-out, ease)' }}
    >
      <div
        className="flex h-full w-[188px] shrink-0 cursor-grab items-center gap-1.5 rounded-sm px-1.5 text-[11px] font-semibold leading-none tracking-[0.01em] active:cursor-grabbing"
        style={{ color: 'var(--color-text-secondary)' }}
        onPointerDown={event => {
          if (event.button !== 0) return;
          const win = safeWindow();
          if (win) void win.startDragging();
        }}
      >
        <img src={portalIcon} width={16} height={16} draggable={false} className="block shrink-0 rounded-[4px] object-cover" alt="" />
        <span className="truncate">{title}</span>
      </div>
        <div className="flex h-full items-center gap-2 pr-2">
          <LobbyButton />
          <WindowControls />
        </div>
    </div>
  );
}

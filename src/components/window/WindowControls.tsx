import { useEffect, useState } from 'react';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { Minus, Square, Copy, X } from 'lucide-react';
import { useLocation } from 'react-router-dom';
import { useUiStore } from '@/stores/uiStore';

// Keep the custom title bar on the same cache-busted public asset as About
// and Sidebar. This avoids a stale Vite-imported image when the native EXE
// resource has already been refreshed by a new Windows installation.
const portalIcon = '/launcher-icon.png?rev=portal-square-2';

/** Три кастомные кнопки Windows: свернуть / развернуть / закрыть. */
export function WindowControls() {
  const [maximized, setMaximized] = useState(false);
  const win = getCurrentWindow();

  useEffect(() => {
    win.isMaximized().then(setMaximized).catch(() => {});
  }, [win]);

  const btn =
    'h-6 w-8 inline-flex items-center justify-center text-[var(--color-text)]/65 transition-colors duration-150 hover:text-[var(--color-text)] hover:bg-white/10 active:scale-[0.96]';

  return (
    <div className="flex items-center select-none" data-tauri-drag-region-exclude>
      <button className={btn} title="Свернуть" onClick={() => win.minimize()}>
        <Minus size={12} strokeWidth={2} />
      </button>
      <button
        className={btn}
        title={maximized ? 'Восстановить' : 'Развернуть'}
        onClick={async () => {
          await win.toggleMaximize();
          setMaximized(await win.isMaximized());
        }}
      >
        {maximized ? <Copy size={11} /> : <Square size={10} />}
      </button>
      <button className={`${btn} hover:bg-[#e81123] hover:text-white`} title="Закрыть" onClick={() => win.close()}>
        <X size={12} strokeWidth={2} />
      </button>
    </div>
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
          if (event.button === 0) void getCurrentWindow().startDragging();
        }}
      >
        <img src={portalIcon} width={16} height={16} draggable={false} className="block shrink-0 rounded-[4px] object-cover" alt="" />
        <span className="truncate">{title}</span>
      </div>
      <WindowControls />
    </div>
  );
}

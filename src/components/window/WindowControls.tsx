import { useEffect, useState } from 'react';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { Minus, Square, Copy, X } from 'lucide-react';
import { useLocation } from 'react-router-dom';
import { useUiStore } from '@/stores/uiStore';
import portalIcon from '../../../src-tauri/icons/icon.png';

/** Три кастомные кнопки Windows: свернуть / развернуть / закрыть. */
export function WindowControls() {
  const [maximized, setMaximized] = useState(false);
  const win = getCurrentWindow();

  useEffect(() => {
    win.isMaximized().then(setMaximized).catch(() => {});
  }, [win]);

  const btn =
    'h-7 w-9 inline-flex items-center justify-center text-[var(--color-text)]/65 transition-colors duration-150 hover:text-[var(--color-text)] hover:bg-white/10 active:scale-[0.96]';

  return (
    <div className="flex items-center select-none" data-tauri-drag-region-exclude>
      <button className={btn} title="Свернуть" onClick={() => win.minimize()}>
        <Minus size={13} strokeWidth={2} />
      </button>
      <button
        className={btn}
        title={maximized ? 'Восстановить' : 'Развернуть'}
        onClick={async () => {
          await win.toggleMaximize();
          setMaximized(await win.isMaximized());
        }}
      >
        {maximized ? <Copy size={12} /> : <Square size={11} />}
      </button>
      <button className={`${btn} hover:bg-[#e81123] hover:text-white`} title="Закрыть" onClick={() => win.close()}>
        <X size={13} strokeWidth={2} />
      </button>
    </div>
  );
}

/** Тонкая полоса заголовка: drag только на названии и чистой центральной области. */
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
      className="relative z-[200] flex shrink-0 items-center justify-between pl-1.5 pr-0"
      style={{ height: titlebarHeight, backgroundColor: adaptiveTitlebarColor ? pageColor : 'var(--color-surface)', backgroundImage:'none', isolation:'isolate', borderBottom: `1px solid ${adaptiveTitlebarColor ? `color-mix(in srgb, var(--color-primary) ${routeTone * 4}%, var(--color-border))` : 'var(--color-border)'}`, transition:'background-color 180ms var(--ease-out, ease), border-color 180ms var(--ease-out, ease)' }}
    >
      <div
        data-tauri-drag-region
        className="flex h-full min-w-0 flex-1 cursor-move items-center gap-1.5 text-[11px] font-medium tracking-[0.01em]"
        style={{ color: 'var(--color-text-tertiary)' }}
        onPointerDown={event => {
          if (event.button === 0) void getCurrentWindow().startDragging();
        }}
      >
        <img src={portalIcon} width={14} height={14} draggable={false} className="shrink-0 rounded-[4px] object-cover" alt="" />
        <span>{title}</span>
      </div>
      <WindowControls />
    </div>
  );
}

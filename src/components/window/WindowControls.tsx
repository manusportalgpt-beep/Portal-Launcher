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
    'h-8 w-11 inline-flex items-center justify-center text-[var(--color-text)]/70 transition-colors hover:text-[var(--color-text)] hover:bg-white/10';

  return (
    <div className="flex items-center select-none" data-tauri-drag-region-exclude>
      <button className={btn} title="Свернуть" onClick={() => win.minimize()}>
        <Minus size={15} />
      </button>
      <button
        className={btn}
        title={maximized ? 'Восстановить' : 'Развернуть'}
        onClick={async () => {
          await win.toggleMaximize();
          setMaximized(await win.isMaximized());
        }}
      >
        {maximized ? <Copy size={13} /> : <Square size={12} />}
      </button>
      <button className={`${btn} hover:bg-[#e81123] hover:text-white`} title="Закрыть" onClick={() => win.close()}>
        <X size={15} />
      </button>
    </div>
  );
}

/** Полоса заголовка: window drag только на названии и безопасной пустой части слева от controls. */
export function TitleBar({ title = 'Portal Launcher' }: { title?: string }) {
  const titlebarHeight = useUiStore(state => state.titlebarHeight);
  const adaptiveTitlebarColor = useUiStore(state => state.adaptiveTitlebarColor);
  const location = useLocation();
  const pageColor = location.pathname.startsWith('/discover')
    ? 'color-mix(in srgb, var(--color-surface) 86%, var(--color-primary) 14%)'
    : location.pathname.startsWith('/library')
      ? 'color-mix(in srgb, var(--color-surface) 91%, var(--color-primary) 9%)'
      : location.pathname.startsWith('/skins')
        ? 'color-mix(in srgb, var(--color-surface) 88%, var(--color-primary) 12%)'
        : location.pathname.startsWith('/settings')
          ? 'var(--color-surface-2)'
          : 'var(--color-surface)';
  return (
    <div
      className="relative z-[200] flex shrink-0 items-center justify-between pl-2 pr-0"
      style={{ height: titlebarHeight, background: adaptiveTitlebarColor ? pageColor : 'var(--color-surface)', borderBottom:'1px solid var(--color-border)', transition:'background 180ms var(--ease-out, ease), border-color 180ms var(--ease-out, ease)' }}
    >
      <div
        data-tauri-drag-region
        className="flex h-full min-w-0 flex-1 cursor-move items-center gap-2 text-xs font-medium tracking-wide"
        style={{ color: 'var(--color-text-tertiary)' }}
        onPointerDown={event => {
          if (event.button === 0) void getCurrentWindow().startDragging();
        }}
      >
        <img src={portalIcon} width={18} height={18} draggable={false} className="shrink-0 rounded-[5px] object-cover" alt="" />
        <span>{title}</span>
      </div>
      <WindowControls />
    </div>
  );
}

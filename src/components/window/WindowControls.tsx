import { useEffect, useState } from 'react';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { Minus, Square, Copy, X } from 'lucide-react';
import { useUiStore } from '@/stores/uiStore';

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

/** Полоса заголовка: drag-region только на самом названии, не на кнопках и не на всей панели. */
export function TitleBar({ title = 'Portal Launcher' }: { title?: string }) {
  const titlebarHeight = useUiStore(state => state.titlebarHeight);
  return (
    <div
      className="flex items-center justify-between pl-3 pr-0"
      style={{ height: titlebarHeight, background: 'var(--color-surface)' }}
    >
      <span data-tauri-drag-region className="cursor-move text-xs font-medium tracking-wide" style={{ color: 'var(--color-text-tertiary)' }}>
        {title}
      </span>
      <WindowControls />
    </div>
  );
}

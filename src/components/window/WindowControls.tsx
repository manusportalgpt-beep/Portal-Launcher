import { useEffect, useState } from 'react';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { Minus, Square, Copy, X, ChevronLeft, ChevronRight, ChevronRight as CrumbSeparator } from 'lucide-react';
import { useLocation } from 'react-router-dom';
import { isTauri } from '@/lib/invoke-shim';
import { useUiStore } from '@/stores/uiStore';
import { useInstanceStore } from '@/stores/instanceStore';
import { useTranslation } from 'react-i18next';

// Keep the custom title bar on the same cache-busted public asset as About
// and Sidebar. This avoids a stale Vite-imported image when the native EXE
// resource has already been refreshed by a new Windows installation.
const portalIcon = '/launcher-icon.png?rev=portal-square-2';

/**
 * Окно Tauri, взятое безопасно.
 *
 * Вне Tauri (отладка фронтенда в браузере, предпросмотр) `getCurrentWindow()`
 * бросает исключение прямо в рендере, и без границы ошибок это гасило всё
 * дерево React до чёрного экрана. Поэтому сначала проверяем окружение.
 */
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
  const win = safeWindow();

  useEffect(() => {
    if (!win) return;
    let disposed = false;
    let unlisten: (() => void) | undefined;
    const syncMaximized = () => win.isMaximized().then(value => {
      if (!disposed) setMaximized(value);
    }).catch(() => {});

    void syncMaximized();
    void win.onResized(syncMaximized).then(listener => {
      if (disposed) listener();
      else unlisten = listener;
    }).catch(() => {});

    return () => {
      disposed = true;
      unlisten?.();
    };
  }, [win]);

  // Вне Tauri окна нет — кнопки окна просто не рисуются.
  if (!win) return null;

  const btn =
    'ore-flat relative inline-flex h-full min-h-6 w-8 items-center justify-center text-[var(--color-text-secondary)] transition-[background-color,color] duration-150 hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-text)] focus-visible:z-10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-[var(--color-primary)]';

  return (
    <section
      aria-label="Управление окном"
      className="flex h-full shrink-0 items-center gap-1 border-l px-1 select-none"
      data-tauri-drag-region-exclude
      style={{ borderColor: 'var(--color-border)', background: 'var(--color-surface)' }}
    >
      <button type="button" className={btn} aria-label="Свернуть окно" title="Свернуть" onClick={() => win.minimize()}>
        <Minus size={14} strokeWidth={2} />
      </button>
      <button
        type="button"
        className={btn}
        aria-label={maximized ? 'Восстановить окно' : 'Развернуть окно'}
        aria-pressed={maximized}
        title={maximized ? 'Восстановить' : 'Развернуть'}
        onClick={async () => {
          await win.toggleMaximize();
          setMaximized(await win.isMaximized());
        }}
      >
        {maximized ? <Copy size={13} /> : <Square size={13} />}
      </button>
      <button type="button" className={`${btn} hover:bg-[var(--color-error)] hover:text-[var(--color-primary-text)] focus-visible:bg-[var(--color-error)] focus-visible:text-[var(--color-primary-text)]`} aria-label="Закрыть окно" title="Закрыть" onClick={() => win.close()}>
        <X size={14} strokeWidth={2} />
      </button>
    </section>
  );
}

/** Тонкая полоса заголовка: drag только в компактной области рядом с брендом. */
export function TitleBar({ title = 'Portal Launcher' }: { title?: string }) {
  const titlebarHeight = useUiStore(state => state.titlebarHeight);
  const adaptiveTitlebarColor = useUiStore(state => state.adaptiveTitlebarColor);
  const location = useLocation();
  const { t } = useTranslation();
  const instances = useInstanceStore(state => state.instances);
  const routeTone = location.pathname.startsWith('/discover') ? 5
    : location.pathname.startsWith('/library') ? 4
      : location.pathname.startsWith('/skins') ? 6
        : location.pathname.startsWith('/settings') ? 3
          : 2;
  const pageColor = `color-mix(in srgb, var(--color-surface) ${100 - routeTone}%, var(--color-primary) ${routeTone}%)`;
  const pathParts = location.pathname.split('/').filter(Boolean);
  const navLabels: Record<string, string> = {
    home: t('nav.home'), discover: t('nav.discover'), skins: t('nav.skins'),
    library: t('nav.library'), openportal: t('nav.openportal'), settings: t('nav.settings'),
  };
  let breadcrumbs: string[] = [];
  if (pathParts[0] === 'library') {
    const instance = instances.find(item => item.id === pathParts[1]);
    breadcrumbs = pathParts[1] ? [navLabels.library, instance?.name ?? pathParts[1]] : [navLabels.library];
  } else if (pathParts[0] === 'discover') {
    const stateProject = (location.state as { title?: string; name?: string } | null)?.title
      ?? (location.state as { name?: string } | null)?.name;
    breadcrumbs = pathParts.length > 2
      ? [navLabels.discover, stateProject ?? decodeURIComponent(pathParts.at(-1) ?? '')]
      : [navLabels.discover];
  } else if (pathParts[0] === 'settings') {
    const sectionNames: Record<string, string> = {
      account: 'Аккаунты', minecraft: 'Minecraft', appearance: 'Оформление', controls: 'Управление',
      audio: 'Аудио', language: 'Язык', update: 'Обновление', advanced: 'Дополнительно', about: 'О лаунчере',
    };
    breadcrumbs = pathParts[1]
      ? [navLabels.settings, sectionNames[pathParts[1]] ?? pathParts[1]]
      : [navLabels.settings];
  } else if (pathParts.length) {
    const roots: Record<string, string> = {
      home: navLabels.home, skins: navLabels.skins, openportal: navLabels.openportal,
      bookmarks: 'Закладки', gallery: 'Галерея', author: 'Автор', projects: 'Проекты',
    };
    breadcrumbs = [roots[pathParts[0]] ?? pathParts[0]];
    if (pathParts.length > 1 && pathParts[0] !== 'openportal') breadcrumbs.push(decodeURIComponent(pathParts.at(-1) ?? ''));
  }
  return (
    <div
      className="relative z-[200] flex shrink-0 items-center justify-between pl-2 pr-0"
      style={{ height: titlebarHeight, backgroundColor: adaptiveTitlebarColor ? pageColor : 'var(--color-surface)', backgroundImage:'none', isolation:'isolate', borderBottom: `1px solid ${adaptiveTitlebarColor ? `color-mix(in srgb, var(--color-primary) ${routeTone * 4}%, var(--color-border))` : 'var(--color-border)'}`, transition:'background-color 180ms var(--ease-out, ease), border-color 180ms var(--ease-out, ease)' }}
    >
      <div className="flex min-w-0 flex-1 items-center gap-2 overflow-hidden">
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
      <div className="flex shrink-0 items-center gap-1" data-tauri-drag-region-exclude>
        <button type="button" aria-label="Назад" title="Назад" onClick={() => window.history.back()}
          className="flex h-7 w-7 items-center justify-center rounded-md border transition-[background-color,color,border-color] duration-150 hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-text)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-primary)]"
          style={{ color:'var(--color-text-secondary)', borderColor:'var(--color-border)', background:'transparent' }}>
          <ChevronLeft className="h-4 w-4" />
        </button>
        <button type="button" aria-label="Вперёд" title="Вперёд" onClick={() => window.history.forward()}
          className="flex h-7 w-7 items-center justify-center rounded-md border transition-[background-color,color,border-color] duration-150 hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-text)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-primary)]"
          style={{ color:'var(--color-text-secondary)', borderColor:'var(--color-border)', background:'transparent' }}>
          <ChevronRight className="h-4 w-4" />
        </button>
      </div>
      <nav aria-label="Навигационная цепочка" className="flex min-w-0 items-center gap-1 overflow-hidden text-xs" style={{ color:'var(--color-text-secondary)' }}>
        {breadcrumbs.map((crumb, index) => (
          <span key={`${index}:${crumb}`} className="flex min-w-0 items-center gap-1">
            {index > 0 && <CrumbSeparator aria-hidden="true" className="h-3 w-3 shrink-0 opacity-50" />}
            <span className={index === breadcrumbs.length - 1 ? 'truncate font-medium' : 'truncate opacity-70'}
              style={index === breadcrumbs.length - 1 ? { color:'var(--color-text)' } : undefined}>
              {crumb}
            </span>
          </span>
        ))}
      </nav>
      </div>
      <WindowControls />
    </div>
  );
}

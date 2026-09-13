import { ReactNode, useCallback, useEffect, useMemo, useState } from 'react';
import { NavLink, useLocation, useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import {
  House, Compass, Boxes, Palette, Settings, ChevronLeft, ChevronRight, LogIn, type LucideIcon,
} from 'lucide-react';
import { useLayoutStore } from '@/stores/layoutStore';
import { useInstanceStore, type Instance } from '@/stores/instanceStore';
import { useCurrentUser, useIsAuthenticated } from '@/stores/authStore';
import { useLaunchStore } from '@/stores/launchStore';
import { useSettingsStore } from '@/stores/settingsStore';
import { invoke } from '@/lib/invoke-shim';
import { toIconSrc } from '@/lib/icon-src';
import { CachedPlayerFace } from '@/components/CachedPlayerFace';
import { InnovativeCommandPalette } from '@/layouts/innovative/InnovativeCommandPalette';
import './extended.css';

/* ── навигация ──────────────────────────────────────────────────────────── */

interface NavItem { to: string; icon: LucideIcon; label: string; key: string; end?: boolean }

const NAV: NavItem[] = [
  { to: '/home', icon: House, label: 'Главная', key: 'home', end: true },
  { to: '/discover', icon: Compass, label: 'Обзор', key: 'discover' },
  { to: '/library', icon: Boxes, label: 'Библиотека', key: 'library' },
  { to: '/skins', icon: Palette, label: 'Скины', key: 'skins' },
  { to: '/settings', icon: Settings, label: 'Настройки', key: 'settings' },
];

const DEFAULT_ORDER = ['home', 'discover', 'library', 'skins', 'settings'];

function orderedNav(order: string[]) {
  return [...NAV].sort((a, b) => {
    const ai = order.indexOf(a.key);
    const bi = order.indexOf(b.key);
    return (ai < 0 ? 999 : ai) - (bi < 0 ? 999 : bi);
  });
}

function pageTitle(pathname: string): string {
  if (pathname.startsWith('/settings/extended')) return 'Расширенный интерфейс';
  if (pathname.startsWith('/settings')) return 'Настройки';
  if (pathname.startsWith('/instances')) return 'Сборки';
  if (pathname.startsWith('/discover')) return 'Обзор';
  if (pathname.startsWith('/library')) return 'Библиотека';
  if (pathname.startsWith('/skins')) return 'Скины';
  if (pathname.startsWith('/author')) return 'Автор';
  if (pathname.startsWith('/find-projects')) return 'Лаборатория';
  if (pathname.startsWith('/control-center')) return 'Пульт';
  if (pathname.startsWith('/gallery')) return 'Галерея';
  return 'Главная';
}

/* ── фон портала ────────────────────────────────────────────────────────── */

function PortalBackdrop() {
  return (
    <div aria-hidden className="portal-ext-backdrop">
      <div className="ring" />
      <div className="glow-small" />
      <div className="floor" />
      <div className="scanline" />
    </div>
  );
}

/* ── запуск сборки (тот же путь, что и в библиотеке) ────────────────────── */

function useQuickLaunch() {
  const navigate = useNavigate();
  const user = useCurrentUser();
  const globalSettings = useSettingsStore(s => ({
    minRam: s.minRam, maxRam: s.maxRam, javaPath: s.javaPath, customJvmArgs: s.customJvmArgs,
  }));
  const getStatus = useLaunchStore(s => s.getStatus);
  const setStatus = useLaunchStore(s => s.setStatus);
  const update = useInstanceStore(s => s.update);

  const launch = useCallback(async (inst: Instance) => {
    const status = getStatus(inst.id);
    if (status === 'launching' || status === 'running') return;
    if (!user) { navigate('/settings/account'); return; }
    if (inst.modLoader === 'bedrock') {
      try { await invoke('launch_bedrock', { family: inst.modLoaderVersion || null }); } catch (e) { console.error(e); }
      update(inst.id, { lastPlayed: new Date().toISOString() });
      return;
    }
    setStatus(inst.id, 'launching');
    try {
      await invoke('ensure_instance', {
        id: inst.id, name: inst.name, mcVersion: inst.minecraftVersion,
        loader: inst.modLoader, loaderVersion: inst.modLoaderVersion || '',
        minRam: globalSettings.minRam, maxRam: globalSettings.maxRam,
        javaPath: globalSettings.javaPath || '', customJvmArgs: globalSettings.customJvmArgs || '',
        color: inst.color, icon: inst.iconPath || null,
      });
      update(inst.id, { lastPlayed: new Date().toISOString() });
      if (!user.uuid || !user.username) throw new Error('Нужно войти в аккаунт');
      await invoke('launch_instance', {
        instance_id: inst.id, access_token: user.accessToken || '',
        uuid: user.uuid, username: user.username, provider: user.provider,
      });
    } catch (e) {
      console.error(e);
      setStatus(inst.id, 'idle');
    }
  }, [user, globalSettings, getStatus, setStatus, navigate, update]);

  return { launch };
}

/* ── боковая панель ─────────────────────────────────────────────────────── */

function ExtendedSidebar({ order, compact }: { order: string[]; compact: boolean }) {
  const location = useLocation();
  const navigate = useNavigate();
  const { launch } = useQuickLaunch();
  const instances = useInstanceStore(s => s.instances);
  const getStatus = useLaunchStore(s => s.getStatus);
  const items = orderedNav(order.length > 0 ? order : DEFAULT_ORDER);
  const shown = instances.slice(0, 8);

  return (
    <aside className={`portal-ext-sidebar${compact ? ' compact' : ''}`}>
      <div className={`portal-ext-brand${compact ? ' compact' : ''}`}>
        <div className="portal-ext-logo">
          <img src="/launcher-icon.png?rev=portal-square-1" alt="Portal Launcher" draggable={false} />
        </div>
        {!compact && (
          <div>
            <span className="portal-ext-brandname">Portal<small>Launcher · Core</small></span>
          </div>
        )}
      </div>

      <span className="portal-ext-label">Меню</span>
      <nav className="portal-ext-nav">
        {items.map(item => {
          const active = item.end
            ? location.pathname === item.to
            : location.pathname.startsWith(item.to);
          return (
            <NavLink key={item.to} to={item.to} end={item.end}
              className={`portal-ext-nav-item${active ? ' active' : ''}`}>
              <span className="portal-ext-nav-icon">
                <item.icon size={16} />
              </span>
              {!compact && <span className="portal-ext-nav-label">{item.label}</span>}
              {!compact && <ChevronRight size={13} className="portal-ext-nav-chev" style={{ color: 'var(--color-primary)' }} />}
            </NavLink>
          );
        })}
      </nav>

      {shown.length > 0 && (
        <>
          <span className="portal-ext-label">{compact ? '' : 'Быстрый доступ'}</span>
          <div className="portal-ext-instances">
            {shown.map(inst => {
              const status = getStatus(inst.id);
              const busy = status === 'launching';
              return (
                <button key={inst.id} className="portal-ext-inst" title={`${inst.name} — ЛКМ: открыть · ПКМ: запуск`}
                  onClick={() => navigate(`/library/${inst.id}`)}
                  onContextMenu={e => { e.preventDefault(); void launch(inst); }}
                  disabled={busy}
                  style={{ border: status === 'running' ? '1px solid var(--color-success)' : undefined }}>
                  {busy
                    ? <span className="h-3 w-3 rounded-full border-2 border-white/80 border-t-transparent animate-spin" />
                    : inst.iconPath
                      ? <img src={toIconSrc(inst.iconPath)} alt="" draggable={false} style={{ imageRendering: 'auto', filter: 'none', opacity: 1 }} />
                      : <span className="letter">{inst.name[0]?.toUpperCase()}</span>}
                </button>
              );
            })}
          </div>
        </>
      )}

      <div className="portal-ext-scroll" />

      {!compact && (
        <div className="portal-ext-core">
          <span className="dot" />
          <span>
            <span className="core-name block">Extended Core</span>
            <span className="core-state block">Online</span>
          </span>
        </div>
      )}
    </aside>
  );
}

/* ── шапка ──────────────────────────────────────────────────────────────── */

function ExtendedHeader({ title, onOpenPalette }: { title: string; onOpenPalette: () => void }) {
  const navigate = useNavigate();
  const user = useCurrentUser();
  const isAuth = useIsAuthenticated();
  return (
    <header className="portal-ext-header">
      <span className="portal-ext-title">
        <span className="marker" />
        <span className="crumb">{title}</span>
      </span>

      <button className="portal-ext-search" onClick={onOpenPalette}>
        <span className="prompt">&gt;</span>
        <span className="text-[11px] font-semibold opacity-80">Поиск и команды…</span>
        <span className="hint">Ctrl K</span>
      </button>

      <div className="flex-1" />

      <div className="portal-ext-status" title="Система активна">
        <i className="on" /><i className="mid" /><i className="done" />
      </div>

      <button className="portal-ext-icon-btn" title="Назад" onClick={() => window.history.back()}>
        <ChevronLeft size={17} />
      </button>
      <button className="portal-ext-icon-btn" title="Вперёд" onClick={() => window.history.forward()}>
        <ChevronRight size={17} />
      </button>

      <button className="portal-ext-account" title={isAuth && user ? user.username : 'Войти в аккаунт'}
        onClick={() => navigate('/settings/account')}>
        {isAuth && user
          ? <CachedPlayerFace user={user} className="h-full w-full" alt="" />
          : <LogIn size={15} />}
      </button>
    </header>
  );
}

/* ── оболочка ───────────────────────────────────────────────────────────── */

export function ExtendedShell({ children }: { children: ReactNode }) {
  const mode = useLayoutStore(s => s.mode);
  const extended = useLayoutStore(s => s.extended);
  const location = useLocation();
  const [paletteOpen, setPaletteOpen] = useState(false);
  const accent = extended.colorAccent || '#DA2A3F';
  const compact = extended.compactMode;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setPaletteOpen(v => !v);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const title = useMemo(() => pageTitle(location.pathname), [location.pathname]);

  if (mode !== 'extended') return <>{children}</>;

  return (
    <div className="portal-extended relative flex h-full min-h-0 overflow-hidden" style={{
      background: 'transparent',
      ['--ext-accent' as string]: accent,
      ['--ext-sidebar-w' as string]: compact ? '68px' : '232px',
    } as React.CSSProperties}>
      <PortalBackdrop />
      <ExtendedSidebar order={extended.sidebarOrder} compact={compact} />
      <div className="relative z-10 flex flex-1 flex-col min-w-0 min-h-0">
        <ExtendedHeader title={title} onOpenPalette={() => setPaletteOpen(true)} />
        <main className="portal-ext-main flex-1 min-h-0 overflow-auto">
          <AnimatePresence mode="wait" initial={false}>
            <motion.div
              key={location.pathname}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -6 }}
              transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
              className="h-full"
            >
              {children}
            </motion.div>
          </AnimatePresence>
        </main>
      </div>
      <InnovativeCommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} />
    </div>
  );
}
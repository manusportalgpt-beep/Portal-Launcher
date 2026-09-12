import { ReactNode, useEffect, useState } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import {
  House, Search, Boxes, Shirt, Settings, ChevronRight, Sparkles,
  Play, Compass, Palette, LogIn,
} from 'lucide-react';
import { useInstanceStore } from '@/stores/instanceStore';
import { useLayoutStore } from '@/stores/layoutStore';
import { toIconSrc } from '@/lib/icon-src';
import { CachedPlayerFace } from '@/components/CachedPlayerFace';
import { useCurrentUser, useIsAuthenticated } from '@/stores/authStore';
import { InnovativeCommandPalette } from '@/layouts/innovative/InnovativeCommandPalette';

/* ── nav items ───────────────────────────────────────────────────────────── */

const NAV = [
  { to: '/home', icon: House, label: 'Главная' },
  { to: '/discover', icon: Compass, label: 'Обзор' },
  { to: '/library', icon: Boxes, label: 'Библиотека' },
  { to: '/skins', icon: Palette, label: 'Скины' },
  { to: '/settings', icon: Settings, label: 'Настройки' },
];

const PAGE_TITLES: Record<string, string> = {
  '/home': 'Главная', '/discover': 'Обзор', '/library': 'Библиотека',
  '/skins': 'Скины', '/settings': 'Настройки',
};

/* ── aurora background ───────────────────────────────────────────────────── */

function AuroraBackdrop() {
  return (
    <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
      <div className="absolute -left-32 -top-24 h-96 w-96 rounded-full opacity-25 animate-aurora"
        style={{ background: 'var(--color-primary)', filter: 'blur(90px)', animationDuration: '11s' }} />
      <div className="absolute -right-24 top-1/3 h-80 w-80 rounded-full opacity-16 animate-aurora"
        style={{ background: 'var(--color-info)', filter: 'blur(90px)', animationDelay: '-4s', animationDuration: '14s' }} />
      <div className="absolute bottom-0 left-1/3 h-72 w-72 rounded-full opacity-14 animate-aurora"
        style={{ background: 'var(--color-modrinth)', filter: 'blur(100px)', animationDelay: '-8s', animationDuration: '17s' }} />
    </div>
  );
}

/* ── sidebar item ────────────────────────────────────────────────────────── */

function SideItem({ to, icon: Icon, label, active }: { to: string; icon: any; label: string; active: boolean }) {
  return (
    <NavLink
      to={to}
      className="group relative flex items-center gap-3 w-full px-3 py-2.5 rounded-2xl text-left transition-all"
      style={{
        background: active ? 'color-mix(in srgb, var(--color-primary) 16%, transparent)' : 'transparent',
        color: active ? 'var(--color-primary)' : 'var(--color-text-secondary)',
      }}
    >
      {active && (
        <motion.div
          layoutId="innovative-nav-indicator"
          className="absolute left-0 top-1/2 -translate-y-1/2 w-1 h-6 rounded-full"
          style={{ background: 'var(--color-primary)', boxShadow: '0 0 14px color-mix(in srgb, var(--color-primary) 70%, transparent)' }}
          transition={{ type: 'spring', stiffness: 500, damping: 34 }}
        />
      )}
      <span className="flex h-8 w-8 items-center justify-center rounded-xl transition-all group-hover:scale-105"
        style={{ background: active ? 'color-mix(in srgb, var(--color-primary) 18%, transparent)' : 'color-mix(in srgb, var(--color-surface-2) 60%, transparent)' }}>
        <Icon size={17} strokeWidth={active ? 2.2 : 1.8} />
      </span>
      <span className="text-[13px] font-semibold">{label}</span>
    </NavLink>
  );
}

/* ── sidebar ─────────────────────────────────────────────────────────────── */

function InnovativeSidebar() {
  const location = useLocation();
  const user = useCurrentUser();
  const isAuth = useIsAuthenticated();
  const instances = useInstanceStore(s => s.instances);
  const recent = instances
    .filter(i => i.lastPlayed)
    .sort((a, b) => (b.lastPlayed ?? '').localeCompare(a.lastPlayed ?? ''))
    .slice(0, 3);

  return (
    <aside
      className="relative z-20 flex flex-col h-full select-none"
      style={{
        width: 248,
        background: 'color-mix(in srgb, var(--color-surface) 74%, transparent)',
        borderRight: '1px solid var(--color-border)',
        backdropFilter: 'blur(40px) saturate(1.5)',
        WebkitBackdropFilter: 'blur(40px) saturate(1.5)',
      }}
    >
      {/* brand */}
      <div className="px-5 pt-6 pb-5">
        <div className="flex items-center gap-3">
          <motion.div
            initial={{ scale: 0.9, opacity: 0 }} animate={{ scale: 1, opacity: 1 }}
            transition={{ type: 'spring', stiffness: 320, damping: 22 }}
            className="flex h-10 w-10 items-center justify-center rounded-2xl"
            style={{ background: 'linear-gradient(135deg, var(--color-primary), color-mix(in srgb, var(--color-primary) 60%, #FF8A65))', boxShadow: '0 8px 24px -6px color-mix(in srgb, var(--color-primary) 60%, transparent)' }}>
            <Sparkles size={17} color="#fff" />
          </motion.div>
          <div>
            <p className="text-[15px] font-extrabold tracking-tight" style={{ color: 'var(--color-text)' }}>Portal</p>
            <p className="text-[10px] font-semibold tracking-wide uppercase" style={{ color: 'var(--color-text-tertiary)' }}>Launcher · v2</p>
          </div>
        </div>
      </div>

      {/* nav */}
      <nav className="flex-1 flex flex-col gap-1 px-3 overflow-y-auto">
        <p className="px-3 pb-2 pt-1 text-[10px] font-bold uppercase tracking-[0.14em]" style={{ color: 'var(--color-text-tertiary)' }}>
          Меню
        </p>
        {NAV.map(item => (
          <SideItem
            key={item.to}
            {...item}
            active={location.pathname === item.to || (item.to !== '/home' && location.pathname.startsWith(item.to))}
          />
        ))}

        {recent.length > 0 && (
          <div className="mt-4">
            <p className="px-3 mb-2 text-[10px] font-bold uppercase tracking-[0.14em]" style={{ color: 'var(--color-text-tertiary)' }}>
              Недавние
            </p>
            <div className="flex flex-col gap-1">
              {recent.map(inst => (
                <button
                  key={inst.id}
                  onClick={() => window.location.hash = `#/library/${inst.id}`}
                  className="group flex items-center gap-2.5 rounded-2xl px-3 py-2 transition-all hover:bg-white/5"
                >
                  <div className="h-9 w-9 rounded-xl overflow-hidden flex items-center justify-center text-[11px] font-bold shrink-0"
                    style={{ background: 'color-mix(in srgb, var(--color-surface-2) 70%, transparent)', border: '1px solid var(--color-border)', color: '#fff' }}>
                    {inst.iconPath
                      ? <img src={toIconSrc(inst.iconPath)} className="h-full w-full object-cover" alt="" draggable={false} />
                      : inst.name[0]?.toUpperCase()}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-[12px] font-semibold truncate" style={{ color: 'var(--color-text)' }}>{inst.name}</p>
                    <p className="text-[9px]" style={{ color: 'var(--color-text-tertiary)' }}>{inst.minecraftVersion} · {inst.modLoader}</p>
                  </div>
                  <ChevronRight size={13} className="opacity-0 -translate-x-1 transition-all group-hover:opacity-100 group-hover:translate-x-0" style={{ color: 'var(--color-primary)' }} />
                </button>
              ))}
            </div>
          </div>
        )}
      </nav>

      {/* account */}
      <div className="px-3 pb-5 pt-3">
        <NavLink to={user ? '/settings/account' : '/settings/account'}
          className="flex items-center gap-3 w-full px-3 py-2.5 rounded-2xl transition-all hover:bg-white/5"
          style={{ background: 'color-mix(in srgb, var(--color-surface-2) 55%, transparent)', border: '1px solid var(--color-border)' }}>
          <div className="h-9 w-9 rounded-full overflow-hidden flex items-center justify-center shrink-0"
            style={{ border: '2px solid color-mix(in srgb, var(--color-primary) 50%, transparent)' }}>
            {isAuth && user
              ? <CachedPlayerFace user={user} className="h-full w-full" alt="" />
              : <div className="h-full w-full flex items-center justify-center" style={{ color: 'var(--color-text-tertiary)', background: 'var(--color-surface-2)' }}><LogIn size={14} /></div>}
          </div>
          <div className="min-w-0 flex-1 text-left">
            <p className="text-[12px] font-bold truncate" style={{ color: 'var(--color-text)' }}>
              {user?.username ?? 'Войти в аккаунт'}
            </p>
            <p className="text-[9px]" style={{ color: 'var(--color-text-tertiary)' }}>
              {user ? (user.provider === 'microsoft' ? 'Microsoft' : user.provider === 'elyby' ? 'Ely.by' : 'Offline') : 'Microsoft · Ely.by · Offline'}
            </p>
          </div>
        </NavLink>
      </div>
    </aside>
  );
}

/* ── top header ──────────────────────────────────────────────────────────── */

function InnovativeHeader({ onOpenPalette }: { onOpenPalette: () => void }) {
  const location = useLocation();
  const title = PAGE_TITLES[location.pathname] ?? 'Portal Launcher';
  return (
    <header
      className="relative z-20 flex items-center gap-4 px-6 py-3"
      style={{
        background: 'color-mix(in srgb, var(--color-surface) 52%, transparent)',
        borderBottom: '1px solid var(--color-border)',
        backdropFilter: 'blur(30px) saturate(1.4)',
        WebkitBackdropFilter: 'blur(30px) saturate(1.4)',
      }}
    >
      <motion.p key={title} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.25 }}
        className="text-[15px] font-extrabold tracking-tight" style={{ color: 'var(--color-text)' }}>
        {title}
      </motion.p>
      <div className="flex-1" />
      <button
        onClick={onOpenPalette}
        className="flex items-center gap-2 rounded-full px-4 py-2 text-[12px] font-semibold transition-all hover:scale-[1.02] active:scale-[0.98]"
        style={{ background: 'color-mix(in srgb, var(--color-surface-2) 60%, transparent)', border: '1px solid var(--color-border)', color: 'var(--color-text-secondary)', width: 240 }}>
        <Search size={14} />
        <span className="flex-1 text-left opacity-80">Поиск модов, сборок…</span>
        <kbd className="rounded-md px-1.5 py-0.5 text-[9px] font-bold" style={{ background: 'color-mix(in srgb, var(--color-bg) 60%, transparent)' }}>Ctrl K</kbd>
      </button>
    </header>
  );
}

/* ── main shell ──────────────────────────────────────────────────────────── */

export function InnovativeShell({ children }: { children: ReactNode }) {
  const mode = useLayoutStore(s => s.mode);
  const location = useLocation();

  // Командная палитра: Ctrl+K открывает/закрывает
  const [paletteOpen, setPaletteOpen] = useState(false);
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

  if (mode !== 'innovative') return <>{children}</>;

  return (
    <div className="portal-innovative relative flex h-full min-h-0 overflow-hidden" style={{ background: 'transparent' }}>
      <AuroraBackdrop />
      <InnovativeSidebar />
      <div className="relative z-10 flex flex-1 flex-col min-w-0 min-h-0">
        <InnovativeHeader onOpenPalette={() => setPaletteOpen(true)} />
        <main className="flex-1 min-h-0 overflow-auto">
          <AnimatePresence mode="wait" initial={false}>
            <motion.div
              key={location.pathname}
              initial={{ opacity: 0, y: 10, filter: 'blur(4px)' }}
              animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
              exit={{ opacity: 0, y: -8, filter: 'blur(4px)' }}
              transition={{ duration: 0.28, ease: [0.16, 1, 0.3, 1] }}
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

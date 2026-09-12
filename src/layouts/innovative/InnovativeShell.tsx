import { ReactNode } from 'react';
import { NavLink, useNavigate, useLocation } from 'react-router-dom';
import { motion } from 'framer-motion';
import { House, Search, Boxes, Shirt, Settings, ChevronRight, Sparkles } from 'lucide-react';
import { useInstanceStore } from '@/stores/instanceStore';
import { useLayoutStore } from '@/stores/layoutStore';
import { toIconSrc } from '@/lib/icon-src';
import { CachedPlayerFace } from '@/components/CachedPlayerFace';
import { useCurrentUser, useIsAuthenticated } from '@/stores/authStore';
import { getAvatarUrl } from '@/lib/avatar';

/* ── nav items ───────────────────────────────────────────────────────────── */

const NAV = [
  { to: '/home', icon: House, label: 'Главная' },
  { to: '/discover', icon: Search, label: 'Обзор' },
  { to: '/library', icon: Boxes, label: 'Библиотека' },
  { to: '/skins', icon: Shirt, label: 'Скины' },
  { to: '/settings', icon: Settings, label: 'Настройки' },
];

/* ── sidebar ─────────────────────────────────────────────────────────────── */

function SideItem({ to, icon: Icon, label, active }: { to: string; icon: any; label: string; active: boolean }) {
  const nav = useNavigate();
  return (
    <button
      onClick={() => nav(to)}
      className="relative flex items-center gap-3 w-full px-3 py-2.5 rounded-xl text-left transition-all"
      style={{
        background: active ? 'color-mix(in srgb, var(--color-primary) 14%, transparent)' : 'transparent',
        color: active ? 'var(--color-primary)' : 'var(--color-text-secondary)',
      }}
    >
      {active && (
        <motion.div
          layoutId="innovative-nav-indicator"
          className="absolute left-0 top-1/2 -translate-y-1/2 w-[3px] h-5 rounded-full"
          style={{ background: 'var(--color-primary)' }}
          transition={{ type: 'spring', stiffness: 500, damping: 32 }}
        />
      )}
      <Icon size={18} strokeWidth={active ? 2.2 : 1.8} />
      <span className="text-[13px] font-semibold">{label}</span>
    </button>
  );
}

function InnovativeSidebar() {
  const location = useLocation();
  const user = useCurrentUser();
  const isAuth = useIsAuthenticated();
  const instances = useInstanceStore(s => s.instances);
  const recent = instances.filter(i => i.lastPlayed).sort((a, b) => (b.lastPlayed ?? '').localeCompare(a.lastPlayed ?? '')).slice(0, 3);

  return (
    <aside
      className="flex flex-col h-full select-none"
      style={{
        width: 240,
        background: 'color-mix(in srgb, var(--color-surface) 80%, var(--color-bg))',
        borderRight: '1px solid color-mix(in srgb, var(--color-border) 60%, transparent)',
        backdropFilter: 'blur(40px) saturate(1.5)',
      }}
    >
      {/* brand */}
      <div className="px-5 pt-5 pb-4">
        <div className="flex items-center gap-2.5">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl"
            style={{ background: 'linear-gradient(135deg, var(--color-primary), color-mix(in srgb, var(--color-primary) 70%, #FF6B6B))' }}>
            <Sparkles size={16} color="#fff" />
          </div>
          <div>
            <p className="text-sm font-extrabold" style={{ color: 'var(--color-text)' }}>Portal</p>
            <p className="text-[10px] font-medium" style={{ color: 'var(--color-text-tertiary)' }}>Launcher v2</p>
          </div>
        </div>
      </div>

      {/* nav */}
      <nav className="flex-1 flex flex-col gap-0.5 px-3">
        {NAV.map(item => (
          <SideItem
            key={item.to}
            {...item}
            active={location.pathname === item.to || (item.to !== '/home' && location.pathname.startsWith(item.to))}
          />
        ))}
      </nav>

      {/* recent instances */}
      {recent.length > 0 && (
        <div className="px-3 pb-3">
          <p className="px-3 mb-2 text-[10px] font-bold uppercase tracking-wider" style={{ color: 'var(--color-text-tertiary)' }}>
            Недавние
          </p>
          <div className="flex flex-col gap-1">
            {recent.map(inst => (
              <button
                key={inst.id}
                onClick={() => window.location.hash = `#/library/${inst.id}`}
                className="flex items-center gap-2.5 rounded-lg px-3 py-2 transition-colors hover:bg-white/5"
              >
                <div className="h-7 w-7 rounded-lg overflow-hidden flex items-center justify-center text-[10px] font-bold shrink-0"
                  style={{ background: inst.color || 'var(--color-surface-2)', color: '#fff' }}>
                  {inst.iconPath
                    ? <img src={toIconSrc(inst.iconPath)} className="h-full w-full object-cover" alt="" />
                    : inst.name[0]?.toUpperCase()}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-[11px] font-semibold truncate" style={{ color: 'var(--color-text)' }}>{inst.name}</p>
                  <p className="text-[9px]" style={{ color: 'var(--color-text-tertiary)' }}>{inst.minecraftVersion}</p>
                </div>
                <ChevronRight size={12} style={{ color: 'var(--color-text-tertiary)' }} />
              </button>
            ))}
          </div>
        </div>
      )}

      {/* account */}
      <div className="px-3 pb-4">
        <button className="flex items-center gap-3 w-full px-3 py-2.5 rounded-xl transition-colors hover:bg-white/5"
          style={{ background: 'color-mix(in srgb, var(--color-surface-2) 60%, transparent)' }}>
          <div className="h-8 w-8 rounded-full overflow-hidden flex items-center justify-center"
            style={{ border: '2px solid var(--color-border)' }}>
            {isAuth && user
              ? <CachedPlayerFace user={user} className="h-full w-full" alt="" />
              : <div className="h-full w-full flex items-center justify-center text-[10px] font-bold" style={{ color: 'var(--color-text-tertiary)', background: 'var(--color-surface)' }}>?</div>}
          </div>
          <div className="min-w-0 flex-1 text-left">
            <p className="text-[11px] font-bold truncate" style={{ color: 'var(--color-text)' }}>
              {user?.username ?? 'Войти'}
            </p>
            <p className="text-[9px]" style={{ color: 'var(--color-text-tertiary)' }}>
              {user?.provider === 'microsoft' ? 'Microsoft' : user?.provider === 'elyby' ? 'Ely.by' : user ? 'Offline' : 'Нажмите для входа'}
            </p>
          </div>
        </button>
      </div>
    </aside>
  );
}

/* ── main shell ──────────────────────────────────────────────────────────── */

export function InnovativeShell({ children }: { children: ReactNode }) {
  const mode = useLayoutStore(s => s.mode);
  if (mode !== 'innovative') return <>{children}</>;

  return (
    <div className="flex h-full min-h-0">
      <InnovativeSidebar />
      <main className="flex-1 min-h-0 overflow-auto" style={{ background: 'transparent' }}>
        <motion.div
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
          className="h-full"
        >
          {children}
        </motion.div>
      </main>
    </div>
  );
}

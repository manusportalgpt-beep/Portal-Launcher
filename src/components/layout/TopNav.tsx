import { motion, AnimatePresence } from 'framer-motion';
import { NavLink, useNavigate } from 'react-router-dom';
import {
  Home, Compass, Library, User, Settings, LogIn, Pin, ChevronLeft, ChevronRight,
  type LucideIcon,
} from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useUiStore, type PanelAppearance } from '@/stores/uiStore';
import { useCurrentUser, useIsAuthenticated } from '@/stores/authStore';
import { useInstanceStore } from '@/stores/instanceStore';
import { getAvatarUrl, getAvatarFallbackUrl } from '@/lib/avatar';
import { toIconSrc } from '@/lib/icon-src';
import { CachedPlayerFace } from '@/components/CachedPlayerFace';

interface NavItem { to: string; icon: LucideIcon; labelKey: 'home' | 'discover' | 'skins' | 'library' | 'settings'; end?: boolean }

const NAV: NavItem[] = [
  { to: '/home', icon: Home, labelKey: 'home', end: true },
  { to: '/discover', icon: Compass, labelKey: 'discover' },
  { to: '/skins', icon: User, labelKey: 'skins' },
  { to: '/library', icon: Library, labelKey: 'library' },
];

function orderedNav(order: string[]) {
  return [...NAV].sort((a, b) => {
    const ai = order.indexOf(a.labelKey);
    const bi = order.indexOf(b.labelKey);
    return (ai < 0 ? 999 : ai) - (bi < 0 ? 999 : bi);
  });
}

function DockButton({ item, vertical, scale = 100, appearance }: { item: NavItem; vertical: boolean; scale?: number; appearance: PanelAppearance }) {
  const Icon = item.icon;
  const { t } = useTranslation();
  const uiMode = useUiStore(s => s.uiMode);
  const { activeIndicator, labels, hoverIndicator, interactionShape } = appearance;
  const interactionRadius = interactionShape === 'circle' ? '999px' : 'var(--radius-sm)';
  const label = t(`nav.${item.labelKey}`);
  const showLabel = labels === 'always';
  return (
    <NavLink
      to={item.to}
      end={item.end}
      title={label}
      data-testid={`nav-${item.labelKey}`}
      className="group relative flex items-center justify-center gap-2 px-2.5 text-left"
      style={{ width: showLabel ? '100%' : 36 * scale / 100, minWidth: 36 * scale / 100, height: showLabel ? 42 * scale / 100 : 32 * scale / 100, borderRadius: interactionRadius }}
    >
      {({ isActive }) => (
        <>
          <span className="absolute inset-0 transition-colors"
            style={{ borderRadius: interactionRadius, background: isActive ? activeIndicator === 'pill' ? 'var(--color-primary)' : uiMode === 'old' ? 'var(--color-surface-2)' : 'var(--color-primary-dim)' : 'transparent' }} />
          <span className="pointer-events-none absolute inset-0 opacity-0 transition-opacity group-hover:opacity-100"
            style={{ border: hoverIndicator === 'none' ? '0 solid transparent' : '1px solid color-mix(in srgb, var(--color-primary) 72%, transparent)', borderRadius: hoverIndicator === 'circle' ? '999px' : 'var(--radius-sm)', background: hoverIndicator === 'none' ? 'transparent' : 'color-mix(in srgb, var(--color-primary) 7%, transparent)' }} />
          <span className="pointer-events-none absolute inset-0 opacity-0 transition-opacity duration-100 group-active:opacity-100"
            style={{ borderRadius: interactionRadius, background: 'color-mix(in srgb, var(--color-primary) 18%, transparent)' }} />
          <Icon size={16} strokeWidth={2} shapeRendering="geometricPrecision" vectorEffect="non-scaling-stroke" className="relative shrink-0" style={{
            position: 'relative',
            color: isActive ? activeIndicator === 'pill' ? 'var(--color-primary-text)' : 'var(--color-primary)' : 'var(--color-text-secondary)',
            filter: 'none',
            opacity: 1,
            transform: 'translateZ(0)',
            backfaceVisibility: 'hidden',
            WebkitFontSmoothing: 'antialiased',
          }} />
          {showLabel && <span className="relative flex-1 whitespace-nowrap text-xs font-bold" style={{ color: isActive && activeIndicator === 'pill' ? 'var(--color-primary-text)' : 'var(--color-text-secondary)', transform: 'translateZ(0)', backfaceVisibility: 'hidden', WebkitFontSmoothing: 'antialiased' }}>{label}</span>}
          {isActive && activeIndicator !== 'pill' && (
            <span className="absolute rounded-full" style={{
              ...(activeIndicator === 'dot'
                ? vertical ? { right: 2, width: 5, height: 5 } : { bottom: 2, width: 5, height: 5 }
                : vertical ? { right: 1, width: 2, height: 12 } : { bottom: 1, width: 12, height: 2 }),
              background: 'var(--color-primary)',
            }} />
          )}
        </>
      )}
    </NavLink>
  );
}

/** Быстрый доступ к сборкам — показывается сразу после Library. */
function InstanceQuickAccess({ vertical }: { vertical: boolean }) {
  const navigate = useNavigate();
  const instances = useInstanceStore(s => s.instances);
  const select = useInstanceStore(s => s.select);
  const count = useUiStore(s => s.navInstanceCount);
  const shown = instances.slice(0, count);
  if (shown.length === 0) return null;
  return (
    <div className={`flex ${vertical ? 'flex-col' : 'flex-row'} items-center gap-1`}>
      {shown.map(inst => (
        <button key={inst.id} title={inst.name}
          onClick={() => { select(inst.id); navigate('/library'); }}
          className="rounded-lg overflow-hidden shrink-0 flex items-center justify-center font-bold text-[10px]"
          style={{ width: 24, height: 24, background: inst.color || 'var(--color-surface-2)', color: '#fff' }}>
          {inst.iconPath
            ? <img src={toIconSrc(inst.iconPath)} className="w-full h-full object-cover" alt="" draggable={false} style={{ imageRendering:'auto', filter:'none', opacity:1 }} />
            : inst.name[0]?.toUpperCase()}
        </button>
      ))}
    </div>
  );
}

/** Аватар аккаунта — при клике показывает, каким способом выполнен вход. */
function AccountButton() {
  const navigate = useNavigate();
  const { t } = useTranslation();
  const user = useCurrentUser();
  const isAuthenticated = useIsAuthenticated();
  const [open, setOpen] = useState(false);
  const avatar = getAvatarUrl(user);

  const providerLabel = !user ? ''
    : user.provider === 'elyby' ? 'Ely.by'
    : user.provider === 'offline' || user.isDemo ? 'Offline'
    : 'Microsoft';

  return (
    <div className="relative">
      <button title={isAuthenticated && user ? user.username : t('auth.signIn')}
        onClick={() => isAuthenticated ? setOpen(v => !v) : navigate('/settings/account')}
        className="flex items-center justify-center rounded-lg overflow-hidden shrink-0"
        style={{ width: 24, height: 24, background: 'var(--color-surface-2)' }}>
        {isAuthenticated && user
          ? <CachedPlayerFace user={user} className="w-full h-full" alt="" />
          : isAuthenticated && user
          ? <span className="text-[10px] font-bold" style={{ color: 'var(--color-primary)' }}>{user.username[0]}</span>
          : <LogIn size={13} style={{ color: 'var(--color-text-tertiary)' }} />}
      </button>
      {open && isAuthenticated && user && (
        <div className="absolute top-full right-0 mt-2 px-3 py-2 rounded-lg whitespace-nowrap text-xs font-semibold z-50"
          style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', boxShadow: 'var(--shadow-md)', color: 'var(--color-text)' }}
          onMouseLeave={() => setOpen(false)}>
          {user.username} · {providerLabel}
        </div>
      )}
    </div>
  );
}

/** Боковая навигация (режим "Sidebar"). */
function SidebarNav() {
  const order = useUiStore(s => s.navItemOrder);
  const sidebarWidth = useUiStore(s => s.sidebarWidth);
  const scale = useUiStore(s => s.navItemScale);
  const appearance = useUiStore(s => s.sidebarPanelAppearance);
  const uiMode = useUiStore(s => s.uiMode);
  const items = orderedNav(order);
  const justifyContent = appearance.alignment === 'start' ? 'flex-start' : appearance.alignment === 'end' ? 'flex-end' : 'center';
  const borderColor = appearance.border === 'none' ? 'transparent' : appearance.border === 'strong' ? 'var(--color-border-strong)' : 'var(--color-border)';
  const shadowValue = appearance.shadow === 'none' ? 'none' : appearance.shadow === 'strong' ? '12px 0 38px rgba(0,0,0,0.28)' : '8px 0 24px rgba(0,0,0,0.14)';
  return (
    <aside className="shrink-0 flex flex-col z-40"
      style={{ width: sidebarWidth, gap:appearance.gap, padding: `${appearance.edgePadding}px 10px`, justifyContent, background: uiMode === 'old' ? 'var(--color-surface)' : `color-mix(in srgb, var(--color-surface) ${Math.max(appearance.opacity, 99)}%, transparent)`, borderRight: `1px solid ${borderColor}`, boxShadow: uiMode === 'old' ? 'none' : shadowValue, backdropFilter: 'none', WebkitBackdropFilter: 'none', transition: 'width calc(180ms * var(--portal-motion-multiplier, 1)) ease, background calc(180ms * var(--portal-motion-multiplier, 1)) ease, box-shadow calc(180ms * var(--portal-motion-multiplier, 1)) ease' }}>
      <div className="px-2 pb-3 text-[10px] font-black uppercase tracking-[0.16em]" style={{ color:'var(--color-text-tertiary)' }}>Portal Launcher</div>
      {items.map(item => <DockButton key={item.to} item={item} vertical scale={scale} appearance={appearance} />)}
      <div className="h-px my-2" style={{ background: 'var(--color-border)' }} />
      <InstanceQuickAccess vertical />
      <div className="flex-1" />
      <div className="px-2"><AccountButton /></div>
      <DockButton item={{ to: '/settings', icon: Settings, labelKey: 'settings' }} vertical scale={scale} appearance={appearance} />
    </aside>
  );
}

/** Выезжающая минималистичная Notch-панель. Перетаскивание окна отключено. */
function NotchNav() {
  const { notchHotzone, notchPinned, notchCloseDelay, notchWidth, notchSide, navHoverMs, navItemScale, navItemOrder, panelVersion, uiMode, notchPanelAppearance: appearance, set } = useUiStore();
  const visualPanelVersion = uiMode === 'old' ? 'old' : panelVersion;
  const items = orderedNav(navItemOrder);
  const [hover, setHover] = useState(false);
  const [overlayOpen, setOverlayOpen] = useState(() => Boolean(document.body.dataset.portalOverlay));
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const openNotch = () => { if (overlayOpen) return; if (closeTimer.current) clearTimeout(closeTimer.current); setHover(true); };
  const scheduleClose = () => { if (closeTimer.current) clearTimeout(closeTimer.current); closeTimer.current = setTimeout(() => setHover(false), notchCloseDelay); };
  useEffect(() => {
    const syncOverlay = () => setOverlayOpen(Boolean(document.body.dataset.portalOverlay));
    window.addEventListener('portal-overlay-change', syncOverlay);
    return () => { window.removeEventListener('portal-overlay-change', syncOverlay); if (closeTimer.current) clearTimeout(closeTimer.current); };
  }, []);
  const open = !overlayOpen && (hover || notchPinned);
  const vertical = notchSide === 'left' || notchSide === 'right';
  const isStart = notchSide === 'top' || notchSide === 'left';
  const align = appearance.alignment === 'start' ? 'flex-start' : appearance.alignment === 'end' ? 'flex-end' : 'center';
  const borderColor = appearance.border === 'none' ? 'transparent' : appearance.border === 'strong' ? 'var(--color-border-strong)' : 'var(--color-border)';
  const shadowValue = appearance.shadow === 'none' ? 'none' : appearance.shadow === 'strong' ? 'var(--shadow-lg)' : 'var(--shadow-md)';
  const crossAxisPosition: React.CSSProperties = vertical
    ? appearance.alignment === 'start' ? { top: appearance.edgePadding } : appearance.alignment === 'end' ? { bottom: appearance.edgePadding } : { top: '50%', transform: 'translateY(-50%)' }
    : appearance.alignment === 'start' ? { left: appearance.edgePadding } : appearance.alignment === 'end' ? { right: appearance.edgePadding } : { left: '50%', transform: 'translateX(-50%)' };

  const wrap: React.CSSProperties = {
    position: 'fixed',
    zIndex: 50,
    display: 'flex',
    alignItems: 'center',
    justifyContent: align,
    pointerEvents: 'none',
    ...crossAxisPosition,
    ...(vertical
      ? { [notchSide]: 0, width: notchHotzone, height: `${notchWidth}vh` }
      : { [notchSide]: 0, width: `${notchWidth}vw`, height: notchHotzone }),
  };

  const offset = vertical ? { x: isStart ? -14 : 14 } : { y: isStart ? -14 : 14 };

  return (
    <div style={wrap}>
      {/* Hitbox exactly follows the visible Notch span; it no longer covers the entire screen edge. */}
      <div
        onMouseEnter={openNotch}
        onMouseLeave={scheduleClose}
        className="flex items-center justify-center"
        style={{
          pointerEvents: 'auto',
          height: vertical ? '100%' : notchHotzone,
          width: vertical ? notchHotzone : '100%',
          flexDirection: vertical ? 'row' : 'column',
          alignSelf: vertical ? align : 'auto',
        }}
      >
        <AnimatePresence>
          {!open && (
            <motion.div key="handle" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              className="rounded-full"
              style={{
                background: 'var(--color-border-strong)',
                ...(vertical ? { width: 3, height: 40 } : { width: 40, height: 3 }),
              }} />
          )}
        </AnimatePresence>

        <AnimatePresence>
          {open && (
            <motion.nav key="dock"
              initial={{ opacity: 0, ...offset }} animate={{ opacity: 1, x: 0, y: 0 }} exit={{ opacity: 0, ...offset }}
              transition={{ duration: Math.max(0.12, navHoverMs / 1000), ease: [0.22, 0.78, 0.24, 1] }}
              className={`flex ${vertical ? 'flex-col' : 'flex-row'} items-center gap-1 rounded-xl`}
              style={{
                padding: Math.max(visualPanelVersion === 'new' ? 7 : 5, appearance.edgePadding / 2),
                gap: appearance.gap,
                background: visualPanelVersion === 'old' ? 'var(--color-surface)' : `color-mix(in srgb, var(--color-surface) ${Math.max(appearance.opacity, 99)}%, transparent)`,
                border: `1px solid ${borderColor}`,
                borderRadius: visualPanelVersion === 'new' ? 'var(--radius-modal)' : 'var(--radius-xl)',
                backdropFilter: 'none',
                WebkitBackdropFilter: 'none',
                boxShadow: visualPanelVersion === 'old' ? 'none' : shadowValue,
              }}>
              {items.map(item => <DockButton key={item.to} item={item} vertical={vertical} scale={navItemScale} appearance={appearance} />)}
              <InstanceQuickAccess vertical={vertical} />
              <div className={vertical ? 'w-full h-px my-0.5' : 'h-6 w-px mx-0.5'}
                style={{ background: 'var(--color-border)' }} />
              <div className={`flex ${vertical ? 'flex-col' : 'flex-row'} items-center gap-1`}>
                <AccountButton />
                <DockButton item={{ to: '/settings', icon: Settings, labelKey: 'settings' }} vertical={vertical} scale={navItemScale} appearance={appearance} />
                <button title="Назад" onClick={() => window.history.back()} className="rounded-md p-1" style={{ color:'var(--color-text-secondary)', background:'transparent' }} onMouseEnter={event => { event.currentTarget.style.background = 'var(--color-surface-hover)'; }} onMouseLeave={event => { event.currentTarget.style.background = 'transparent'; }}><ChevronLeft size={13} /></button>
                <button title="Вперёд" onClick={() => window.history.forward()} className="rounded-md p-1" style={{ color:'var(--color-text-secondary)', background:'transparent' }} onMouseEnter={event => { event.currentTarget.style.background = 'var(--color-surface-hover)'; }} onMouseLeave={event => { event.currentTarget.style.background = 'transparent'; }}><ChevronRight size={13} /></button>
                <button title="Pin panel" onClick={() => set('notchPinned', !notchPinned)}
                  className="flex items-center justify-center rounded-md"
                  style={{ width: 18, height: 18, color: notchPinned ? 'var(--color-primary)' : 'var(--color-text-tertiary)', background:'transparent' }}
                  onMouseEnter={event => { event.currentTarget.style.background = 'var(--color-surface-hover)'; }} onMouseLeave={event => { event.currentTarget.style.background = 'transparent'; }}>
                  <Pin size={12} />
                </button>
              </div>
            </motion.nav>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}

export function TopNav() {
  const navMode = useUiStore(s => s.navMode);
  return navMode === 'sidebar' ? <SidebarNav /> : <NotchNav />;
}

export default TopNav;

import { motion, AnimatePresence } from 'framer-motion';
import { NavLink, useNavigate } from 'react-router-dom';
import {
  House, Search, Boxes, Shirt, SlidersHorizontal, PanelsTopLeft, LogIn, Pin, ChevronLeft, ChevronRight, Bot,
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
  { to: '/home', icon: House, labelKey: 'home', end: true },
  { to: '/discover', icon: Search, labelKey: 'discover' },
  { to: '/skins', icon: Shirt, labelKey: 'skins' },
  { to: '/library', icon: Boxes, labelKey: 'library' },
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
  const navHoverMs = useUiStore(s => s.navHoverMs);
  const { labels } = appearance;
  const interactionRadius = 'var(--radius-sm)';
  const label = t(`nav.${item.labelKey}`);
  const showLabel = labels === 'always';
  const revealLabelOnHover = labels === 'hover';
  return (
    <NavLink
      to={item.to}
      end={item.end}
      title={label}
      data-testid={`nav-${item.labelKey}`}
      className="group relative flex items-center justify-center gap-2 px-2.5 text-left"
      style={{ width: showLabel ? '100%' : (vertical ? 40 : 34) * scale / 100, minWidth: (vertical ? 40 : 34) * scale / 100, height: showLabel ? 42 * scale / 100 : (vertical ? 40 : 34) * scale / 100, borderRadius: interactionRadius, isolation:'isolate' }}
    >
      {({ isActive }) => (
        <>
          <span className="pointer-events-none absolute inset-0"
            style={{ zIndex:-1, border:`1px solid ${isActive ? 'var(--color-primary)' : 'transparent'}`, borderRadius: interactionRadius, background: isActive ? 'var(--color-surface)' : 'transparent' }} />
          {!isActive && <span className="pointer-events-none absolute inset-0 opacity-0 transition-opacity group-hover:opacity-100"
            style={{ zIndex:-1, transitionDuration:`${navHoverMs}ms`, border:'1px solid var(--color-border-strong)', borderRadius:interactionRadius, background:'var(--color-surface-hover)', willChange:'opacity' }} />}
          <span className="pointer-events-none absolute inset-0 opacity-0 transition-opacity duration-100 group-active:opacity-100"
            style={{ zIndex:-1, border:'1px solid var(--color-primary)', borderRadius: interactionRadius, background:'transparent', willChange:'opacity' }} />
          <Icon size={16} strokeWidth={2} shapeRendering="geometricPrecision" vectorEffect="non-scaling-stroke" className="relative shrink-0" style={{
            position: 'relative',
            color: isActive ? 'var(--color-primary)' : 'var(--color-text-secondary)',
            filter: 'none',
            opacity: 1,
            transform: 'translateZ(0)',
            backfaceVisibility: 'hidden',
            WebkitFontSmoothing: 'antialiased',
          }} />
          {(showLabel || revealLabelOnHover) && <span className={`nav-dock-label relative whitespace-nowrap text-xs font-bold ${showLabel ? 'flex-1' : 'max-w-0 overflow-hidden opacity-0 transition-[max-width,opacity] group-hover:max-w-28 group-hover:opacity-100'}`} style={{ transitionDuration: revealLabelOnHover ? `${navHoverMs}ms` : undefined, color:'var(--color-text-secondary)', transform: 'translateZ(0)', backfaceVisibility: 'hidden', WebkitFontSmoothing: 'antialiased' }}>{label}</span>}
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
  return (
    <div className={`flex ${vertical ? 'flex-col' : 'flex-row'} items-center gap-1`}>
      {shown.map(inst => (
        <button key={inst.id} title={inst.name}
          onClick={() => { select(inst.id); navigate('/library'); }}
          className="rounded-sm overflow-hidden shrink-0 flex items-center justify-center font-bold text-[10px]"
          style={{ width: vertical ? 40 : 32, height: vertical ? 40 : 32, background: inst.color || 'var(--color-surface-2)', color: '#fff', border:'1px solid var(--color-border)' }}>
          {inst.iconPath
            ? <img src={toIconSrc(inst.iconPath)} className="w-full h-full object-cover" alt="" draggable={false} style={{ imageRendering:'auto', filter:'none', opacity:1 }} />
            : inst.name[0]?.toUpperCase()}
        </button>
      ))}
    </div>
  );
}

/** Аватар аккаунта — при клике показывает, каким способом выполнен вход. */
function AccountButton({ vertical = false }: { vertical?: boolean }) {
  const navigate = useNavigate();
  const { t } = useTranslation();
  const user = useCurrentUser();
  const isAuthenticated = useIsAuthenticated();
  const [open, setOpen] = useState(false);
  const avatar = getAvatarUrl(user);

  const providerLabel = !user ? ''
    : user.provider === 'elyby' ? 'Ely.by'
    : user.provider === 'nickname' ? 'По нику'
    : user.provider === 'offline' || user.isDemo ? 'Offline'
    : 'Microsoft';

  return (
    <div className="relative">
      <button title={isAuthenticated && user ? user.username : t('auth.signIn')}
        onClick={() => isAuthenticated ? setOpen(v => !v) : navigate('/settings/account')}
        className="flex items-center justify-center rounded-sm overflow-hidden shrink-0"
        style={{ width: vertical ? 40 : 32, height: vertical ? 40 : 32, background: 'var(--color-surface-2)', border:'1px solid var(--color-border)' }}>
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
  const items = orderedNav(order);
  const justifyContent = appearance.alignment === 'start' ? 'flex-start' : appearance.alignment === 'end' ? 'flex-end' : 'center';
  const borderColor = appearance.border === 'none' ? 'transparent' : appearance.border === 'strong' ? 'var(--color-border-strong)' : 'var(--color-border)';
  return (
    <aside className="portal-sidebar clean-nav shrink-0 flex flex-col z-40"
      style={{ width: Math.max(84, sidebarWidth), gap:Math.min(appearance.gap, 5), padding: `${Math.min(appearance.edgePadding, 12)}px 12px`, justifyContent, background:'var(--color-bg)', borderRight:'1px solid var(--color-border)', boxShadow:'none', backdropFilter:'none', WebkitBackdropFilter:'none', transition: 'width calc(180ms * var(--portal-motion-multiplier, 1)) ease' }}>
      <div className="nav-identity flex h-10 items-center justify-center" title="Portal Launcher">
        <span className="portal-brand-tile relative"><img src="/launcher-icon.png?rev=portal-square-1" alt="Portal Launcher" draggable={false} /></span>
      </div>
      {items.map(item => <DockButton key={item.to} item={item} vertical scale={scale} appearance={appearance} />)}
      <InstanceQuickAccess vertical />
      <div className="flex-1" />
      <div className="flex justify-center"><AccountButton vertical /></div>
      <DockButton item={{ to: '/settings', icon: SlidersHorizontal, labelKey: 'settings' }} vertical scale={scale} appearance={appearance} />
      <button title="AI Assistant" onClick={() => window.dispatchEvent(new CustomEvent('portal:toggle-ai'))} className="portal-sidebar flex items-center justify-center shrink-0 relative" style={{ width:40, height:40, color:'var(--color-primary)', background:'transparent', borderRadius:6 }}><Bot size={18} /></button>
    </aside>
  );
}

/** Выезжающая минималистичная Notch-панель. Перетаскивание окна отключено. */
function NotchNav() {
  const { t } = useTranslation();
  const { notchPinned, notchSide, notchHotzone, notchOpenOnTab, notchAboveHotzone, notchDockScale, navItemScale, navItemOrder, panelVersion, uiMode, titlebarHeight, notchPanelAppearance: appearance, set } = useUiStore();
  const visualPanelVersion = uiMode === 'old' ? 'old' : panelVersion;
  const items = orderedNav(navItemOrder);
  const [hover, setHover] = useState(false);
  const [overlayOpen, setOverlayOpen] = useState(() => Boolean(document.body.dataset.portalOverlay));
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const openNotch = () => { if (overlayOpen) return; if (closeTimer.current) clearTimeout(closeTimer.current); setHover(true); };
  const scheduleClose = () => { if (closeTimer.current) clearTimeout(closeTimer.current); closeTimer.current = setTimeout(() => setHover(false), 110); };
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
  const dockScale = notchDockScale / 100;
  const tabHitbox = notchOpenOnTab ? Math.max(40, notchHotzone) : 40;
  const crossAxisPosition: React.CSSProperties = vertical
    ? appearance.alignment === 'start' ? { top: appearance.edgePadding } : appearance.alignment === 'end' ? { bottom: appearance.edgePadding } : { top: '50%', transform: 'translateY(-50%)' }
    : appearance.alignment === 'start' ? { left: appearance.edgePadding } : appearance.alignment === 'end' ? { right: appearance.edgePadding } : { left: '50%', transform: 'translateX(-50%)' };

  const wrap: React.CSSProperties = {
    position: 'fixed',
    // Keep the dock just below the native-looking Title Bar rather than
    // clipping its top edge behind it. It still sits above page content.
    zIndex: 250,
    display: 'flex',
    alignItems: 'center',
    justifyContent: align,
    pointerEvents: 'none',
    ...crossAxisPosition,
    ...(vertical
      ? { [notchSide]: 0, width: 14, height: tabHitbox }
      : { [notchSide]: notchSide === 'top' ? titlebarHeight : 0, width: tabHitbox, height: 14 }),
  };

  const offset = vertical ? { x: isStart ? -14 : 14 } : { y: isStart ? -14 : 14 };

  return (
    <div style={wrap}>
      {/* Hitbox exactly follows the visible Notch span; it no longer covers the entire screen edge. */}
      <div
        onMouseEnter={notchOpenOnTab ? openNotch : undefined}
        onMouseLeave={scheduleClose}
        className="flex items-center justify-center"
        style={{
          pointerEvents: 'auto',
          height: vertical ? '100%' : 14,
          width: vertical ? 14 : '100%',
          flexDirection: vertical ? 'row' : 'column',
          alignSelf: vertical ? align : 'auto',
        }}
      >
        {notchAboveHotzone > 0 && (
          <div onMouseEnter={openNotch} onMouseLeave={scheduleClose} style={{ position:'absolute', pointerEvents:'auto', ...(vertical ? { width:notchAboveHotzone, height:'100%', [isStart ? 'left' : 'right']:-notchAboveHotzone } : { width:'100%', height:notchAboveHotzone, [isStart ? 'top' : 'bottom']:-notchAboveHotzone }) }} />
        )}
        <AnimatePresence>
          {!open && (
            <motion.div key="handle" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              style={{
                background: 'var(--color-border-strong)',
                borderRadius:2,
                ...(vertical ? { width: 4, height: 28 } : { width: 28, height: 4 }),
              }} />
          )}
        </AnimatePresence>

        <AnimatePresence>
          {open && (
            <motion.nav key="dock"
              initial={{ opacity: 0, scale: dockScale * 0.96, ...offset }} animate={{ opacity: 1, scale: dockScale, x: 0, y: 0 }} exit={{ opacity: 0, scale: dockScale * 0.96, ...offset }}
              transition={{ duration: 0.12, ease: [0.22, 0.78, 0.24, 1] }}
              className={`portal-notch clean-nav flex ${vertical ? 'flex-col' : 'flex-row'} items-center gap-1 rounded-xl`}
              style={{
                position: 'absolute',
                zIndex: 1,
                // No offset: the opened surface is directly stitched to the
                // top UI edge, with no dark separator between the two.
                ...(vertical ? { [isStart ? 'left' : 'right']: 0 } : { [isStart ? 'top' : 'bottom']: 0 }),
                padding: Math.max(visualPanelVersion === 'new' ? 5 : 4, Math.min(5, appearance.edgePadding / 2)),
                gap: Math.min(appearance.gap, 3),
                background:'var(--color-bg)',
                border:'1px solid var(--color-border)',
                borderRadius:'var(--radius-sm)',
                backdropFilter:'none',
                WebkitBackdropFilter:'none',
                boxShadow:'none',
                transformOrigin: vertical ? (isStart ? 'left center' : 'right center') : (isStart ? 'center top' : 'center bottom'),
              }}>
              {items.map(item => <DockButton key={item.to} item={item} vertical={vertical} scale={navItemScale} appearance={appearance} />)}
              <InstanceQuickAccess vertical={vertical} />
              <div className={`flex ${vertical ? 'flex-col' : 'flex-row'} items-center gap-1`}>
                <AccountButton vertical={vertical} />
                <DockButton item={{ to: '/settings', icon: SlidersHorizontal, labelKey: 'settings' }} vertical={vertical} scale={navItemScale} appearance={appearance} />
                <button title="AI Assistant" onClick={() => window.dispatchEvent(new CustomEvent('portal:toggle-ai'))} className="flex items-center justify-center rounded-sm" style={{ width:28, height:28, color: 'var(--color-primary)', background:'transparent', border:'1px solid var(--color-border)' }} onMouseEnter={event => { event.currentTarget.style.background = 'var(--color-surface-hover)'; }} onMouseLeave={event => { event.currentTarget.style.background = 'transparent'; }}><Bot size={16} /></button>
                <button title="Назад" onClick={() => window.history.back()} className="flex items-center justify-center rounded-sm" style={{ width:28, height:28, color:'var(--color-text-secondary)', background:'transparent', border:'1px solid var(--color-border)' }} onMouseEnter={event => { event.currentTarget.style.background = 'var(--color-surface-hover)'; }} onMouseLeave={event => { event.currentTarget.style.background = 'transparent'; }}><ChevronLeft size={18} /></button>
                <button title="Вперёд" onClick={() => window.history.forward()} className="flex items-center justify-center rounded-sm" style={{ width:28, height:28, color:'var(--color-text-secondary)', background:'transparent', border:'1px solid var(--color-border)' }} onMouseEnter={event => { event.currentTarget.style.background = 'var(--color-surface-hover)'; }} onMouseLeave={event => { event.currentTarget.style.background = 'transparent'; }}><ChevronRight size={18} /></button>
                <button title={t('notch.pin')} onClick={() => set('notchPinned', !notchPinned)}
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

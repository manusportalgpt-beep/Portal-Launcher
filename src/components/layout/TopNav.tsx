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
      style={{ width: showLabel ? '100%' : 36 * scale / 100, minWidth: 36 * scale / 100, height: showLabel ? 42 * scale / 100 : 32 * scale / 100, borderRadius: interactionRadius, isolation:'isolate' }}
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
          {(showLabel || revealLabelOnHover) && <span className={`relative whitespace-nowrap text-xs font-bold ${showLabel ? 'flex-1' : 'max-w-0 overflow-hidden opacity-0 transition-[max-width,opacity] group-hover:max-w-28 group-hover:opacity-100'}`} style={{ transitionDuration: revealLabelOnHover ? `${navHoverMs}ms` : undefined, color:'var(--color-text-secondary)', transform: 'translateZ(0)', backfaceVisibility: 'hidden', WebkitFontSmoothing: 'antialiased' }}>{label}</span>}
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
  const items = orderedNav(order);
  const justifyContent = appearance.alignment === 'start' ? 'flex-start' : appearance.alignment === 'end' ? 'flex-end' : 'center';
  const borderColor = appearance.border === 'none' ? 'transparent' : appearance.border === 'strong' ? 'var(--color-border-strong)' : 'var(--color-border)';
  return (
    <aside className="clean-nav shrink-0 flex flex-col z-40"
      style={{ width: sidebarWidth, gap:appearance.gap, padding: `${appearance.edgePadding}px 10px`, justifyContent, background:'var(--color-surface)', borderRight: `1px solid ${borderColor}`, boxShadow:'none', backdropFilter:'none', WebkitBackdropFilter:'none', transition: 'width calc(180ms * var(--portal-motion-multiplier, 1)) ease, background calc(180ms * var(--portal-motion-multiplier, 1)) ease' }}>
      <div className="px-2 pb-3 text-[10px] font-black uppercase tracking-[0.16em]" style={{ color:'var(--color-text-tertiary)' }}>Portal Launcher</div>
      {items.map(item => <DockButton key={item.to} item={item} vertical scale={scale} appearance={appearance} />)}
      <InstanceQuickAccess vertical />
      <div className="flex-1" />
      <div className="px-2"><AccountButton /></div>
      <DockButton item={{ to: '/settings', icon: Settings, labelKey: 'settings' }} vertical scale={scale} appearance={appearance} />
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
                ...(vertical ? { width: 6, height: 34 } : { width: 34, height: 6 }),
              }} />
          )}
        </AnimatePresence>

        <AnimatePresence>
          {open && (
            <motion.nav key="dock"
              initial={{ opacity: 0, scale: dockScale * 0.96, ...offset }} animate={{ opacity: 1, scale: dockScale, x: 0, y: 0 }} exit={{ opacity: 0, scale: dockScale * 0.96, ...offset }}
              transition={{ duration: 0.12, ease: [0.22, 0.78, 0.24, 1] }}
              className={`clean-nav flex ${vertical ? 'flex-col' : 'flex-row'} items-center gap-1 rounded-xl`}
              style={{
                position: 'absolute',
                zIndex: 1,
                // No offset: the opened surface is directly stitched to the
                // top UI edge, with no dark separator between the two.
                ...(vertical ? { [isStart ? 'left' : 'right']: 0 } : { [isStart ? 'top' : 'bottom']: 0 }),
                padding: Math.max(visualPanelVersion === 'new' ? 5 : 4, Math.min(5, appearance.edgePadding / 2)),
                gap: Math.min(appearance.gap, 3),
                background:'var(--color-surface)',
                border: `1px solid ${borderColor}`,
                borderRadius: visualPanelVersion === 'new' ? 'var(--radius-modal)' : 'var(--radius-xl)',
                backdropFilter:'none',
                WebkitBackdropFilter:'none',
                boxShadow:'none',
                transformOrigin: vertical ? (isStart ? 'left center' : 'right center') : (isStart ? 'center top' : 'center bottom'),
              }}>
              {items.map(item => <DockButton key={item.to} item={item} vertical={vertical} scale={navItemScale} appearance={appearance} />)}
              <InstanceQuickAccess vertical={vertical} />
              <div className={`flex ${vertical ? 'flex-col' : 'flex-row'} items-center gap-1`}>
                <AccountButton />
                <DockButton item={{ to: '/settings', icon: Settings, labelKey: 'settings' }} vertical={vertical} scale={navItemScale} appearance={appearance} />
                <button title="Назад" onClick={() => window.history.back()} className="rounded-md p-1" style={{ color:'var(--color-text-secondary)', background:'transparent' }} onMouseEnter={event => { event.currentTarget.style.background = 'var(--color-surface-hover)'; }} onMouseLeave={event => { event.currentTarget.style.background = 'transparent'; }}><ChevronLeft size={13} /></button>
                <button title="Вперёд" onClick={() => window.history.forward()} className="rounded-md p-1" style={{ color:'var(--color-text-secondary)', background:'transparent' }} onMouseEnter={event => { event.currentTarget.style.background = 'var(--color-surface-hover)'; }} onMouseLeave={event => { event.currentTarget.style.background = 'transparent'; }}><ChevronRight size={13} /></button>
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

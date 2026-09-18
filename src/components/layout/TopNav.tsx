import { motion, AnimatePresence } from 'framer-motion';
import { NavLink, useNavigate } from 'react-router-dom';
import {
  House, Search, Boxes, Shirt, SlidersHorizontal, PanelsTopLeft, LogIn, Pin, ChevronLeft, ChevronRight, Bot,
  type LucideIcon,
} from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useUiStore, type PanelAppearance } from '@/stores/uiStore';
import { useCurrentUser, useIsAuthenticated } from '@/stores/authStore';
import { useInstanceStore, type Instance } from '@/stores/instanceStore';
import { useLaunchStore } from '@/stores/launchStore';
import { useSettingsStore } from '@/stores/settingsStore';
import { invoke } from '@/lib/invoke-shim';
import { getAvatarUrl, getAvatarFallbackUrl } from '@/lib/avatar';
import { toIconSrc } from '@/lib/icon-src';
import { CachedPlayerFace } from '@/components/CachedPlayerFace';
import './portal-sidebar.css';

interface NavItem { to: string; icon: LucideIcon; labelKey: 'home' | 'discover' | 'skins' | 'library' | 'settings' | 'openportal'; end?: boolean }

const NAV: NavItem[] = [
  { to: '/home', icon: House, labelKey: 'home', end: true },
  { to: '/discover', icon: Search, labelKey: 'discover' },
  { to: '/skins', icon: Shirt, labelKey: 'skins' },
  { to: '/library', icon: Boxes, labelKey: 'library' },
  { to: '/openportal', icon: Bot, labelKey: 'openportal' },
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

/** Пункт боковой панели в портальном стиле (стандартный режим). */
function PortalSidebarItem({ item, scale = 100 }: { item: NavItem; scale?: number }) {
  const Icon = item.icon;
  const { t } = useTranslation();
  const label = t(`nav.${item.labelKey}`);
  const height = Math.max(36, Math.round(42 * scale / 100));
  return (
    <NavLink
      to={item.to}
      end={item.end}
      title={label}
      data-testid={`nav-${item.labelKey}`}
      className="ps-nav-item group"
      style={{ height }}
    >
      {({ isActive }) => (
        <>
          <span className="ps-nav-icon" style={{ color: isActive ? 'var(--color-primary)' : 'var(--color-text-secondary)' }}>
            <Icon size={15} strokeWidth={2} />
          </span>
          <span className="ps-nav-label">{label}</span>
          <ChevronRight size={13} className="ps-nav-chev" style={{ color: 'var(--color-primary)' }} />
        </>
      )}
    </NavLink>
  );
}

/** Быстрый доступ к сборкам — показывается сразу после Library. */
function InstanceQuickAccess({ vertical, shape = 'round', grid = false }: { vertical: boolean; shape?: 'round' | 'square'; grid?: boolean }) {
  const navigate = useNavigate();
  const instances = useInstanceStore(s => s.instances);
  const update = useInstanceStore(s => s.update);
  const count = useUiStore(s => s.navInstanceCount);
  const user = useCurrentUser();
  const globalSettings = useSettingsStore(s => ({
    minRam: s.minRam, maxRam: s.maxRam, javaPath: s.javaPath, customJvmArgs: s.customJvmArgs,
  }));
  const getStatus = useLaunchStore(s => s.getStatus);
  const setStatus = useLaunchStore(s => s.setStatus);

  // ПКМ по иконке запускает сборку (без изменений в логике запуска — тот же
  // путь ensure_instance → launch_instance, что и в библиотеке).
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

  const shown = instances.slice(0, count);
  const isSquare = shape === 'square';
  return (
    <div className={grid ? 'ps-instances' : `flex ${vertical ? 'flex-col' : 'flex-row'} items-center gap-1`}>
      {shown.map(inst => {
        const status = getStatus(inst.id);
        const busy = status === 'launching';
        const running = status === 'running';
        return (
          <button key={inst.id} title={`${inst.name} — ЛКМ: настройки · ПКМ: запуск`}
            onClick={() => navigate(`/library/${inst.id}`)}
            onContextMenu={e => { e.preventDefault(); void launch(inst); }}
            disabled={busy}
            className={`${isSquare ? 'ps-inst' : 'rounded-full transition-transform hover:scale-110'} overflow-hidden shrink-0 flex items-center justify-center font-bold text-[10px] select-none cursor-pointer`}
            style={{ width: isSquare ? '100%' : (vertical ? 40 : 32), height: isSquare ? undefined : (vertical ? 40 : 32), aspectRatio: isSquare ? 1 : undefined, background: inst.color || 'var(--color-surface-2)', color: '#fff', border: running ? '2px solid var(--color-success)' : '1px solid var(--color-border)' }}>
            {busy
              ? <span className="h-3 w-3 rounded-full border-2 border-white/80 border-t-transparent animate-spin" />
              : inst.iconPath
                ? <img src={toIconSrc(inst.iconPath)} className="w-full h-full object-cover" alt="" draggable={false} style={{ imageRendering:'auto', filter:'none', opacity:1 }} />
                : <span className="letter">{inst.name[0]?.toUpperCase()}</span>}
          </button>
        );
      })}
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
          <div className="font-bold">{user.username}</div>
          <div className="text-[10px]" style={{ color:'var(--color-text-secondary)' }}>{providerLabel}</div>
          {user.provider === 'elyby' && (
            <button onClick={() => { window.open('https://account.ely.by/#/profile', '_blank'); setOpen(false); }}
              className="mt-1.5 flex items-center gap-1.5 w-full px-2 py-1 rounded text-[10px] hover:bg-white/5"
              style={{ color:'var(--color-text-secondary)' }}>
              <Shirt className="w-3 h-3" />Изменить скин
            </button>
          )}
        </div>
      )}
    </div>
  );
}

/** Боковая навигация (режим "Sidebar") — портальная тема. */
function SidebarNav() {
  const order = useUiStore(s => s.navItemOrder);
  const sidebarWidth = useUiStore(s => s.sidebarWidth);
  const scale = useUiStore(s => s.navItemScale);
  const appearance = useUiStore(s => s.sidebarPanelAppearance);
  const user = useCurrentUser();
  const isAuthenticated = useIsAuthenticated();
  const items = orderedNav(order);
  const justifyContent = appearance.alignment === 'start' ? 'flex-start' : appearance.alignment === 'end' ? 'flex-end' : 'center';
  const borderColor = appearance.border === 'none' ? 'transparent' : appearance.border === 'strong' ? 'var(--color-border-strong)' : 'var(--color-border)';
  const alpha = Math.min(appearance.opacity, 100);
  const providerLabel = !user ? ''
    : user.provider === 'elyby' ? 'Ely.by'
    : user.provider === 'nickname' ? 'По нику'
    : user.provider === 'offline' || user.isDemo ? 'Offline'
    : 'Microsoft';
  return (
    <aside className={`portal-sidebar clean-nav portal-skin shrink-0 flex flex-col z-40${appearance.blur > 0 ? ' ps-blurred' : ''}`}
      style={{
        width: Math.max(84, sidebarWidth),
        padding: '10px 10px',
        justifyContent,
        borderRight: `1px solid ${borderColor}`,
        ['--ps-alpha' as string]: `${alpha}%`,
        ['--ps-blur' as string]: appearance.blur > 0 ? `${appearance.blur}px` : '0px',
        ['--ps-gap' as string]: `${Math.min(appearance.gap, 5)}px`,
        boxShadow: appearance.shadow === 'strong' ? '3px 0 20px rgba(0,0,0,.35)' : appearance.shadow === 'soft' ? '1px 0 14px rgba(0,0,0,.22)' : 'none',
        transition: 'width calc(180ms * var(--portal-motion-multiplier, 1)) ease',
      } as React.CSSProperties}>
      <div className="ps-brand" title="Portal Launcher">
        <span className="ps-logo"><img src="/launcher-icon.png?rev=portal-square-1" alt="Portal Launcher" draggable={false} /></span>
        <span className="ps-brandname">Portal<small>Launcher</small></span>
      </div>

      <span className="ps-label">Навигация</span>
      <nav className="ps-nav">
        {items.map(item => <PortalSidebarItem key={item.to} item={item} scale={scale} />)}
      </nav>

      <span className="ps-label">Сборки</span>
      <InstanceQuickAccess vertical grid shape="square" />

      <div className="flex-1" />

      <div className="ps-footer">
        <div className="ps-account" title={isAuthenticated && user ? user.username : 'Войти в аккаунт'}>
          <AccountButton vertical />
          <div className="min-w-0 flex-1">
            <div className="ps-account-name">{isAuthenticated && user ? user.username : 'Войти в аккаунт'}</div>
            <div className="ps-account-provider">{isAuthenticated && user ? providerLabel : 'Нажмите, чтобы войти'}</div>
          </div>
        </div>
        <PortalSidebarItem item={{ to: '/settings', icon: SlidersHorizontal, labelKey: 'settings' }} scale={scale} />
      </div>
    </aside>
  );
}

/** Выезжающая минималистичная Notch-панель. Перетаскивание окна отключено. */
function NotchNav({ extendedOrder, extendedCompact }: { extendedOrder?: string[]; extendedCompact?: boolean }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { notchPinned, notchSide, notchHotzone, notchOpenOnTab, notchAboveHotzone, notchDockScale, navItemScale, navItemOrder, panelVersion, uiMode, titlebarHeight, notchPanelAppearance: appearance, set } = useUiStore();
  const visualPanelVersion = uiMode === 'old' ? 'old' : panelVersion;
  const items = orderedNav(extendedOrder && extendedOrder.length > 0 ? extendedOrder : navItemOrder);
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
                <button title="OpenPortal — ИИ-агент" onClick={() => navigate('/openportal')} className="flex items-center justify-center rounded-sm" style={{ width:28, height:28, color: 'var(--color-primary)', background:'transparent', border:'1px solid var(--color-border)' }} onMouseEnter={event => { event.currentTarget.style.background = 'var(--color-surface-hover)'; }} onMouseLeave={event => { event.currentTarget.style.background = 'transparent'; }}><Bot size={16} /></button>
                <button title="Назад" onClick={() => window.history.back()} className="ore-flat flex items-center justify-center rounded-sm" style={{ width:28, height:28, color:'var(--color-text-secondary)', background:'transparent', border:'1px solid var(--color-border)' }} onMouseEnter={event => { event.currentTarget.style.background = 'var(--color-surface-hover)'; }} onMouseLeave={event => { event.currentTarget.style.background = 'transparent'; }}><ChevronLeft size={18} /></button>
                <button title="Вперёд" onClick={() => window.history.forward()} className="ore-flat flex items-center justify-center rounded-sm" style={{ width:28, height:28, color:'var(--color-text-secondary)', background:'transparent', border:'1px solid var(--color-border)' }} onMouseEnter={event => { event.currentTarget.style.background = 'var(--color-surface-hover)'; }} onMouseLeave={event => { event.currentTarget.style.background = 'transparent'; }}><ChevronRight size={18} /></button>
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

export interface TopNavExtendedProps {
  extendedAccent?: string;
  extendedCompact?: boolean;
  extendedIcons?: Record<string, string>;
  extendedOrder?: string[];
}

export function TopNav({ extendedAccent, extendedCompact, extendedIcons, extendedOrder }: TopNavExtendedProps = {}) {
  const navMode = useUiStore(s => s.navMode);
  return navMode === 'sidebar' ? <SidebarNav /> : <NotchNav extendedOrder={extendedOrder} extendedCompact={extendedCompact} />;
}

export default TopNav;

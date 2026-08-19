import { useState, useRef, useEffect } from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import type { LucideIcon } from 'lucide-react';
import { Home, Compass, User, Package, Server, Settings, Bell, LogIn, X, Plus } from 'lucide-react';
import { useCurrentUser, useIsAuthenticated, useAuthStore } from '@/stores/authStore';
import { useNotifStore } from '@/stores/notificationStore';
import { useInstanceStore } from '@/stores/instanceStore';
import { getAvatarUrl, getAvatarFallbackUrl } from '@/lib/avatar';
import { toIconSrc } from '@/lib/icon-src';
import { CachedPlayerFace } from '@/components/CachedPlayerFace';

interface NavItem {
  to: string;
  icon: LucideIcon;
  label: string;
  accent: string;
  end?: boolean;
}

const TOP_NAV: NavItem[] = [
  { to: '/home',      icon: Home,    label: 'Home',     accent: '#DA2A3F', end: true },
  { to: '/discover',  icon: Compass, label: 'Discover', accent: '#F59E0B' },
  { to: '/skins',     icon: User,    label: 'Skins',    accent: '#8B5CF6' },
  { to: '/library',   icon: Package, label: 'Library',  accent: '#3B82F6' },
  { to: '/hosting',   icon: Server,  label: 'Hosting',  accent: '#35D07F' },
];

function NavBtn({ item }: { item: NavItem }) {
  const Icon = item.icon;
  return (
    <NavLink
      to={item.to}
      end={item.end}
      title={item.label}
      data-testid={`nav-${item.label.toLowerCase()}`}
      className="group relative flex items-center justify-center w-12 h-12 rounded-2xl select-none">
      {({ isActive }) => (
        <>
          <motion.div
            className="absolute inset-0 rounded-2xl"
            initial={false}
            animate={{ opacity: isActive ? 1 : 0, scale: isActive ? 1 : 0.85 }}
            transition={{ type: 'spring', stiffness: 500, damping: 32 }}
            style={{
              background: `linear-gradient(135deg, ${item.accent}, ${item.accent}AA)`,
              boxShadow: `0 6px 18px ${item.accent}55, inset 0 1px 0 rgba(255,255,255,0.15)`,
            }}
          />
          {!isActive && (
            <span className="absolute inset-0 rounded-2xl opacity-0 group-hover:opacity-100 transition-opacity"
              style={{ background: 'var(--color-surface-active)' }} />
          )}
          {isActive && (
            <motion.span
              layoutId="active-rail"
              className="absolute -left-3 top-1/2 -translate-y-1/2 w-1 rounded-r-full"
              style={{ height: 44, background: item.accent, boxShadow: `0 0 8px ${item.accent}` }}
            />
          )}
          <Icon
            size={20}
            strokeWidth={isActive ? 2.4 : 2}
            className="relative z-10 transition-colors"
            style={{ color: isActive ? '#fff' : item.accent }}
          />
          <div className="absolute left-full ml-3 px-2.5 py-1.5 rounded-xl text-xs font-semibold whitespace-nowrap
            opacity-0 pointer-events-none group-hover:opacity-100 transition-all z-50"
            style={{
              background: 'var(--color-surface-2)',
              color: 'var(--color-text)',
              border: '1px solid var(--color-border)',
              boxShadow: 'var(--shadow-md)',
            }}>
            {item.label}
          </div>
        </>
      )}
    </NavLink>
  );
}

function NotifDropdown({ onClose }: { onClose: () => void }) {
  const navigate = useNavigate();
  const { notifications, markRead, markAllRead, remove } = useNotifStore();
  const unread = notifications.filter(n => !n.read).length;
  return (
    <motion.div
      className="absolute left-full bottom-0 ml-2 z-50 w-72 rounded-2xl overflow-hidden"
      style={{ background:'var(--color-surface)', border:'1px solid var(--color-border)', boxShadow:'var(--shadow-lg)', maxHeight:'70vh' }}
      initial={{ opacity:0, scale:0.94, x:-6 }} animate={{ opacity:1, scale:1, x:0 }}
      exit={{ opacity:0, scale:0.94, x:-6 }}
      transition={{ type:'spring', stiffness:500, damping:38 }}>
      <div className="flex items-center justify-between px-4 py-3 border-b" style={{ borderColor:'var(--color-border)' }}>
        <div className="flex items-center gap-2">
          <span className="text-sm font-bold" style={{ color:'var(--color-text)' }}>Notifications</span>
          {unread > 0 && (
            <span className="w-5 h-5 rounded-full text-[9px] font-bold flex items-center justify-center"
              style={{ background:'var(--color-error)', color:'#fff' }}>{unread}</span>
          )}
        </div>
        <div className="flex gap-2">
          {unread > 0 && (
            <button onClick={markAllRead} className="text-[11px] font-semibold"
              style={{ color:'var(--color-primary)' }}>Mark all read</button>
          )}
          <button onClick={onClose} className="w-5 h-5 flex items-center justify-center rounded hover:opacity-70">
            <X className="w-3.5 h-3.5" style={{ color:'var(--color-text-secondary)' }} />
          </button>
        </div>
      </div>
      <div className="overflow-y-auto" style={{ maxHeight:'calc(70vh - 52px)' }}>
        {notifications.length === 0 ? (
          <div className="flex flex-col items-center py-10 gap-2">
            <Bell className="w-8 h-8" style={{ color:'var(--color-text-tertiary)' }} />
            <p className="text-sm" style={{ color:'var(--color-text-secondary)' }}>No notifications</p>
          </div>
        ) : (
          <div className="p-2 space-y-1">
            {notifications.map(n => (
              <div key={n.id}
                className="flex items-start gap-2.5 p-2.5 rounded-xl cursor-pointer group"
                style={{ background: n.read ? 'transparent' : 'var(--color-surface-2)' }}
                onClick={() => { markRead(n.id); if (n.action) navigate(n.action.route); onClose(); }}>
                <div className="w-2 h-2 rounded-full shrink-0 mt-1.5"
                  style={{ background: n.type === 'mod_update' ? '#F39C12' : 'var(--color-primary)' }} />
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-semibold" style={{ color:'var(--color-text)' }}>{n.title}</p>
                  <p className="text-[11px] mt-0.5" style={{ color:'var(--color-text-secondary)' }}>{n.body}</p>
                </div>
                {!n.read && <div className="w-1.5 h-1.5 rounded-full mt-1 shrink-0" style={{ background:'var(--color-primary)' }} />}
                <button onClick={e => { e.stopPropagation(); remove(n.id); }}
                  className="opacity-0 group-hover:opacity-100 w-4 h-4 flex items-center justify-center rounded hover:opacity-70">
                  <X className="w-2.5 h-2.5" style={{ color:'var(--color-text-tertiary)' }} />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </motion.div>
  );
}

function AccountDropdown({ onClose }: { onClose: () => void }) {
  const navigate = useNavigate();
  const user = useCurrentUser();
  const { logout } = useAuthStore();
  const [confirm, setConfirm] = useState(false);
  return (
    <motion.div
      className="absolute left-full bottom-0 ml-2 z-50 w-56 rounded-2xl overflow-hidden"
      style={{ background:'var(--color-surface)', border:'1px solid var(--color-border)', boxShadow:'var(--shadow-lg)' }}
      initial={{ opacity:0, scale:0.94, x:-6 }} animate={{ opacity:1, scale:1, x:0 }}
      exit={{ opacity:0, scale:0.94, x:-6 }}
      transition={{ type:'spring', stiffness:500, damping:38 }}>
      {!user ? (
        <div className="p-4 flex flex-col items-center gap-3">
          <div className="w-12 h-12 rounded-2xl flex items-center justify-center"
            style={{ background:'linear-gradient(135deg, var(--color-primary), #E74C3C)' }}>
            <LogIn className="w-6 h-6 text-white" />
          </div>
          <div className="text-center">
            <p className="font-bold text-sm" style={{ color:'var(--color-text)' }}>Not signed in</p>
            <p className="text-xs mt-0.5" style={{ color:'var(--color-text-secondary)' }}>Sign in to play Minecraft</p>
          </div>
          <button onClick={() => { navigate('/settings/account'); onClose(); }}
            className="w-full py-2 rounded-xl text-sm font-semibold"
            style={{ background:'var(--color-primary)', color:'white' }}>
            Sign in with Microsoft
          </button>
        </div>
      ) : (
        <>
          <div className="p-4 border-b" style={{ borderColor:'var(--color-border)' }}>
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl overflow-hidden shrink-0"
                style={{ background:'linear-gradient(135deg, var(--color-primary), #E74C3C)' }}>
                <CachedPlayerFace user={user} className="w-full h-full" alt="" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="font-bold text-sm truncate" style={{ color:'var(--color-text)' }}>{user.username}</p>
                <p className="text-xs" style={{ color:'var(--color-text-secondary)' }}>
                  {user.provider === 'elyby' ? 'Ely.by Account'
                    : user.provider === 'offline' || user.isDemo ? 'Offline Account'
                    : 'Microsoft Account'}
                </p>
              </div>
              <button onClick={onClose}><X className="w-3.5 h-3.5" style={{ color:'var(--color-text-tertiary)' }} /></button>
            </div>
          </div>
          <div className="p-2">
            <button onClick={() => { navigate('/settings/account'); onClose(); }}
              className="w-full flex items-center gap-2 px-3 py-2 rounded-xl text-sm hover:bg-white/5 text-left"
              style={{ color:'var(--color-text-secondary)' }}>
              <LogIn className="w-3.5 h-3.5" />Account Settings
            </button>
            {!confirm ? (
              <button onClick={() => setConfirm(true)}
                className="w-full flex items-center gap-2 px-3 py-2 rounded-xl text-sm hover:bg-red-500/10 text-left"
                style={{ color:'var(--color-error)' }}>
                <X className="w-3.5 h-3.5" />Sign Out
              </button>
            ) : (
              <div className="px-3 py-2">
                <p className="text-xs mb-2 font-semibold" style={{ color:'var(--color-error)' }}>Confirm sign out?</p>
                <div className="flex gap-2">
                  <button onClick={() => { logout(); onClose(); }}
                    className="flex-1 py-1.5 rounded-lg text-xs font-bold"
                    style={{ background:'var(--color-error)', color:'#fff' }}>Sign Out</button>
                  <button onClick={() => setConfirm(false)}
                    className="flex-1 py-1.5 rounded-lg text-xs"
                    style={{ background:'var(--color-surface-2)', color:'var(--color-text-secondary)' }}>Cancel</button>
                </div>
              </div>
            )}
          </div>
        </>
      )}
    </motion.div>
  );
}

function InstancesRail() {
  const navigate = useNavigate();
  const instances = useInstanceStore(s => s.instances);
  if (instances.length === 0) {
    return (
      <button
        onClick={() => navigate('/library?create=1')}
        title="Create instance"
        className="flex items-center justify-center w-12 h-12 rounded-2xl hover:bg-white/5 transition-colors"
        style={{ border: '1px dashed var(--color-border)', color: 'var(--color-text-tertiary)' }}>
        <Plus size={18} />
      </button>
    );
  }
  return (
    <div className="flex flex-col items-center gap-1.5 w-full overflow-y-auto" style={{ maxHeight: 240 }}>
      {instances.map(inst => (
        <NavLink
          key={inst.id}
          to={`/instances/${inst.id}/manage`}
          title={inst.name}
          className="group relative flex items-center justify-center w-12 h-12 rounded-2xl shrink-0 overflow-hidden">
          {({ isActive }) => (
            <>
              <div className="w-9 h-9 rounded-xl overflow-hidden flex items-center justify-center text-xs font-bold shrink-0"
                style={{
                  background: inst.color || 'var(--color-surface-2)',
                  color: '#fff',
                  outline: isActive ? '2px solid var(--color-primary)' : 'none',
                  outlineOffset: 2,
                }}>
                {inst.iconPath
                  ? <img src={toIconSrc(inst.iconPath)} className="w-full h-full object-cover" alt="" />
                  : inst.name[0]?.toUpperCase()}
              </div>
              <div className="absolute left-full ml-3 px-2.5 py-1.5 rounded-xl text-xs font-semibold whitespace-nowrap
                opacity-0 pointer-events-none group-hover:opacity-100 transition-all z-50"
                style={{
                  background: 'var(--color-surface-2)',
                  color: 'var(--color-text)',
                  border: '1px solid var(--color-border)',
                  boxShadow: 'var(--shadow-md)',
                }}>
                {inst.name}
              </div>
            </>
          )}
        </NavLink>
      ))}
      <button
        onClick={() => navigate('/library?create=1')}
        title="Create instance"
        className="flex items-center justify-center w-9 h-9 rounded-xl hover:bg-white/5 transition-colors shrink-0"
        style={{ border: '1px dashed var(--color-border)', color: 'var(--color-text-tertiary)' }}>
        <Plus size={16} />
      </button>
    </div>
  );
}

export function LeftSidebar() {
  const navigate = useNavigate();
  const user = useCurrentUser();
  const isAuthenticated = useIsAuthenticated();
  const unreadCount = useNotifStore(s => s.unreadCount());
  const [showAccount, setShowAccount] = useState(false);
  const [showNotifs, setShowNotifs] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const h = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setShowNotifs(false);
        setShowAccount(false);
      }
    };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, []);

  return (
    <aside ref={ref}
      className="flex flex-col items-center py-4 gap-2 shrink-0 h-full relative"
      style={{
        width: 80,
        background: 'var(--color-surface)',
        borderRight: '1px solid var(--color-border)',
      }}>

      {/* Logo — click to go to About */}
      <motion.button
        onClick={() => navigate('/settings/about')}
        whileHover={{ scale: 1.06, rotate: 4 }}
        whileTap={{ scale: 0.92, rotate: -4 }}
        transition={{ type: 'spring', stiffness: 400, damping: 18 }}
        className="w-12 h-12 rounded-2xl mb-2 shrink-0 overflow-hidden"
        style={{ boxShadow: '0 8px 24px rgba(231,76,60,0.4)' }}
        title="About Portal Launcher">
        <img src="/launcher-icon.png" alt="Portal Launcher" className="w-full h-full object-cover" draggable={false} />
      </motion.button>

      <div className="w-7 h-px my-1" style={{ background: 'var(--color-border)' }} />

      <nav className="flex flex-col items-center gap-1.5 flex-1">
        {TOP_NAV.map(item => (
          <NavBtn key={item.to} item={item} />
        ))}
      </nav>

      <div className="w-7 h-px my-1" style={{ background: 'var(--color-border)' }} />
      <InstancesRail />
      <div className="w-7 h-px my-1" style={{ background: 'var(--color-border)' }} />

      {/* Bell */}
      <div className="relative">
        <button
          onClick={() => { setShowNotifs(v => !v); setShowAccount(false); }}
          className="group relative flex items-center justify-center w-12 h-12 rounded-2xl hover:bg-white/5 transition-colors"
          title="Notifications">
          <Bell size={20} strokeWidth={2} style={{ color: showNotifs ? 'var(--color-primary)' : '#94A3B8' }} />
          {unreadCount > 0 && (
            <span className="absolute top-1 right-1 w-3.5 h-3.5 rounded-full text-[8px] font-bold flex items-center justify-center pointer-events-none"
              style={{ background:'var(--color-error)', color:'#fff' }}>
              {unreadCount > 9 ? '9+' : unreadCount}
            </span>
          )}
        </button>
        <AnimatePresence>
          {showNotifs && <NotifDropdown onClose={() => setShowNotifs(false)} />}
        </AnimatePresence>
      </div>

      {/* Account avatar */}
      <div className="relative mb-1">
        <button
          onClick={() => { setShowAccount(v => !v); setShowNotifs(false); }}
          title={isAuthenticated && user ? user.username : 'Sign in'}
          className="relative w-12 h-12 rounded-2xl flex items-center justify-center hover:bg-white/5 transition-colors overflow-hidden"
          style={{ background: 'linear-gradient(135deg, var(--color-primary)22, var(--color-surface-2))' }}>
          {isAuthenticated && user
            ? <CachedPlayerFace user={user} className="w-full h-full" alt="" />
            : isAuthenticated && user
            ? <span className="text-sm font-bold" style={{ color:'var(--color-primary)' }}>{user.username[0]}</span>
            : <LogIn size={18} style={{ color:'#94A3B8' }} />}
          {isAuthenticated && (
            <div className="absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full border-2"
              style={{ background:'#2ECC71', borderColor:'var(--color-surface)' }} />
          )}
        </button>
        <AnimatePresence>
          {showAccount && <AccountDropdown onClose={() => setShowAccount(false)} />}
        </AnimatePresence>
      </div>

      {/* Settings */}
      <NavLink
        to="/settings"
        title="Settings"
        data-testid="nav-settings"
        className="group relative flex items-center justify-center w-12 h-12 rounded-2xl">
        {({ isActive }) => (
          <>
            <motion.div
              className="absolute inset-0 rounded-2xl"
              initial={false}
              animate={{ opacity: isActive ? 1 : 0, scale: isActive ? 1 : 0.85 }}
              transition={{ type: 'spring', stiffness: 500, damping: 32 }}
              style={{
                background: 'linear-gradient(135deg, #64748B, #475569)',
                boxShadow: '0 6px 18px rgba(100,116,139,0.45), inset 0 1px 0 rgba(255,255,255,0.15)',
              }}
            />
            {!isActive && (
              <span className="absolute inset-0 rounded-2xl opacity-0 group-hover:opacity-100 transition-opacity"
                style={{ background: 'var(--color-surface-active)' }} />
            )}
            <motion.div
              whileHover={{ rotate: 90 }}
              transition={{ type: 'spring', stiffness: 300, damping: 18 }}
              className="relative z-10">
              <Settings
                size={20}
                strokeWidth={isActive ? 2.4 : 2}
                style={{ color: isActive ? '#fff' : '#94A3B8' }}
              />
            </motion.div>
            <div className="absolute left-full ml-3 px-2.5 py-1.5 rounded-xl text-xs font-semibold whitespace-nowrap
              opacity-0 pointer-events-none group-hover:opacity-100 transition-all z-50"
              style={{
                background: 'var(--color-surface-2)',
                color: 'var(--color-text)',
                border: '1px solid var(--color-border)',
                boxShadow: 'var(--shadow-md)',
              }}>
              Settings
            </div>
          </>
        )}
      </NavLink>
    </aside>
  );
}

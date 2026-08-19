import { useState, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { getAvatarUrl, getAvatarFallbackUrl } from '@/lib/avatar';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Bell, X, Check, LogIn, UserPlus, Users, MessageSquare, Gamepad2,
  ChevronDown, Search, Package, Info,
} from 'lucide-react';
import { useCurrentUser, useIsAuthenticated, useAuthStore } from '@/stores/authStore';
import { useNotifStore, NotifType } from '@/stores/notificationStore';
import { useFriendsStore, Friend } from '@/stores/friendsStore';
import { CachedPlayerFace } from '@/components/CachedPlayerFace';

const STATUS_DOT: Record<string, string> = {
  online: '#2ECC71',
  offline: '#484F58',
  playing: '#3498DB',
};

function fmtLastSeen(s?: string) {
  if (!s) return 'Long ago';
  const d = Math.floor((Date.now() - new Date(s).getTime()) / 1000);
  if (d < 60) return 'just now';
  if (d < 3600) return `${Math.floor(d/60)}m ago`;
  if (d < 86400) return `${Math.floor(d/3600)}h ago`;
  return `${Math.floor(d/86400)}d ago`;
}

function NotifDot({ type }: { type: NotifType }) {
  const col: Record<NotifType, string> = {
    friend_request: 'var(--color-primary)',
    message: '#3498DB',
    mod_update: '#F39C12',
    friend_online: '#2ECC71',
    system: 'var(--color-text-secondary)',
  };
  return <div className="w-2 h-2 rounded-full shrink-0" style={{ background: col[type] }} />;
}

function FriendRow({ f }: { f: Friend }) {
  const navigate = useNavigate();
  const [hover, setHover] = useState(false);
  return (
    <div
      className="flex items-center gap-2.5 px-3 py-2 rounded-xl cursor-pointer transition-all"
      style={{ background: hover ? 'var(--color-surface-2)' : 'transparent' }}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      onClick={() => navigate('/friends')}>
      <div className="relative w-7 h-7 rounded-lg overflow-hidden shrink-0"
        style={{ background: f.avatarColor || '#444' }}>
        <span className="absolute inset-0 flex items-center justify-center text-white text-[10px] font-bold">
          {f.username[0]?.toUpperCase()}
        </span>
        <img
          src={`https://mc-heads.net/head/${f.uuid}/28`}
          alt=""
          className="absolute inset-0 w-full h-full"
          style={{ imageRendering: 'pixelated' }}
          onError={e => { (e.target as HTMLImageElement).style.display = 'none'; }}
        />
        <div className="absolute bottom-0 right-0 w-2.5 h-2.5 rounded-full border-2"
          style={{ background: STATUS_DOT[f.status] || '#484F58', borderColor: 'var(--color-surface)' }} />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-xs font-semibold truncate" style={{ color: 'var(--color-text)' }}>{f.username}</p>
        <p className="text-[10px] truncate" style={{ color: 'var(--color-text-secondary)' }}>
          {f.status === 'playing' && f.currentInstance
            ? <span className="flex items-center gap-0.5"><Gamepad2 className="w-2.5 h-2.5 inline mr-0.5" />{f.currentInstance}</span>
            : f.status === 'online' ? 'Online'
            : fmtLastSeen(f.lastSeen)}
        </p>
      </div>
      {f.unread > 0 && !hover && (
        <span className="w-4 h-4 rounded-full text-[9px] font-bold flex items-center justify-center"
          style={{ background: 'var(--color-primary)', color: 'white' }}>
          {f.unread > 9 ? '9+' : f.unread}
        </span>
      )}
      {hover && (
        <button
          className="w-6 h-6 rounded-lg flex items-center justify-center"
          style={{ background: 'var(--color-primary)', color: 'white' }}
          onClick={e => { e.stopPropagation(); navigate('/friends'); }}>
          <MessageSquare className="w-3 h-3" />
        </button>
      )}
    </div>
  );
}

function NotifPanel({ onClose }: { onClose: () => void }) {
  const navigate = useNavigate();
  const { notifications, markRead, markAllRead, remove } = useNotifStore();
  const unread = notifications.filter(n => !n.read).length;

  return (
    <motion.div
      className="absolute top-[60px] right-2 z-50 w-80 rounded-2xl overflow-hidden"
      style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', boxShadow: 'var(--shadow-lg)', maxHeight: '70vh' }}
      initial={{ opacity: 0, scale: 0.94, y: -6 }}
      animate={{ opacity: 1, scale: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.94, y: -6 }}
      transition={{ type: 'spring', stiffness: 500, damping: 38 }}>
      <div className="flex items-center justify-between px-4 py-3 border-b" style={{ borderColor: 'var(--color-border)' }}>
        <div className="flex items-center gap-2">
          <span className="text-sm font-bold" style={{ color: 'var(--color-text)' }}>Notifications</span>
          {unread > 0 && (
            <span className="w-5 h-5 rounded-full text-[9px] font-bold flex items-center justify-center"
              style={{ background: 'var(--color-error)', color: '#fff' }}>{unread}</span>
          )}
        </div>
        <div className="flex gap-2">
          {unread > 0 && (
            <button onClick={markAllRead} className="text-[11px] font-semibold"
              style={{ color: 'var(--color-primary)' }}>Mark all read</button>
          )}
          <button onClick={onClose} className="w-5 h-5 flex items-center justify-center rounded hover:opacity-70">
            <X className="w-3.5 h-3.5" style={{ color: 'var(--color-text-secondary)' }} />
          </button>
        </div>
      </div>
      <div className="overflow-y-auto" style={{ maxHeight: 'calc(70vh - 52px)' }}>
        {notifications.length === 0 ? (
          <div className="flex flex-col items-center py-10 gap-2">
            <Bell className="w-8 h-8" style={{ color: 'var(--color-text-tertiary)' }} />
            <p className="text-sm" style={{ color: 'var(--color-text-secondary)' }}>No notifications</p>
          </div>
        ) : (
          <div className="p-2 space-y-1">
            {notifications.map(n => (
              <div key={n.id}
                className="flex items-start gap-2.5 p-2.5 rounded-xl cursor-pointer group"
                style={{ background: n.read ? 'transparent' : 'var(--color-surface-2)' }}
                onClick={() => { markRead(n.id); if (n.action) navigate(n.action.route); onClose(); }}>
                <NotifDot type={n.type} />
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-semibold" style={{ color: 'var(--color-text)' }}>{n.title}</p>
                  <p className="text-[11px] mt-0.5" style={{ color: 'var(--color-text-secondary)' }}>{n.body}</p>
                </div>
                {!n.read && <div className="w-1.5 h-1.5 rounded-full mt-1 shrink-0" style={{ background: 'var(--color-primary)' }} />}
                <button onClick={e => { e.stopPropagation(); remove(n.id); }}
                  className="opacity-0 group-hover:opacity-100 w-4 h-4 flex items-center justify-center rounded hover:opacity-70">
                  <X className="w-2.5 h-2.5" style={{ color: 'var(--color-text-tertiary)' }} />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </motion.div>
  );
}

function AccountPanel({ onClose }: { onClose: () => void }) {
  const navigate = useNavigate();
  const user = useCurrentUser();
  const { logout } = useAuthStore();
  const [confirm, setConfirm] = useState(false);

  return (
    <motion.div
      className="absolute top-[60px] right-2 z-50 w-60 rounded-2xl overflow-hidden"
      style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', boxShadow: 'var(--shadow-lg)' }}
      initial={{ opacity: 0, scale: 0.94, y: -6 }}
      animate={{ opacity: 1, scale: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.94, y: -6 }}
      transition={{ type: 'spring', stiffness: 500, damping: 38 }}>
      {!user ? (
        <div className="p-4 flex flex-col items-center gap-3">
          <div className="w-12 h-12 rounded-2xl flex items-center justify-center"
            style={{ background: 'linear-gradient(135deg, var(--color-primary), #E74C3C)' }}>
            <LogIn className="w-6 h-6 text-white" />
          </div>
          <div className="text-center">
            <p className="font-bold text-sm" style={{ color: 'var(--color-text)' }}>Not signed in</p>
            <p className="text-xs mt-0.5" style={{ color: 'var(--color-text-secondary)' }}>Sign in to play Minecraft</p>
          </div>
          <button onClick={() => { navigate('/settings/account'); onClose(); }}
            className="w-full py-2 rounded-xl text-sm font-semibold"
            style={{ background: 'var(--color-primary)', color: 'white' }}>
            Sign in with Microsoft
          </button>
        </div>
      ) : (
        <>
          <div className="p-4 border-b" style={{ borderColor: 'var(--color-border)' }}>
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl overflow-hidden shrink-0"
                style={{ background: 'linear-gradient(135deg, var(--color-primary), #E74C3C)' }}>
                <CachedPlayerFace user={user} className="w-full h-full" alt="" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="font-bold text-sm truncate" style={{ color: 'var(--color-text)' }}>{user.username}</p>
                <p className="text-xs" style={{ color: 'var(--color-text-secondary)' }}>Microsoft Account</p>
              </div>
              <button onClick={onClose}><X className="w-3.5 h-3.5" style={{ color: 'var(--color-text-tertiary)' }} /></button>
            </div>
          </div>
          <div className="p-2">
            <button onClick={() => { navigate('/settings/account'); onClose(); }}
              className="w-full flex items-center gap-2 px-3 py-2 rounded-xl text-sm hover:bg-white/5 text-left"
              style={{ color: 'var(--color-text-secondary)' }}>
              <LogIn className="w-3.5 h-3.5" />Account Settings
            </button>
            {!confirm ? (
              <button onClick={() => setConfirm(true)}
                className="w-full flex items-center gap-2 px-3 py-2 rounded-xl text-sm hover:bg-red-500/10 text-left"
                style={{ color: 'var(--color-error)' }}>
                <X className="w-3.5 h-3.5" />Sign Out
              </button>
            ) : (
              <div className="px-3 py-2">
                <p className="text-xs mb-2 font-semibold" style={{ color: 'var(--color-error)' }}>Confirm sign out?</p>
                <div className="flex gap-2">
                  <button onClick={() => { logout(); onClose(); }}
                    className="flex-1 py-1.5 rounded-lg text-xs font-bold"
                    style={{ background: 'var(--color-error)', color: '#fff' }}>Sign Out</button>
                  <button onClick={() => setConfirm(false)}
                    className="flex-1 py-1.5 rounded-lg text-xs"
                    style={{ background: 'var(--color-surface-2)', color: 'var(--color-text-secondary)' }}>Cancel</button>
                </div>
              </div>
            )}
          </div>
        </>
      )}
    </motion.div>
  );
}

export function RightSidebar() {
  const user = useCurrentUser();
  const isAuthenticated = useIsAuthenticated();
  const unreadCount = useNotifStore(s => s.unreadCount());
  const friends = useFriendsStore(s => s.friends);
  const [showNotifs, setShowNotifs] = useState(false);
  const [showAccount, setShowAccount] = useState(false);
  const [friendSearch, setFriendSearch] = useState('');
  const navigate = useNavigate();
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

  const playing = friends.filter(f => f.status === 'playing');
  const online  = friends.filter(f => f.status === 'online');
  const offline = friends.filter(f => f.status === 'offline');

  const filtered = (arr: Friend[]) =>
    arr.filter(f => !friendSearch || f.username.toLowerCase().includes(friendSearch.toLowerCase()));

  return (
    <aside ref={ref} className="flex flex-col h-full shrink-0 relative"
      style={{ width: 232, background: 'var(--color-surface)', borderLeft: '1px solid var(--color-border)' }}>

      {/* Account + Bell */}
      <div className="flex items-center gap-2 px-3 h-[60px] shrink-0 relative"
        style={{ borderBottom: '1px solid var(--color-border)' }}>
        <button
          className="flex items-center gap-2 flex-1 min-w-0 px-2 py-1.5 rounded-xl hover:bg-white/5 transition-colors"
          onClick={() => { setShowAccount(v => !v); setShowNotifs(false); }}>
          <div className="relative w-8 h-8 rounded-xl overflow-hidden shrink-0"
            style={{ background: 'linear-gradient(135deg, var(--color-primary), #E74C3C)' }}>
            {isAuthenticated && user
              ? <CachedPlayerFace user={user} className="w-full h-full" alt="" />
              : isAuthenticated && user
              ? <span className="w-full h-full flex items-center justify-center text-white text-xs font-bold">{user.username[0]}</span>
              : <LogIn className="w-4 h-4 text-white m-auto" />}
            {isAuthenticated && (
              <div className="absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full border-2"
                style={{ background: '#2ECC71', borderColor: 'var(--color-surface)' }} />
            )}
          </div>
          <div className="flex-1 min-w-0 text-left">
            <p className="text-[9px] uppercase font-bold tracking-wider" style={{ color: 'var(--color-text-tertiary)' }}>Playing as</p>
            <p className="text-xs font-bold truncate" style={{ color: 'var(--color-text)' }}>
              {isAuthenticated && user ? user.username : 'Not signed in'}
            </p>
          </div>
          <ChevronDown className="w-3 h-3 shrink-0" style={{
            color: 'var(--color-text-tertiary)',
            transform: showAccount ? 'rotate(180deg)' : 'none',
            transition: 'transform 200ms',
          }} />
        </button>

        <button
          className="relative w-8 h-8 rounded-xl flex items-center justify-center hover:bg-white/5 transition-colors shrink-0"
          style={{ color: showNotifs ? 'var(--color-primary)' : 'var(--color-text-secondary)' }}
          onClick={() => { setShowNotifs(v => !v); setShowAccount(false); }}>
          <Bell className="w-4 h-4" />
          {unreadCount > 0 && (
            <span className="absolute top-0.5 right-0.5 w-3.5 h-3.5 rounded-full text-[8px] font-bold flex items-center justify-center"
              style={{ background: 'var(--color-error)', color: '#fff' }}>
              {unreadCount > 9 ? '9+' : unreadCount}
            </span>
          )}
        </button>

        <AnimatePresence>
          {showNotifs && <NotifPanel onClose={() => setShowNotifs(false)} />}
          {showAccount && <AccountPanel onClose={() => setShowAccount(false)} />}
        </AnimatePresence>
      </div>

      {/* Friends header */}
      <div className="px-3 pt-3 pb-2 shrink-0">
        <div className="flex items-center justify-between mb-2">
          <p className="text-[10px] font-bold uppercase tracking-widest" style={{ color: 'var(--color-text-tertiary)' }}>Friends</p>
          <p className="text-[10px]" style={{ color: 'var(--color-text-tertiary)' }}>
            {friends.filter(f => f.status !== 'offline').length} online
          </p>
        </div>
        <div className="flex items-center gap-2 px-2.5 py-1.5 rounded-xl"
          style={{ background: 'var(--color-surface-2)', border: '1px solid var(--color-border)' }}>
          <Search className="w-3.5 h-3.5 shrink-0" style={{ color: 'var(--color-text-tertiary)' }} />
          <input
            className="flex-1 bg-transparent text-xs"
            placeholder="Search friends..."
            value={friendSearch}
            onChange={e => setFriendSearch(e.target.value)}
            style={{ color: 'var(--color-text)', caretColor: 'var(--color-primary)' }}
          />
        </div>
      </div>

      {/* Friends list */}
      <div className="flex-1 overflow-y-auto px-1 pb-2">
        {filtered(playing).length > 0 && (
          <div className="mb-1">
            <p className="px-3 py-1 text-[10px] font-bold uppercase tracking-widest"
              style={{ color: '#3498DB' }}>Playing — {filtered(playing).length}</p>
            {filtered(playing).map(f => <FriendRow key={f.id} f={f} />)}
          </div>
        )}
        {filtered(online).length > 0 && (
          <div className="mb-1">
            <p className="px-3 py-1 text-[10px] font-bold uppercase tracking-widest"
              style={{ color: '#2ECC71' }}>Online — {filtered(online).length}</p>
            {filtered(online).map(f => <FriendRow key={f.id} f={f} />)}
          </div>
        )}
        {filtered(offline).length > 0 && (
          <div>
            <p className="px-3 py-1 text-[10px] font-bold uppercase tracking-widest"
              style={{ color: 'var(--color-text-tertiary)' }}>Offline — {filtered(offline).length}</p>
            {filtered(offline).map(f => <FriendRow key={f.id} f={f} />)}
          </div>
        )}
        {friends.length === 0 && (
          <div className="flex flex-col items-center py-10 gap-2">
            <Users className="w-8 h-8" style={{ color: 'var(--color-text-tertiary)' }} />
            <p className="text-xs" style={{ color: 'var(--color-text-secondary)' }}>No friends yet</p>
          </div>
        )}
      </div>

      {/* Add friend */}
      <div className="p-3 shrink-0" style={{ borderTop: '1px solid var(--color-border)' }}>
        <button onClick={() => navigate('/friends')}
          className="w-full flex items-center justify-center gap-2 py-2 rounded-xl text-xs font-semibold transition-all hover:opacity-90"
          style={{ background: 'var(--color-primary-dim)', color: 'var(--color-primary)', border: '1px solid rgba(108,92,231,0.3)' }}>
          <UserPlus className="w-3.5 h-3.5" />Add Friend
        </button>
      </div>
    </aside>
  );
}

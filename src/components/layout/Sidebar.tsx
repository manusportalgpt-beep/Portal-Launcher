import { NavLink } from 'react-router-dom';
import { Compass, Library, Users, Settings, Layers } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useAuthStore } from '@/stores/authStore';
import { useThemeStore } from '@/stores/themeStore';
import { themes } from '@/lib/theme-engine';

const items = [
  { to:'/discover', icon:Compass, key:'nav.discover' },
  { to:'/library', icon:Library, key:'nav.library' },
  { to:'/instances', icon:Layers, key:'instances.title' },
  { to:'/friends', icon:Users, key:'nav.friends' },
  { to:'/settings', icon:Settings, key:'nav.settings' },
];

export function Sidebar() {
  const { t } = useTranslation();
  const { user, isAuthenticated } = useAuthStore();
  const { themeId } = useThemeStore();
  const theme = themes[themeId as keyof typeof themes] ?? themes.light;

  return (
    <aside className="flex flex-col h-full select-none"
      style={{width:220,background:'var(--color-surface)',borderRight:'1px solid var(--color-border)',flexShrink:0}}>

      {/* Logo */}
      <div className="flex items-center gap-3 px-5 h-[60px]"
        style={{borderBottom:'1px solid var(--color-border)',flexShrink:0}}>
        <div className="w-8 h-8 rounded-xl flex items-center justify-center shrink-0"
          style={{background:'linear-gradient(135deg,var(--color-primary),#E74C3C)'}}>
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
            <circle cx="7" cy="7" r="5.5" stroke="white" strokeWidth="1.5" />
            <circle cx="7" cy="7" r="2" fill="white" />
            <line x1="7" y1="1" x2="7" y2="3" stroke="white" strokeWidth="1.5" strokeLinecap="round" />
            <line x1="7" y1="11" x2="7" y2="13" stroke="white" strokeWidth="1.5" strokeLinecap="round" />
            <line x1="1" y1="7" x2="3" y2="7" stroke="white" strokeWidth="1.5" strokeLinecap="round" />
            <line x1="11" y1="7" x2="13" y2="7" stroke="white" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
        </div>
        <div>
          <div className="text-sm font-bold leading-none" style={{color:'var(--color-text)'}}>
            <span style={{color:'var(--color-primary)'}}>Portal</span>{' '}
            <span>Launcher</span>
          </div>
          <div className="text-[9px] mt-0.5 font-medium uppercase tracking-[0.15em]"
            style={{color:'var(--color-text-tertiary)'}}>
            by Portalrolls
          </div>
        </div>
      </div>

      {/* Nav */}
      <nav className="flex-1 p-3 space-y-0.5 overflow-y-auto scroll-area">
        {items.map(({to,icon:Icon,key}) => (
          <NavLink key={to} to={to}
            className={({isActive}) =>
              `flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all duration-150 ${isActive?'':'hover:bg-white/5'}`
            }
            style={({isActive}) => isActive
              ? {background:'var(--color-primary-dim)',color:'var(--color-primary)'}
              : {color:'var(--color-text-secondary)'}
            }>
            {({isActive}) => (
              <>
                <Icon className="w-4 h-4 shrink-0" />
                <span className="flex-1">{t(key)}</span>
                {isActive && <span className="w-1.5 h-1.5 rounded-full" style={{background:'var(--color-primary)'}} />}
              </>
            )}
          </NavLink>
        ))}
      </nav>

      {/* User profile card */}
      <div className="p-3 flex-shrink-0" style={{borderTop:'1px solid var(--color-border)'}}>
        <NavLink to="/settings/account"
          className="flex items-center gap-3 p-2.5 rounded-xl transition-all hover:bg-white/5">
          <div className="w-8 h-8 rounded-xl flex items-center justify-center shrink-0 text-sm font-bold"
            style={{background: isAuthenticated && user
              ? 'linear-gradient(135deg,var(--color-primary),#E74C3C)'
              : 'var(--color-surface-2)',
              color: isAuthenticated && user ? 'white' : 'var(--color-text-tertiary)',
              border: isAuthenticated && user ? 'none' : '1px solid var(--color-border)'}}>
            {isAuthenticated && user ? user.username[0].toUpperCase() : '?'}
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-xs font-semibold truncate" style={{color:'var(--color-text)'}}>
              {isAuthenticated && user ? user.username : 'Not signed in'}
            </p>
            <div className="flex items-center gap-1 mt-0.5">
              <span className="w-1.5 h-1.5 rounded-full"
                style={{background:isAuthenticated?'#2ECC71':'var(--color-text-tertiary)'}} />
              <p className="text-[10px]" style={{color:'var(--color-text-secondary)'}}>
                {isAuthenticated ? 'Online' : 'Sign in'}
              </p>
            </div>
          </div>
        </NavLink>
      </div>
    </aside>
  );
}

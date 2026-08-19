import { useState } from 'react';
import { Search, Bell, LogIn, ChevronDown, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { useAuthStore } from '@/stores/authStore';
import { motion, AnimatePresence } from 'framer-motion';

export function TopBar() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { user, isAuthenticated } = useAuthStore();
  const [query, setQuery] = useState('');

  const handleSearch = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && query.trim()) {
      navigate('/discover');
    }
  };

  return (
    <header className="flex items-center gap-4 px-5 flex-shrink-0"
      style={{height:60,background:'var(--color-surface)',borderBottom:'1px solid var(--color-border)'}}>

      {/* Search bar */}
      <div className="flex-1 max-w-sm flex items-center gap-2.5 px-3 py-2 rounded-xl transition-all"
        style={{background:'var(--color-surface-2)',border:'1px solid var(--color-border)'}}>
        <Search className="w-4 h-4 shrink-0" style={{color:'var(--color-text-tertiary)'}} />
        <input
          className="flex-1 bg-transparent text-sm min-w-0"
          style={{color:'var(--color-text)',caretColor:'var(--color-primary)'}}
          placeholder="Search mods, instances..."
          value={query}
          onChange={e => setQuery(e.target.value)}
          onKeyDown={handleSearch}
        />
        {query && (
          <button onClick={() => setQuery('')}>
            <X className="w-3.5 h-3.5" style={{color:'var(--color-text-tertiary)'}} />
          </button>
        )}
      </div>

      <div className="flex-1" />

      {/* Notifications */}
      <button className="relative w-8 h-8 flex items-center justify-center rounded-xl transition-all hover:bg-white/5"
        style={{color:'var(--color-text-secondary)'}}>
        <Bell className="w-4 h-4" />
        <span className="absolute top-1 right-1 w-2 h-2 rounded-full border"
          style={{background:'var(--color-primary)',borderColor:'var(--color-surface)'}} />
      </button>

      {/* Auth button */}
      {isAuthenticated && user ? (
        <button onClick={() => navigate('/settings/account')}
          className="flex items-center gap-2 px-3 py-1.5 rounded-xl text-sm font-medium transition-all hover:bg-white/5"
          style={{border:'1px solid var(--color-border)'}}>
          <div className="w-6 h-6 rounded-lg flex items-center justify-center text-xs font-bold"
            style={{background:'linear-gradient(135deg,var(--color-primary),#E74C3C)',color:'white'}}>
            {user.username[0]}
          </div>
          <span style={{color:'var(--color-text)'}}>{user.username}</span>
          <ChevronDown className="w-3.5 h-3.5" style={{color:'var(--color-text-tertiary)'}} />
        </button>
      ) : (
        <button onClick={() => navigate('/settings/account')}
          className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold transition-all"
          style={{background:'var(--color-primary)',color:'var(--color-primary-text)'}}>
          <LogIn className="w-4 h-4" />
          {t('auth.signIn')}
        </button>
      )}
    </header>
  );
}

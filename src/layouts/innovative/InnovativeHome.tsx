import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { Play, Plus, ChevronRight, Gamepad2, Palette, Sparkles, Box } from 'lucide-react';
import { useInstanceStore } from '@/stores/instanceStore';
import { useCurrentUser, useIsAuthenticated } from '@/stores/authStore';
import { toIconSrc } from '@/lib/icon-src';

const stagger = { hidden: {}, show: { transition: { staggerChildren: 0.06 } } };
const fadeUp = { hidden: { opacity: 0, y: 14 }, show: { opacity: 1, y: 0, transition: { duration: 0.35, ease: [0.22, 1, 0.36, 1] } } };

export function InnovativeHome() {
  const navigate = useNavigate();
  const instances = useInstanceStore(s => s.instances);
  const user = useCurrentUser();
  const isAuth = useIsAuthenticated();
  const [time, setTime] = useState(new Date());

  useEffect(() => { const t = setInterval(() => setTime(new Date()), 30000); return () => clearInterval(t); }, []);

  const hour = time.getHours();
  const greeting = hour < 6 ? 'Доброй ночи' : hour < 12 ? 'Доброе утро' : hour < 18 ? 'Добрый день' : 'Добрый вечер';

  const recent = instances
    .filter(i => i.lastPlayed)
    .sort((a, b) => (b.lastPlayed ?? '').localeCompare(a.lastPlayed ?? ''))
    .slice(0, 4);

  return (
    <motion.div className="h-full overflow-auto" variants={stagger} initial="hidden" animate="show">
      {/* hero */}
      <motion.div variants={fadeUp} className="relative mx-6 mt-6 overflow-hidden rounded-3xl p-8"
        style={{
          background: 'linear-gradient(135deg, color-mix(in srgb, var(--color-primary) 18%, var(--color-surface)) 0%, var(--color-surface) 50%, color-mix(in srgb, var(--color-primary) 8%, var(--color-surface)) 100%)',
          border: '1px solid color-mix(in srgb, var(--color-border) 50%, var(--color-primary))',
        }}>
        <div className="relative z-10">
          <p className="text-[13px] font-medium" style={{ color: 'var(--color-text-secondary)' }}>
            {greeting}{isAuth && user ? `, ${user.username}` : ''}
          </p>
          <h1 className="mt-2 text-3xl font-extrabold tracking-tight" style={{ color: 'var(--color-text)' }}>
            Portal Launcher
          </h1>
          <p className="mt-1.5 text-sm" style={{ color: 'var(--color-text-secondary)' }}>
            {instances.length > 0
              ? `${instances.length} ${instances.length === 1 ? 'сборка' : 'сборок'} в библиотеке`
              : 'Создайте первую сборку, чтобы начать'}
          </p>
          <div className="mt-5 flex gap-3">
            <button
              onClick={() => navigate('/library')}
              className="flex items-center gap-2 rounded-xl px-5 py-2.5 text-sm font-bold transition-all hover:scale-[1.03] active:scale-[0.98]"
              style={{ background: 'var(--color-primary)', color: 'var(--color-primary-text)' }}>
              <Play size={15} fill="currentColor" /> Играть
            </button>
            <button
              onClick={() => navigate('/discover')}
              className="flex items-center gap-2 rounded-xl px-5 py-2.5 text-sm font-semibold transition-all hover:scale-[1.03] active:scale-[0.98]"
              style={{ background: 'var(--color-surface-2)', color: 'var(--color-text-secondary)', border: '1px solid var(--color-border)' }}>
              <Plus size={15} /> Новая сборка
            </button>
          </div>
        </div>
        {/* decorative accent circle */}
        <div className="absolute -right-16 -top-16 h-48 w-48 rounded-full opacity-20"
          style={{ background: 'var(--color-primary)', filter: 'blur(40px)' }} />
      </motion.div>

      {/* quick actions */}
      <motion.div variants={fadeUp} className="mx-6 mt-6 grid grid-cols-3 gap-3">
        {[
          { icon: Gamepad2, label: 'Библиотека', desc: 'Управляйте сборками', to: '/library' },
          { icon: Box, label: 'Обзор', desc: 'Найдите моды', to: '/discover' },
          { icon: Palette, label: 'Скины', desc: 'Измените образ', to: '/skins' },
        ].map(({ icon: I, label, desc, to }) => (
          <button key={to} onClick={() => navigate(to)}
            className="flex items-center gap-3 rounded-2xl p-4 text-left transition-all hover:scale-[1.02] active:scale-[0.98]"
            style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)' }}>
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl"
              style={{ background: 'color-mix(in srgb, var(--color-primary) 12%, transparent)', color: 'var(--color-primary)' }}>
              <I size={18} />
            </div>
            <div className="min-w-0">
              <p className="text-[12px] font-bold" style={{ color: 'var(--color-text)' }}>{label}</p>
              <p className="text-[10px]" style={{ color: 'var(--color-text-tertiary)' }}>{desc}</p>
            </div>
          </button>
        ))}
      </motion.div>

      {/* recent */}
      {recent.length > 0 && (
        <motion.div variants={fadeUp} className="mx-6 mt-6">
          <div className="flex items-center justify-between mb-3">
            <p className="text-[11px] font-bold uppercase tracking-wider" style={{ color: 'var(--color-text-tertiary)' }}>
              Недавние сборки
            </p>
            <button onClick={() => navigate('/library')} className="flex items-center gap-1 text-[11px] font-semibold" style={{ color: 'var(--color-primary)' }}>
              Все <ChevronRight size={12} />
            </button>
          </div>
          <div className="grid grid-cols-2 gap-3">
            {recent.map(inst => (
              <button
                key={inst.id}
                onClick={() => navigate(`/library/${inst.id}`)}
                className="flex items-center gap-3 rounded-2xl p-4 text-left transition-all hover:scale-[1.02] active:scale-[0.98]"
                style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)' }}>
                <div className="h-12 w-12 rounded-xl overflow-hidden shrink-0 flex items-center justify-center text-sm font-bold"
                  style={{ background: inst.color || 'var(--color-surface-2)', color: '#fff' }}>
                  {inst.iconPath
                    ? <img src={toIconSrc(inst.iconPath)} className="h-full w-full object-cover" alt="" />
                    : inst.name[0]?.toUpperCase()}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-[12px] font-bold truncate" style={{ color: 'var(--color-text)' }}>{inst.name}</p>
                  <p className="text-[10px] truncate" style={{ color: 'var(--color-text-tertiary)' }}>
                    MC {inst.minecraftVersion} &middot; {inst.modLoader}
                  </p>
                </div>
                <ChevronRight size={14} style={{ color: 'var(--color-text-tertiary)' }} />
              </button>
            ))}
          </div>
        </motion.div>
      )}

      {/* empty state */}
      {instances.length === 0 && (
        <motion.div variants={fadeUp} className="mx-6 mt-6 flex flex-col items-center justify-center rounded-3xl p-12"
          style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)' }}>
          <Sparkles size={32} style={{ color: 'var(--color-primary)' }} />
          <p className="mt-4 text-sm font-bold" style={{ color: 'var(--color-text)' }}>Ваша библиотека пуста</p>
          <p className="mt-1 text-xs" style={{ color: 'var(--color-text-secondary)' }}>
            Создайте сборку или найдите модпак в Обзоре
          </p>
          <button onClick={() => navigate('/discover')}
            className="mt-4 rounded-xl px-5 py-2.5 text-sm font-bold transition-all hover:scale-[1.03]"
            style={{ background: 'var(--color-primary)', color: '#fff' }}>
            Открыть Обзор
          </button>
        </motion.div>
      )}

      <div className="h-8" />
    </motion.div>
  );
}

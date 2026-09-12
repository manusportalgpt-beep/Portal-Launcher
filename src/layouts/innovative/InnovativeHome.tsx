import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { Play, Plus, ChevronRight, Gamepad2, Palette, Sparkles, Box, Clock3, FolderOpen, Rocket } from 'lucide-react';
import { useInstanceStore } from '@/stores/instanceStore';
import { useCurrentUser, useIsAuthenticated } from '@/stores/authStore';
import { toIconSrc } from '@/lib/icon-src';
import { useLaunchStore } from '@/stores/launchStore';

const stagger = { hidden: {}, show: { transition: { staggerChildren: 0.06 } } };
const fadeUp = { hidden: { opacity: 0, y: 16 }, show: { opacity: 1, y: 0, transition: { duration: 0.4, ease: [0.16, 1, 0.3, 1] } } };

function fmtMinutes(mins: number) {
  if (!mins) return '0 ч';
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return h ? `${h} ч ${m ? `${m} мин` : ''}`.trim() : `${m} мин`;
}

export function InnovativeHome() {
  const navigate = useNavigate();
  const instances = useInstanceStore(s => s.instances);
  const user = useCurrentUser();
  const isAuth = useIsAuthenticated();
  const launchStatus = useLaunchStore(s => s.status);
  const [time, setTime] = useState(new Date());

  useEffect(() => { const t = setInterval(() => setTime(new Date()), 30000); return () => clearInterval(t); }, []);

  const hour = time.getHours();
  const greeting = hour < 6 ? 'Доброй ночи' : hour < 12 ? 'Доброе утро' : hour < 18 ? 'Добрый день' : 'Добрый вечер';

  const recent = instances
    .filter(i => i.lastPlayed)
    .sort((a, b) => (b.lastPlayed ?? '').localeCompare(a.lastPlayed ?? ''))
    .slice(0, 4);
  const totalPlayHours = Math.round(instances.reduce((acc, i) => acc + (i.totalPlayTime || 0), 0) / 60);
  const runningCount = Object.values(launchStatus).filter(s => s === 'running').length;

  return (
    <motion.div className="h-full overflow-auto" variants={stagger} initial="hidden" animate="show">
      <div className="mx-6 mt-6">
        {/* hero */}
        <motion.div variants={fadeUp} className="relative overflow-hidden rounded-[26px] p-8"
          style={{
            background: 'linear-gradient(135deg, color-mix(in srgb, var(--color-primary) 22%, transparent) 0%, color-mix(in srgb, var(--color-surface) 78%, transparent) 52%, color-mix(in srgb, var(--color-primary) 9%, transparent) 100%)',
            border: '1px solid color-mix(in srgb, var(--color-border-strong) 50%, var(--color-primary))',
            boxShadow: '0 24px 60px -24px color-mix(in srgb, var(--color-primary) 40%, transparent)',
          }}>
          <div className="absolute -right-20 -top-24 h-64 w-64 rounded-full opacity-25"
            style={{ background: 'var(--color-primary)', filter: 'blur(50px)' }} />
          <div className="absolute -bottom-24 -left-16 h-56 w-56 rounded-full opacity-16"
            style={{ background: 'var(--color-info)', filter: 'blur(55px)' }} />

          <div className="relative z-10">
            <span className="inline-flex items-center gap-2 rounded-full px-3 py-1 text-[11px] font-bold"
              style={{ background: 'color-mix(in srgb, var(--color-primary) 18%, transparent)', color: 'var(--color-primary)', border: '1px solid color-mix(in srgb, var(--color-primary) 35%, transparent)' }}>
              <Sparkles size={12} />
              {greeting}{isAuth && user ? `, ${user.username}` : ''}
            </span>
            <h1 className="mt-4 text-[34px] font-extrabold tracking-tight" style={{ color: 'var(--color-text)' }}>
              Portal Launcher
            </h1>
            <p className="mt-2 text-sm leading-relaxed max-w-xl" style={{ color: 'var(--color-text-secondary)' }}>
              {runningCount > 0
                ? `${runningCount} ${runningCount === 1 ? 'сборка запущена' : 'сборки запущены'} · продолжайте играть`
                : instances.length > 0
                  ? `${instances.length} ${instances.length === 1 ? 'сборка' : instances.length < 5 ? 'сборки' : 'сборок'} · ${totalPlayHours} ч сыграно`
                  : 'Создайте первую сборку и откройте мир Minecraft по-новому'}
            </p>
            <div className="mt-6 flex gap-3">
              <button
                onClick={() => navigate('/library')}
                className="group flex items-center gap-2 rounded-2xl px-6 py-3 text-sm font-bold transition-all hover:scale-[1.03] active:scale-[0.97]"
                style={{ background: 'var(--color-primary)', color: 'var(--color-primary-text)', boxShadow: '0 12px 32px -8px color-mix(in srgb, var(--color-primary) 70%, transparent)' }}>
                <Play size={16} fill="currentColor" /> Играть
              </button>
              <button
                onClick={() => navigate('/library?create=1')}
                className="flex items-center gap-2 rounded-2xl px-6 py-3 text-sm font-semibold transition-all hover:scale-[1.03] active:scale-[0.97]"
                style={{ background: 'color-mix(in srgb, var(--color-surface-2) 70%, transparent)', color: 'var(--color-text)', border: '1px solid var(--color-border)' }}>
                <Plus size={16} /> Новая сборка
              </button>
            </div>
          </div>
        </motion.div>

        {/* stats */}
        <motion.div variants={fadeUp} className="mt-4 grid grid-cols-3 gap-3">
          {[
            { icon: FolderOpen, label: 'Сборок', value: String(instances.length), to: '/library' },
            { icon: Clock3, label: 'Времени в игре', value: `${totalPlayHours} ч`, to: '/library' },
            { icon: Rocket, label: 'Запущено сейчас', value: String(runningCount), to: '/library' },
          ].map(({ icon: I, label, value, to }) => (
            <button key={label} onClick={() => navigate(to)}
              className="group flex items-center gap-3 rounded-2xl p-4 text-left transition-all hover:scale-[1.02] active:scale-[0.98]"
              style={{ background: 'color-mix(in srgb, var(--color-surface) 72%, transparent)', border: '1px solid var(--color-border)' }}>
              <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl transition-transform group-hover:scale-110"
                style={{ background: 'color-mix(in srgb, var(--color-primary) 14%, transparent)', color: 'var(--color-primary)' }}>
                <I size={19} />
              </div>
              <div className="min-w-0">
                <p className="text-[17px] font-extrabold" style={{ color: 'var(--color-text)' }}>{value}</p>
                <p className="text-[11px]" style={{ color: 'var(--color-text-secondary)' }}>{label}</p>
              </div>
            </button>
          ))}
        </motion.div>

        {/* quick actions */}
        <motion.div variants={fadeUp} className="mt-4 grid grid-cols-3 gap-3">
          {[
            { icon: Gamepad2, label: 'Библиотека', desc: 'Управляйте сборками', to: '/library' },
            { icon: Box, label: 'Обзор', desc: 'Моды и модпаки', to: '/discover' },
            { icon: Palette, label: 'Скины', desc: 'Измените образ', to: '/skins' },
          ].map(({ icon: I, label, desc, to }) => (
            <button key={to} onClick={() => navigate(to)}
              className="flex items-center gap-3 rounded-2xl p-4 text-left transition-all hover:scale-[1.02] active:scale-[0.98]"
              style={{ background: 'color-mix(in srgb, var(--color-surface) 72%, transparent)', border: '1px solid var(--color-border)' }}>
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl"
                style={{ background: 'color-mix(in srgb, var(--color-primary) 12%, transparent)', color: 'var(--color-primary)' }}>
                <I size={18} />
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-[12px] font-bold" style={{ color: 'var(--color-text)' }}>{label}</p>
                <p className="text-[10px]" style={{ color: 'var(--color-text-tertiary)' }}>{desc}</p>
              </div>
              <ChevronRight size={14} className="opacity-40 transition-all group-hover:opacity-100 group-hover:translate-x-0.5" style={{ color: 'var(--color-primary)' }} />
            </button>
          ))}
        </motion.div>

        {/* recent */}
        <motion.div variants={fadeUp} className="mt-6">
          <div className="mb-3 flex items-center justify-between">
            <p className="text-[13px] font-extrabold" style={{ color: 'var(--color-text)' }}>Недавние сборки</p>
            <button onClick={() => navigate('/library')} className="flex items-center gap-1 text-[11px] font-semibold transition-colors hover:opacity-80"
              style={{ color: 'var(--color-primary)' }}>
              Все сборки <ChevronRight size={13} />
            </button>
          </div>
          {recent.length > 0 ? (
            <div className="grid grid-cols-4 gap-3">
              {recent.map(inst => (
                <button key={inst.id} onClick={() => navigate(`/library/${inst.id}`)}
                  className="group relative overflow-hidden rounded-2xl p-4 text-left transition-all hover:scale-[1.02] active:scale-[0.98]"
                  style={{ background: 'color-mix(in srgb, var(--color-surface) 72%, transparent)', border: '1px solid var(--color-border)' }}>
                  <div className="flex h-14 w-14 items-center justify-center overflow-hidden rounded-2xl text-sm font-black"
                    style={{ background: 'color-mix(in srgb, var(--color-surface-2) 60%, transparent)', border: `1px solid ${inst.color || 'var(--color-primary)'}`, color: '#fff' }}>
                    {inst.iconPath
                      ? <img src={toIconSrc(inst.iconPath)} className="h-full w-full object-cover" alt="" draggable={false} />
                      : inst.name[0]?.toUpperCase()}
                  </div>
                  <p className="mt-3 truncate text-[13px] font-bold" style={{ color: 'var(--color-text)' }}>{inst.name}</p>
                  <p className="mt-0.5 text-[10px] font-semibold" style={{ color: 'var(--color-text-secondary)' }}>{inst.minecraftVersion}</p>
                  <span className="absolute right-3 top-3 rounded-full px-2 py-0.5 text-[9px] font-bold uppercase"
                    style={{ background: 'color-mix(in srgb, var(--color-primary) 16%, transparent)', color: 'var(--color-primary)' }}>
                    {inst.modLoader}
                  </span>
                </button>
              ))}
            </div>
          ) : (
            <div className="flex h-44 flex-col items-center justify-center rounded-[24px] border border-dashed text-center"
              style={{ borderColor: 'var(--color-border)', background: 'color-mix(in srgb, var(--color-surface) 45%, transparent)' }}>
              <div className="flex h-12 w-12 items-center justify-center rounded-2xl"
                style={{ background: 'color-mix(in srgb, var(--color-primary) 14%, transparent)', color: 'var(--color-primary)' }}>
                <FolderOpen size={20} />
              </div>
              <p className="mt-3 text-sm font-bold" style={{ color: 'var(--color-text)' }}>Пока пусто</p>
              <p className="mt-1 max-w-sm text-[11px]" style={{ color: 'var(--color-text-tertiary)' }}>Импортируйте модпак или создайте сборку вручную</p>
              <button onClick={() => navigate('/library?create=1')}
                className="mt-4 flex items-center gap-2 rounded-2xl px-4 py-2.5 text-[12px] font-bold transition-all hover:scale-[1.03]"
                style={{ background: 'var(--color-primary)', color: 'var(--color-primary-text)' }}>
                <Plus size={14} /> Создать
              </button>
            </div>
          )}
        </motion.div>
      </div>
    </motion.div>
  );
}

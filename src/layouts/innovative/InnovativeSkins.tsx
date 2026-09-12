import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { Palette, LogIn, Shirt, ExternalLink, ChevronRight, Sparkles } from 'lucide-react';
import { useCurrentUser, useIsAuthenticated } from '@/stores/authStore';
import { getAvatarUrl } from '@/lib/avatar';
import { CachedPlayerFace } from '@/components/CachedPlayerFace';

const stagger = { hidden: {}, show: { transition: { staggerChildren: 0.05 } } };
const fadeUp = { hidden: { opacity: 0, y: 14 }, show: { opacity: 1, y: 0, transition: { duration: 0.38, ease: [0.16, 1, 0.3, 1] } } };

export function InnovativeSkins() {
  const navigate = useNavigate();
  const user = useCurrentUser();
  const isAuth = useIsAuthenticated();

  const avatarUrl = getAvatarUrl(user);
  // Full body skin head
  const skinHeadUrl = user?.uuid
    ? `https://mc-heads.net/head/${encodeURIComponent(user.uuid)}/128`
    : null;

  return (
    <motion.div className="h-full overflow-auto" variants={stagger} initial="hidden" animate="show">
      <div className="mx-6 mt-6">

        {/* hero */}
        <motion.div variants={fadeUp} className="relative overflow-hidden rounded-[26px] p-8 mb-6"
          style={{
            background: 'linear-gradient(135deg, color-mix(in srgb, var(--color-primary) 18%, transparent) 0%, color-mix(in srgb, var(--color-surface) 72%, transparent) 50%, color-mix(in srgb, #8B5CF6 12%, transparent) 100%)',
            border: '1px solid color-mix(in srgb, var(--color-border-strong) 45%, #8B5CF6)',
            boxShadow: '0 20px 50px -18px color-mix(in srgb, #8B5CF6 28%, transparent)',
          }}>
          <div className="absolute -right-20 -top-20 h-56 w-56 rounded-full opacity-18 animate-aurora"
            style={{ background: '#8B5CF6', filter: 'blur(60px)' }} />
          <div className="absolute -bottom-24 -left-16 h-48 w-48 rounded-full opacity-14 animate-aurora"
            style={{ background: 'var(--color-primary)', filter: 'blur(60px)', animationDelay: '-4s' }} />

          <div className="relative z-10 flex items-center gap-8">
            <div className="flex-1">
              <span className="inline-flex items-center gap-2 rounded-full px-3 py-1 text-[11px] font-bold"
                style={{ background: 'color-mix(in srgb, #8B5CF6 18%, transparent)', color: '#8B5CF6', border: '1px solid color-mix(in srgb, #8B5CF6 35%, transparent)' }}>
                <Palette size={12} />
                Скины
              </span>
              <h1 className="mt-4 text-[28px] font-extrabold tracking-tight" style={{ color: 'var(--color-text)' }}>
                {isAuth && user ? `${user.username}` : 'Ваш образ'}
              </h1>
              <p className="mt-2 text-[13px] max-w-lg" style={{ color: 'var(--color-text-secondary)' }}>
                {isAuth ? 'Управляйте скинами и кейпами вашего персонажа' : 'Войдите в аккаунт, чтобы управлять своими скинами'}
              </p>
              <div className="mt-5 flex gap-3">
                {isAuth ? (
                  <button onClick={() => window.location.hash = '#/skins'}
                    className="flex items-center gap-2 rounded-2xl px-6 py-3 text-[13px] font-bold transition-all hover:scale-[1.03] active:scale-[0.97]"
                    style={{ background: 'var(--color-primary)', color: 'var(--color-primary-text)', boxShadow: '0 10px 28px -10px color-mix(in srgb, var(--color-primary) 70%, transparent)' }}>
                    <Shirt size={15} /> Редактор скинов
                  </button>
                ) : (
                  <button onClick={() => window.location.hash = '#/settings/account'}
                    className="flex items-center gap-2 rounded-2xl px-6 py-3 text-[13px] font-bold transition-all hover:scale-[1.03] active:scale-[0.97]"
                    style={{ background: 'var(--color-primary)', color: 'var(--color-primary-text)', boxShadow: '0 10px 28px -10px color-mix(in srgb, var(--color-primary) 70%, transparent)' }}>
                    <LogIn size={15} /> Войти в аккаунт
                  </button>
                )}
              </div>
            </div>

            {/* 3D-модель скина */}
            <div className="relative flex h-44 w-44 items-center justify-center">
              {/* decorative rings */}
              <div className="absolute inset-0 rounded-full opacity-30"
                style={{ border: '2px dashed color-mix(in srgb, #8B5CF6 50%, transparent)', animation: 'spin 18s linear infinite' }} />
              <div className="absolute inset-3 rounded-full opacity-20"
                style={{ border: '1px solid color-mix(in srgb, var(--color-primary) 50%, transparent)', animation: 'spin 12s linear infinite reverse' }} />

              {isAuth && skinHeadUrl ? (
                <motion.img
                  initial={{ scale: 0.8, opacity: 0, rotate: -10 }}
                  animate={{ scale: 1, opacity: 1, rotate: 0 }}
                  transition={{ type: 'spring', stiffness: 260, damping: 20 }}
                  src={skinHeadUrl}
                  className="relative z-10 h-32 w-32 rounded-3xl"
                  style={{ boxShadow: '0 20px 50px -14px color-mix(in srgb, var(--color-primary) 50%, transparent)' }}
                  alt="" draggable={false}
                />
              ) : isAuth && user ? (
                <CachedPlayerFace user={user} className="relative z-10 h-32 w-32 rounded-3xl" alt=""
                  style={{ boxShadow: '0 20px 50px -14px color-mix(in srgb, var(--color-primary) 50%, transparent)' }} />
              ) : (
                <div className="relative z-10 flex h-32 w-32 items-center justify-center rounded-3xl"
                  style={{ background: 'color-mix(in srgb, var(--color-surface-2) 70%, transparent)', border: '2px dashed var(--color-border)' }}>
                  <Palette size={36} style={{ color: 'var(--color-text-tertiary)' }} />
                </div>
              )}
            </div>
          </div>
        </motion.div>

        {/* quick links */}
        <motion.div variants={fadeUp} className="grid grid-cols-2 gap-3">
          {[
            { icon: Shirt, label: 'Полный редактор', desc: 'Изменение скинов, модель и кейпы', to: '/skins' },
            { icon: ExternalLink, label: 'Ely.by скины', desc: 'Управление на ely.by', to: 'https://account.ely.by/#/profile', external: true },
          ].map(({ icon: I, label, desc, to, external }) => (
            <button key={label}
              onClick={() => external ? window.open(to, '_blank') : (window.location.hash = `#${to}`)}
              className="group flex items-center gap-4 rounded-[20px] p-5 text-left transition-all hover:scale-[1.02] active:scale-[0.98]"
              style={{ background: 'color-mix(in srgb, var(--color-surface) 72%, transparent)', border: '1px solid var(--color-border)' }}>
              <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl"
                style={{ background: 'color-mix(in srgb, var(--color-primary) 14%, transparent)', color: 'var(--color-primary)' }}>
                <I size={19} />
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-[14px] font-bold" style={{ color: 'var(--color-text)' }}>{label}</p>
                <p className="mt-0.5 text-[11px]" style={{ color: 'var(--color-text-tertiary)' }}>{desc}</p>
              </div>
              <ChevronRight size={16} className="opacity-30 transition-all group-hover:opacity-100 group-hover:translate-x-0.5" style={{ color: 'var(--color-primary)' }} />
            </button>
          ))}
        </motion.div>

        {/* tips */}
        {isAuth && user && (
          <motion.div variants={fadeUp} className="mt-5 rounded-[22px] p-5"
            style={{ background: 'color-mix(in srgb, var(--color-surface) 72%, transparent)', border: '1px solid var(--color-border)' }}>
            <div className="flex items-center gap-2 mb-3">
              <Sparkles size={14} style={{ color: 'var(--color-primary)' }} />
              <p className="text-[13px] font-bold" style={{ color: 'var(--color-text)' }}>Совет</p>
            </div>
            <p className="text-[12px] leading-relaxed" style={{ color: 'var(--color-text-secondary)' }}>
              Скин применяется автоматически при запуске любой сборки. Измените его здесь
              или на ely.by — обновление отобразится через несколько секунд.
            </p>
          </motion.div>
        )}

      </div>
    </motion.div>
  );
}

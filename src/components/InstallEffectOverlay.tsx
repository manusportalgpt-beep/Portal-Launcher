import { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Check, Download } from 'lucide-react';
import { useUiStore } from '@/stores/uiStore';
import { playSuccess } from '@/lib/soundEngine';

export type InstallEffectPayload = {
  name?: string;
  iconUrl?: string | null;
  contentType?: 'mod' | 'resourcepack' | 'shaderpack' | 'datapack';
};

type ActiveEffect = InstallEffectPayload & { id: number };

/**
 * Shows one consistent success animation after content has been written to an
 * instance. Keeping it global prevents a card from unmounting before its local
 * animation can render after installedStore is updated.
 */
export function triggerInstallEffect(payload: InstallEffectPayload) {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent<InstallEffectPayload>('portal-install-success', { detail: payload }));
}

export function InstallEffectOverlay() {
  const installEffect = useUiStore(state => state.installEffect);
  const animations = useUiStore(state => state.animations);
  const [effect, setEffect] = useState<ActiveEffect | null>(null);
  const clearTimer = useRef<number | null>(null);

  useEffect(() => {
    const onSuccess = (event: Event) => {
      playSuccess();
      if (installEffect === 'none' || !animations) return;
      const payload = (event as CustomEvent<InstallEffectPayload>).detail ?? {};
      if (clearTimer.current) window.clearTimeout(clearTimer.current);
      const next = { ...payload, id: Date.now() };
      setEffect(next);
      clearTimer.current = window.setTimeout(() => setEffect(null), 1350);
    };
    window.addEventListener('portal-install-success', onSuccess);
    return () => {
      window.removeEventListener('portal-install-success', onSuccess);
      if (clearTimer.current) window.clearTimeout(clearTimer.current);
    };
  }, [animations, installEffect]);

  const motionPreset = installEffect === 'zoom-bounce'
    ? { initial: { opacity: 0, scale: 0.25, y: 90 }, animate: { opacity: [0, 1, 1, 0], scale: [0.25, 1.18, 0.96, 0.72], y: [90, 0, 8, -18] }, transition: { duration: 1.2, ease: [0.2, 0.8, 0.2, 1] as const } }
    : installEffect === 'orbit'
      ? { initial: { opacity: 0, x: 260, y: 76, rotate: -24, scale: 0.7 }, animate: { opacity: [0, 1, 1, 0], x: [260, 90, -30, -180], y: [76, 0, 18, 62], rotate: [-24, 8, -4, 18], scale: [0.7, 1, 0.94, 0.72] }, transition: { duration: 1.35, ease: [0.18, 0.78, 0.22, 1] as const } }
      : installEffect === 'shimmer'
        ? { initial: { opacity: 0, y: 0, scale: 0.82 }, animate: { opacity: [0, 1, 1, 0], y: [0, -4, 0, -8], scale: [0.82, 1, 1.04, 0.92], filter: ['brightness(0.8)', 'brightness(1.35)', 'brightness(1)', 'brightness(0.8)'] }, transition: { duration: 1.45, ease: 'easeInOut' as const } }
        : { initial: { opacity: 0, y: -30, scale: 0.58, rotate: -9 }, animate: { opacity: [0, 1, 1, 0], y: [-30, 4, 112, 150], scale: [0.58, 1.06, 0.94, 0.82], rotate: [-9, 0, 2, 5] }, transition: { duration: 1.25, times: [0, 0.18, 0.76, 1], ease: [0.18, 0.78, 0.22, 1] as const } };

  return (
    <div className="pointer-events-none fixed inset-0 z-[190] overflow-hidden" aria-live="polite">
      <AnimatePresence>
        {effect && (
          <motion.div
            key={effect.id}
            className="absolute right-6 top-16 flex items-center gap-2 rounded-2xl px-2.5 py-2"
            style={{
              background: 'color-mix(in srgb, var(--color-surface) 94%, transparent)',
              border: '1px solid var(--color-primary)',
              boxShadow: 'var(--shadow-glow)',
              backdropFilter: 'blur(12px)',
            }}
            initial={motionPreset.initial}
            animate={motionPreset.animate}
            exit={{ opacity: 0, y: 165, scale: 0.72 }}
            transition={motionPreset.transition}
          >
            <span className="flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-xl"
              style={{ background: 'var(--color-surface-2)', border: '1px solid var(--color-border)' }}>
              {effect.iconUrl
                ? <img src={effect.iconUrl} alt="" className="h-full w-full object-cover" />
                : <Download className="h-4 w-4" style={{ color: 'var(--color-primary)' }} />}
            </span>
            <span className="flex min-w-0 flex-col">
              <span className="flex items-center gap-1 text-[10px] font-bold" style={{ color: 'var(--color-primary)' }}>
                <Check className="h-3 w-3" /> Added to instance
              </span>
              {effect.name && <span className="max-w-36 truncate text-[10px]" style={{ color: 'var(--color-text-secondary)' }}>{effect.name}</span>}
            </span>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

export default InstallEffectOverlay;

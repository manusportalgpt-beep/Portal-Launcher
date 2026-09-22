import { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { listen } from '@tauri-apps/api/event';

export interface ProgressState {
  visible: boolean;
  name: string;
  icon?: string;
  stage: string;
  percent: number;
  message: string;
  color?: string;
}

interface Props {
  state: ProgressState;
  onClose?: () => void;
}

function ProgressBar({ percent, color }: { percent: number; color?: string }) {
  return (
    <div className="w-full h-2 rounded-full overflow-hidden" style={{ background: 'var(--color-surface-2)' }}>
      <motion.div
        className="h-full rounded-full"
        style={{ background: color ?? 'var(--color-primary)', originX: 0 }}
        initial={{ width: 0 }}
        animate={{ width: `${Math.min(100, Math.max(0, percent))}%` }}
        transition={{ type: 'spring', stiffness: 80, damping: 20 }}
      />
    </div>
  );
}

export function ProgressModal({ state, onClose }: Props) {
  const isDone = state.percent >= 100;

  useEffect(() => {
    if (isDone && onClose) {
      const t = setTimeout(onClose, 1200);
      return () => clearTimeout(t);
    }
  }, [isDone, onClose]);

  return (
    <AnimatePresence>
      {state.visible && (
        <motion.div
          className="fixed inset-0 z-[100] flex items-end justify-center pb-8 px-4 pointer-events-none"
          initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
          <motion.div
            className="w-full max-w-sm rounded-2xl p-4 pointer-events-auto"
            style={{
              background: 'var(--color-surface)',
              border: '1px solid var(--color-border)',
              boxShadow: 'var(--shadow-lg)',
            }}
            initial={{ y: 40, scale: 0.95 }} animate={{ y: 0, scale: 1 }} exit={{ y: 40, scale: 0.95 }}
            transition={{ type: 'spring', stiffness: 280, damping: 28 }}>

            {/* Header row */}
            <div className="flex items-center gap-3 mb-3">
              {/* Icon */}
              <div
                className="w-10 h-10 rounded-xl flex items-center justify-center text-lg font-bold shrink-0"
                style={{ background: `${state.color ?? 'var(--color-primary)'}20`, color: state.color ?? 'var(--color-primary)' }}>
                {state.icon ? (
                  <img src={state.icon} className="w-8 h-8 rounded-lg object-cover" alt="" />
                ) : (
                  state.name?.[0]?.toUpperCase() ?? '?'
                )}
              </div>

              {/* Text */}
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold truncate" style={{ color: 'var(--color-text)' }}>{state.name}</p>
                <p className="text-xs truncate mt-0.5" style={{ color: 'var(--color-text-secondary)' }}>{state.message}</p>
              </div>

              {/* Percent badge */}
              <span
                className="text-xs font-bold shrink-0 px-2 py-0.5 rounded-full"
                style={{ background: `${state.color ?? 'var(--color-primary)'}20`, color: state.color ?? 'var(--color-primary)' }}>
                {isDone ? '✓' : `${state.percent}%`}
              </span>
            </div>

            {/* Progress bar */}
            <ProgressBar percent={state.percent} color={state.color} />
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

/** Hook: listens to Tauri progress events and returns current ProgressState */
export function useProgressModal(eventName: string) {
  const [progress, setProgress] = useState<ProgressState>({ visible: false, name: '', stage: '', percent: 0, message: '' });

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    listen<any>(eventName, (evt) => {
      const p = evt.payload;
      setProgress({
        visible: true,
        name: p.name ?? '',
        icon: p.icon,
        stage: p.stage ?? '',
        percent: typeof p.percent === 'number' ? p.percent : 0,
        message: p.message ?? '',
        color: p.color,
      });
    }).then(fn => { unlisten = fn; });
    return () => { unlisten?.(); };
  }, [eventName]);

  const hide = () => setProgress(s => ({ ...s, visible: false }));
  return { progress, setProgress, hide };
}

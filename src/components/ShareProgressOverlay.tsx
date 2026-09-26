import { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Check, Globe, Loader2, X } from 'lucide-react';

export type SharePhase = 'scan' | 'hash' | 'lookup' | 'upload' | 'done' | 'error';

export type ShareState = {
  open: boolean;
  phase: SharePhase;
  current: number;
  total: number;
  message: string;
  url: string;
} | null;

const PHASE_LABEL: Record<SharePhase, string> = {
  scan: 'Сканирование файлов',
  hash: 'Подсчёт хешей',
  lookup: 'Поиск на Modrinth',
  upload: 'Загрузка на сервер',
  done: 'Готово',
  error: 'Ошибка',
};

// Если сервер не отвечает, этап не присылает событий долго. Раньше тост висел
// «Загрузка…» бесконечно; теперь показываем предупреждение и даём закрыть.
const STALL_WARN_MS = 90_000;

export function shareProgressListener(set: React.Dispatch<React.SetStateAction<ShareState>>,
  onDone: (url: string) => void) {
  return (payload: any) => {
    const phase = (payload?.phase ?? 'scan') as SharePhase;
    set(prev => {
      const next: ShareState = {
        open: true,
        phase,
        current: Number(payload?.current ?? 0),
        total: Number(payload?.total ?? 0),
        message: String(payload?.message ?? ''),
        url: String(payload?.url ?? ''),
      };
      return next;
    });
    if (phase === 'done' && payload?.url) onDone(String(payload.url));
  };
}

export function ShareProgressOverlay({ state, onClose }: { state: ShareState; onClose: () => void }) {
  const [elapsed, setElapsed] = useState(0);
  const [stalled, setStalled] = useState(false);
  const lastEvent = useRef(Date.now());

  useEffect(() => {
    if (!state?.open) { setElapsed(0); setStalled(false); return; }
    lastEvent.current = Date.now();
    const started = Date.now();
    const id = window.setInterval(() => {
      setElapsed(Math.floor((Date.now() - started) / 1000));
      setStalled(Date.now() - lastEvent.current > STALL_WARN_MS);
    }, 1000);
    return () => window.clearInterval(id);
  }, [state?.open, state?.phase]);

  useEffect(() => { lastEvent.current = Date.now(); }, [state?.current, state?.message]);

  const pct = state && state.total > 0
    ? Math.min(100, Math.round((state.current / state.total) * 100))
    : null;
  const mmss = `${Math.floor(elapsed / 60)}:${String(elapsed % 60).padStart(2, '0')}`;

  return (
    <AnimatePresence>
      {state?.open && (
        <motion.div
          data-portal-overlay="true"
          className="fixed inset-0 z-[400] flex items-center justify-center p-4"
          style={{ background: 'rgba(0,0,0,0.72)', backdropFilter: 'blur(4px)' }}
          initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
        >
          <motion.div
            className="w-full max-w-md overflow-hidden rounded-xl"
            style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)' }}
            initial={{ scale: 0.96, y: 8 }} animate={{ scale: 1, y: 0 }} exit={{ scale: 0.96, y: 8 }}
            transition={{ duration: 0.14 }}
          >
            <div className="flex items-center gap-2 px-4 py-3" style={{ borderBottom: '1px solid var(--color-border)' }}>
              <Globe size={15} style={{ color: 'var(--color-primary)' }} />
              <span className="flex-1 text-sm font-black" style={{ color: 'var(--color-text)' }}>Instances Share</span>
              {state.phase !== 'done' && state.phase !== 'error' && (
                <Loader2 size={15} className="animate-spin" style={{ color: 'var(--color-primary)' }} />
              )}
              {state.phase === 'done' && <Check size={15} style={{ color: 'var(--color-success)' }} />}
              <span className="text-[11px] font-bold tabular-nums" style={{ color: 'var(--color-text-tertiary)' }}>{mmss}</span>
              <button onClick={onClose} title="Скрыть"
                className="flex h-7 w-7 items-center justify-center rounded transition-colors"
                style={{ color: 'var(--color-text-secondary)' }}>
                <X size={14} />
              </button>
            </div>

            <div className="px-4 py-3">
              <div className="flex items-center justify-between text-xs">
                <span style={{ color: 'var(--color-text-secondary)' }}>
                  {PHASE_LABEL[state.phase] ?? state.phase}
                </span>
                <span className="tabular-nums" style={{ color: 'var(--color-text-tertiary)' }}>
                  {pct !== null ? `${pct}%` : '…'}
                </span>
              </div>
              <div className="mt-2 h-1.5 w-full overflow-hidden" style={{ background: 'var(--color-surface-2)' }}>
                <div className="h-full transition-all"
                  style={{
                    width: `${pct ?? 12}%`,
                    background: state.phase === 'error' ? 'var(--color-error)' : 'var(--color-primary)',
                  }} />
              </div>
              {state.total > 0 && (
                <p className="mt-1.5 text-[11px] tabular-nums" style={{ color: 'var(--color-text-tertiary)' }}>
                  {state.current} / {state.total}
                </p>
              )}
              {stalled && state.phase !== 'done' && state.phase !== 'error' && (
                <p className="mt-2 text-[11px]" style={{ color: 'var(--color-warning)' }}>
                  Сервер uprojects.site не отвечает. Публикация может занять несколько минут
                  или не удастся — закрой окно и попробуй позже.
                </p>
              )}
              {state.url && (
                <p className="mt-2 break-all text-[11px]" style={{ color: 'var(--color-primary)' }}>{state.url}</p>
              )}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

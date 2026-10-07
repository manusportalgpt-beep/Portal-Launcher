import { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Check, Copy, Globe, Loader2, X } from 'lucide-react';

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
  // Состояние кнопки копирования: после клика иконка меняется на галочку,
  // чтобы было видно, что ссылка действительно попала в буфер.
  const [copied, setCopied] = useState(false);
  const lastEvent = useRef(Date.now());

  // navigator.clipboard есть не всегда (например, в небезопасном контексте),
  // поэтому есть запасной путь через временный textarea.
  const copyShareUrl = async (url: string) => {
    try {
      await navigator.clipboard.writeText(url);
    } catch {
      const field = document.createElement('textarea');
      field.value = url;
      field.style.position = 'fixed';
      field.style.opacity = '0';
      document.body.appendChild(field);
      field.select();
      try { document.execCommand('copy'); } catch { /* буфер недоступен */ }
      document.body.removeChild(field);
    }
    setCopied(true);
  };

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
                <div className="mt-2">
                  <p className="text-[11px]" style={{ color: 'var(--color-warning)' }}>
                    Сервер uprojects.site не отвечает. Публикация может занять несколько минут
                    или не удастся — закрой окно и попробуй позже.
                  </p>
                  {/* Сторож: без кнопки «Прервать» окно висело бесконечно.
                      Подтверждать отмену не нужно — сам invoke всё равно
                      останется в фоне, но интерфейс уже не заблокирован. */}
                  <button onClick={onClose}
                    className="mt-1.5 w-full rounded-lg py-1.5 text-[11px] font-bold transition-opacity hover:opacity-80"
                    style={{ background: 'var(--color-surface-2)', color: 'var(--color-text)', border: '1px solid var(--color-border)' }}>
                    Прервать и закрыть
                  </button>
                </div>
              )}
              {state.url && (
                <div
                  className="group mt-2 flex items-start gap-2"
                  onMouseEnter={() => setCopied(false)}>
                  <a
                    href={state.url}
                    target="_blank"
                    rel="noreferrer noopener"
                    className="min-w-0 flex-1 break-all text-[11px] underline decoration-dotted underline-offset-2"
                    style={{ color: 'var(--color-primary)' }}>
                    {state.url}
                  </a>
                  <button
                    onClick={() => copyShareUrl(state.url)}
                    title={copied ? 'Скопировано' : 'Скопировать ссылку'}
                    aria-label={copied ? 'Скопировано' : 'Скопировать ссылку'}
                    className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-md opacity-0 transition-opacity focus-visible:opacity-100 group-hover:opacity-100"
                    style={{ background: 'var(--color-surface-2)', color: copied ? 'var(--color-success)' : 'var(--color-text-secondary)', border: '1px solid var(--color-border)' }}>
                    {copied
                      ? <Check className="h-3.5 w-3.5" />
                      : <Copy className="h-3.5 w-3.5" />}
                  </button>
                </div>
              )}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

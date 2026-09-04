import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Check, X, AlertCircle } from 'lucide-react';

export interface ToastItem {
  id: number;
  title: string;
  subtitle?: string;
  kind: 'success' | 'error' | 'info' | 'dismiss';
}

// Simple global toast bus — no store needed, keeps it light
const listeners = new Set<(t: ToastItem) => void>();

export function showToast(title: string, subtitle?: string, kind: ToastItem['kind'] = 'success') {
  const item = { id: Date.now() + Math.random(), title, subtitle, kind };
  listeners.forEach(fn => fn(item));
  setTimeout(() => listeners.forEach(fn => fn({ ...item, kind: 'dismiss' as any })), 4000);
}

export function toastSuccess(title: string, subtitle?: string) { showToast(title, subtitle, 'success'); }
export function toastError(title: string, subtitle?: string) { showToast(title, subtitle, 'error'); }
export function toastInfo(title: string, subtitle?: string) { showToast(title, subtitle, 'info'); }

export function FileToastHost() {
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  useEffect(() => {
    const remove = (t: ToastItem) => setToasts(prev => prev.filter(x => x.id !== t.id));
    const add = (t: ToastItem) => {
      if (t.kind === 'dismiss') { remove(t); return; }
      setToasts(prev => [...prev, t].slice(-3));
      setTimeout(() => remove(t), 3800);
    };
    listeners.add(add);
    return () => { listeners.delete(add); };
  }, []);

  return (
    <div className="fixed bottom-20 right-5 z-[950] flex flex-col gap-2 items-end">
      <AnimatePresence>
        {toasts.map(t => (
          <motion.div key={t.id}
            initial={{ opacity: 0, y: 12, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 8, scale: 0.97 }}
            className="flex items-start gap-2.5 px-3.5 py-2.5 min-w-[260px] max-w-[340px]"
            style={{ background: 'var(--color-bg)', border: `1px solid ${t.kind === 'error' ? 'var(--color-error)' : 'var(--color-border)'}`, borderRadius: 6, boxShadow: '0 4px 20px rgba(0,0,0,0.25)' }}>
            {t.kind === 'error'
              ? <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" style={{ color: 'var(--color-error)' }} />
              : <Check className="w-4 h-4 shrink-0 mt-0.5" style={{ color: 'var(--color-success)' }} />
            }
            <div className="min-w-0">
              <p className="text-[12px] font-medium leading-snug" style={{ color: 'var(--color-text)', whiteSpace: 'pre-line' }}>{t.title}</p>
              {t.subtitle && <p className="text-[10px] mt-0.5 leading-snug" style={{ color: 'var(--color-text-tertiary)', whiteSpace: 'pre-line' }}>{t.subtitle}</p>}
            </div>
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}

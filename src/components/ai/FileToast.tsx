import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Toast as UivToast } from '@/components/uiverse/Uiv';

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

  // Пункт 11: тосты ошибок/выполнения появляются в правом нижнем углу.
  // Ошибка — heavy-cobra-18, успех — wicked-chipmunk-81 (uiverse.io).
  return (
    <div className="fixed bottom-20 right-5 z-[950] flex flex-col gap-2 items-end">
      <AnimatePresence>
        {toasts.map(t => (
          <motion.div key={t.id}
            initial={{ opacity: 0, x: 40 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: 40 }}
            style={{ width: 288 }}
          >
            <UivToast
              kind={t.kind === 'error' ? 'error' : 'success'}
              title={t.title}
              detail={t.subtitle}
            />
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}

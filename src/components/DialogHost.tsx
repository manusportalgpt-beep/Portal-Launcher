import { useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { AlertTriangle, FilePenLine } from 'lucide-react';
import { useDialogStore } from '@/stores/dialogStore';

export function DialogHost() {
  const queue = useDialogStore(s => s.queue);
  const resolveTop = useDialogStore(s => s.resolveTop);
  const req = queue[0];
  const [value, setValue] = useState(req?.defaultValue ?? '');

  useEffect(() => {
    setValue(req?.defaultValue ?? '');
  }, [req?.id, req?.defaultValue]);

  return (
    <AnimatePresence>
      {req && (
        <motion.div
          initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
          className="fixed inset-0 z-[999] flex items-center justify-center p-4"
          style={{ background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(5px)' }}
          onClick={() => (req.kind === 'confirm' || req.kind === 'prompt') && resolveTop(false)}
        >
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 8 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 8 }}
            transition={{ duration: 0.15 }}
            onClick={e => e.stopPropagation()}
            className="w-full max-w-sm rounded-2xl p-5"
            style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', boxShadow: 'var(--shadow-lg)' }}
          >
            <div className="flex items-start gap-3 mb-4">
              <div className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0"
                style={{ background: req.danger ? 'rgba(231,76,60,0.12)' : 'var(--color-primary-dim)' }}>
                {req.danger ? <AlertTriangle className="w-4.5 h-4.5" style={{ color: 'var(--color-error)' }} /> : <FilePenLine className="w-4.5 h-4.5" style={{ color: 'var(--color-primary)' }} />}
              </div>
              <div className="min-w-0 flex-1">
                {req.title && <p className="text-sm font-bold mb-1" style={{ color: 'var(--color-text)' }}>{req.title}</p>}
                <p className="text-sm whitespace-pre-line" style={{ color: 'var(--color-text-secondary)' }}>{req.message}</p>
              </div>
            </div>
            {req.kind === 'prompt' && (
              <input
                autoFocus
                value={value}
                onChange={event => setValue(event.target.value)}
                onKeyDown={event => { if (event.key === 'Enter' && value.trim()) resolveTop(value.trim()); }}
                placeholder={req.placeholder}
                className="mb-4 w-full rounded-xl px-3 py-2.5 text-sm outline-none"
                style={{ background: 'var(--color-surface-2)', border: '1px solid var(--color-primary)', color: 'var(--color-text)' }}
              />
            )}
            <div className="flex justify-end gap-2">
              {(req.kind === 'confirm' || req.kind === 'prompt') && (
                <button onClick={() => resolveTop(false)} className="px-4 py-2 rounded-xl text-xs font-bold"
                  style={{ background: 'var(--color-surface-2)', color: 'var(--color-text-secondary)', border: '1px solid var(--color-border)' }}>
                  {req.cancelLabel || 'Cancel'}
                </button>
              )}
              <button
                disabled={req.kind === 'prompt' && !value.trim()}
                onClick={() => resolveTop(req.kind === 'prompt' ? value.trim() : true)}
                className="px-4 py-2 rounded-xl text-xs font-bold disabled:opacity-50"
                style={{ background: req.danger ? 'var(--color-error)' : 'var(--color-primary)', color: 'var(--color-primary-text)' }}>
                {req.confirmLabel || (req.kind === 'confirm' ? 'Confirm' : req.kind === 'prompt' ? 'Save' : 'OK')}
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

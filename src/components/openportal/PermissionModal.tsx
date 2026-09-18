import { motion, AnimatePresence } from 'framer-motion';
import { ShieldAlert, ShieldCheck, X } from 'lucide-react';
import { useOpenCoreStore } from '@/stores/opencoreStore';

export function PermissionModal() {
  const req = useOpenCoreStore(s => s.pendingPermission);
  const resolvePermission = useOpenCoreStore(s => s.resolvePermission);

  return (
    <AnimatePresence>
    {req && (
      <motion.div
        initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
        className="fixed inset-0 z-[60] flex items-center justify-center p-6"
        style={{ background: 'rgba(0,0,0,0.55)', backdropFilter: 'blur(6px)' }}>
        <motion.div
          initial={{ scale: 0.96, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.96, opacity: 0 }}
          className="w-[min(440px,92vw)] rounded-3xl border p-5"
          style={{ background: 'var(--color-surface)', borderColor: 'var(--color-border)', boxShadow: '0 32px 80px rgba(0,0,0,.5)' }}>
          <div className="mb-3 flex items-start gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl"
              style={{ background: 'rgba(250,204,21,0.12)', color: '#FACC15' }}>
              <ShieldAlert size={20} />
            </div>
            <div className="min-w-0 flex-1">
              <h3 className="text-base font-black" style={{ color: 'var(--color-text)' }}>{req.label}</h3>
              <p className="mt-0.5 text-xs leading-5" style={{ color: 'var(--color-text-secondary)' }}>
                Агент просит доступ.<br />
                <code className="mt-1 block break-all rounded-md px-2 py-1 font-mono text-[11px]"
                  style={{ background: 'var(--color-surface-2)', color: 'var(--color-text)' }}>{req.detail}</code>
              </p>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <button onClick={() => resolvePermission('never')}
              className="flex-1 rounded-xl px-3 py-2.5 text-sm font-bold"
              style={{ background: 'var(--color-surface-2)', color: 'var(--color-error)', border: '1px solid var(--color-border)' }}>
              Не разрешать
            </button>
            <button onClick={() => resolvePermission('once')}
              className="flex-1 rounded-xl px-3 py-2.5 text-sm font-bold"
              style={{ background: 'var(--color-surface-2)', color: 'var(--color-text)', border: '1px solid var(--color-border)' }}>
              Разрешить один раз
            </button>
            <button onClick={() => resolvePermission('always')}
              className="flex w-full items-center justify-center gap-1.5 rounded-xl px-3 py-2.5 text-sm font-bold"
              style={{ background: 'var(--color-primary)', color: 'var(--color-primary-text)' }}>
              <ShieldCheck size={15} /> Разрешить навсегда
            </button>
          </div>
          <button onClick={() => resolvePermission('deny')} title="Закрыть"
            className="absolute right-3 top-3 flex h-7 w-7 items-center justify-center rounded-lg text-[var(--color-text-tertiary)] hover:opacity-70">
            <X size={15} />
          </button>
        </motion.div>
      </motion.div>
    )}
    </AnimatePresence>
  );
}
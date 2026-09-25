import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ChevronLeft, X, KeyRound, Globe } from 'lucide-react';
import { MicrosoftAuthOAuth } from '@/components/auth/MicrosoftAuthOAuth';
import { MicrosoftAuthBrowser } from '@/components/auth/MicrosoftAuthBrowser';

type Method = 'choose' | 'code' | 'browser';

/**
 * Рамка выбора способа входа в Microsoft.
 *
 * Сначала пользователь выбирает способ, и только потом начинается вход.
 * Способ «Код подтверждения» — текущий рабочий вариант, он вызывается
 * без каких-либо изменений. Второй способ — OAuth 2.0 через браузер.
 */
export function MicrosoftAuthChoice({ onSuccess, onCancel }: {
  onSuccess?: () => void;
  onCancel?: () => void;
}) {
  const [method, setMethod] = useState<Method>('choose');

  return (
    <div className="flex flex-col gap-3">
      <AnimatePresence mode="wait">
        {method === 'choose' ? (
          <motion.div key="choose"
            initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }}
            transition={{ duration: 0.15 }} className="flex flex-col gap-2">
            <p className="text-xs leading-5" style={{ color: 'var(--color-text-secondary)' }}>
              Выбери способ входа — оба работают с одним и тем же аккаунтом Microsoft.
            </p>
            <button onClick={() => setMethod('browser')}
              className="flex w-full items-start gap-3 rounded-lg p-3 text-left transition-colors hover:bg-[var(--color-surface-2)]"
              style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)' }}>
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded"
                style={{ background: 'var(--color-primary)', color: 'var(--color-primary-text)' }}>
                <Globe size={15} />
              </span>
              <span className="min-w-0">
                <span className="block text-[13px] font-bold" style={{ color: 'var(--color-text)' }}>Через браузер</span>
                <span className="mt-0.5 block text-[11px] leading-4" style={{ color: 'var(--color-text-tertiary)' }}>
                  Открывается страница Microsoft, где выбираешь уже залогиненный аккаунт. Код вводить не нужно.
                </span>
              </span>
            </button>
            <button onClick={() => setMethod('code')}
              className="flex w-full items-start gap-3 rounded-lg p-3 text-left transition-colors hover:bg-[var(--color-surface-2)]"
              style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)' }}>
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded"
                style={{ background: 'var(--color-surface-2)', color: 'var(--color-text-secondary)' }}>
                <KeyRound size={15} />
              </span>
              <span className="min-w-0">
                <span className="block text-[13px] font-bold" style={{ color: 'var(--color-text)' }}>По коду подтверждения</span>
                <span className="mt-0.5 block text-[11px] leading-4" style={{ color: 'var(--color-text-tertiary)' }}>
                  Лаунчер покажет код и ссылку, нужно подтвердить вход на сайте Microsoft.
                </span>
              </span>
            </button>
          </motion.div>
        ) : method === 'code' ? (
          <motion.div key="code"
            initial={{ opacity: 0, x: 8 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 8 }}
            transition={{ duration: 0.15 }} className="flex flex-col gap-3">
            <button onClick={() => setMethod('choose')}
              className="flex items-center gap-1 self-start text-[11px] font-bold"
              style={{ color: 'var(--color-text-tertiary)' }}>
              <ChevronLeft size={12} /> Выбор способа
            </button>
            {/* Текущий способ входа — вызывается как есть, без изменений. */}
            <MicrosoftAuthOAuth onSuccess={onSuccess} onCancel={onCancel} />
          </motion.div>
        ) : (
          <motion.div key="browser"
            initial={{ opacity: 0, x: 8 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 8 }}
            transition={{ duration: 0.15 }} className="flex flex-col gap-3">
            <button onClick={() => setMethod('choose')}
              className="flex items-center gap-1 self-start text-[11px] font-bold"
              style={{ color: 'var(--color-text-tertiary)' }}>
              <ChevronLeft size={12} /> Выбор способа
            </button>
            <MicrosoftAuthBrowser onSuccess={onSuccess} onCancel={() => setMethod('choose')} />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

export default MicrosoftAuthChoice;

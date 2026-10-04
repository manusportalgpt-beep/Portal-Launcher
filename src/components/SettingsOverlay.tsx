import { useEffect } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { X } from 'lucide-react';
import { SettingsPage } from '@/pages/SettingsPage';
import { useUiStore } from '@/stores/uiStore';
import { playClick } from '@/lib/soundEngine';

type SettingsSection =
  | 'account'
  | 'minecraft'
  | 'appearance'
  | 'controls'
  | 'audio'
  | 'language'
  | 'update'
  | 'advanced'
  | 'about';

/**
 * Единая панель настроек поверх рабочего пространства.
 * Внутри используется полноценный SettingsPage, поэтому overlay не создаёт
 * урезанную копию настроек и не расходится с основным экраном.
 */
export function SettingsOverlay() {
  const open = useUiStore(s => s.settingsOverlayOpen);
  const section = useUiStore(s => s.settingsSection) as SettingsSection;
  const set = useUiStore(s => s.set);

  const close = () => {
    playClick();
    set('settingsOverlayOpen', false);
  };

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') close();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open]);

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          data-portal-overlay="true"
          className="fixed inset-0 z-[200] flex items-center justify-center p-2 sm:p-3"
          style={{ background: 'color-mix(in srgb, var(--color-bg) 82%, transparent)' }}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
        >
          <motion.section
            role="dialog"
            aria-modal="true"
            aria-label="Настройки Portal Launcher"
            className="portal-settings-overlay relative h-full w-full overflow-hidden rounded-[20px]"
            style={{
              background: 'var(--color-bg)',
              border: '1px solid var(--color-border)',
              boxShadow: '0 24px 80px rgba(0,0,0,.42)',
            }}
            initial={{ opacity: 0, y: 14, scale: 0.985 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 10, scale: 0.99 }}
            transition={{ duration: 0.24, ease: [0.22, 1, 0.36, 1] }}
          >
            <button
              type="button"
              onClick={close}
              className="absolute right-3 top-3 z-20 flex h-8 w-8 items-center justify-center rounded-xl"
              style={{
                color: 'var(--color-text-secondary)',
                background: 'color-mix(in srgb, var(--color-surface-2) 84%, transparent)',
                border: '1px solid var(--color-border)',
              }}
              title="Закрыть настройки"
              aria-label="Закрыть настройки"
            >
              <X size={15} />
            </button>
            <SettingsPage initialSection={section} />
          </motion.section>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

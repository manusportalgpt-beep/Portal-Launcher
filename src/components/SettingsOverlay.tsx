import { useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import {
  User, Cpu, Palette, Gamepad2, Volume2, Globe, Code, Shield, X, ChevronLeft,
} from 'lucide-react';
import { useUiStore } from '@/stores/uiStore';
import { playClick } from '@/lib/soundEngine';

type Section = 'account' | 'minecraft' | 'appearance' | 'controls' | 'audio' | 'language' | 'advanced' | 'about';

const SECTIONS: Array<{ id: Section; icon: any; label: string }> = [
  { id: 'account',    icon: User,     label: 'Аккаунты' },
  { id: 'minecraft',  icon: Cpu,      label: 'Minecraft' },
  { id: 'appearance', icon: Palette,  label: 'Оформление' },
  { id: 'controls',   icon: Gamepad2, label: 'Управление' },
  { id: 'audio',      icon: Volume2,  label: 'Аудио' },
  { id: 'language',   icon: Globe,    label: 'Язык' },
  { id: 'advanced',   icon: Code,     label: 'Доп.' },
  { id: 'about',      icon: Shield,   label: 'О нас' },
];

export function SettingsOverlay() {
  const ui = useUiStore();
  const [active, setActive] = useState<Section>((ui.settingsSection as Section) || 'account');

  const close = () => {
    playClick();
    ui.set('settingsOverlayOpen' as any, false);
  };

  if (!ui.settingsOverlayOpen) return null;

  return (
    <AnimatePresence>
      <motion.div
        data-portal-overlay="true"
        className="fixed inset-0 z-[200] flex"
        style={{ background: 'var(--color-bg)' }}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.2 }}
      >
        {/* Sidebar */}
        <div
          className="flex flex-col h-full shrink-0 overflow-y-auto"
          style={{
            width: 220,
            background: 'var(--color-surface)',
            borderRight: '1px solid var(--color-border)',
          }}
        >
          {/* Header */}
          <div className="flex items-center gap-2 px-4 py-3" style={{ borderBottom: '1px solid var(--color-border)' }}>
            <button
              onClick={close}
              className="flex items-center gap-1.5 px-2 py-1 rounded-lg text-xs font-semibold transition-all hover:opacity-80"
              style={{ color: 'var(--color-text-secondary)' }}
            >
              <ChevronLeft className="w-4 h-4" />
              Назад
            </button>
          </div>

          {/* Section list */}
          <div className="flex-1 p-2">
            {SECTIONS.map(s => {
              const Icon = s.icon;
              const isActive = active === s.id;
              return (
                <button
                  key={s.id}
                  onClick={() => { setActive(s.id); playClick(); }}
                  className="w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-xs font-semibold transition-all mb-0.5"
                  style={{
                    background: isActive ? 'var(--color-primary-dim)' : 'transparent',
                    color: isActive ? 'var(--color-primary)' : 'var(--color-text-secondary)',
                  }}
                >
                  <Icon className="w-4 h-4 shrink-0" />
                  {s.label}
                </button>
              );
            })}
          </div>
        </div>

        {/* Content area — placeholder for now, will be filled with actual sections */}
        <div className="flex-1 min-w-0 overflow-y-auto p-6">
          <div className="max-w-3xl mx-auto">
            <h1 className="text-lg font-bold mb-4" style={{ color: 'var(--color-text)' }}>
              {SECTIONS.find(s => s.id === active)?.label}
            </h1>
            <p className="text-sm" style={{ color: 'var(--color-text-secondary)' }}>
              Раздел в разработке. Скоро здесь будут все настройки.
            </p>
          </div>
        </div>
      </motion.div>
    </AnimatePresence>
  );
}

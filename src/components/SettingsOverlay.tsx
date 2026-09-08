import { useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import {
  User, Cpu, Palette, Gamepad2, Volume2, Globe, Code, Shield, X, ChevronLeft,
} from 'lucide-react';
import { useUiStore } from '@/stores/uiStore';
import { useThemeStore } from '@/stores/themeStore';
import { themes, type ThemeId } from '@/lib/theme-engine';
import { AccentColorPicker } from '@/components/AccentColorPicker';
import { STYLE_PRESETS } from '@/lib/style-presets';
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

const THEME_LIST: Array<{ id: ThemeId; name: string; preview: string }> = [
  { id: 'dark',  name: 'Dark',  preview: '#16161A' },
  { id: 'oled',  name: 'OLED',  preview: '#000000' },
  { id: 'light', name: 'Light', preview: '#FFFFFF' },
];

function AppearanceSection() {
  const { themeId, setTheme } = useThemeStore();
  const ui = useUiStore();

  return (
    <div className="space-y-6">
      <div>
        <p className="text-xs font-bold mb-3" style={{ color: 'var(--color-text)' }}>Тема</p>
        <div className="flex gap-2">
          {THEME_LIST.map(t => (
            <button
              key={t.id}
              onClick={() => { setTheme(t.id); playClick(); }}
              className="relative w-16 h-16 rounded-xl transition-all duration-150 overflow-hidden"
              style={{
                border: `2px solid ${themeId === t.id ? 'var(--color-primary)' : 'var(--color-border)'}`,
                boxShadow: themeId === t.id ? '0 0 0 1px var(--color-primary)' : 'none',
              }}
            >
              <div className="absolute inset-0" style={{ background: t.preview }} />
              <span className="absolute bottom-1 left-1 text-[9px] font-bold px-1 rounded"
                style={{ color: t.id === 'light' ? '#000' : '#fff', background: t.id === 'light' ? 'rgba(0,0,0,0.1)' : 'rgba(255,255,255,0.1)' }}>
                {t.name}
              </span>
            </button>
          ))}
        </div>
      </div>

      <AccentColorPicker />

      <div>
        <p className="text-xs font-bold mb-3" style={{ color: 'var(--color-text)' }}>Стиль интерфейса</p>
        <div className="grid grid-cols-2 gap-2">
          {STYLE_PRESETS.map(p => (
            <button
              key={p.id}
              onClick={() => { ui.set('stylePreset', p.id); playClick(); }}
              className="text-left p-3 rounded-xl transition-all duration-150"
              style={{
                background: ui.stylePreset === p.id ? 'var(--color-primary-dim)' : 'var(--color-surface-2)',
                border: `1px solid ${ui.stylePreset === p.id ? 'var(--color-primary)' : 'var(--color-border)'}`,
                color: 'var(--color-text)',
              }}
            >
              <p className="text-xs font-bold">{p.title}</p>
              <p className="text-[10px] mt-0.5" style={{ color: 'var(--color-text-secondary)' }}>{p.description}</p>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

function AccountSection() {
  return (
    <div className="space-y-4">
      <p className="text-xs" style={{ color: 'var(--color-text-secondary)' }}>
        Управляйте аккаунтами Microsoft, Ely.by и оффлайн-профилями.
      </p>
      <div className="space-y-2">
        {['Microsoft', 'Ely.by', 'По нику'].map(name => (
          <div key={name} className="flex items-center justify-between p-3 rounded-xl"
            style={{ background: 'var(--color-surface-2)', border: '1px solid var(--color-border)' }}>
            <span className="text-xs font-bold" style={{ color: 'var(--color-text)' }}>{name}</span>
            <button className="px-3 py-1.5 rounded-lg text-[10px] font-semibold transition-all duration-150"
              style={{ background: 'var(--color-primary)', color: '#fff' }}>
              Войти
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

function AboutSection() {
  return (
    <div className="space-y-3">
      <div className="p-4 rounded-xl" style={{ background: 'var(--color-surface-2)', border: '1px solid var(--color-border)' }}>
        <p className="text-sm font-bold" style={{ color: 'var(--color-text)' }}>Portal Launcher</p>
        <p className="text-[10px] mt-1" style={{ color: 'var(--color-text-secondary)' }}>Версия 1.0 · GPL-3.0</p>
      </div>
    </div>
  );
}

function PlaceholderSection({ title }: { title: string }) {
  return (
    <p className="text-xs" style={{ color: 'var(--color-text-secondary)' }}>
      Раздел «{title}» будет добавлен позже.
    </p>
  );
}

export function SettingsOverlay() {
  const ui = useUiStore();
  const [active, setActive] = useState<Section>((ui.settingsSection as Section) || 'appearance');

  const close = () => {
    playClick();
    ui.set('settingsOverlayOpen' as any, false);
  };

  if (!ui.settingsOverlayOpen) return null;

  const renderSection = () => {
    switch (active) {
      case 'appearance': return <AppearanceSection />;
      case 'account':    return <AccountSection />;
      case 'about':      return <AboutSection />;
      default:           return <PlaceholderSection title={SECTIONS.find(s => s.id === active)?.label || ''} />;
    }
  };

  return (
    <AnimatePresence>
      <motion.div
        data-portal-overlay="true"
        className="fixed inset-0 z-[200] flex"
        style={{ background: 'var(--color-bg)' }}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.15, ease: [0.23, 1, 0.32, 1] }}
      >
        {/* Sidebar */}
        <div
          className="flex flex-col h-full shrink-0 overflow-y-auto"
          style={{
            width: 200,
            background: 'var(--color-surface)',
            borderRight: '1px solid var(--color-border)',
          }}
        >
          <div className="flex items-center gap-2 px-3 py-3" style={{ borderBottom: '1px solid var(--color-border)' }}>
            <button
              onClick={close}
              className="flex items-center gap-1 px-2 py-1 rounded-lg text-xs font-semibold transition-all duration-150 hover:opacity-80"
              style={{ color: 'var(--color-text-secondary)' }}
            >
              <ChevronLeft className="w-3.5 h-3.5" />
              Назад
            </button>
          </div>

          <div className="flex-1 p-2 space-y-0.5">
            {SECTIONS.map(s => {
              const Icon = s.icon;
              const isActive = active === s.id;
              return (
                <button
                  key={s.id}
                  onClick={() => { setActive(s.id); playClick(); }}
                  className="w-full flex items-center gap-2 px-2.5 py-2 rounded-lg text-xs font-semibold transition-all duration-150"
                  style={{
                    background: isActive ? 'var(--color-primary-dim)' : 'transparent',
                    color: isActive ? 'var(--color-primary)' : 'var(--color-text-secondary)',
                  }}
                >
                  <Icon className="w-3.5 h-3.5 shrink-0" />
                  {s.label}
                </button>
              );
            })}
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 min-w-0 overflow-y-auto p-6">
          <div className="max-w-2xl mx-auto">
            <div className="flex items-center justify-between mb-4">
              <h1 className="text-base font-bold" style={{ color: 'var(--color-text)' }}>
                {SECTIONS.find(s => s.id === active)?.label}
              </h1>
              <button onClick={close} className="w-7 h-7 rounded-lg flex items-center justify-center transition-all duration-150 hover:opacity-70"
                style={{ color: 'var(--color-text-tertiary)' }}>
                <X className="w-4 h-4" />
              </button>
            </div>
            {renderSection()}
          </div>
        </div>
      </motion.div>
    </AnimatePresence>
  );
}

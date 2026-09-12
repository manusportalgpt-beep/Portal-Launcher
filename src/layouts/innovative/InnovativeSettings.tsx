import { useState } from 'react';
import { motion } from 'framer-motion';
import { useNavigate } from 'react-router-dom';
import { ChevronLeft, Monitor, Palette, Volume2, Globe, Shield, Cpu, Gamepad2, Sparkles, User } from 'lucide-react';
import { useLayoutStore } from '@/stores/layoutStore';
import { useThemeStore } from '@/stores/themeStore';
import { useUiStore } from '@/stores/uiStore';
import { useSettingsStore } from '@/stores/settingsStore';

const fadeUp = { hidden: { opacity: 0, y: 10 }, show: { opacity: 1, y: 0, transition: { duration: 0.3, ease: [0.22, 1, 0.36, 1] } } };

const SECTIONS = [
  { key: 'appearance', icon: Palette, label: 'Внешний вид', desc: 'Темы, цвета, эффекты' },
  { key: 'minecraft', icon: Cpu, label: 'Minecraft', desc: 'Java, память, версии' },
  { key: 'account', icon: User, label: 'Аккаунт', desc: 'Вход, профиль, скины' },
  { key: 'audio', icon: Volume2, label: 'Звук', desc: 'Музыка, уведомления' },
  { key: 'language', icon: Globe, label: 'Язык', desc: 'Интерфейс' },
  { key: 'advanced', icon: Shield, label: 'Дополнительно', desc: 'API ключи, пути' },
];

function SettingCard({ label, desc, children }: { label: string; desc?: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between rounded-xl p-4 transition-colors"
      style={{ background: 'var(--color-surface-2)', border: '1px solid var(--color-border)' }}>
      <div className="min-w-0 mr-4">
        <p className="text-[12px] font-semibold" style={{ color: 'var(--color-text)' }}>{label}</p>
        {desc && <p className="mt-0.5 text-[10px]" style={{ color: 'var(--color-text-tertiary)' }}>{desc}</p>}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}

function Toggle({ value, onChange }: { value: boolean; onChange: (v: boolean) => void }) {
  return (
    <button onClick={() => onChange(!value)} className="relative h-6 w-11 rounded-full transition-colors"
      style={{ background: value ? 'var(--color-primary)' : 'var(--color-surface)' }}>
      <motion.div className="absolute top-1 h-4 w-4 rounded-full bg-white shadow"
        animate={{ left: value ? 24 : 4 }}
        transition={{ type: 'spring', stiffness: 500, damping: 30 }} />
    </button>
  );
}

export function InnovativeSettings() {
  const navigate = useNavigate();
  const [section, setSection] = useState('appearance');
  const { mode, setMode } = useLayoutStore();
  const { themeId, setTheme, customThemes } = useThemeStore();
  const uiStore = useUiStore();
  const maxRam = useSettingsStore(s => s.maxRam);

  const themes = [
    { id: 'default', label: 'Portal Dark' },
    { id: 'clean', label: 'Clean Dark' },
    { id: 'amoled', label: 'AMOLED' },
    { id: 'custom-1', label: 'Кастомная тема' },
  ];

  return (
    <div className="flex h-full min-h-0">
      {/* section list */}
      <div className="w-56 shrink-0 overflow-auto p-4"
        style={{ borderRight: '1px solid var(--color-border)' }}>
        <button onClick={() => navigate(-1)} className="flex items-center gap-1.5 mb-4 text-[11px] font-semibold transition-colors hover:opacity-80"
          style={{ color: 'var(--color-text-secondary)' }}>
          <ChevronLeft size={14} /> Назад
        </button>
        <p className="mb-3 text-[10px] font-bold uppercase tracking-wider" style={{ color: 'var(--color-text-tertiary)' }}>
          Настройки
        </p>
        <div className="flex flex-col gap-0.5">
          {SECTIONS.map(s => {
            const I = s.icon;
            const active = section === s.key;
            return (
              <button key={s.key} onClick={() => setSection(s.key)}
                className="flex items-center gap-2.5 rounded-xl px-3 py-2.5 text-left transition-all"
                style={{ background: active ? 'color-mix(in srgb, var(--color-primary) 14%, transparent)' : 'transparent', color: active ? 'var(--color-primary)' : 'var(--color-text-secondary)' }}>
                <I size={16} strokeWidth={active ? 2 : 1.6} />
                <div className="min-w-0">
                  <p className="text-[11px] font-semibold">{s.label}</p>
                  <p className="text-[9px]" style={{ color: 'var(--color-text-tertiary)' }}>{s.desc}</p>
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {/* content */}
      <div className="flex-1 overflow-auto p-6">
        <motion.div key={section} variants={fadeUp} initial="hidden" animate="show" className="max-w-lg">
          {section === 'appearance' && (
            <>
              <h2 className="text-lg font-extrabold mb-4" style={{ color: 'var(--color-text)' }}>Внешний вид</h2>

              {/* layout mode */}
              <p className="mb-2 text-[10px] font-bold uppercase tracking-wider" style={{ color: 'var(--color-text-tertiary)' }}>
                Режим интерфейса
              </p>
              <div className="grid grid-cols-3 gap-2 mb-5">
                {([
                  { value: 'standard', label: 'Стандарт', desc: 'Текущий интерфейс' },
                  { value: 'innovative', label: 'Инновация', desc: 'Новый дизайн' },
                  { value: 'extended', label: 'Расширенный', desc: 'Кастомизация' },
                ] as const).map(opt => (
                  <button key={opt.value} onClick={() => {
                    setMode(opt.value);
                    if (opt.value === 'extended') window.location.hash = '#/settings/extended';
                  }}
                    className="rounded-xl p-3 text-left transition-all"
                    style={{
                      background: mode === opt.value ? 'color-mix(in srgb, var(--color-primary) 16%, var(--color-surface))' : 'var(--color-surface)',
                      border: `1.5px solid ${mode === opt.value ? 'var(--color-primary)' : 'var(--color-border)'}`,
                    }}>
                    <p className="text-[11px] font-bold" style={{ color: mode === opt.value ? 'var(--color-primary)' : 'var(--color-text)' }}>
                      {opt.label}
                    </p>
                    <p className="text-[9px] mt-0.5" style={{ color: 'var(--color-text-tertiary)' }}>{opt.desc}</p>
                  </button>
                ))}
              </div>

              {/* themes */}
              <p className="mb-2 text-[10px] font-bold uppercase tracking-wider" style={{ color: 'var(--color-text-tertiary)' }}>
                Тема
              </p>
              <div className="flex flex-col gap-1.5 mb-5">
                {themes.map(t => (
                  <SettingCard key={t.id} label={t.label} desc={themeId === t.id ? 'Активна' : undefined}>
                    <Toggle value={themeId === t.id} onChange={() => setTheme(t.id)} />
                  </SettingCard>
                ))}
              </div>

              {/* other appearance */}
              <p className="mb-2 text-[10px] font-bold uppercase tracking-wider" style={{ color: 'var(--color-text-tertiary)' }}>
                Эффекты
              </p>
              <div className="flex flex-col gap-1.5">
                <SettingCard label="Фоновое видео" desc="Анимированный фон на главном экране">
                  <Toggle value={!!uiStore.backgroundImage} onChange={() => uiStore.set('backgroundImage', uiStore.backgroundImage ? '' : '/backgrounds/default.mp4')} />
                </SettingCard>
                <SettingCard label="Прозрачность интерфейса" desc="Эффект стекла на панелях">
                  <Toggle value={true} onChange={() => {}} />
                </SettingCard>
              </div>
            </>
          )}

          {section === 'minecraft' && (
            <>
              <h2 className="text-lg font-extrabold mb-4" style={{ color: 'var(--color-text)' }}>Minecraft</h2>
              <div className="flex flex-col gap-1.5">
                <SettingCard label="Выделение памяти" desc={`${maxRam || 4096} МБ`}>
                  <span className="text-[11px] font-bold" style={{ color: 'var(--color-primary)' }}>{maxRam || 4096} МБ</span>
                </SettingCard>
                <SettingCard label="Java" desc="Путь к Java">
                  <span className="text-[10px]" style={{ color: 'var(--color-text-secondary)' }}>Авто</span>
                </SettingCard>
                <SettingCard label="Обновлять автоматически" desc="Проверять версии при запуске">
                  <Toggle value={true} onChange={() => {}} />
                </SettingCard>
              </div>
            </>
          )}

          {section === 'account' && (
            <>
              <h2 className="text-lg font-extrabold mb-4" style={{ color: 'var(--color-text)' }}>Аккаунт</h2>
              <div className="flex flex-col gap-1.5">
                <SettingCard label="Текущий аккаунт" desc="Microsoft, Ely.by или Offline">
                  <button className="rounded-lg px-3 py-1.5 text-[11px] font-bold"
                    style={{ background: 'var(--color-primary)', color: '#fff' }}>
                    Настроить
                  </button>
                </SettingCard>
                <SettingCard label="Переключить аккаунт" desc="Быстрое переключение между профилями">
                  <button className="rounded-lg px-3 py-1.5 text-[11px] font-semibold"
                    style={{ background: 'var(--color-surface)', color: 'var(--color-text-secondary)', border: '1px solid var(--color-border)' }}>
                    Переключить
                  </button>
                </SettingCard>
              </div>
            </>
          )}

          {(section === 'audio' || section === 'language' || section === 'advanced') && (
            <>
              <h2 className="text-lg font-extrabold mb-4" style={{ color: 'var(--color-text)' }}>
                {SECTIONS.find(s => s.key === section)?.label}
              </h2>
              <p className="text-[11px]" style={{ color: 'var(--color-text-secondary)' }}>
                Раздел в разработке. Все настройки доступны в стандартном режиме.
              </p>
            </>
          )}
        </motion.div>
      </div>
    </div>
  );
}

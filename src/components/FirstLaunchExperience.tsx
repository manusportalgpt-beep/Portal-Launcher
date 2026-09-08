import { useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import {
  ArrowRight, Check, Compass, Globe, Shield, Sparkles, Palette, X, Package,
  ShieldCheck, Skull, Bug, Rocket,
} from 'lucide-react';
import { useLanguageStore, type Lang } from '@/stores/languageStore';
import { useUiStore } from '@/stores/uiStore';
import { useThemeStore } from '@/stores/themeStore';
import { type ThemeId } from '@/lib/theme-engine';
import { STYLE_PRESETS, type StylePreset } from '@/lib/style-presets';
import { MicrosoftAuthOAuth } from '@/components/auth/MicrosoftAuthOAuth';

const SETUP_KEY = 'portal-first-launch-complete-v1';

const THEME_CHOICES: Array<{ id: ThemeId; label: string; preview: string }> = [
  { id: 'dark', label: 'Тёмная', preview: 'linear-gradient(135deg, #0D1117, #1C2333)' },
  { id: 'system', label: 'Системная', preview: 'linear-gradient(135deg, #0D1117 50%, #FFFFFF 50%)' },
  { id: 'monochrome', label: 'Монохром', preview: 'linear-gradient(135deg, #0A0A0A, #282828)' },
  { id: 'purple-dark', label: 'Тёмный фиолетовый', preview: 'linear-gradient(135deg, #080612, #1F183D)' },
  { id: 'redstone', label: 'RedStone', preview: 'linear-gradient(135deg, #080000, #280707)' },
  { id: 'ocean', label: 'Океан', preview: 'linear-gradient(135deg, #06131C, #16495B)' },
];

const STYLE_THEME: Record<StylePreset, ThemeId> = {
  standard: 'dark', glass: 'dark', quadral: 'monochrome', falloff: 'purple-dark', abouts: 'system',
};

const INSTALL_CONFIRMATIONS: Array<{ question: string; yesLabel: string; noLabel: string }> = [
  { question: 'Вы хотите установить Portal Launcher?', yesLabel: 'Да', noLabel: 'Нет' },
  { question: 'Вы уверены?', yesLabel: 'Да', noLabel: 'Нет' },
  { question: 'Вы точно уверены?', yesLabel: 'Да', noLabel: 'Нет' },
  { question: 'Вы абсолютно уверены?', yesLabel: 'Да', noLabel: 'Нет' },
  { question: 'Серьёзно? Вы хотите установить лаунчер?', yesLabel: 'Да', noLabel: 'Нет' },
  { question: 'А вдруг он вирусы?', yesLabel: 'Нет вирусов', noLabel: 'Страшно' },
  { question: 'Ну ладно... Вы точно хотите?', yesLabel: 'ДА', noLabel: 'Хз' },
  { question: 'Вы понимаете что это лаунчер для Minecraft?', yesLabel: 'Да', noLabel: 'А?' },
  { question: 'В последний раз спрашиваю...', yesLabel: 'Ставь уже', noLabel: 'Нет' },
  { question: 'Хорошо, устанавливаю! (на самом деле ещё нет)', yesLabel: 'ВПЕРЁД', noLabel: 'Подожди' },
];

function LanguageStep({ onNext }: { onNext: () => void }) {
  const { lang, setLang } = useLanguageStore();
  const [selected, setSelected] = useState<Lang>(lang);

  const apply = () => {
    setLang(selected);
    onNext();
  };

  return (
    <div className="flex flex-col items-center text-center max-w-md mx-auto">
      <div className="w-16 h-16 rounded-2xl flex items-center justify-center mb-6"
        style={{ background: 'var(--color-primary-dim)', color: 'var(--color-primary)' }}>
        <Globe className="h-8 w-8" />
      </div>
      <h1 className="text-2xl font-black tracking-tight">Выберите язык</h1>
      <p className="mt-2 text-sm" style={{ color: 'var(--color-text-secondary)' }}>
        Выберите язык интерфейса. Это можно изменить позже в настройках.
      </p>
      <div className="mt-6 flex gap-3">
        {(['ru', 'en'] as Lang[]).map(l => (
          <button key={l} onClick={() => setSelected(l)}
            className="px-6 py-3 text-sm font-bold transition-all"
            style={{
              borderRadius: 'var(--radius-button)',
              background: selected === l ? 'var(--color-primary)' : 'var(--color-surface)',
              color: selected === l ? 'var(--color-primary-text)' : 'var(--color-text)',
              border: `1px solid ${selected === l ? 'var(--color-primary)' : 'var(--color-border)'}`,
            }}>
            {l === 'ru' ? 'Русский' : 'English'}
          </button>
        ))}
      </div>
    </div>
  );
}

function StyleStep({ onNext }: { onNext: () => void }) {
  const ui = useUiStore();
  const { themeId, setTheme } = useThemeStore();
  const [selectedStyle, setSelectedStyle] = useState<StylePreset>(ui.stylePreset);
  const [selectedTheme, setSelectedTheme] = useState<ThemeId>(themeId);

  const apply = () => {
    ui.set('stylePreset', selectedStyle);
    setTheme(selectedTheme);
    onNext();
  };

  return (
    <div className="flex flex-col items-center text-center max-w-2xl mx-auto">
      <div className="w-16 h-16 rounded-2xl flex items-center justify-center mb-6"
        style={{ background: 'var(--color-primary-dim)', color: 'var(--color-primary)' }}>
        <Palette className="h-8 w-8" />
      </div>
      <h1 className="text-2xl font-black tracking-tight">Стиль и оформление</h1>
      <p className="mt-2 text-sm" style={{ color: 'var(--color-text-secondary)' }}>
        Выберите форму интерфейса и цветовую палитру. Всё можно изменить в настройках.
      </p>

      <div className="mt-6 grid grid-cols-2 sm:grid-cols-3 gap-2 w-full">
        {STYLE_PRESETS.map(preset => (
          <button key={preset.id} onClick={() => {
            setSelectedStyle(preset.id);
            setSelectedTheme(STYLE_THEME[preset.id]);
          }}
            className="p-3 text-left transition-all"
            style={{
              borderRadius: 'var(--radius-card)',
              background: selectedStyle === preset.id ? 'var(--color-primary-dim)' : 'var(--color-surface)',
              border: `1px solid ${selectedStyle === preset.id ? 'var(--color-primary)' : 'var(--color-border)'}`,
            }}>
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold">{preset.title}</span>
              {selectedStyle === preset.id && <Check className="h-3.5 w-3.5" style={{ color: 'var(--color-primary)' }} />}
            </div>
            <p className="mt-1 text-[10px] leading-relaxed" style={{ color: 'var(--color-text-secondary)' }}>
              {preset.description}
            </p>
          </button>
        ))}
      </div>

      <div className="mt-4 w-full">
        <p className="text-xs font-bold mb-2" style={{ color: 'var(--color-text-secondary)' }}>Тема</p>
        <div className="flex gap-2 flex-wrap justify-center">
          {THEME_CHOICES.map(t => (
            <button key={t.id} onClick={() => setSelectedTheme(t.id)}
              className="w-12 h-12 overflow-hidden transition-all"
              style={{
                borderRadius: 'var(--radius-button)',
                border: `2px solid ${selectedTheme === t.id ? 'var(--color-primary)' : 'var(--color-border)'}`,
                background: t.preview,
              }}
              title={t.label} />
          ))}
        </div>
      </div>

      <button onClick={apply} className="mt-6 inline-flex items-center gap-2 px-5 py-2.5 text-sm font-bold"
        style={{ background: 'var(--color-primary)', color: 'var(--color-primary-text)', borderRadius: 'var(--radius-button)' }}>
        Применить <ArrowRight className="h-4 w-4" />
      </button>
    </div>
  );
}

function SecurityStep({ onNext }: { onNext: () => void }) {
  const items = [
    { icon: ShieldCheck, text: 'Лицензия GPL-3.0 на GitHub — весь код открыт', color: 'var(--color-success)' },
    { icon: X, text: 'Без установки Яндекс Браузера', color: 'var(--color-text-secondary)' },
    { icon: Skull, text: 'Без скачивания MAX — не ловит даже на парковке', color: 'var(--color-text-secondary)' },
    { icon: Bug, text: 'Без 360 Total Security и прочего мусора', color: 'var(--color-text-secondary)' },
  ];

  return (
    <div className="flex flex-col items-center text-center max-w-md mx-auto">
      <div className="w-16 h-16 rounded-2xl flex items-center justify-center mb-6"
        style={{ background: 'var(--color-primary-dim)', color: 'var(--color-primary)' }}>
        <Shield className="h-8 w-8" />
      </div>
      <h1 className="text-2xl font-black tracking-tight">Безопасность</h1>
      <p className="mt-2 text-sm" style={{ color: 'var(--color-text-secondary)' }}>
        Мы не устанавливаем мусор. Код лаунчера полностью открыт.
      </p>
      <div className="mt-6 space-y-3 w-full text-left">
        {items.map((item, i) => (
          <div key={i} className="flex items-center gap-3 p-3"
            style={{ borderRadius: 'var(--radius-card)', background: 'var(--color-surface)', border: '1px solid var(--color-border)' }}>
            <item.icon className="h-5 w-5 shrink-0" style={{ color: item.color }} />
            <span className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>{item.text}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function AccountStep({ onNext }: { onNext: () => void }) {
  return (
    <div className="flex flex-col items-center text-center max-w-md mx-auto">
      <div className="w-16 h-16 rounded-2xl flex items-center justify-center mb-6"
        style={{ background: 'var(--color-primary-dim)', color: 'var(--color-primary)' }}>
        <Sparkles className="h-8 w-8" />
      </div>
      <h1 className="text-2xl font-black tracking-tight">Войдите в аккаунт</h1>
      <p className="mt-2 text-sm" style={{ color: 'var(--color-text-secondary)' }}>
        Выберите способ входа. Можно пропустить и добавить позже в настройках.
      </p>
      <div className="mt-6 w-full" style={{ borderRadius: 'var(--radius-card)', border: '1px solid var(--color-border)', padding: 16 }}>
        <MicrosoftAuthOAuth onSuccess={onNext} />
      </div>
    </div>
  );
}

function InstallStep({ onComplete }: { onComplete: () => void }) {
  const [confirmStage, setConfirmStage] = useState(-1);
  const [installed, setInstalled] = useState(false);

  if (installed) {
    return (
      <div className="flex flex-col items-center text-center max-w-md mx-auto">
        <motion.div initial={{ scale: 0.8, opacity: 0 }} animate={{ scale: 1, opacity: 1 }}
          transition={{ type: 'spring', stiffness: 300, damping: 20 }}
          className="w-20 h-20 rounded-2xl flex items-center justify-center mb-6"
          style={{ background: 'var(--color-success)', color: '#fff' }}>
          <Check className="h-10 w-10" />
        </motion.div>
        <h1 className="text-2xl font-black tracking-tight">Готово!</h1>
        <p className="mt-2 text-sm" style={{ color: 'var(--color-text-secondary)' }}>
          Portal Launcher успешно установлен. Наслаждайтесь!
        </p>
        <button onClick={onComplete} className="mt-6 inline-flex items-center gap-2 px-5 py-2.5 text-sm font-bold"
          style={{ background: 'var(--color-primary)', color: 'var(--color-primary-text)', borderRadius: 'var(--radius-button)' }}>
          Начать <Rocket className="h-4 w-4" />
        </button>
      </div>
    );
  }

  if (confirmStage >= 0 && confirmStage < INSTALL_CONFIRMATIONS.length) {
    const c = INSTALL_CONFIRMATIONS[confirmStage];
    return (
      <div className="flex flex-col items-center text-center max-w-md mx-auto">
        <div className="w-16 h-16 rounded-2xl flex items-center justify-center mb-6"
          style={{ background: 'var(--color-warning)', color: '#000' }}>
          <Package className="h-8 w-8" />
        </div>
        <h1 className="text-xl font-black tracking-tight">{c.question}</h1>
        <p className="mt-2 text-xs" style={{ color: 'var(--color-text-tertiary)' }}>
          {confirmStage + 1} из {INSTALL_CONFIRMATIONS.length}
        </p>
        <div className="mt-6 flex gap-3">
          <button onClick={() => setConfirmStage(prev => prev + 1)}
            className="px-6 py-3 text-sm font-bold"
            style={{ background: 'var(--color-primary)', color: 'var(--color-primary-text)', borderRadius: 'var(--radius-button)' }}>
            {c.yesLabel}
          </button>
          <button onClick={() => {
            if (confirmStage >= INSTALL_CONFIRMATIONS.length - 1) setInstalled(true);
            else setConfirmStage(prev => prev + 1);
          }}
            className="px-6 py-3 text-sm font-bold"
            style={{ background: 'var(--color-surface)', color: 'var(--color-text)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-button)' }}>
            {c.noLabel}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center text-center max-w-md mx-auto">
      <div className="w-16 h-16 rounded-2xl flex items-center justify-center mb-6"
        style={{ background: 'var(--color-primary-dim)', color: 'var(--color-primary)' }}>
        <Package className="h-8 w-8" />
      </div>
      <h1 className="text-2xl font-black tracking-tight">Установка</h1>
      <p className="mt-2 text-sm" style={{ color: 'var(--color-text-secondary)' }}>
        Размер лаунчера: ~16 МБ. Установка займёт несколько секунд.
      </p>
      <div className="mt-4 p-4 w-full text-left"
        style={{ borderRadius: 'var(--radius-card)', background: 'var(--color-surface)', border: '1px solid var(--color-border)' }}>
        <div className="flex items-center justify-between text-xs">
          <span style={{ color: 'var(--color-text-secondary)' }}>Размер</span>
          <span className="font-bold" style={{ color: 'var(--color-text)' }}>~16 МБ</span>
        </div>
        <div className="flex items-center justify-between text-xs mt-2">
          <span style={{ color: 'var(--color-text-secondary)' }}>Лицензия</span>
          <span className="font-bold" style={{ color: 'var(--color-text)' }}>GPL-3.0</span>
        </div>
      </div>
      <button onClick={() => setConfirmStage(0)} className="mt-6 inline-flex items-center gap-2 px-5 py-2.5 text-sm font-bold"
        style={{ background: 'var(--color-primary)', color: 'var(--color-primary-text)', borderRadius: 'var(--radius-button)' }}>
        Установить <ArrowRight className="h-4 w-4" />
      </button>
    </div>
  );
}

export function FirstLaunchExperience() {
  const [step, setStep] = useState(0);
  const [dismissed, setDismissed] = useState(() => {
    // Check all possible keys from older versions
    return localStorage.getItem(SETUP_KEY) === '1'
      || localStorage.getItem('portal-first-launch-complete') === '1'
      || localStorage.getItem('portal-onboarding-done') === '1';
  });

  const finishSetup = () => {
    localStorage.setItem(SETUP_KEY, '1');
    setDismissed(true);
  };

  if (dismissed) return null;

  const steps = [
    <LanguageStep onNext={() => setStep(1)} />,
    <StyleStep onNext={() => setStep(2)} />,
    <SecurityStep onNext={() => setStep(3)} />,
    <AccountStep onNext={() => setStep(4)} />,
    <InstallStep onComplete={finishSetup} />,
  ];

  return (
    <AnimatePresence>
      <motion.div className="fixed inset-0 z-[300] flex flex-col"
        style={{ background: 'var(--color-bg)' }}
        initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
        {/* Title bar */}
        <div className="flex items-center justify-between px-4 py-2"
          style={{ borderBottom: '1px solid var(--color-border)', height: 'var(--titlebar-height, 32px)' }}>
          <div className="flex items-center gap-2">
            <img src="/launcher-icon.png" alt="" className="w-5 h-5 rounded" draggable={false} />
            <span className="text-xs font-bold" style={{ color: 'var(--color-text-secondary)' }}>Portal Launcher — Первый запуск</span>
          </div>
          <button onClick={finishSetup} className="p-1 rounded hover:bg-white/5" title="Пропустить">
            <X className="h-4 w-4" style={{ color: 'var(--color-text-tertiary)' }} />
          </button>
        </div>

        {/* Progress dots */}
        <div className="flex items-center justify-center gap-2 py-4">
          {steps.map((_, i) => (
            <div key={i} className="h-1.5 transition-all"
              style={{
                width: i === step ? 24 : 8,
                borderRadius: 9999,
                background: i <= step ? 'var(--color-primary)' : 'var(--color-border)',
              }} />
          ))}
        </div>

        {/* Step content */}
        <div className="flex-1 flex items-center justify-center px-6 overflow-y-auto">
          <AnimatePresence mode="wait">
            <motion.div key={step}
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -12 }}
              transition={{ duration: 0.18 }}
              className="w-full py-8">
              {steps[step]}
            </motion.div>
          </AnimatePresence>
        </div>

        {/* Skip button */}
        <div className="flex items-center justify-between px-6 py-4"
          style={{ borderTop: '1px solid var(--color-border)' }}>
          <button onClick={() => step > 0 && setStep(s => s - 1)}
            className="px-3 py-2 text-xs font-bold disabled:opacity-0"
            style={{ color: 'var(--color-text-secondary)' }}
            disabled={step === 0}>
            Назад
          </button>
          {step < steps.length - 1 && (
            <button onClick={() => setStep(s => s + 1)}
              className="px-3 py-2 text-xs font-bold"
              style={{ color: 'var(--color-text-secondary)' }}>
              Далее
            </button>
          )}
        </div>
      </motion.div>
    </AnimatePresence>
  );
}

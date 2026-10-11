import { useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { DotField } from '@/components/effects/DotField';
import {
  ArrowRight, Check, Compass, Globe, Shield, Sparkles, Palette, X, Package,
  ShieldCheck, Skull, Bug, Rocket,
} from 'lucide-react';
import { useLanguageStore, type Lang } from '@/stores/languageStore';
import { useUiStore } from '@/stores/uiStore';
import { useThemeStore } from '@/stores/themeStore';
import { type ThemeId } from '@/lib/theme-engine';
import { STYLE_PRESETS, type StylePreset } from '@/lib/style-presets';
import { MicrosoftAuthChoice } from '@/components/auth/MicrosoftAuthChoice';

const SETUP_KEY = 'portal-first-launch-complete-v1';

const THEME_CHOICES: Array<{ id: ThemeId; label: string; preview: string }> = [
  { id: 'dark', label: '╨в╤С╨╝╨╜╨░╤П', preview: 'linear-gradient(135deg, #16161A, #26262C)' },
  { id: 'oled', label: 'OLED', preview: 'linear-gradient(135deg, #000000, #141414)' },
];

const STYLE_THEME: Record<StylePreset, ThemeId> = {
  oreui: 'dark', standard: 'dark', glass: 'dark', quadral: 'dark', falloff: 'oled', abouts: 'dark',
};

const INSTALL_CONFIRMATIONS: Array<{ question: string; yesLabel: string; noLabel: string }> = [
  { question: '╨Т╤Л ╤Е╨╛╤В╨╕╤В╨╡ ╤Г╤Б╤В╨░╨╜╨╛╨▓╨╕╤В╤М Portal Launcher?', yesLabel: '╨Ф╨░', noLabel: '╨Э╨╡╤В' },
  { question: '╨Т╤Л ╤Г╨▓╨╡╤А╨╡╨╜╤Л?', yesLabel: '╨Ф╨░', noLabel: '╨Э╨╡╤В' },
  { question: '╨Т╤Л ╤В╨╛╤З╨╜╨╛ ╤Г╨▓╨╡╤А╨╡╨╜╤Л?', yesLabel: '╨Ф╨░', noLabel: '╨Э╨╡╤В' },
  { question: '╨Т╤Л ╨░╨▒╤Б╨╛╨╗╤О╤В╨╜╨╛ ╤Г╨▓╨╡╤А╨╡╨╜╤Л?', yesLabel: '╨Ф╨░', noLabel: '╨Э╨╡╤В' },
  { question: '╨б╨╡╤А╤М╤С╨╖╨╜╨╛? ╨Т╤Л ╤Е╨╛╤В╨╕╤В╨╡ ╤Г╤Б╤В╨░╨╜╨╛╨▓╨╕╤В╤М ╨╗╨░╤Г╨╜╤З╨╡╤А?', yesLabel: '╨Ф╨░', noLabel: '╨Э╨╡╤В' },
  { question: '╨Р ╨▓╨┤╤А╤Г╨│ ╨╛╨╜ ╨▓╨╕╤А╤Г╤Б╤Л?', yesLabel: '╨Э╨╡╤В ╨▓╨╕╤А╤Г╤Б╨╛╨▓', noLabel: '╨б╤В╤А╨░╤И╨╜╨╛' },
  { question: '╨Э╤Г ╨╗╨░╨┤╨╜╨╛... ╨Т╤Л ╤В╨╛╤З╨╜╨╛ ╤Е╨╛╤В╨╕╤В╨╡?', yesLabel: '╨Ф╨Р', noLabel: '╨е╨╖' },
  { question: '╨Т╤Л ╨┐╨╛╨╜╨╕╨╝╨░╨╡╤В╨╡ ╤З╤В╨╛ ╤Н╤В╨╛ ╨╗╨░╤Г╨╜╤З╨╡╤А ╨┤╨╗╤П Minecraft?', yesLabel: '╨Ф╨░', noLabel: '╨Р?' },
  { question: '╨Т ╨┐╨╛╤Б╨╗╨╡╨┤╨╜╨╕╨╣ ╤А╨░╨╖ ╤Б╨┐╤А╨░╤И╨╕╨▓╨░╤О...', yesLabel: '╨б╤В╨░╨▓╤М ╤Г╨╢╨╡', noLabel: '╨Э╨╡╤В' },
  { question: '╨е╨╛╤А╨╛╤И╨╛, ╤Г╤Б╤В╨░╨╜╨░╨▓╨╗╨╕╨▓╨░╤О! (╨╜╨░ ╤Б╨░╨╝╨╛╨╝ ╨┤╨╡╨╗╨╡ ╨╡╤Й╤С ╨╜╨╡╤В)', yesLabel: '╨Т╨Я╨Х╨а╨Б╨Ф', noLabel: '╨Я╨╛╨┤╨╛╨╢╨┤╨╕' },
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
      <h1 className="text-2xl font-black tracking-tight">╨Т╤Л╨▒╨╡╤А╨╕╤В╨╡ ╤П╨╖╤Л╨║</h1>
      <p className="mt-2 text-sm" style={{ color: 'var(--color-text-secondary)' }}>
        ╨Т╤Л╨▒╨╡╤А╨╕╤В╨╡ ╤П╨╖╤Л╨║ ╨╕╨╜╤В╨╡╤А╤Д╨╡╨╣╤Б╨░. ╨н╤В╨╛ ╨╝╨╛╨╢╨╜╨╛ ╨╕╨╖╨╝╨╡╨╜╨╕╤В╤М ╨┐╨╛╨╖╨╢╨╡ ╨▓ ╨╜╨░╤Б╤В╤А╨╛╨╣╨║╨░╤Е.
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
            {l === 'ru' ? '╨а╤Г╤Б╤Б╨║╨╕╨╣' : 'English'}
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
      <h1 className="text-2xl font-black tracking-tight">╨б╤В╨╕╨╗╤М ╨╕ ╨╛╤Д╨╛╤А╨╝╨╗╨╡╨╜╨╕╨╡</h1>
      <p className="mt-2 text-sm" style={{ color: 'var(--color-text-secondary)' }}>
        ╨Т╤Л╨▒╨╡╤А╨╕╤В╨╡ ╤Д╨╛╤А╨╝╤Г ╨╕╨╜╤В╨╡╤А╤Д╨╡╨╣╤Б╨░ ╨╕ ╤Ж╨▓╨╡╤В╨╛╨▓╤Г╤О ╨┐╨░╨╗╨╕╤В╤А╤Г. ╨Т╤Б╤С ╨╝╨╛╨╢╨╜╨╛ ╨╕╨╖╨╝╨╡╨╜╨╕╤В╤М ╨▓ ╨╜╨░╤Б╤В╤А╨╛╨╣╨║╨░╤Е.
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
        <p className="text-xs font-bold mb-2" style={{ color: 'var(--color-text-secondary)' }}>╨в╨╡╨╝╨░</p>
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
        ╨Я╤А╨╕╨╝╨╡╨╜╨╕╤В╤М <ArrowRight className="h-4 w-4" />
      </button>
    </div>
  );
}

function SecurityStep({ onNext }: { onNext: () => void }) {
  const items = [
    { icon: ShieldCheck, text: '╨Ы╨╕╤Ж╨╡╨╜╨╖╨╕╤П GPL-3.0 ╨╜╨░ GitHub тАФ ╨▓╨╡╤Б╤М ╨║╨╛╨┤ ╨╛╤В╨║╤А╤Л╤В', color: 'var(--color-success)' },
    { icon: X, text: '╨С╨╡╨╖ ╤Г╤Б╤В╨░╨╜╨╛╨▓╨║╨╕ ╨п╨╜╨┤╨╡╨║╤Б ╨С╤А╨░╤Г╨╖╨╡╤А╨░', color: 'var(--color-text-secondary)' },
    { icon: Skull, text: '╨С╨╡╨╖ ╤Б╨║╨░╤З╨╕╨▓╨░╨╜╨╕╤П MAX тАФ ╨╜╨╡ ╨╗╨╛╨▓╨╕╤В ╨┤╨░╨╢╨╡ ╨╜╨░ ╨┐╨░╤А╨║╨╛╨▓╨║╨╡', color: 'var(--color-text-secondary)' },
    { icon: Bug, text: '╨С╨╡╨╖ 360 Total Security ╨╕ ╨┐╤А╨╛╤З╨╡╨│╨╛ ╨╝╤Г╤Б╨╛╤А╨░', color: 'var(--color-text-secondary)' },
  ];

  return (
    <div className="flex flex-col items-center text-center max-w-md mx-auto">
      <div className="w-16 h-16 rounded-2xl flex items-center justify-center mb-6"
        style={{ background: 'var(--color-primary-dim)', color: 'var(--color-primary)' }}>
        <Shield className="h-8 w-8" />
      </div>
      <h1 className="text-2xl font-black tracking-tight">╨С╨╡╨╖╨╛╨┐╨░╤Б╨╜╨╛╤Б╤В╤М</h1>
      <p className="mt-2 text-sm" style={{ color: 'var(--color-text-secondary)' }}>
        ╨Ь╤Л ╨╜╨╡ ╤Г╤Б╤В╨░╨╜╨░╨▓╨╗╨╕╨▓╨░╨╡╨╝ ╨╝╤Г╤Б╨╛╤А. ╨Ъ╨╛╨┤ ╨╗╨░╤Г╨╜╤З╨╡╤А╨░ ╨┐╨╛╨╗╨╜╨╛╤Б╤В╤М╤О ╨╛╤В╨║╤А╤Л╤В.
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
      <h1 className="text-2xl font-black tracking-tight">╨Т╨╛╨╣╨┤╨╕╤В╨╡ ╨▓ ╨░╨║╨║╨░╤Г╨╜╤В</h1>
      <p className="mt-2 text-sm" style={{ color: 'var(--color-text-secondary)' }}>
        ╨Т╤Л╨▒╨╡╤А╨╕╤В╨╡ ╤Б╨┐╨╛╤Б╨╛╨▒ ╨▓╤Е╨╛╨┤╨░. ╨Ь╨╛╨╢╨╜╨╛ ╨┐╤А╨╛╨┐╤Г╤Б╤В╨╕╤В╤М ╨╕ ╨┤╨╛╨▒╨░╨▓╨╕╤В╤М ╨┐╨╛╨╖╨╢╨╡ ╨▓ ╨╜╨░╤Б╤В╤А╨╛╨╣╨║╨░╤Е.
      </p>
      <div className="mt-6 w-full" style={{ borderRadius: 'var(--radius-card)', border: '1px solid var(--color-border)', padding: 16 }}>
        <MicrosoftAuthChoice onSuccess={onNext} />
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
        <h1 className="text-2xl font-black tracking-tight">╨У╨╛╤В╨╛╨▓╨╛!</h1>
        <p className="mt-2 text-sm" style={{ color: 'var(--color-text-secondary)' }}>
          Portal Launcher ╤Г╤Б╨┐╨╡╤И╨╜╨╛ ╤Г╤Б╤В╨░╨╜╨╛╨▓╨╗╨╡╨╜. ╨Э╨░╤Б╨╗╨░╨╢╨┤╨░╨╣╤В╨╡╤Б╤М!
        </p>
        <button onClick={onComplete} className="mt-6 inline-flex items-center gap-2 px-5 py-2.5 text-sm font-bold"
          style={{ background: 'var(--color-primary)', color: 'var(--color-primary-text)', borderRadius: 'var(--radius-button)' }}>
          ╨Э╨░╤З╨░╤В╤М <Rocket className="h-4 w-4" />
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
          {confirmStage + 1} ╨╕╨╖ {INSTALL_CONFIRMATIONS.length}
        </p>
        <div className="mt-6 flex gap-3">
          <button onClick={() => {
            if (confirmStage >= INSTALL_CONFIRMATIONS.length - 1) {
              onComplete();
            } else {
              setConfirmStage(prev => prev + 1);
            }
          }}
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
      <h1 className="text-2xl font-black tracking-tight">╨г╤Б╤В╨░╨╜╨╛╨▓╨║╨░</h1>
      <p className="mt-2 text-sm" style={{ color: 'var(--color-text-secondary)' }}>
        ╨а╨░╨╖╨╝╨╡╤А ╨╗╨░╤Г╨╜╤З╨╡╤А╨░: ~16 ╨Ь╨С. ╨г╤Б╤В╨░╨╜╨╛╨▓╨║╨░ ╨╖╨░╨╣╨╝╤С╤В ╨╜╨╡╤Б╨║╨╛╨╗╤М╨║╨╛ ╤Б╨╡╨║╤Г╨╜╨┤.
      </p>
      <div className="mt-4 p-4 w-full text-left"
        style={{ borderRadius: 'var(--radius-card)', background: 'var(--color-surface)', border: '1px solid var(--color-border)' }}>
        <div className="flex items-center justify-between text-xs">
          <span style={{ color: 'var(--color-text-secondary)' }}>╨а╨░╨╖╨╝╨╡╤А</span>
          <span className="font-bold" style={{ color: 'var(--color-text)' }}>~16 ╨Ь╨С</span>
        </div>
        <div className="flex items-center justify-between text-xs mt-2">
          <span style={{ color: 'var(--color-text-secondary)' }}>╨Ы╨╕╤Ж╨╡╨╜╨╖╨╕╤П</span>
          <span className="font-bold" style={{ color: 'var(--color-text)' }}>GPL-3.0</span>
        </div>
      </div>
      <button onClick={() => setConfirmStage(0)} className="mt-6 inline-flex items-center gap-2 px-5 py-2.5 text-sm font-bold"
        style={{ background: 'var(--color-primary)', color: 'var(--color-primary-text)', borderRadius: 'var(--radius-button)' }}>
        ╨г╤Б╤В╨░╨╜╨╛╨▓╨╕╤В╤М <ArrowRight className="h-4 w-4" />
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
        style={{
          background: '#0b0b0d',
          ['--color-bg' as string]: '#0b0b0d',
          ['--color-surface' as string]: '#0e0e12',
          ['--color-surface-2' as string]: '#121218',
          ['--color-surface-hover' as string]: '#181820',
          ['--color-text' as string]: '#e8e8e8',
          ['--color-text-secondary' as string]: '#9b9ba3',
          ['--color-text-tertiary' as string]: '#6e6e78',
          ['--color-border' as string]: '#1e1e26',
          ['--color-primary' as string]: '#2ecc71',
          ['--color-primary-text' as string]: '#062b16',
          ['--color-primary-dim' as string]: 'rgba(46, 204, 113, 0.14)',
          ['--color-primary-hover' as string]: '#27ae60',
          ['--radius-card' as string]: '3px',
          ['--radius-button' as string]: '3px',
        }}
        initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
        {/* Живое поле точек и пикселей. Раньше его здесь не было: мастер
            первого запуска задаёт цвета жёстко, своими значениями, поэтому
            поле рисуется отдельным слоем поверх основы и под содержимым.
            Размер задан явно: у canvas есть собственный размер 300x150,
            и при width:auto абсолютное позиционирование его не растягивает. */}
        <DotField profile="edges" className="pointer-events-none absolute inset-0 h-full w-full" />
        {/* Title bar */}
        <div className="flex items-center justify-between px-4 py-2"
          style={{ borderBottom: '1px solid var(--color-border)', height: 'var(--titlebar-height, 32px)' }}>
          <div className="flex items-center gap-2">
            <img src="/launcher-icon.png" alt="" className="w-5 h-5 rounded" draggable={false} />
            <span className="text-xs font-bold" style={{ color: 'var(--color-text-secondary)' }}>Portal Launcher тАФ ╨Я╨╡╤А╨▓╤Л╨╣ ╨╖╨░╨┐╤Г╤Б╨║</span>
          </div>
          <button onClick={finishSetup} className="p-1 rounded hover:bg-white/5" title="╨Я╤А╨╛╨┐╤Г╤Б╤В╨╕╤В╤М">
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
            className="ore-flat px-3 py-2 text-xs font-bold disabled:opacity-0"
            style={{ color: 'var(--color-text-secondary)' }}
            disabled={step === 0}>
            ╨Э╨░╨╖╨░╨┤
          </button>
          {step < steps.length - 1 && (
            <button onClick={() => setStep(s => s + 1)}
              className="px-3 py-2 text-xs font-bold"
              style={{ color: 'var(--color-text-secondary)' }}>
              ╨Ф╨░╨╗╨╡╨╡
            </button>
          )}
        </div>
      </motion.div>
    </AnimatePresence>
  );
}

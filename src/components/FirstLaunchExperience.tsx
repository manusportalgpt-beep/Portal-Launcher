import { useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { ArrowRight, Check, Compass, House, Image as ImageIcon, Library, Palette, PanelLeft, PanelTop, Settings2, Shirt, Sparkles, Volume2, Gamepad2, Key, Shield, AlertTriangle, X } from 'lucide-react';
import { invoke } from '@/lib/invoke-shim';
import { useLanguageStore, type Lang } from '@/stores/languageStore';
import { useUiStore, type NavMode } from '@/stores/uiStore';
import { useThemeStore, type CustomThemeColors } from '@/stores/themeStore';
import { type ThemeId } from '@/lib/theme-engine';
import { ONBOARDING_BACKGROUNDS } from '@/lib/onboarding-backgrounds';
import { STYLE_PRESETS, type StylePreset } from '@/lib/style-presets';
import { MicrosoftAuthOAuth } from '@/components/auth/MicrosoftAuthOAuth';
import { CustomThemeBuilder } from '@/components/CustomThemeBuilder';

const SETUP_KEY = 'portal-first-launch-complete-v1';
const TUTORIAL_KEY = 'portal-interface-tutorial-complete-v1';
type StorageOverview = { usedBytes: number };

const TUTORIAL_STEPS = [
  { icon: House, title: 'Главная', to: '/home', action: 'Нажмите «Главная» в навигации.', text: 'Здесь запускается последняя сборка и видны основные действия.' },
  { icon: Compass, title: 'Обзор', to: '/discover', action: 'Откройте «Обзор» в навигации.', text: 'Здесь ищут моды, модпаки, ресурс-паки и шейдеры.' },
  { icon: Shirt, title: 'Скины', to: '/skins', action: 'Откройте «Скины» в навигации.', text: 'Здесь добавляют PNG и применяют скин по нику.' },
  { icon: Library, title: 'Библиотека', to: '/library', action: 'Откройте «Библиотека» в навигации.', text: 'Здесь создают, импортируют, настраивают и запускают сборки.' },
  { icon: Volume2, title: 'Настройки Аудио', to: '/settings/audio', action: 'Откройте Настройки → Аудио.', text: 'Здесь настраивают громкость, звуки и фоновую музыку лаунчера.' },
  { icon: Gamepad2, title: 'Настройки управления', to: '/settings/controls', action: 'Откройте Настройки → Управление.', text: 'Здесь задают горячие клавиши и быстрые действия.' },
  { icon: Key, title: 'CurseForge API', to: '/settings/advanced', action: 'Откройте Настройки → Дополнительно.', text: 'Здесь вставляют API-ключ CurseForge, чтобы работал поиск модов CurseForge. Ключ отрисовывается и применяется сразу после сохранения.' },
  { icon: Settings2, title: 'Настройки', to: '/settings', action: 'Откройте «Настройки» в навигации.', text: 'Здесь находятся аккаунты, Java, оформление и управление.' },
  { icon: Shield, title: 'Безопасность', to: '/settings/about', action: 'Откройте Настройки → О лаунчере.', text: 'Важная информация о безопасности лаунчера — прочтите внимательно!' },
] as const;

// Stage 10 is a special dialog step — not navigation-based
const TUTORIAL_STAGE_DIALOG = 9; // 0-indexed, so step 10

const THEME_CHOICES: Array<{ id: ThemeId; label: string }> = [
  { id:'system', label:'Системная' }, { id:'dark', label:'Тёмная' }, { id:'glass-white', label:'Glass White' },
  { id:'monochrome', label:'Монохром' }, { id:'purple-dark', label:'Тёмный фиолетовый' }, { id:'redstone', label:'RedStone' },
];

const STYLE_THEME: Record<StylePreset, ThemeId> = {
  glass: 'dark', quadral: 'monochrome', falloff: 'purple-dark', abouts: 'system',
};

function NavPreview({ mode }: { mode: NavMode }) {
  const navItems = mode === 'sidebar'
    ? <div className="flex w-[43%] flex-col gap-1.5 border-r p-2" style={{ borderColor:'var(--color-border)' }}><span className="flex items-center gap-1 text-[8px] font-bold"><House className="h-3 w-3" />Главная</span><span className="flex items-center gap-1 text-[8px] opacity-70"><Compass className="h-3 w-3" />Обзор</span><span className="flex items-center gap-1 text-[8px] opacity-70"><Library className="h-3 w-3" />Библиотека</span></div>
    : <div className="mx-auto mt-2 flex h-8 w-[70%] items-center justify-around border px-2" style={{ borderColor:'var(--color-border)' }}><House className="h-3.5 w-3.5" /><Compass className="h-3.5 w-3.5" /><Library className="h-3.5 w-3.5" /></div>;
  return <div className="h-28 overflow-hidden" style={{ background:'var(--color-bg)', border:'1px solid var(--color-border)', borderRadius:6 }}>
    <div className={mode === 'sidebar' ? 'flex h-full' : 'h-full'}>{navItems}{mode === 'sidebar' ? <div className="flex-1 p-3"><i className="block h-2 w-2/3 bg-current opacity-55" /><i className="mt-2 block h-2 w-full bg-current opacity-20" /><i className="mt-2 block h-2 w-4/5 bg-current opacity-20" /></div> : <div className="px-3 pt-5"><i className="block h-2 w-2/3 bg-current opacity-55" /><i className="mt-2 block h-2 w-full bg-current opacity-20" /></div>}</div>
  </div>;
}

function SecurityDialog({ onClose }: { onClose: () => void }) {
  const [stage, setStage] = useState(0);
  const [agreed, setAgreed] = useState(false);

  const stages = [
    {
      icon: Shield,
      title: 'Безопасность лаунчера',
      items: [
        { icon: '🛡️', text: 'Этот лаунчер НЕ устанавливает Яндекс Браузер' },
        { icon: '😈', text: 'Этот лаунчер НЕ хочет вам зла 360 Total Security' },
        { icon: '🚗', text: 'Не скачивайте лучше MAX — не ловит даже на парковке!' },
      ],
    },
  ];

  const s = stages[stage];
  const Icon = s.icon;

  return <motion.aside className="portal-glass-surface fixed bottom-5 right-5 z-[240] w-[min(420px,calc(100vw-2.5rem))] p-5" style={{ background:'var(--color-bg)', border:'1px solid var(--color-border)', borderRadius:'var(--radius-modal)', boxShadow:'var(--shadow-lg)' }} initial={{ opacity:0, y:14 }} animate={{ opacity:1, y:0 }} exit={{ opacity:0, y:14 }}>
    <div className="flex items-start gap-3">
      <span className="portal-style-mark flex h-9 w-9 shrink-0 items-center justify-center" style={{ border:'1px solid var(--color-border)', color:'var(--color-primary)' }}>
        <Icon className="h-4 w-4" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-xs font-bold">Шаг 10: {s.title}</p>
        <p className="mt-1 text-xs font-semibold" style={{ color:'var(--color-text)' }}>Прочтите важную информацию</p>
      </div>
      <button onClick={onClose} className="p-1" title="Закрыть" style={{ color:'var(--color-text-tertiary)' }}>
        <X className="h-4 w-4" />
      </button>
    </div>

    <div className="mt-4 space-y-3">
      {s.items.map((item, i) => (
        <div key={i} className="flex items-start gap-3 rounded-lg p-3" style={{ background:'var(--color-surface)', border:'1px solid var(--color-border)' }}>
          <span className="text-lg shrink-0">{item.icon}</span>
          <p className="text-xs leading-relaxed" style={{ color:'var(--color-text)' }}>{item.text}</p>
        </div>
      ))}
    </div>

    {/* NON-License Agreement */}
    <div className="mt-4 rounded-lg p-3" style={{ background:'var(--color-surface)', border:'1px solid var(--color-border)' }}>
      <div className="flex items-start gap-2">
        <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" style={{ color:'var(--color-warning)' }} />
        <div className="min-w-0">
          <p className="text-xs font-bold" style={{ color:'var(--color-text)' }}>НЕ-Лицензионное соглашение</p>
          <p className="mt-1 text-[11px] leading-relaxed" style={{ color:'var(--color-text-secondary)' }}>
            Используя Portal Launcher, вы соглашаетесь с тем, что не соглашаетесь ни с чем.
            Лаунчер не несёт ответственности за удовольствие от игры.
            Все совпадения с реальностью — случайны. Все несовпадения — тоже.
          </p>
        </div>
      </div>
    </div>

    <label className="mt-4 flex items-center gap-2 cursor-pointer">
      <input type="checkbox" checked={agreed} onChange={e => setAgreed(e.target.checked)} className="shrink-0" style={{ accentColor:'var(--color-primary)' }} />
      <span className="text-xs font-semibold" style={{ color:'var(--color-text)' }}>Я прочитал и не согласен</span>
    </label>

    <div className="mt-4 flex items-center justify-between">
      <span className="text-[10px]" style={{ color:'var(--color-text-tertiary)' }}>10 / 10</span>
      <button
        onClick={onClose}
        disabled={!agreed}
        className="inline-flex items-center gap-2 px-3 py-2 text-xs font-bold disabled:opacity-40"
        style={{ background: agreed ? 'var(--color-primary)' : 'var(--color-surface)', color: agreed ? 'var(--color-primary-text)' : 'var(--color-text-secondary)', border: agreed ? 'none' : '1px solid var(--color-border)', borderRadius:'var(--radius-button)' }}
      >
        Завершить <ArrowRight className="h-3.5 w-3.5" />
      </button>
    </div>
  </motion.aside>;
}

function Tutorial({ onClose }: { onClose: () => void }) {
  const [step, setStep] = useState(0);

  // Stage 10 (index 9) — special dialog
  if (step === TUTORIAL_STAGE_DIALOG) {
    return <SecurityDialog onClose={onClose} />;
  }

  const current = TUTORIAL_STEPS[step];
  const Icon = current.icon;
  useEffect(() => {
    document.body.dataset.portalTutorialTarget = current.to;
    const completeStep = (event: Event) => {
      const path = (event as CustomEvent<string>).detail;
      if (path !== current.to) return;
      if (step === TUTORIAL_STEPS.length) onClose(); else setStep(value => value + 1);
    };
    window.addEventListener('portal:tutorial-navigation', completeStep as EventListener);
    return () => { delete document.body.dataset.portalTutorialTarget; window.removeEventListener('portal:tutorial-navigation', completeStep as EventListener); };
  }, [current.to, onClose, step]);
  return <motion.aside className="portal-glass-surface fixed bottom-5 right-5 z-[240] w-[min(360px,calc(100vw-2.5rem))] p-4" style={{ background:'var(--color-bg)', border:'1px solid var(--color-border)', borderRadius:'var(--radius-modal)', boxShadow:'var(--shadow-sm)' }} initial={{ opacity:0, y:14 }} animate={{ opacity:1, y:0 }} exit={{ opacity:0, y:14 }}>
    <div className="flex items-start gap-3"><span className="portal-style-mark flex h-9 w-9 shrink-0 items-center justify-center" style={{ border:'1px solid var(--color-border)', color:'var(--color-primary)' }}><Icon className="h-4 w-4" /></span><div className="min-w-0 flex-1"><p className="text-xs font-bold">Шаг {step + 1}: {current.title}</p><p className="mt-1 text-xs font-semibold" style={{ color:'var(--color-text)' }}>{current.action}</p><p className="mt-1 text-xs leading-relaxed" style={{ color:'var(--color-text-secondary)' }}>{current.text}</p></div><button onClick={onClose} className="p-1" title="Закрыть туториал" style={{ color:'var(--color-text-tertiary)' }}><X className="h-4 w-4" /></button></div>
    <div className="mt-4 flex items-center justify-between"><span className="text-[10px]" style={{ color:'var(--color-text-tertiary)' }}>{step + 1} / {TUTORIAL_STEPS.length + 1}</span><span className="text-[10px]" style={{ color:'var(--color-text-secondary)' }}>Шаг продолжится после нажатия</span></div>
  </motion.aside>;
}

export function FirstLaunchExperience() {
  const lang = useLanguageStore(state => state.lang);
  const setLang = useLanguageStore(state => state.setLang);
  const ui = useUiStore();
  const { themeId, setTheme, addCustomTheme } = useThemeStore();
  const [mode, setMode] = useState<'checking' | 'setup' | 'tutorial' | 'none'>(() => localStorage.getItem(SETUP_KEY) ? (localStorage.getItem(TUTORIAL_KEY) ? 'none' : 'tutorial') : 'checking');
  const [step, setStep] = useState(0);
  const [isPreview, setIsPreview] = useState(false);
  const [glassTone, setGlassTone] = useState<'black'|'white'>(themeId === 'glass-white' ? 'white' : 'black');

  useEffect(() => {
    if (mode !== 'checking') return;
    let active = true;
    void invoke<StorageOverview>('get_launcher_storage_overview').then(overview => {
      if (!active) return;
      if (overview.usedBytes === 0) {
        ui.set('stylePreset', 'glass');
        setTheme('dark');
        setMode('setup');
      } else {
        // Even if storage is used, show the tutorial if it hasn't been completed.
        // This fixes the issue where the tutorial never shows when the launcher
        // has cached files (Java runtimes, assets, etc.) but the user hasn't
        // seen the tutorial yet.
        if (!localStorage.getItem(TUTORIAL_KEY)) {
          setMode('tutorial');
        } else {
          setMode('none');
        }
      }
    }).catch(() => { if (active) {
      // On error, still show tutorial if not completed
      if (!localStorage.getItem(TUTORIAL_KEY)) {
        setMode('tutorial');
      } else {
        setMode('none');
      }
    } });
    return () => { active = false; };
  }, [mode]);
  useEffect(() => {
    const openTutorial = () => { setIsPreview(false); setMode('tutorial'); };
    const openPreview = () => { setIsPreview(true); setStep(0); setMode('setup'); };
    window.addEventListener('portal:open-tutorial', openTutorial);
    window.addEventListener('portal:open-onboarding-preview', openPreview);
    return () => { window.removeEventListener('portal:open-tutorial', openTutorial); window.removeEventListener('portal:open-onboarding-preview', openPreview); };
  }, []);
  useEffect(() => {
    const previewOpen = mode === 'setup' && isPreview;
    if (previewOpen) {
      document.documentElement.dataset.portalTutorialPreview = 'true';
      window.dispatchEvent(new CustomEvent('portal:tutorial-preview-change', { detail: true }));
    }
    return () => {
      if (previewOpen) {
        delete document.documentElement.dataset.portalTutorialPreview;
        window.dispatchEvent(new CustomEvent('portal:tutorial-preview-change', { detail: false }));
      }
    };
  }, [mode, isPreview]);

  const finishSetup = () => { if (isPreview) { setMode('none'); return; } localStorage.setItem(SETUP_KEY, '1'); setMode('tutorial'); };
  const finishTutorial = () => { localStorage.setItem(TUTORIAL_KEY, '1'); setMode('none'); };
  const chooseStyle = (preset: StylePreset) => {
    if (isPreview) return;
    ui.set('stylePreset', preset);
    setTheme(preset === 'glass' && glassTone === 'white' ? 'glass-white' : STYLE_THEME[preset]);
  };
  const chooseGlassTone = (tone: 'black'|'white') => {
    if (isPreview) return;
    setGlassTone(tone);
    if (ui.stylePreset === 'glass') setTheme(tone === 'white' ? 'glass-white' : 'dark');
  };
  const createPortalTheme = () => {
    if (isPreview) return;
    const colors: CustomThemeColors = glassTone === 'white'
      ? { background:'#EAF0FA', surface:'#FFFFFF', surfaceHover:'#F4F7FD', surfaceActive:'#DFE9F8', primary:'#4299E1', outline:'#CBD7EA', outlineStrong:'#9CB4D4', text:'#101828', mutedText:'#475467', success:'#2ECC71', warning:'#F39C12', error:'#E74C3C', info:'#3498DB' }
      : { background:'#080A12', surface:'#121827', surfaceHover:'#1A2234', surfaceActive:'#242F48', primary:'#7C5CFC', outline:'#35415F', outlineStrong:'#596B95', text:'#F4F6FF', mutedText:'#9AA7C2', success:'#2ECC71', warning:'#F39C12', error:'#E74C3C', info:'#3498DB' };
    addCustomTheme('Моя тема Portal', colors, { radiusScale: ui.stylePreset === 'quadral' ? 0.45 : 1, shadowStrength: ui.stylePreset === 'glass' ? 0.55 : 0.25, glowStrength: 0 });
  };

  if (mode === 'checking' || mode === 'none') return null;
  if (mode === 'tutorial') return <Tutorial onClose={finishTutorial} />;
  const steps = ['Язык', 'Навигация', 'Фон', 'Стиль и тема', 'Аккаунт'];
  const currentBackground = ui.backgroundImage;
  return <AnimatePresence><motion.div className="clean-onboarding fixed inset-0 z-[230] grid place-items-center overflow-y-auto bg-black p-5" style={{ color:'var(--color-text)' }} initial={{ opacity:0 }} animate={{ opacity:1 }}>
    <motion.section className="clean-onboarding-surface portal-glass-surface portal-glass-outline my-auto w-full max-w-4xl" style={{ background:'var(--color-bg)', border:'1px solid var(--color-border)', borderRadius:'var(--radius-modal)', boxShadow:'var(--shadow-lg)' }} initial={{ opacity:0, y:12 }} animate={{ opacity:1, y:0 }}>
      <header className="flex items-center justify-between border-b px-5 py-4" style={{ borderColor:'var(--color-border)' }}><div><p className="text-sm font-bold">{isPreview ? 'Предпросмотр первого запуска' : 'Настройка Portal Launcher'}</p><p className="mt-0.5 text-xs" style={{ color:'var(--color-text-secondary)' }}>{steps[step]} · шаг {step + 1} из {steps.length}</p></div><span className="text-xs font-bold" style={{ color:'var(--color-primary)' }}>{step + 1} / {steps.length}</span></header>
      <main className="min-h-[420px] p-5 sm:p-6">
        {step === 0 && <div className="grid gap-5 md:grid-cols-2"><div><Sparkles className="h-5 w-5" style={{ color:'var(--color-primary)' }} /><h1 className="mt-3 text-2xl font-bold">Выберите язык</h1><p className="mt-2 text-sm" style={{ color:'var(--color-text-secondary)' }}>Настройка действует сразу для страниц, подсказок и первого tutorial.</p></div><div className="space-y-2">{([['ru','Русский'],['en','English']] as [Lang,string][]).map(([value,label]) => <button key={value} disabled={isPreview} onClick={() => setLang(value)} className="flex w-full items-center justify-between px-4 py-3 text-left text-sm font-semibold disabled:cursor-default disabled:opacity-80" style={{ background:'transparent', color:'var(--color-text)', border:`1px solid ${lang === value ? 'var(--color-primary)' : 'var(--color-border)'}`, borderRadius:'var(--radius-card)' }}>{label}{lang === value && <Check className="h-4 w-4" />}</button>)}</div></div>}
        {step === 1 && <div><h1 className="text-2xl font-bold">Как открывать страницы?</h1><p className="mt-2 text-sm" style={{ color:'var(--color-text-secondary)' }}>Выбор можно сменить позже в Оформлении. В превью видно, где появятся ваши основные разделы.</p><div className="mt-5 grid gap-3 md:grid-cols-2">{([{ id:'sidebar', icon:PanelLeft, title:'Sidebar', text:'Постоянная вертикальная навигация слева. Удобна, когда все разделы должны быть под рукой.' }, { id:'notch', icon:PanelTop, title:'Notch Panel', text:'Компактная верхняя панель. Открывается по наведению и освобождает больше места для страницы.' }] as {id:NavMode;icon:any;title:string;text:string}[]).map(option => { const Icon = option.icon; return <button key={option.id} disabled={isPreview} onClick={() => ui.set('navMode', option.id)} className="p-3 text-left disabled:cursor-default disabled:opacity-80" style={{ background:'transparent', color:'var(--color-text)', border:`1px solid ${ui.navMode === option.id ? 'var(--color-primary)' : 'var(--color-border)'}`, borderRadius:'var(--radius-card)' }}><NavPreview mode={option.id} /><div className="mt-3 flex items-center justify-between"><span className="flex items-center gap-2 text-sm font-bold"><Icon className="h-4 w-4" />{option.title}</span>{ui.navMode === option.id && <Check className="h-4 w-4" style={{ color:'var(--color-primary)' }} />}</div><p className="mt-1 text-xs leading-relaxed" style={{ color:'var(--color-text-secondary)' }}>{option.text}</p></button>; })}</div></div>}
        {step === 2 && <div><div className="flex items-start gap-3"><ImageIcon className="mt-1 h-5 w-5 shrink-0" style={{ color:'var(--color-primary)' }} /><div><h1 className="text-2xl font-bold">Выберите фон</h1><p className="mt-2 text-sm" style={{ color:'var(--color-text-secondary)' }}>Все изображения, которые вы прислали, доступны здесь как готовые фоны. Они применяются ко всему рабочему пространству и остаются после перезапуска.</p></div></div><div className="mt-5 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">{ONBOARDING_BACKGROUNDS.map(background => <button key={background.id} disabled={isPreview} onClick={() => ui.set('backgroundImage', background.src)} className="group overflow-hidden text-left disabled:cursor-default" style={{ border:`2px solid ${currentBackground === background.src ? 'var(--color-primary)' : 'transparent'}`, borderRadius:'var(--radius-card)', background:'var(--color-surface)' }}><div className="aspect-[16/9] bg-cover bg-center transition-transform duration-200 group-hover:scale-[1.03]" style={{ backgroundImage:`url("${background.src}")` }} /><div className="flex items-center justify-between px-2 py-1.5"><span className="truncate text-[10px] font-bold">{background.name}</span>{currentBackground === background.src && <Check className="h-3.5 w-3.5 shrink-0" style={{ color:'var(--color-primary)' }} />}</div></button>)}</div></div>}
        {step === 3 && <div><div className="flex items-start gap-3"><Palette className="mt-1 h-5 w-5 shrink-0" style={{ color:'var(--color-primary)' }} /><div><h1 className="text-2xl font-bold">Стиль и тема</h1><p className="mt-2 text-sm" style={{ color:'var(--color-text-secondary)' }}>Стиль отвечает за форму и материал интерфейса, а тема — за цвета. Любую тему позже можно изменить в Настройки → Оформление.</p></div></div><div className="mt-5 grid gap-2 sm:grid-cols-2">{STYLE_PRESETS.map(preset => <button key={preset.id} disabled={isPreview} onClick={() => chooseStyle(preset.id)} className="p-3 text-left disabled:cursor-default" style={{ background:ui.stylePreset === preset.id ? 'var(--color-primary-dim)' : 'transparent', border:`1px solid ${ui.stylePreset === preset.id ? 'var(--color-primary)' : 'var(--color-border)'}`, borderRadius:'var(--radius-card)' }}><div className="flex items-center justify-between"><span className="text-sm font-bold">{preset.title}</span>{ui.stylePreset === preset.id && <Check className="h-4 w-4" style={{ color:'var(--color-primary)' }} />}</div><p className="mt-1 text-xs leading-relaxed" style={{ color:'var(--color-text-secondary)' }}>{preset.description}</p></button>)}</div><div className="mt-4 grid gap-3 border-t pt-4 md:grid-cols-[1fr_auto]" style={{ borderColor:'var(--color-border)' }}><label className="text-xs font-bold">Тема из Оформления<select disabled={isPreview} value={themeId} onChange={event => setTheme(event.target.value as ThemeId)} className="mt-1.5 block w-full px-3 py-2 text-xs" style={{ background:'var(--color-surface-2)', color:'var(--color-text)', border:'1px solid var(--color-border)', borderRadius:'var(--radius-button)' }}>{THEME_CHOICES.map(choice => <option key={choice.id} value={choice.id}>{choice.label}</option>)}</select></label><div className="flex flex-wrap items-end gap-2">{ui.stylePreset === 'glass' && <div className="flex overflow-hidden" style={{ border:'1px solid var(--color-border)', borderRadius:'var(--radius-button)' }}><button disabled={isPreview} onClick={() => chooseGlassTone('black')} className="px-3 py-2 text-xs font-bold disabled:cursor-default" style={{ background: glassTone === 'black' ? 'var(--color-primary)' : 'transparent', color: glassTone === 'black' ? 'var(--color-primary-text)' : 'var(--color-text-secondary)' }}>Чёрное</button><button disabled={isPreview} onClick={() => chooseGlassTone('white')} className="px-3 py-2 text-xs font-bold disabled:cursor-default" style={{ background: glassTone === 'white' ? 'var(--color-primary)' : 'transparent', color: glassTone === 'white' ? 'var(--color-primary-text)' : 'var(--color-text-secondary)' }}>Белое</button></div>}{ui.stylePreset !== 'glass' && <button disabled={isPreview} onClick={createPortalTheme} className="px-3 py-2 text-xs font-bold disabled:cursor-default" style={{ background:'var(--color-surface)', color:'var(--color-text)', border:'1px solid var(--color-border)', borderRadius:'var(--radius-button)' }}>Моя тема Portal</button>}</div></div></div>}
        {step === 4 && <div className="mx-auto max-w-xl"><h1 className="text-2xl font-bold">Войдите в аккаунт</h1><p className="mt-2 text-sm" style={{ color:'var(--color-text-secondary)' }}>{isPreview ? 'Это read-only preview. Вход в нём не меняет аккаунты.' : 'Выберите Microsoft, Ely.by или вход по нику. Вход можно пропустить и добавить аккаунт позже в настройках.'}</p><div className="mt-5" style={{ border:'1px solid var(--color-border)', borderRadius:'var(--radius-card)', padding:12 }}><MicrosoftAuthOAuth preview={isPreview} onSuccess={finishSetup} /></div></div>}
      </main>
      <footer className="flex items-center justify-between border-t px-5 py-4" style={{ borderColor:'var(--color-border)' }}><button onClick={() => step > 0 && setStep(value => value - 1)} className="px-3 py-2 text-xs font-bold disabled:opacity-0" style={{ color:'var(--color-text-secondary)' }} disabled={step === 0}>Назад</button>{step < steps.length - 1 ? <button onClick={() => setStep(value => value + 1)} className="inline-flex items-center gap-2 px-3 py-2 text-xs font-bold" style={{ background:'transparent', color:'var(--color-text)', border:'1px solid var(--color-border)', borderRadius:'var(--radius-button)' }}>Далее <ArrowRight className="h-3.5 w-3.5" /></button> : <button onClick={finishSetup} className="inline-flex items-center gap-2 px-3 py-2 text-xs font-bold" style={{ background:'transparent', color:'var(--color-text)', border:'1px solid var(--color-border)', borderRadius:'var(--radius-button)' }}>{isPreview ? 'Закрыть' : 'Пропустить и открыть лаунчер'} <ArrowRight className="h-3.5 w-3.5" /></button>}</footer>
    </motion.section>
  </motion.div></AnimatePresence>;
}

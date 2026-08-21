import { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ArrowRight, Check, Compass, HardDrive, House, Library, Settings2, Shirt, X } from 'lucide-react';
import { invoke } from '@/lib/invoke-shim';
import { useLanguageStore, type Lang } from '@/stores/languageStore';
import { useUiStore, type NavMode } from '@/stores/uiStore';
import { MicrosoftAuthOAuth } from '@/components/auth/MicrosoftAuthOAuth';

const SETUP_KEY = 'portal-first-launch-complete-v1';
const TUTORIAL_KEY = 'portal-interface-tutorial-complete-v1';
const bytes = (value?: number) => value === undefined || value === null ? 'Недоступно' : value < 1024 * 1024 ? `${Math.max(1, Math.round(value / 1024))} КБ` : value < 1024 ** 3 ? `${(value / 1024 ** 2).toFixed(1)} МБ` : `${(value / 1024 ** 3).toFixed(1)} ГБ`;
type StorageOverview = { launcherPath: string; usedBytes: number; launcherBytes?: number; totalBytes?: number; freeBytes?: number | null };

const TUTORIAL_STEPS = [
  { icon: House, title:'Главная', to:'/home', action:'Нажмите «Главная» в навигации.', text:'Здесь запускается последняя сборка и видны основные действия.' },
  { icon: Compass, title:'Обзор', to:'/discover', action:'Откройте «Обзор» в навигации.', text:'Здесь ищут моды, модпаки, ресурс-паки и шейдеры.' },
  { icon: Shirt, title:'Скины', to:'/skins', action:'Откройте «Скины» в навигации.', text:'Здесь добавляют PNG и применяют скин по нику.' },
  { icon: Library, title:'Библиотека', to:'/library', action:'Откройте «Библиотека» в навигации.', text:'Здесь создают, импортируют, настраивают и запускают сборки.' },
  { icon: Settings2, title:'Настройки', to:'/settings', action:'Откройте «Настройки» в навигации.', text:'Здесь находятся аккаунты, Java, оформление и управление.' },
] as const;

function NavPreview({ mode }: { mode: NavMode }) {
  const block = <><i className="block h-3 w-3 bg-current" /><i className="block h-3 w-3 bg-current" /><i className="block h-3 w-3 bg-current" /></>;
  return <div className="h-24 overflow-hidden p-2" style={{ background:'var(--color-bg)', border:'1px solid var(--color-border)', borderRadius:2 }}>{mode === 'sidebar' ? <div className="flex h-full gap-2"><div className="flex w-8 flex-col items-center gap-1 border-r pt-1" style={{ borderColor:'var(--color-border)' }}>{block}</div><div className="flex-1 pt-2"><span className="block h-2 w-2/3 bg-current opacity-40" /><span className="mt-2 block h-2 w-full bg-current opacity-20" /><span className="mt-2 block h-2 w-4/5 bg-current opacity-20" /></div></div> : <div className="flex h-full flex-col"><div className="mx-auto flex h-7 w-36 items-center justify-around border" style={{ borderColor:'var(--color-border)' }}>{block}</div><div className="flex-1 pt-4"><span className="block h-2 w-1/2 bg-current opacity-40" /><span className="mt-2 block h-2 w-full bg-current opacity-20" /></div></div>}</div>;
}

function Tutorial({ onClose }: { onClose: () => void }) {
  const [step, setStep] = useState(0);
  const current = TUTORIAL_STEPS[step];
  const Icon = current.icon;

  useEffect(() => {
    document.body.dataset.portalTutorialTarget = current.to;
    const completeStep = (event: Event) => {
      const path = (event as CustomEvent<string>).detail;
      if (path !== current.to) return;
      if (step === TUTORIAL_STEPS.length - 1) onClose();
      else setStep(value => value + 1);
    };
    window.addEventListener('portal:tutorial-navigation', completeStep as EventListener);
    return () => {
      delete document.body.dataset.portalTutorialTarget;
      window.removeEventListener('portal:tutorial-navigation', completeStep as EventListener);
    };
  }, [current.to, onClose, step]);

  return <motion.aside className="fixed bottom-5 right-5 z-[240] w-[min(360px,calc(100vw-2.5rem))] p-4" style={{ background:'var(--color-bg)', border:'1px solid var(--color-border)', borderRadius:2, boxShadow:'var(--shadow-sm)' }} initial={{ opacity:0, y:14 }} animate={{ opacity:1, y:0 }} exit={{ opacity:0, y:14 }}>
    <div className="flex items-start gap-3"><span className="flex h-9 w-9 shrink-0 items-center justify-center" style={{ border:'1px solid var(--color-border)', color:'var(--color-primary)' }}><Icon className="h-4 w-4" /></span><div className="min-w-0 flex-1"><p className="text-xs font-bold">Шаг {step + 1}: {current.title}</p><p className="mt-1 text-xs font-semibold" style={{ color:'var(--color-text)' }}>{current.action}</p><p className="mt-1 text-xs leading-relaxed" style={{ color:'var(--color-text-secondary)' }}>{current.text}</p></div><button onClick={onClose} className="p-1" title="Закрыть туториал" style={{ color:'var(--color-text-tertiary)' }}><X className="h-4 w-4" /></button></div>
    <div className="mt-4 flex items-center justify-between"><span className="text-[10px]" style={{ color:'var(--color-text-tertiary)' }}>{step + 1} / {TUTORIAL_STEPS.length}</span><span className="text-[10px]" style={{ color:'var(--color-text-secondary)' }}>Шаг продолжится после нажатия</span></div>
  </motion.aside>;
}

export function FirstLaunchExperience() {
  const lang = useLanguageStore(state => state.lang);
  const setLang = useLanguageStore(state => state.setLang);
  const ui = useUiStore();
  const [mode, setMode] = useState<'checking' | 'setup' | 'tutorial' | 'none'>(() => localStorage.getItem(SETUP_KEY) ? (localStorage.getItem(TUTORIAL_KEY) ? 'none' : 'tutorial') : 'checking');
  const [step, setStep] = useState(0);
  const [storage, setStorage] = useState<StorageOverview | null>(null);
  const [isPreview, setIsPreview] = useState(false);

  useEffect(() => {
    if (mode !== 'checking') return;
    let active = true;
    void invoke<StorageOverview>('get_launcher_storage_overview').then(overview => {
      if (!active) return;
      setStorage(overview); setMode(overview.usedBytes === 0 ? 'setup' : 'none');
    }).catch(() => { if (active) setMode('none'); });
    return () => { active = false; };
  }, [mode]);
  useEffect(() => {
    const openTutorial = () => { setIsPreview(false); setMode('tutorial'); };
    const openPreview = () => { setIsPreview(true); setStep(0); setMode('setup'); };
    window.addEventListener('portal:open-tutorial', openTutorial);
    window.addEventListener('portal:open-onboarding-preview', openPreview);
    return () => {
      window.removeEventListener('portal:open-tutorial', openTutorial);
      window.removeEventListener('portal:open-onboarding-preview', openPreview);
    };
  }, []);
  const finishSetup = () => {
    if (isPreview) { setMode('none'); return; }
    localStorage.setItem(SETUP_KEY, '1'); setMode('tutorial');
  };
  const finishTutorial = () => { localStorage.setItem(TUTORIAL_KEY, '1'); setMode('none'); };
  if (mode === 'checking' || mode === 'none') return null;
  if (mode === 'tutorial') return <Tutorial onClose={finishTutorial} />;

  const steps = ['Язык', 'Навигация', 'Хранилище', 'Аккаунт'];
  return <AnimatePresence><motion.div className="fixed inset-0 z-[230] grid place-items-center overflow-y-auto bg-black p-5" style={{ color:'var(--color-text)' }} initial={{ opacity:0 }} animate={{ opacity:1 }}><motion.section className="my-auto w-full max-w-2xl" style={{ background:'var(--color-bg)', border:'1px solid var(--color-border)', borderRadius:2 }} initial={{ opacity:0, y:12 }} animate={{ opacity:1, y:0 }}><header className="flex items-center justify-between border-b px-5 py-4" style={{ borderColor:'var(--color-border)' }}><div><p className="text-sm font-bold">{isPreview ? 'Предпросмотр первого запуска' : 'Первый запуск'}</p><p className="mt-0.5 text-xs" style={{ color:'var(--color-text-secondary)' }}>{steps[step]}</p></div><span className="text-xs" style={{ color:'var(--color-text-tertiary)' }}>{step + 1} / {steps.length}</span></header><main className="p-5 sm:p-6">
    {step === 0 && <div className="grid gap-5 md:grid-cols-2"><div><h1 className="text-2xl font-bold">Язык интерфейса</h1><p className="mt-2 text-sm" style={{ color:'var(--color-text-secondary)' }}>Выберите язык, на котором будут показаны страницы и подсказки лаунчера.</p></div><div className="space-y-2">{([['ru','Русский'],['en','English']] as [Lang,string][]).map(([value,label]) => <button key={value} disabled={isPreview} onClick={() => setLang(value)} className="flex w-full items-center justify-between px-4 py-3 text-left text-sm font-semibold disabled:cursor-default disabled:opacity-80" style={{ background:'transparent', color:'var(--color-text)', border:`1px solid ${lang === value ? 'var(--color-border-strong)' : 'var(--color-border)'}`, borderRadius:2 }}>{label}{lang === value && <Check className="h-4 w-4" />}</button>)}</div></div>}
    {step === 1 && <div><h1 className="text-2xl font-bold">Навигация</h1><p className="mt-2 text-sm" style={{ color:'var(--color-text-secondary)' }}>Sidebar всегда находится слева. Notch Panel открывается при наведении на верхнюю панель.</p><div className="mt-5 grid gap-3 md:grid-cols-2">{([{ id:'sidebar', title:'Sidebar', text:'Быстрый постоянный переход между страницами. Режим по умолчанию.' }, { id:'notch', title:'Notch Panel', text:'Больше рабочего места. Наведите курсор на верхнюю панель.' }] as {id:NavMode;title:string;text:string}[]).map(option => <button key={option.id} disabled={isPreview} onClick={() => ui.set('navMode', option.id)} className="p-3 text-left disabled:cursor-default disabled:opacity-80" style={{ background:'transparent', color:'var(--color-text)', border:`1px solid ${ui.navMode === option.id ? 'var(--color-border-strong)' : 'var(--color-border)'}`, borderRadius:2 }}><NavPreview mode={option.id} /><div className="mt-3 flex items-center justify-between"><p className="text-sm font-bold">{option.title}</p>{ui.navMode === option.id && <span className="text-[10px]" style={{ color:'var(--color-text-secondary)' }}>Выбрано</span>}</div><p className="mt-1 text-xs leading-relaxed" style={{ color:'var(--color-text-secondary)' }}>{option.text}</p></button>)}</div></div>}
    {step === 2 && <div className="grid gap-5 md:grid-cols-2"><div><HardDrive className="h-5 w-5" style={{ color:'var(--color-text-secondary)' }} /><h1 className="mt-3 text-2xl font-bold">Хранилище</h1><p className="mt-2 text-sm" style={{ color:'var(--color-text-secondary)' }}>Java, Minecraft и сборки будут занимать место в папке лаунчера.</p></div><div className="grid grid-cols-2 gap-2"><div className="p-4" style={{ background:'transparent', border:'1px solid var(--color-border)', borderRadius:2 }}><p className="text-[10px] uppercase" style={{ color:'var(--color-text-tertiary)' }}>Лаунчер и данные</p><p className="mt-2 text-lg font-bold">{bytes(storage?.totalBytes ?? storage?.launcherBytes ?? 15.3 * 1024 * 1024)}</p></div><div className="p-4" style={{ background:'transparent', border:'1px solid var(--color-border)', borderRadius:2 }}><p className="text-[10px] uppercase" style={{ color:'var(--color-text-tertiary)' }}>Свободно</p><p className="mt-2 text-lg font-bold">{bytes(storage?.freeBytes ?? undefined)}</p></div></div></div>}
    {step === 3 && <div className="mx-auto max-w-md"><h1 className="text-2xl font-bold">Аккаунт</h1><p className="mt-2 text-sm" style={{ color:'var(--color-text-secondary)' }}>{isPreview ? 'Это read-only preview. Попытка входа покажет, что изменения недоступны.' : 'Microsoft нужен для лицензионного Minecraft. Вход можно пропустить и добавить аккаунт позже в настройках.'}</p><div className="mt-5 p-3" style={{ background:'transparent', border:'1px solid var(--color-border)', borderRadius:2 }}><MicrosoftAuthOAuth preview={isPreview} onSuccess={finishSetup} /></div></div>}
  </main><footer className="flex items-center justify-between border-t px-5 py-4" style={{ borderColor:'var(--color-border)' }}><button onClick={() => step > 0 && setStep(value => value - 1)} className="px-3 py-2 text-xs font-bold disabled:opacity-0" style={{ color:'var(--color-text-secondary)' }} disabled={step === 0}>Назад</button>{step < 3 ? <button onClick={() => setStep(value => value + 1)} className="inline-flex items-center gap-2 px-3 py-2 text-xs font-bold" style={{ background:'transparent', color:'var(--color-text)', border:'1px solid var(--color-border)', borderRadius:2 }}>Далее <ArrowRight className="h-3.5 w-3.5" /></button> : <button onClick={finishSetup} className="inline-flex items-center gap-2 px-3 py-2 text-xs font-bold" style={{ background:'transparent', color:'var(--color-text)', border:'1px solid var(--color-border)', borderRadius:2 }}>Пропустить <ArrowRight className="h-3.5 w-3.5" /></button>}</footer></motion.section></motion.div></AnimatePresence>;
}

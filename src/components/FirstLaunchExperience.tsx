import { useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import {
  Check, ChevronDown, FolderPlus, Globe, LoaderCircle, Palette, ShieldCheck, User,
} from 'lucide-react';
import { invoke } from '@/lib/invoke-shim';
import { useLanguageStore, type Lang } from '@/stores/languageStore';
import { useUiStore } from '@/stores/uiStore';
import { useThemeStore } from '@/stores/themeStore';
import { type ThemeId } from '@/lib/theme-engine';
import { STYLE_PRESETS, type StylePreset } from '@/lib/style-presets';
import { fetchMcVersionIds, MC_VERSIONS_FALLBACK } from '@/lib/mc-versions';
import { DotField } from '@/components/effects/DotField';

// Ключ прежний: сменив его, первый заход показался бы заново всем,
// кто его уже проходил.
const SETUP_KEY = 'portal-first-launch-complete-v1';

const LANGS: { id: Lang; label: string }[] = [
  { id: 'ru', label: 'Русский' },
  { id: 'en', label: 'English' },
];

// Пресеты берём из общего списка, чтобы новый выбор не разошёлся с
// настройками: свой список здесь разошёлся бы с STYLE_PRESETS.
const STYLES = STYLE_PRESETS;

// Темы те, что реально есть в движке. У пресета falloff своя тема,
// остальные идут на тёмную.
const THEME_IDS: ThemeId[] = ['dark', 'oled'];

const LOADERS = [
  { id: 'vanilla', label: 'Vanilla', hint: 'Без модов' },
  { id: 'fabric', label: 'Fabric', hint: 'Лёгкие моды' },
  { id: 'neoforge', label: 'NeoForge', hint: 'Большие сборки' },
  { id: 'forge', label: 'Forge', hint: 'Классические моды' },
  { id: 'quilt', label: 'Quilt', hint: 'Совместим с Fabric' },
];

const LOADER_COMMAND: Record<string, string> = {
  fabric: 'get_fabric_versions',
  neoforge: 'get_neoforge_versions',
  quilt: 'get_quilt_versions',
  forge: 'get_forge_versions',
};

/**
 * Первый запуск целиком на одном экране (RULES.md 12.6).
 *
 * Раньше было пять шагов подряд плюс цепочка подтверждений внутри
 * установки - около десяти экранов подряд. Теперь это одна страница:
 * сверху кружки по числу разделов, они же навигация, ниже все выборы
 * разом. Отдельного подтверждения установки больше нет.
 *
 * Раздел безопасности убран: он был отдельным шагом, но что он
 * переключал, из кода не видно, а выдумывать настройки нельзя.
 */
export function FirstLaunchExperience() {
  const { lang, setLang } = useLanguageStore();
  const ui = useUiStore();
  const { themeId, setTheme } = useThemeStore();

  const [dismissed, setDismissed] = useState(() => {
    if (typeof localStorage === 'undefined') return false;
    return localStorage.getItem(SETUP_KEY) === '1'
      || localStorage.getItem('portal-first-launch-complete') === '1'
      || localStorage.getItem('portal-onboarding-done') === '1';
  });

  const [active, setActive] = useState(0);
  const [style, setStyle] = useState<StylePreset>(ui.stylePreset);
  const [theme, setThemeLocal] = useState<ThemeId>(themeId);

  const [loader, setLoader] = useState('fabric');
  const [versions, setVersions] = useState<string[]>([]);
  const [mcVersion, setMcVersion] = useState('');
  const [instanceName, setInstanceName] = useState('');
  const [creating, setCreating] = useState(false);
  const [created, setCreated] = useState(false);
  const [error, setError] = useState('');

  // Ссылки висят на section, а не на div, поэтому тип HTMLElement.
  const sectionRefs = useRef<(HTMLElement | null)[]>([]);
  const sections = useMemo(
    () => [
      { id: 'lang', label: 'Язык', Icon: Globe },
      { id: 'style', label: 'Оформление', Icon: Palette },
      { id: 'instance', label: 'Сборка', Icon: FolderPlus },
      { id: 'account', label: 'Аккаунт', Icon: User },
    ],
    [],
  );

  // Версии игры. Пока грузятся, показываем запасной список, чтобы
  // выбор загрузчика не был заблокирован пустым полем.
  useEffect(() => {
    let alive = true;
    fetchMcVersionIds(false)
      .then(ids => { if (alive && ids.length) setVersions(ids); })
      .catch(() => { if (alive) setVersions(MC_VERSIONS_FALLBACK); });
    return () => { alive = false; };
  }, []);

  useEffect(() => {
    if (versions.length && !mcVersion) setMcVersion(versions[0]);
  }, [versions, mcVersion]);

  const suggestedName = useMemo(() => {
    const v = mcVersion ? mcVersion.replace(/\./g, '.') : '';
    const l = loader === 'vanilla' ? 'Vanilla' : loader.charAt(0).toUpperCase() + loader.slice(1);
    return [l, v].filter(Boolean).join(' ');
  }, [loader, mcVersion]);

  const jumpTo = (index: number) => {
    setActive(index);
    const node = sectionRefs.current[index];
    if (node) node.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  const finish = async () => {
    setError('');
    ui.set('stylePreset', style);
    setTheme(theme);
    if (lang) setLang(lang);

    if (!loader || !mcVersion) {
      jumpTo(2);
      setError('Выбери загрузчик и версию игры.');
      return;
    }
    setCreating(true);
    try {
      let loaderVersion = '';
      if (LOADER_COMMAND[loader]) {
        const raw = await invoke<any>(LOADER_COMMAND[loader], { mcVersion });
        const list = Array.isArray(raw) ? raw : [];
        const first = list[0];
        loaderVersion = first?.loader?.version ?? first?.version ?? '';
      }
      await invoke<any>('create_instance', {
        name: instanceName.trim() || suggestedName || 'Сборка',
        description: '',
        mcVersion,
        loader,
        loaderVersion,
        minRam: 1024,
        maxRam: 4096,
        javaPath: '',
        customJvmArgs: '',
        icon: null,
      });
      setCreated(true);
      localStorage.setItem(SETUP_KEY, '1');
      setDismissed(true);
    } catch (e) {
      setError(String(e));
    } finally {
      setCreating(false);
    }
  };

  if (dismissed) return null;

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.18 }}
        className="fixed inset-0 z-[300] flex flex-col"
        style={{ background: 'var(--color-bg)' }}
      >
        <DotField profile="edges" className="pointer-events-none absolute inset-0 h-full w-full" />

        <div className="relative mx-auto flex h-full w-full max-w-3xl flex-col px-6 py-8">
          <header className="shrink-0">
            <h1 className="text-2xl font-bold" style={{ color: 'var(--color-text)' }}>
              Настрой запуск один раз
            </h1>
            <p className="mt-1.5 text-sm" style={{ color: 'var(--color-text-secondary)' }}>
              Всё выбирается здесь. Отдельных подтверждений больше нет.
            </p>

            {/* Кружки: столько, сколько разделов. Текущий подсвечен,
                предыдущие галочкой. Клик по кружку прокручивает к
                разделу - это одновременно и навигация, и счёт шагов. */}
            <nav className="mt-5 flex items-center gap-2" aria-label="Разделы настройки">
              {sections.map((section, index) => {
                const done = index < active;
                const current = index === active;
                return (
                  <button
                    key={section.id}
                    type="button"
                    onClick={() => jumpTo(index)}
                    title={section.label}
                    aria-label={section.label}
                    aria-current={current ? 'step' : undefined}
                    className="flex h-7 w-7 items-center justify-center rounded-full transition-colors"
                    style={{
                      background: current ? 'var(--color-primary)' : done ? 'var(--color-surface-2)' : 'transparent',
                      border: `1px solid ${current ? 'var(--color-primary)' : 'var(--color-border)'}`,
                      color: current ? 'var(--color-primary-text)' : 'var(--color-text-tertiary)',
                    }}
                  >
                    {done
                      ? <Check className="h-3.5 w-3.5" />
                      : <span className="text-[10px] font-bold">{index + 1}</span>}
                  </button>
                );
              })}
              <span className="ml-2 text-xs" style={{ color: 'var(--color-text-tertiary)' }}>
                {sections[active]?.label}
              </span>
            </nav>
          </header>

          <div className="mt-7 min-h-0 flex-1 space-y-9 overflow-y-auto pr-1">
            {/* Язык */}
            <section ref={el => { sectionRefs.current[0] = el; }}>
              <SectionTitle icon={<Globe className="h-4 w-4" />} title="Язык интерфейса" />
              <div className="mt-3 flex flex-wrap gap-2">
                {LANGS.map(item => (
                  <Pill key={item.id} active={lang === item.id} onClick={() => setLang(item.id)}>
                    {item.label}
                  </Pill>
                ))}
              </div>
            </section>

            {/* Оформление */}
            <section ref={el => { sectionRefs.current[1] = el; }}>
              <SectionTitle icon={<Palette className="h-4 w-4" />} title="Оформление" />
              <div className="mt-3 grid gap-2 sm:grid-cols-2">
                {STYLES.map(item => (
                  <ChoiceCard
                    key={item.id}
                    active={style === item.id}
                    title={item.title}
                    hint={item.description}
                    onClick={() => setStyle(item.id as StylePreset)}
                  />
                ))}
              </div>
              <div className="mt-3 flex gap-2">
                {THEME_IDS.map(item => (
                  <Pill key={item} active={theme === item} onClick={() => setThemeLocal(item)}>
                    {item === 'dark' ? 'Тёмная' : 'OLED'}
                  </Pill>
                ))}
              </div>
            </section>

            {/* Сборка — создаётся по-настоящему */}
            <section ref={el => { sectionRefs.current[2] = el; }}>
              <SectionTitle icon={<FolderPlus className="h-4 w-4" />} title="Первая сборка" />
              <div className="mt-3 flex flex-wrap gap-2">
                {LOADERS.map(item => (
                  <Pill key={item.id} active={loader === item.id} onClick={() => setLoader(item.id)} title={item.hint}>
                    {item.label}
                  </Pill>
                ))}
              </div>

              <div className="mt-3 grid gap-2 sm:grid-cols-2">
                <label className="flex flex-col gap-1.5">
                  <span className="text-[11px]" style={{ color: 'var(--color-text-secondary)' }}>Версия игры</span>
                  <div className="relative">
                    <select
                      value={mcVersion}
                      onChange={event => setMcVersion(event.target.value)}
                      className="w-full appearance-none px-3 py-2 pr-8 text-sm"
                      style={{
                        background: 'var(--color-surface-2)',
                        border: '1px solid var(--color-border)',
                        borderRadius: 6,
                        color: 'var(--color-text)',
                      }}
                    >
                      {(versions.length ? versions : MC_VERSIONS_FALLBACK).map(v => (
                        <option key={v} value={v}>{v}</option>
                      ))}
                    </select>
                    <ChevronDown
                      className="pointer-events-none absolute right-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2"
                      style={{ color: 'var(--color-text-tertiary)' }}
                    />
                  </div>
                </label>

                <label className="flex flex-col gap-1.5">
                  <span className="text-[11px]" style={{ color: 'var(--color-text-secondary)' }}>Название</span>
                  <input
                    value={instanceName}
                    onChange={event => setInstanceName(event.target.value)}
                    placeholder={suggestedName}
                    className="px-3 py-2 text-sm outline-none"
                    style={{
                      background: 'var(--color-surface-2)',
                      border: '1px solid var(--color-border)',
                      borderRadius: 6,
                      color: 'var(--color-text)',
                    }}
                  />
                </label>
              </div>
            </section>

            {/* Аккаунт */}
            <section ref={el => { sectionRefs.current[3] = el; }}>
              <SectionTitle icon={<User className="h-4 w-4" />} title="Аккаунт" />
              <p className="mt-2 flex items-start gap-2 text-xs leading-5"
                style={{ color: 'var(--color-text-secondary)' }}>
                <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0" style={{ color: 'var(--color-text-tertiary)' }} />
                Войти в Microsoft или Ely.by можно позже: Настройки → Аккаунты. Без аккаунта
                запускается только одиночная игра, а сборки с модами — нет.
              </p>
            </section>
          </div>

          {error && (
            <p className="mt-3 shrink-0 text-xs" style={{ color: 'var(--color-error)' }}>{error}</p>
          )}

          <footer className="mt-5 flex shrink-0 items-center gap-3">
            <button
              type="button"
              onClick={() => void finish()}
              disabled={creating}
              className="inline-flex items-center gap-2 px-5 py-2.5 text-sm font-semibold disabled:opacity-50"
              style={{ background: 'var(--color-primary)', color: 'var(--color-primary-text)', borderRadius: 6 }}
            >
              {creating ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
              {creating ? 'Создаём сборку…' : 'Создать сборку и начать'}
            </button>
            <button
              type="button"
              onClick={() => { localStorage.setItem(SETUP_KEY, '1'); setDismissed(true); }}
              className="px-3 py-2.5 text-sm"
              style={{ color: 'var(--color-text-secondary)' }}
            >
              Пропустить
            </button>
            {created && <span className="text-xs" style={{ color: 'var(--color-text-tertiary)' }}>Готово</span>}
          </footer>
        </div>
      </motion.div>
    </AnimatePresence>
  );
}

function SectionTitle({ icon, title }: { icon: React.ReactNode; title: string }) {
  return (
    <h2 className="flex items-center gap-2 text-sm font-semibold" style={{ color: 'var(--color-text)' }}>
      <span style={{ color: 'var(--color-text-tertiary)' }}>{icon}</span>
      {title}
    </h2>
  );
}

function Pill({ active, onClick, children, title }: {
  active: boolean; onClick: () => void; children: React.ReactNode; title?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold transition-colors"
      style={{
        background: active ? 'var(--color-primary-dim)' : 'transparent',
        border: `1px solid ${active ? 'var(--color-primary)' : 'var(--color-border)'}`,
        borderRadius: 6,
        color: active ? 'var(--color-primary)' : 'var(--color-text-secondary)',
      }}
    >
      {active && <Check className="h-3 w-3" />}
      {children}
    </button>
  );
}

function ChoiceCard({ active, title, hint, onClick }: {
  active: boolean; title: string; hint: string; onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex flex-col gap-0.5 px-3 py-2.5 text-left transition-colors"
      style={{
        background: active ? 'var(--color-primary-dim)' : 'var(--color-surface)',
        border: `1px solid ${active ? 'var(--color-primary)' : 'var(--color-border)'}`,
        borderRadius: 6,
      }}
    >
      <span className="flex items-center gap-1.5 text-xs font-semibold" style={{ color: 'var(--color-text)' }}>
        {active && <Check className="h-3 w-3" style={{ color: 'var(--color-primary)' }} />}
        {title}
      </span>
      <span className="text-[10px]" style={{ color: 'var(--color-text-tertiary)' }}>{hint}</span>
    </button>
  );
}
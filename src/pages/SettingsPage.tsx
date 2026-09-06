import { useEffect, useRef, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { motion, AnimatePresence } from 'framer-motion';
import {
  User, Cpu, Palette,
  LogIn, RefreshCw, Trash2, Check, X,
  Volume2, Code, Shield, Save, Layout, Upload, Gamepad2, Globe, Github, ExternalLink, Search, SlidersHorizontal, Bot,
} from 'lucide-react';
import { invoke } from '@/lib/invoke-shim';
import { PROVIDERS, endpointFor, defaultModelFor, modelGroups } from '@/lib/ai-providers';
import { useSettingsStore } from '@/stores/settingsStore';
import { useThemeStore } from '@/stores/themeStore';
import { useCurrentUser, useIsAuthenticated, useAuthStore } from '@/stores/authStore';
import { MicrosoftAuthOAuth } from '@/components/auth/MicrosoftAuthOAuth';
import { type ThemeId } from '@/lib/theme-engine';
import { STYLE_PRESETS } from '@/lib/style-presets';
import { ONBOARDING_BACKGROUNDS } from '@/lib/onboarding-backgrounds';
import { useUiStore } from '@/stores/uiStore';
import { readThemeFile } from '@/lib/ui-engine';
import { removeBackgroundMedia, saveBackgroundMedia } from '@/lib/background-media';
import { useLanguageStore, type Lang } from '@/stores/languageStore';
import { getAvatarUrl, getAvatarFallbackUrl } from '@/lib/avatar';
import { CachedPlayerFace } from '@/components/CachedPlayerFace';
import { CustomThemeBuilder } from '@/components/CustomThemeBuilder';
import { NavigationPanelEditor } from '@/components/NavigationPanelEditor';
import { JavaManager } from '@/components/JavaManager';
import { playClick, playError, playNav, playSuccess, playManusClick } from '@/lib/soundEngine';
import { useAchievementStore } from '@/stores/achievementStore';
import { useUpdateStore } from '@/stores/updateStore';
import { dialog } from '@/stores/dialogStore';
import { HOTKEY_DEFAULTS, HOTKEY_LABELS, normaliseHotkey, useHotkeyStore, type HotkeyAction } from '@/stores/hotkeyStore';
import manusAchievement from '@/assets/manus-achievement.png';

type Section = 'account' | 'minecraft' | 'appearance' | 'controls' | 'audio' | 'language' | 'advanced' | 'about';

interface SectionDef { id: Section; icon: any; label: string; desc: string }
const SECTIONS: SectionDef[] = [
  { id:'account',    icon:User,    label:'Аккаунты',    desc:'Microsoft, Ely.by и игровые профили' },
  { id:'minecraft',  icon:Cpu,     label:'Minecraft',  desc:'Java, память и параметры запуска' },
  { id:'appearance', icon:Palette, label:'Оформление',  desc:'Тема, панели и визуальные параметры' },
  { id:'controls',   icon:Gamepad2,label:'Управление',  desc:'Горячие клавиши и быстрые действия' },
  { id:'audio',      icon:Volume2, label:'Аудио',       desc:'Громкость, звуки и фоновая музыка' },
  { id:'language',   icon:Globe,   label:'Язык',        desc:'Язык интерфейса лаунчера' },
  { id:'advanced',   icon:Code,    label:'Дополнительно', desc:'Каталоги, API и расширенные параметры' },
  { id:'about',      icon:Shield,  label:'О лаунчере',  desc:'Версия, лицензия и системная информация' },
];

const THEMES: { id: ThemeId; name: string; preview: string; accent: string }[] = [
  { id:'clean',        name:'Clean mode',  preview:'#F5F5F2',                                   accent:'#C23345' },
  { id:'redstone',     name:'RedStone',    preview:'linear-gradient(135deg,#080000,#280707)',          accent:'#E60000' },
  { id:'system',       name:'System',      preview:'linear-gradient(135deg,#0D1117 50%,#FFFFFF 50%)', accent:'#64748B' },
  { id:'dark',         name:'Dark',        preview:'linear-gradient(135deg,#0D1117,#1C2333)',          accent:'#4299E1' },
  { id:'light',        name:'Light',       preview:'linear-gradient(135deg,#FFFFFF,#F1F3F5)',          accent:'#4299E1' },
  { id:'red-dark',     name:'Dark Red',    preview:'linear-gradient(135deg,#0A0606,#1E0F0F)',          accent:'#E74C3C' },
  { id:'green-dark',   name:'Dark Green',  preview:'linear-gradient(135deg,#06140C,#102B19)',          accent:'#1BD96A' },
  { id:'purple-dark',  name:'Dark Purple', preview:'linear-gradient(135deg,#080612,#1F183D)',          accent:'#8B5CF6' },
  { id:'pink-dark',    name:'Pink Dark',   preview:'linear-gradient(135deg,#15080F,#2A1020)',          accent:'#E91E63' },
  { id:'monochrome',   name:'Mono',        preview:'linear-gradient(135deg,#0A0A0A,#282828)',          accent:'#CCCCCC' },
  { id:'pixel',        name:'Pixel',       preview:'linear-gradient(135deg,#0D1117,#1C2333)',          accent:'#55FF55' },
  { id:'glass-white',  name:'Glass White', preview:'linear-gradient(135deg,#e8f0ff,#f5eaff 50%,#e0f7ff)', accent:'#8B5CF6' },
  { id:'ocean',       name:'Ocean',       preview:'linear-gradient(135deg,#06131C,#16495B)',          accent:'#38BDF8' },
];

const FONT_OPTIONS = [
  { id:'theme',          name:'Theme default', preview:'Aa', family:'var(--font-ui)' },
  { id:'inter',          name:'Inter',         preview:'Aa', family:"'Inter', sans-serif" },
  { id:'space-grotesk',  name:'Space Grotesk', preview:'Aa', family:"'Space Grotesk', sans-serif" },
  { id:'manrope',        name:'Manrope',       preview:'Aa', family:"'Manrope', sans-serif" },
  { id:'montserrat',     name:'Montserrat',    preview:'Aa', family:"'Montserrat', sans-serif" },
  { id:'outfit',         name:'Outfit',        preview:'Aa', family:"'Outfit', sans-serif" },
  { id:'play',           name:'Play',          preview:'Aa', family:"'Play', sans-serif" },
  { id:'comfortaa',      name:'Comfortaa',     preview:'Aa', family:"'Comfortaa', sans-serif" },
  { id:'oswald',         name:'Oswald',        preview:'Aa', family:"'Oswald', sans-serif" },
  { id:'jetbrains-mono', name:'JetBrains Mono',preview:'&gt;_', family:"'JetBrains Mono', monospace" },
  { id:'pixel',          name:'Press Start 2P',preview:'8B', family:"'Press Start 2P', monospace" },
] as const;

function Toggle({ value, onChange }: { value: boolean; onChange: (v: boolean) => void }) {
  return (
    <button onClick={() => onChange(!value)} role="switch" aria-checked={value}
      className="relative transition-colors shrink-0"
      style={{ width:38, height:20, borderRadius:2, background:value?'var(--color-primary)':'var(--color-surface-2)', border:`1px solid ${value?'var(--color-primary)':'var(--color-border)'}` }}>
      <span className="absolute transition-[left]"
        style={{ width:12, height:12, borderRadius:1, background:'var(--color-text)', top:'50%', transform:'translateY(-50%)', left:value?22:3, boxShadow:'none' }} />
    </button>
  );
}

function Row({ label, desc, children }: { label: string; desc?: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between py-3">
      <div className="flex-1 min-w-0 mr-4">
        <p className="text-sm font-semibold" style={{ color:'var(--color-text)' }}>{label}</p>
        {desc && <p className="text-xs mt-0.5" style={{ color:'var(--color-text-secondary)' }}>{desc}</p>}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}

function RangeRow({ label, desc, value, min, max, unit, onChange }: { label:string; desc?:string; value:number; min:number; max:number; unit?:string; onChange:(v:number)=>void }) {
  return (
    <div className="py-3">
      <div className="flex items-center justify-between mb-2">
        <div>
          <p className="text-sm font-semibold" style={{ color:'var(--color-text)' }}>{label}</p>
          {desc && <p className="text-xs mt-0.5" style={{ color:'var(--color-text-secondary)' }}>{desc}</p>}
        </div>
        <span className="text-sm font-bold" style={{ color:'var(--color-primary)' }}>{value}{unit}</span>
      </div>
      <input type="range" min={min} max={max} value={value} onChange={e => onChange(+e.target.value)}
        className="w-full" />
    </div>
  );
}

function InputRow({ label, desc, value, onChange, placeholder, type='text', readOnly }: { label:string; desc?:string; value:string; onChange?:(v:string)=>void; placeholder?:string; type?:string; readOnly?: boolean }) {
  return (
    <div className="py-3.5" style={{ borderBottom:'1px solid var(--color-border)' }}>
      <p className="text-sm font-semibold mb-1.5" style={{ color:'var(--color-text)' }}>{label}</p>
      {desc && <p className="text-xs mb-2" style={{ color:'var(--color-text-secondary)' }}>{desc}</p>}
      <input type={type} value={value} onChange={e => !readOnly && onChange?.(e.target.value)} placeholder={placeholder}
        readOnly={readOnly}
        className="w-full px-3 py-2.5 rounded-md text-sm font-medium"
        style={{
          background: readOnly ? 'var(--color-surface)' : 'var(--color-surface-2)',
          border:'1px solid var(--color-border)',
          color: readOnly ? 'var(--color-text-secondary)' : 'var(--color-text)',
          cursor: readOnly ? 'not-allowed' : undefined,
        }} />
    </div>
  );
}

function AccountSection() {
  const user = useCurrentUser();
  const isAuth = useIsAuthenticated();
  const { logout, switchAccount, accounts, activeAccountUuid } = useAuthStore();
  const [showAuth, setShowAuth] = useState(false);
  const signOutActiveAccount = () => {
    const next = accounts.find(account => account.uuid !== activeAccountUuid) ?? null;
    logout();
    if (!next) {
      void invoke('msa_logout').catch(() => {});
      return;
    }
    void invoke('save_frontend_account', {
      uuid: next.uuid,
      username: next.username,
      skinUrl: next.skinUrl ?? null,
      accessToken: next.accessToken ?? '',
      refreshToken: next.refreshToken ?? '',
      expiresAt: Math.floor((next.tokenExpiry ?? 0) / 1000),
      provider: next.provider ?? 'microsoft',
    }).catch(() => {});
  };

  return (
    <div>
      <h2 className="text-base font-bold mb-1" style={{ color:'var(--color-text)' }}>Аккаунт Microsoft</h2>
      <p className="text-sm mb-5" style={{ color:'var(--color-text-secondary)' }}>Управление игровыми аккаунтами Minecraft</p>
      {isAuth && user ? (
        <div className="p-4 rounded-2xl mb-4" style={{ background:'var(--color-bg)', border:'1px solid var(--color-border)' }}>
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 rounded-xl overflow-hidden shrink-0"
              style={{ background:'var(--color-bg)', border:'1px solid var(--color-border)' }}>
              <CachedPlayerFace user={user} className="w-full h-full" alt="" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="font-bold" style={{ color:'var(--color-text)' }}>{user.username}</p>
              <p className="text-xs" style={{ color:'var(--color-text-secondary)' }}>
                {user.provider === 'elyby' ? 'Аккаунт Ely.by'
                  : user.provider === 'nickname' ? 'По нику · Java без Bedrock'
                  : user.isDemo || user.provider === 'offline' ? 'Оффлайн / без лицензии'
                  : 'Аккаунт Microsoft · Minecraft Java Edition'}
              </p>
              <p className="text-xs font-mono mt-0.5" style={{ color:'var(--color-text-tertiary)' }}>{user.uuid}</p>
            </div>
          </div>
          <div className="flex gap-2 mt-3 pt-3" style={{ borderTop:'1px solid var(--color-border)' }}>
            <button onClick={() => setShowAuth(true)}
              className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold"
              style={{ background:'var(--color-surface)', border:'1px solid var(--color-border)', color:'var(--color-text-secondary)' }}>
              <RefreshCw className="w-3.5 h-3.5" />Добавить аккаунт
            </button>
            <button onClick={signOutActiveAccount}
              className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold"
              style={{ background:'rgba(231,76,60,0.1)', color:'var(--color-error)' }}>
              <X className="w-3.5 h-3.5" />Выйти
            </button>
          </div>
        </div>
      ) : (
        <div className="p-6 rounded-2xl mb-4 flex flex-col items-center gap-4"
          style={{ background:'var(--color-bg)', border:'1px solid var(--color-border)' }}>
          <div className="w-14 h-14 rounded-2xl flex items-center justify-center"
            style={{ background:'var(--color-bg)', border:'1px solid var(--color-border)', color:'var(--color-primary)' }}>
            <LogIn className="w-7 h-7" />
          </div>
          <div className="text-center">
            <p className="font-bold" style={{ color:'var(--color-text)' }}>Вход не выполнен</p>
            <p className="text-sm mt-1" style={{ color:'var(--color-text-secondary)' }}>Войдите через аккаунт Microsoft, чтобы играть в Minecraft</p>
          </div>
          <button onClick={() => setShowAuth(true)}
            className="px-5 py-2.5 rounded-xl text-sm font-bold"
            style={{ background:'transparent', color:'var(--color-primary)', border:'1px solid var(--color-primary)' }}>
            Войти в аккаунт
          </button>
        </div>
      )}

      {accounts.length > 1 && (
        <div className="mb-4">
          <p className="text-xs font-bold mb-2" style={{ color:'var(--color-text-tertiary)' }}>Другие аккаунты</p>
          <div className="space-y-1.5">
            {accounts.filter(a => a.uuid !== activeAccountUuid).map(a => (
              <button key={a.uuid} onClick={() => switchAccount(a.uuid)}
                className="w-full flex items-center gap-3 p-2.5 rounded-xl text-left hover:opacity-90 transition-opacity"
                style={{ background:'transparent', border:'1px solid var(--color-border)' }}>
                <div className="w-8 h-8 rounded-lg overflow-hidden shrink-0"
                  style={{ background:'var(--color-bg)', border:'1px solid var(--color-border)' }}>
                  <CachedPlayerFace user={a} className="w-full h-full" alt="" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold truncate" style={{ color:'var(--color-text)' }}>{a.username}</p>
                  <p className="text-[11px]" style={{ color:'var(--color-text-tertiary)' }}>
                    {a.provider === 'elyby' ? 'Ely.by' : a.provider === 'nickname' ? 'По нику' : a.isDemo || a.provider === 'offline' ? 'Оффлайн' : 'Microsoft'}
                  </p>
                </div>
                <span className="text-[10px] font-bold px-2 py-1 rounded-lg" style={{ color:'var(--color-primary)', border:'1px solid var(--color-primary)' }}>
                  Выбрать
                </span>
              </button>
            ))}
          </div>
        </div>
      )}
      <AnimatePresence>
        {showAuth && (
          <motion.div className="fixed inset-0 z-50 flex items-center justify-center"
            style={{ background:'rgba(0,0,0,0.72)', backdropFilter:'blur(4px)' }}
            initial={{ opacity:0 }} animate={{ opacity:1 }} exit={{ opacity:0 }}
            onClick={e => { if (e.target===e.currentTarget) setShowAuth(false); }}>
            <motion.div className="w-full max-w-sm rounded-2xl p-6"
              style={{ background:'var(--color-surface)', border:'1px solid var(--color-border)', boxShadow:'var(--shadow-lg)' }}
              initial={{ scale:0.93,opacity:0,y:12 }} animate={{ scale:1,opacity:1,y:0 }} exit={{ scale:0.93,opacity:0,y:12 }}
              transition={{ type:'spring', stiffness:480, damping:34 }}>
              <div className="flex items-center justify-between mb-5">
                <h3 className="font-bold" style={{ color:'var(--color-text)' }}>Вход в аккаунт</h3>
                <button onClick={() => setShowAuth(false)}><X className="w-4 h-4" style={{ color:'var(--color-text-secondary)' }} /></button>
              </div>
              <MicrosoftAuthOAuth onSuccess={() => setShowAuth(false)} onCancel={() => setShowAuth(false)} />
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function MinecraftSection() {
  const s = useSettingsStore();
  const applyGlobalRuntimeSetting = (key: 'javaPath' | 'customJvmArgs' | 'minRam' | 'maxRam', value: string | number) => {
    s.setSetting(key as never, value as never);
    const current = useSettingsStore.getState();
    void invoke('apply_global_runtime_settings', {
      minRam: Number(current.minRam),
      maxRam: Number(current.maxRam),
      javaPath: String(current.javaPath || ''),
      customJvmArgs: String(current.customJvmArgs || ''),
    }).catch(error => console.warn('Не удалось применить общие Java-настройки к сборкам:', error));
  };
  return (
    <div>
      <h2 className="text-base font-bold mb-1" style={{ color:'var(--color-text)' }}>Java и память</h2>
      <p className="text-sm mb-5" style={{ color:'var(--color-text-secondary)' }}>Настройка Java и выделяемой памяти для всех сборок. При изменении значения сразу сохраняются в профили и применяются к следующему запуску.</p>
      <InputRow label="Путь к Java" desc="Оставьте пустым для автоматического определения во всех сборках" value={s.javaPath} onChange={v => applyGlobalRuntimeSetting('javaPath',v)} placeholder="Определять автоматически" />
      <JavaManager selectedPath={s.javaPath} onSelect={path => applyGlobalRuntimeSetting('javaPath', path)} />
      <InputRow label="Аргументы JVM" desc="Дополнительные аргументы JVM для всех сборок. -Xms и -Xmx задаются ползунками памяти ниже и не могут их переопределить." value={s.customJvmArgs} onChange={v => applyGlobalRuntimeSetting('customJvmArgs',v)} placeholder="-XX:+UseG1GC -XX:G1NewSizePercent=20" />
      <RangeRow label="Минимум памяти" value={s.minRam} min={512} max={s.maxRam} unit=" МБ" onChange={v => applyGlobalRuntimeSetting('minRam',v)} />
      <RangeRow label="Максимум памяти" value={s.maxRam} min={s.minRam} max={32768} unit=" МБ" onChange={v => applyGlobalRuntimeSetting('maxRam',v)} />
      <Row label="Сворачивать лаунчер при запуске игры" desc="Сворачивать Portal Launcher при запуске Minecraft">
        <Toggle value={s.closeLauncherOnStart} onChange={v => s.setSetting('closeLauncherOnStart',v)} />
      </Row>
      <Row label="Показывать snapshot-версии" desc="Добавлять предрелизы и snapshot-версии в выбор версии">
        <Toggle value={s.showSnapshots} onChange={v => s.setSetting('showSnapshots',v)} />
      </Row>
      <Row label="Автоматически устанавливать зависимости" desc="Автоматически устанавливать Fabric API, зависимости Forge и другие нужные компоненты">
        <Toggle value={s.autoInstallDeps} onChange={v => s.setSetting('autoInstallDeps',v)} />
      </Row>
      <Row label="Сохранять логи игры" desc="Сохранять логи Minecraft в каталоге игры">
        <Toggle value={s.keepLogs} onChange={v => s.setSetting('keepLogs',v)} />
      </Row>
    </div>
  );
}

function SegRow({ label, desc, value, options, onChange }: { label: string; desc?: string; value: string; options: { id: string; label: string }[]; onChange: (v: string) => void }) {
  return (
    <Row label={label} desc={desc}>
      <div className="flex rounded-xl overflow-hidden" style={{ border: '1px solid var(--color-border)' }}>
        {options.map(o => (
          <button key={o.id} onClick={() => onChange(o.id)}
            className="px-3 py-1.5 text-xs font-bold transition-all"
            style={value === o.id
              ? { background: 'var(--color-primary)', color: 'var(--color-primary-text)' }
              : { color: 'var(--color-text-secondary)' }}>
            {o.label}
          </button>
        ))}
      </div>
    </Row>
  );
}

function AppearanceSection() {
  const { t } = useTranslation();
  const { themeId, setTheme } = useThemeStore();
  const ui = useUiStore();
  const panelAppearance = ui.navMode === 'notch' ? ui.notchPanelAppearance : ui.sidebarPanelAppearance;
  const setPanelAppearance = (key: keyof typeof panelAppearance, value: unknown) => {
    const next = { ...panelAppearance, [key]: value };
    ui.set(ui.navMode === 'notch' ? 'notchPanelAppearance' : 'sidebarPanelAppearance', next);
  };
  const fileRef = useRef<HTMLInputElement | null>(null);
  const backgroundVideoFileRef = useRef<HTMLInputElement | null>(null);
  const [cssDraft, setCssDraft] = useState(ui.customCss);
  const [cssSaved, setCssSaved] = useState(false);

  async function importVideo(file?: File | null) {
    if (!file || !file.type.startsWith('video/')) return;
    if (file.size > 64 * 1024 * 1024) return;
    try {
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result ?? ''));
        reader.onerror = () => reject(new Error('Unable to read video'));
        reader.readAsDataURL(file);
      });
      const token = await saveBackgroundMedia('video', dataUrl);
      ui.set('backgroundVideo', token);
    } catch {
      // Keep the previous video if the browser storage quota is unavailable.
    }
  }

  async function importTheme(f?: File | null) {
    if (!f) return;
    const text = await readThemeFile(f);
    ui.set('customCss', text);
    ui.set('customCssName', f.name);
    ui.set('customCssEnabled', true);
    setCssDraft(text);
  }

  const applyWorkspacePreset = (preset: 'focused' | 'balanced' | 'roomy') => {
    const values = preset === 'focused'
      ? { titlebarHeight: 24, uiScale: 92, compact: true, cornerRadius: 10 }
      : preset === 'roomy'
        ? { titlebarHeight: 40, uiScale: 108, compact: false, cornerRadius: 18 }
        : { titlebarHeight: 26, uiScale: 100, compact: false, cornerRadius: 12 };
    (Object.entries(values) as Array<[keyof typeof values, number | boolean]>).forEach(([key, value]) => ui.set(key as any, value as any));
  };

  return (
    <div>
      <h2 className="text-base font-bold mb-1" style={{ color: 'var(--color-text)' }}>{t('settings.appearanceUi.title')}</h2>
      <p className="text-sm mb-5" style={{ color: 'var(--color-text-secondary)' }}>{t('settings.appearanceUi.subtitle')}</p>

      <div className="grid grid-cols-3 gap-3 mb-6">
        {THEMES.map(t => (
          <button key={t.id} onClick={() => setTheme(t.id)}
            data-testid={`theme-${t.id}`}
            className="theme-swatch-square relative p-3 text-left transition-colors"
            style={{
              background:'var(--color-surface)',
              border: `${themeId === t.id ? 2 : 1}px solid ${themeId === t.id ? t.accent : 'var(--color-border)'}`,
              overflow:'hidden',
              boxShadow:'none',
            }}>
            <span aria-hidden="true" className="absolute inset-x-0 top-0 h-[3px]" style={{ background:t.accent }} />
            <p className="text-[11px] font-bold truncate" style={{ color: themeId === t.id ? t.accent : 'var(--color-text)' }}>{t.name}</p>
            <p className="mt-1 text-[10px]" style={{ color:'var(--color-text-tertiary)' }}>{themeId === t.id ? 'Активна' : 'Палитра'}</p>
          </button>
        ))}
      </div>
      <CustomThemeBuilder />

      {/* ===================== Typography ===================== */}
      <div className="minimal-section-title">
        <Palette className="w-4 h-4" style={{ color: 'var(--color-primary)' }} />
        <h3 className="text-sm font-black tracking-wide uppercase" style={{ color: 'var(--color-text)' }}>Типографика</h3>
      </div>
      <p className="text-xs mb-3" style={{ color: 'var(--color-text-secondary)' }}>
        Выберите шрифт интерфейса. Выбор сохраняется при смене темы.
      </p>
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
        {FONT_OPTIONS.map(font => {
          const selected = ui.fontFamily === font.id;
          return (
            <button key={font.id} onClick={() => ui.set('fontFamily', font.id as any)}
              className="flex items-center gap-2.5 p-2.5 text-left transition-all"
              style={{
                borderRadius:'var(--radius-button)',
                background: selected ? 'var(--color-primary-dim)' : 'var(--color-surface-2)',
                border:`1px solid ${selected ? 'var(--color-primary)' : 'var(--color-border)'}`,
              }}>
              <span className="w-8 text-center text-lg font-bold shrink-0" style={{ color:'var(--color-primary)', fontFamily:font.family }}>{font.preview}</span>
              <span className="text-[11px] font-semibold truncate" style={{ color:'var(--color-text)', fontFamily:font.family }}>{font.name}</span>
            </button>
          );
        })}
      </div>

      {/* ===================== Search ===================== */}
      <div className="minimal-section-title">
        <Search className="w-4 h-4" style={{ color: 'var(--color-primary)' }} />
        <h3 className="text-sm font-black tracking-wide uppercase" style={{ color: 'var(--color-text)' }}>Поиск</h3>
      </div>
      <p className="text-xs mb-3" style={{ color: 'var(--color-text-secondary)' }}>
        Выберите эффект, который появляется после успешной установки контента из поиска или со страницы проекта.
      </p>
      <SegRow label="Эффект установки" desc="Показывать эффект с иконкой проекта после успешной установки"
        value={ui.installEffect}
        options={[{ id:'icon-drop', label:'Падение иконки' }, { id:'zoom-bounce', label:'Увеличение' }, { id:'orbit', label:'Орбита' }, { id:'shimmer', label:'Блик' }, { id:'none', label:'Выключено' }]}
        onChange={v => ui.set('installEffect', v as any)} />
      <Row label="Иконка источника контента" desc="Показывать некликабельную иконку Modrinth или CurseForge рядом с действиями в строках контента">
        <Toggle value={ui.showContentSourceIcon} onChange={value => ui.set('showContentSourceIcon', value)} />
      </Row>
      <SegRow label="Возврат со страницы проекта" desc="Выберите положение для Discover и «Найти проекты» после закрытия страницы Modrinth или CurseForge"
        value={ui.searchDetailReturnPosition}
        options={[{ id:'remember', label:'Предыдущее место' }, { id:'top', label:'Верх' }, { id:'bottom', label:'Низ' }]}
        onChange={v => ui.set('searchDetailReturnPosition', v as any)} />

      {/* ===================== More ===================== */}
      <div className="minimal-section-title">
        <Layout className="w-4 h-4" style={{ color: 'var(--color-primary)' }} />
        <h3 className="text-sm font-black tracking-wide uppercase" style={{ color: 'var(--color-text)' }}>{t('settings.appearanceUi.more')}</h3>
      </div>
      <p className="text-xs mb-3" style={{ color: 'var(--color-text-secondary)' }}>
        {t('settings.appearanceUi.moreDescription')}
      </p>

      <SegRow label="Навигация" desc="Постоянная боковая панель или плавающая Notch-панель"
        value={ui.navMode}
        options={[{ id: 'sidebar', label: 'Боковая панель' }, { id: 'notch', label: 'Notch-панель' }]}
        onChange={v => ui.set('navMode', v as any)} />
      <SegRow label="Стиль интерфейса" desc="Классический сохраняет более строгие поверхности, новый использует мягкие акценты и расширенные скругления — для Notch и Sidebar одинаково"
        value={ui.uiMode}
        options={[{ id: 'old', label: 'Классический' }, { id: 'new', label: 'Новый' }]}
        onChange={v => { ui.set('uiMode', v as any); ui.set('panelVersion', v as any); }} />

      <SegRow label="Материал и форма" desc="Glassmorphism, квадратный Quadral, ромбовидный FallOff или системный AboutS. Цветовая тема остаётся отдельной настройкой выше."
        value={ui.stylePreset}
        options={STYLE_PRESETS.map(preset => ({ id:preset.id, label:preset.title }))}
        onChange={value => ui.set('stylePreset', value as any)} />

      {ui.navMode === 'notch' && (
        <>
          <SegRow label="Положение Notch-панели" desc="К какому краю окна прикреплена панель"
            value={ui.notchSide}
            options={[{ id: 'top', label: 'Сверху' }, { id: 'bottom', label: 'Снизу' }, { id: 'left', label: 'Слева' }, { id: 'right', label: 'Справа' }]}
            onChange={v => ui.set('notchSide', v as any)} />
          <RangeRow label="Зона наведения" desc="Размер области, которая открывает Notch-панель"
            value={ui.notchHotzone} min={18} max={96} unit=" px" onChange={v => ui.set('notchHotzone', v)} />
          <Row label="Открывать на tab" desc="Открывать Notch-панель при наведении прямо на её ручку/tab">
            <Toggle value={ui.notchOpenOnTab} onChange={v => ui.set('notchOpenOnTab', v)} />
          </Row>
          <RangeRow label="Зона над tab" desc="Дополнительная область чуть выше ручки, которая также открывает Notch-панель"
            value={ui.notchAboveHotzone} min={0} max={48} unit=" px" onChange={v => ui.set('notchAboveHotzone', v)} />
          <RangeRow label="Размер Notch-панели" desc="Масштаб самой выезжающей панели и её кнопок"
            value={ui.notchDockScale} min={70} max={150} unit=" %" onChange={v => ui.set('notchDockScale', v)} />
          <RangeRow label="Задержка закрытия" desc="Кратко удерживать Notch-панель открытой при переходе между её кнопками" value={ui.notchCloseDelay} min={0} max={800} unit=" мс" onChange={v => ui.set('notchCloseDelay', v)} />
          <Row label="Всегда показывать" desc="Закрепить Notch-панель в открытом состоянии">
            <Toggle value={ui.notchPinned} onChange={v => ui.set('notchPinned', v)} />
          </Row>
        </>
      )}
      <NavigationPanelEditor />

      <div className="minimal-section-title">
        <Layout className="w-4 h-4" style={{ color: 'var(--color-primary)' }} />
        <h3 className="text-sm font-black tracking-wide uppercase" style={{ color: 'var(--color-text)' }}>{t('settings.appearanceUi.workspace')}</h3>
      </div>
      <p className="text-xs mb-3" style={{ color: 'var(--color-text-secondary)' }}>{t('settings.appearanceUi.workspaceDescription')}</p>
      <div className="grid grid-cols-3 gap-2 mb-3">
        {[
          { id:'focused' as const, title:t('settings.appearanceUi.focused'), desc:t('settings.appearanceUi.focusedDescription') },
          { id:'balanced' as const, title:t('settings.appearanceUi.balanced'), desc:t('settings.appearanceUi.balancedDescription') },
          { id:'roomy' as const, title:t('settings.appearanceUi.roomy'), desc:t('settings.appearanceUi.roomyDescription') },
        ].map(preset => (
          <button key={preset.id} onClick={() => applyWorkspacePreset(preset.id)} className="p-3 text-left transition-all" style={{ borderRadius: 'var(--radius-card)', background: 'var(--color-surface-2)', border: '1px solid var(--color-border)' }}>
            <span className="block text-xs font-bold" style={{ color: 'var(--color-text)' }}>{preset.title}</span>
            <span className="mt-1 block text-[10px]" style={{ color: 'var(--color-text-secondary)' }}>{preset.desc}</span>
          </button>
        ))}
      </div>
      <RangeRow label={t('settings.appearanceUi.titlebarHeight')} desc={t('settings.appearanceUi.titlebarHeightDescription')} value={ui.titlebarHeight} min={24} max={52} unit="px" onChange={v => ui.set('titlebarHeight', v)} />
      <Row label="Адаптивный цвет верхней панели" desc="Верхняя панель мягко подстраивается под поверхность открытой страницы, как Adaptive Tab Color.">
        <Toggle value={ui.adaptiveTitlebarColor} onChange={value => ui.set('adaptiveTitlebarColor', value)} />
      </Row>

      <div className="minimal-section-title">
        <SlidersHorizontal className="w-4 h-4" style={{ color: 'var(--color-primary)' }} />
        <h3 className="text-sm font-black tracking-wide uppercase" style={{ color: 'var(--color-text)' }}>{t('settings.appearanceUi.panelPolish')}</h3>
      </div>
      <p className="text-xs mb-3" style={{ color: 'var(--color-text-secondary)' }}>{t('settings.appearanceUi.panelPolishDescription')}</p>
      <div className="mb-3 px-1 py-1 text-xs font-bold" style={{ background:'transparent', color:'var(--color-primary)' }}>
        Редактор: {ui.navMode === 'notch' ? 'Notch-панель' : 'Боковая панель'} · изменения не влияют на другой режим
      </div>
      <SegRow label={t('settings.appearanceUi.panelAlignment')} desc={t('settings.appearanceUi.panelAlignmentDescription')}
        value={panelAppearance.alignment}
        options={[{ id:'start', label:t('settings.appearanceUi.start') }, { id:'center', label:t('settings.appearanceUi.center') }, { id:'end', label:t('settings.appearanceUi.end') }]}
        onChange={v => setPanelAppearance('alignment', v)} />
      <RangeRow label={t('settings.appearanceUi.panelGap')} desc={t('settings.appearanceUi.panelGapDescription')} value={panelAppearance.gap} min={0} max={16} unit="px" onChange={v => setPanelAppearance('gap', v)} />
      <RangeRow label={t('settings.appearanceUi.panelEdgePadding')} desc={t('settings.appearanceUi.panelEdgePaddingDescription')} value={panelAppearance.edgePadding} min={0} max={32} unit="px" onChange={v => setPanelAppearance('edgePadding', v)} />
      <RangeRow label={t('settings.appearanceUi.panelOpacity')} desc={t('settings.appearanceUi.panelOpacityDescription')} value={panelAppearance.opacity} min={45} max={100} unit="%" onChange={v => setPanelAppearance('opacity', v)} />
      <RangeRow label={t('settings.appearanceUi.panelBlur')} desc={t('settings.appearanceUi.panelBlurDescription')} value={panelAppearance.blur} min={0} max={36} unit="px" onChange={v => setPanelAppearance('blur', v)} />
      <SegRow label={t('settings.appearanceUi.panelShadow')} desc={t('settings.appearanceUi.panelShadowDescription')} value={panelAppearance.shadow}
        options={[{ id:'none', label:t('settings.appearanceUi.off') }, { id:'soft', label:t('settings.appearanceUi.soft') }, { id:'strong', label:t('settings.appearanceUi.strong') }]}
        onChange={v => setPanelAppearance('shadow', v)} />
      <SegRow label={t('settings.appearanceUi.panelBorder')} desc={t('settings.appearanceUi.panelBorderDescription')} value={panelAppearance.border}
        options={[{ id:'none', label:t('settings.appearanceUi.none') }, { id:'subtle', label:t('settings.appearanceUi.subtle') }, { id:'strong', label:t('settings.appearanceUi.strong') }]}
        onChange={v => setPanelAppearance('border', v)} />
      <div className="mb-3 px-3 py-2 text-xs" style={{ border:'1px solid var(--color-border)', background:'var(--color-surface)' }}>
        Активные элементы используют только квадратную обводку в цвете темы. Круглые, точечные и pill-индикаторы отключены для всего launcher.
      </div>
      <SegRow label={t('settings.appearanceUi.navigationLabels')} desc={t('settings.appearanceUi.navigationLabelsDescription')} value={panelAppearance.labels}
        options={[{ id:'icons', label:t('settings.appearanceUi.icons') }, { id:'hover', label:t('settings.appearanceUi.hover') }, { id:'always', label:t('settings.appearanceUi.always') }]}
        onChange={v => setPanelAppearance('labels', v)} />

      <RangeRow label={t('settings.appearanceUi.interfaceScale')} desc={t('settings.appearanceUi.interfaceScaleDescription')}
        value={ui.uiScale} min={60} max={180} unit="%" onChange={v => ui.set('uiScale', v)} />
      <RangeRow label="Скругление углов" desc="Скругление карточек, кнопок и окон"
        value={ui.cornerRadius} min={0} max={26} unit="px" onChange={v => ui.set('cornerRadius', v)} />
      <Row label="Анимации" desc="Переходы и движение элементов интерфейса">
        <Toggle value={ui.animations} onChange={v => ui.set('animations', v)} />
      </Row>
      <Row label="Размытие / стекло" desc="Эффекты матового стекла на панелях">
        <Toggle value={ui.blur} onChange={v => ui.set('blur', v)} />
      </Row>
      <Row label="Компактный режим" desc="Более плотные списки и карточки">
        <Toggle value={ui.compact} onChange={v => ui.set('compact', v)} />
      </Row>
      <div className="minimal-section-title">
        <Palette className="w-4 h-4" style={{ color: 'var(--color-primary)' }} />
        <h3 className="text-sm font-black tracking-wide uppercase" style={{ color: 'var(--color-text)' }}>Визуальный материал</h3>
      </div>
      <RangeRow label="Прозрачность интерфейса" desc="Прозрачность интерфейса лаунчера поверх выбранного фона" value={ui.interfaceOpacity} min={35} max={100} unit="%" onChange={v => ui.set('interfaceOpacity', v)} />
      <RangeRow label="Прозрачность поверхностей" desc="Плотность плавающих карточек и поверхностей интерфейса" value={ui.surfaceOpacity} min={55} max={100} unit="%" onChange={v => ui.set('surfaceOpacity', v)} />
      <RangeRow label="Контраст границ" desc="Насколько заметны контуры в выбранной теме" value={ui.borderStrength} min={45} max={150} unit="%" onChange={v => ui.set('borderStrength', v)} />
      <RangeRow label="Глубина теней" desc="Сила теней у панелей и окон" value={ui.shadowStrength} min={0} max={150} unit="%" onChange={v => ui.set('shadowStrength', v)} />
      <RangeRow label="Скорость движения" desc="Множитель скорости необязательного движения интерфейса" value={ui.motionSpeed} min={50} max={150} unit="%" onChange={v => ui.set('motionSpeed', v)} />
      <Row label="Свечение акцента" desc="Показывать мягкий цветной свет темы на фоне приложения">
        <Toggle value={ui.accentGlow} onChange={v => ui.set('accentGlow', v)} />
      </Row>
      {ui.accentGlow && <RangeRow label="Сила свечения акцента" desc="Интенсивность фонового акцентного света" value={ui.accentGlowStrength} min={0} max={150} unit="%" onChange={v => ui.set('accentGlowStrength', v)} />}
      <SegRow label="Цвет текста" desc="Принудительно выбрать чёрный или белый текст поверх темы"
        value={ui.textColorOverride}
        options={[{ id: 'auto', label: 'Авто' }, { id: 'black', label: 'Чёрный' }, { id: 'white', label: 'Белый' }]}
        onChange={v => ui.set('textColorOverride', v as any)} />
      <RangeRow label="Прозрачность фона" value={ui.backgroundOpacity} min={0} max={100} unit="%"
        onChange={v => ui.set('backgroundOpacity', v)} />
      <div className="minimal-section-title">
        <Palette className="w-4 h-4" style={{ color: 'var(--color-primary)' }} />
        <h3 className="text-sm font-black tracking-wide uppercase" style={{ color: 'var(--color-text)' }}>Фон</h3>
      </div>
      <p className="mb-3 text-xs" style={{ color: 'var(--color-text-secondary)' }}>Выберите встроенный фон или отключите изображение. Настройки прозрачности и читаемости ниже применяются сразу.</p>
      <div className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-3">
        <button onClick={() => ui.set('backgroundImage', '')} className="overflow-hidden text-left" style={{ border:`2px solid ${ui.backgroundImage ? 'transparent' : 'var(--color-primary)'}`, borderRadius:'var(--radius-card)', background:'var(--color-surface-2)' }}>
          <div className="aspect-[16/9]" style={{ background:'var(--color-bg)' }} /><p className="px-2 py-1.5 text-[10px] font-bold">Без изображения</p>
        </button>
        {ONBOARDING_BACKGROUNDS.map(background => <button key={background.id} onClick={() => ui.set('backgroundImage', background.src)} className="group overflow-hidden text-left" style={{ border:`2px solid ${ui.backgroundImage === background.src ? 'var(--color-primary)' : 'transparent'}`, borderRadius:'var(--radius-card)', background:'var(--color-surface-2)' }}>
          <div className="aspect-[16/9] bg-cover bg-center transition-transform duration-200 group-hover:scale-[1.03]" style={{ backgroundImage:`url("${background.src}")` }} /><p className="truncate px-2 py-1.5 text-[10px] font-bold">{background.name}</p>
        </button>)}
      </div>
      <RangeRow label="Читаемость фона" desc="Тёмный защитный слой за карточками, текстом и кнопками на вашем изображении" value={ui.backgroundReadability} min={0} max={90} unit="%" onChange={v => ui.set('backgroundReadability', v)} />
      <SegRow label="Заполнение фона" desc="Как выбранное фоновое изображение заполняет лаунчер" value={ui.backgroundFit}
        options={[{ id:'cover', label:'Заполнить' }, { id:'contain', label:'Вписать' }, { id:'stretch', label:'Растянуть' }, { id:'tile', label:'Плитка' }]}
        onChange={v => ui.set('backgroundFit', v as any)} />
      <SegRow label="Положение фона" desc="Какая часть изображения остаётся видимой в лаунчере" value={ui.backgroundPosition}
        options={[{ id:'center', label:'По центру' }, { id:'top', label:'Сверху' }, { id:'bottom', label:'Снизу' }, { id:'left', label:'Слева' }, { id:'right', label:'Справа' }]}
        onChange={v => ui.set('backgroundPosition', v as any)} />
      <RangeRow label="Размытие фона" desc="Мягкое размытие только пользовательского фонового изображения" value={ui.backgroundBlur} min={0} max={30} unit="px" onChange={v => ui.set('backgroundBlur', v)} />
      <RangeRow label="Насыщенность фона" desc="Интенсивность цветов пользовательского фонового изображения" value={ui.backgroundSaturation} min={0} max={180} unit="%" onChange={v => ui.set('backgroundSaturation', v)} />
      <Row label={t('settings.appearanceUi.videoBackground')} desc={t('settings.appearanceUi.videoBackgroundDescription')}>
        <div className="flex items-center gap-2">
          <input ref={backgroundVideoFileRef} type="file" accept="video/mp4,video/webm,video/ogg" hidden onChange={event => void importVideo(event.target.files?.[0])} />
          <button onClick={() => backgroundVideoFileRef.current?.click()} className="flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-xs font-bold" style={{ background:'var(--color-primary)', color:'var(--color-primary-text)' }}><Upload className="h-3.5 w-3.5" />{t('settings.appearanceUi.chooseVideo')}</button>
          {ui.backgroundVideo && <button onClick={() => { void removeBackgroundMedia('video'); ui.set('backgroundVideo', ''); }} className="rounded-xl px-3 py-1.5 text-xs font-bold" style={{ background:'var(--color-surface-2)', color:'var(--color-text-secondary)', border:'1px solid var(--color-border)' }}>{t('settings.appearanceUi.removeVideo')}</button>}
        </div>
      </Row>
      {ui.backgroundVideo && <>
        <RangeRow label={t('settings.appearanceUi.videoOpacity')} desc={t('settings.appearanceUi.videoOpacityDescription')} value={ui.backgroundVideoOpacity} min={0} max={80} unit="%" onChange={v => ui.set('backgroundVideoOpacity', v)} />
        <Row label={t('settings.appearanceUi.muteVideo')} desc={t('settings.appearanceUi.muteVideoDescription')}>
          <Toggle value={ui.backgroundVideoMuted} onChange={v => ui.set('backgroundVideoMuted', v)} />
        </Row>
      </>}

      {/* ===================== CSS / .prtheme ===================== */}
      <div className="minimal-section-title">
        <Code className="w-4 h-4" style={{ color: 'var(--color-primary)' }} />
        <h3 className="text-sm font-black tracking-wide uppercase" style={{ color: 'var(--color-text)' }}>Пользовательский CSS (.prtheme)</h3>
      </div>
      <p className="text-xs mb-3" style={{ color: 'var(--color-text-secondary)' }}>
        Импортируйте файл <span style={{ color: 'var(--color-primary)' }}>.prtheme</span> (обычный CSS), чтобы изменить цвета, отступы и расположение элементов интерфейса.
      </p>

      <div className="flex items-center gap-2 mb-3">
        <input ref={fileRef} type="file" accept=".prtheme,.css,text/css" hidden
          onChange={e => importTheme(e.target.files?.[0])} />
        <button onClick={() => fileRef.current?.click()}
          className="flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-bold"
          style={{ background: 'var(--color-primary)', color: 'var(--color-primary-text)' }}>
          <Upload className="w-3.5 h-3.5" />Импортировать .prtheme
        </button>
        {ui.customCssName && (
          <span className="text-xs" style={{ color: 'var(--color-text-secondary)' }}>{ui.customCssName}</span>
        )}
        <div className="flex-1" />
        <Toggle value={ui.customCssEnabled} onChange={v => ui.set('customCssEnabled', v)} />
      </div>

      <textarea value={cssDraft} onChange={e => { setCssDraft(e.target.value); setCssSaved(false); }}
        spellCheck={false} rows={10}
        placeholder={':root { --color-primary: #DA2A3F; }\n.scroll-area { padding: 12px; }'}
        className="w-full px-3 py-2.5 rounded-xl text-xs"
        style={{
          background: 'var(--color-surface-2)', border: '1px solid var(--color-border)',
          color: 'var(--color-text)', fontFamily: "'JetBrains Mono', 'Courier New', monospace", resize: 'vertical',
        }} />
      <div className="flex gap-2 mt-2">
        <button onClick={() => { ui.set('customCss', cssDraft); setCssSaved(true); setTimeout(() => setCssSaved(false), 1800); }}
          className="flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-bold"
          style={{ background: cssSaved ? 'rgba(46,204,113,0.15)' : 'var(--color-primary)', color: cssSaved ? '#2ECC71' : 'var(--color-primary-text)' }}>
          {cssSaved ? <><Check className="w-3.5 h-3.5" />Применено</> : <><Save className="w-3.5 h-3.5" />Применить CSS</>}
        </button>
        <button onClick={() => { ui.set('customCss', ''); ui.set('customCssName', ''); setCssDraft(''); }}
          className="flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-bold"
          style={{ background: 'rgba(231,76,60,0.1)', color: 'var(--color-error)' }}>
          <Trash2 className="w-3.5 h-3.5" />Очистить
        </button>
        <div className="flex-1" />
        <button onClick={() => ui.reset()}
          className="px-4 py-2 rounded-xl text-xs font-bold"
          style={{ background: 'var(--color-surface-2)', color: 'var(--color-text-secondary)', border: '1px solid var(--color-border)' }}>
          Сбросить оформление
        </button>
      </div>

    </div>
  );
}

function ControlsSection() {
  const bindings = useHotkeyStore(state => state.bindings);
  const setBinding = useHotkeyStore(state => state.setBinding);
  const keyboardNavigationEnabled = useHotkeyStore(state => state.keyboardNavigationEnabled);
  const setKeyboardNavigationEnabled = useHotkeyStore(state => state.setKeyboardNavigationEnabled);
  const reset = useHotkeyStore(state => state.reset);
  const [capturing, setCapturing] = useState<HotkeyAction | null>(null);

  useEffect(() => {
    if (!capturing) return;
    const record = (event: KeyboardEvent) => {
      event.preventDefault();
      event.stopPropagation();
      if (event.key === 'Escape') { setCapturing(null); return; }
      const chord = normaliseHotkey(event);
      if (!chord) return;
      const collision = (Object.entries(bindings).find(([action, value]) => action !== capturing && value === chord)?.[0] ?? null) as HotkeyAction | null;
      if (collision) {
        dialog.alert(`Сочетание ${chord} уже назначено действию «${HOTKEY_LABELS[collision].label}».`, { title:'Конфликт сочетаний', danger:false });
        return;
      }
      setBinding(capturing, chord);
      setCapturing(null);
    };
    window.addEventListener('keydown', record, true);
    return () => window.removeEventListener('keydown', record, true);
  }, [bindings, capturing, setBinding]);

  return <div className="max-w-3xl space-y-4">
    <section className="rounded-2xl p-5" style={{ background:'var(--color-surface)', border:'1px solid var(--color-border)' }}>
      <p className="text-[10px] font-black uppercase tracking-[0.16em]" style={{ color:'var(--color-primary)' }}>Горячие клавиши</p>
      <h2 className="mt-1 text-lg font-black" style={{ color:'var(--color-text)' }}>Быстрые действия лаунчера</h2>
      <p className="mt-1 text-xs leading-relaxed" style={{ color:'var(--color-text-secondary)' }}>Сочетания работают на обычных страницах. В поле ввода они не мешают печатать, а Escape сначала закрывает открытый редактор, предпросмотр или диалог.</p>
    </section>
    <Row label="Навигация стрелками и Enter" desc="Стрелки перемещают фокус между кнопками, а Enter запускает выбранное действие. В полях ввода, редакторах и открытых окнах управление не перехватывается."><Toggle value={keyboardNavigationEnabled} onChange={setKeyboardNavigationEnabled} /></Row>
    <section className="overflow-hidden rounded-2xl" style={{ background:'var(--color-surface)', border:'1px solid var(--color-border)' }}>
      {(Object.keys(HOTKEY_LABELS) as HotkeyAction[]).map(action => <div key={action} className="flex items-center gap-4 px-4 py-3" style={{ borderBottom:'1px solid var(--color-border)' }}><div className="min-w-0 flex-1"><p className="text-sm font-bold" style={{ color:'var(--color-text)' }}>{HOTKEY_LABELS[action].label}</p><p className="mt-0.5 text-[11px]" style={{ color:'var(--color-text-secondary)' }}>{HOTKEY_LABELS[action].description}</p></div><button onClick={() => setCapturing(action)} className="min-w-28 rounded-xl px-3 py-2 text-xs font-black" style={{ background:capturing === action ? 'var(--color-primary)' : 'var(--color-surface-2)', color:capturing === action ? 'var(--color-primary-text)' : 'var(--color-text)', border:`1px solid ${capturing === action ? 'var(--color-primary)' : 'var(--color-border)'}` }}>{capturing === action ? 'Нажмите…' : bindings[action]}</button></div>)}
      <div className="flex items-center justify-between gap-3 px-4 py-3"><span className="text-[11px]" style={{ color:'var(--color-text-tertiary)' }}>Изменения сохраняются автоматически.</span><button onClick={() => reset()} className="rounded-xl px-3 py-2 text-xs font-bold" style={{ background:'var(--color-surface-2)', color:'var(--color-text-secondary)', border:'1px solid var(--color-border)' }}>Сбросить: {HOTKEY_DEFAULTS.home}, …</button></div>
    </section>
  </div>;
}

function AudioSection() {
  const s = useSettingsStore();
  const musicFileRef = useRef<HTMLInputElement | null>(null);
  const [musicError, setMusicError] = useState('');
  const chooseMusic = async (file?: File | null) => {
    if (!file) return;
    if (!file.type.startsWith('audio/') || file.size > 12 * 1024 * 1024) { setMusicError('Выберите файл MP3, WAV или OGG размером до 12 МБ.'); return; }
    const data = await new Promise<string>((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result ?? '')); reader.onerror = () => reject(new Error('Не удалось прочитать аудиофайл')); reader.readAsDataURL(file); });
    s.update({ backgroundMusic: data, backgroundMusicName: file.name }); setMusicError('');
  };
  return (
    <div>
      <h2 className="text-base font-bold mb-1" style={{ color:'var(--color-text)' }}>Аудио</h2>
      <p className="text-sm mb-5" style={{ color:'var(--color-text-secondary)' }}>Настройки звука и громкости</p>
      <RangeRow label="Общая громкость" value={s.masterVolume} min={0} max={100} unit="%" onChange={v => s.setSetting('masterVolume',v)} />
      <Row label="Звуки интерфейса" desc="Воспроизводить звуки при взаимодействии, например при нажатии кнопок">
        <Toggle value={s.uiSounds} onChange={v => s.setSetting('uiSounds',v)} />
      </Row>
      <SegRow label="Звуковой профиль" desc="«Мягкий» даёт спокойную обратную связь, «Аркада» — более заметную, «Минимальный» отключает синтезированные эффекты" value={s.uiSoundStyle} options={[{ id:'soft', label:'Мягкий' }, { id:'arcade', label:'Аркада' }, { id:'minimal', label:'Минимальный' }]} onChange={v => s.setSetting('uiSoundStyle', v as any)} />
      <Row label="Звук успешной установки" desc="Воспроизводить позитивный звук после успешной установки"><Toggle value={s.playInstallSound} onChange={v => s.setSetting('playInstallSound',v)} /></Row>
      <Row label="Звук ошибки" desc="Воспроизводить предупреждающий звук при сбое действия"><Toggle value={s.playErrorSound} onChange={v => s.setSetting('playErrorSound',v)} /></Row>
      <Row label="Звук навигации" desc="Воспроизводить короткий звук при открытии навигационных панелей"><Toggle value={s.playNavigationSound} onChange={v => s.setSetting('playNavigationSound',v)} /></Row>
      <Row label="Проверить звуки интерфейса" desc="Прослушать звук нажатия, успеха, навигации и ошибки">
        <div className="flex gap-1"><button onClick={playClick} className="rounded-lg px-2 py-1 text-[10px] font-bold" style={{ background:'var(--color-surface-2)', color:'var(--color-text-secondary)', border:'1px solid var(--color-border)' }}>Клик</button><button onClick={playSuccess} className="rounded-lg px-2 py-1 text-[10px] font-bold" style={{ background:'var(--color-surface-2)', color:'var(--color-text-secondary)', border:'1px solid var(--color-border)' }}>Успех</button><button onClick={playNav} className="rounded-lg px-2 py-1 text-[10px] font-bold" style={{ background:'var(--color-surface-2)', color:'var(--color-text-secondary)', border:'1px solid var(--color-border)' }}>Навигация</button><button onClick={playError} className="rounded-lg px-2 py-1 text-[10px] font-bold" style={{ background:'var(--color-surface-2)', color:'var(--color-text-secondary)', border:'1px solid var(--color-border)' }}>Ошибка</button></div>
      </Row>
      <div className="mt-6 rounded-2xl p-4" style={{ background:'var(--color-surface-2)', border:'1px solid var(--color-border)' }}>
        <p className="text-sm font-black" style={{ color:'var(--color-text)' }}>Фоновая музыка</p><p className="mt-1 text-xs" style={{ color:'var(--color-text-secondary)' }}>Выберите свой локальный MP3, WAV или OGG. Компактный плеер появится в левом верхнем углу, пока выбран файл.</p>
        <div className="mt-3 flex flex-wrap items-center gap-2"><input ref={musicFileRef} type="file" accept="audio/mpeg,audio/wav,audio/ogg,audio/mp4" hidden onChange={event => void chooseMusic(event.target.files?.[0])} /><button onClick={() => musicFileRef.current?.click()} className="rounded-xl px-3 py-1.5 text-xs font-bold" style={{ background:'var(--color-primary)', color:'var(--color-primary-text)' }}>Выбрать музыкальный файл</button>{s.backgroundMusic && <><span className="max-w-[180px] truncate text-[11px]" style={{ color:'var(--color-text-secondary)' }}>{s.backgroundMusicName}</span><button onClick={() => s.update({ backgroundMusic:'', backgroundMusicName:'' })} className="rounded-xl px-3 py-1.5 text-xs font-bold" style={{ background:'var(--color-surface)', color:'var(--color-error)', border:'1px solid var(--color-border)' }}>Удалить</button></>}</div>
        {musicError && <p className="mt-2 text-xs" style={{ color:'var(--color-error)' }}>{musicError}</p>}
        <RangeRow label="Громкость музыки" value={s.musicVolume} min={0} max={100} unit="%" onChange={v => s.setSetting('musicVolume',v)} />
        <SegRow label="Запуск музыки" desc="Запускать автоматически при открытии Portal Launcher или ждать нажатия «Играть»" value={s.musicAutoplay} options={[{ id:'manual', label:'Вручную' }, { id:'startup', label:'При запуске' }]} onChange={v => s.setSetting('musicAutoplay', v as any)} />
        <Row label="Повторять фоновую музыку" desc="Повторять выбранный трек после завершения"><Toggle value={s.musicLoop} onChange={v => s.setSetting('musicLoop',v)} /></Row>
      </div>
    </div>
  );
}

function LanguageSection() {
  const { lang, setLang, getName } = useLanguageStore();
  const LANGS: Lang[] = ['en','ru'];
  return (
    <div className="space-y-1">
      <Row label="Язык интерфейса" desc="Выберите русский или английский язык для интерфейса лаунчера">
        <div className="flex flex-wrap rounded-xl overflow-hidden gap-0.5" style={{ border:'1px solid var(--color-border)' }}>
          {LANGS.map(l => (
            <button key={l} onClick={() => setLang(l)}
              className="px-3 py-1.5 text-xs font-bold transition-all"
              style={lang===l ? { background:'var(--color-primary)', color:'#fff' } : { color:'var(--color-text-secondary)' }}>
              {getName(l)}
            </button>
          ))}
        </div>
      </Row>
      <p className="text-[11px] px-1 pt-2" style={{ color:'var(--color-text-tertiary)' }}>
        Выбор применяется сразу и сохраняется автоматически для следующего запуска лаунчера.
      </p>
    </div>
  );
}

function AdvancedSection() {
  const s = useSettingsStore();
  const [cfKey, setCfKey] = useState(s.curseforgeApiKey);
  const [proxyUrl, setProxyUrl] = useState(s.modrinthProxyUrl);
  const [proxyStatus, setProxyStatus] = useState<'idle' | 'checking' | 'ok' | 'error'>('idle');
  const [proxyMessage, setProxyMessage] = useState('');
  const [saved, setSaved] = useState(false);
  const [aiSettings, setAiSettings] = useState(() => { try { const raw = JSON.parse(localStorage.getItem('portal-ai-settings') || '{}'); return { useProxy: false, ...raw }; } catch { return { useProxy: false }; } });
  const [aiSaved, setAiSaved] = useState(false);
  function saveCfKey() {
    s.setSetting('curseforgeApiKey', cfKey);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  }
  function saveAiSettings() {
    localStorage.setItem('portal-ai-settings', JSON.stringify(aiSettings));
    setAiSaved(true);
    setTimeout(() => setAiSaved(false), 2000);
  }
  function updateAiSetting(key: string, value: any) {
    const next = { ...aiSettings, [key]: value };
    setAiSettings(next);
    localStorage.setItem('portal-ai-settings', JSON.stringify(next));
  }
  function selectAiProvider(provider: any) {
    updateAiSetting('provider', provider.id);
    updateAiSetting('endpoint', endpointFor(provider.id, false));
    const firstModel = defaultModelFor(provider.id);
    if (firstModel) updateAiSetting('model', firstModel);
  }
  async function testModrinthProxy() {
    const url = proxyUrl.trim().replace(/\/$/, '');
    if (!url) { setProxyStatus('error'); setProxyMessage('Укажите адрес прокси-сервера.'); return; }
    setProxyStatus('checking'); setProxyMessage('Проверяю подключение…');
    try {
      const response = await fetch(`${url}/v2/search?query=sodium&limit=1`, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(8000) });
      const contentType = response.headers.get('content-type') || '';
      if (!response.ok || !contentType.includes('application/json')) throw new Error(`сервер вернул ${response.status || 'ответ не в формате JSON'}`);
      setProxyStatus('ok'); setProxyMessage('Прокси-сервер вернул совместимый JSON. Он включён для поиска и карточек Modrinth.');
    } catch (error) {
      setProxyStatus('error'); setProxyMessage(`Подключение не удалось: ${error instanceof Error ? error.message : 'неизвестная ошибка'}`);
    }
  }

  return (
    <div>
      <h2 className="text-base font-bold mb-1" style={{ color:'var(--color-text)' }}>Дополнительно</h2>
      <p className="text-sm mb-5" style={{ color:'var(--color-text-secondary)' }}>Сервисы каталога и расширенные параметры запуска.</p>

      <div className="mb-5 rounded-2xl p-4" style={{ background:'var(--color-surface-2)', border:'1px solid var(--color-border)' }}>
        <div className="flex items-start justify-between gap-3"><div><p className="text-sm font-black" style={{ color:'var(--color-text)' }}>Транспорт Modrinth</p><p className="mt-1 text-xs leading-5" style={{ color:'var(--color-text-secondary)' }}>Дополнительный адрес проверяется по реальному поисковому JSON. Если сервис показывает HTML-защиту, ошибки или задержку, лаунчер сразу использует кэш и официальный API — без бесконечного поиска.</p></div><Toggle value={s.modrinthProxyEnabled} onChange={v => s.setSetting('modrinthProxyEnabled', v)} /></div>
        <div className="mt-3 flex gap-2"><input value={proxyUrl} onChange={e => { setProxyUrl(e.target.value); setProxyStatus('idle'); }} placeholder="https://modrinth.black" className="min-w-0 flex-1 rounded-xl px-3 py-2.5 text-sm" style={{ background:'var(--color-surface)', border:'1px solid var(--color-border)', color:'var(--color-text)' }} /><button onClick={() => void testModrinthProxy()} disabled={proxyStatus === 'checking'} className="shrink-0 rounded-xl px-3 py-2 text-xs font-bold" style={{ background:'var(--color-primary)', color:'var(--color-primary-text)', opacity: proxyStatus === 'checking' ? .6 : 1 }}>{proxyStatus === 'checking' ? 'Проверяем…' : 'Проверить JSON'}</button></div>
        <button onClick={() => s.update({ modrinthProxyUrl: proxyUrl.trim().replace(/\/$/, '') })} className="mt-2 rounded-xl px-3 py-1.5 text-xs font-bold" style={{ background:'var(--color-surface)', color:'var(--color-text-secondary)', border:'1px solid var(--color-border)' }}>Сохранить адрес</button>
        <Row label="Официальный запасной источник" desc="Использовать официальный Modrinth API, если дополнительный адрес недоступен"><Toggle value={s.modrinthProxyAllowOfficialFallback} onChange={v => s.setSetting('modrinthProxyAllowOfficialFallback', v)} /></Row>
        {proxyMessage && <p className="mt-2 text-xs" style={{ color: proxyStatus === 'error' ? 'var(--color-error)' : proxyStatus === 'ok' ? 'var(--color-success)' : 'var(--color-text-secondary)' }}>{proxyMessage}</p>}
      </div>

      {/* CurseForge API Key — editable */}
      <div className="py-3.5" style={{ borderBottom:'1px solid var(--color-border)' }}>
        <p className="text-sm font-semibold mb-1" style={{ color:'var(--color-text)' }}>API-ключ CurseForge</p>
        <p className="text-xs mb-2" style={{ color:'var(--color-text-secondary)' }}>
          Нужен для поиска модов CurseForge. Получите ключ на{' '}
          <a href="https://console.curseforge.com/" target="_blank" rel="noreferrer" className="font-semibold underline underline-offset-2 transition-opacity hover:opacity-80 focus-visible:rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)]" style={{ color:'var(--color-primary)' }}>console.curseforge.com</a>
        </p>
        <div className="flex gap-2">
          <input
            type="password"
            value={cfKey}
            onChange={e => { setCfKey(e.target.value); setSaved(false); }}
            placeholder="$2a$10$..."
            className="flex-1 px-3 py-2.5 rounded-xl text-sm font-medium"
            style={{ background:'var(--color-surface-2)', border:'1px solid var(--color-border)', color:'var(--color-text)' }}
          />
          <button
            onClick={saveCfKey}
            className="flex items-center gap-1.5 px-4 py-2.5 rounded-xl text-sm font-bold shrink-0 transition-all"
            style={{
              background: saved ? 'rgba(46,204,113,0.15)' : 'var(--color-primary)',
              color: saved ? '#2ECC71' : 'var(--color-primary-text)',
              border: saved ? '1px solid #2ECC7144' : 'none',
            }}>
            {saved ? <><Check className="w-4 h-4" />Сохранено</> : <><Save className="w-4 h-4" />Сохранить</>}
          </button>
        </div>
        {cfKey && (
          <p className="text-[11px] mt-1.5" style={{ color:'var(--color-text-tertiary)' }}>
            ● Ключ настроен ({cfKey.length} символов)
          </p>
        )}
      </div>

      {/* AI Agent Settings */}
      <div className="py-3.5" style={{ borderBottom:'1px solid var(--color-border)' }}>
        <div className="flex items-center gap-2 mb-1">
          <Bot className="w-4 h-4" style={{ color:'var(--color-primary)' }} />
          <p className="text-sm font-semibold" style={{ color:'var(--color-text)' }}>AI Agent</p>
        </div>
        <p className="text-xs mb-3" style={{ color:'var(--color-text-secondary)' }}>
          Select a provider and add your API key. Proxy mode routes requests through a third-party endpoint for regions with restricted access.
        </p>
        <div className="flex flex-wrap gap-1.5 mb-3">
          {PROVIDERS.map(p => (
            <button key={p.id} onClick={() => selectAiProvider(p)}
              className="flex items-center gap-1.5 px-3 py-2 text-[11px] font-medium"
              style={{ background: aiSettings.provider === p.id ? 'var(--color-primary-dim)' : 'var(--color-surface-2)', color: aiSettings.provider === p.id ? 'var(--color-primary)' : 'var(--color-text)', border: `1px solid ${aiSettings.provider === p.id ? 'var(--color-primary)' : 'var(--color-border)'}`, borderRadius: 4 }}>
              {p.name}
            </button>
          ))}
        </div>
        <div className="space-y-2">
          <div>
            <label className="text-[11px] font-semibold block mb-1" style={{ color:'var(--color-text-tertiary)' }}>API Key</label>
            <input type="password" value={aiSettings.apiKey || ''} onChange={e => updateAiSetting('apiKey', e.target.value)}
              placeholder={aiSettings.provider === 'claude' ? 'sk-ant-...' : 'sk-...'}
              className="w-full px-3 py-2.5 text-sm" style={{ background:'var(--color-surface-2)', border:'1px solid var(--color-border)', color:'var(--color-text)', borderRadius: 4 }} />
          </div>
          <div>
            <label className="text-[11px] font-semibold block mb-1" style={{ color:'var(--color-text-tertiary)' }}>Endpoint</label>
            <input value={aiSettings.endpoint || PROVIDERS.find(p => p.id === (aiSettings.provider || 'openai'))?.endpoint || ''} onChange={e => updateAiSetting('endpoint', e.target.value)}
              className="w-full px-3 py-2.5 text-sm" style={{ background:'var(--color-surface-2)', border:'1px solid var(--color-border)', color:'var(--color-text)', borderRadius: 4 }} />
          </div>
          <div>
            <label className="text-[11px] font-semibold block mb-1" style={{ color:'var(--color-text-tertiary)' }}>Модель</label>
            {(() => {
              const p = PROVIDERS.find(x => x.id === (aiSettings.provider || 'openai'));
              const groups = p ? modelGroups(p) : [];
              const current = aiSettings.model || p?.models?.[0] || '';
              if (groups.length > 0) {
                return (
                  <select value={current} onChange={e => updateAiSetting('model', e.target.value)}
                    className="w-full px-3 py-2.5 text-sm" style={{ background:'var(--color-surface-2)', border:'1px solid var(--color-border)', color:'var(--color-text)', borderRadius: 4 }}>
                    {groups.map(group => (
                      <optgroup key={group.label} label={group.label}>
                        {group.models.map(m => <option key={m} value={m}>{m}{group.label === 'Бесплатные' ? ' · Free' : ''}</option>)}
                      </optgroup>
                    ))}
                  </select>
                );
              }
              return (
                <input value={aiSettings.model || ''} onChange={e => updateAiSetting('model', e.target.value)}
                  placeholder="model-name"
                  className="w-full px-3 py-2.5 text-sm" style={{ background:'var(--color-surface-2)', border:'1px solid var(--color-border)', color:'var(--color-text)', borderRadius: 4 }} />
              );
            })()}
          </div>
          <div className="flex items-center gap-3 py-1">
            <label className="text-[11px] font-semibold" style={{ color:'var(--color-text-secondary)' }}>Прокси включён</label>
            <button onClick={() => { const next = !aiSettings.useProxy; updateAiSetting('useProxy', next); if (next) { updateAiSetting('endpoint', aiSettings.endpoint); } else { updateAiSetting('endpoint', endpointFor(aiSettings.provider || 'openai', false)); } }}
              className="relative" style={{ width: 38, height: 20 }}>
              <div className="absolute inset-0" style={{ background: aiSettings.useProxy ? 'var(--color-primary)' : 'var(--color-surface-2)', border: `1px solid ${aiSettings.useProxy ? 'var(--color-primary)' : 'var(--color-border)'}`, borderRadius: 10 }} />
              <div className="absolute top-0.5 transition-[left]" style={{ width: 12, height: 12, background: '#fff', borderRadius: 6, left: aiSettings.useProxy ? 22 : 3 }} />
            </button>
          </div>
          <p className="text-[10px] leading-4" style={{ color:'var(--color-text-tertiary)' }}>
            Встроенных прокси-адресов нет. Если ключ не работает из РФ, укажи в поле Endpoint рабочий адрес своего прокси (или ключа-прокси): обычно он выдаётся вместе с ключом и заканчивается на <code style={{ fontFamily:'monospace' }}>/v1/chat/completions</code>.
          </p>
          <button onClick={saveAiSettings} className="flex items-center gap-1.5 px-4 py-2.5 text-sm font-bold transition-all" style={{ background: aiSaved ? 'rgba(46,204,113,0.15)' : 'var(--color-primary)', color: aiSaved ? '#2ECC71' : 'var(--color-primary-text)', borderRadius: 4, border: aiSaved ? '1px solid #2ECC7144' : 'none' }}>
            {aiSaved ? <><Check className="w-4 h-4" />Saved</> : <><Save className="w-4 h-4" />Save</>}
          </button>
        </div>
      </div>

      <Row label="Автоочистка удалённых материалов" desc="Удалённые сборки, моды, ресурс-паки, шейдеры, дата-паки и миры можно восстановить до окончания выбранного срока.">
        <select value={s.deletedInstanceRetentionMinutes} onChange={event => s.setSetting('deletedInstanceRetentionMinutes', Number(event.target.value))} className="rounded-xl px-3 py-2 text-xs font-bold" style={{ background:'var(--color-surface-2)', border:'1px solid var(--color-border)', color:'var(--color-text)' }}>
          <option value={15}>15 минут</option>
          <option value={60}>1 час</option>
          <option value={1440}>1 день</option>
          <option value={10080}>7 дней</option>
          <option value={43200}>30 дней</option>
          <option value={525600}>1 год</option>
        </select>
      </Row>

      <Row label="Платформа по умолчанию" desc="Какую платформу использовать по умолчанию в Discover">
        <div className="relative isolate flex rounded-xl p-0.5" style={{ background:'var(--color-surface-2)', border:'1px solid var(--color-border)' }}>
          <span aria-hidden className="pointer-events-none absolute inset-y-0.5 left-0.5 w-[calc(50%-2px)] rounded-[9px] transition-transform duration-200" style={{ transform: s.defaultPlatform === 'modrinth' ? 'translateX(0)' : 'translateX(100%)', background:'var(--color-primary-dim)', border:'1px solid color-mix(in srgb, var(--color-primary) 72%, transparent)', boxShadow:'0 3px 12px color-mix(in srgb, var(--color-primary) 18%, transparent)' }} />
          {(['modrinth','curseforge'] as const).map(p => (
            <button key={p} type="button" aria-pressed={s.defaultPlatform===p} onClick={() => s.setSetting('defaultPlatform', p)}
              className="relative z-10 min-w-[82px] rounded-[9px] px-3 py-1.5 text-xs font-bold capitalize transition-colors duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)]"
              style={s.defaultPlatform===p
                ? { color:'var(--color-primary)' }
                : { color:'var(--color-text-secondary)' }}>
              {p==='modrinth'?'Modrinth':'CurseForge'}
            </button>
          ))}
        </div>
      </Row>

      <div className="pt-4">
        <button onClick={() => s.reset()}
          className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold transition-all"
          style={{ background:'rgba(231,76,60,0.1)', color:'var(--color-error)', border:'1px solid rgba(231,76,60,0.2)' }}>
          <Trash2 className="w-4 h-4" />Сбросить все настройки
        </button>
      </div>
    </div>
  );
}

function AboutSection() {
  const language = useSettingsStore(s => s.language);
  const notifications = useUpdateStore(s => s.notifications);
  const [clicks, setClicks] = useState(() => Number(localStorage.getItem('portal-easter-clicks') || 0));
  const [burst, setBurst] = useState(false);
  const [manusReveal, setManusReveal] = useState(false);
  const manusUnlocked = useAchievementStore(state => Boolean(state.unlocked['manus-secret']));
  const verityUnlocked = useAchievementStore(state => Boolean(state.unlocked['verity']));
  const unlockAchievement = useAchievementStore(state => state.unlock);
  const clickBufferRef = useRef(0);
  const rarity = clicks >= 1000 ? 'Mythic' : clicks >= 500 ? 'Legendary' : clicks >= 100 ? 'Epic' : clicks >= 25 ? 'Rare' : clicks >= 5 ? 'Uncommon' : 'Common';
  const rarityLabel = language === 'ru' ? ({ Common:'Обычная', Uncommon:'Необычная', Rare:'Редкая', Epic:'Эпическая', Legendary:'Легендарная', Mythic:'Мифическая' } as Record<string,string>)[rarity] : rarity;
  const rarityColor = rarity === 'Mythic' ? '#F472B6' : rarity === 'Legendary' ? '#F59E0B' : rarity === 'Epic' ? '#A855F7' : rarity === 'Rare' ? '#38BDF8' : rarity === 'Uncommon' ? '#34D399' : 'var(--color-primary)';
  const handleLogoClick = () => {
    clickBufferRef.current += 1;
    if (clickBufferRef.current < 3) return;
    const completedClicks = clickBufferRef.current - (clickBufferRef.current % 3);
    clickBufferRef.current %= 3;
    const next = clicks + completedClicks;
    setClicks(next);
    localStorage.setItem('portal-easter-clicks', String(next));
    setBurst(true);
    window.setTimeout(() => setBurst(false), 650);
    if (clicks < 3 && next >= 3) unlockAchievement('first-signal');
    if (Math.random() < 0.035) unlockAchievement('static-in-the-void');
    if (clicks < 500 && next >= 500 && !manusUnlocked) {
      unlockAchievement('manus-secret');
      playManusClick();
      setManusReveal(true);
      window.setTimeout(() => setManusReveal(false), 180000);
    }
    if (clicks < 1000 && next >= 1000 && !verityUnlocked) {
      unlockAchievement('verity');
    }
  };

  useEffect(() => {
    if (clicks >= 500 && !manusUnlocked) unlockAchievement('manus-secret');
    if (clicks >= 1000 && !verityUnlocked) unlockAchievement('verity');
  }, [clicks, manusUnlocked, verityUnlocked, unlockAchievement]);

  return (
    <div>
      <h2 className="text-base font-bold mb-1" style={{ color:'var(--color-text)' }}>О Portal Launcher</h2>
      <p className="text-sm mb-5" style={{ color:'var(--color-text-secondary)' }}>Сведения о версии и лицензии</p>
      <div className="p-5 rounded-2xl mb-4 flex flex-col items-center gap-3"
        style={{ background:'var(--color-surface-2)', border:'1px solid var(--color-border)' }}>
        <button onClick={handleLogoClick} className={`relative w-20 h-20 rounded-3xl overflow-hidden transition-transform ${burst ? 'scale-110' : 'hover:scale-[1.03]'}`} style={{ boxShadow:`0 8px 24px ${rarityColor}55`, border:`1px solid ${rarityColor}88` }} title="Portal Launcher">
          <img src="/launcher-icon.png?rev=portal-square-1" alt="Portal Launcher" className="w-full h-full object-cover" draggable={false} style={{ filter: clicks >= 5 ? `hue-rotate(${Math.min(260, clicks % 360)}deg) saturate(${1 + Math.min(1.5, clicks / 500)})` : undefined }} />
          {burst && <span className="absolute inset-0 animate-ping rounded-3xl" style={{ border:`2px solid ${rarityColor}` }} />}
        </button>
        <div className="text-center">
          <p className="font-black text-xl" style={{ color:'var(--color-text)' }}>Portal Launcher</p>
          <p className="text-sm mt-0.5" style={{ color:'var(--color-text-secondary)' }}>Версия 1.0.1</p>
          <p className="text-xs mt-1" style={{ color:'var(--color-text-tertiary)' }}>Создано с Tauri v2 · React · TypeScript</p>
          <p className="mt-2 text-[11px] font-black uppercase tracking-wider" style={{ color:rarityColor }}>{rarityLabel} · {clicks} {language === 'ru' ? 'кликов' : 'clicks'}</p>
          {clicks >= 5 && <p className="mt-1 text-[10px]" style={{ color:'var(--color-text-tertiary)' }}>{language === 'ru' ? 'Иконка лаунчера перешла в альтернативную редкость.' : 'The launcher icon has entered an alternate rarity.'}</p>}
        </div>
      </div>
      <a href="https://github.com/manusportalgpt-beep/Portal-Launcher" target="_blank" rel="noreferrer" className="portal-about-github mb-4 flex items-center justify-between gap-3 px-3 py-3 transition-colors" style={{ background:'var(--color-surface)', border:'1px solid var(--color-border)', color:'var(--color-text)' }}>
        <span className="flex min-w-0 items-center gap-2"><Github className="h-4 w-4 shrink-0" /><span className="min-w-0"><span className="block text-xs font-black">GitHub проекта</span><span className="block truncate text-[10px]" style={{ color:'var(--color-text-secondary)' }}>manusportalgpt-beep/Portal-Launcher</span></span></span>
        <ExternalLink className="h-4 w-4 shrink-0" style={{ color:'var(--color-text-secondary)' }} />
      </a>
      {notifications.length > 0 && (
        <div className="mb-4">
          <p className="text-xs font-semibold mb-2" style={{ color:'var(--color-text-secondary)' }}>Recent updates</p>
          <div className="space-y-2">
            {notifications.map(n => (
              <div key={n.version} className="p-3" style={{ background:'var(--color-surface)', border:'1px solid var(--color-border)', borderRadius: 6 }}>
                <div className="flex items-center justify-between mb-1">
                  <span className="text-sm font-medium" style={{ color:'var(--color-text)' }}>v{n.version}</span>
                  <a href={n.htmlUrl} target="_blank" rel="noreferrer" className="text-[10px]" style={{ color:'var(--color-primary)' }}>GitHub</a>
                </div>
                <p className="text-[11px] leading-relaxed" style={{ color:'var(--color-text-tertiary)' }}>{n.body.split('\n').slice(0, 3).join('\n')}</p>
                <p className="text-[10px] mt-1" style={{ color:'var(--color-text-tertiary)' }}>{new Date(n.publishedAt).toLocaleDateString()}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      <AnimatePresence>
        {manusReveal && (
          <motion.div className="mb-4 flex items-center gap-3 p-3.5" initial={{ opacity:0, y:8, scale:0.98 }} animate={{ opacity:1, y:0, scale:1 }} exit={{ opacity:0, y:8, scale:0.98 }} style={{ borderRadius:'var(--radius-card)', background:'linear-gradient(135deg, color-mix(in srgb, var(--color-primary) 18%, var(--color-surface)), var(--color-surface-2))', border:'1px solid var(--color-primary)', boxShadow:'var(--shadow-md)' }}>
            <img src={manusAchievement} alt="Manus" className="h-10 w-[102px] rounded-lg object-contain" style={{ background:'#202020' }} />
            <div className="min-w-0"><p className="text-sm font-black" style={{ color:'var(--color-text)' }}>Кто ты?</p><p className="mt-0.5 text-[11px]" style={{ color:'var(--color-text-secondary)' }}>Manus — помощник, который участвовал в создании Portal Launcher вместе с Portalrolls.</p></div>
          </motion.div>
        )}
      </AnimatePresence>
      {verityUnlocked && <div className="mb-4 flex items-center gap-3 p-3" style={{ borderRadius:'var(--radius-card)', background:'var(--color-surface-2)', border:'1px solid var(--color-border)' }}><p className="text-[11px] font-bold" style={{ color:'var(--color-text-secondary)' }}>Verity · Что-то случиться через 3 дня...</p></div>}
      {[
        { label:'Создатель', value:'Portalrolls' },
        { label:'Версия Tauri', value:'2.x' },
        { label:'Версия React', value:'18.x' },
        { label:'Лицензия', value:'MIT' },
      ].map(r => (
        <div key={r.label} className="flex items-center justify-between py-3" style={{ borderBottom:'1px solid var(--color-border)' }}>
          <p className="text-sm" style={{ color:'var(--color-text-secondary)' }}>{r.label}</p>
          <p className="text-sm font-semibold" style={{ color: r.label === 'Создатель' ? 'var(--color-primary)' : 'var(--color-text)' }}>{r.value}</p>
        </div>
      ))}
    </div>
  );
}

const SECTION_CONTENT: Record<Section, React.FC> = {
  account: AccountSection,
  minecraft: MinecraftSection,
  appearance: AppearanceSection,
  controls: ControlsSection,
  audio: AudioSection,
  language: LanguageSection,
  advanced: AdvancedSection,
  about: AboutSection,
};

export function SettingsPage() {
  const { section: sectionParam } = useParams<{ section?: string }>();
  const navigate = useNavigate();
  const [activeSection, setActiveSection] = useState<Section>((sectionParam as Section) || 'account');

  const Content = SECTION_CONTENT[activeSection] || AccountSection;

  const activeMeta = SECTIONS.find(section => section.id === activeSection) ?? SECTIONS[0];
  const ActiveIcon = activeMeta.icon;
  return (
    <div className="h-full overflow-hidden" style={{ background:'var(--color-bg)' }}>
      <div className="flex h-full overflow-hidden" style={{ background:'var(--color-bg)' }}>
        <aside className="shrink-0 flex h-full flex-col overflow-y-auto px-3 py-4"
          style={{ width:232, background:'var(--color-bg)', borderRight:'0' }}>
          <div className="mb-4 flex items-center gap-3 px-2 py-1" style={{ background:'transparent', border:'0' }}>
            <img src="/launcher-icon.png" alt="Portal Launcher" className="h-8 w-8 rounded-md object-cover" />
            <div className="min-w-0"><p className="truncate text-sm font-black" style={{ color:'var(--color-text)' }}>Portal Launcher</p><p className="text-[10px]" style={{ color:'var(--color-text-secondary)' }}>Центр управления</p></div>
          </div>
          <p className="mb-1 px-2 text-[10px] font-black uppercase tracking-[0.16em]" style={{ color:'var(--color-text-tertiary)' }}>Настройки</p>
          <nav className="space-y-0.5">
            {SECTIONS.map(sec => {
              const Icon = sec.icon;
              const active = activeSection === sec.id;
              return (
                <button key={sec.id}
                  onClick={() => {
                    setActiveSection(sec.id);
                    navigate(`/settings/${sec.id}`);
                  }}
                  className="group relative flex w-full items-center gap-2 rounded-md px-2 py-2 text-left transition-colors"
                  style={active
                    ? { background:'transparent', color:'var(--color-text)', border:'1px solid var(--color-primary)' }
                    : { color:'var(--color-text-secondary)', border:'1px solid transparent' }}>
                  <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-sm" style={{ background:'transparent', color:active?'var(--color-primary)':'var(--color-text-secondary)' }}><Icon className="h-4 w-4" /></span>
                  <span className="min-w-0"><span className="block text-xs font-black">{sec.label}</span><span className="block truncate text-[10px]" style={{ color:active?'var(--color-text-secondary)':'var(--color-text-tertiary)' }}>{sec.desc}</span></span>
                </button>
              );
            })}
          </nav>
          <div className="mt-auto px-2 py-3" style={{ background:'transparent', border:'0' }}>
            <p className="text-[10px] font-black uppercase tracking-wide" style={{ color:'var(--color-primary)' }}>Сохраняется автоматически</p>
            <p className="mt-1 text-[10px] leading-4" style={{ color:'var(--color-text-secondary)' }}>Тема, Java, панели и язык сохраняются после перезапуска.</p>
          </div>
        </aside>

        <div className="flex-1 min-w-0 overflow-y-auto" style={{ background:'var(--color-bg)' }}>
          <div className="mx-auto max-w-3xl px-5 py-6 sm:px-8 sm:py-8">
            <div className="mb-6 flex items-center gap-3 px-1 py-1" style={{ background:'transparent', border:'0', boxShadow:'none' }}>
              <span className="flex h-8 w-8 items-center justify-center rounded-sm" style={{ background:'transparent', color:'var(--color-primary)' }}><ActiveIcon className="h-4 w-4" /></span>
              <div><p className="text-base font-black" style={{ color:'var(--color-text)' }}>{activeMeta.label}</p><p className="text-xs" style={{ color:'var(--color-text-secondary)' }}>{activeMeta.desc}</p></div>
            </div>
            <div className="minimal-settings-group px-1 py-1 sm:px-2" style={{ background:'transparent', border:'0', boxShadow:'none' }}>
              <AnimatePresence mode="wait">
                <motion.div key={activeSection}
                  initial={{ opacity:0, y:8 }} animate={{ opacity:1, y:0 }} exit={{ opacity:0, y:-8 }}
                  transition={{ duration:0.15 }}>
                  <Content />
                </motion.div>
              </AnimatePresence>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

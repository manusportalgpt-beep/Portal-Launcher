import { useEffect, useRef, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { motion, AnimatePresence } from 'framer-motion';
import {
  User, Cpu, Palette,
  LogIn, RefreshCw, Trash2, Check, X,
  Volume2, Code, Shield, Save, Layout, Upload, Gamepad2, Globe, Search, SlidersHorizontal,
} from 'lucide-react';
import { invoke } from '@/lib/invoke-shim';
import { useSettingsStore } from '@/stores/settingsStore';
import { useThemeStore } from '@/stores/themeStore';
import { useCurrentUser, useIsAuthenticated, useAuthStore } from '@/stores/authStore';
import { MicrosoftAuthOAuth } from '@/components/auth/MicrosoftAuthOAuth';
import { type ThemeId } from '@/lib/theme-engine';
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
import manusAchievement from '@/assets/manus-achievement.png';

type Section = 'account' | 'minecraft' | 'appearance' | 'audio' | 'language' | 'advanced' | 'about';

interface SectionDef { id: Section; icon: any; label: string; desc: string }
const SECTIONS: SectionDef[] = [
  { id:'account',    icon:User,    label:'Аккаунты',    desc:'Microsoft, Ely.by и игровые профили' },
  { id:'minecraft',  icon:Cpu,     label:'Minecraft',  desc:'Java, память и параметры запуска' },
  { id:'appearance', icon:Palette, label:'Оформление',  desc:'Тема, панели и визуальные параметры' },
  { id:'audio',      icon:Volume2, label:'Аудио',       desc:'Громкость, звуки и фоновая музыка' },
  { id:'language',   icon:Globe,   label:'Язык',        desc:'Язык интерфейса лаунчера' },
  { id:'advanced',   icon:Code,    label:'Дополнительно', desc:'Каталоги, API и расширенные параметры' },
  { id:'about',      icon:Shield,  label:'О лаунчере',  desc:'Версия, лицензия и системная информация' },
];

const THEMES: { id: ThemeId; name: string; preview: string; accent: string }[] = [
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
    <button onClick={() => onChange(!value)}
      className="relative rounded-full transition-all shrink-0"
      style={{ width:40, height:22, background:value?'var(--color-primary)':'var(--color-surface-2)', border:`1px solid ${value?'var(--color-primary)':'var(--color-border)'}` }}>
      <div className="absolute top-0.5 rounded-full transition-all"
        style={{ width:18, height:18, background:'#fff', left:value?'calc(100% - 20px)':'2px', boxShadow:'0 1px 3px rgba(0,0,0,0.3)' }} />
    </button>
  );
}

function Row({ label, desc, children }: { label: string; desc?: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between py-3.5" style={{ borderBottom:'1px solid var(--color-border)' }}>
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
    <div className="py-3.5" style={{ borderBottom:'1px solid var(--color-border)' }}>
      <div className="flex items-center justify-between mb-2">
        <div>
          <p className="text-sm font-semibold" style={{ color:'var(--color-text)' }}>{label}</p>
          {desc && <p className="text-xs mt-0.5" style={{ color:'var(--color-text-secondary)' }}>{desc}</p>}
        </div>
        <span className="text-sm font-bold" style={{ color:'var(--color-primary)' }}>{value}{unit}</span>
      </div>
      <input type="range" min={min} max={max} value={value} onChange={e => onChange(+e.target.value)}
        className="w-full" style={{ accentColor:'var(--color-primary)' }} />
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
        className="w-full px-3 py-2.5 rounded-xl text-sm font-medium"
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

  return (
    <div>
      <h2 className="text-base font-bold mb-1" style={{ color:'var(--color-text)' }}>Microsoft Account</h2>
      <p className="text-sm mb-5" style={{ color:'var(--color-text-secondary)' }}>Manage your Minecraft accounts</p>
      {isAuth && user ? (
        <div className="p-4 rounded-2xl mb-4" style={{ background:'var(--color-surface-2)', border:'1px solid var(--color-border)' }}>
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 rounded-xl overflow-hidden shrink-0"
              style={{ background:'linear-gradient(135deg,var(--color-primary),#E74C3C)' }}>
              <CachedPlayerFace user={user} className="w-full h-full" alt="" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="font-bold" style={{ color:'var(--color-text)' }}>{user.username}</p>
              <p className="text-xs" style={{ color:'var(--color-text-secondary)' }}>
                {user.provider === 'elyby' ? 'Ely.by Account'
                  : user.isDemo || user.provider === 'offline' ? 'Offline / без лицензии'
                  : 'Microsoft Account · Minecraft: Java Edition'}
              </p>
              <p className="text-xs font-mono mt-0.5" style={{ color:'var(--color-text-tertiary)' }}>{user.uuid}</p>
            </div>
          </div>
          <div className="flex gap-2 mt-3 pt-3" style={{ borderTop:'1px solid var(--color-border)' }}>
            <button onClick={() => setShowAuth(true)}
              className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold"
              style={{ background:'var(--color-surface)', border:'1px solid var(--color-border)', color:'var(--color-text-secondary)' }}>
              <RefreshCw className="w-3.5 h-3.5" />Add account
            </button>
            <button onClick={() => { logout(); invoke('msa_logout').catch(() => {}); }}
              className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold"
              style={{ background:'rgba(231,76,60,0.1)', color:'var(--color-error)' }}>
              <X className="w-3.5 h-3.5" />Sign out
            </button>
          </div>
        </div>
      ) : (
        <div className="p-6 rounded-2xl mb-4 flex flex-col items-center gap-4"
          style={{ background:'var(--color-surface-2)', border:'1px solid var(--color-border)' }}>
          <div className="w-14 h-14 rounded-2xl flex items-center justify-center"
            style={{ background:'linear-gradient(135deg,#0078D4,#00BCF2)' }}>
            <LogIn className="w-7 h-7 text-white" />
          </div>
          <div className="text-center">
            <p className="font-bold" style={{ color:'var(--color-text)' }}>Not signed in</p>
            <p className="text-sm mt-1" style={{ color:'var(--color-text-secondary)' }}>Sign in with a Microsoft account to play Minecraft</p>
          </div>
          <button onClick={() => setShowAuth(true)}
            className="px-5 py-2.5 rounded-xl text-sm font-bold"
            style={{ background:'#0078D4', color:'#fff' }}>
            Войти в аккаунт
          </button>
        </div>
      )}

      {accounts.length > 1 && (
        <div className="mb-4">
          <p className="text-xs font-bold mb-2" style={{ color:'var(--color-text-tertiary)' }}>Other accounts</p>
          <div className="space-y-1.5">
            {accounts.filter(a => a.uuid !== activeAccountUuid).map(a => (
              <button key={a.uuid} onClick={() => switchAccount(a.uuid)}
                className="w-full flex items-center gap-3 p-2.5 rounded-xl text-left hover:opacity-90 transition-opacity"
                style={{ background:'var(--color-surface-2)', border:'1px solid var(--color-border)' }}>
                <div className="w-8 h-8 rounded-lg overflow-hidden shrink-0"
                  style={{ background:'linear-gradient(135deg,var(--color-primary),#E74C3C)' }}>
                  <CachedPlayerFace user={a} className="w-full h-full" alt="" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold truncate" style={{ color:'var(--color-text)' }}>{a.username}</p>
                  <p className="text-[11px]" style={{ color:'var(--color-text-tertiary)' }}>
                    {a.provider === 'elyby' ? 'Ely.by' : a.isDemo || a.provider === 'offline' ? 'Offline' : 'Microsoft'}
                  </p>
                </div>
                <span className="text-[10px] font-bold px-2 py-1 rounded-lg" style={{ color:'var(--color-primary)', border:'1px solid var(--color-primary)' }}>
                  Use
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
  return (
    <div>
      <h2 className="text-base font-bold mb-1" style={{ color:'var(--color-text)' }}>Java & Memory</h2>
      <p className="text-sm mb-5" style={{ color:'var(--color-text-secondary)' }}>Configure Java and memory allocation</p>
      <InputRow label="Java Path" desc="Leave empty to auto-detect" value={s.javaPath} onChange={v => s.setSetting('javaPath',v)} placeholder="Auto-detect" />
      <JavaManager selectedPath={s.javaPath} onSelect={path => s.setSetting('javaPath', path)} />
      <InputRow label="JVM Arguments" desc="Extra JVM arguments added before -jar" value={s.customJvmArgs} onChange={v => s.setSetting('customJvmArgs',v)} placeholder="-XX:+UseG1GC -XX:G1NewSizePercent=20" />
      <RangeRow label="Minimum Memory" value={s.minRam} min={512} max={s.maxRam} unit=" MB" onChange={v => s.setSetting('minRam',v)} />
      <RangeRow label="Maximum Memory" value={s.maxRam} min={s.minRam} max={32768} unit=" MB" onChange={v => s.setSetting('maxRam',v)} />
      <Row label="Close launcher on game start" desc="Minimize Portal Launcher when Minecraft starts">
        <Toggle value={s.closeLauncherOnStart} onChange={v => s.setSetting('closeLauncherOnStart',v)} />
      </Row>
      <Row label="Show snapshot versions" desc="Include pre-release and snapshot versions in version picker">
        <Toggle value={s.showSnapshots} onChange={v => s.setSetting('showSnapshots',v)} />
      </Row>
      <Row label="Auto-install dependencies" desc="Automatically install Fabric API, Forge dependencies, etc.">
        <Toggle value={s.autoInstallDeps} onChange={v => s.setSetting('autoInstallDeps',v)} />
      </Row>
      <Row label="Keep game logs" desc="Store Minecraft logs in the game directory">
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
      ? { titlebarHeight: 32, uiScale: 92, compact: true, cornerRadius: 10 }
      : preset === 'roomy'
        ? { titlebarHeight: 40, uiScale: 108, compact: false, cornerRadius: 18 }
        : { titlebarHeight: 34, uiScale: 100, compact: false, cornerRadius: 12 };
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
            className="relative rounded-2xl overflow-hidden transition-all hover:scale-[1.03] hover:-translate-y-0.5"
            style={{
              border: `2px solid ${themeId === t.id ? t.accent : 'var(--color-border)'}`,
              boxShadow: themeId === t.id ? `0 8px 24px ${t.accent}33` : 'none',
            }}>
            <div className="h-16 relative" style={{ background: t.preview }}>
              <div className="absolute bottom-1.5 left-1.5 w-3 h-3 rounded-full"
                style={{ background: t.accent, boxShadow: `0 0 8px ${t.accent}` }} />
            </div>
            <div className="px-2 py-2" style={{ background: 'var(--color-surface-2)' }}>
              <p className="text-[11px] font-bold text-center truncate" style={{ color: 'var(--color-text)' }}>{t.name}</p>
            </div>
            {themeId === t.id && (
              <div className="absolute top-1.5 right-1.5 w-5 h-5 rounded-full flex items-center justify-center"
                style={{ background: t.accent, boxShadow: `0 2px 8px ${t.accent}` }}>
                <Check className="w-3 h-3 text-white" strokeWidth={3} />
              </div>
            )}
          </button>
        ))}
      </div>
      <CustomThemeBuilder />

      {/* ===================== Typography ===================== */}
      <div className="flex items-center gap-2 mt-8 mb-1">
        <Palette className="w-4 h-4" style={{ color: 'var(--color-primary)' }} />
        <h3 className="text-sm font-black tracking-wide uppercase" style={{ color: 'var(--color-text)' }}>Typography</h3>
      </div>
      <p className="text-xs mb-3" style={{ color: 'var(--color-text-secondary)' }}>
        Choose the interface font. The choice is kept when you change themes.
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
      <div className="flex items-center gap-2 mt-8 mb-1">
        <Search className="w-4 h-4" style={{ color: 'var(--color-primary)' }} />
        <h3 className="text-sm font-black tracking-wide uppercase" style={{ color: 'var(--color-text)' }}>Search</h3>
      </div>
      <p className="text-xs mb-3" style={{ color: 'var(--color-text-secondary)' }}>
        Choose an animation that appears after content is successfully installed from Search or a project page.
      </p>
      <SegRow label="Install effect" desc="Show the project icon dropping down after a successful installation"
        value={ui.installEffect}
        options={[{ id:'icon-drop', label:'Icon drop' }, { id:'zoom-bounce', label:'Zoom bounce' }, { id:'orbit', label:'Orbit' }, { id:'shimmer', label:'Shimmer' }, { id:'none', label:'Off' }]}
        onChange={v => ui.set('installEffect', v as any)} />
      <Row label="Content source icon" desc="Show the non-clickable Modrinth or CurseForge icon beside controls in content rows">
        <Toggle value={ui.showContentSourceIcon} onChange={value => ui.set('showContentSourceIcon', value)} />
      </Row>
      <Row label="Skin stand player name" desc="Show the account or preset name above the large 3D skin model">
        <Toggle value={ui.showSkinStandName} onChange={value => ui.set('showSkinStandName', value)} />
      </Row>
      <SegRow label="Return from project" desc="Choose where Discover and Find Projects return after closing a Modrinth or CurseForge page"
        value={ui.searchDetailReturnPosition}
        options={[{ id:'remember', label:'Previous place' }, { id:'top', label:'Top' }, { id:'bottom', label:'Bottom' }]}
        onChange={v => ui.set('searchDetailReturnPosition', v as any)} />

      {/* ===================== More ===================== */}
      <div className="flex items-center gap-2 mt-8 mb-1">
        <Layout className="w-4 h-4" style={{ color: 'var(--color-primary)' }} />
        <h3 className="text-sm font-black tracking-wide uppercase" style={{ color: 'var(--color-text)' }}>{t('settings.appearanceUi.more')}</h3>
      </div>
      <p className="text-xs mb-3" style={{ color: 'var(--color-text-secondary)' }}>
        {t('settings.appearanceUi.moreDescription')}
      </p>

      <SegRow label="Navigation" desc="Side panel or floating Notch panel"
        value={ui.navMode}
        options={[{ id: 'sidebar', label: 'Sidebar' }, { id: 'notch', label: 'Notch panel' }]}
        onChange={v => ui.set('navMode', v as any)} />

      <SegRow label="Стиль интерфейса" desc="Классический сохраняет более строгие поверхности, новый использует мягкие акценты и расширенные скругления — для Notch и Sidebar одинаково"
        value={ui.uiMode}
        options={[{ id: 'old', label: 'Классический' }, { id: 'new', label: 'Новый' }]}
        onChange={v => { ui.set('uiMode', v as any); ui.set('panelVersion', v as any); }} />

      {ui.navMode === 'notch' && (
        <>
          <SegRow label="Notch position" desc="Which screen edge the panel is docked to"
            value={ui.notchSide}
            options={[{ id: 'top', label: 'Top' }, { id: 'bottom', label: 'Bottom' }, { id: 'left', label: 'Left' }, { id: 'right', label: 'Right' }]}
            onChange={v => ui.set('notchSide', v as any)} />
          <RangeRow label="Hover zone" desc="How large the area is that opens the Notch panel"
            value={ui.notchHotzone} min={18} max={96} unit=" px" onChange={v => ui.set('notchHotzone', v)} />
          <RangeRow label="Close delay" desc="Keep Notch open briefly when moving between its controls" value={ui.notchCloseDelay} min={0} max={800} unit=" ms" onChange={v => ui.set('notchCloseDelay', v)} />
          <Row label="Always visible" desc="Keep the Notch panel pinned open">
            <Toggle value={ui.notchPinned} onChange={v => ui.set('notchPinned', v)} />
          </Row>
        </>
      )}
      <NavigationPanelEditor />

      <div className="flex items-center gap-2 mt-6 mb-1">
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
      <RangeRow label={t('settings.appearanceUi.titlebarHeight')} desc={t('settings.appearanceUi.titlebarHeightDescription')} value={ui.titlebarHeight} min={32} max={52} unit="px" onChange={v => ui.set('titlebarHeight', v)} />

      <div className="flex items-center gap-2 mt-6 mb-1">
        <SlidersHorizontal className="w-4 h-4" style={{ color: 'var(--color-primary)' }} />
        <h3 className="text-sm font-black tracking-wide uppercase" style={{ color: 'var(--color-text)' }}>{t('settings.appearanceUi.panelPolish')}</h3>
      </div>
      <p className="text-xs mb-3" style={{ color: 'var(--color-text-secondary)' }}>{t('settings.appearanceUi.panelPolishDescription')}</p>
      <SegRow label={t('settings.appearanceUi.panelAlignment')} desc={t('settings.appearanceUi.panelAlignmentDescription')}
        value={ui.navAlignment}
        options={[{ id:'start', label:t('settings.appearanceUi.start') }, { id:'center', label:t('settings.appearanceUi.center') }, { id:'end', label:t('settings.appearanceUi.end') }]}
        onChange={v => ui.set('navAlignment', v as any)} />
      <RangeRow label={t('settings.appearanceUi.panelGap')} desc={t('settings.appearanceUi.panelGapDescription')} value={ui.navGap} min={0} max={16} unit="px" onChange={v => ui.set('navGap', v)} />
      <RangeRow label={t('settings.appearanceUi.panelEdgePadding')} desc={t('settings.appearanceUi.panelEdgePaddingDescription')} value={ui.navEdgePadding} min={0} max={32} unit="px" onChange={v => ui.set('navEdgePadding', v)} />
      <RangeRow label={t('settings.appearanceUi.panelOpacity')} desc={t('settings.appearanceUi.panelOpacityDescription')} value={ui.navOpacity} min={45} max={100} unit="%" onChange={v => ui.set('navOpacity', v)} />
      <RangeRow label={t('settings.appearanceUi.panelBlur')} desc={t('settings.appearanceUi.panelBlurDescription')} value={ui.navBlur} min={0} max={36} unit="px" onChange={v => ui.set('navBlur', v)} />
      <SegRow label={t('settings.appearanceUi.panelShadow')} desc={t('settings.appearanceUi.panelShadowDescription')} value={ui.navShadow}
        options={[{ id:'none', label:t('settings.appearanceUi.off') }, { id:'soft', label:t('settings.appearanceUi.soft') }, { id:'strong', label:t('settings.appearanceUi.strong') }]}
        onChange={v => ui.set('navShadow', v as any)} />
      <SegRow label={t('settings.appearanceUi.panelBorder')} desc={t('settings.appearanceUi.panelBorderDescription')} value={ui.navBorder}
        options={[{ id:'none', label:t('settings.appearanceUi.none') }, { id:'subtle', label:t('settings.appearanceUi.subtle') }, { id:'strong', label:t('settings.appearanceUi.strong') }]}
        onChange={v => ui.set('navBorder', v as any)} />
      <SegRow label={t('settings.appearanceUi.activeItem')} desc={t('settings.appearanceUi.activeItemDescription')} value={ui.navActiveIndicator}
        options={[{ id:'line', label:t('settings.appearanceUi.line') }, { id:'dot', label:t('settings.appearanceUi.dot') }, { id:'pill', label:t('settings.appearanceUi.pill') }]}
        onChange={v => ui.set('navActiveIndicator', v as any)} />
      <SegRow label={t('settings.appearanceUi.hoverIndicator')} desc={t('settings.appearanceUi.hoverIndicatorDescription')} value={ui.navHoverIndicator}
        options={[{ id:'square', label:t('settings.appearanceUi.square') }, { id:'circle', label:t('settings.appearanceUi.circle') }, { id:'none', label:t('settings.appearanceUi.none') }]}
        onChange={v => ui.set('navHoverIndicator', v as any)} />
      <SegRow label={t('settings.appearanceUi.navigationLabels')} desc={t('settings.appearanceUi.navigationLabelsDescription')} value={ui.navLabels}
        options={[{ id:'icons', label:t('settings.appearanceUi.icons') }, { id:'hover', label:t('settings.appearanceUi.hover') }, { id:'always', label:t('settings.appearanceUi.always') }]}
        onChange={v => ui.set('navLabels', v as any)} />

      <RangeRow label={t('settings.appearanceUi.interfaceScale')} desc={t('settings.appearanceUi.interfaceScaleDescription')}
        value={ui.uiScale} min={60} max={180} unit="%" onChange={v => ui.set('uiScale', v)} />
      <RangeRow label="Corner radius" desc="Roundness of cards, buttons and modals"
        value={ui.cornerRadius} min={0} max={26} unit="px" onChange={v => ui.set('cornerRadius', v)} />
      <Row label="Animations" desc="Interface transitions and motion">
        <Toggle value={ui.animations} onChange={v => ui.set('animations', v)} />
      </Row>
      <Row label="Blur / glass" desc="Frosted glass effects on panels">
        <Toggle value={ui.blur} onChange={v => ui.set('blur', v)} />
      </Row>
      <Row label="Compact mode" desc="Denser lists and cards">
        <Toggle value={ui.compact} onChange={v => ui.set('compact', v)} />
      </Row>
      <div className="flex items-center gap-2 mt-6 mb-1">
        <Palette className="w-4 h-4" style={{ color: 'var(--color-primary)' }} />
        <h3 className="text-sm font-black tracking-wide uppercase" style={{ color: 'var(--color-text)' }}>Visual material</h3>
      </div>
      <RangeRow label="Interface opacity" desc="Transparency of the launcher interface over your background" value={ui.interfaceOpacity} min={35} max={100} unit="%" onChange={v => ui.set('interfaceOpacity', v)} />
      <RangeRow label="Surface opacity" desc="Density of floating cards and interface surfaces" value={ui.surfaceOpacity} min={55} max={100} unit="%" onChange={v => ui.set('surfaceOpacity', v)} />
      <RangeRow label="Border contrast" desc="How visible outlines are across the selected theme" value={ui.borderStrength} min={45} max={150} unit="%" onChange={v => ui.set('borderStrength', v)} />
      <RangeRow label="Shadow depth" desc="Strength of elevation shadows on panels and modals" value={ui.shadowStrength} min={0} max={150} unit="%" onChange={v => ui.set('shadowStrength', v)} />
      <RangeRow label="Motion tempo" desc="Speed multiplier for non-essential interface movement" value={ui.motionSpeed} min={50} max={150} unit="%" onChange={v => ui.set('motionSpeed', v)} />
      <Row label="Accent glow" desc="Show subtle theme-colored light in the application background">
        <Toggle value={ui.accentGlow} onChange={v => ui.set('accentGlow', v)} />
      </Row>
      {ui.accentGlow && <RangeRow label="Accent glow strength" desc="Intensity of the background accent light" value={ui.accentGlowStrength} min={0} max={150} unit="%" onChange={v => ui.set('accentGlowStrength', v)} />}
      <SegRow label="Text color" desc="Force black or white text over the theme (RedStone: black/white)"
        value={ui.textColorOverride}
        options={[{ id: 'auto', label: 'Auto' }, { id: 'black', label: 'Black' }, { id: 'white', label: 'White' }]}
        onChange={v => ui.set('textColorOverride', v as any)} />
      <RangeRow label="Background opacity" value={ui.backgroundOpacity} min={0} max={100} unit="%"
        onChange={v => ui.set('backgroundOpacity', v)} />
      <RangeRow label="Background readability" desc="Dark protective layer behind cards, text and buttons on your image" value={ui.backgroundReadability} min={0} max={90} unit="%" onChange={v => ui.set('backgroundReadability', v)} />
      <SegRow label="Background fit" desc="How the selected background image fills the launcher" value={ui.backgroundFit}
        options={[{ id:'cover', label:'Cover' }, { id:'contain', label:'Contain' }, { id:'stretch', label:'Stretch' }, { id:'tile', label:'Tile' }]}
        onChange={v => ui.set('backgroundFit', v as any)} />
      <SegRow label="Background position" desc="Which part of the image stays visible in the launcher" value={ui.backgroundPosition}
        options={[{ id:'center', label:'Center' }, { id:'top', label:'Top' }, { id:'bottom', label:'Bottom' }, { id:'left', label:'Left' }, { id:'right', label:'Right' }]}
        onChange={v => ui.set('backgroundPosition', v as any)} />
      <RangeRow label="Background blur" desc="Soft blur applied only to the custom background image" value={ui.backgroundBlur} min={0} max={30} unit="px" onChange={v => ui.set('backgroundBlur', v)} />
      <RangeRow label="Background saturation" desc="Color intensity of the custom background image" value={ui.backgroundSaturation} min={0} max={180} unit="%" onChange={v => ui.set('backgroundSaturation', v)} />
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
      <div className="flex items-center gap-2 mt-8 mb-1">
        <Code className="w-4 h-4" style={{ color: 'var(--color-primary)' }} />
        <h3 className="text-sm font-black tracking-wide uppercase" style={{ color: 'var(--color-text)' }}>Custom CSS (.prtheme)</h3>
      </div>
      <p className="text-xs mb-3" style={{ color: 'var(--color-text-secondary)' }}>
        Import a <span style={{ color: 'var(--color-primary)' }}>.prtheme</span> file (plain CSS) and rewrite absolutely anything —
        colors, spacing, positions of the whole UI.
      </p>

      <div className="flex items-center gap-2 mb-3">
        <input ref={fileRef} type="file" accept=".prtheme,.css,text/css" hidden
          onChange={e => importTheme(e.target.files?.[0])} />
        <button onClick={() => fileRef.current?.click()}
          className="flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-bold"
          style={{ background: 'var(--color-primary)', color: 'var(--color-primary-text)' }}>
          <Upload className="w-3.5 h-3.5" />Import .prtheme
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
          {cssSaved ? <><Check className="w-3.5 h-3.5" />Applied</> : <><Save className="w-3.5 h-3.5" />Apply CSS</>}
        </button>
        <button onClick={() => { ui.set('customCss', ''); ui.set('customCssName', ''); setCssDraft(''); }}
          className="flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-bold"
          style={{ background: 'rgba(231,76,60,0.1)', color: 'var(--color-error)' }}>
          <Trash2 className="w-3.5 h-3.5" />Clear
        </button>
        <div className="flex-1" />
        <button onClick={() => ui.reset()}
          className="px-4 py-2 rounded-xl text-xs font-bold"
          style={{ background: 'var(--color-surface-2)', color: 'var(--color-text-secondary)', border: '1px solid var(--color-border)' }}>
          Reset appearance
        </button>
      </div>

    </div>
  );
}

function AudioSection() {
  const s = useSettingsStore();
  const musicFileRef = useRef<HTMLInputElement | null>(null);
  const [musicError, setMusicError] = useState('');
  const chooseMusic = async (file?: File | null) => {
    if (!file) return;
    if (!file.type.startsWith('audio/') || file.size > 12 * 1024 * 1024) { setMusicError('Choose an MP3, WAV or OGG file up to 12 MB.'); return; }
    const data = await new Promise<string>((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result ?? '')); reader.onerror = () => reject(new Error('Unable to read audio file')); reader.readAsDataURL(file); });
    s.update({ backgroundMusic: data, backgroundMusicName: file.name }); setMusicError('');
  };
  return (
    <div>
      <h2 className="text-base font-bold mb-1" style={{ color:'var(--color-text)' }}>Audio</h2>
      <p className="text-sm mb-5" style={{ color:'var(--color-text-secondary)' }}>Sound and volume settings</p>
      <RangeRow label="Master Volume" value={s.masterVolume} min={0} max={100} unit="%" onChange={v => s.setSetting('masterVolume',v)} />
      <Row label="UI Sounds" desc="Play sounds for interactions like button clicks">
        <Toggle value={s.uiSounds} onChange={v => s.setSetting('uiSounds',v)} />
      </Row>
      <SegRow label="Sound profile" desc="Soft is subtle; Arcade has more pronounced feedback; Minimal disables synthesized effects" value={s.uiSoundStyle} options={[{ id:'soft', label:'Soft' }, { id:'arcade', label:'Arcade' }, { id:'minimal', label:'Minimal' }]} onChange={v => s.setSetting('uiSoundStyle', v as any)} />
      <Row label="Install success sound" desc="Play a positive sound after a successful install"><Toggle value={s.playInstallSound} onChange={v => s.setSetting('playInstallSound',v)} /></Row>
      <Row label="Error sound" desc="Play an attention sound when an action fails"><Toggle value={s.playErrorSound} onChange={v => s.setSetting('playErrorSound',v)} /></Row>
      <Row label="Navigation sound" desc="Play a short sound when opening navigation panels"><Toggle value={s.playNavigationSound} onChange={v => s.setSetting('playNavigationSound',v)} /></Row>
      <Row label="Test UI sounds" desc="Preview click, success, navigation and error feedback">
        <div className="flex gap-1"><button onClick={playClick} className="rounded-lg px-2 py-1 text-[10px] font-bold" style={{ background:'var(--color-surface-2)', color:'var(--color-text-secondary)', border:'1px solid var(--color-border)' }}>Click</button><button onClick={playSuccess} className="rounded-lg px-2 py-1 text-[10px] font-bold" style={{ background:'var(--color-surface-2)', color:'var(--color-text-secondary)', border:'1px solid var(--color-border)' }}>Success</button><button onClick={playNav} className="rounded-lg px-2 py-1 text-[10px] font-bold" style={{ background:'var(--color-surface-2)', color:'var(--color-text-secondary)', border:'1px solid var(--color-border)' }}>Nav</button><button onClick={playError} className="rounded-lg px-2 py-1 text-[10px] font-bold" style={{ background:'var(--color-surface-2)', color:'var(--color-text-secondary)', border:'1px solid var(--color-border)' }}>Error</button></div>
      </Row>
      <div className="mt-6 rounded-2xl p-4" style={{ background:'var(--color-surface-2)', border:'1px solid var(--color-border)' }}>
        <p className="text-sm font-black" style={{ color:'var(--color-text)' }}>Background music</p><p className="mt-1 text-xs" style={{ color:'var(--color-text-secondary)' }}>Choose your own local MP3, WAV or OGG. A compact player appears in the upper-left corner only while a file is selected.</p>
        <div className="mt-3 flex flex-wrap items-center gap-2"><input ref={musicFileRef} type="file" accept="audio/mpeg,audio/wav,audio/ogg,audio/mp4" hidden onChange={event => void chooseMusic(event.target.files?.[0])} /><button onClick={() => musicFileRef.current?.click()} className="rounded-xl px-3 py-1.5 text-xs font-bold" style={{ background:'var(--color-primary)', color:'var(--color-primary-text)' }}>Choose music file</button>{s.backgroundMusic && <><span className="max-w-[180px] truncate text-[11px]" style={{ color:'var(--color-text-secondary)' }}>{s.backgroundMusicName}</span><button onClick={() => s.update({ backgroundMusic:'', backgroundMusicName:'' })} className="rounded-xl px-3 py-1.5 text-xs font-bold" style={{ background:'var(--color-surface)', color:'var(--color-error)', border:'1px solid var(--color-border)' }}>Remove</button></>}</div>
        {musicError && <p className="mt-2 text-xs" style={{ color:'var(--color-error)' }}>{musicError}</p>}
        <RangeRow label="Music volume" value={s.musicVolume} min={0} max={100} unit="%" onChange={v => s.setSetting('musicVolume',v)} />
        <SegRow label="Music start" desc="Start automatically when Portal Launcher opens, or wait for Play" value={s.musicAutoplay} options={[{ id:'manual', label:'Manual' }, { id:'startup', label:'On startup' }]} onChange={v => s.setSetting('musicAutoplay', v as any)} />
        <Row label="Loop background music" desc="Repeat the selected track when it ends"><Toggle value={s.musicLoop} onChange={v => s.setSetting('musicLoop',v)} /></Row>
      </div>
    </div>
  );
}

function LanguageSection() {
  const { lang, setLang, getName } = useLanguageStore();
  const LANGS: Lang[] = ['en','ru'];
  return (
    <div className="space-y-1">
      <Row label="Interface Language" desc="Choose Russian or English for the launcher interface">
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

  function saveCfKey() {
    s.setSetting('curseforgeApiKey', cfKey);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  }
  async function testModrinthProxy() {
    const url = proxyUrl.trim().replace(/\/$/, '');
    if (!url) { setProxyStatus('error'); setProxyMessage('Укажи адрес proxy-сервера.'); return; }
    setProxyStatus('checking'); setProxyMessage('Проверяю подключение…');
    try {
      const response = await fetch(`${url}/v2/search?query=sodium&limit=1`, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(8000) });
      const contentType = response.headers.get('content-type') || '';
      if (!response.ok || !contentType.includes('application/json')) throw new Error(`endpoint вернул ${response.status || 'не-JSON ответ'}`);
      setProxyStatus('ok'); setProxyMessage('Transport вернул совместимый JSON. Он включён для поиска и карточек Modrinth.');
    } catch (error) {
      setProxyStatus('error'); setProxyMessage(`Подключение не удалось: ${error instanceof Error ? error.message : 'неизвестная ошибка'}`);
    }
  }

  return (
    <div>
      <h2 className="text-base font-bold mb-1" style={{ color:'var(--color-text)' }}>Дополнительно</h2>
      <p className="text-sm mb-5" style={{ color:'var(--color-text-secondary)' }}>Сервисы каталога и расширенные параметры запуска.</p>

      <div className="mb-5 rounded-2xl p-4" style={{ background:'var(--color-surface-2)', border:'1px solid var(--color-border)' }}>
        <div className="flex items-start justify-between gap-3"><div><p className="text-sm font-black" style={{ color:'var(--color-text)' }}>Транспорт Modrinth</p><p className="mt-1 text-xs leading-5" style={{ color:'var(--color-text-secondary)' }}>Дополнительный endpoint проверяется по реальному поисковому JSON. Если сервис показывает HTML-защиту, ошибки или задержку, лаунчер сразу использует кэш и официальный API — без бесконечного поиска.</p></div><Toggle value={s.modrinthProxyEnabled} onChange={v => s.setSetting('modrinthProxyEnabled', v)} /></div>
        <div className="mt-3 flex gap-2"><input value={proxyUrl} onChange={e => { setProxyUrl(e.target.value); setProxyStatus('idle'); }} placeholder="https://modrinth.black" className="min-w-0 flex-1 rounded-xl px-3 py-2.5 text-sm" style={{ background:'var(--color-surface)', border:'1px solid var(--color-border)', color:'var(--color-text)' }} /><button onClick={() => void testModrinthProxy()} disabled={proxyStatus === 'checking'} className="shrink-0 rounded-xl px-3 py-2 text-xs font-bold" style={{ background:'var(--color-primary)', color:'var(--color-primary-text)', opacity: proxyStatus === 'checking' ? .6 : 1 }}>{proxyStatus === 'checking' ? 'Проверяем…' : 'Проверить JSON'}</button></div>
        <button onClick={() => s.update({ modrinthProxyUrl: proxyUrl.trim().replace(/\/$/, '') })} className="mt-2 rounded-xl px-3 py-1.5 text-xs font-bold" style={{ background:'var(--color-surface)', color:'var(--color-text-secondary)', border:'1px solid var(--color-border)' }}>Сохранить endpoint</button>
        <Row label="Официальный fallback" desc="Использовать официальный Modrinth API, если дополнительный endpoint недоступен"><Toggle value={s.modrinthProxyAllowOfficialFallback} onChange={v => s.setSetting('modrinthProxyAllowOfficialFallback', v)} /></Row>
        {proxyMessage && <p className="mt-2 text-xs" style={{ color: proxyStatus === 'error' ? 'var(--color-error)' : proxyStatus === 'ok' ? 'var(--color-success)' : 'var(--color-text-secondary)' }}>{proxyMessage}</p>}
      </div>

      {/* CurseForge API Key — editable */}
      <div className="py-3.5" style={{ borderBottom:'1px solid var(--color-border)' }}>
        <p className="text-sm font-semibold mb-1" style={{ color:'var(--color-text)' }}>CurseForge API Key</p>
        <p className="text-xs mb-2" style={{ color:'var(--color-text-secondary)' }}>
          Required for CurseForge mod search. Get your key at{' '}
          <span style={{ color:'var(--color-primary)' }}>console.curseforge.com</span>
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
            {saved ? <><Check className="w-4 h-4" />Saved!</> : <><Save className="w-4 h-4" />Save</>}
          </button>
        </div>
        {cfKey && (
          <p className="text-[11px] mt-1.5" style={{ color:'var(--color-text-tertiary)' }}>
            ● Key configured ({cfKey.length} chars)
          </p>
        )}
      </div>

      <Row label="Default Platform" desc="Which platform to use by default in Discover">
        <div className="flex rounded-xl overflow-hidden" style={{ border:'1px solid var(--color-border)' }}>
          {(['modrinth','curseforge'] as const).map(p => (
            <button key={p} onClick={() => s.setSetting('defaultPlatform', p)}
              className="px-3 py-1.5 text-xs font-bold capitalize transition-all"
              style={s.defaultPlatform===p
                ? { background:'var(--color-primary-dim)', color:'var(--color-primary)', border:'1px solid var(--color-primary)' }
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
          <Trash2 className="w-4 h-4" />Reset all settings to default
        </button>
      </div>
    </div>
  );
}

function AboutSection() {
  const language = useSettingsStore(s => s.language);
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
      <h2 className="text-base font-bold mb-1" style={{ color:'var(--color-text)' }}>About Portal Launcher</h2>
      <p className="text-sm mb-5" style={{ color:'var(--color-text-secondary)' }}>Version and license information</p>
      <div className="p-5 rounded-2xl mb-4 flex flex-col items-center gap-3"
        style={{ background:'var(--color-surface-2)', border:'1px solid var(--color-border)' }}>
        <button onClick={handleLogoClick} className={`relative w-20 h-20 rounded-3xl overflow-hidden transition-transform ${burst ? 'scale-110' : 'hover:scale-[1.03]'}`} style={{ boxShadow:`0 8px 24px ${rarityColor}55`, border:`1px solid ${rarityColor}88` }} title="Portal Launcher">
          <img src="/launcher-icon.png" alt="Portal Launcher" className="w-full h-full object-cover" draggable={false} style={{ filter: clicks >= 5 ? `hue-rotate(${Math.min(260, clicks % 360)}deg) saturate(${1 + Math.min(1.5, clicks / 500)})` : undefined }} />
          {burst && <span className="absolute inset-0 animate-ping rounded-3xl" style={{ border:`2px solid ${rarityColor}` }} />}
        </button>
        <div className="text-center">
          <p className="font-black text-xl" style={{ color:'var(--color-text)' }}>Portal Launcher</p>
          <p className="text-sm mt-0.5" style={{ color:'var(--color-text-secondary)' }}>Version 1.0.0</p>
          <p className="text-xs mt-1" style={{ color:'var(--color-text-tertiary)' }}>Built with Tauri v2 · React · TypeScript</p>
          <p className="mt-2 text-[11px] font-black uppercase tracking-wider" style={{ color:rarityColor }}>{rarityLabel} · {clicks} {language === 'ru' ? 'кликов' : 'clicks'}</p>
          {clicks >= 5 && <p className="mt-1 text-[10px]" style={{ color:'var(--color-text-tertiary)' }}>{language === 'ru' ? 'Иконка лаунчера перешла в альтернативную редкость.' : 'The launcher icon has entered an alternate rarity.'}</p>}
        </div>
      </div>
      <AnimatePresence>
        {manusReveal && (
          <motion.div className="mb-4 flex items-center gap-3 p-3.5" initial={{ opacity:0, y:8, scale:0.98 }} animate={{ opacity:1, y:0, scale:1 }} exit={{ opacity:0, y:8, scale:0.98 }} style={{ borderRadius:'var(--radius-card)', background:'linear-gradient(135deg, color-mix(in srgb, var(--color-primary) 18%, var(--color-surface)), var(--color-surface-2))', border:'1px solid var(--color-primary)', boxShadow:'var(--shadow-md)' }}>
            <img src={manusAchievement} alt="Manus" className="h-10 w-[102px] rounded-lg object-contain" style={{ background:'#202020' }} />
            <div className="min-w-0"><p className="text-sm font-black" style={{ color:'var(--color-text)' }}>Who are you?</p><p className="mt-0.5 text-[11px]" style={{ color:'var(--color-text-secondary)' }}>Manus — the collaborator who helped Portalrolls build Portal Launcher.</p></div>
          </motion.div>
        )}
      </AnimatePresence>
      {verityUnlocked && <div className="mb-4 flex items-center gap-3 p-3" style={{ borderRadius:'var(--radius-card)', background:'var(--color-surface-2)', border:'1px solid var(--color-border)' }}><p className="text-[11px] font-bold" style={{ color:'var(--color-text-secondary)' }}>Verity · Что-то случиться через 3 дня...</p></div>}
      {[
        { label:'Made By', value:'Portalrolls' },
        { label:'Tauri Version', value:'2.x' },
        { label:'React Version', value:'18.x' },
        { label:'License', value:'MIT' },
      ].map(r => (
        <div key={r.label} className="flex items-center justify-between py-3" style={{ borderBottom:'1px solid var(--color-border)' }}>
          <p className="text-sm" style={{ color:'var(--color-text-secondary)' }}>{r.label}</p>
          <p className="text-sm font-semibold" style={{ color: r.label === 'Made By' ? 'var(--color-primary)' : 'var(--color-text)' }}>{r.value}</p>
        </div>
      ))}
    </div>
  );
}

const SECTION_CONTENT: Record<Section, React.FC> = {
  account: AccountSection,
  minecraft: MinecraftSection,
  appearance: AppearanceSection,
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
    <div className="h-full overflow-hidden p-3 sm:p-4" style={{ background:'transparent' }}>
      <div className="flex h-full overflow-hidden rounded-[22px]" style={{ border:'1px solid var(--color-border)', background:'color-mix(in srgb, var(--color-surface) 38%, transparent)' }}>
        <aside className="shrink-0 flex h-full flex-col overflow-y-auto p-2.5"
          style={{ width:264, background:'linear-gradient(180deg, color-mix(in srgb, var(--color-surface) 78%, transparent), color-mix(in srgb, var(--color-bg) 30%, transparent))', borderRight:'1px solid var(--color-border)' }}>
          <div className="mb-3 flex items-center gap-3 rounded-2xl p-3" style={{ background:'var(--color-primary-dim)', border:'1px solid color-mix(in srgb, var(--color-primary) 35%, var(--color-border))' }}>
            <img src="/launcher-icon.png" alt="Portal Launcher" className="h-9 w-9 rounded-xl object-cover" />
            <div className="min-w-0"><p className="truncate text-sm font-black" style={{ color:'var(--color-text)' }}>Portal Launcher</p><p className="text-[10px]" style={{ color:'var(--color-text-secondary)' }}>Центр управления</p></div>
          </div>
          <p className="mb-1 px-2 text-[10px] font-black uppercase tracking-[0.16em]" style={{ color:'var(--color-text-tertiary)' }}>Настройки</p>
          <nav className="space-y-1">
            {SECTIONS.map(sec => {
              const Icon = sec.icon;
              const active = activeSection === sec.id;
              return (
                <button key={sec.id}
                  onClick={() => { setActiveSection(sec.id); navigate(`/settings/${sec.id}`); }}
                  className="group relative flex w-full items-center gap-3 rounded-2xl px-3 py-2.5 text-left transition-all"
                  style={active
                    ? { background:'var(--color-primary-dim)', color:'var(--color-text)', border:'1px solid var(--color-primary)' }
                    : { color:'var(--color-text-secondary)', border:'1px solid transparent' }}>
                  <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl" style={{ background:active?'var(--color-primary)':'var(--color-surface-2)', color:active?'var(--color-primary-text)':'var(--color-text-secondary)' }}><Icon className="h-4 w-4" /></span>
                  <span className="min-w-0"><span className="block text-xs font-black">{sec.label}</span><span className="block truncate text-[10px]" style={{ color:active?'var(--color-text-secondary)':'var(--color-text-tertiary)' }}>{sec.desc}</span></span>
                  {active && <span className="absolute right-2 h-1.5 w-1.5 rounded-full" style={{ background:'var(--color-primary)' }} />}
                </button>
              );
            })}
          </nav>
          <div className="mt-auto rounded-2xl p-3" style={{ background:'var(--color-surface-2)', border:'1px solid var(--color-border)' }}>
            <p className="text-[10px] font-black uppercase tracking-wide" style={{ color:'var(--color-primary)' }}>Сохраняется автоматически</p>
            <p className="mt-1 text-[10px] leading-4" style={{ color:'var(--color-text-secondary)' }}>Тема, Java, панели и язык сохраняются после перезапуска.</p>
          </div>
        </aside>

        <div className="flex-1 min-w-0 overflow-y-auto" style={{ background:'radial-gradient(ellipse at 100% 0%, var(--color-primary-dim), transparent 35%), color-mix(in srgb, var(--color-bg) 24%, transparent)' }}>
          <div className="mx-auto max-w-3xl px-5 py-5 sm:px-8 sm:py-7">
            <div className="mb-5 flex items-center gap-3 rounded-2xl p-4" style={{ background:'color-mix(in srgb, var(--color-surface) 88%, transparent)', border:'1px solid var(--color-border)', boxShadow:'var(--shadow-sm)' }}>
              <span className="flex h-10 w-10 items-center justify-center rounded-xl" style={{ background:'var(--color-primary)', color:'var(--color-primary-text)' }}><ActiveIcon className="h-5 w-5" /></span>
              <div><p className="text-base font-black" style={{ color:'var(--color-text)' }}>{activeMeta.label}</p><p className="text-xs" style={{ color:'var(--color-text-secondary)' }}>{activeMeta.desc}</p></div>
            </div>
            <div className="rounded-2xl p-4 sm:p-6" style={{ background:'color-mix(in srgb, var(--color-surface) 94%, transparent)', border:'1px solid var(--color-border)', boxShadow:'var(--shadow-sm)' }}>
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

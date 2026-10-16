import { useState, useCallback, useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { motion } from 'framer-motion';
import {
  Play, Plus, Upload, Settings, FolderOpen, Search, MoreVertical,
  StopCircle, Clock3, Box, ChevronRight, ArrowUpRight, Filter as FilterIcon,
  X, Check, ImagePlus, Layers3, Sparkles, Hammer, Gamepad2, Wrench, Download,
} from 'lucide-react';
import { useInstanceStore, type Instance } from '@/stores/instanceStore';
import { useCurrentUser } from '@/stores/authStore';
import { useSettingsStore } from '@/stores/settingsStore';
import { useLaunchStore } from '@/stores/launchStore';
import { invoke } from '@/lib/invoke-shim';
import { toIconSrc } from '@/lib/icon-src';
import { fetchMcVersionIds, MC_VERSIONS_FALLBACK } from '@/lib/mc-versions';

const stagger = { hidden: {}, show: { transition: { staggerChildren: 0.05 } } };
const fadeUp = { hidden: { opacity: 0, y: 14 }, show: { opacity: 1, y: 0, transition: { duration: 0.38, ease: [0.16, 1, 0.3, 1] } } };

const LOADER_COLORS: Record<string, string> = {
  vanilla: 'var(--color-text-secondary)', fabric: '#E274F2', forge: '#F97316',
  neoforge: '#45D6FF', quilt: '#DB2777', bedrock: '#2ECC71', optifine: '#5C8BF4', labymod: '#EAB308',
};

const CREATION_LOADERS = [
  { id: 'vanilla', label: 'Vanilla', description: 'Чистый Minecraft', Icon: Gamepad2 },
  { id: 'fabric', label: 'Fabric', description: 'Лёгкий и быстрый', Icon: Layers3 },
  { id: 'forge', label: 'Forge', description: 'Большие модпаки', Icon: Hammer },
  { id: 'neoforge', label: 'NeoForge', description: 'Новое поколение Forge', Icon: Sparkles },
  { id: 'quilt', label: 'Quilt', description: 'Совместимый загрузчик', Icon: Layers3 },
  { id: 'bedrock', label: 'Bedrock', description: 'Minecraft для Windows', Icon: Box },
] as const;

const INSTANCE_ICON_CHOICES = [
  { id: 'portal', label: 'Портал', color: '#E74C3C', glyph: '✦' },
  { id: 'grass', label: 'Трава', color: '#2ECC71', glyph: '▣' },
  { id: 'diamond', label: 'Алмаз', color: '#38BDF8', glyph: '◆' },
  { id: 'nether', label: 'Незер', color: '#F97316', glyph: '◈' },
  { id: 'ender', label: 'Эндер', color: '#A78BFA', glyph: '◉' },
  { id: 'redstone', label: 'Редстоун', color: '#EF4444', glyph: '⚡' },
] as const;

function makeInstanceIcon(choice: (typeof INSTANCE_ICON_CHOICES)[number]) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256"><defs><linearGradient id="g" x1="0" x2="1" y1="0" y2="1"><stop stop-color="${choice.color}"/><stop offset="1" stop-color="#111827"/></linearGradient></defs><rect width="256" height="256" rx="48" fill="url(#g)"/><circle cx="128" cy="128" r="76" fill="none" stroke="white" stroke-opacity=".82" stroke-width="18"/><circle cx="128" cy="128" r="42" fill="${choice.color}" stroke="white" stroke-opacity=".35" stroke-width="6"/><text x="128" y="148" text-anchor="middle" font-size="54" font-family="sans-serif" font-weight="900" fill="white">${choice.glyph}</text></svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

function fmtMinutes(mins: number) {
  if (!mins) return '';
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return h ? `${h} ч ${m ? `${m} мин` : ''}`.trim() : `${m} мин`;
}

function InnovativeCreateModal({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const navigate = useNavigate();
  const user = useCurrentUser();
  const [step, setStep] = useState<'type' | 'custom'>('type');
  const [loader, setLoader] = useState<(typeof CREATION_LOADERS)[number]['id']>('fabric');
  const [name, setName] = useState('');
  const [version, setVersion] = useState('');
  const [versions, setVersions] = useState<string[]>([]);
  const [icon, setIcon] = useState<(typeof INSTANCE_ICON_CHOICES)[number]>(INSTANCE_ICON_CHOICES[0]);
  const [bedrock, setBedrock] = useState<Array<{ family: string; display_name: string; version: string }>>([]);
  const [bedrockFamily, setBedrockFamily] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (loader === 'bedrock') {
      invoke<Array<{ family: string; display_name: string; version: string }>>('list_bedrock_versions')
        .then(list => { setBedrock(list || []); setBedrockFamily(current => current || list?.[0]?.family || ''); })
        .catch(() => setBedrock([]));
      return;
    }
    fetchMcVersionIds(false).then(list => setVersions(list.length ? list : MC_VERSIONS_FALLBACK)).catch(() => setVersions(MC_VERSIONS_FALLBACK));
  }, [loader]);

  const selectedLoader = CREATION_LOADERS.find(item => item.id === loader)!;
  const create = async () => {
    if (loader !== 'bedrock' && !version) { setError('Выберите версию Minecraft.'); return; }
    if (loader === 'bedrock' && !bedrockFamily) { setError('На этом компьютере не найдено установленное издание Bedrock.'); return; }
    setBusy(true); setError('');
    try {
      const pkg = bedrock.find(item => item.family === bedrockFamily);
      await invoke('create_instance', {
        name: name.trim() || `${selectedLoader.label} ${loader === 'bedrock' ? (pkg?.version || 'Bedrock') : version}`,
        description: '',
        mcVersion: loader === 'bedrock' ? (pkg?.version || 'Bedrock') : version,
        loader,
        loaderVersion: loader === 'bedrock' ? bedrockFamily : '',
        minRam: 1024,
        maxRam: 4096,
        javaPath: '',
        customJvmArgs: '',
        icon: makeInstanceIcon(icon),
        color: icon.color,
      });
      onCreated();
      onClose();
    } catch (err) {
      setError(String(err));
    } finally { setBusy(false); }
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-5" style={{ background: 'rgba(0,0,0,.78)' }} onMouseDown={event => { if (event.target === event.currentTarget) onClose(); }}>
      <motion.div initial={{ opacity: 0, y: 16, scale: .97 }} animate={{ opacity: 1, y: 0, scale: 1 }} className="w-full max-w-[520px] overflow-hidden rounded-[20px]" style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', boxShadow: '0 28px 90px rgba(0,0,0,.5)' }}>
        <div className="flex items-start justify-between gap-4 border-b px-6 py-5" style={{ borderColor: 'var(--color-border)' }}>
          <div><h2 className="text-base font-black" style={{ color: 'var(--color-text)' }}>Создать сборку</h2>{step === 'type' ? <p className="mt-5 text-xs" style={{ color: 'var(--color-text-secondary)' }}>Выберите способ создания сборки</p> : <p className="mt-1 text-xs" style={{ color: 'var(--color-text-secondary)' }}>Выберите Minecraft, ядро, версию ядра и свою иконку.</p>}</div>
          <button type="button" onClick={onClose} className="flex h-9 w-9 items-center justify-center rounded-xl" style={{ color: 'var(--color-text-tertiary)', background: 'var(--color-surface-2)' }}><X size={16} /></button>
        </div>
        <div className="max-h-[70vh] overflow-y-auto px-6 py-5">
          {step === 'type' ? <div className="space-y-3">
            <button type="button" onClick={() => setStep('custom')} className="group flex w-full items-center gap-4 rounded-2xl p-4 text-left transition-all hover:scale-[1.01]" style={{ background: 'var(--color-surface-2)', border: '1px solid var(--color-border)' }}>
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl" style={{ color: 'var(--color-primary)' }}><Wrench size={19} /></span>
              <span className="min-w-0 flex-1"><span className="block text-sm font-black" style={{ color: 'var(--color-text)' }}>Своя сборка</span><span className="mt-1 block text-xs" style={{ color: 'var(--color-text-secondary)' }}>Выберите Minecraft, ядро, версию ядра и свою иконку.</span></span><ChevronRight size={17} className="opacity-0 transition-opacity group-hover:opacity-100" style={{ color: 'var(--color-primary)' }} />
            </button>
            <button type="button" onClick={() => navigate('/library?import=1')} className="group flex w-full items-center gap-4 rounded-2xl p-4 text-left transition-all hover:scale-[1.01]" style={{ background: 'var(--color-surface-2)', border: '1px solid var(--color-border)' }}>
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl" style={{ color: 'var(--color-primary)' }}><Download size={19} /></span>
              <span className="min-w-0 flex-1"><span className="block text-sm font-black" style={{ color: 'var(--color-text)' }}>Установить или импортировать сборку</span><span className="mt-1 block text-xs" style={{ color: 'var(--color-text-secondary)' }}>Найдите модпак в Discover, откройте .mrpack / .zip или перенесите сборку.</span></span><ChevronRight size={17} className="opacity-0 transition-opacity group-hover:opacity-100" style={{ color: 'var(--color-primary)' }} />
            </button>
          </div> : <>
          <div className="flex items-center gap-3">
            <div className="h-16 w-16 shrink-0 overflow-hidden rounded-2xl" style={{ background: icon.color }}><img src={makeInstanceIcon(icon)} alt="" className="h-full w-full" /></div>
            <div className="min-w-0 flex-1"><label className="mb-1.5 block text-xs font-bold" style={{ color: 'var(--color-text)' }}>Название сборки</label><input autoFocus value={name} onChange={event => setName(event.target.value)} placeholder={`${selectedLoader.label} ${version || ''}`} className="w-full rounded-xl px-3 py-2.5 text-sm font-semibold outline-none" style={{ background: 'var(--color-surface-2)', border: '1px solid var(--color-border)', color: 'var(--color-text)' }} /></div>
          </div>
          <p className="mb-2 mt-5 text-[10px] font-black uppercase tracking-[.16em]" style={{ color: 'var(--color-text-tertiary)' }}>Иконка сборки</p>
          <div className="grid grid-cols-6 gap-2">{INSTANCE_ICON_CHOICES.map(choice => <button type="button" key={choice.id} title={choice.label} onClick={() => setIcon(choice)} className="flex flex-col items-center gap-1 rounded-xl p-2 transition-transform hover:scale-105" style={{ background: choice.id === icon.id ? `${choice.color}22` : 'var(--color-surface-2)', border: `1px solid ${choice.id === icon.id ? choice.color : 'var(--color-border)'}` }}><img src={makeInstanceIcon(choice)} alt="" className="h-9 w-9 rounded-lg" /><span className="truncate text-[9px] font-bold" style={{ color: 'var(--color-text-secondary)' }}>{choice.label}</span></button>)}</div>
          <p className="mb-2 mt-5 text-[10px] font-black uppercase tracking-[.16em]" style={{ color: 'var(--color-text-tertiary)' }}>Игровое ядро</p>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">{CREATION_LOADERS.map(item => { const selected = loader === item.id; const disabled = item.id === 'bedrock' && !(user?.provider === 'microsoft' || (!user?.provider && !user?.isDemo)); return <button type="button" key={item.id} disabled={disabled} onClick={() => setLoader(item.id)} className="flex items-center gap-2 rounded-2xl p-3 text-left transition-all hover:scale-[1.02] disabled:cursor-not-allowed disabled:opacity-35" style={{ background: selected ? `${LOADER_COLORS[item.id] || 'var(--color-primary)'}18` : 'var(--color-surface-2)', border: `1px solid ${selected ? (LOADER_COLORS[item.id] || 'var(--color-primary)') : 'var(--color-border)'}` }}><span className="flex h-9 w-9 items-center justify-center rounded-xl" style={{ color: LOADER_COLORS[item.id] || 'var(--color-primary)', background: 'rgba(255,255,255,.04)' }}><item.Icon size={17} /></span><span className="min-w-0"><span className="block truncate text-xs font-black" style={{ color: 'var(--color-text)' }}>{item.label}</span><span className="block truncate text-[9px]" style={{ color: 'var(--color-text-tertiary)' }}>{item.description}</span></span>{selected && <Check size={14} className="ml-auto shrink-0" style={{ color: 'var(--color-primary)' }} />}</button>; })}</div>
          {loader === 'bedrock' ? <div className="mt-4 rounded-2xl p-4" style={{ background: 'rgba(46,204,113,.08)', border: '1px solid rgba(46,204,113,.25)' }}><p className="text-xs font-bold" style={{ color: 'var(--color-text)' }}>Установленное издание Bedrock</p><p className="mt-1 text-[10px]" style={{ color: 'var(--color-text-secondary)' }}>Bedrock запускается через Microsoft Store и не требует Java.</p>{bedrock.length ? <select value={bedrockFamily} onChange={event => setBedrockFamily(event.target.value)} className="mt-3 w-full rounded-xl px-3 py-2.5 text-xs font-bold" style={{ background: 'var(--color-surface-2)', border: '1px solid var(--color-border)', color: 'var(--color-text)' }}>{bedrock.map(pkg => <option key={pkg.family} value={pkg.family}>{pkg.display_name} · {pkg.version}</option>)}</select> : <p className="mt-3 text-xs font-bold" style={{ color: 'var(--color-warning)' }}>Bedrock Edition не найден на этом ПК.</p>}</div> : <div className="mt-4"><label className="mb-2 block text-xs font-bold" style={{ color: 'var(--color-text)' }}>Версия Minecraft</label><select value={version} onChange={event => setVersion(event.target.value)} className="w-full rounded-xl px-3 py-2.5 text-sm font-bold" style={{ background: 'var(--color-surface-2)', border: '1px solid var(--color-border)', color: 'var(--color-text)' }}><option value="">Выберите версию</option>{versions.slice(0, 80).map(item => <option key={item} value={item}>{item}</option>)}</select></div>}
          {error && <p className="mt-4 rounded-xl px-3 py-2 text-xs font-bold" style={{ color: 'var(--color-error)', background: 'rgba(231,76,60,.1)', border: '1px solid rgba(231,76,60,.25)' }}>{error}</p>}
          </>}
        </div>
        {step === 'custom' && <div className="flex items-center justify-between gap-3 border-t px-6 py-4" style={{ borderColor: 'var(--color-border)' }}><button type="button" onClick={() => setStep('type')} className="text-xs font-bold" style={{ color: 'var(--color-text-secondary)' }}>Назад</button><button type="button" onClick={() => void create()} disabled={busy} className="flex items-center gap-2 rounded-2xl px-5 py-2.5 text-xs font-black disabled:opacity-50" style={{ background: 'var(--color-primary)', color: 'var(--color-primary-text)' }}>{busy ? <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white" /> : <Plus size={15} />} Создать сборку</button></div>}
      </motion.div>
    </div>
  );
}

export function InnovativeLibrary() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const instances = useInstanceStore(s => s.instances);
  const syncFromBackend = useInstanceStore(s => s.syncFromBackend);
  const update = useInstanceStore(s => s.update);
  const user = useCurrentUser();
  const globalSettings = useSettingsStore(s => ({
    minRam: s.minRam, maxRam: s.maxRam, javaPath: s.javaPath, customJvmArgs: s.customJvmArgs,
  }));
  const getStatus = useLaunchStore(s => s.getStatus);
  const setStatus = useLaunchStore(s => s.setStatus);

  const [search, setSearch] = useState('');
  const [sortBy, setSortBy] = useState<'name' | 'lastPlayed' | 'version'>('lastPlayed');
  const [createOpen, setCreateOpen] = useState(false);

  useEffect(() => {
    if (searchParams.get('create') === '1') {
      setCreateOpen(true);
      const next = new URLSearchParams(searchParams);
      next.delete('create');
      setSearchParams(next, { replace: true });
    }
  }, [searchParams, setSearchParams]);

  const refreshInstances = useCallback(async () => {
    try { syncFromBackend(await invoke<any[]>('get_instances')); } catch (error) { console.error('Failed to refresh instances:', error); }
  }, [syncFromBackend]);

  const filtered = instances
    .filter(i => i.name.toLowerCase().includes(search.toLowerCase()))
    .sort((a, b) => {
      if (sortBy === 'name') return a.name.localeCompare(b.name);
      if (sortBy === 'lastPlayed') return (b.lastPlayed || b.createdAt).localeCompare(a.lastPlayed || a.createdAt);
      return a.minecraftVersion.localeCompare(b.minecraftVersion);
    });

  const totalHours = Math.round(instances.reduce((s, i) => s + (i.totalPlayTime || 0), 0) / 60);

  const handleLaunch = useCallback(async (inst: Instance) => {
    const current = getStatus(inst.id);
    if (current === 'running') { navigate(`/library/${inst.id}`); return; }
    if (current === 'launching') return;
    if (!user) { navigate('/settings/account'); return; }

    if (inst.modLoader === 'bedrock') {
      try { await invoke('launch_bedrock', { family: inst.modLoaderVersion || null }); } catch (e) { console.error(e); }
      update(inst.id, { lastPlayed: new Date().toISOString() });
      return;
    }

    setStatus(inst.id, 'launching');
    try {
      await invoke('ensure_instance', {
        id: inst.id, name: inst.name, mcVersion: inst.minecraftVersion,
        loader: inst.modLoader, loaderVersion: inst.modLoaderVersion || '',
        minRam: globalSettings.minRam, maxRam: globalSettings.maxRam,
        javaPath: globalSettings.javaPath || '', customJvmArgs: globalSettings.customJvmArgs || '',
        color: inst.color, icon: inst.iconPath || null,
      });
      update(inst.id, { lastPlayed: new Date().toISOString() });
      if (!user.uuid || !user.username) throw new Error('Нужно войти в аккаунт');
      await invoke('launch_instance', {
        instance_id: inst.id, access_token: user.accessToken || '',
        uuid: user.uuid, username: user.username, provider: user.provider,
      });
    } catch (err) { console.error(err); setStatus(inst.id, 'idle'); }
  }, [user, globalSettings, getStatus, setStatus, navigate, update]);

  const handleStop = useCallback(async (inst: Instance) => {
    try { await invoke('cancel_launch', { instanceId: inst.id }); } catch (e) { console.error(e); }
    setStatus(inst.id, 'idle');
  }, [setStatus]);

  return (
    <motion.div className="h-full overflow-auto" variants={stagger} initial="hidden" animate="show">
      <div className="mx-6 mt-6">
        {/* header */}
        <motion.div variants={fadeUp} className="flex flex-col sm:flex-row sm:items-end gap-5 mb-6">
          <div className="flex-1">
            <h1 className="text-[28px] font-extrabold tracking-tight" style={{ color: 'var(--color-text)' }}>
              Библиотека
            </h1>
            <p className="mt-1 text-[13px]" style={{ color: 'var(--color-text-secondary)' }}>
              {instances.length} {instances.length === 1 ? 'сборка' : instances.length < 5 ? 'сборки' : 'сборок'} · {totalHours} ч в игре
            </p>
          </div>
          <div className="flex gap-2">
            <button onClick={() => setCreateOpen(true)}
              className="flex items-center gap-2 rounded-2xl px-5 py-2.5 text-[13px] font-bold transition-all hover:scale-[1.03] active:scale-[0.97]"
              style={{ background: 'var(--color-primary)', color: 'var(--color-primary-text)', boxShadow: '0 10px 28px -10px color-mix(in srgb, var(--color-primary) 70%, transparent)' }}>
              <Plus size={15} /> Создать
            </button>
            <button onClick={() => navigate('/library?import=1')}
              className="flex items-center gap-2 rounded-2xl px-5 py-2.5 text-[13px] font-semibold transition-all hover:scale-[1.03] active:scale-[0.97]"
              style={{ background: 'color-mix(in srgb, var(--color-surface-2) 70%, transparent)', color: 'var(--color-text)', border: '1px solid var(--color-border)' }}>
              <Upload size={15} /> Импорт
            </button>
          </div>
        </motion.div>

        {/* search + sort */}
        <motion.div variants={fadeUp} className="flex gap-3 mb-5">
          <div className="flex-1 flex items-center gap-2 rounded-2xl px-4 py-2.5"
            style={{ background: 'color-mix(in srgb, var(--color-surface) 72%, transparent)', border: '1px solid var(--color-border)' }}>
            <Search size={15} style={{ color: 'var(--color-text-tertiary)' }} />
            <input aria-label="Найти сборку" value={search} onChange={e => setSearch(e.target.value)} placeholder="Найти сборку…"
              className="flex-1 bg-transparent text-[13px] font-semibold outline-none" style={{ color: 'var(--color-text)' }} />
          </div>
          <select value={sortBy} onChange={e => setSortBy(e.target.value as any)}
            className="rounded-2xl px-4 py-2.5 text-[12px] font-bold outline-none"
            style={{ background: 'color-mix(in srgb, var(--color-surface) 72%, transparent)', border: '1px solid var(--color-border)', color: 'var(--color-text)' }}>
            <option value="lastPlayed">По дате</option>
            <option value="name">По имени</option>
            <option value="version">По версии</option>
          </select>
        </motion.div>

        {/* grid */}
        {filtered.length > 0 ? (
          <motion.div variants={fadeUp} className="grid grid-cols-3 gap-4">
            {filtered.map(inst => {
              const status = getStatus(inst.id);
              const isRunning = status === 'running';
              const isLaunching = status === 'launching';
              return (
                <div key={inst.id} className="group relative overflow-hidden rounded-[22px] transition-all hover:scale-[1.01]"
                  style={{ background: 'color-mix(in srgb, var(--color-surface) 72%, transparent)', border: '1px solid var(--color-border)' }}>
                  {/* icon cover */}
                  <div className="relative h-36 overflow-hidden"
                    style={{ background: inst.color || 'var(--color-primary)' }}>
                    {inst.iconPath ? (
                      <img src={toIconSrc(inst.iconPath)} className="absolute inset-0 h-full w-full object-cover opacity-80 transition-opacity group-hover:opacity-100" alt="" draggable={false} />
                    ) : (
                      <div className="absolute inset-0 flex items-center justify-center text-[42px] font-black opacity-30" style={{ color: '#fff' }}>
                        {inst.name[0]?.toUpperCase()}
                      </div>
                    )}
                    {/* loader badge */}
                    <span className="absolute left-3 top-3 rounded-full px-2.5 py-1 text-[9px] font-bold uppercase tracking-wide backdrop-blur-sm"
                      style={{ background: 'rgba(0,0,0,0.55)', color: LOADER_COLORS[inst.modLoader] || '#fff' }}>
                      {inst.modLoader}
                    </span>
                    {/* play button */}
                    <button
                      onClick={() => isRunning ? navigate(`/library/${inst.id}`) : handleLaunch(inst)}
                      disabled={isLaunching}
                      className="absolute right-3 top-3 flex h-10 w-10 items-center justify-center rounded-full transition-all hover:scale-110 active:scale-95"
                      style={{
                        background: isRunning ? 'var(--color-success)' : 'var(--color-primary)',
                        boxShadow: `0 6px 20px -4px ${isRunning ? 'color-mix(in srgb, var(--color-success) 70%, transparent)' : 'color-mix(in srgb, var(--color-primary) 70%, transparent)'}`,
                      }}>
                      {isLaunching
                        ? <div className="h-5 w-5 rounded-full border-2 border-white/80 border-t-transparent animate-spin" />
                        : isRunning
                          ? <ArrowUpRight size={16} color="#fff" />
                          : <Play size={16} fill="#fff" color="#fff" />
                      }
                    </button>
                    {/* running indicator ring */}
                    {isRunning && (
                      <div className="absolute bottom-3 right-3 flex items-center gap-1.5 rounded-full px-2.5 py-1"
                        style={{ background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(12px)' }}>
                        <span className="h-2 w-2 rounded-full animate-pulse" style={{ background: 'var(--color-success)' }} />
                        <span className="text-[10px] font-bold text-white/90">Запущена</span>
                      </div>
                    )}
                  </div>

                  {/* info */}
                  <div className="p-4">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-[14px] font-bold" style={{ color: 'var(--color-text)' }}>{inst.name}</p>
                        <p className="mt-1 text-[11px] font-semibold" style={{ color: 'var(--color-text-secondary)' }}>
                          {inst.minecraftVersion}
                          {inst.modLoaderVersion ? ` · ${inst.modLoaderVersion}` : ''}
                        </p>
                      </div>
                      <button onClick={() => navigate(`/library/${inst.id}`)}
                        className="shrink-0 flex h-8 w-8 items-center justify-center rounded-xl transition-all hover:bg-white/5"
                        style={{ color: 'var(--color-text-tertiary)' }}>
                        <Settings size={14} />
                      </button>
                    </div>
                    <div className="mt-3 flex items-center justify-between">
                      <div className="flex items-center gap-1.5 text-[10px]" style={{ color: 'var(--color-text-tertiary)' }}>
                        <Clock3 size={12} />
                        {inst.lastPlayed
                          ? new Date(inst.lastPlayed).toLocaleDateString('ru-RU')
                          : 'Не запускалась'}
                      </div>
                      {inst.totalPlayTime > 0 && (
                        <span className="rounded-full px-2 py-0.5 text-[9px] font-bold"
                          style={{ background: 'color-mix(in srgb, var(--color-primary) 12%, transparent)', color: 'var(--color-primary)' }}>
                          {fmtMinutes(inst.totalPlayTime)}
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </motion.div>
        ) : (
          <motion.div variants={fadeUp} className="flex h-64 flex-col items-center justify-center rounded-[24px] border border-dashed text-center"
            style={{ borderColor: 'var(--color-border)', background: 'color-mix(in srgb, var(--color-surface) 42%, transparent)' }}>
            <div className="flex h-14 w-14 items-center justify-center rounded-2xl"
              style={{ background: 'color-mix(in srgb, var(--color-primary) 14%, transparent)', color: 'var(--color-primary)' }}>
              <FolderOpen size={22} />
            </div>
            <p className="mt-3 text-[15px] font-bold" style={{ color: 'var(--color-text)' }}>
              {search ? 'Ничего не найдено' : 'Пока пусто'}
            </p>
            <p className="mt-1 max-w-sm text-[12px]" style={{ color: 'var(--color-text-tertiary)' }}>
              {search ? 'Попробуйте другой запрос' : 'Импортируйте MRPACK, ZIP или создайте сборку вручную'}
            </p>
            {!search && (
              <div className="mt-5 flex gap-2">
                <button onClick={() => setCreateOpen(true)}
                  className="flex items-center gap-2 rounded-2xl px-5 py-2.5 text-[12px] font-bold"
                  style={{ background: 'var(--color-primary)', color: 'var(--color-primary-text)' }}>
                  <Plus size={14} /> Создать сборку
                </button>
                <button onClick={() => navigate('/library?import=1')}
                  className="flex items-center gap-2 rounded-2xl px-5 py-2.5 text-[12px] font-semibold"
                  style={{ background: 'color-mix(in srgb, var(--color-surface-2) 70%, transparent)', color: 'var(--color-text)', border: '1px solid var(--color-border)' }}>
                  <Upload size={14} /> Импорт
                </button>
              </div>
            )}
          </motion.div>
        )}
      </div>
      {createOpen && <InnovativeCreateModal onClose={() => setCreateOpen(false)} onCreated={() => void refreshInstances()} />}
    </motion.div>
  );
}

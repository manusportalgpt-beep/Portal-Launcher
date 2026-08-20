import { useState, useEffect, useCallback, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useNavigate, useSearchParams, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  Play, Plus, Settings, Square, Package, Image, Sparkles, Database, Shield,
  Search, RefreshCw, Download, Trash2, ChevronDown, MoreVertical, X,
  Copy, Folder, FileText, Check, Terminal, ClipboardCopy, Trash,
  Globe, Skull, FolderPlus, Home, Upload, ArrowLeft, ArrowRight, Clock, Layers, Box, Wrench, MonitorPlay, Link2,
} from 'lucide-react';
import { useInstanceStore, Instance } from '@/stores/instanceStore';
import { useCurrentUser } from '@/stores/authStore';
import { useSettingsStore } from '@/stores/settingsStore';
import { invoke } from '@/lib/invoke-shim';
import { toIconSrc } from '@/lib/icon-src';
import { createInstanceShortcutIco } from '@/lib/instance-shortcut-icon';
import { useAuthorAvatar } from '@/lib/author-avatar';
import { useLaunchStore } from '@/stores/launchStore';
import { dialog } from '@/stores/dialogStore';
import { listen } from '@tauri-apps/api/event';
import { fetchMcVersionIds, MC_VERSIONS_FALLBACK } from '@/lib/mc-versions';
import { InstanceFileEditor } from '@/components/InstanceFileEditor';
import { InstanceScreenshotManager } from '@/components/InstanceScreenshotManager';
import { ModpackManifestPreview, type ModpackPreview } from '@/components/ModpackManifestPreview';
import { useUiStore } from '@/stores/uiStore';
import modrinthWrench from '@/assets/modrinth-wrench-clean.png';
import curseforgeAnvil from '@/assets/curseforge-anvil.png';

const LOADER_COLOR: Record<string, string> = {
  vanilla: 'var(--color-text-secondary)', fabric: 'var(--color-primary)', forge: 'var(--color-primary)', quilt: 'var(--color-primary)', neoforge: 'var(--color-primary)', bedrock: 'var(--color-primary)',
  optifine: 'var(--color-primary)', labymod: 'var(--color-primary)',
};

const CORE_CATALOG = [
  { id:'vanilla', label:'Vanilla', short:'V', desc:'Чистый Minecraft', Icon:Box },
  { id:'fabric', label:'Fabric', short:'F', desc:'Лёгкий и быстрый', Icon:Layers },
  { id:'forge', label:'Forge', short:'FG', desc:'Большие модпаки', Icon:Wrench },
  { id:'neoforge', label:'NeoForge', short:'NF', desc:'Новое поколение Forge', Icon:Sparkles },
  { id:'quilt', label:'Quilt', short:'Q', desc:'Совместимый модлоадер', Icon:Layers },
  { id:'optifine', label:'OptiFine', short:'OF', desc:'Графика и шейдеры', Icon:MonitorPlay, external:true },
  { id:'labymod', label:'LabyMod', short:'LM', desc:'Отдельный игровой клиент', Icon:MonitorPlay, external:true },
  { id:'bedrock', label:'Бедрок', short:'B', desc:'Minecraft для Windows', Icon:Box },
] as const;

function LoaderGlyph({ id, Icon }: { id: string; Icon: any }) {
  return (
    <span className="loader-glyph" style={{ color: LOADER_COLOR[id] || 'var(--color-primary)' }} aria-hidden>
      <Icon className="w-4 h-4" strokeWidth={2.25} />
    </span>
  );
}

function formatPlayMinutes(minutes: number) {
  if (!minutes) return 'Не запускалась';
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return hours ? `${hours} ч ${rest ? `${rest} мин` : ''}`.trim() : `${rest} мин`;
}

type ContentTab = 'content' | 'files' | 'worlds' | 'screenshots' | 'logs';
type ContentFilter = 'all' | 'mods' | 'resourcepacks' | 'shaders' | 'updates' | 'disabled';
type LaunchStatus = 'idle' | 'launching' | 'running';
type CreateStep = 'type' | 'custom' | 'install' | 'import';
type LoaderVersionOption = { value: string; recommended: boolean; unreliable: boolean };
type DeletedInstanceRecord = { recovery_id: string; instance: any; deleted_at: string; size_bytes: number };

const LOADERS = ['vanilla', 'fabric', 'neoforge', 'forge', 'quilt', 'optifine', 'labymod', 'bedrock'] as const;

function VersionPicker({ versions, value, onChange, showSnapshots }: { versions: string[]; value: string; onChange: (value: string) => void; showSnapshots: boolean }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const visible = versions.filter(version => version.toLowerCase().includes(query.trim().toLowerCase()));

  return (
    <div className="relative">
      <button type="button" onClick={() => setOpen(current => !current)} className="flex w-full items-center justify-between gap-3 rounded-xl px-3 py-2.5 text-left text-sm font-bold" style={{ background:'var(--color-surface-2)', border:'1px solid var(--color-border)', color:'var(--color-text)' }}>
        <span className="min-w-0">
          <span className="block" style={{ color: value ? 'var(--color-text)' : 'var(--color-text-tertiary)' }}>{value || 'Выберите версию Minecraft'}</span>
          <span className="mt-0.5 block text-[10px] font-medium" style={{ color:'var(--color-text-tertiary)' }}>{showSnapshots ? 'Релизы и snapshot-версии' : 'Только релизные версии'}</span>
        </span>
        <ChevronDown className={`h-4 w-4 shrink-0 transition-transform ${open ? 'rotate-180' : ''}`} style={{ color:'var(--color-primary)' }} />
      </button>
      <AnimatePresence>
        {open && (
          <motion.div initial={{ opacity:0, y:6, scale:0.985 }} animate={{ opacity:1, y:0, scale:1 }} exit={{ opacity:0, y:6, scale:0.985 }} transition={{ duration:0.16 }} className="absolute bottom-full z-[70] mb-2 w-full overflow-hidden rounded-2xl" style={{ background:'var(--color-surface)', border:'1px solid var(--color-border)', boxShadow:'var(--shadow-lg)' }}>
            <div className="border-b p-2.5" style={{ borderColor:'var(--color-border)' }}>
              <div className="flex items-center gap-2 rounded-xl px-2.5 py-2" style={{ background:'var(--color-surface-2)', border:'1px solid var(--color-border)' }}>
                <Search className="h-3.5 w-3.5" style={{ color:'var(--color-text-tertiary)' }} />
                <input autoFocus value={query} onChange={event => setQuery(event.target.value)} placeholder="Найти версию…" className="min-w-0 flex-1 bg-transparent text-xs outline-none" style={{ color:'var(--color-text)' }} />
              </div>
            </div>
            <div className="max-h-60 overflow-y-auto p-1.5 scroll-area">
              {visible.length === 0 ? <p className="px-3 py-6 text-center text-xs" style={{ color:'var(--color-text-tertiary)' }}>Подходящих версий не найдено</p> : visible.map(version => {
                const selected = version === value;
                const snapshot = /[a-zA-Z]/.test(version.replace(/\./g, ''));
                return (
                  <button key={version} type="button" onClick={() => { onChange(version); setOpen(false); setQuery(''); }} className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left text-xs font-semibold" style={{ background:selected ? 'var(--color-primary-dim)' : 'transparent', color:selected ? 'var(--color-primary)' : 'var(--color-text-secondary)', border:`1px solid ${selected ? 'var(--color-primary)' : 'transparent'}` }}>
                    <span className="min-w-0 flex-1">{version}</span>
                    {snapshot && <span className="rounded-md px-1.5 py-0.5 text-[9px] font-black" style={{ background:'var(--color-warning)', color:'#1A1200' }}>СНИМОК</span>}
                    {selected && <Check className="h-3.5 w-3.5" />}
                  </button>
                );
              })}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function useAvailableVersions(showSnapshots: boolean) {
  const [versions, setVersions] = useState<string[]>([]);
  useEffect(() => {
    let alive = true;
    fetchMcVersionIds(showSnapshots)
      .then(ids => { if (alive && ids.length) setVersions(ids); })
      .catch(() => { if (alive) setVersions(MC_VERSIONS_FALLBACK); });
    return () => { alive = false; };
  }, [showSnapshots]);
  return versions;
}

// ── Game Logs Modal ────────────────────────────────────────────────────────────
interface LogLine { line: string; level: string; ts: number; }
const clearedLogSessionKey = (instanceId: string) => `portal-cleared-game-log-session:${instanceId}`;

const LOG_COLORS: Record<string, string> = {
  fatal: '#ff4444',
  error: '#ff6b6b',
  warn: '#ffd166',
  debug: '#74b9ff',
  stderr: '#fd79a8',
  info: 'var(--color-text-secondary)',
};

function GameLogsModal({ instanceId, onClose, inline }: { instanceId: string; onClose: () => void; inline?: boolean }) {
  const [logs, setLogs] = useState<LogLine[]>([]);
  const [filter, setFilter] = useState('');
  const [copied, setCopied] = useState(false);
  const [autoScroll, setAutoScroll] = useState(true);
  const bottomRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Load the one current session, then listen to both its reset boundary and
  // live stdout/stderr. A second game start must never append to the old view.
  useEffect(() => {
    invoke<string[] | string>('get_game_logs', { instanceId })
      .then(content => {
        if (sessionStorage.getItem(clearedLogSessionKey(instanceId))) {
          setLogs([]);
          return;
        }
        if (!content) return;
        const rawLines = Array.isArray(content) ? content : content.split('\n');
        const lines: LogLine[] = rawLines.filter(Boolean).map((line, i) => ({
          line,
          level: detectLevel(line),
          ts: i,
        }));
        setLogs(lines);
      })
      .catch(() => {});

    let counter = Date.now();
    const unsub = listen('game-log', (e: any) => {
      const p = e.payload;
      if (p.instance_id !== instanceId || p.source !== 'minecraft' || typeof p.line !== 'string') return;
      sessionStorage.removeItem(clearedLogSessionKey(instanceId));
      setLogs(prev => [...prev, { line: p.line, level: p.level ?? 'info', ts: counter++ }]);
    });
    let sessionUnsub: (() => void) | undefined;
    listen('game-log-session', (e: any) => {
      const p = e.payload;
      if (p?.instance_id !== instanceId) return;
      sessionStorage.removeItem(clearedLogSessionKey(instanceId));
      counter = Date.now();
      setLogs([]);
      setFilter('');
      setAutoScroll(true);
    }).then(fn => { sessionUnsub = fn; });

    return () => { unsub.then(fn => fn()); sessionUnsub?.(); };
  }, [instanceId]);

  useEffect(() => {
    if (!autoScroll) return;
    const frame = requestAnimationFrame(() => {
      const container = containerRef.current;
      if (!container) return;
      container.scrollTop = container.scrollHeight;
      bottomRef.current?.scrollIntoView({ block: 'end' });
    });
    return () => cancelAnimationFrame(frame);
  }, [logs.length, filter, autoScroll]);

  function detectLevel(line: string): string {
    const u = line.toUpperCase();
    if (u.includes('FATAL')) return 'fatal';
    if (u.includes('ERROR')) return 'error';
    if (u.includes('WARN')) return 'warn';
    if (u.includes('DEBUG')) return 'debug';
    if (u.includes('[STDERR]')) return 'stderr';
    return 'info';
  }

  const copyAll = () => {
    const text = logs.map(l => l.line).join('\n');
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  const clearLogs = () => {
    sessionStorage.setItem(clearedLogSessionKey(instanceId), String(Date.now()));
    setLogs([]);
    setFilter('');
    setAutoScroll(true);
  };

  const filtered = filter
    ? logs.filter(l => l.line.toLowerCase().includes(filter.toLowerCase()))
    : logs;

  return inline ? (
    <div className="flex flex-col h-full">
      <LogsToolbar logs={logs} filter={filter} setFilter={setFilter} autoScroll={autoScroll}
        setAutoScroll={setAutoScroll} copied={copied} copyAll={copyAll} clearLogs={clearLogs} />
      <LogsBody filtered={filtered} logs={logs} filter={filter} containerRef={containerRef}
        bottomRef={bottomRef} setAutoScroll={setAutoScroll} />
    </div>
  ) : (
    <motion.div className="fixed inset-0 z-50 flex flex-col"
      style={{ background: 'rgba(0,0,0,0.85)', backdropFilter: 'blur(6px)' }}
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
      <motion.div className="flex flex-col h-full max-w-5xl w-full mx-auto my-6 rounded-2xl overflow-hidden"
        style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', boxShadow: 'var(--shadow-lg)' }}
        initial={{ y: 24, opacity: 0 }} animate={{ y: 0, opacity: 1 }}
        transition={{ type: 'spring', stiffness: 400, damping: 32 }}>
        <LogsToolbar logs={logs} filter={filter} setFilter={setFilter} autoScroll={autoScroll}
          setAutoScroll={setAutoScroll} copied={copied} copyAll={copyAll} clearLogs={clearLogs} onClose={onClose} />
        <LogsBody filtered={filtered} logs={logs} filter={filter} containerRef={containerRef}
          bottomRef={bottomRef} setAutoScroll={setAutoScroll} />
      </motion.div>
    </motion.div>
  );
}

function LogsToolbar({ logs, filter, setFilter, autoScroll, setAutoScroll, copied, copyAll, clearLogs, onClose }: {
  logs: LogLine[]; filter: string; setFilter: (v: string) => void; autoScroll: boolean;
  setAutoScroll: (v: boolean) => void; copied: boolean; copyAll: () => void; clearLogs: () => void; onClose?: () => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="flex flex-wrap items-center gap-2.5 px-4 py-3.5 shrink-0" style={{ background:'linear-gradient(180deg, color-mix(in srgb, var(--color-surface-2) 55%, transparent), transparent)', borderBottom: '1px solid var(--color-border)' }}>
      <Terminal className="w-4 h-4 shrink-0" style={{ color: 'var(--color-primary)' }} />
      <h2 className="font-bold text-sm flex-1" style={{ color: 'var(--color-text)' }}>
        {t('libraryRuntime.logs')}
        <span className="ml-2 text-xs font-normal" style={{ color: 'var(--color-text-tertiary)' }}>
          {logs.length} {t('libraryRuntime.lines')}
        </span>
      </h2>

      <div className="flex items-center gap-2 px-3 py-1.5 rounded-xl"
        style={{ background: 'var(--color-surface-2)', border: '1px solid var(--color-border)' }}>
        <Search className="w-3 h-3 shrink-0" style={{ color: 'var(--color-text-tertiary)' }} />
        <input
          placeholder={t('libraryRuntime.filterLogs')}
          value={filter}
          onChange={e => setFilter(e.target.value)}
          className="bg-transparent text-xs w-36 outline-none"
          style={{ color: 'var(--color-text)' }} />
        {filter && (
          <button onClick={() => setFilter('')} className="hover:opacity-70">
            <X className="w-3 h-3" style={{ color: 'var(--color-text-tertiary)' }} />
          </button>
        )}
      </div>

      <button
        onClick={() => setAutoScroll(!autoScroll)}
        className="px-2.5 py-1.5 rounded-xl text-xs font-semibold transition-all"
        style={autoScroll
          ? { background: 'rgba(108,92,231,0.15)', color: 'var(--color-primary)', border: '1px solid rgba(108,92,231,0.3)' }
          : { background: 'var(--color-surface-2)', color: 'var(--color-text-secondary)', border: '1px solid var(--color-border)' }}>
        {t('libraryRuntime.autoScroll')}
      </button>

      <button
        onClick={copyAll}
        className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl text-xs font-semibold transition-all"
        style={{ background: 'var(--color-surface-2)', color: copied ? '#2ECC71' : 'var(--color-text-secondary)', border: '1px solid var(--color-border)' }}>
        {copied ? <Check className="w-3.5 h-3.5" /> : <ClipboardCopy className="w-3.5 h-3.5" />}
        {copied ? t('libraryRuntime.copied') : t('libraryRuntime.copyAll')}
      </button>

      <button
        onClick={clearLogs}
        className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl text-xs font-semibold transition-all"
        style={{ background: 'rgba(231,76,60,0.08)', color: 'var(--color-error)', border: '1px solid rgba(231,76,60,0.2)' }}>
        <Trash className="w-3.5 h-3.5" />{t('libraryRuntime.clear')}
      </button>

      {onClose && (
        <button onClick={onClose} className="w-7 h-7 flex items-center justify-center rounded-lg hover:bg-white/5 ml-1">
          <X className="w-4 h-4" style={{ color: 'var(--color-text-secondary)' }} />
        </button>
      )}
    </div>
  );
}

function InlineLogsPanel({ instanceId }: { instanceId: string }) {
  return <GameLogsModal instanceId={instanceId} onClose={() => {}} inline />;
}

function LogsBody({ filtered, logs, filter, containerRef, bottomRef, setAutoScroll }: {
  filtered: LogLine[]; logs: LogLine[]; filter: string;
  containerRef: React.RefObject<HTMLDivElement>; bottomRef: React.RefObject<HTMLDivElement>;
  setAutoScroll: (v: boolean) => void;
}) {
  return (
    <>
      <div
        ref={containerRef}
        onScroll={() => {
          const el = containerRef.current;
          if (!el) return;
          const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
          setAutoScroll(atBottom);
        }}
        className="flex-1 overflow-y-auto font-mono text-xs p-4 space-y-0.5 scroll-area"
        style={{ background: 'var(--color-bg, #0f0f0f)' }}>
        {filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full gap-3 py-16">
            <FileText className="w-8 h-8" style={{ color: 'var(--color-text-tertiary)' }} />
            <p style={{ color: 'var(--color-text-secondary)' }}>
              {logs.length === 0 ? 'No logs yet. Launch the game to see output.' : 'No matching log lines.'}
            </p>
          </div>
        ) : filtered.map((l, i) => (
          <div key={`${l.ts}-${i}`}
            className="leading-5 whitespace-pre-wrap break-all hover:bg-white/[0.03] px-1 rounded"
            style={{ color: LOG_COLORS[l.level] ?? 'var(--color-text-secondary)' }}>
            {l.line}
          </div>
        ))}
        <div ref={bottomRef} />
      </div>

      <div className="flex items-center gap-4 px-5 py-2 shrink-0"
        style={{ borderTop: '1px solid var(--color-border)', background: 'var(--color-surface)' }}>
        <div className="flex items-center gap-4 text-xs" style={{ color: 'var(--color-text-tertiary)' }}>
          {(['error', 'warn', 'info'] as const).map(level => {
            const count = logs.filter(l => l.level === level || (level === 'error' && l.level === 'fatal')).length;
            return count > 0 ? (
              <span key={level} style={{ color: LOG_COLORS[level] }}>
                {level === 'error' ? '✕' : level === 'warn' ? '▲' : '●'} {count} {level}
              </span>
            ) : null;
          })}
        </div>
        <div className="flex-1" />
        <p className="text-xs" style={{ color: 'var(--color-text-tertiary)' }}>
          {filter ? `${filtered.length} / ${logs.length} lines` : `${logs.length} lines total`}
        </p>
      </div>
    </>
  );
}

// ── Create Instance Modal ─────────────────────────────────────────────────────
function CreateModal({ onClose, onCreated, initialStep = 'type' }: { onClose: () => void; onCreated: (i: any) => void; initialStep?: CreateStep }) {
  const { t } = useTranslation();
  const [step, setStep] = useState<CreateStep>(initialStep);
  const [creating, setCreating] = useState(false);
  const [iconPreview, setIconPreview] = useState<string | null>(null);
  const [externalInstances, setExternalInstances] = useState<any[]>([]);
  const [externalLoading, setExternalLoading] = useState(false);
  const [showSnapshots, setShowSnapshots] = useState(false);
  const [localPreview, setLocalPreview] = useState<{ preview: ModpackPreview; dataUrl: string; fileName: string } | null>(null);
  const [loaderVersions, setLoaderVersions] = useState<LoaderVersionOption[]>([]);
  const [loaderVersionsLoading, setLoaderVersionsLoading] = useState(false);
  const mcVersions = useAvailableVersions(showSnapshots);
  const [form, setForm] = useState({
    name: '', loader: 'fabric' as typeof LOADERS[number], mcVersion: '',
    loaderVersionType: 'stable' as 'stable'|'latest'|'custom', customLoaderVersion: '',
  });
  const [bedrockPkgs, setBedrockPkgs] = useState<{ name:string; display_name:string; version:string; family:string; preview:boolean }[]>([]);
  const [bedrockFamily, setBedrockFamily] = useState('');
  const [devMode, setDevMode] = useState<{ enabled:boolean; windows:boolean } | null>(null);
  const [devModeBusy, setDevModeBusy] = useState(false);
  const currentUser = useCurrentUser();
  const accountProvider = String(currentUser?.provider ?? '').toLowerCase();
  // Microsoft/Mojang/MSA are licensed Java account variants. Ely.by,
  // offline, demo and unknown providers must never unlock LabyMod.
  const isLicensedMicrosoft = Boolean(currentUser && !currentUser.isDemo && (
    accountProvider === '' || ['microsoft', 'msa', 'mojang', 'minecraft'].includes(accountProvider)
  ));
  const canUseLabyMod = isLicensedMicrosoft;
  // Аккаунты, вошедшие ДО того как появилось поле provider, имеют
  // provider===undefined — раньше это ошибочно блокировало Bedrock даже для
  // настоящего Microsoft-входа. До Ely.by/оффлайн-входа единственным
  // способом залогиниться был Microsoft, так что "provider не указан и это
  // не демо-аккаунт" тоже считаем настоящим Microsoft-аккаунтом.
  const canUseBedrock = currentUser
    ? currentUser.provider === 'microsoft' || (!currentUser.provider && !currentUser.isDemo)
    : false;

  const loadBedrockState = useCallback(() => {
    invoke<any>('get_developer_mode').then(setDevMode).catch(() => setDevMode(null));
    invoke<any[]>('list_bedrock_versions').then(list => {
      setBedrockPkgs(list || []);
      if (list?.length && !bedrockFamily) setBedrockFamily(list[0].family);
    }).catch(() => setBedrockPkgs([]));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (form.loader !== 'bedrock') return;
    loadBedrockState();
  }, [form.loader, loadBedrockState]);

  const loadExternalInstances = useCallback(async () => {
    setExternalLoading(true);
    try {
      const [legacy, supported] = await Promise.all([
        Promise.all([
          invoke<any[]>('detect_prismlauncher_instances').catch(() => []),
          invoke<any[]>('detect_modrinth_instances').catch(() => []),
        ]),
        invoke<any[]>('detect_supported_launcher_instances').catch(() => []),
      ]);
      const all = [...(legacy[0] || []), ...(legacy[1] || []), ...(supported || [])];
      setExternalInstances(all.filter((item, index, list) => list.findIndex(other => other.path === item.path) === index));
    } finally { setExternalLoading(false); }
  }, []);

  useEffect(() => { if (step === 'install' || step === 'import') void loadExternalInstances(); }, [step, loadExternalInstances]);

  useEffect(() => {
    let alive = true;
    const loadVersions = async () => {
      const loader = form.loader;
      if (!form.mcVersion || !['fabric', 'forge', 'neoforge', 'optifine'].includes(loader)) {
        setLoaderVersions([]);
        return;
      }
      setLoaderVersionsLoading(true);
      try {
        const raw = await invoke<any>(
          loader === 'fabric' ? 'get_fabric_versions' : loader === 'neoforge' ? 'get_neoforge_versions' : 'get_forge_versions',
          { mcVersion: form.mcVersion },
        );
        const values: LoaderVersionOption[] = loader === 'fabric'
          ? (Array.isArray(raw) ? raw.map((v: any) => {
              const value = v?.loader?.version ?? v?.version;
              const stable = !!v?.loader?.stable;
              return value ? { value, recommended: stable, unreliable: !stable || /(?:alpha|beta|rc|pre|snapshot)/i.test(value) } : null;
            }).filter(Boolean) as LoaderVersionOption[] : [])
          : (Array.isArray(raw) ? raw.filter(Boolean).map((value: string, index: number) => ({
              value,
              recommended: index === 0 && !/(?:alpha|beta|rc|pre|snapshot)/i.test(value),
              unreliable: /(?:alpha|beta|rc|pre|snapshot)/i.test(value),
            })) : []);
        if (alive) setLoaderVersions(values.slice(0, 80));
      } catch {
        if (alive) setLoaderVersions([]);
      } finally {
        if (alive) setLoaderVersionsLoading(false);
      }
    };
    loadVersions();
    return () => { alive = false; };
  }, [form.loader, form.mcVersion]);

  const recommendedLoaderVersion = loaderVersions.find(version => version.recommended && !version.unreliable) ?? loaderVersions.find(version => !version.unreliable) ?? loaderVersions[0];
  const generatedInstanceName = `${CORE_CATALOG.find(core => core.id === form.loader)?.label ?? form.loader} ${form.mcVersion}`;

  const toggleDevMode = async () => {
    if (devMode?.enabled) return;
    setDevModeBusy(true);
    try {
      const next = await invoke<any>('enable_developer_mode');
      setDevMode(next);
      loadBedrockState();
    } catch (e: any) {
      dialog.alert(e?.message || String(e), { title: 'Error', danger: true });
    } finally { setDevModeBusy(false); }
  };
  const pickIcon = () => {
    const inp = document.createElement('input');
    inp.type = 'file'; inp.accept = 'image/*';
    inp.onchange = (e: any) => {
      const f = e.target.files?.[0]; if (!f) return;
      const r = new FileReader(); r.onload = ev => setIconPreview(ev.target?.result as string); r.readAsDataURL(f);
    };
    inp.click();
  };

  const doCreate = async () => {
    if (form.loader !== 'bedrock' && !form.mcVersion) {
      dialog.alert('Сначала выберите версию Minecraft. Версия не выбирается автоматически.', { title: 'Выберите версию', danger: false });
      return;
    }
    const instanceName = form.name.trim() || generatedInstanceName;
    // LabyMod 4 is an external licensed client. It has no documented API/CLI for
    // third-party launch and does not accept Ely.by, so do not create a broken profile.
    if (form.loader === 'labymod') {
      if (!canUseLabyMod) {
        dialog.alert(
          'Скачивание LabyMod доступно только после входа в лицензированный Microsoft-аккаунт Minecraft: Java Edition. Ely.by, offline и demo-аккаунты не поддерживаются.',
          { title: 'Требуется Microsoft Java-аккаунт', danger: false },
        );
        return;
      }
      dialog.alert(
        'LabyMod будет скачан через официальный Laby Launcher. Для запуска используйте лицензированный Microsoft-аккаунт; Ely.by и offline-аккаунты LabyMod не поддерживает.',
        { title: 'LabyMod — официальный клиент', danger: false },
      );
      return;
    }
    if (form.loader === 'optifine') {
      const input = document.createElement('input');
      input.type = 'file'; input.accept = '.jar,application/java-archive';
      input.onchange = async (event: any) => {
        const file = event.target.files?.[0] as File | undefined;
        if (!file) return;
        setCreating(true);
        try {
          const dataUrl = await new Promise<string>((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(String(reader.result ?? ''));
            reader.onerror = () => reject(new Error('Unable to read OptiFine JAR'));
            reader.readAsDataURL(file);
          });
          const selectedForge = form.loaderVersionType === 'custom'
            ? form.customLoaderVersion
            : form.loaderVersionType === 'latest'
              ? loaderVersions[0]?.value
              : recommendedLoaderVersion?.value;
          if (!selectedForge) throw new Error('Select a compatible Forge version first.');
          const raw = await invoke<any>('create_optifine_instance', {
            name: instanceName, description: '', mcVersion: form.mcVersion,
            forgeVersion: selectedForge, minRam: 1024, maxRam: 4096,
            color: null, icon: iconPreview || null,
            optifineFileName: file.name, optifineDataUrl: dataUrl,
          });
          onCreated(raw);
        } catch (error) {
          console.error('create_optifine_instance failed:', error);
          dialog.alert('Failed to create OptiFine setup: ' + String(error), { title: 'OptiFine', danger: true });
        } finally { setCreating(false); onClose(); }
      };
      input.click();
      return;
    }
    setCreating(true);
    try {
      if (form.loader === 'bedrock') {
        if (!bedrockFamily) { dialog.alert('No installed Bedrock edition selected.', { title: 'Error', danger: true }); setCreating(false); return; }
        const pkg = bedrockPkgs.find(p => p.family === bedrockFamily);
        const raw = {
          id: crypto.randomUUID(),
          name: instanceName,
          description: '',
          mc_version: pkg?.version || 'Bedrock',
          loader: 'bedrock',
          loader_version: bedrockFamily, // хранит AUMID для запуска
          min_ram: 1024, max_ram: 4096,
          created_at: new Date().toISOString(),
          icon: iconPreview || null,
        };
        onCreated(raw);
        setCreating(false); onClose();
        return;
      }
      const raw = await invoke<any>('create_instance', {
        name: instanceName,
        description: '',
        mcVersion: form.mcVersion,
        loader: form.loader,
        loaderVersion: form.loaderVersionType === 'custom' ? form.customLoaderVersion : '',
        minRam: 1024,
        maxRam: 4096,
        javaPath: '',
        customJvmArgs: '',
        icon: iconPreview || null,
      });
      onCreated(raw);
    } catch (e) {
      console.error('create_instance failed:', e);
      dialog.alert('Failed to create instance: ' + String(e), { title: 'Error', danger: true });
    } finally { setCreating(false); onClose(); }
  };

  const importPreparedArchive = async (dataUrl: string, fileName: string, excludedPaths: string[] = []) => {
    setCreating(true);
    try {
      const raw = await invoke<any>('import_archive_data', { fileName, dataUrl, excludedPaths });
      onCreated(raw);
      setLocalPreview(null);
      onClose();
    } catch (e) {
      console.error('import failed:', e);
      dialog.alert('Не удалось импортировать сборку: ' + String(e), { title: 'Импорт', danger: true });
    } finally { setCreating(false); }
  };

  const pickFile = () => {
    void (async () => {
      try {
        const nativePath = await invoke<string | null>('pick_local_modpack');
        if (!nativePath) return;
        const fileName = nativePath.split(/[\\/]/).pop() || 'сборка.mrpack';
        const source = fileName.toLowerCase().endsWith('.mrpack') ? 'modrinth' : 'curseforge';
        const preview = await invoke<ModpackPreview>('preview_remote_modpack', { downloadUrl: nativePath, fileName, source, apiKey: null, projectName: null, projectAuthor: null, projectAuthorUrl: null, projectAuthorAvatarUrl: null, projectIconUrl: null });
        setLocalPreview({ preview, dataUrl: nativePath, fileName });
      } catch (e) {
        dialog.alert(`Не удалось прочитать выбранный .mrpack: ${String(e)}. Файл не был изменён.`, { title: 'Импорт .mrpack', danger: true });
      }
    })();
  };

  return (
    <motion.div className="fixed inset-0 z-50 flex items-center justify-center"
      style={{ background:'rgba(0,0,0,0.72)', backdropFilter:'blur(4px)' }}
      initial={{ opacity:0 }} animate={{ opacity:1 }} exit={{ opacity:0 }}
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <motion.div className="flex max-h-[calc(100vh-2rem)] w-full max-w-md flex-col overflow-hidden rounded-[30px]"
        style={{ background:'color-mix(in srgb, var(--color-surface) 96%, transparent)', border:'1px solid color-mix(in srgb, var(--color-border) 76%, var(--color-primary))', boxShadow:'var(--shadow-lg)' }}
        initial={{ scale:0.93,opacity:0,y:14 }} animate={{ scale:1,opacity:1,y:0 }} exit={{ scale:0.93,opacity:0,y:14 }}
        transition={{ type:'spring', stiffness:480, damping:34 }}>

        <div className="relative shrink-0 overflow-hidden px-6 pt-5 pb-4" style={{ borderBottom:'1px solid var(--color-border)', background:'linear-gradient(125deg, color-mix(in srgb, var(--color-surface-2) 88%, var(--color-primary) 12%), var(--color-surface))' }}>
          <span aria-hidden className="pointer-events-none absolute -right-8 -top-10 h-32 w-32 rounded-full" style={{ background:'radial-gradient(circle, color-mix(in srgb, var(--color-primary) 22%, transparent), transparent 70%)' }} />
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-[10px] font-black uppercase tracking-[0.16em]" style={{ color:'var(--color-primary)' }}>{t('libraryRuntime.instanceStudio')}</p>
              <h2 className="font-black text-lg mt-0.5" style={{ color:'var(--color-text)' }}>{step==='type'?t('libraryRuntime.create'):step==='custom'?t('libraryRuntime.customSetup'):step==='install'?'Установить или импортировать сборку':t('libraryRuntime.importInstance')}</h2>
            </div>
            <button type="button" onClick={onClose} aria-label="Закрыть студию сборок" className="relative w-9 h-9 flex items-center justify-center rounded-full outline-none transition-colors hover:bg-white/10 focus-visible:ring-2 focus-visible:ring-[var(--color-primary)]" style={{ border:'1px solid var(--color-border)' }}><X className="w-4 h-4" style={{ color:'var(--color-text-secondary)' }} /></button>
          </div>
          <div className="grid grid-cols-2 gap-1.5 mt-4">
            {[
              { id:'custom', label:t('libraryRuntime.createStep'), Icon:Wrench },
              { id:'install', label:'Установить / импортировать', Icon:Download },
            ].map(item => {
              const active = step === item.id || (step === 'type' && item.id === 'custom');
              return <button type="button" key={item.id} onClick={() => setStep(item.id as CreateStep)} className="flex items-center justify-center gap-1.5 py-2 rounded-full text-[10px] font-bold outline-none transition-transform duration-150 hover:-translate-y-0.5 active:scale-[0.98] focus-visible:ring-2 focus-visible:ring-[var(--color-primary)]" style={{ background:active?'var(--color-primary-dim)':'var(--color-surface)', color:active?'var(--color-primary)':'var(--color-text-tertiary)', border:`1px solid ${active?'var(--color-primary)':'var(--color-border)'}` }}><item.Icon className="w-3 h-3" />{item.label}</button>;
            })}
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-5 sm:p-6">
          <AnimatePresence mode="wait">
            {step==='type' && (
              <motion.div key="type" initial={{ opacity:0,x:12 }} animate={{ opacity:1,x:0 }} exit={{ opacity:0,x:-12 }} className="space-y-3">
                <p className="text-sm font-medium mb-4" style={{ color:'var(--color-text)' }}>{t('libraryRuntime.chooseCreation')}</p>
                {[
                  { id:'custom', Icon:Wrench, title:t('libraryRuntime.customSetup'), desc:'Выберите Minecraft, ядро, версию ядра и свою иконку.' },
                  { id:'install', Icon:Download, title:'Установить или импортировать сборку', desc:'Найдите модпак в Discover, откройте .mrpack / .zip или перенесите сборку из другого лаунчера.' },
                ].map(opt => (
                  <button type="button" key={opt.id} onClick={() => setStep(opt.id as CreateStep)}
                    className="w-full flex items-center gap-4 p-4 rounded-[22px] text-left outline-none transition-transform duration-150 group hover:-translate-y-0.5 active:scale-[0.99] focus-visible:ring-2 focus-visible:ring-[var(--color-primary)]"
                    style={{ background:'linear-gradient(135deg, color-mix(in srgb, var(--color-surface-2) 92%, var(--color-primary) 5%), var(--color-surface-2))', border:'1px solid var(--color-border)' }}>
                    <span className="w-11 h-11 rounded-full flex items-center justify-center shrink-0" style={{ background:'var(--color-primary-dim)', color:'var(--color-primary)', border:'1px solid color-mix(in srgb, var(--color-primary) 36%, transparent)' }}><opt.Icon className="w-5 h-5" /></span>
                    <div className="flex-1 min-w-0"><p className="font-black text-sm" style={{ color:'var(--color-text)' }}>{opt.title}</p><p className="text-xs mt-0.5 leading-relaxed" style={{ color:'var(--color-text-secondary)' }}>{opt.desc}</p></div>
                    <ArrowRight className="w-4 h-4 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity" style={{ color:'var(--color-primary)' }} />
                  </button>
                ))}
              </motion.div>
            )}

            {step==='custom' && (
              <motion.div key="custom" initial={{ opacity:0,x:12 }} animate={{ opacity:1,x:0 }} exit={{ opacity:0,x:-12 }} className="space-y-5">
                <div className="flex items-start gap-4">
                  <button onClick={pickIcon}
                    className="w-16 h-16 rounded-[22px] overflow-hidden flex flex-col items-center justify-center gap-1 shrink-0 outline-none transition-colors hover:bg-white/[0.04] focus-visible:ring-2 focus-visible:ring-[var(--color-primary)]"
                    style={{ background:'var(--color-surface-2)', border:'2px dashed var(--color-border)' }}>
                    {iconPreview
                      ? <img src={iconPreview} className="w-full h-full object-cover" alt="" />
                      : <><Package className="w-6 h-6" style={{ color:'var(--color-text-tertiary)' }} /><span className="text-[9px] font-bold" style={{ color:'var(--color-text-tertiary)' }}>ICON</span></>}
                  </button>
                  <div className="flex-1 min-w-0">
                    <label className="block text-xs font-bold mb-1.5" style={{ color:'var(--color-text)' }}>Название сборки *</label>
                    <input autoFocus value={form.name} onChange={e => setForm(f => ({...f,name:e.target.value}))}
                      placeholder={`${form.loader==='neoforge'?'NeoForge':form.loader.charAt(0).toUpperCase()+form.loader.slice(1)} ${form.mcVersion}`}
                      className="w-full px-3 py-2.5 rounded-2xl text-sm font-medium outline-none focus:ring-2 focus:ring-[var(--color-primary)]"
                      style={{ background:'var(--color-surface-2)', border:'1px solid var(--color-border)', color:'var(--color-text)' }} />
                  </div>
                </div>
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <label className="text-xs font-black uppercase tracking-wider" style={{ color:'var(--color-text)' }}>Игровое ядро</label>
                    <span className="text-[10px]" style={{ color:'var(--color-text-tertiary)' }}>Выберите ядро и его версию</span>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    {CORE_CATALOG.map(core => {
                      const selected = form.loader === core.id;
                      const disabled = core.id === 'bedrock' && !canUseBedrock;
                      const external = 'external' in core && core.external;
                      return (
                        <button key={core.id} onClick={() => setForm(f => ({ ...f, loader: core.id }))}
                          disabled={disabled}
                          title={disabled ? 'Требуется настоящий Microsoft-аккаунт' : external ? 'Внешний официальный клиент' : undefined}
                          className="relative flex items-center gap-2.5 p-2.5 rounded-2xl text-left outline-none transition-transform duration-150 hover:-translate-y-0.5 active:scale-[0.99] disabled:opacity-40 disabled:cursor-not-allowed focus-visible:ring-2 focus-visible:ring-[var(--color-primary)]"
                          style={{ background:selected ? `${LOADER_COLOR[core.id]}18` : 'var(--color-surface-2)', border:`1px solid ${selected ? LOADER_COLOR[core.id] : 'var(--color-border)'}`, boxShadow:selected ? `0 8px 18px ${LOADER_COLOR[core.id]}18` : 'none' }}>
                          <span className="w-8 h-8 rounded-full flex items-center justify-center shrink-0" style={{ background:`${LOADER_COLOR[core.id]}22`, color:LOADER_COLOR[core.id] }}><LoaderGlyph id={core.id} Icon={core.Icon} /></span>
                          <span className="min-w-0"><span className="block text-xs font-bold truncate" style={{ color:'var(--color-text)' }}>{core.label}</span><span className="block text-[9px] truncate" style={{ color:'var(--color-text-tertiary)' }}>{core.desc}</span></span>
                          {external && <span className="absolute right-1.5 top-1.5 text-[8px] font-bold px-1 py-0.5 rounded" style={{ background:'var(--color-surface)', color:'var(--color-text-tertiary)' }}>EXT</span>}
                        </button>
                      );
                    })}
                  </div>
                  {(form.loader === 'optifine' || form.loader === 'labymod') && (
                    <div className="mt-2 p-2.5 rounded-xl" style={{ background:'var(--color-surface)', border:'1px solid var(--color-border)' }}>
                      <p className="text-[10px] leading-relaxed" style={{ color:'var(--color-text-tertiary)' }}>
                        {form.loader === 'optifine'
                          ? 'OptiFine создаёт Forge-сборку и попросит выбрать официальный OptiFine JAR. Minecraft-библиотеки не изменяются.'
                          : canUseLabyMod
                            ? 'LabyMod доступен для вашего лицензированного Microsoft Java-аккаунта и скачивается через официальный клиент.'
                            : 'Войдите в лицензированный Microsoft Java-аккаунт, чтобы скачать LabyMod. Ely.by и offline-аккаунты не поддерживаются.'}
                      </p>
                      <button disabled={form.loader === 'labymod' && !canUseLabyMod}
                        onClick={() => {
                          if (form.loader === 'labymod' && !canUseLabyMod) {
                            dialog.alert('Сначала войдите в лицензированный Microsoft Java-аккаунт.', { title: 'LabyMod заблокирован', danger: false });
                            return;
                          }
                          invoke('open_url', { url: form.loader === 'optifine' ? 'https://optifine.net/downloads' : 'https://laby.net/client' }).catch(() => {});
                        }}
                        className="mt-2 inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[10px] font-bold disabled:opacity-40 disabled:cursor-not-allowed" style={{ background:'var(--color-primary-dim)', color:'var(--color-primary)', border:'1px solid var(--color-primary)' }}>
                        <Download className="w-3 h-3" />Открыть официальный установщик
                      </button>
                    </div>
                  )}
                </div>
                {form.loader==='bedrock' ? (
                  !canUseBedrock ? (
                    <div className="px-3 py-3 rounded-xl text-xs" style={{ background:'rgba(231,76,60,0.08)', border:'1px solid rgba(231,76,60,0.3)', color:'var(--color-error)' }}>
                      Bedrock Edition доступен только с настоящим Microsoft-аккаунтом — оффлайн-вход и Ely.by сюда не подходят,
                      т.к. Bedrock привязывается к покупке в Microsoft Store, а не к Java-аккаунту.
                      Войдите через Microsoft в Settings → Account.
                    </div>
                  ) : (
                  <div className="space-y-3">
                    <div className="flex items-center justify-between p-3 rounded-xl"
                      style={{ background:'var(--color-surface-2)', border:'1px solid var(--color-border)' }}>
                      <div>
                        <p className="text-xs font-bold" style={{ color:'var(--color-text)' }}>Windows Developer Mode</p>
                        <p className="text-[10px]" style={{ color:'var(--color-text-tertiary)' }}>
                          {devMode?.enabled ? 'Включён' : 'Нужен, чтобы видеть список установленных изданий Bedrock'}
                        </p>
                      </div>
                      <button onClick={toggleDevMode} disabled={devModeBusy || !!devMode?.enabled}
                        className="relative w-11 h-6 rounded-full shrink-0 transition-colors disabled:opacity-70"
                        style={{ background: devMode?.enabled ? 'var(--color-primary)' : 'var(--color-border)' }}>
                        <span className="absolute top-0.5 w-5 h-5 rounded-full bg-white transition-all"
                          style={{ left: devMode?.enabled ? 22 : 2 }} />
                      </button>
                    </div>
                    <div>
                      <label className="block text-xs font-bold mb-2" style={{ color:'var(--color-text)' }}>Installed Edition</label>
                      {bedrockPkgs.length===0 ? (
                        <p className="text-xs px-3 py-2.5 rounded-xl" style={{ background:'var(--color-surface-2)', border:'1px solid var(--color-border)', color:'var(--color-text-tertiary)' }}>
                          {devMode?.enabled
                            ? 'Bedrock Edition не найден на этом ПК. Установите его из Microsoft Store, затем откройте это окно снова.'
                            : 'Сначала включите Developer Mode переключателем выше — без него список изданий недоступен.'}
                        </p>
                      ) : (
                        <select value={bedrockFamily} onChange={e => setBedrockFamily(e.target.value)}
                          className="w-full px-3 py-2.5 rounded-xl text-sm"
                          style={{ background:'var(--color-surface-2)', border:'1px solid var(--color-border)', color:'var(--color-text)' }}>
                          {bedrockPkgs.map(p => <option key={p.family} value={p.family}>{p.display_name} {p.version}</option>)}
                        </select>
                      )}
                    </div>
                    <p className="text-[10px]" style={{ color:'var(--color-text-tertiary)' }}>
                      Bedrock Edition ставится и обновляется через Microsoft Store — лаунчер запускает уже установленную копию.
                      Аддоны, текстур-паки и карты для неё можно будет ставить через вкладку Content после создания сборки.
                    </p>
                  </div>
                  )
                ) : (
                  <>
                    <div>
                      <div className="flex items-center justify-between mb-2">
                        <label className="text-xs font-bold" style={{ color:'var(--color-text)' }}>Версия игры</label>
                        <button type="button" role="switch" aria-checked={showSnapshots}
                          onClick={() => setShowSnapshots(v => !v)}
                          className="flex items-center gap-2 rounded-full px-2.5 py-1.5 text-[10px] font-bold transition-all"
                          style={{ background: showSnapshots ? 'var(--color-primary-dim)' : 'var(--color-surface-2)', border:`1px solid ${showSnapshots ? 'var(--color-primary)' : 'var(--color-border)'}`, color: showSnapshots ? 'var(--color-primary)' : 'var(--color-text-tertiary)' }}>
                          <span className="relative h-3.5 w-6 rounded-full" style={{ background: showSnapshots ? 'var(--color-primary)' : 'var(--color-border)' }}><span className="absolute top-0.5 h-2.5 w-2.5 rounded-full bg-white transition-all" style={{ left: showSnapshots ? 11 : 2 }} /></span>
                          Snapshot-версии
                        </button>
                      </div>
                      <VersionPicker versions={mcVersions} value={form.mcVersion} onChange={mcVersion => setForm(current => ({ ...current, mcVersion }))} showSnapshots={showSnapshots} />
                      {!form.mcVersion && <p className="mt-2 rounded-xl px-3 py-2 text-xs font-semibold" style={{ background:'color-mix(in srgb, var(--color-primary) 18%, transparent)', border:'1px solid color-mix(in srgb, var(--color-primary) 45%, transparent)', color:'#fff' }}>Выберете версию Minecraft</p>}
                      <p className="text-[10px] mt-1" style={{ color:'var(--color-text-tertiary)' }}>{mcVersions.length} версий из официального манифеста Mojang</p>
                    </div>
                    {form.loader!=='vanilla' && (
                      <div>
                        <label className="block text-xs font-bold mb-2" style={{ color:'var(--color-text)' }}>{form.loader==='optifine' || form.loader==='labymod' ? 'Версия ядра' : 'Версия загрузчика'}</label>
                        <div className="flex gap-2">
                          {(['stable','latest','custom'] as const).map(t => (
                            <button key={t} onClick={() => setForm(f => ({...f,loaderVersionType:t, customLoaderVersion:t==='custom'?f.customLoaderVersion:''}))}
                              className="px-3 py-1.5 rounded-xl text-xs font-bold capitalize transition-all"
                              style={form.loaderVersionType===t ? { background:'var(--color-primary)', color:'#fff' } : { background:'var(--color-surface-2)', color:'var(--color-text-secondary)', border:'1px solid var(--color-border)' }}>
                              {t==='stable'?'Рекомендуемая':t==='latest'?'Последняя':'Своя'}
                            </button>
                          ))}
                        </div>
                        {form.loaderVersionType==='stable' && loaderVersions.length > 0 && (
                          <select value={form.customLoaderVersion} onChange={e => setForm(f => ({...f, customLoaderVersion:e.target.value}))}
                            className="w-full mt-2 px-3 py-2.5 rounded-xl text-sm" style={{ background:'var(--color-surface-2)', border:'1px solid var(--color-border)', color:'var(--color-text)' }}>
                            <option value="">{loaderVersionsLoading ? 'Загрузка версий…' : `Рекомендуемая · ${recommendedLoaderVersion?.value ?? 'автоматически'}`}</option>
                            {loaderVersions.map(version => <option key={version.value} value={version.value}>{version.value}{version.recommended ? ' · рекомендуемая' : version.unreliable ? ' · возможна нестабильность' : ''}</option>)}
                          </select>
                        )}
                        {loaderVersions.length > 0 && (
                          <div className="flex flex-wrap gap-1.5 mt-2">
                            {recommendedLoaderVersion && <span className="inline-flex items-center gap-1 px-1.5 py-1 rounded-md text-[9px] font-bold" style={{ background:'rgba(46,204,113,0.12)', color:'#2ECC71', border:'1px solid rgba(46,204,113,0.28)' }}><Check className="w-3 h-3" />Рекомендуемая: {recommendedLoaderVersion.value}</span>}
                            {loaderVersions.some(version => version.unreliable) && <span className="inline-flex items-center gap-1 px-1.5 py-1 rounded-md text-[9px] font-bold" style={{ background:'rgba(243,156,18,0.12)', color:'var(--color-warning)', border:'1px solid rgba(243,156,18,0.28)' }}>Возможны нестабильные / preview-версии</span>}
                          </div>
                        )}
                        {form.loaderVersionType==='custom' && (
                          <input value={form.customLoaderVersion} onChange={e => setForm(f => ({...f,customLoaderVersion:e.target.value}))}
                            placeholder="e.g. 0.15.11" className="w-full mt-2 px-3 py-2.5 rounded-xl text-sm"
                            style={{ background:'var(--color-surface-2)', border:'1px solid var(--color-border)', color:'var(--color-text)' }} />
                        )}
                        {form.loaderVersionType!=='custom' && loaderVersions.length===0 && !loaderVersionsLoading && ['quilt','optifine','labymod'].includes(form.loader) && (
                          <p className="text-[10px] mt-2" style={{ color:'var(--color-text-tertiary)' }}>Используется рекомендуемая версия из официального установщика или внешнего клиента.</p>
                        )}
                      </div>
                    )}
                  </>
                )}
              </motion.div>
            )}

            {step==='install' && (
              <motion.div key="install" initial={{ opacity:0,x:12 }} animate={{ opacity:1,x:0 }} exit={{ opacity:0,x:-12 }} className="space-y-4">
                <div className="rounded-2xl p-4" style={{ background:'linear-gradient(135deg, color-mix(in srgb, var(--color-surface-2) 88%, var(--color-primary) 8%), var(--color-surface-2))', border:'1px solid var(--color-border)' }}>
                  <p className="text-sm font-black" style={{ color:'var(--color-text)' }}>Импорт из файла</p>
                  <p className="mt-1 text-[11px] leading-relaxed" style={{ color:'var(--color-text-secondary)' }}>Откройте сохранённый .mrpack или .zip. Перед установкой можно посмотреть содержимое и отключить ненужные файлы.</p>
                  <button type="button" onClick={pickFile} className="mt-3 w-full flex items-center justify-center gap-2 rounded-xl px-4 py-3 text-sm font-bold transition-transform duration-150 hover:-translate-y-0.5 active:scale-[0.98]" style={{ background:'var(--color-primary)', color:'var(--color-primary-text)', boxShadow:'var(--shadow-glow)' }}><Upload className="w-4 h-4" />Открыть .mrpack / .zip</button>
                </div>
                <div className="rounded-2xl p-3" style={{ background:'var(--color-surface-2)', border:'1px solid var(--color-border)' }}>
                  <div className="flex items-center justify-between gap-3"><div><p className="text-xs font-black" style={{ color:'var(--color-text)' }}>Сборки из других лаунчеров</p><p className="mt-0.5 text-[10px]" style={{ color:'var(--color-text-secondary)' }}>Prism Launcher, Modrinth App, XMCL и CurseForge App.</p></div><button type="button" onClick={() => void loadExternalInstances()} aria-label="Обновить список внешних сборок" className="shrink-0 rounded-full p-2 outline-none hover:bg-white/5 focus-visible:ring-2 focus-visible:ring-[var(--color-primary)]" style={{ color:'var(--color-text-secondary)' }}><RefreshCw className={externalLoading ? 'h-3.5 w-3.5 animate-spin' : 'h-3.5 w-3.5'} /></button></div>
                  <div className="mt-2 max-h-36 space-y-1.5 overflow-y-auto">
                    {externalInstances.map(item => <div key={item.path} className="flex items-center gap-2 rounded-xl px-2.5 py-2" style={{ background:'var(--color-surface)', border:'1px solid var(--color-border)' }}><p className="min-w-0 flex-1 truncate text-[10px] font-bold" style={{ color:'var(--color-text)' }}>{item.name} · {item.mc_version} · {item.loader}</p><button type="button" disabled={creating} onClick={async () => { setCreating(true); try { const raw = await invoke<any>('import_supported_launcher_instance', { sourcePath:item.path, sourceKind:item.source, name:item.name, mcVersion:item.mc_version, loader:item.loader, loaderVersion:item.loader_version || '' }); onCreated(raw); onClose(); } catch (e) { dialog.alert('Не удалось перенести сборку: ' + String(e), { title:'Импорт', danger:true }); } finally { setCreating(false); } }} className="shrink-0 rounded-full px-2.5 py-1 text-[9px] font-bold disabled:opacity-40" style={{ background:'var(--color-primary)', color:'var(--color-primary-text)' }}>Перенести</button></div>)}
                    {!externalLoading && externalInstances.length === 0 && <p className="text-[10px]" style={{ color:'var(--color-text-tertiary)' }}>Доступных сборок пока не найдено.</p>}
                  </div>
                </div>
              </motion.div>
            )}

            {step==='import' && (
              <motion.div key="import" initial={{ opacity:0,x:12 }} animate={{ opacity:1,x:0 }} exit={{ opacity:0,x:-12 }} className="space-y-3">
                <div className="flex items-center justify-between"><p className="text-xs font-black" style={{ color:'var(--color-text)' }}>Найденные сборки</p><button onClick={() => void loadExternalInstances()} className="rounded-lg p-1.5" style={{ color:'var(--color-text-secondary)' }}><RefreshCw className={externalLoading ? 'h-3.5 w-3.5 animate-spin' : 'h-3.5 w-3.5'} /></button></div>
                {externalInstances.length === 0 && !externalLoading && <div className="rounded-xl px-3 py-3 text-[10px]" style={{ background:'var(--color-surface-2)', border:'1px solid var(--color-border)', color:'var(--color-text-tertiary)' }}>XMCL, Modrinth App, Prism Launcher и CurseForge App не нашли доступных сборок. Можно выбрать ZIP или MRPACK вручную.</div>}
                {externalInstances.map(item => <div key={item.path} className="flex items-center gap-3 rounded-xl p-3" style={{ background:'var(--color-surface-2)', border:'1px solid var(--color-border)' }}><div className="min-w-0 flex-1"><p className="truncate text-xs font-bold" style={{ color:'var(--color-text)' }}>{item.name}</p><p className="text-[10px]" style={{ color:'var(--color-text-tertiary)' }}>{item.source === 'prismlauncher' ? 'Prism Launcher' : item.source === 'modrinth' ? 'Modrinth App' : item.source === 'xmcl' ? 'XMCL Launcher' : item.source === 'curseforge' ? 'CurseForge App' : item.source} · {item.mc_version} · {item.loader}</p></div><button disabled={creating} onClick={async () => { setCreating(true); try { const raw = await invoke<any>('import_supported_launcher_instance', { sourcePath:item.path, sourceKind:item.source, name:item.name, mcVersion:item.mc_version, loader:item.loader, loaderVersion:item.loader_version || '' }); onCreated(raw); onClose(); } catch (e) { dialog.alert('Не удалось перенести сборку: ' + String(e), { title:'Импорт', danger:true }); } finally { setCreating(false); } }} className="shrink-0 rounded-lg px-2.5 py-1.5 text-[10px] font-bold disabled:opacity-40" style={{ background:'var(--color-primary)', color:'var(--color-primary-text)' }}>Перенести</button></div>)}
                <button onClick={pickFile}
                  className="w-full py-3 rounded-xl text-sm font-semibold border hover:bg-white/5 transition-all"
                  style={{ border:'1px solid var(--color-border)', color:'var(--color-text-secondary)' }}>
                  Импортировать файл .zip / .mrpack
                </button>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        <div className="shrink-0 px-6 pb-6 pt-1 flex justify-end gap-2.5">
          {step==='custom' && (
            <button onClick={doCreate} disabled={creating || (form.loader !== 'bedrock' && !form.mcVersion)}
              className="flex items-center justify-center gap-2 px-5 py-2.5 rounded-full text-sm font-bold transition-transform duration-150 hover:-translate-y-0.5 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-40"
              style={{ background:'var(--color-primary)', color:'#fff', opacity:creating?0.55:1, boxShadow:'var(--shadow-glow)' }}>
              {creating ? <><div className="w-4 h-4 border border-white/40 border-t-white rounded-full animate-spin" />{t('libraryRuntime.creating')}</> : `+ ${t('libraryRuntime.create')}`}
            </button>
          )}
        </div>
      </motion.div>
      {localPreview && <ModpackManifestPreview preview={localPreview.preview} onClose={() => setLocalPreview(null)} onInstall={excludedPaths => { void importPreparedArchive(localPreview.dataUrl, localPreview.fileName, excludedPaths); }} />}
    </motion.div>
  );
}

// ── Instance sidebar ──────────────────────────────────────────────────────────
function InstanceItem({
  inst, selected, onSelect, onDelete, onOpenSettings,
}: {
  inst: Instance; selected: boolean;
  onSelect: () => void; onDelete: () => void; onOpenSettings: () => void;
}) {
  const { t } = useTranslation();
  const [menu, setMenu] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  // Close menu on outside click
  useEffect(() => {
    if (!menu) return;
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenu(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [menu]);

  return (
    <div
      className="group relative flex items-center gap-2.5 px-2 py-2 rounded-xl transition-all cursor-pointer"
      style={{ background:selected?'var(--color-surface-2)':'transparent', border:`1px solid ${selected?'var(--color-border)':'transparent'}` }}
      onClick={onSelect}>
      <div className="w-8 h-8 rounded-xl flex items-center justify-center text-xs font-black shrink-0"
        style={{ background:`${inst.color}1A`, color:inst.color }}>
        {inst.iconPath ? <img src={toIconSrc(inst.iconPath)} className="w-full h-full rounded-xl object-cover" alt="" /> : inst.name[0]?.toUpperCase()}
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-xs font-bold truncate" style={{ color:'var(--color-text)' }}>{inst.name}</p>
        <p className="text-[10px] truncate" style={{ color:'var(--color-text-secondary)' }}>
          {inst.minecraftVersion} · <span className="capitalize" style={{ color:LOADER_COLOR[inst.modLoader]||'inherit' }}>{inst.modLoader}</span>
        </p>
      </div>

      {/* 3-dots button */}
      <div ref={menuRef} className="relative shrink-0" onClick={e => e.stopPropagation()}>
        <button
          onClick={() => setMenu(v => !v)}
          className="w-5 h-5 rounded-lg flex items-center justify-center opacity-0 group-hover:opacity-100 hover:bg-white/10 transition-all"
          style={{ color:'var(--color-text-secondary)' }}>
          <MoreVertical className="w-3 h-3" />
        </button>
        <AnimatePresence>
          {menu && (
            <motion.div
              className="absolute left-0 top-full mt-1 z-50 rounded-xl overflow-hidden min-w-[148px]"
              style={{ background:'var(--color-surface-2)', border:'1px solid var(--color-border)', boxShadow:'var(--shadow-lg)' }}
              initial={{ opacity:0, scale:0.9, y:-4 }} animate={{ opacity:1, scale:1, y:0 }}
              exit={{ opacity:0, scale:0.9, y:-4 }} transition={{ duration:0.1 }}>
              <button
                onClick={() => { onOpenSettings(); setMenu(false); }}
                className="flex items-center gap-2 px-3 py-2 w-full text-xs text-left hover:bg-white/5"
                style={{ color:'var(--color-text-secondary)' }}>
                <Settings className="w-3.5 h-3.5 shrink-0" />{t('libraryRuntime.settings')}
              </button>
              <div style={{ borderTop:'1px solid var(--color-border)' }} />
              <button
                onClick={() => { onDelete(); setMenu(false); }}
                className="flex items-center gap-2 px-3 py-2 w-full text-xs text-left hover:bg-red-500/10"
                style={{ color:'var(--color-error)' }}>
                <Trash2 className="w-3.5 h-3.5 shrink-0" />{t('libraryRuntime.delete')}
              </button>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}

function InstanceCard({ inst, onClick, onDropOnGroup }: {
  inst: Instance; onClick: () => void; onDropOnGroup: (group: string | null) => void;
}) {
  const launchStatus = useLaunchStore(s => s.getStatus(inst.id));
  const [dragging, setDragging] = useState(false);
  const movedRef = useRef(false);

  return (
    <motion.div
      layout="position"
      drag
      dragSnapToOrigin
      dragElastic={0.08}
      dragMomentum={false}
      dragTransition={{ bounceStiffness: 260, bounceDamping: 24 }}
      whileDrag={{ scale: 1.025, y: -3, zIndex: 50, boxShadow: '0 18px 36px color-mix(in srgb, var(--color-primary) 18%, rgba(0,0,0,0.42))' }}
      onDragStart={() => { setDragging(true); movedRef.current = false; }}
      onDrag={(_, info) => {
        movedRef.current = true;
        const target = document.elementFromPoint(info.point.x, info.point.y)?.closest('[data-group-container]') as HTMLElement | null;
        document.querySelectorAll<HTMLElement>('[data-group-container]').forEach(group => group.toggleAttribute('data-drag-target', group === target));
      }}
      onDragEnd={(_, info) => {
        setDragging(false);
        const el = document.elementFromPoint(info.point.x, info.point.y);
        const target = el?.closest('[data-group-container]') as HTMLElement | null;
        document.querySelectorAll<HTMLElement>('[data-group-container]').forEach(group => group.removeAttribute('data-drag-target'));
        if (target) onDropOnGroup(target.dataset.groupContainer || null);
      }}
      onClick={() => { if (!movedRef.current) onClick(); }}
      whileHover={{ y: dragging ? 0 : -1.5 }}
      whileTap={{ scale: 0.985 }}
      transition={{ layout: { duration: 0.32, ease: [0.22, 1, 0.36, 1] } }}
      className="portal-instance-card flex flex-col items-start gap-2.5 p-3 rounded-2xl text-left relative overflow-hidden w-full cursor-grab active:cursor-grabbing"
      style={{ background:'linear-gradient(145deg, color-mix(in srgb, var(--color-surface) 96%, var(--color-primary-dim)), var(--color-surface))', border:'1px solid var(--color-border)', touchAction: 'none' }}>
      <div className="w-full aspect-square rounded-xl overflow-hidden flex items-center justify-center font-black text-2xl relative pointer-events-none"
        style={{ background: inst.color ? `${inst.color}1A` : 'var(--color-surface-2)', color: inst.color || 'var(--color-text-tertiary)' }}>
        {inst.iconPath ? <img src={toIconSrc(inst.iconPath)} className="w-full h-full object-cover" alt="" draggable={false} /> : inst.name[0]?.toUpperCase()}
        {launchStatus !== 'idle' && (
          <span className="absolute bottom-1.5 right-1.5 w-2.5 h-2.5 rounded-full animate-pulse"
            style={{ background: launchStatus==='running' ? '#2ECC71' : 'var(--color-primary)' }} />
        )}
      </div>
      <div className="min-w-0 w-full pointer-events-none">
        <p className="text-sm font-bold truncate font-display" style={{ color:'var(--color-text)' }}>{inst.name}</p>
        <div className="flex flex-wrap gap-1.5 mt-1.5">
          <span className="inline-flex items-center gap-1 px-1.5 py-1 rounded-lg text-[10px] font-semibold" style={{ background:'var(--color-surface-2)', color:'var(--color-text-secondary)', border:'1px solid var(--color-border)' }}><Box className="w-3 h-3" style={{ color:'var(--color-primary)' }} />{inst.minecraftVersion}</span>
          <span className="inline-flex items-center gap-1 px-1.5 py-1 rounded-lg text-[10px] font-semibold capitalize" style={{ background:`${LOADER_COLOR[inst.modLoader] || 'var(--color-primary)'}18`, color:LOADER_COLOR[inst.modLoader] || 'var(--color-primary)', border:`1px solid ${LOADER_COLOR[inst.modLoader] || 'var(--color-primary)'}44` }}><Layers className="w-3 h-3" />{inst.modLoaderVersion ? `${inst.modLoader} ${inst.modLoaderVersion}` : inst.modLoader}</span>
        </div>
        <div className="flex items-center gap-1.5 mt-2 pt-2 text-[10px]" style={{ color:'var(--color-text-tertiary)', borderTop:'1px solid var(--color-border)' }}><Clock className="w-3 h-3" />{formatPlayMinutes(inst.totalPlayTime)}</div>
      </div>
    </motion.div>
  );
}

function NewGroupModal({ onClose, onCreate }: { onClose: () => void; onCreate: (name: string) => void }) {
  const [name, setName] = useState('');
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ background:'rgba(0,0,0,0.5)' }} onClick={onClose}>
      <div className="w-80 rounded-2xl p-4" style={{ background:'var(--color-surface)', border:'1px solid var(--color-border)' }} onClick={e => e.stopPropagation()}>
        <p className="text-sm font-bold mb-3" style={{ color:'var(--color-text)' }}>Новая группа</p>
        <input autoFocus value={name} onChange={e => setName(e.target.value)}
          placeholder="Название группы" onKeyDown={e => e.key==='Enter' && name.trim() && onCreate(name.trim())}
          className="w-full mb-3 px-3 py-2 rounded-xl text-sm outline-none"
          style={{ background:'var(--color-surface-2)', color:'var(--color-text)', border:'1px solid var(--color-border)' }} />
        <button disabled={!name.trim()} onClick={() => onCreate(name.trim())}
          className="w-full py-2 rounded-xl text-sm font-bold disabled:opacity-40"
          style={{ background:'var(--color-primary)', color:'#fff' }}>
          Создать группу
        </button>
      </div>
    </div>
  );
}

function LibraryGrid({ instances, onSelect, onNew, onOpenInstall, onOpenDeleted, onExtraGroups, onImported, onImportStarted, onImportFailed }: {
  instances: Instance[]; onSelect:(id:string)=>void; onNew:()=>void; onOpenInstall:()=>void; onOpenDeleted:()=>void; onExtraGroups: string[]; onImported:(raw:any)=>void;
  onImportStarted: (fileName: string) => void; onImportFailed: () => void;
}) {
  const navigate = useNavigate();
  const { t } = useTranslation();
  const update = useInstanceStore(s => s.update);
  const [filter, setFilter] = useState('');
  const [showNewGroup, setShowNewGroup] = useState(false);
  const [groups, setGroups] = useState<string[]>(onExtraGroups);
  const [dragOver, setDragOver] = useState(false);
  const [importing, setImporting] = useState(false);
  const dragDepthRef = useRef(0);
  const [smartTerms, setSmartTerms] = useState<Record<string, string>>({});

  useEffect(() => {
    const query = filter.trim();
    if (!query) return;
    let cancelled = false;
    void Promise.all(instances.map(async instance => {
      const base = [instance.name, instance.minecraftVersion, instance.modLoader, instance.lastPlayed ? new Date(instance.lastPlayed).toLocaleString('ru-RU') : 'не запускалась'].join(' ').toLowerCase();
      try {
        const content = await invoke<any[]>('get_instance_mods', { instanceId: instance.id });
        const details = (Array.isArray(content) ? content : []).map(item => {
          const bytes = Number(item.file_size ?? item.fileSize ?? 0);
          const size = bytes > 0 ? `${Math.round(bytes / 1024 / 1024)} mb ${Math.round(bytes / 1024 / 1024 / 1024 * 10) / 10} gb` : '';
          return [item.name, item.file_name ?? item.fileName, item.author, item.version, size].filter(Boolean).join(' ');
        }).join(' ');
        return [instance.id, `${base} ${details}`.toLowerCase()] as const;
      } catch { return [instance.id, base] as const; }
    })).then(index => {
      if (!cancelled) setSmartTerms(Object.fromEntries(index));
    });
    return () => { cancelled = true; };
  }, [filter, instances]);

  const query = filter.trim().toLowerCase();
  const visible = query ? instances.filter(instance => {
    const basic = [instance.name, instance.minecraftVersion, instance.modLoader, instance.lastPlayed ? new Date(instance.lastPlayed).toLocaleString('ru-RU') : 'не запускалась'].join(' ').toLowerCase();
    return (smartTerms[instance.id] ?? basic).includes(query);
  }) : instances;
  const ungrouped = visible.filter(i => !i.group);
  const byGroup = (g: string) => visible.filter(i => i.group === g);
  const allGroupNames = Array.from(new Set([...groups, ...instances.map(i => i.group).filter(Boolean) as string[]]))
    .filter(g => byGroup(g).length > 0);

  const dropOnGroup = (id: string, group: string | null) => update(id, { group: group || undefined });

  const importDroppedArchives = async (files: FileList | File[]) => {
    const archives = Array.from(files).filter(file => /\.(mrpack|zip)$/i.test(file.name));
    if (!archives.length) return;
    setImporting(true);
    try {
      for (const file of archives) {
        // `File.slice()` в WebView может вернуть неполную сигнатуру у
        // корректного полного файла. Проверку формата выполняет Rust ZIP-парсер.
        onImportStarted(file.name);
        const nativePathCandidate = (file as unknown as { path?: unknown }).path;
        const nativePath = typeof nativePathCandidate === 'string' && nativePathCandidate.trim()
          ? nativePathCandidate
          : null;
        const dataUrl = nativePath ?? await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(String(reader.result ?? ''));
          reader.onerror = () => reject(new Error('Не удалось прочитать архив'));
          reader.readAsDataURL(file);
        });
        const imported = await invoke<any>('import_archive_data', { fileName: file.name, dataUrl });
        if (!imported?.id) throw new Error('Импорт не вернул созданную сборку. Исходный файл не был изменён.');
        onImported(imported);
      }
    } catch (error) {
      onImportFailed();
      dialog.alert(String(error), { title: 'Импорт сборки', danger: true });
    } finally {
      setImporting(false);
      setDragOver(false);
    }
  };

  return (
    <div
      className="relative h-full overflow-y-auto p-6"
      onDragEnter={event => { if (Array.from(event.dataTransfer.types).includes('Files')) { event.preventDefault(); dragDepthRef.current += 1; setDragOver(true); } }}
      onDragOver={event => { if (Array.from(event.dataTransfer.types).includes('Files')) { event.preventDefault(); event.dataTransfer.dropEffect = 'copy'; setDragOver(true); } }}
      onDragLeave={event => { if (Array.from(event.dataTransfer.types).includes('Files')) { dragDepthRef.current = Math.max(0, dragDepthRef.current - 1); if (!dragDepthRef.current) setDragOver(false); } }}
      onDrop={event => { event.preventDefault(); dragDepthRef.current = 0; void importDroppedArchives(event.dataTransfer.files); }}>
      {dragOver && <motion.div initial={{ opacity: 0, scale: 0.985 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.985 }} transition={{ duration: 0.16 }} className="pointer-events-none absolute inset-4 z-[140] flex items-center justify-center rounded-3xl border-2 border-dashed" style={{ background:'color-mix(in srgb, var(--color-primary) 14%, transparent)', borderColor:'var(--color-primary)', color:'var(--color-primary)', boxShadow:'0 0 0 6px color-mix(in srgb, var(--color-primary) 8%, transparent)' }}><div className="max-w-md rounded-2xl px-6 py-5 text-center" style={{ background:'var(--color-surface)', border:'1px solid var(--color-border)', boxShadow:'var(--shadow-lg)' }}><Upload className={`mx-auto mb-2 h-8 w-8 ${importing ? 'animate-bounce' : ''}`} /><p className="text-sm font-black">{importing ? 'Импортирую сборку…' : 'Перенесите .mrpack или .zip в эту зону'}</p><p className="mt-1 text-xs leading-relaxed" style={{ color:'var(--color-text-secondary)' }}>{importing ? 'Немного подождите: крупные модпаки могут читать manifest и скачивать модификации несколько минут.' : 'Лаунчер прочитает manifest и начнёт установку автоматически.'}</p></div></motion.div>}
      {/* Toolbar */}
      <div className="flex items-center gap-2 mb-6 flex-wrap">
        <button onClick={onNew}
          className="flex items-center gap-1.5 px-4 py-2.5 rounded-full text-sm font-bold hover:opacity-90"
          style={{ background:'var(--color-primary)', color:'#fff' }}>
          <Plus className="w-4 h-4" />{t('libraryRuntime.create')}
        </button>
        <button onClick={() => navigate('/discover')}
          className="flex items-center gap-1.5 px-4 py-2.5 rounded-full text-sm font-semibold"
          style={{ background:'var(--color-surface-2)', color:'var(--color-text-secondary)', border:'1px solid var(--color-border)' }}>
          <Download className="w-4 h-4" />{t('libraryRuntime.download')}
        </button>
        <button onClick={onOpenInstall}
          className="flex items-center gap-1.5 px-4 py-2.5 rounded-full text-sm font-semibold"
          style={{ background:'var(--color-surface-2)', color:'var(--color-text-secondary)', border:'1px solid var(--color-border)' }}>
          <Upload className="w-4 h-4" />{t('libraryRuntime.upload')}
        </button>
        <button onClick={() => setShowNewGroup(true)}
          className="flex items-center gap-1.5 px-4 py-2.5 rounded-full text-sm font-semibold"
          style={{ background:'var(--color-surface-2)', color:'var(--color-text-secondary)', border:'1px solid var(--color-border)' }}>
          <FolderPlus className="w-4 h-4" />{t('libraryRuntime.newGroup')}
        </button>
        <button onClick={onOpenDeleted}
          className="flex items-center gap-1.5 px-4 py-2.5 rounded-full text-sm font-semibold"
          style={{ background:'var(--color-surface-2)', color:'var(--color-text-secondary)', border:'1px solid var(--color-border)' }}>
          <Trash className="w-4 h-4" />Удалённые
        </button>
        <div className="flex-1 min-w-[140px] flex items-center gap-1.5 px-3 py-2.5 rounded-xl ml-auto"
          style={{ background:'var(--color-surface-2)', border:'1px solid var(--color-border)', maxWidth: 260 }}>
          <Search className="w-3.5 h-3.5 shrink-0" style={{ color:'var(--color-text-tertiary)' }} />
          <input data-library-search="true" className="flex-1 min-w-0 bg-transparent text-sm" placeholder={t('libraryRuntime.smartSearch')}
            value={filter} onChange={e => setFilter(e.target.value)} style={{ color:'var(--color-text)' }} />
        </div>
      </div>

      {instances.length === 0 ? (
        <div className="mx-auto mt-8 flex max-w-md flex-col items-center justify-center gap-4 px-8 py-16 text-center">
          <div className="w-20 h-20 rounded-full flex items-center justify-center" style={{ background:'var(--color-primary-dim)', border:'1px solid color-mix(in srgb, var(--color-primary) 35%, transparent)', boxShadow:'0 12px 28px color-mix(in srgb, var(--color-primary) 16%, transparent)' }}>
            <Package className="w-10 h-10" style={{ color:'var(--color-text-tertiary)' }} />
          </div>
          <div className="text-center">
            <p className="font-black text-lg font-display" style={{ color:'var(--color-text)' }}>{t('libraryRuntime.noInstances')}</p>
            <p className="text-sm mt-1" style={{ color:'var(--color-text-secondary)' }}>{t('libraryRuntime.emptyDescription')}</p>
          </div>
          <button onClick={onNew}
            className="flex items-center gap-2 px-5 py-2.5 rounded-full text-sm font-bold hover:opacity-90 transition-transform duration-150 hover:-translate-y-0.5 active:scale-[0.98]"
            style={{ background:'var(--color-primary)', color:'#fff', boxShadow:'var(--shadow-glow)' }}>
            <Plus className="w-4 h-4" />{t('libraryRuntime.create')}
          </button>
        </div>
      ) : (
        <>
          {allGroupNames.map(g => (
            <div key={g} className="mb-8" data-group-container={g}>
              <div className="flex items-center gap-2 mb-3">
                <p className="text-xs font-bold uppercase tracking-wider font-display" style={{ color:'var(--color-text-tertiary)' }}>{g}</p>
                <span className="text-xs" style={{ color:'var(--color-text-tertiary)' }}>{byGroup(g).length}</span>
                <div className="flex-1 h-px" style={{ background:'var(--color-border)' }} />
              </div>
              <div className="grid gap-3 min-h-[80px] rounded-2xl" style={{ gridTemplateColumns:'repeat(auto-fill, minmax(150px,1fr))' }}>
                {byGroup(g).map(inst => (
                  <InstanceCard key={inst.id} inst={inst} onClick={() => onSelect(inst.id)}
                    onDropOnGroup={(grp) => dropOnGroup(inst.id, grp)} />
                ))}
              </div>
            </div>
          ))}

          {ungrouped.length > 0 && (
            <div data-group-container="">
              <div className="flex items-center gap-2 mb-3">
                <p className="text-xs font-bold uppercase tracking-wider font-display" style={{ color:'var(--color-text-tertiary)' }}>Ungrouped</p>
                <span className="text-xs" style={{ color:'var(--color-text-tertiary)' }}>{ungrouped.length}</span>
                <div className="flex-1 h-px" style={{ background:'var(--color-border)' }} />
              </div>
              <div className="grid gap-3 min-h-[80px] rounded-2xl" style={{ gridTemplateColumns:'repeat(auto-fill, minmax(150px,1fr))' }}>
                {ungrouped.map(inst => (
                  <InstanceCard key={inst.id} inst={inst} onClick={() => onSelect(inst.id)}
                    onDropOnGroup={(grp) => dropOnGroup(inst.id, grp)} />
                ))}
              </div>
            </div>
          )}
        </>
      )}

      {showNewGroup && (
        <NewGroupModal onClose={() => setShowNewGroup(false)}
          onCreate={(name) => {
            setGroups(gs => [...gs, name]);
            const best = [...instances].sort((a, b) => (b.totalPlayTime || 0) - (a.totalPlayTime || 0))[0];
            if (best) update(best.id, { group: name });
            setShowNewGroup(false);
          }} />
      )}
    </div>
  );
}

// ── Content row ───────────────────────────────────────────────────────────────
function AuthorAvatarDot({ author, source }: { author?: string; source?: string }) {
  const avatar = useAuthorAvatar(author, source);
  return (
    <span className="flex w-3.5 h-3.5 items-center justify-center rounded-full overflow-hidden shrink-0 text-[8px] font-bold" style={{ background:'var(--color-surface-2)', color:'var(--color-text-secondary)' }}>
      {avatar ? <img src={avatar} alt="" className="w-full h-full object-cover" /> : (author?.slice(0, 1).toUpperCase() || '?')}
    </span>
  );
}

function ContentSourceBadge({ source }: { source?: string }) {
  const showContentSourceIcon = useUiStore(state => state.showContentSourceIcon);
  if (!showContentSourceIcon || (source !== 'modrinth' && source !== 'curseforge')) return null;
  const isModrinth = source === 'modrinth';
  return (
    <span
      className="flex h-6 w-6 shrink-0 items-center justify-center rounded-lg"
      title={isModrinth ? 'Downloaded from Modrinth' : 'Downloaded from CurseForge'}
      aria-label={isModrinth ? 'Downloaded from Modrinth' : 'Downloaded from CurseForge'}
      style={{ background:'var(--color-surface-2)', border:'1px solid var(--color-border)' }}>
      <img src={isModrinth ? modrinthWrench : curseforgeAnvil} alt="" className="h-3.5 w-3.5 object-contain" />
    </span>
  );
}

function ContentRow({ item, onToggle, onDelete, onShowInFolder }: { item:any; onToggle:()=>void; onDelete:()=>void; onShowInFolder:()=>void }) {
  const navigate = useNavigate();
  const [menu, setMenu] = useState(false);
  return (
    <tr className="group border-b hover:bg-white/[0.02] transition-colors" style={{ borderColor:'var(--color-border)' }}>
      <td className="py-2.5 px-4">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-xl flex items-center justify-center text-xs font-black shrink-0 overflow-hidden" style={{ background:`${item.color}1A`,color:item.color }}>
            {item.icon_url
              ? <img src={item.icon_url} alt="" className="w-full h-full object-cover" onError={e => { (e.target as HTMLImageElement).style.display='none'; }} />
              : item.name[0]}
          </div>
          <div>
            {item.source === 'modrinth' || item.source === 'curseforge' ? (
              <button
                onClick={(e) => { e.stopPropagation(); navigate(`/discover/${item.source}/${item.id}`); }}
                className="text-sm font-semibold text-left hover:underline"
                style={{ color:'var(--color-text)' }}>
                {item.name}
              </button>
            ) : (
              <p className="text-sm font-semibold" style={{ color:'var(--color-text)' }}>{item.name}</p>
            )}
            {item.author ? (
              <button
                onClick={(e) => { e.stopPropagation(); navigate(`/author/${item.source === 'curseforge' ? 'curseforge' : 'modrinth'}/${encodeURIComponent(item.author)}`); }}
                className="flex items-center gap-1 mt-0.5 hover:opacity-80">
                <AuthorAvatarDot author={item.author} source={item.source} />
                <span className="text-[10px] font-semibold" style={{ color:'var(--color-primary)' }}>{item.author}</span>
              </button>
            ) : (
              <p className="text-[10px]" style={{ color:'var(--color-text-tertiary)' }}>
                {item.source && item.source !== 'manual' ? item.source : 'Local file · no Modrinth / CurseForge record'}
              </p>
            )}
          </div>
        </div>
      </td>
      <td className="py-2.5 px-4">
        <p className="text-xs font-medium" style={{ color:'var(--color-text)' }}>{item.version}</p>
        {item.updateAvailable && (item.latest_version || item.latestVersion) ? <p className="text-[10px] font-bold" style={{ color:'var(--color-primary)' }}>→ {item.latest_version || item.latestVersion}</p> : <p className="text-[10px] truncate max-w-[180px]" style={{ color:'var(--color-text-tertiary)' }}>{item.filename}</p>}
      </td>
      <td className="py-2.5 px-4">
        <div className="flex items-center justify-end gap-1.5">
          {item.updateAvailable && (
            <button className="flex items-center gap-1 px-2 py-1 rounded-lg text-[10px] font-bold" style={{ background:'rgba(46,204,113,0.15)',color:'#2ECC71' }}>
              <Download className="w-3 h-3" />Update
            </button>
          )}
          <ContentSourceBadge source={item.source} />
          <button onClick={onToggle} role="switch" aria-checked={!!item.enabled}
            title={item.enabled ? 'Выключить модификацию' : 'Включить модификацию'}
            className="relative w-10 h-5 rounded-full shrink-0 transition-all"
            style={{ background:item.enabled ? 'var(--color-primary)' : 'var(--color-surface-2)', border:`1px solid ${item.enabled ? 'var(--color-primary)' : 'var(--color-border)'}`, boxShadow:item.enabled ? '0 0 12px var(--color-primary-dim)' : 'none' }}>
            <span className="absolute top-0.5 w-4 h-4 rounded-full bg-white transition-all" style={{ left:item.enabled ? 'calc(100% - 18px)' : '2px', boxShadow:'0 1px 3px rgba(0,0,0,0.35)' }} />
          </button>
          <button onClick={onDelete} className="w-6 h-6 rounded-lg flex items-center justify-center"
            style={{ background:'rgba(231,76,60,0.1)',color:'var(--color-error)' }} title="Delete">
            <Trash2 className="w-3.5 h-3.5" />
          </button>
          <div className={`relative ${menu ? 'z-[320]' : ''}`}>
            <button onClick={() => setMenu(v => !v)} className="w-6 h-6 rounded-lg flex items-center justify-center hover:bg-white/5">
              <MoreVertical className="w-3 h-3" style={{ color:'var(--color-text-secondary)' }} />
            </button>
            <AnimatePresence>
              {menu && (
                <motion.div className="absolute right-0 bottom-full mb-1 z-[400] min-w-[148px] overflow-hidden rounded-xl"
                  style={{ background:'var(--color-surface)', border:'1px solid var(--color-border-strong)', boxShadow:'var(--shadow-lg)', isolation:'isolate', backdropFilter:'none', WebkitBackdropFilter:'none' }}
                  initial={{ opacity:0,scale:0.9,y:4 }} animate={{ opacity:1,scale:1,y:0 }} exit={{ opacity:0,scale:0.9,y:4 }}
                  transition={{ duration:0.1 }}>
                  {[
                    { Icon:Copy, label:'Скопировать название', fn:()=>navigator.clipboard.writeText(item.name) },
                    { Icon:Folder, label:'Показать в папке', fn:onShowInFolder },
                  ].map(r => (
                    <button key={r.label} onClick={() => { r.fn(); setMenu(false); }}
                      className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs hover:bg-white/5"
                      style={{ color:'var(--color-text)' }}>
                      <r.Icon className="w-3.5 h-3.5 shrink-0" />{r.label}
                    </button>
                  ))}
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </div>
      </td>
    </tr>
  );
}

// ── Content tabs ──────────────────────────────────────────────────────────────
const TABS: { id: ContentTab; Icon: any; labelKey: string }[] = [
  { id:'content', Icon:Package, labelKey:'content' },
  { id:'files',   Icon:Folder,  labelKey:'files' },
  { id:'worlds',  Icon:Globe,   labelKey:'worlds' },
  { id:'screenshots', Icon:Image, labelKey:'screenshots' },
  { id:'logs',    Icon:Terminal, labelKey:'logs' },
];
const CONTENT_FILTERS: { id: ContentFilter; label: string }[] = [
  { id:'all',           label:'Всё' },
  { id:'mods',          label:'Моды' },
  { id:'resourcepacks', label:'Наборы ресурсов' },
  { id:'shaders',       label:'Шейдеры' },
  { id:'updates',       label:'Обновления' },
];

type InstanceInstallEvent = {
  source: 'launch' | 'minecraft' | 'java' | 'download';
  stage: string;
  message: string;
  current: number;
  total: number;
  percent: number;
};

function installStageName(event: InstanceInstallEvent) {
  if (event.source === 'java') return 'Java';
  switch (event.stage) {
    case 'client': return 'Клиент Minecraft';
    case 'libraries': return 'Игровые библиотеки';
    case 'natives': return 'Нативные библиотеки';
    case 'assets': return 'Игровые ресурсы';
    case 'classpath': return 'Подготовка запуска';
    case 'downloading': return 'Загрузка Minecraft';
    default: return event.stage ? event.stage.replace(/[-_]/g, ' ') : 'Подготовка Minecraft';
  }
}

function InstanceInstallProgress({ instanceId, active }: { instanceId: string; active: boolean }) {
  const [progress, setProgress] = useState<InstanceInstallEvent | null>(null);
  const [dismissed, setDismissed] = useState(false);
  const completionTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const unsubs: Array<() => void> = [];
    const clearCompletionTimer = () => {
      if (completionTimer.current) clearTimeout(completionTimer.current);
      completionTimer.current = null;
    };
    const dismissAfterCompletion = () => {
      clearCompletionTimer();
      completionTimer.current = setTimeout(() => {
        setProgress(null);
        setDismissed(true);
      }, 1100);
    };
    const percent = (payload: any) => {
      const current = Number(payload?.current ?? payload?.downloaded ?? 0);
      const total = Number(payload?.total ?? 0);
      return Math.max(0, Math.min(100, Number(payload?.percent ?? (total > 0 ? Math.round(current / total * 100) : 0))));
    };
    const push = (source: InstanceInstallEvent['source'], payload: any) => {
      clearCompletionTimer();
      setDismissed(false);
      const current = Number(payload?.current ?? payload?.downloaded ?? 0);
      const total = Number(payload?.total ?? 0);
      const computedPercent = percent(payload);
      setProgress({
        source,
        stage: String(payload?.stage ?? ''),
        message: String(payload?.message ?? 'Подготавливаем Minecraft…'),
        current,
        total,
        percent: computedPercent,
      });
      const terminalStage = /^(?:done|complete|completed|installed|error|cancelled|canceled)$/i.test(String(payload?.stage ?? ''));
      if (computedPercent >= 100 || terminalStage) dismissAfterCompletion();
    };

    void listen<any>('install-progress', event => { if (active) push('minecraft', event.payload); }).then(unsub => unsubs.push(unsub));
    void listen<any>('download-progress', event => { if (active) push('download', event.payload); }).then(unsub => unsubs.push(unsub));
    void listen<any>('java-download', event => {
      if (!active) return;
      const payload = event.payload ?? {};
      push('java', { ...payload, stage: 'java', current: payload.percent, total: 100, message: payload.message || `Установка Java ${payload.version ?? ''}`.trim() });
    }).then(unsub => unsubs.push(unsub));
    void listen<any>('launch-status', event => {
      const payload = event.payload ?? {};
      if (payload.instance_id !== instanceId) return;
      const status = String(payload.status ?? '');
      if (['running', 'stopped', 'error', 'crashed'].includes(status)) {
        clearCompletionTimer();
        setProgress(null);
        setDismissed(true);
        return;
      }
      clearCompletionTimer();
      setDismissed(false);
      const stagePercent: Record<string, number> = { preparing: 3, auth: 6, resolve: 10, install: 15, java: 20, java_downloading: 20, classpath: 92, launching: 98 };
      setProgress(previous => previous?.source !== 'launch' ? previous : null);
      setProgress(previous => previous || {
        source: 'launch', stage: status, message: String(payload.message ?? 'Подготавливаем Minecraft…'),
        current: stagePercent[status] ?? 0, total: 100, percent: stagePercent[status] ?? 0,
      });
    }).then(unsub => unsubs.push(unsub));

    return () => {
      clearCompletionTimer();
      unsubs.forEach(unsub => unsub());
    };
  }, [instanceId, active]);

  useEffect(() => {
    if (active) {
      setDismissed(false);
      return;
    }
    if (completionTimer.current) clearTimeout(completionTimer.current);
    setProgress(null);
    setDismissed(true);
  }, [active]);

  const fallback: InstanceInstallEvent = { source: 'launch', stage: 'preparing', message: 'Подготавливаем установку Minecraft…', current: 0, total: 100, percent: 0 };
  const event = progress ?? (active && !dismissed ? fallback : null);
  if (!event) return null;
  const fileCount = event.total > 0 && event.total <= 100000 && event.source !== 'java'
    ? `${Math.min(event.current, event.total)} / ${event.total} файлов`
    : null;

  return (
    <motion.div
      initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }}
      className="mx-6 mb-3 shrink-0 rounded-xl px-3.5 py-3"
      style={{ background: 'var(--color-surface-2)', border: '1px solid var(--color-border)' }}>
      <div className="mb-2 flex items-center gap-2">
        <Download className="h-4 w-4 shrink-0 animate-pulse" style={{ color: 'var(--color-primary)' }} />
        <div className="min-w-0 flex-1">
          <p className="truncate text-xs font-bold" style={{ color: 'var(--color-text)' }}>{event.message}</p>
          <p className="mt-0.5 truncate text-[10px]" style={{ color: 'var(--color-text-secondary)' }}>
            {installStageName(event)}{fileCount ? ` · ${fileCount}` : ''}
          </p>
        </div>
        <span className="shrink-0 text-sm font-black tabular-nums" style={{ color: 'var(--color-primary)' }}>{event.percent}%</span>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full" style={{ background: 'var(--color-surface)' }}>
        <motion.div className="h-full rounded-full" style={{ background: 'var(--color-primary)' }} animate={{ width: `${event.percent}%` }} transition={{ duration: 0.25 }} />
      </div>
    </motion.div>
  );
}

function InstanceDetail({ inst, onDelete, onBack }: { inst: Instance; onDelete: () => void; onBack: () => void }) {
  const navigate = useNavigate();
  const { t } = useTranslation();
  const user = useCurrentUser();
  const { update } = useInstanceStore();
  // Fallback values for RAM/Java when the instance itself doesn't override
  const globalSettings = useSettingsStore(s => ({
    minRam: s.minRam, maxRam: s.maxRam, javaPath: s.javaPath, customJvmArgs: s.customJvmArgs,
  }));
  const [tab, setTab] = useState<ContentTab>('content');
  const [contentFilter, setContentFilter] = useState<ContentFilter>('all');
  const [search, setSearch] = useState('');
  /** 'all' | 'modrinth' | 'curseforge' | 'local' — source filter for mod list */
  const [sourceFilter, setSourceFilter] = useState<'all'|'modrinth'|'curseforge'|'local'>('all');
  const launchStatus = useLaunchStore(s => s.getStatus(inst.id));
  const setLaunchStatusGlobal = useLaunchStore(s => s.setStatus);
  const setLaunchStatus = useCallback((v: LaunchStatus) => setLaunchStatusGlobal(inst.id, v), [inst.id, setLaunchStatusGlobal]);
  const [launchError, setLaunchError] = useState('');
  const [launchNotice, setLaunchNotice] = useState('');
  const sessionStart = useRef<number | null>(null);
  const [mods, setMods] = useState<any[]>([]);
  const [shaders, setShaders] = useState<any[]>([]);
  const [resourcepacks, setResourcepacks] = useState<any[]>([]);
  const [showLogs, setShowLogs] = useState(false);
  const [hasLogs, setHasLogs] = useState(false);
  const [headerMenu, setHeaderMenu] = useState(false);
  const headerMenuRef = useRef<HTMLDivElement>(null);
  const [files, setFiles] = useState<any[]>([]);
  const [cwd, setCwd] = useState('');
  const [worlds, setWorlds] = useState<any[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [updatingAll, setUpdatingAll] = useState(false);
  const [updateProgress, setUpdateProgress] = useState<{ percent: number; message: string } | null>(null);
  const [seenUpdateSignature, setSeenUpdateSignature] = useState(() => localStorage.getItem(`portal-updates-seen-${inst.id}`) ?? '');

  const loadFiles = useCallback(async (path: string) => {
    try { setFiles(await invoke<any[]>('instance_list_dir', { instanceId: inst.id, path })); }
    catch { setFiles([]); }
  }, [inst.id]);
  const loadWorlds = useCallback(async () => {
    try { setWorlds(await invoke<any[]>('instance_list_worlds', { instanceId: inst.id })); }
    catch { setWorlds([]); }
  }, [inst.id]);
  useEffect(() => {
    if (tab === 'files') loadFiles(cwd);
    if (tab === 'worlds') { loadWorlds(); }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab]);

  function handleFilesPicked(ev: React.ChangeEvent<HTMLInputElement>) {
    const paths: string[] = [];
    for (const f of Array.from(ev.target.files || [])) {
      const p = (f as any).path as string | undefined;
      if (p) paths.push(p);
    }
    ev.target.value = '';
    if (!paths.length) return;
    invoke('instance_drop_files', {
      instanceId: inst.id,
      files: paths,
      targetDir: tab === 'files' ? (cwd || null) : null,
    })
      .then(() => { loadContent(); if (tab === 'files') loadFiles(cwd); })
      .catch(error => {
        dialog.alert(t('instancePage.fileAddFailed', { error: String(error) }), { title: t('instancePage.files'), danger: true });
      });
  }

  useEffect(() => {
    if (!headerMenu) return;
    const handler = (e: MouseEvent) => {
      if (headerMenuRef.current && !headerMenuRef.current.contains(e.target as Node)) setHeaderMenu(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [headerMenu]);

  useEffect(() => {
    setLaunchError('');
    // Спрашиваем у бэкенда, реально ли эта сборка сейчас запущена — раньше
    // тут стоял безусловный setLaunchStatus('idle'), из-за чего при
    // возврате на страницу (например, после перехода в Find Projects и
    // обратно) кнопка Play снова становилась кликабельной, даже пока игра
    // всё ещё работала в фоне.
    invoke<string[]>('get_running_instances')
      .then(running => {
        setLaunchStatus(running.includes(inst.id) ? 'running' : 'idle');
      })
      .catch(() => setLaunchStatus('idle'));
    let unsub: (()=>void)|undefined;
    listen<any>('launch-status', e => {
      if (e.payload.instance_id !== inst.id) return;
      const s = e.payload.status;
      if (['launching','preparing','downloading','classpath'].includes(s)) setLaunchStatus('launching');
      if (s==='running') { setLaunchStatus('running'); sessionStart.current = Date.now(); }
      if (s==='stopped') {
        setLaunchStatus('idle'); setHasLogs(true);
        if (sessionStart.current) {
          const minutes = Math.round((Date.now() - sessionStart.current) / 60000);
          if (minutes > 0) update(inst.id, { totalPlayTime: (inst.totalPlayTime || 0) + minutes });
          sessionStart.current = null;
        }
      }
      if (['error','crashed'].includes(s)) {
        setLaunchStatus('idle');
        setHasLogs(true);
        setLaunchError(e.payload.message||'Launch failed');
        setTimeout(()=>setLaunchError(''),5000);
      }
    }).then(fn => { unsub = fn; });

    // Check if there are existing logs for this instance
    invoke<string[] | string>('get_game_logs', { instanceId: inst.id })
      .then(content => { if (Array.isArray(content) ? content.length > 0 : Boolean(content?.trim())) setHasLogs(true); })
      .catch(() => {});

    // Listen for first log line to show logs button
    let logUnsub: (()=>void)|undefined;
    listen<any>('game-log', e => {
      if (e.payload.instance_id === inst.id && e.payload.source === 'minecraft' && typeof e.payload.line === 'string') setHasLogs(true);
    }).then(fn => { logUnsub = fn; });

    return () => { unsub?.(); logUnsub?.(); };
  }, [inst.id]);

  const [loadingContent, setLoadingContent] = useState(false);
  const loadContent = useCallback(async () => {
    setLoadingContent(true);
    const applyContent = (list: any[]) => {
      const mapped = list.map((m: any) => {
        // Normalize Rust snake_case and legacy camelCase before splitting tabs.
        const rawType = String(m.mod_type ?? m.modType ?? m.type ?? 'mod').toLowerCase().replace(/[_-]/g, '');
        const mod_type = rawType.includes('shader') ? 'shaderpack'
          : rawType.includes('resource') || rawType.includes('texturepack') ? 'resourcepack'
          : rawType.includes('datapack') ? 'datapack'
          : 'mod';
        return {
          id: m.id || m.file_name || m.fileName,
          name: m.name || m.file_name || m.fileName || 'Unknown',
          author: m.author || '',
          version: m.version || '',
          latest_version: m.latest_version ?? m.latestVersion ?? '',
          latestVersion: m.latest_version ?? m.latestVersion ?? '',
          filename: m.file_name || m.fileName,
          file_name: m.file_name || m.fileName,
          mod_type,
          color: mod_type === 'shaderpack' ? '#3498db' : mod_type === 'resourcepack' ? '#06b6d4' : '#8b5cf6',
          enabled: m.enabled !== false,
          updateAvailable: !!(m.update_available ?? m.updateAvailable),
          source: m.source,
          icon_url: m.icon_url || m.iconUrl || null,
        };
      });
      setMods(mapped.filter((m: any) => m.mod_type === 'mod'));
      setShaders(mapped.filter((m: any) => m.mod_type === 'shaderpack'));
      setResourcepacks(mapped.filter((m: any) => m.mod_type === 'resourcepack'));
    };
    try {
      // Local disk scan is fast and must not wait for network metadata.
      const local = await invoke<any[]>('get_instance_mods', { instanceId: inst.id });
      applyContent(Array.isArray(local) ? local : []);
    } catch (e) {
      console.warn('Failed to load local content:', e);
    } finally {
      setLoadingContent(false);
    }
    // Update metadata in the background; a slow API must not blank the page.
    void invoke<any[]>('check_mod_updates', { instanceId: inst.id })
      .then(updated => { if (Array.isArray(updated)) applyContent(updated); })
      .catch(() => {});
  }, [inst.id]);

  useEffect(() => { loadContent(); }, [loadContent]);

  useEffect(() => {
    let off: (() => void) | undefined;
    void listen<any>('mod-progress', event => {
      if (!updatingAll) return;
      setUpdateProgress({ percent: Number(event.payload?.percent ?? 0), message: String(event.payload?.message ?? 'Updating content…') });
    }).then(fn => { off = fn; });
    return () => off?.();
  }, [updatingAll]);

  const launch = useCallback(async () => {
    if (launchStatus!=='idle') return;
    if (inst.modLoader === 'bedrock') {
      setLaunchStatus('launching'); setLaunchError('');
      try {
        await invoke('launch_bedrock', { family: inst.modLoaderVersion || null });
        update(inst.id, { lastPlayed: new Date().toISOString() });
      } catch (e: any) {
        setLaunchError(e?.message || String(e));
      } finally {
        setLaunchStatus('idle');
      }
      return;
    }
    if (!user) { navigate('/settings/account'); return; }
    setLaunchStatus('launching'); setLaunchError(''); setLaunchNotice('');
    try {
      // Make sure the on-disk instance.json exists before launching — the
      // local store may have an entry that was never persisted by the Rust
      // side (offline create, failed create_instance, etc.).
      try {
        await invoke('ensure_instance', {
          id: inst.id,
          name: inst.name,
          mcVersion: inst.minecraftVersion,
          loader: inst.modLoader,
          loaderVersion: inst.modLoaderVersion || '',
          minRam: globalSettings.minRam,
          maxRam: globalSettings.maxRam,
          javaPath: globalSettings.javaPath || '',
          customJvmArgs: globalSettings.customJvmArgs || '',
          color: inst.color,
          icon: inst.iconPath || null,
        });
      } catch (e) {
        console.warn('ensure_instance failed:', e);
      }
      update(inst.id, { lastPlayed: new Date().toISOString() });
      
      // Validate auth data before launch
      if (!user || !user.uuid || !user.username) {
        throw new Error('Authentication data missing. Please sign in again in Settings → Account.');
      }
      
      console.log(`🚀 Launching with auth: username=${user.username}, uuid=${user.uuid}, token_len=${(user.accessToken || '').length}`);
      
      const result = await invoke<{ pid?: number | null; message?: string }>('launch_instance', {
          instance_id: inst.id,
          access_token: user.accessToken || '',
          uuid: user.uuid,
          username: user.username,
          provider: user.provider,
      });
      if (!result?.pid) {
        setLaunchStatus('idle');
        setLaunchNotice(result?.message || 'Minecraft подготовлен. Нажмите Launch ещё раз, чтобы запустить игру.');
        setTimeout(() => setLaunchNotice(''), 8000);
      }
    } catch (err: any) { setLaunchStatus('idle'); setLaunchError(String(err)); setTimeout(()=>setLaunchError(''),6000); }
  }, [launchStatus, user, inst, navigate, update]);

  const stop = useCallback(async () => {
    // Stop must never wait for taskkill or a child process tree in the UI.
    // The backend returns immediately and emits terminal launch-status later.
    setLaunchError('');
    try {
      await invoke('cancel_launch', { instanceId: inst.id });
      setLaunchStatus('idle');
    } catch (error) {
      setLaunchStatus('idle');
      setLaunchError(String(error));
      setTimeout(() => setLaunchError(''), 5000);
    }
  }, [inst.id, launchStatus]);

  const updateItems = [...mods,...shaders,...resourcepacks].filter(m => m.updateAvailable);
  const disabledItems = [...mods,...shaders,...resourcepacks].filter(m => m.enabled === false);
  const contentFilters = disabledItems.length > 0
    ? [...CONTENT_FILTERS, { id:'disabled' as ContentFilter, label:'Выключено' }]
    : CONTENT_FILTERS;
  const updateSignature = updateItems.map(item => `${item.id}:${item.latest_version ?? item.latestVersion ?? ''}`).sort().join('|');
  const unseenUpdateCount = updateSignature && updateSignature !== seenUpdateSignature ? updateItems.length : 0;
  useEffect(() => {
    if (contentFilter !== 'updates') return;
    setSeenUpdateSignature(updateSignature);
    localStorage.setItem(`portal-updates-seen-${inst.id}`, updateSignature);
  }, [contentFilter, updateSignature, inst.id]);
  useEffect(() => {
    if (contentFilter === 'disabled' && disabledItems.length === 0) setContentFilter('all');
  }, [contentFilter, disabledItems.length]);
  const allItems = contentFilter==='mods' ? mods
    : contentFilter==='shaders' ? shaders
    : contentFilter==='resourcepacks' ? resourcepacks
    : contentFilter==='updates' ? updateItems
    : contentFilter==='disabled' ? disabledItems
    : [...mods,...shaders,...resourcepacks];
  const items = allItems.filter(m => {
    if (search && !m.name.toLowerCase().includes(search.toLowerCase())) return false;
    if (sourceFilter === 'all') return true;
    const src = (m.source || 'local').toLowerCase();
    if (sourceFilter === 'local') return !src || src === 'manual' || src === 'local';
    return src === sourceFilter;
  });

  const toggle = async (id: string) => {
    const item = [...mods,...shaders,...resourcepacks].find((m:any) => m.id===id);
    if (!item) return;
    const nowEnabled = !item.enabled;
    const setter = item.mod_type==='shaderpack' ? setShaders : item.mod_type==='resourcepack' ? setResourcepacks : setMods;
    (setter as any)((p: any[]) => p.map((m:any) => m.id===id ? {...m, enabled:nowEnabled} : m));
    try {
      await invoke('toggle_mod', { instanceId: inst.id, fileName: item.file_name, modType: item.mod_type||'mod', enabled: nowEnabled });
    } catch (e) { console.warn('toggle_mod failed:', e); loadContent(); }
  };
  const del = async (id: string) => {
    const item = [...mods,...shaders,...resourcepacks].find((m:any) => m.id===id);
    if (!item) return;
    const setter = item.mod_type==='shaderpack' ? setShaders : item.mod_type==='resourcepack' ? setResourcepacks : setMods;
    (setter as any)((p: any[]) => p.filter((m:any) => m.id!==id));
    try {
      await invoke('remove_mod', { instanceId: inst.id, fileName: item.file_name, modType: item.mod_type||'mod' });
    } catch (e) { console.warn('remove_mod failed:', e); loadContent(); }
  };

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-4 px-6 py-4 shrink-0" style={{ borderBottom:'1px solid var(--color-border)' }}>
        <button onClick={onBack} title={t('instancePage.back')}
          className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0 hover:bg-white/5 transition-colors"
          style={{ color:'var(--color-text-secondary)' }}>
          <ArrowLeft className="w-4.5 h-4.5" />
        </button>
        <div className="w-12 h-12 rounded-2xl flex items-center justify-center text-xl font-black shrink-0"
          style={{ background:`${inst.color}1A`,color:inst.color }}>
          {inst.iconPath ? <img src={toIconSrc(inst.iconPath)} className="w-full h-full rounded-2xl object-cover" alt="" /> : inst.name[0]?.toUpperCase()}
        </div>
        <div className="flex-1 min-w-0">
          <h1 className="font-black text-lg truncate font-display" style={{ color:'var(--color-text)' }}>{inst.name}</h1>
          <p className="text-xs" style={{ color:'var(--color-text-secondary)' }}>
            <span className="font-semibold capitalize" style={{ color:LOADER_COLOR[inst.modLoader]||'inherit' }}>{inst.modLoader}</span>
            {inst.modLoaderVersion && inst.modLoader!=='vanilla' && <> {inst.modLoaderVersion}</>}
            {' '}{inst.minecraftVersion}
            {inst.totalPlayTime > 0 && <> · {t('instancePage.playTime', { hours: Math.floor(inst.totalPlayTime / 60), minutes: inst.totalPlayTime % 60 })}</>}
            {inst.lastPlayed&&<> · {t('instancePage.lastPlayed', { date: new Date(inst.lastPlayed).toLocaleDateString() })}</>}
          </p>
          {launchError&&<p className="text-[10px] mt-0.5" style={{ color:'var(--color-error)' }}>{launchError}</p>}
          {launchNotice&&<p className="text-[10px] mt-0.5" style={{ color:'var(--color-primary)' }}>{launchNotice}</p>}
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {(launchStatus==='running' || launchStatus==='launching') ? (
            <button onClick={stop} className="flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm font-bold"
              style={{ background:'rgba(231,76,60,0.15)',color:'var(--color-error)' }}>
              <Square className="w-3.5 h-3.5 fill-current" />{launchStatus==='launching' ? t('instancePage.cancel') : t('instancePage.stop')}
            </button>
          ) : (
            <button onClick={launch}
              className="flex items-center gap-1.5 px-5 py-2 rounded-xl text-sm font-bold hover:opacity-90 transition-all"
              style={{ background:'var(--color-primary)',color:'#fff' }}>
              <Play className="w-3.5 h-3.5 fill-current" />{t('instancePage.play')}
            </button>
          )}
          <button onClick={() => navigate(`/instances/${inst.id}/settings`)}
            className="w-9 h-9 rounded-xl flex items-center justify-center hover:bg-white/5 transition-colors"
            style={{ color:'var(--color-text-secondary)',border:'1px solid var(--color-border)' }}>
            <Settings className="w-4 h-4" />
          </button>
          <div ref={headerMenuRef} className="relative">
            <button onClick={() => setHeaderMenu(v => !v)}
              className="w-9 h-9 rounded-xl flex items-center justify-center hover:bg-white/5 transition-colors"
              style={{ color:'var(--color-text-secondary)',border:'1px solid var(--color-border)' }}>
              <MoreVertical className="w-4 h-4" />
            </button>
            <AnimatePresence>
              {headerMenu && (
                <motion.div
                  className="absolute right-0 top-full mt-1 z-50 rounded-xl overflow-hidden min-w-[180px]"
                  style={{ background:'var(--color-surface-2)', border:'1px solid var(--color-border)', boxShadow:'var(--shadow-lg)' }}
                  initial={{ opacity:0, scale:0.95, y:-4 }} animate={{ opacity:1, scale:1, y:0 }}
                  exit={{ opacity:0, scale:0.95, y:-4 }} transition={{ duration:0.1 }}>
                  <button
                    onClick={async () => {
                      setHeaderMenu(false);
                      try {
                        const iconIcoDataUrl = await createInstanceShortcutIco(inst.iconPath);
                        const shortcut = await invoke<string>('create_instance_shortcut', {
                          instanceId: inst.id,
                          instanceName: inst.name,
                          iconIcoDataUrl,
                        });
                        dialog.alert(t('instancePage.shortcutCreated', { path: shortcut }), { title: t('instancePage.shortcutTitle') });
                      } catch (e) {
                        dialog.alert(t('instancePage.shortcutFailed', { error: String(e) }), { title: t('common.error'), danger: true });
                      }
                    }}
                    className="flex items-center gap-2 px-3 py-2 w-full text-xs text-left hover:bg-white/5"
                    style={{ color:'var(--color-text-secondary)' }}>
                    <Link2 className="w-3.5 h-3.5 shrink-0" />{t('instancePage.shortcut')}
                  </button>
                  <button
                    onClick={async () => {
                      setHeaderMenu(false);
                      try { await invoke('open_instance_folder', { id: inst.id }); } catch {}
                    }}
                    className="flex items-center gap-2 px-3 py-2 w-full text-xs text-left hover:bg-white/5"
                    style={{ color:'var(--color-text-secondary)' }}>
                    <Folder className="w-3.5 h-3.5 shrink-0" />{t('instancePage.openFolder')}
                  </button>
                  <button
                    onClick={async () => {
                      setHeaderMenu(false);
                      try {
                                                const exported = await invoke<string>('export_instance_mrpack', { id: inst.id, destPath: '' });
                         await invoke('reveal_file_path', { path: exported }).catch(() => {});
                         dialog.alert(t('instancePage.exported', { path: exported }), { title: t('instancePage.exportComplete') });

                      } catch (e) { dialog.alert(t('instancePage.exportFailed', { error: String(e) }), { title: t('common.error'), danger: true }); }
                    }}
                    className="flex items-center gap-2 px-3 py-2 w-full text-xs text-left hover:bg-white/5"
                    style={{ color:'var(--color-text-secondary)' }}>
                    <Download className="w-3.5 h-3.5 shrink-0" />{t('instancePage.exportMrpack')}
                  </button>
                  <button onClick={async () => {
                    setHeaderMenu(false);
                    try { const backup = await invoke<string>('backup_instance', { id: inst.id }); dialog.alert(t('instancePage.backupCreated', { path: backup }), { title:t('instancePage.backupComplete') }); }
                    catch (e) { dialog.alert(t('instancePage.backupFailed', { error: String(e) }), { title:t('common.error'), danger:true }); }
                  }} className="flex items-center gap-2 px-3 py-2 w-full text-xs text-left hover:bg-white/5" style={{ color:'var(--color-text-secondary)' }}><Database className="w-3.5 h-3.5 shrink-0" />{t('instancePage.backup')}</button>
                  <button onClick={async () => {
                    setHeaderMenu(false);
                    try {
                      const conflicts = await invoke<any[]>('detect_mod_conflicts', { instanceId: inst.id });
                      if (!conflicts?.length) {
                        dialog.alert(t('instancePage.noConflicts'), { title: t('instancePage.healthCheck') });
                      } else {
                        const text = conflicts.map((item: any) => `${item.mod_a ?? item.modA ?? 'Мод'} + ${item.mod_b ?? item.modB ?? 'Мод'}: ${item.reason ?? t('instancePage.checkConflicts')}`).join('\n');
                        dialog.alert(text, { title: t('instancePage.conflictSummary', { count: conflicts.length }), danger: true });
                      }
                    } catch (e) { dialog.alert(t('instancePage.conflictFailed', { error: String(e) }), { title:t('common.error'), danger:true }); }
                  }} className="flex items-center gap-2 px-3 py-2 w-full text-xs text-left hover:bg-white/5" style={{ color:'var(--color-warning)' }}><Wrench className="w-3.5 h-3.5 shrink-0" />{t('instancePage.checkConflicts')}</button>
                  <button onClick={async () => {
                    setHeaderMenu(false);
                    try { await invoke('backup_instance', { id: inst.id }); const count = await invoke<number>('set_instance_safe_mode', { instanceId: inst.id, enabled:true }); dialog.alert(t('instancePage.safeModeEnabled', { count }), { title:t('instancePage.safeMode') }); }
                    catch (e) { dialog.alert(t('instancePage.safeModeFailed', { error: String(e) }), { title:t('common.error'), danger:true }); }
                  }} className="flex items-center gap-2 px-3 py-2 w-full text-xs text-left hover:bg-white/5" style={{ color:'var(--color-warning)' }}><Shield className="w-3.5 h-3.5 shrink-0" />{t('instancePage.safeMode')}</button>
                  <div style={{ borderTop:'1px solid var(--color-border)' }} />
                  <button
                    onClick={async () => {
                      setHeaderMenu(false);
                      const ok = await dialog.confirm(
                        t('instancePage.deleteWarning'),
                        { title: t('instancePage.deleteTitle', { name: inst.name }), danger: true, confirmLabel: t('instancePage.deleteConfirm') }
                      );
                      if (ok) onDelete();
                    }}
                    className="flex items-center gap-2 px-3 py-2 w-full text-xs text-left hover:bg-red-500/10"
                    style={{ color:'var(--color-error)' }}>
                    <Trash2 className="w-3.5 h-3.5 shrink-0" />{t('instancePage.deleteInstance')}
                  </button>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex items-center gap-1 px-4 py-2 shrink-0" style={{ borderBottom:'1px solid var(--color-border)' }}>
        {TABS.filter(() => inst.modLoader !== 'bedrock').map(({ id, Icon, labelKey }) => (
          <button key={id} onClick={() => setTab(id)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold transition-all relative"
            style={tab===id ? { background:'var(--color-surface-2)',color:'var(--color-text)',border:'1px solid var(--color-border)' } : { color:'var(--color-text-secondary)' }}>
            <Icon className="w-3.5 h-3.5" />{t(`instancePage.${labelKey}`)}
            {id==='content' && unseenUpdateCount>0 && <span className="absolute -top-1 -right-1 flex h-4 min-w-4 items-center justify-center rounded-full px-1 text-[9px] font-black text-white" style={{ background:'var(--color-error)', boxShadow:'0 0 0 2px var(--color-surface)' }}>{unseenUpdateCount}</span>}
          </button>
        ))}
      </div>

      {tab==='content' && (
        <div className="flex items-center gap-2 px-4 pt-2.5 shrink-0 overflow-x-auto">
          {contentFilters.map(f => (
            <button key={f.id} onClick={() => setContentFilter(f.id)}
              className="px-3 py-1.5 rounded-full text-xs font-bold whitespace-nowrap transition-colors relative"
              style={contentFilter===f.id
                ? { background:'color-mix(in srgb, var(--color-primary) 15%, transparent)',color:'var(--color-primary)',border:'1px solid color-mix(in srgb, var(--color-primary) 40%, transparent)' }
                : { color:'var(--color-text-secondary)',border:'1px solid var(--color-border)' }}>
              {f.label}
              {f.id==='updates' && updateItems.length>0 && <span className="ml-1">({updateItems.length})</span>}
              {f.id==='disabled' && <span className="ml-1">({disabledItems.length})</span>}
            </button>
          ))}
        </div>
      )}

      {/* Toolbar */}
      <div className="flex items-center gap-2 px-4 py-2.5 shrink-0" style={{ borderBottom:'1px solid var(--color-border)' }}>
        <div className="flex-1 flex items-center gap-2 px-3 py-2 rounded-xl" style={{ background:'var(--color-surface-2)',border:'1px solid var(--color-border)' }}>
          <Search className="w-3.5 h-3.5 shrink-0" style={{ color:'var(--color-text-tertiary)' }} />
          <input className="flex-1 bg-transparent text-xs"
            placeholder={
              tab==='content'
                ? (items.length > 0 ? t('instancePage.searchProjects', { count: items.length }) : t('instancePage.searchProjectsEmpty'))
                : tab==='files' ? t('instancePage.searchFiles') : t('instancePage.searchWorlds')
            }
            value={search} onChange={e => setSearch(e.target.value)} style={{ color:'var(--color-text)' }} />
        </div>
        {/* Source filter — All / Modrinth / CurseForge / Local */}
        {tab==='content' && (
          <button
            onClick={() => {
              const order: Array<typeof sourceFilter> = ['all','modrinth','curseforge','local'];
              setSourceFilter(order[(order.indexOf(sourceFilter)+1) % order.length]);
            }}
            className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-bold transition-all"
            title={t('instancePage.sourceFilter')}
            style={{
              background: sourceFilter==='modrinth' ? 'rgba(27,217,106,0.12)'
                        : sourceFilter==='curseforge' ? 'rgba(241,100,54,0.12)'
                        : sourceFilter==='local' ? 'var(--color-surface-2)'
                        : 'var(--color-surface-2)',
              border:    `1px solid ${sourceFilter==='modrinth' ? '#1BD96A' : sourceFilter==='curseforge' ? '#F16436' : 'var(--color-border)'}`,
              color:     sourceFilter==='modrinth' ? '#1BD96A' : sourceFilter==='curseforge' ? '#F16436' : 'var(--color-text-secondary)',
            }}>
            <span className="inline-block w-2 h-2 rounded-full" style={{
              background: sourceFilter==='modrinth' ? '#1BD96A' : sourceFilter==='curseforge' ? '#F16436' : 'var(--color-text-tertiary)'
            }} />
            {sourceFilter==='all' ? t('instancePage.sourceAll') : sourceFilter==='modrinth' ? 'Modrinth' : sourceFilter==='curseforge' ? 'CurseForge' : t('instancePage.sourceLocal')}
          </button>
        )}
        {tab==='content' && (
          <button onClick={() => navigate(`/find-projects?instanceId=${inst.id}`)}
            className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-bold hover:opacity-90 transition-all"
            style={{ background:'var(--color-primary)',color:'#fff' }}>
            <Plus className="w-3.5 h-3.5" />{t('instancePage.findProjects')}
          </button>
        )}
        <input ref={fileInputRef} type="file" multiple className="hidden" onChange={handleFilesPicked} />
        {(tab==='content' || tab==='files') && (
          <button onClick={() => fileInputRef.current?.click()}
            className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-bold transition-all"
            style={{ color:'var(--color-text-secondary)',border:'1px solid var(--color-border)' }}>
            <FolderPlus className="w-3.5 h-3.5" />{t('instancePage.addFiles')}
          </button>
        )}
        {tab==='content' && updateItems.length>0 && (
          <button onClick={async () => {
            setUpdatingAll(true); setUpdateProgress({ percent: 0, message: t('instancePage.preparingUpdates') });
            try {
              await invoke('update_all_mods', { instanceId: inst.id });
              setUpdateProgress({ percent: 100, message: t('instancePage.updatesInstalled') });
              await loadContent();
            } catch (e) { setUpdateProgress({ percent: 0, message: t('instancePage.updatesFailed', { error: String(e) }) }); }
            finally { setTimeout(() => setUpdatingAll(false), 1200); }
          }} disabled={updatingAll} className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-bold disabled:opacity-60"
            style={{ background:'var(--color-primary)',color:'var(--color-primary-text)' }}>
            {updatingAll ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Download className="w-3.5 h-3.5" />}{updatingAll ? t('instancePage.updating') : t('instancePage.updateAll')}
          </button>
        )}
        <button onClick={() => { if (tab==='content') loadContent(); else if (tab==='files') loadFiles(cwd); else if (tab==='worlds') { loadWorlds(); } }}
          className="w-8 h-8 rounded-xl flex items-center justify-center hover:bg-white/5 transition-colors"
          style={{ border:'1px solid var(--color-border)',color:'var(--color-text-secondary)' }}>
          <RefreshCw className={`w-3.5 h-3.5 ${loadingContent ? 'animate-spin' : ''}`} />
        </button>
      </div>

      {tab==='content' && contentFilter==='updates' && updateItems.length>0 && (
        <div className="mx-4 mt-2 rounded-xl px-3 py-2" style={{ background:'var(--color-primary-dim)', border:'1px solid var(--color-primary)' }}>
          <div className="flex items-center justify-between gap-3"><span className="text-xs font-bold" style={{ color:'var(--color-text)' }}>Доступно обновлений: {updateItems.length}</span><span className="text-[10px]" style={{ color:'var(--color-primary)' }}>{t('instancePage.updateHint')}</span></div>
          {updateProgress && <><div className="mt-1.5 flex justify-between text-[10px]" style={{ color:'var(--color-text-secondary)' }}><span className="truncate">{updateProgress.message}</span><span>{updateProgress.percent}%</span></div><div className="mt-1 h-1 overflow-hidden rounded-full" style={{ background:'var(--color-surface)' }}><div className="h-full rounded-full transition-all" style={{ width:`${updateProgress.percent}%`, background:'var(--color-primary)' }} /></div></>}
        </div>
      )}

      {/* Content */}
      <div className="flex-1 overflow-y-auto">
        {tab==='files' ? (
          <div className="p-4"><InstanceFileEditor instanceId={inst.id} minecraftVersion={inst.minecraftVersion} onContentChanged={loadContent} /></div>
        ) : tab==='screenshots' ? (
          <InstanceScreenshotManager instanceId={inst.id} />
        ) : tab==='worlds' ? (
          <div className="p-4 space-y-2">
            {worlds.filter((w:any) => !search || w.name.toLowerCase().includes(search.toLowerCase())).map((w: any) => (
              <div key={w.folder} className="flex items-center justify-between gap-3 p-3 rounded-xl"
                style={{ background:'var(--color-surface-2)',border:'1px solid var(--color-border)' }}>
                <div className="flex items-center gap-3 min-w-0">
                  <div className="w-10 h-10 rounded-lg overflow-hidden shrink-0 flex items-center justify-center"
                    title={w.icon ? 'Превью мира из Minecraft' : 'Minecraft не создал icon.png для этого мира'}
                    style={{ background:'linear-gradient(145deg, var(--color-surface-2), var(--color-surface))', border:'1px solid var(--color-border)' }}>
                    {toIconSrc(w.icon)
                      ? <img src={toIconSrc(w.icon)} className="w-full h-full object-cover" style={{ imageRendering:'pixelated' }} alt={`Превью мира ${w.name}`} />
                      : <Globe className="w-4 h-4" style={{ color:'var(--color-text-tertiary)' }} />}
                  </div>
                  <div className="min-w-0">
                    <p className="text-sm font-semibold truncate" style={{ color:'var(--color-text)' }}>{w.name}</p>
                    <p className="text-[11px] flex items-center gap-1" style={{ color: w.hardcore ? 'var(--color-error)' : 'var(--color-text-tertiary)' }}>
                      {w.hardcore && <Skull className="w-3 h-3" />}
                      {w.hardcore ? 'Хардкор' : w.game_mode === 'creative' ? 'Творческий режим' : 'Режим выживания'}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <button onClick={() => invoke('launch_instance', { instanceId: inst.id, accessToken: user?.accessToken || '', uuid: user?.uuid, username: user?.username, provider: user?.provider, quickPlay: { world: w.folder } }).catch(()=>{})}
                    className="px-3 py-1.5 rounded-xl text-xs font-bold" style={{ background:'var(--color-primary)',color:'#fff' }}>
                    Играть
                  </button>
                  <button onClick={() => invoke('instance_delete_world', { instanceId: inst.id, folder: w.folder }).then(loadWorlds)}
                    className="p-1.5 rounded-lg" style={{ background:'rgba(231,76,60,0.1)',color:'var(--color-error)' }}>
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            ))}
            {worlds.length===0 && (
              <div className="flex flex-col items-center py-12 gap-2">
                <Globe className="w-8 h-8" style={{ color:'var(--color-text-tertiary)' }} />
                <p className="text-sm" style={{ color:'var(--color-text-secondary)' }}>Миров пока нет</p>
              </div>
            )}
          </div>
        ) : tab==='logs' ? (
          <InlineLogsPanel instanceId={inst.id} />
        ) : (
          <table className="w-full">
            <thead style={{ borderBottom:'1px solid var(--color-border)' }}>
              <tr>
                {['Project','Version',''].map((h,i) => (
                  <th key={i} className={`text-[10px] font-bold uppercase tracking-widest px-4 py-2.5 ${h===''?'text-right':'text-left'}`}
                    style={{ color:'var(--color-text-tertiary)' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {items.length===0 ? (
                <tr><td colSpan={3} className="text-center py-12">
                  <div className="flex flex-col items-center gap-3">
                    <Package className="w-10 h-10" style={{ color:'var(--color-text-tertiary)' }} />
                    <p className="text-sm" style={{ color:'var(--color-text-secondary)' }}>{search?'No matches':`No ${tab} installed`}</p>
                  </div>
                </td></tr>
              ) : items.map(item => (
                <ContentRow key={item.id} item={item} onToggle={() => toggle(item.id)} onDelete={() => del(item.id)}
                  onShowInFolder={() => invoke('instance_open_dir', {
                    instanceId: inst.id,
                    path: item.mod_type==='shaderpack' ? 'shaderpacks' : item.mod_type==='resourcepack' ? 'resourcepacks' : item.mod_type==='datapack' ? 'datapacks' : 'mods',
                  }).catch(() => {})} />
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Logs modal */}
      <AnimatePresence>
        {showLogs && (
          <GameLogsModal instanceId={inst.id} onClose={() => setShowLogs(false)} />
        )}
      </AnimatePresence>
    </div>
  );
}

// ── Main ──────────────────────────────────────────────────────────────────────
function LibraryImportState({ fileName }: { fileName: string }) {
  return (
    <div className="flex h-full flex-col items-center justify-center p-6 text-center">
      <div className="flex h-16 w-16 items-center justify-center rounded-3xl" style={{ background:'var(--color-primary-dim)', border:'1px solid var(--color-primary)', color:'var(--color-primary)' }}>
        <Upload className="h-7 w-7 animate-pulse" />
      </div>
      <p className="mt-5 text-base font-black" style={{ color:'var(--color-text)' }}>Пожалуйста, подождите…</p>
      <p className="mt-1 max-w-md text-sm leading-relaxed" style={{ color:'var(--color-text-secondary)' }}>
        «{fileName}» передан лаунчеру и читается. Исходный файл остаётся без изменений; затем откроется manifest и начнётся установка.
      </p>
      <div className="mt-5 h-1.5 w-52 overflow-hidden rounded-full" style={{ background:'var(--color-surface-2)' }}>
        <div className="h-full w-2/5 rounded-full animate-pulse" style={{ background:'var(--color-primary)' }} />
      </div>
    </div>
  );
}

function DeletedInstancesPanel({ onBack, onRestore }: { onBack: () => void; onRestore: (raw: any) => void }) {
  const retentionMinutes = useSettingsStore(s => s.deletedInstanceRetentionMinutes);
  const [items, setItems] = useState<DeletedInstanceRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const load = useCallback(async () => {
    setLoading(true);
    try { setItems(await invoke<DeletedInstanceRecord[]>('list_deleted_instances', { retentionMinutes })); }
    catch { setItems([]); }
    finally { setLoading(false); }
  }, [retentionMinutes]);
  useEffect(() => { void load(); }, [load]);
  const removePermanently = async (item: DeletedInstanceRecord) => {
    const accepted = await dialog.confirm(`Сборка «${item.instance.name}» и её файлы будут удалены без возможности восстановления.`, { title:'Удалить навсегда?', danger:true, confirmLabel:'Удалить навсегда' });
    if (!accepted) return;
    await invoke('permanently_delete_instance', { recoveryId: item.recovery_id });
    await load();
  };
  const restore = async (item: DeletedInstanceRecord) => {
    try { onRestore(await invoke<any>('restore_deleted_instance', { recoveryId: item.recovery_id })); }
    catch (error) { dialog.alert(`Не удалось восстановить сборку: ${String(error)}`, { title:'Восстановление', danger:true }); }
  };
  return (
    <div className="h-full overflow-y-auto p-6">
      <div className="mb-6 flex items-center gap-3"><button onClick={onBack} className="flex h-9 w-9 items-center justify-center rounded-xl" style={{ color:'var(--color-text-secondary)', border:'1px solid var(--color-border)' }}><ArrowLeft className="h-4 w-4" /></button><div className="min-w-0 flex-1"><h1 className="font-display text-lg font-black" style={{ color:'var(--color-text)' }}>Удалённые сборки</h1><p className="mt-0.5 text-xs" style={{ color:'var(--color-text-secondary)' }}>Здесь хранятся только реально удалённые сборки. Срок восстановления настраивается в Настройки → Дополнительно.</p></div><button onClick={() => void load()} className="flex h-9 w-9 items-center justify-center rounded-xl" style={{ color:'var(--color-text-secondary)', border:'1px solid var(--color-border)' }}><RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} /></button></div>
      {loading ? <div className="py-20 text-center text-sm" style={{ color:'var(--color-text-secondary)' }}>Проверяю удалённые сборки…</div> : items.length === 0 ? <div className="flex flex-col items-center justify-center gap-3 py-24 text-center"><div className="flex h-16 w-16 items-center justify-center rounded-3xl" style={{ background:'var(--color-surface-2)', border:'1px solid var(--color-border)' }}><Trash className="h-7 w-7" style={{ color:'var(--color-text-tertiary)' }} /></div><p className="text-sm font-bold" style={{ color:'var(--color-text)' }}>Удалённых сборок нет</p><p className="max-w-sm text-xs leading-relaxed" style={{ color:'var(--color-text-secondary)' }}>Когда вы удалите сборку из библиотеки, она появится здесь и будет доступна для восстановления до срока автоочистки.</p></div> : <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">{items.map(item => <div key={item.recovery_id} className="rounded-2xl p-4" style={{ background:'var(--color-surface-2)', border:'1px solid var(--color-border)' }}><div className="flex items-start gap-3"><div className="flex h-11 w-11 shrink-0 items-center justify-center overflow-hidden rounded-xl text-sm font-black" style={{ background:`${item.instance.color || '#6C5CE7'}1A`, color:item.instance.color || 'var(--color-primary)' }}>{item.instance.icon ? <img src={toIconSrc(item.instance.icon)} className="h-full w-full object-cover" alt="" /> : item.instance.name?.[0]?.toUpperCase()}</div><div className="min-w-0 flex-1"><p className="truncate text-sm font-black" style={{ color:'var(--color-text)' }}>{item.instance.name}</p><p className="mt-0.5 text-[10px]" style={{ color:'var(--color-text-secondary)' }}>{item.instance.mc_version} · {item.instance.loader}</p><p className="mt-1 text-[10px]" style={{ color:'var(--color-text-tertiary)' }}>Удалена: {new Date(item.deleted_at).toLocaleString()} · {Math.max(1, Math.round(item.size_bytes / 1024 / 1024))} МБ</p></div></div><div className="mt-4 flex gap-2"><button onClick={() => void restore(item)} className="flex-1 rounded-xl px-3 py-2 text-xs font-bold" style={{ background:'var(--color-primary)', color:'var(--color-primary-text)' }}>Восстановить</button><button onClick={() => void removePermanently(item)} className="rounded-xl px-3 py-2 text-xs font-bold" style={{ background:'rgba(231,76,60,0.12)', color:'var(--color-error)', border:'1px solid rgba(231,76,60,0.25)' }} title="Удалить навсегда"><Trash2 className="h-3.5 w-3.5" /></button></div></div>)}</div>}
    </div>
  );
}

export function LibraryPage() {
  const navigate = useNavigate();
  const { id: routeInstanceId } = useParams<{ id: string }>();
  const [searchParams, setSearchParams] = useSearchParams();
  const { instances, add, remove, selectedId, select: setSelectedId } = useInstanceStore();
  const [showCreate, setShowCreate] = useState(false);
  const [createInitialStep, setCreateInitialStep] = useState<CreateStep>('type');
  const [pendingImportName, setPendingImportName] = useState<string | null>(null);
  const [showDeleted, setShowDeleted] = useState(false);

  useEffect(() => {
    if (searchParams.get('create') === '1') {
      setShowCreate(true);
      searchParams.delete('create');
      setSearchParams(searchParams, { replace: true });
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const openCreate = () => setShowCreate(true);
    window.addEventListener('portal:new-instance', openCreate);
    return () => window.removeEventListener('portal:new-instance', openCreate);
  }, []);

  useEffect(() => {
    // Сетка сборок — теперь стартовый экран (как в референсе), поэтому
    // ничего не выбираем автоматически. Единственный случай для сброса —
    // если выбранная сборка была удалена.
    if (selectedId && !instances.find(i => i.id === selectedId)) {
      setSelectedId(null);
    }
  }, [instances, selectedId, setSelectedId]);

  useEffect(() => {
    if (routeInstanceId && instances.some(instance => instance.id === routeInstanceId)) {
      setSelectedId(routeInstanceId);
    } else if (!routeInstanceId) {
      setSelectedId(null);
    }
  }, [instances, routeInstanceId, setSelectedId]);

  const handleCreated = (raw: any) => {
    const inst: Instance = {
      id: raw.id,
      name: raw.name,
      description: raw.description||'',
      iconPath: raw.icon||undefined,
      minecraftVersion: raw.mc_version||'1.21.1',
      modLoader: raw.loader||'fabric',
      modLoaderVersion: raw.loader_version||'',
      minRam: raw.min_ram||1024,
      maxRam: raw.max_ram||4096,
      gameDir: raw.id||'',
      createdAt: raw.created_at||new Date().toISOString(),
      totalPlayTime: 0,
      color: ['#6C5CE7','#E74C3C','#2ECC71','#3498DB','#F39C12'][Math.floor(Math.random()*5)],
    };
    setPendingImportName(null);
    add(inst); setSelectedId(inst.id); navigate(`/library/${inst.id}`);
  };

  const handleDelete = async (id: string) => {
    try { await invoke('delete_instance', { id }); } catch { /* best-effort */ }
    remove(id);
    if (selectedId === id) {
      const remaining = instances.filter(i => i.id !== id);
      setSelectedId(remaining[0]?.id ?? null);
    }
  };

  return (
    <div className="h-full flex overflow-hidden">
      <div className="flex-1 min-w-0 overflow-hidden">
        {showDeleted ? (
          <DeletedInstancesPanel onBack={() => setShowDeleted(false)} onRestore={handleCreated} />
        ) : pendingImportName ? (
          <LibraryImportState fileName={pendingImportName} />
        ) : selectedId && instances.find(i => i.id===selectedId) ? (
          <InstanceDetail
            inst={instances.find(i => i.id===selectedId)!}
            onDelete={() => handleDelete(selectedId!)}
            onBack={() => { setSelectedId(null); navigate('/library'); }}
          />
        ) : (
          <LibraryGrid
            instances={instances}
            onSelect={(id) => { setSelectedId(id); navigate(`/library/${id}`); }}
            onNew={() => { setCreateInitialStep('type'); setShowCreate(true); }}
            onOpenInstall={() => { setCreateInitialStep('install'); setShowCreate(true); }}
            onOpenDeleted={() => setShowDeleted(true)}
            onExtraGroups={[]}
            onImported={handleCreated}
            onImportStarted={setPendingImportName}
            onImportFailed={() => setPendingImportName(null)}
          />
        )}
      </div>
      <AnimatePresence>
        {showCreate && <CreateModal initialStep={createInitialStep} onClose={() => setShowCreate(false)} onCreated={handleCreated} />}
      </AnimatePresence>
    </div>
  );
}

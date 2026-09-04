import { useParams, useNavigate, useLocation } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import {
  ChevronLeft, ChevronRight, Download, Star, Calendar, Code, Camera,
  ExternalLink, Zap, X, Check, AlertCircle, TriangleAlert,
} from 'lucide-react';
import { useState, useEffect } from 'react';
import { invoke } from '@/lib/invoke-shim';
import { toIconSrc } from '@/lib/icon-src';
import { listen } from '@tauri-apps/api/event';
import { useInstanceStore } from '@/stores/instanceStore';
import type { Instance } from '@/stores/instanceStore';
import { useSettingsStore } from '@/stores/settingsStore';
import { useInstalledStore, useIsInstalled } from '@/stores/installedStore';
import { triggerInstallEffect } from '@/components/InstallEffectOverlay';
import { ModpackManifestPreview as SelectableManifestPreview } from '@/components/ModpackManifestPreview';
import { useAuthorAvatar } from '@/lib/author-avatar';
import { saveSearchReturn } from '@/lib/search-navigation';
import { useLaunchStore } from '@/stores/launchStore';
import { getModrinthProjectGateway, getModrinthVersionsGateway } from '@/lib/modrinth-gateway';
import modrinthWrench from '@/assets/modrinth-wrench-clean.png';
import curseforgeAnvil from '@/assets/curseforge-anvil.png';

interface ModVersion {
  id: string;
  version_number: string;
  game_versions: string[];
  loaders: string[];
  date_published: string;
  downloads: number;
  files: Array<{ url: string; filename: string; primary: boolean }>;
  mod_loader_type?: number;
  dependencies: Array<{ dependency_type: string; project_id?: string; version_id?: string }>;
}

interface ModpackPreviewEntry {
  path: string;
  name: string;
  version: string;
  author: string;
  author_url?: string;
  author_avatar_url?: string;
  icon_url?: string;
  required: boolean;
  kind: string;
}

interface ModpackPreview {
  name: string;
  version_id: string;
  minecraft_version: string;
  loader: string;
  source: string;
  author?: string;
  author_url?: string;
  author_avatar_url?: string;
  icon_url?: string;
  entries: ModpackPreviewEntry[];
}

interface ModProject {
  id: string;
  slug: string;
  title: string;
  description: string;
  body: string;
  downloads: number;
  follows: number;
  icon_url?: string;
  categories: string[];
  game_versions: string[];
  loaders: string[];
  date_modified: string;
  source_url?: string;
  project_type: string;
  color?: number;
  author?: string;
  author_url?: string;
  author_avatar_url?: string;
  gallery?: Array<{ url: string; title?: string; description?: string }>;
}

/**
 * CurseForge returns a numeric class ID, while the route state created by
 * Discover uses plural UI labels. Convert both forms to the internal content
 * type used by the installer, so packs never fall back to .minecraft/mods.
 */
function curseForgeProjectType(project: any, passedProject: any): string {
  const passed = String(passedProject?.projectType ?? '').toLowerCase();
  if (passed === 'resourcepacks') return 'resourcepack';
  if (passed === 'shaders') return 'shader';
  if (passed === 'datapacks') return 'datapack';
  if (passed === 'modpacks') return 'modpack';

  const classId = Number(project?.classId ?? project?.class_id ?? 0);
  if (classId === 12) return 'resourcepack';
  if (classId === 6552) return 'shader';
  if (classId === 5820) return 'datapack';
  if (classId === 4471) return 'modpack';

  const categories = (project?.categories ?? [])
    .map((category: any) => String(category?.name ?? category).toLowerCase())
    .join(' ');
  if (categories.includes('resource pack')) return 'resourcepack';
  if (categories.includes('shader')) return 'shader';
  if (categories.includes('data pack')) return 'datapack';
  return 'mod';
}

function InstancePickerModal({
  onClose, onSelect, modName,
}: {
  onClose: () => void;
  onSelect: (instanceId: string, mcVersion: string, loader: string) => void;
  modName: string;
}) {
  const { instances } = useInstanceStore();

  return (
    <motion.div className="fixed inset-0 z-50 flex items-center justify-center"
      style={{ background: 'rgba(0,0,0,0.72)', backdropFilter: 'blur(4px)' }}
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <motion.div className="w-full max-w-sm rounded-2xl overflow-hidden"
        style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', boxShadow: 'var(--shadow-lg)' }}
        initial={{ scale: 0.93, opacity: 0, y: 14 }} animate={{ scale: 1, opacity: 1, y: 0 }}
        transition={{ type: 'spring', stiffness: 480, damping: 34 }}>
        <div className="flex items-center justify-between px-5 py-4" style={{ borderBottom: '1px solid var(--color-border)' }}>
          <div>
            <h2 className="font-bold text-sm" style={{ color: 'var(--color-text)' }}>Install to Instance</h2>
            <p className="text-xs mt-0.5" style={{ color: 'var(--color-text-secondary)' }}>
              Pick where to install <span className="font-semibold">{modName}</span>
            </p>
          </div>
          <button onClick={onClose} className="w-7 h-7 flex items-center justify-center rounded-lg hover:bg-white/5">
            <X className="w-4 h-4" style={{ color: 'var(--color-text-secondary)' }} />
          </button>
        </div>
        <div className="p-3 space-y-1.5 max-h-72 overflow-y-auto">
          {instances.length === 0 ? (
            <p className="text-sm text-center py-8" style={{ color: 'var(--color-text-secondary)' }}>
              No instances found. Create one first.
            </p>
          ) : instances.map(inst => (
            <button key={inst.id}
              onClick={() => onSelect(inst.id, inst.minecraftVersion, inst.modLoader)}
              className="w-full flex items-center gap-3 p-3 rounded-xl text-left transition-all hover:scale-[1.01]"
              style={{ background: 'var(--color-surface-2)', border: '1px solid var(--color-border)' }}>
              <div className="w-9 h-9 rounded-xl flex items-center justify-center text-sm font-black shrink-0"
                style={{ background: `${inst.color}1A`, color: inst.color }}>
                {inst.iconPath
                  ? <img src={toIconSrc(inst.iconPath)} className="w-full h-full rounded-xl object-cover" alt="" />
                  : inst.name[0]?.toUpperCase()}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold truncate" style={{ color: 'var(--color-text)' }}>{inst.name}</p>
                <p className="text-xs" style={{ color: 'var(--color-text-secondary)' }}>
                  {inst.minecraftVersion} · <span className="capitalize">{inst.modLoader}</span>
                </p>
              </div>
              <ChevronLeft className="w-4 h-4 rotate-180 shrink-0" style={{ color: 'var(--color-text-tertiary)' }} />
            </button>
          ))}
        </div>
      </motion.div>
    </motion.div>
  );
}

function DependencyAuthorAvatar({ author, source }: { author?: string; source?: string }) {
  const avatar = useAuthorAvatar(author, source);
  const initials = (author || '?').trim().slice(0, 1).toUpperCase();
  return avatar
    ? <img src={avatar} alt="" className="h-4 w-4 rounded-full object-cover" onError={e => { e.currentTarget.style.display = 'none'; }} />
    : <span className="flex h-4 w-4 items-center justify-center rounded-full text-[8px] font-black" style={{ background:'var(--color-surface-2)', color:'var(--color-text-secondary)' }}>{initials}</span>;
}

function DependencyGroup({ title, tone, entries, depInfo, navigate, contextInstanceId, contextMcVersion, contextLoader, source }: {
  title: string;
  tone: 'required' | 'optional' | 'incompatible';
  entries: ModVersion['dependencies'];
  depInfo: Record<string, { name: string; author?: string; icon_url?: string }>;
  navigate: (to: string, options?: any) => void;
  contextInstanceId: string | null;
  contextMcVersion: string;
  contextLoader: string;
  source: 'modrinth' | 'curseforge';
}) {
  const fixed = tone === 'required'
    ? { label: 'Обязательно', color: 'var(--color-warning)' }
    : tone === 'incompatible'
      ? { label: 'Несовместимо', color: 'var(--color-error)' }
      : { label: 'Дополнительно', color: 'var(--color-text-tertiary)' };
  const openAuthor = (author?: string) => {
    if (!author) return;
    const base = source === 'curseforge' ? 'https://www.curseforge.com/members/' : 'https://modrinth.com/user/';
    void invoke('open_url', { url: `${base}${encodeURIComponent(author)}` }).catch(() => window.open(`${base}${encodeURIComponent(author)}`, '_blank'));
  };
  return (
    <section style={{ borderTop:'1px solid var(--color-border)' }}>
      <div className="mb-1 flex items-center justify-between py-3">
        <p className="text-xs font-black uppercase tracking-wider" style={{ color: 'var(--color-text-secondary)' }}>{title}</p>
        <span className="text-[10px]" style={{ color: 'var(--color-text-tertiary)' }}>{entries.length}</span>
      </div>
      <div className="space-y-2">
        {entries.map((dependency, index) => {
          const info = dependency.project_id ? depInfo[dependency.project_id] : undefined;
          return (
            <div key={`${dependency.project_id ?? 'unknown'}-${index}`} className="flex items-center gap-3 py-3" style={{ background:'transparent', borderTop:index ? '1px solid var(--color-border)' : '0' }}>
              <div className="flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-sm" style={{ background: 'var(--color-surface-2)', border:'1px solid var(--color-border)' }}>
                {info?.icon_url ? <img src={info.icon_url} alt="" className="h-full w-full object-cover" onError={event => { (event.target as HTMLImageElement).style.display = 'none'; }} /> : <Code className="h-4 w-4" style={{ color: 'var(--color-text-secondary)' }} />}
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-bold" style={{ color: 'var(--color-text)' }}>{info?.name ?? dependency.project_id ?? 'Неизвестная модификация'}</p>
                <p className="flex items-center gap-1.5 truncate text-[11px]" style={{ color: 'var(--color-text-secondary)' }}><DependencyAuthorAvatar author={info?.author} source={source} />{info?.author ? <button onClick={() => openAuthor(info.author)} className="truncate text-left font-semibold hover:underline" style={{ color:'var(--color-primary)' }} title={`Открыть автора ${info.author}`}>{info.author}</button> : <span className="truncate">Автор не указан</span>}</p>
                <p className="mt-0.5 text-[10px] font-bold" style={{ color: fixed.color }}>{fixed.label}</p>
              </div>
              {dependency.project_id && <button onClick={() => navigate(`/discover/modrinth/${dependency.project_id}`, { state: contextInstanceId ? { contextInstanceId, contextMcVersion, contextLoader } : undefined })} className="flex shrink-0 items-center gap-1 text-xs font-bold" style={{ color: 'var(--color-text-secondary)' }}><ExternalLink className="h-3 w-3" />Открыть</button>}
            </div>
          );
        })}
      </div>
    </section>
  );
}

function ModpackPreviewModal({ preview, onClose, onInstall }: { preview: ModpackPreview; onClose: () => void; onInstall: () => void }) {
  const grouped = ['mod', 'resourcepack', 'shaderpack', 'datapack'].map(kind => ({
    kind,
    label: kind === 'mod' ? 'Моды' : kind === 'resourcepack' ? 'Ресурс-паки' : kind === 'shaderpack' ? 'Шейдеры' : 'Дата-паки',
    entries: preview.entries.filter(entry => entry.kind === kind),
  })).filter(group => group.entries.length > 0);
  return (
    <motion.div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background:'rgba(0,0,0,0.75)', backdropFilter:'blur(6px)' }} initial={{ opacity:0 }} animate={{ opacity:1 }} exit={{ opacity:0 }} onClick={e => { if (e.target===e.currentTarget) onClose(); }}>
      <motion.div className="w-full max-w-2xl rounded-2xl overflow-hidden" style={{ background:'var(--color-surface)', border:'1px solid var(--color-border)', boxShadow:'var(--shadow-lg)' }} initial={{ opacity:0, y:12, scale:0.97 }} animate={{ opacity:1, y:0, scale:1 }} exit={{ opacity:0, y:12, scale:0.97 }}>
        <div className="px-5 py-4 flex items-start justify-between" style={{ borderBottom:'1px solid var(--color-border)' }}>
          <div className="min-w-0 flex-1"><p className="text-[10px] font-black uppercase tracking-wider" style={{ color:'var(--color-primary)' }}>Предпросмотр установки</p><div className="mt-1 flex items-center gap-3"><div className="flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-xl" style={{ background:'var(--color-surface-2)' }}>{preview.icon_url ? <img src={preview.icon_url} alt="" className="h-full w-full object-cover" /> : <Code className="h-4 w-4" style={{ color:'var(--color-primary)' }} />}</div><div className="min-w-0"><h2 className="truncate font-black text-lg" style={{ color:'var(--color-text)' }}>{preview.name}</h2>{preview.author && <div className="flex items-center gap-1.5 text-[11px]" style={{ color:'var(--color-text-secondary)' }}><span className="flex h-4 w-4 shrink-0 items-center justify-center overflow-hidden rounded-full" style={{ background:'var(--color-surface-2)' }}>{preview.author_avatar_url ? <img src={preview.author_avatar_url} alt="" className="h-full w-full object-cover" onError={e => { e.currentTarget.style.display = 'none'; }} /> : preview.author.trim().slice(0, 1).toUpperCase()}</span>{preview.author_url ? <a href={preview.author_url} target="_blank" rel="noreferrer" className="font-semibold hover:underline" style={{ color:'var(--color-primary)' }}>{preview.author}</a> : <span>{preview.author}</span>}</div>}</div></div><p className="text-xs mt-2" style={{ color:'var(--color-text-secondary)' }}>{preview.minecraft_version} · {preview.loader} · {preview.entries.length} файлов из манифеста</p></div>
          <button onClick={onClose} className="w-8 h-8 rounded-xl flex items-center justify-center" style={{ background:'var(--color-surface-2)', color:'var(--color-text-secondary)' }}><X className="w-4 h-4" /></button>
        </div>
        <div className="max-h-[52vh] overflow-y-auto p-3 space-y-4">
          {grouped.map(group => (
            <section key={group.kind}>
              <div className="flex items-center justify-between mb-1.5 px-1"><p className="text-[10px] font-black uppercase tracking-wider" style={{ color:'var(--color-primary)' }}>{group.label}</p><span className="text-[10px]" style={{ color:'var(--color-text-tertiary)' }}>{group.entries.length}</span></div>
              <div className="space-y-1.5">
                {group.entries.map((entry, index) => (
                  <div key={`${entry.path}-${index}`} className="flex items-center gap-3 p-2.5 rounded-xl" style={{ background:'var(--color-surface-2)', border:'1px solid var(--color-border)' }}>
                    <div className="w-9 h-9 rounded-lg overflow-hidden flex items-center justify-center shrink-0" style={{ background:'var(--color-surface)' }}>{entry.icon_url ? <img src={entry.icon_url} className="w-full h-full object-cover" alt="" /> : <Code className="w-4 h-4" style={{ color:'var(--color-primary)' }} />}</div>
                    <div className="flex-1 min-w-0"><p className="text-sm font-bold truncate" style={{ color:'var(--color-text)' }}>{entry.name}</p><div className="flex min-w-0 items-center gap-1.5 text-[10px]" style={{ color:'var(--color-text-secondary)' }}><span className="flex h-4 w-4 shrink-0 items-center justify-center overflow-hidden rounded-full" style={{ background:'var(--color-surface)' }}>{entry.author_avatar_url ? <img src={entry.author_avatar_url} alt="" className="h-full w-full object-cover" onError={event => { (event.target as HTMLImageElement).style.display = 'none'; }} /> : <span className="text-[8px] font-black">{entry.author?.trim().slice(0, 1).toUpperCase() || '?'}</span>}</span>{entry.author_url ? <a href={entry.author_url} target="_blank" rel="noreferrer" className="truncate font-semibold hover:underline" style={{ color:'var(--color-primary)' }}>{entry.author}</a> : <span className="truncate">{entry.author || 'Автор не указан'}</span>}<span>· {entry.version}</span></div></div>
                    {!entry.required && <span className="text-[9px] font-bold px-1.5 py-1 rounded-md" style={{ color:'var(--color-warning)', background:'rgba(243,156,18,0.12)' }}>НЕОБЯЗАТЕЛЬНО</span>}
                  </div>
                ))}
              </div>
            </section>
          ))}
        </div>
        <div className="px-5 py-4 flex justify-end gap-2" style={{ borderTop:'1px solid var(--color-border)' }}><button onClick={onClose} className="px-4 py-2 rounded-xl text-sm font-semibold" style={{ background:'var(--color-surface-2)', color:'var(--color-text-secondary)', border:'1px solid var(--color-border)' }}>Назад</button><button onClick={onInstall} className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-bold" style={{ background:'var(--color-primary)', color:'var(--color-primary-text)' }}><Download className="w-4 h-4" />Установить модпак</button></div>
      </motion.div>
    </motion.div>
  );
}

function ProjectScreenshots({ items, instanceId }: { items: Array<{ url: string; title?: string; description?: string }>; instanceId?: string | null }) {
  const [selected, setSelected] = useState<number | null>(null);
  const [downloading, setDownloading] = useState<'downloads' | 'instance' | null>(null);
  const [downloadStatus, setDownloadStatus] = useState('');
  const move = (direction: -1 | 1) => setSelected(current => current === null ? current : (current + direction + items.length) % items.length);
  const saveSelected = async (destination: 'downloads' | 'instance') => {
    if (selected === null) return;
    setDownloading(destination); setDownloadStatus('');
    try {
      const item = items[selected];
      const path = await invoke<string>('download_project_screenshot', { url:item.url, fileName:item.title || `project-screenshot-${selected + 1}`, instanceId:destination === 'instance' ? instanceId : null });
      setDownloadStatus(`Сохранено: ${path}`);
    } catch (error) { setDownloadStatus(`Не удалось скачать: ${String(error)}`); }
    finally { setDownloading(null); }
  };
  if (!items.length) return (
    <div className="flex flex-col items-center justify-center rounded-2xl p-12 text-center" style={{ background: 'var(--color-surface-2)', border: '1px dashed var(--color-border)' }}>
      <Camera className="mb-3 h-8 w-8" style={{ color: 'var(--color-text-tertiary)' }} />
      <p className="text-sm font-bold" style={{ color: 'var(--color-text)' }}>Скриншоты отсутствуют</p>
      <p className="mt-1 max-w-sm text-xs" style={{ color: 'var(--color-text-secondary)' }}>Автор ещё не добавил скриншоты к этому проекту.</p>
    </div>
  );
  return (
    <>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {items.map((item, index) => (
          <button key={`${item.url}-${index}`} type="button" onClick={() => setSelected(index)} className="group overflow-hidden rounded-sm text-left transition-colors" style={{ background:'transparent', border:'1px solid var(--color-border)' }}>
            <div className="aspect-video overflow-hidden" style={{ background:'var(--color-bg)' }}><img src={item.url} alt={item.title || 'Скриншот модификации'} className="h-full w-full object-cover transition-transform duration-200 group-hover:scale-[1.02]" /></div>
            {(item.title || item.description) && <div className="p-3"><p className="truncate text-xs font-bold" style={{ color:'var(--color-text)' }}>{item.title || 'Скриншот'}</p>{item.description && <p className="mt-1 line-clamp-2 text-[11px]" style={{ color:'var(--color-text-secondary)' }}>{item.description}</p>}</div>}
          </button>
        ))}
      </div>
      <AnimatePresence>
        {selected !== null && (
          <motion.div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/80 p-5" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setSelected(null)}>
            <motion.div className="relative max-h-full max-w-5xl overflow-hidden rounded-2xl" initial={{ scale: 0.96, y: 10 }} animate={{ scale: 1, y: 0 }} onClick={event => event.stopPropagation()} style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)' }}>
              <div className="relative flex items-center justify-center"><img src={items[selected].url} alt={items[selected].title || 'Скриншот модификации'} className="max-h-[72vh] max-w-[88vw] object-contain" />{items.length > 1 && <><button type="button" onClick={event => { event.stopPropagation(); move(-1); }} className="absolute left-3 top-1/2 z-10 flex h-10 w-10 -translate-y-1/2 items-center justify-center rounded-sm" style={{ background:'var(--color-bg)', color:'var(--color-text)', border:'1px solid var(--color-border)' }} title="Предыдущий скриншот" aria-label="Предыдущий скриншот"><ChevronLeft className="h-5 w-5" /></button><button type="button" onClick={event => { event.stopPropagation(); move(1); }} className="absolute right-3 top-1/2 z-10 flex h-10 w-10 -translate-y-1/2 items-center justify-center rounded-sm" style={{ background:'var(--color-bg)', color:'var(--color-text)', border:'1px solid var(--color-border)' }} title="Следующий скриншот" aria-label="Следующий скриншот"><ChevronRight className="h-5 w-5" /></button></>}</div>
              <div className="flex flex-wrap items-center justify-between gap-2 p-3"><span className="min-w-0 flex-1 truncate text-xs font-bold" style={{ color: 'var(--color-text)' }}>{items[selected].title || 'Скриншот'}</span><button disabled={downloading !== null} onClick={() => void saveSelected('downloads')} className="flex items-center gap-1 rounded-sm px-2.5 py-1.5 text-xs font-bold disabled:opacity-40" style={{ background:'var(--color-primary)', color:'var(--color-primary-text)' }}><Download className="h-3.5 w-3.5" />{downloading === 'downloads' ? 'Скачиваю…' : 'В загрузки'}</button>{instanceId && <button disabled={downloading !== null} onClick={() => void saveSelected('instance')} className="flex items-center gap-1 rounded-sm px-2.5 py-1.5 text-xs font-bold disabled:opacity-40" style={{ background:'transparent', color:'var(--color-text-secondary)', border:'1px solid var(--color-border)' }}><Camera className="h-3.5 w-3.5" />В скриншоты сборки</button>}<button onClick={() => setSelected(null)} className="rounded-sm p-1.5" style={{ color: 'var(--color-text-secondary)', border:'1px solid var(--color-border)' }} aria-label="Закрыть"><X className="h-4 w-4" /></button>{downloadStatus && <p className="basis-full text-[10px]" style={{ color:downloadStatus.startsWith('Не удалось') ? 'var(--color-error)' : 'var(--color-text-secondary)' }}>{downloadStatus}</p>}</div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}

export function ModDetail() {
  const { source, modId } = useParams<{ source: string; modId: string }>();
  const navigate = useNavigate();
  const location = useLocation();

  const [project, setProject] = useState<ModProject | null>(null);
  const [versions, setVersions] = useState<ModVersion[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<'desc' | 'versions' | 'deps' | 'screenshots'>('desc');

  const [installing, setInstalling] = useState(false);
  const [installProgress, setInstallProgress] = useState(0);
  const [installMessage, setInstallMessage] = useState('');
  const [installError, setInstallError] = useState('');
  const [showPicker, setShowPicker] = useState(false);
  const [depInfo, setDepInfo] = useState<Record<string, { name: string; author?: string; icon_url?: string; game_versions?: string[]; loaders?: string[] }>>({});
  const [versionFilter, setVersionFilter] = useState<string>('');
  const [loaderFilter, setLoaderFilter] = useState<string>('');
  const [pendingVersion, setPendingVersion] = useState<ModVersion | null>(null);
  const [modpackPreview, setModpackPreview] = useState<ModpackPreview | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [runningInstallTarget, setRunningInstallTarget] = useState<{ instanceId: string; mcVersion: string; loader: string } | null>(null);

  const { instances, add: addInstance } = useInstanceStore();
  const cfApiKey = useSettingsStore(s => s.curseforgeApiKey);
  const authorAvatar = useAuthorAvatar(project?.author, source);

  const passedProject = location.state as any;
  const contextInstanceId: string | null = passedProject?.contextInstanceId ?? null;
  const contextMcVersion: string = passedProject?.contextMcVersion ?? '';
  const contextLoader: string = passedProject?.contextLoader ?? '';
  const contextInstance = contextInstanceId ? instances.find((i: { id: string }) => i.id === contextInstanceId) : null;
  const goBack = () => {
    if (passedProject?.searchOrigin?.storageKey) saveSearchReturn(passedProject.searchOrigin);
    navigate(-1);
  };

  const installed = useIsInstalled(contextInstanceId, [project?.id, project?.slug, project?.title, modId]);

  useEffect(() => {
    if (contextInstanceId) useInstalledStore.getState().refresh(contextInstanceId);
  }, [contextInstanceId]);

  useEffect(() => {
    setInstallError('');
    loadProject();
    const unsub = listen('mod-progress', (e: any) => {
      const p = e.payload;
      setInstallProgress(p.percent ?? 0);
      setInstallMessage(p.message ?? '');
    });

    return () => { unsub.then(fn => fn()); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [source, modId, contextInstanceId, cfApiKey]);

  async function loadProject() {
    setLoading(true);
    setError(null);
    try {
      if (source === 'modrinth') {
        const [proj, vers] = await Promise.all([
          getModrinthProjectGateway(modId),
          getModrinthVersionsGateway(modId),
        ]);
        setProject({
          id: proj.id,
          slug: proj.slug,
          title: proj.title,
          description: proj.description ?? '',
          body: proj.body ?? proj.description ?? '',
          downloads: proj.downloads ?? 0,
          follows: proj.followers ?? proj.follows ?? 0,
          icon_url: proj.icon_url,
          categories: proj.categories ?? [],
          game_versions: proj.game_versions ?? [],
          loaders: proj.loaders ?? [],
          date_modified: proj.updated ?? proj.date_modified ?? '',
          source_url: proj.source_url,
          project_type: proj.project_type ?? 'mod',
          color: proj.color,
          author: proj.author,
          author_url: typeof proj.author === 'string' && proj.author ? `https://modrinth.com/user/${encodeURIComponent(proj.author)}` : undefined,
          gallery: Array.isArray(proj.gallery) ? proj.gallery.map((item: any) => ({ url: item.url ?? item.image_url, title: item.title, description: item.description })).filter((item: any) => item.url) : [],
        });
        setVersions(Array.isArray(vers) ? vers : []);
      } else if (source === 'curseforge') {
        // ВАЖНО: modId из URL — это slug ("iris", "sodium" и т.п.), потому что
        // навигация с карточки всегда использует p.slug. Modrinth принимает
        // slug вместо id, а вот CurseForge API — НЕТ, ему нужен числовой id.
        // Раньше тут стоял Number(modId), и для любого некорректно
        // распознаваемого modId (не число) это давало NaN → ошибка "modID".
        // Настоящий числовой id уже есть в location.state (передаётся с
        // карточки поиска) — берём его в приоритете.
        const numericId = Number(passedProject?.id) || Number(modId);
        if (!numericId || Number.isNaN(numericId)) {
          throw new Error('Не удалось определить ID мода CurseForge — откройте его заново со страницы поиска.');
        }
        const [proj, filesResp] = await Promise.all([
          invoke<any>('get_curseforge_mod', { projectId: numericId, apiKey: cfApiKey }),
          invoke<any>('get_curseforge_mod_files', { modId: numericId, apiKey: cfApiKey }),
        ]);
        const rawFiles: any[] = Array.isArray(filesResp?.data) ? filesResp.data : [];
        const isMcVersion = (str: string) => /^\d+\.\d+/.test(str);
          const mapped: ModVersion[] = rawFiles.map((f: any) => {
            const gv: string[] = Array.isArray(f.gameVersions) ? f.gameVersions : [];
            const mcVers = gv.filter(isMcVersion);
            const modLoaderType = Number(f.modLoaderType ?? 0);
            const cfLoaderName: Record<number, string> = { 1: 'forge', 4: 'fabric', 5: 'quilt', 6: 'neoforge' };
            const loaders = cfLoaderName[modLoaderType] ? [cfLoaderName[modLoaderType]] : gv.filter(v => !isMcVersion(v)).map(v => v.toLowerCase());
          let url: string | null = (f.downloadUrl as string) ?? null;
          if (!url && f.id && f.fileName) {
            const idStr = String(f.id);
            url = `https://edge.curseforgecdn.com/files/${idStr.slice(0, 4)}/${idStr.slice(4).replace(/^0+/, '')}/${f.fileName}`;
          }
          return {
            id: String(f.id),
            version_number: f.displayName ?? f.fileName ?? '',
            game_versions: mcVers,
            loaders,
            date_published: f.fileDate ?? '',
            downloads: f.downloadCount ?? 0,
            files: url ? [{ url, filename: f.fileName ?? 'mod.jar', primary: true }] : [],
            mod_loader_type: modLoaderType,
            dependencies: (f.dependencies ?? []).map((d: any) => ({
              dependency_type: d.relationType === 3 ? 'required' : 'optional',
              project_id: d.modId != null ? String(d.modId) : undefined,
            })),
          };
        });
        setProject({
          id: String(proj.id ?? modId),
          slug: proj.slug ?? '',
          title: proj.name ?? passedProject?.title ?? 'Mod',
          description: proj.summary ?? '',
          body: proj.summary ?? '',
          downloads: proj.downloadCount ?? proj.download_count ?? 0,
          follows: proj.thumbsUpCount ?? proj.thumbs_up_count ?? 0,
          icon_url: proj.logo?.thumbnail_url ?? proj.logo?.thumbnailUrl ?? proj.logo?.url ?? passedProject?.iconUrl,
          categories: (proj.categories ?? []).map((c: any) => c.name).filter(Boolean),
          game_versions: Array.from(new Set(mapped.flatMap(v => v.game_versions))),
          loaders: Array.from(new Set(mapped.flatMap(v => v.loaders))),
          date_modified: proj.dateModified ?? '',
          source_url: proj.links?.websiteUrl,
          project_type: curseForgeProjectType(proj, passedProject),
          author: proj.authors?.[0]?.name ?? passedProject?.author,
          author_url: proj.authors?.[0]?.url ?? (proj.authors?.[0]?.name ? `https://www.curseforge.com/members/${encodeURIComponent(proj.authors[0].name)}` : undefined),
          author_avatar_url: proj.authors?.[0]?.avatarUrl,
          gallery: Array.isArray(proj.screenshots) ? proj.screenshots.map((item: any) => ({ url: item.url, title: item.title, description: item.description })).filter((item: any) => item.url) : [],
        });
        setVersions(mapped);
      } else {
        if (passedProject) {
          setProject({
            id: passedProject.id,
            slug: passedProject.slug,
            title: passedProject.title,
            description: passedProject.description ?? '',
            body: passedProject.description ?? '',
            downloads: passedProject.downloads ?? 0,
            follows: passedProject.follows ?? 0,
            icon_url: passedProject.iconUrl,
            categories: passedProject.categories ?? [],
            game_versions: passedProject.gameVersions ?? [],
            loaders: passedProject.loaders ?? [],
            date_modified: passedProject.dateModified ?? '',
            project_type: passedProject.projectType ?? 'mod',
          author: passedProject.author,
          author_url: passedProject.author ? (source === 'curseforge' ? `https://www.curseforge.com/members/${encodeURIComponent(passedProject.author)}` : `https://modrinth.com/user/${encodeURIComponent(passedProject.author)}`) : undefined,
          gallery: passedProject.gallery ?? [],
          });
        } else {
          setError('CurseForge project details require an API key configured in Settings → Advanced.');
        }
      }
    } catch (e: any) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }

  const openModpackPreview = async () => {
    const packVersion = pendingVersion ?? versions[0];
    const packFile = packVersion?.files?.find(file => file.primary) ?? packVersion?.files?.[0];
    if (!packFile) { setInstallError('Для этого модпака не найден архив для скачивания.'); return; }
    setPreviewLoading(true); setInstallError('');
    try {
      const preview = await invoke<ModpackPreview>('preview_remote_modpack', { downloadUrl: packFile.url, fileName: packFile.filename, source: source ?? 'modrinth', apiKey: cfApiKey || null, projectName: project?.title ?? null, projectAuthor: project?.author ?? null, projectAuthorUrl: project?.author_url ?? null, projectAuthorAvatarUrl: project?.author_avatar_url ?? null, projectIconUrl: project?.icon_url ?? null });
      setModpackPreview(preview);
    } catch (error: any) {
      setInstallError(String(error));
    } finally { setPreviewLoading(false); }
  };

  const doInstallModpack = async (excludedPaths: string[] = []) => {
    setInstalling(true);
    setInstallError('');
    setInstallProgress(5);
    setInstallMessage('Downloading modpack archive…');
    try {
      const packVersion = pendingVersion ?? versions[0];
      const packFile = packVersion?.files?.find(f => f.primary) ?? packVersion?.files?.[0];
      if (!packFile) throw new Error('Для этого модпака не найден архив для скачивания.');

      // Модпак — это не один мод. Нативный импортёр скачивает архив,
      // читает manifest/modrinth.index.json, создаёт сборку и ставит всё
      // содержимое: mods, resourcepacks, shaderpacks, datapacks и overrides.
      const raw = await invoke<any>('import_remote_modpack', {
        downloadUrl: packFile.url,
        fileName: packFile.filename,
        source: source ?? 'modrinth',
        apiKey: cfApiKey || null,
        excludedPaths,
        projectIconUrl: project?.icon_url ?? null,
        projectScreenshots: (project?.gallery ?? []).map(item => item.url).filter(Boolean),
      });
      const storeInst: Instance = {
        id: raw.id,
        name: raw.name,
        description: raw.description ?? project?.description ?? '',
        minecraftVersion: raw.mc_version,
        modLoader: raw.loader,
        modLoaderVersion: raw.loader_version ?? '',
        minRam: raw.min_ram ?? 2048,
        maxRam: raw.max_ram ?? 6144,
        gameDir: raw.id,
        iconPath: raw.icon ?? undefined,
        createdAt: raw.created_at ?? new Date().toISOString(),
        totalPlayTime: raw.play_time_minutes ?? 0,
        color: raw.color ?? '#6C5CE7',
      };
      addInstance(storeInst);
      setPendingVersion(null);
      setInstallProgress(100);
      setInstallMessage('Modpack installed!');
    } catch (e: any) {
      setInstallError(String(e));
    } finally {
      setInstalling(false);
    }
  };

  // Выбирает НОВЕЙШУЮ версию мода, совместимую и с загрузчиком, и со сборкой MC.
  // Это защищает от установки, например, "26.2 fabric" в forge-инстанс 1.20.1.
  // ВАЖНО: фильтр по загрузчику применяется только к обычным модам — у
  // ресурспаков/шейдеров/датапаков нет тега fabric/forge/quilt вообще, и если
  // всё равно требовать совпадение по loader, подходящих версий не найдётся
  // никогда, даже если они реально совместимы по версии игры.
  const pickNewest = (
    list: ModVersion[],
    mcVersion: string,
    loader: string,
  ): ModVersion | null => {
    const loaderRelevant = (project?.project_type ?? 'mod') === 'mod';
    const loaderOk = (v: ModVersion) =>
      !loaderRelevant || !loader || loader === 'vanilla' || (v.loaders ?? []).includes(loader);
    const mcOk = (v: ModVersion) =>
      !mcVersion || (v.game_versions ?? []).includes(mcVersion);
    const matches = list.filter(v => loaderOk(v) && mcOk(v) && (v.files ?? []).some(file => Boolean(file.url)));
    matches.sort(
      (a, b) =>
        new Date(b.date_published).getTime() - new Date(a.date_published).getTime(),
    );
    // Resource packs and shaders often omit a patch-level Minecraft tag even
    // though the archive is valid. Do not report a false failure when the
    // project is non-loader content and there is a downloadable release.
    if (matches[0]) return matches[0];
    if (!loaderRelevant) {
      const downloadable = list
        .filter(v => (v.files ?? []).some(file => Boolean(file.url)))
        .sort((a, b) => new Date(b.date_published).getTime() - new Date(a.date_published).getTime());
      return downloadable[0] ?? null;
    }
    return null;
  };

  // Скачивает и устанавливает КОНКРЕТНУЮ версию мода (используется кнопками на
  // вкладке "Versions" и как финальный шаг подбора новейшей версии).
  const runInstall = async (instanceId: string, bestVersion: ModVersion) => {
    if (!bestVersion?.files?.length) {
      throw new Error('Для этой версии не найден файл для скачивания.');
    }
    const primaryFile = bestVersion.files.find(f => f.primary) ?? bestVersion.files[0];
    const rawType = project?.project_type ?? 'mod';
    const modType =
      rawType === 'shader' || rawType === 'shaders' || rawType === 'shaderpack' || rawType === 'shaderpacks'
        ? 'shaderpack'
        : rawType === 'resourcepack' || rawType === 'resourcepacks'
          ? 'resourcepack'
          : rawType === 'datapack' || rawType === 'datapacks'
            ? 'datapack'
            : 'mod';

    await invoke('install_mod', {
      instanceId,
      downloadUrl: primaryFile.url,
      fileName: primaryFile.filename,
      modId: project?.id ?? modId ?? '',
      modName: project?.title ?? '',
      modVersion: bestVersion.version_number,
      versionId: bestVersion.id,
      source: source ?? 'modrinth',
      modType,
      projectId: project?.id,
      author: project?.author ?? null,
      iconUrl: project?.icon_url ?? null,
    });

    useInstalledStore.getState().mark(instanceId, [project?.id, project?.slug, project?.title, modId]);
    triggerInstallEffect({
      name: project?.title ?? 'Content',
      iconUrl: project?.icon_url ?? null,
      contentType: modType,
    });
    setInstallProgress(100);
    setInstallMessage('Установлено');
  };

  const doInstall = async (instanceId: string, mcVersion: string, loader: string, confirmedWhileRunning = false) => {
    if (!confirmedWhileRunning && useLaunchStore.getState().getStatus(instanceId) === 'running') {
      setRunningInstallTarget({ instanceId, mcVersion, loader });
      return;
    }
    setRunningInstallTarget(null);
    setShowPicker(false);
    setInstalling(true);
    setInstallError('');
    setInstallProgress(5);
    setInstallMessage('Finding newest compatible version…');
    try {
      if (source === 'modrinth' && (project?.project_type ?? 'mod') === 'mod') {
        const compatibility = await invoke<any>('check_mod_compatibility', { instanceId, projectId: project?.id ?? modId ?? '' });
        if (!compatibility?.compatible) throw new Error(compatibility?.message ?? 'This mod is not compatible with the selected Minecraft version or loader.');
      }
      // Если пользователь выбрал конкретную версию со страницы мода — ставим именно её.
      if (pendingVersion) {
        await runInstall(instanceId, pendingVersion);
        setPendingVersion(null);
        return;
      }

      let bestVersion: ModVersion | null = null;

      if (source === 'modrinth') {
        // Спрашиваем у Modrinth только версии под этот загрузчик и сборку MC —
        // но только для модов; ресурспаки/шейдеры/датапаки грузчиком не тегируются.
        const loaderRelevant = (project?.project_type ?? 'mod') === 'mod';
        const filtered = await getModrinthVersionsGateway(
          project?.id ?? modId ?? '',
          mcVersion || undefined,
          loaderRelevant && loader !== 'vanilla' ? loader : undefined,
        );
        const arr: ModVersion[] = Array.isArray(filtered) ? filtered : [];
        bestVersion =
          pickNewest(arr, mcVersion, loader) ??
          pickNewest(versions, mcVersion, loader);
      } else {
        const CF_LOADER_MAP: Record<string, number> = { forge: 1, fabric: 4, quilt: 5, neoforge: 6 };
        const curseforgeType = project?.project_type ?? passedProject?.project_type ?? 'mod';
        const nonModContent = ['resourcepack', 'resourcepacks', 'shader', 'shaders', 'shaderpack', 'shaderpacks'].includes(curseforgeType);
        // CurseForge does not consistently attach mod-loader indexes to texture
        // and shader packs. Never ask its file endpoint for Forge/Fabric/etc.
        // on these two content types; ordinary mods retain the current filter.
        const loaderNum = !nonModContent && loader && loader !== 'vanilla' ? CF_LOADER_MAP[loader] : undefined;
        try {
          const filesResp = await invoke<any>('get_curseforge_mod_files', {
            modId: Number(modId) || Number(passedProject?.id),
            gameVersion: mcVersion || undefined,
            modLoaderType: loaderNum,
            apiKey: cfApiKey,
          });
          const rawFiles: any[] = Array.isArray(filesResp?.data) ? filesResp.data : [];
          const isMcVersion = (str: string) => /^\d+\.\d+/.test(str);
          const cfLoaderName: Record<number, string> = { 1: 'forge', 4: 'fabric', 5: 'quilt', 6: 'neoforge' };
          const filtered: ModVersion[] = rawFiles.map((f: any) => {
            const gv: string[] = Array.isArray(f.gameVersions) ? f.gameVersions : [];
            let url: string | null = (f.downloadUrl as string) ?? null;
            if (!url && f.id && f.fileName) {
              const idStr = String(f.id);
              url = `https://edge.curseforgecdn.com/files/${idStr.slice(0, 4)}/${idStr.slice(4).replace(/^0+/, '')}/${f.fileName}`;
            }
            return {
              id: String(f.id),
              version_number: f.displayName ?? f.fileName ?? '',
              game_versions: gv.filter(isMcVersion),
              loaders: cfLoaderName[Number(f.modLoaderType ?? 0)] ? [cfLoaderName[Number(f.modLoaderType ?? 0)]] : gv.filter(v => !isMcVersion(v)).map(v => v.toLowerCase()),
              date_published: f.fileDate ?? '',
              downloads: f.downloadCount ?? 0,
              files: url ? [{ url, filename: f.fileName ?? 'mod.jar', primary: true }] : [],
              mod_loader_type: Number(f.modLoaderType ?? 0),
              dependencies: [],
            };
          });
          bestVersion = pickNewest(filtered, mcVersion, loader) ?? pickNewest(versions, mcVersion, loader);
          // Never install an arbitrary unfiltered CurseForge mod. A missing exact
          // version/loader match must be reported instead of silently selecting a
          // different loader or Minecraft version. Non-mod content may still use
          // the already-filtered list's newest downloadable fallback in pickNewest.

        } catch {
          bestVersion = pickNewest(versions, mcVersion, loader);
        }
      }

      if (!bestVersion) {
        const kind = project?.project_type === 'shader' ? 'shader' : project?.project_type === 'resourcepack' ? 'resource pack' : 'mod';
        throw new Error(
          `No downloadable ${kind} version was returned for ${mcVersion || 'this Minecraft version'}${loader && kind === 'mod' ? ` / ${loader}` : ''}. Try refreshing the project or selecting another instance.`,
        );
      }

      await runInstall(instanceId, bestVersion);
    } catch (e: any) {
      setInstallError(String(e?.message ?? e));
      setTimeout(() => setInstallError(''), 8000);
    } finally {
      setInstalling(false);
    }
  };

  // Запускается кнопкой "Install" рядом с конкретной версией. Если известен
  // контекстный инстанс — ставим сразу, иначе открываем выбор инстанса,
  // запомнив выбранную версию.
  const installSpecificVersion = (v: ModVersion) => {
    if (installing) return;
    if (contextInstanceId) {
      setPendingVersion(v);
      // doInstall прочитает pendingVersion и поставит именно эту версию.
      setTimeout(() => doInstall(contextInstanceId, contextMcVersion, contextLoader), 0);
    } else {
      setPendingVersion(v);
      setShowPicker(true);
    }
  };


  const color = project?.color ? '#' + project.color.toString(16).padStart(6, '0') : '#6C5CE7';
  const letter = project?.title?.[0]?.toUpperCase() ?? '?';
  const allDeps = versions[0]?.dependencies ?? [];
  const LOADER_PROJECTS = ['neoforge', 'forge', 'fabric', 'quilt', 'fabric-api', 'cloth-config', 'architectury', 'forge-config-api-port', 'fabric-language-kotlin'];
  const requiredDeps = allDeps.filter(d => d.dependency_type === 'required' && d.project_id && !LOADER_PROJECTS.includes(d.project_id.toLowerCase()));
  const incompatibleDeps = allDeps.filter(d => d.dependency_type === 'incompatible');
  const otherDeps = allDeps.filter(d => d.dependency_type !== 'required' && d.dependency_type !== 'incompatible');

  const uniqueMcVersions = Array.from(new Set(versions.flatMap(v => v.game_versions ?? [])))
    .filter(v => /^\d+\.\d+/.test(v))
    .sort((a, b) => {
      const pa = a.split('.').map(Number);
      const pb = b.split('.').map(Number);
      for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
        const diff = (pb[i] ?? 0) - (pa[i] ?? 0);
        if (diff !== 0) return diff;
      }
      return 0;
    });

  const uniqueLoaders = Array.from(new Set(versions.flatMap(v => v.loaders ?? [])))
    .filter(Boolean)
    .sort();

  const filteredVersions = versions.filter(v =>
    (!versionFilter || v.game_versions?.includes(versionFilter)) &&
    (!loaderFilter || v.loaders?.includes(loaderFilter)),
  );

  function renderBody(body: string): string {
    const escape = (value: string) => value
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/\"/g, '&quot;');
    const safeUrl = (value: string) => /^(https?:\/\/|mailto:)/i.test(value.trim()) ? value.trim() : '#';
    const hasHtml = /<\/?[a-z][^>]*>/i.test(body);
    let html = hasHtml ? body : escape(body).replace(/\r\n?/g, '\n');

    if (!hasHtml) {
      html = html
        .replace(/^### (.+)$/gm, '<h3>$1</h3>')
        .replace(/^## (.+)$/gm, '<h2>$1</h2>')
        .replace(/^# (.+)$/gm, '<h1>$1</h1>')
        .replace(/^> (.+)$/gm, '<blockquote>$1</blockquote>')
        .replace(/!\[([^\]]*)\]\(([^)]+)\)/g, (_m, alt, url) => `<img src="${safeUrl(url)}" alt="${alt}" />`)
        .replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_m, label, url) => `<a href="${safeUrl(url)}" target="_blank" rel="noreferrer">${label}</a>`)
        .replace(/`([^`]+)`/g, '<code>$1</code>')
        .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
        .replace(/__([^_]+)__/g, '<strong>$1</strong>')
        .replace(/\*([^*]+)\*/g, '<em>$1</em>')
        .replace(/^[-*] (.+)$/gm, '<li>$1</li>')
        .replace(/(?:<li>.*<\/li>\n?)+/g, block => `<ul>${block}</ul>`)
        .replace(/\n{2,}/g, '</p><p>')
        .replace(/\n/g, '<br />');
      html = `<p>${html}</p>`;
    }

    if (hasHtml) {
      html = html
        .replace(/^### (.+)$/gm, '<h3>$1</h3>')
        .replace(/^## (.+)$/gm, '<h2>$1</h2>')
        .replace(/^# (.+)$/gm, '<h1>$1</h1>')
        .replace(/!\[([^\]]*)\]\(([^)]+)\)/g, (_m, alt, url) => `<img src="${safeUrl(url)}" alt="${alt}" />`)
        .replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_m, label, url) => `<a href="${safeUrl(url)}" target="_blank" rel="noreferrer">${label}</a>`)
        .replace(/`([^`]+)`/g, '<code>$1</code>')
        .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
        .replace(/__([^_]+)__/g, '<strong>$1</strong>');
    }

    return html
      .replace(/<script[\s\S]*?<\/script>/gi, '')
      .replace(/<style[\s\S]*?<\/style>/gi, '')
      .replace(/\son\w+\s*=\s*(['\"]).*?\1/gi, '')
      .replace(/\s(href|src)\s*=\s*(['\"])\s*javascript:[^'\"]*\2/gi, '')
      .replace(/<h([1-6])[^>]*>/gi, '<h$1>')
      .replace(/<a\s+([^>]*href=)/gi, '<a target="_blank" rel="noreferrer" $1')
      .replace(/<a /gi, '<a style="color:var(--color-primary);text-decoration:underline" ')
      .replace(/<h1>/gi, '<h1 style="font-size:1.35rem;font-weight:800;margin:1.25rem 0 .6rem;color:var(--color-text)">')
      .replace(/<h2>/gi, '<h2 style="font-size:1.15rem;font-weight:800;margin:1.1rem 0 .5rem;color:var(--color-text)">')
      .replace(/<h3>/gi, '<h3 style="font-size:1rem;font-weight:800;margin:1rem 0 .45rem;color:var(--color-text)">')
      .replace(/<p>/gi, '<p style="margin-bottom:.75rem;color:var(--color-text-secondary)">')
      .replace(/<ul>/gi, '<ul style="list-style:disc;padding-left:1.25rem;margin-bottom:.75rem">')
      .replace(/<ol>/gi, '<ol style="list-style:decimal;padding-left:1.25rem;margin-bottom:.75rem">')
      .replace(/<li>/gi, '<li style="margin-bottom:.25rem;color:var(--color-text-secondary)">')
      .replace(/<blockquote>/gi, '<blockquote style="border-left:3px solid var(--color-primary);padding:.5rem .9rem;margin:.75rem 0;background:var(--color-surface-2);border-radius:.5rem">')
      .replace(/<strong>/gi, '<strong style="color:var(--color-text);font-weight:700">')
      .replace(/<em>/gi, '<em style="color:var(--color-text-secondary)">')
      .replace(/<code>/gi, '<code style="background:var(--color-surface-2);padding:.1em .4em;border-radius:4px;font-size:.85em">')
      .replace(/<img([^>]*)>/gi, '<img$1 style="max-width:100%;height:auto;border-radius:12px;margin:.75rem 0;display:block" loading="lazy" />')
      .replace(/(?:https?:\/\/)?(?:www\.)?youtube\.com\/embed\/([a-zA-Z0-9_-]+)/gi, 'https://www.youtube-nocookie.com/embed/$1')
      .replace(/(?:https?:\/\/)?(?:www\.)?youtu\.be\/([a-zA-Z0-9_-]+)/gi, 'https://www.youtube-nocookie.com/embed/$1')
      .replace(/<iframe([^>]*)>/gi, '<iframe$1 style="width:100%;aspect-ratio:16/9;border-radius:12px;border:none;margin:.75rem 0" loading="lazy">');
  }

  // Fetch real dependency titles, authors and icons from the active platform.
  useEffect(() => {
    if (allDeps.length === 0 || (source !== 'modrinth' && source !== 'curseforge')) return;
    allDeps.forEach(async d => {
      if (!d.project_id || depInfo[d.project_id]) return;
      try {
        if (source === 'curseforge') {
          const p = await invoke<any>('get_curseforge_mod', { projectId: Number(d.project_id), apiKey: cfApiKey });
          const author = p.authors?.find((entry: any) => entry?.name)?.name
            || p.authors?.find((entry: any) => entry?.user?.name)?.user?.name
            || p.authors?.[0]?.username;
          setDepInfo(prev => ({ ...prev, [d.project_id!]: { name: p.name || d.project_id!, author, icon_url: p.logo?.thumbnail_url } }));
        } else {
          const p = await getModrinthProjectGateway(d.project_id);
          const author = p.author || p.owner || p.team_name || p.organization?.name || p.team?.name;
          setDepInfo(prev => ({ ...prev, [d.project_id!]: { name: p.title || d.project_id!, author, icon_url: p.icon_url, game_versions: p.game_versions ?? [], loaders: p.loaders ?? [] } }));
        }
      } catch {
        setDepInfo(prev => ({ ...prev, [d.project_id!]: { name: d.project_id! } }));
      }
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allDeps.length, source, contextMcVersion, contextLoader, cfApiKey]);

  if (loading) {
    return (
      <div className="h-full flex items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <div className="w-8 h-8 border-2 rounded-full animate-spin"
            style={{ borderColor: 'var(--color-border)', borderTopColor: 'var(--color-primary)' }} />
          <p className="text-sm" style={{ color: 'var(--color-text-secondary)' }}>Загружаю страницу модификации…</p>
        </div>
      </div>
    );
  }

  if (error && !project) {
    return (
      <div className="h-full flex items-center justify-center">
        <div className="flex flex-col items-center gap-3 max-w-sm text-center px-6">
          <AlertCircle className="w-8 h-8" style={{ color: 'var(--color-error)' }} />
          <p className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>Не удалось загрузить модификацию</p>
          <p className="text-xs" style={{ color: 'var(--color-text-secondary)' }}>{error}</p>
          <button onClick={goBack}
            className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold mt-2"
            style={{ background: 'var(--color-surface-2)', color: 'var(--color-text)', border: '1px solid var(--color-border)' }}>
            <ChevronLeft className="w-4 h-4" />Назад
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto scroll-area" style={{ fontFamily: 'var(--font-ui)' }}>
      <div className="max-w-4xl mx-auto pb-8 px-4 pt-4">
        <button onClick={goBack}
          className="flex items-center gap-2 text-sm mb-6 transition-colors hover:opacity-80"
          style={{ color: 'var(--color-text-secondary)' }}>
          <ChevronLeft className="w-4 h-4" />
          {location.state?.fromFindProjects ? 'К проектам' : 'Назад к поиску'}
        </button>

        <section className="mb-4 border p-4 sm:p-5"
          style={{ background: 'var(--color-bg)', borderColor:'var(--color-border)', borderRadius:'var(--radius-card)' }}>

          <div className="w-12 h-12 rounded-sm flex items-center justify-center text-lg font-bold shrink-0 overflow-hidden"
            style={{ background: project?.icon_url ? 'transparent' : 'var(--color-surface-2)', color, border:'1px solid var(--color-border)' }}>
            {project?.icon_url
              ? <img src={project.icon_url} alt="" className="w-full h-full object-cover rounded-sm"
                  onError={e => { (e.target as any).style.display = 'none'; }} />
              : letter}
          </div>

          <div className="flex-1 min-w-0">
            <div className="flex items-start justify-between gap-4 flex-wrap">
              <div className="min-w-0 flex-1">
                <h1 className="text-xl font-bold mb-1" style={{ color: 'var(--color-text)' }}>{project?.title}</h1>
                <p className="max-w-2xl text-sm leading-relaxed" style={{ color: 'var(--color-text-secondary)' }}>{project?.description}</p>
                {project?.author && (
                  <button
                    onClick={() => navigate(`/author/${source === 'curseforge' ? 'curseforge' : 'modrinth'}/${encodeURIComponent(project.author!)}`)}
                    className="mt-2 inline-flex items-center gap-2 transition-colors hover:opacity-75"
                    title={`Открыть профиль ${project.author}`}
                  >
                    <span className="h-5 w-5 overflow-hidden rounded-sm" style={{ background: 'var(--color-surface-2)', border: '1px solid var(--color-border)' }}>
                      {authorAvatar ? <img src={authorAvatar} alt="" className="h-full w-full object-cover" onError={e => { e.currentTarget.style.display = 'none'; }} /> : <span className="flex h-full w-full items-center justify-center text-[10px] font-black" style={{ color: 'var(--color-primary)' }}>{project.author[0]?.toUpperCase()}</span>}
                    </span>
                    <span className="text-xs font-bold" style={{ color: 'var(--color-primary)' }}>{project.author}</span>
                  </button>
                )}
              </div>

              <div className="flex flex-col items-end gap-2 shrink-0">
                {contextInstance && !installing && !installed && (
                  <p className="text-[10px] font-semibold px-2.5 py-1 rounded-lg"
                    style={{ background:'rgba(108,92,231,0.1)', color:'var(--color-primary)' }}>
                    → {contextInstance.name}
                  </p>
                )}
                <button
                  onClick={() => {
                    if (installing || installed) return;
                    if (project?.project_type === 'modpack' && !contextInstanceId) {
                      openModpackPreview();
                    } else if (contextInstanceId) {
                      doInstall(contextInstanceId, contextMcVersion, contextLoader);
                    } else {
                      setShowPicker(true);
                    }
                  }}
                  disabled={installing || installed}
                  className="flex items-center gap-2 px-3 py-2 rounded-sm font-semibold text-sm transition-colors"
                  style={installed
                    ? { background: 'transparent', color: 'var(--color-text)', border: '1px solid var(--color-border)' }
                    : { background: 'transparent', color: 'var(--color-primary)', border: '1px solid var(--color-primary)', opacity: installing ? 0.75 : 1 }}>
                  {installing || previewLoading
                    ? <><span className="w-4 h-4 border-2 border-white/40 border-t-white rounded-full animate-spin" />{previewLoading ? 'Читаю манифест…' : (installMessage || 'Устанавливаю…')}</>
                    : installed
                    ? <><Check className="w-4 h-4" />Установлено</>
                    : <><Zap className="w-4 h-4" />Установить</>}
                </button>
                {installing && (
                  <div className="w-32 h-1.5 rounded-full overflow-hidden" style={{ background: 'var(--color-border)' }}>
                    <motion.div className="h-full rounded-full" style={{ background: 'var(--color-primary)' }}
                      animate={{ width: `${installProgress}%` }} transition={{ duration: 0.3 }} />
                  </div>
                )}
                {installError && (
                  <p className="text-xs max-w-[200px] text-right" style={{ color: 'var(--color-error)' }}>{installError}</p>
                )}
              </div>
            </div>

            <div className="mt-3 flex items-center gap-x-4 gap-y-2 flex-wrap border px-3 py-2" style={{ background:'transparent', borderColor:'var(--color-border)', borderRadius:'var(--radius-button)' }}>
              <span className="flex items-center gap-1.5 text-sm" style={{ color: 'var(--color-text-secondary)' }}>
                <Download className="w-4 h-4" />{(project?.downloads ?? 0).toLocaleString('ru-RU')} загрузок
              </span>
              <span className="flex items-center gap-1.5 text-sm" style={{ color: 'var(--color-text-secondary)' }}>
                <Star className="w-4 h-4 fill-current" style={{ color: '#f59e0b' }} />
                {(project?.follows ?? 0).toLocaleString('ru-RU')} подписчиков
              </span>
              {project?.date_modified && (
                <span className="flex items-center gap-1.5 text-sm" style={{ color: 'var(--color-text-secondary)' }}>
                  <Calendar className="w-4 h-4" />Обновлено {new Date(project.date_modified).toLocaleDateString('ru-RU')}
                </span>
              )}
              <span className="flex h-6 w-6 items-center justify-center" title={source === 'modrinth' ? 'Modrinth' : 'CurseForge'} style={{ border:'1px solid var(--color-border)', color:'var(--color-text-secondary)' }}>
                {source === 'modrinth' ? <img src={modrinthWrench} alt="Modrinth" className="h-3.5 w-3.5 object-contain" /> : <img src={curseforgeAnvil} alt="CurseForge" className="h-3.5 w-3.5 object-contain" />}
              </span>
              {project?.source_url && (
                <a href={project.source_url} target="_blank" rel="noreferrer"
                  className="flex items-center gap-1 text-xs" style={{ color: 'var(--color-primary)' }}>
                  <ExternalLink className="w-3 h-3" />Исходный код
                </a>
              )}
            </div>

            <div className="flex flex-wrap gap-2 mt-2.5">
              {project?.loaders?.map(l => (
                <span key={l} className="text-xs px-2 py-1 rounded-sm font-medium capitalize"
                  style={{ background: 'transparent', color: 'var(--color-text-secondary)', border: '1px solid var(--color-border)' }}>
                  {l}
                </span>
              ))}
              {project?.game_versions?.slice(0, 6).map(v => (
                <span key={v} className="text-xs px-2 py-1 rounded-sm font-medium"
                  style={{ background: 'transparent', color: 'var(--color-text-secondary)', border: '1px solid var(--color-border)' }}>
                  {v}
                </span>
              ))}
              {(project?.game_versions?.length ?? 0) > 6 && (
                <span className="text-xs px-2 py-1 rounded-sm font-medium"
                  style={{ background: 'transparent', color: 'var(--color-text-tertiary)', border: '1px solid var(--color-border)' }}>
                  +{(project?.game_versions?.length ?? 0) - 6} ещё
                </span>
              )}
            </div>
          </div>
        </section>

        <div className="mb-4 grid grid-cols-2 sm:grid-cols-4"
          style={{ background:'var(--color-bg)', border:'1px solid var(--color-border)', borderRadius:'var(--radius-card)' }}>
          {([
            ['desc', 'Описание'],
            ['versions', `Версии (${versions.length})`],
            ['deps', `Зависимости (${allDeps.length})`],
            ['screenshots', `Скриншоты (${project?.gallery?.length ?? 0})`],
          ] as const).map(([id, label]) => (
            <button key={id} onClick={() => setTab(id)}
              className="min-w-0 px-3 py-3 text-center text-sm font-semibold transition-colors"
              style={tab === id
                ? { color: 'var(--color-primary)', background:'transparent', outline:'1px solid var(--color-primary)', outlineOffset:'-1px' }
                : { color: 'var(--color-text-secondary)', borderRight:'1px solid var(--color-border)' }}>
              {label}
            </button>
          ))}
        </div>

        <section key={tab} className="mb-6 min-h-[18rem] border p-5 sm:p-6"
          style={{ background: 'var(--color-bg)', borderColor:'var(--color-border)', borderRadius:'var(--radius-card)' }}>

          {tab === 'desc' && (
            <div className="max-w-3xl text-sm leading-relaxed" style={{ color: 'var(--color-text-secondary)' }}>
              {project?.body ? (
                <div dangerouslySetInnerHTML={{ __html: renderBody(project.body) }} />
              ) : (
                <p>{project?.description ?? 'Описание отсутствует.'}</p>
              )}
            </div>
          )}

          {tab === 'versions' && (
            <div className="space-y-3">
              {uniqueMcVersions.length > 1 && (
                <div className="flex items-center gap-2 flex-wrap pb-1">
                  <span className="text-xs font-semibold shrink-0" style={{ color: 'var(--color-text-secondary)' }}>Версия:</span>
                  <button
                    onClick={() => setVersionFilter('')}
                    className="text-[11px] px-2.5 py-1 rounded-lg font-semibold transition-all"
                    style={!versionFilter
                      ? { background: 'var(--color-primary)', color: '#fff' }
                      : { background: 'var(--color-surface-2)', color: 'var(--color-text-secondary)', border: '1px solid var(--color-border)' }}>
                    Все ({versions.length})
                  </button>
                  {uniqueMcVersions.slice(0, 12).map(mcv => (
                    <button key={mcv}
                      onClick={() => setVersionFilter(mcv === versionFilter ? '' : mcv)}
                      className="text-[11px] px-2.5 py-1 rounded-lg font-semibold transition-all"
                      style={versionFilter === mcv
                        ? { background: 'var(--color-primary)', color: '#fff' }
                        : { background: 'var(--color-surface-2)', color: 'var(--color-text-secondary)', border: '1px solid var(--color-border)' }}>
                      {mcv}
                    </button>
                  ))}
                </div>
              )}
              {uniqueLoaders.length > 1 && (
                <div className="flex items-center gap-2 flex-wrap pb-1">
                  <span className="text-xs font-semibold shrink-0" style={{ color: 'var(--color-text-secondary)' }}>Ядро:</span>
                  <button
                    onClick={() => setLoaderFilter('')}
                    className="text-[11px] px-2.5 py-1 rounded-lg font-semibold transition-all capitalize"
                    style={!loaderFilter
                      ? { background: 'var(--color-primary)', color: '#fff' }
                      : { background: 'var(--color-surface-2)', color: 'var(--color-text-secondary)', border: '1px solid var(--color-border)' }}>
                    Все
                  </button>
                  {uniqueLoaders.map(ld => (
                    <button key={ld}
                      onClick={() => setLoaderFilter(ld === loaderFilter ? '' : ld)}
                      className="text-[11px] px-2.5 py-1 rounded-lg font-semibold transition-all capitalize"
                      style={loaderFilter === ld
                        ? { background: 'var(--color-primary)', color: '#fff' }
                        : { background: 'var(--color-surface-2)', color: 'var(--color-text-secondary)', border: '1px solid var(--color-border)' }}>
                      {ld}
                    </button>
                  ))}
                </div>
              )}
              {filteredVersions.length === 0 ? (
                <p className="text-sm text-center py-6" style={{ color: 'var(--color-text-secondary)' }}>
                  Нет версий, соответствующих выбранным фильтрам
                </p>
              ) : filteredVersions.map(v => (
                <div key={v.id} className="flex items-center gap-3 py-3"
                  style={{ background:'transparent', borderBottom:'1px solid var(--color-border)' }}>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="text-sm font-semibold" style={{ color: 'var(--color-text)' }}>{v.version_number}</p>
                      {v.loaders?.slice(0, 3).map(l => (
                        <span key={l} className="text-[10px] font-semibold px-1.5 py-0.5 rounded-sm capitalize"
                          style={{ background: 'transparent', color: 'var(--color-text-secondary)', border: '1px solid var(--color-border)' }}>
                          {l}
                        </span>
                      ))}
                    </div>
                    <p className="text-xs mt-0.5" style={{ color: 'var(--color-text-secondary)' }}>
                      {v.game_versions?.slice(0, 4).join(', ')}
                      {(v.game_versions?.length ?? 0) > 4 && ` +${v.game_versions.length - 4}`}
                      {' · '}{new Date(v.date_published).toLocaleDateString()}
                      {v.downloads > 0 && <> · {v.downloads.toLocaleString('ru-RU')} загрузок</>}
                    </p>
                  </div>
                  <button onClick={() => installSpecificVersion(v)}
                    disabled={installing}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold shrink-0"
                    style={{ background: 'var(--color-primary)', color: '#fff', opacity: installing ? 0.6 : 1 }}>
                    <Download className="w-3 h-3" />Установить
                  </button>
                </div>
              ))}
            </div>
          )}

          {tab === 'deps' && (
            <div className="space-y-2">
              {allDeps.length === 0 ? (
                <div className="flex flex-col items-center py-8 gap-2">
                  <Check className="w-8 h-8" style={{ color: '#2ECC71' }} />
                  <p className="text-sm" style={{ color: 'var(--color-text-secondary)' }}>Обязательные зависимости отсутствуют</p>
                </div>
              ) : (
                <div className="space-y-4">
                  {requiredDeps.length > 0 && <DependencyGroup title="Обязательные зависимости" tone="required" entries={requiredDeps} depInfo={depInfo} navigate={navigate} contextInstanceId={contextInstanceId} contextMcVersion={contextMcVersion} contextLoader={contextLoader} source={source === 'curseforge' ? 'curseforge' : 'modrinth'} />}
                  {otherDeps.length > 0 && <DependencyGroup title="Другие зависимости" tone="optional" entries={otherDeps} depInfo={depInfo} navigate={navigate} contextInstanceId={contextInstanceId} contextMcVersion={contextMcVersion} contextLoader={contextLoader} source={source === 'curseforge' ? 'curseforge' : 'modrinth'} />}
                  {incompatibleDeps.length > 0 && <DependencyGroup title="Несовместимые модификации" tone="incompatible" entries={incompatibleDeps} depInfo={depInfo} navigate={navigate} contextInstanceId={contextInstanceId} contextMcVersion={contextMcVersion} contextLoader={contextLoader} source={source === 'curseforge' ? 'curseforge' : 'modrinth'} />}
                  {requiredDeps.length === 0 && otherDeps.length === 0 && incompatibleDeps.length === 0 && <p className="text-sm" style={{ color:'var(--color-text-secondary)' }}>Для этой версии нет сведений о зависимостях.</p>}
                </div>
              )}
            </div>
          )}

          {tab === 'screenshots' && <ProjectScreenshots items={project?.gallery ?? []} instanceId={contextInstanceId} />}
        </section>
      </div>

      <AnimatePresence>
        {modpackPreview && <SelectableManifestPreview preview={modpackPreview} onClose={() => setModpackPreview(null)} onInstall={excludedPaths => { setModpackPreview(null); void doInstallModpack(excludedPaths); }} />}
        {showPicker && (
          <InstancePickerModal modName={project?.title ?? ''} onClose={() => { setShowPicker(false); setPendingVersion(null); }} onSelect={doInstall} />
        )}
        {runningInstallTarget && (
          <motion.div className="fixed inset-0 z-[90] flex items-center justify-center bg-black/45 p-5" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
            <motion.div className="w-full max-w-md p-5" initial={{ opacity: 0, scale: 0.96, y: 10 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.96, y: 10 }} style={{ background: 'var(--color-surface)', border: '1px solid rgba(241,196,15,0.5)', borderRadius: 'var(--radius-modal)', boxShadow: 'var(--shadow-lg)' }}>
              <div className="flex items-start gap-3"><span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl" style={{ background: 'rgba(241,196,15,0.16)', color: 'var(--color-warning)' }}><TriangleAlert className="h-5 w-5" /></span><div><h2 className="text-sm font-bold" style={{ color: 'var(--color-text)' }}>Minecraft запущен</h2><p className="mt-1 text-xs leading-relaxed" style={{ color: 'var(--color-text-secondary)' }}>После установки перезапустите Minecraft, чтобы изменения применились.</p></div></div>
              <div className="mt-5 flex justify-end gap-2"><button onClick={() => setRunningInstallTarget(null)} className="rounded-xl px-3 py-2 text-xs font-semibold" style={{ background: 'var(--color-surface-2)', border: '1px solid var(--color-border)', color: 'var(--color-text-secondary)' }}>Отмена</button><button onClick={() => { const target = runningInstallTarget; setRunningInstallTarget(null); void doInstall(target.instanceId, target.mcVersion, target.loader, true); }} className="rounded-xl px-3 py-2 text-xs font-bold" style={{ background: 'var(--color-warning)', color: '#211b00' }}>Установить всё равно</button></div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { invoke } from '@/lib/invoke-shim';
import { useSettingsStore } from '@/stores/settingsStore';
import { useAuthorAvatar } from '@/lib/author-avatar';
import { getModrinthProjectGateway } from '@/lib/modrinth-gateway';
import { toIconSrc } from '@/lib/icon-src';
import { ScreenshotEditor } from '@/components/ScreenshotEditor';
import { listen, UnlistenFn } from '@tauri-apps/api/event';
import {
  Package, FolderTree, Globe,
  Folder, FileText, Upload, Trash2, RefreshCw, Home, Search, Image as ImageIcon, Sparkles, Braces, Archive,
  Compass, FolderPlus, X, Sword, Blocks, Skull, Eye, ArrowUpDown, ShieldAlert, CheckCircle2, History, Undo2, Camera, Save, Edit3, ChevronLeft, ChevronRight,
} from 'lucide-react';

type ModEntry = {
  id: string;
  name: string;
  fileName?: string;
  icon?: string;
  path?: string;
  installedVersion?: string;
  latestVersion?: string;
  type?: string;
  author?: string;
  authorId?: number;
  source?: string;
  updateAvailable?: boolean;
  mod_type?: string;
  enabled?: boolean;
};

type FsEntry = { name: string; path: string; is_dir: boolean; size: number; modified?: string; kind: string };
type WorldInfo = { folder: string; name: string; icon?: string; last_played?: number; size_mb: number; game_mode?: string; hardcore?: boolean };

type ScreenshotItem = { path: string; name: string; url: string };
type MainTab = 'content' | 'files' | 'worlds' | 'screenshots';
type ContentFilter = 'all' | 'mods' | 'resourcepacks' | 'shaders' | 'updates' | 'disabled' | 'deleted';

const MAIN_TABS: { id: MainTab; label: string; icon: any }[] = [
  { id: 'content', label: 'Модификации', icon: Package },
  { id: 'files', label: 'Files', icon: FolderTree },
  { id: 'worlds', label: 'Worlds', icon: Globe },
  { id: 'screenshots', label: 'Screenshots', icon: Camera },
];

const CONTENT_FILTERS: { id: ContentFilter; label: string }[] = [
  { id: 'all', label: 'Всё' },
  { id: 'mods', label: 'Моды' },
  { id: 'resourcepacks', label: 'Наборы ресурсов' },
  { id: 'shaders', label: 'Шейдеры' },
  { id: 'updates', label: 'Обновления' },
];

function normalizeContentType(value: unknown): 'mod' | 'resourcepack' | 'shaderpack' | 'datapack' {
  const raw = String(value ?? 'mod').toLowerCase().replace(/[_-]/g, '');
  if (raw.includes('shader')) return 'shaderpack';
  if (raw.includes('resource') || raw.includes('texturepack')) return 'resourcepack';
  if (raw.includes('data')) return 'datapack';
  return 'mod';
}

function fmtSize(bytes: number) {
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(2)} GB`;
  if (bytes >= 1024 ** 2) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${bytes} B`;
}

function fmtDate(iso?: string) {
  if (!iso) return '—';
  try {
    const d = new Date(iso);
    return d.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: '2-digit' }) +
      ', ' + d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
  } catch { return iso; }
}

function fmtAgo(ts?: number) {
  if (!ts) return null;
  const days = Math.floor((Date.now() - ts) / 86400000);
  if (days <= 0) return 'сегодня';
  if (days === 1) return 'вчера';
  if (days < 30) return `${days} дн. назад`;
  const months = Math.floor(days / 30);
  return `${months} мес. назад`;
}

function highlightCode(source: string) {
  const escaped = source
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
  return escaped
    .replace(/(\"(?:\\.|[^\"])*\")/g, '<span class="code-string">$1</span>')
    .replace(/(^|\s)(#.*$)/gm, '$1<span class="code-comment">$2</span>')
    .replace(/\b(true|false|null)\b/g, '<span class="code-bool">$1</span>')
    .replace(/\b(\d+(?:\.\d+)?)\b/g, '<span class="code-number">$1</span>');
}

function GameModeBadge({ mode, hardcore }: { mode?: string; hardcore?: boolean }) {
  if (hardcore) return (
    <span className="flex items-center gap-1 text-xs font-semibold" style={{ color: '#E74C3C' }}>
      <Skull className="w-3.5 h-3.5" />Хардкор
    </span>
  );
  if (mode === 'creative') return (
    <span className="flex items-center gap-1 text-xs font-semibold" style={{ color: 'var(--color-text-secondary)' }}>
      <Blocks className="w-3.5 h-3.5" />Творческий режим
    </span>
  );
  if (mode === 'spectator') return (
    <span className="flex items-center gap-1 text-xs font-semibold" style={{ color: 'var(--color-text-secondary)' }}>
      <Eye className="w-3.5 h-3.5" />Наблюдатель
    </span>
  );
  return (
    <span className="flex items-center gap-1 text-xs font-semibold" style={{ color: 'var(--color-text-secondary)' }}>
      <Sword className="w-3.5 h-3.5" />Режим выживания
    </span>
  );
}

/** Кликабельный автор мода: аватар + переход на его страницу внутри лаунчера. */
function AuthorLink({ author, authorId, source }: { author?: string; authorId?: number; source?: string }) {
  const navigate = useNavigate();
  const avatar = useAuthorAvatar(author, source);
  if (!author) return null;
  const src = source === 'curseforge' ? 'curseforge' : 'modrinth';
  return (
    <button
      onClick={(e) => { e.stopPropagation(); navigate(`/author/${src}/${encodeURIComponent(author)}${source === 'curseforge' && authorId ? `?authorId=${authorId}` : ''}`); }}
      className="inline-flex items-center gap-1.5 mt-0.5 rounded-full pr-2 hover:bg-white/5"
      title={`Open ${author} profile`}
    >
      <span className="flex w-4 h-4 items-center justify-center rounded-full overflow-hidden shrink-0 text-[9px] font-bold" style={{ background: 'var(--color-surface-2)', color: 'var(--color-text-secondary)' }}>
        {avatar ? <img src={avatar} alt="" className="w-full h-full object-cover" /> : author.slice(0, 1).toUpperCase()}
      </span>
      <span className="text-[11px] font-semibold" style={{ color: 'var(--color-primary)' }}>{author}</span>
    </button>
  );
}

function Toggle({ checked, onChange }: { checked: boolean; onChange: () => void }) {
  return (
    <button onClick={onChange}
      className="relative w-9 h-5 rounded-full shrink-0 transition-colors"
      style={{ background: checked ? 'var(--color-primary)' : 'var(--color-surface-2)', border: checked ? 'none' : '1px solid var(--color-border)' }}>
      <span className="absolute top-0.5 w-4 h-4 rounded-full bg-white transition-all"
        style={{ left: checked ? 18 : 2 }} />
    </button>
  );
}

export function InstanceMods({ instanceId }: { instanceId: string }) {
  const navigate = useNavigate();
  const [mods, setMods] = useState<ModEntry[]>([]);
  const [deletedMods, setDeletedMods] = useState<Array<{ id: string; timestamp: string; file_name: string; mod_type: string; was_disabled: boolean }>>([]);
  const [worlds, setWorlds] = useState<WorldInfo[]>([]);
  const [screenshots, setScreenshots] = useState<ScreenshotItem[]>([]);
  const [selectedScreenshot, setSelectedScreenshot] = useState<ScreenshotItem | null>(null);
  const [editorScreenshot, setEditorScreenshot] = useState<ScreenshotItem | null>(null);
  const [files, setFiles] = useState<FsEntry[]>([]);
  const [cwd, setCwd] = useState('');
  const [dragOver, setDragOver] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [progressMap, setProgressMap] = useState<Record<string, { percent: number; message?: string }>>({});
  const [mainTab, setMainTab] = useState<MainTab>('content');
  const [contentFilter, setContentFilter] = useState<ContentFilter>('all');
  const [selectedModIds, setSelectedModIds] = useState<Set<string>>(() => new Set());
  const selectedScreenshotIndex = selectedScreenshot ? screenshots.findIndex(item => item.path === selectedScreenshot.path) : -1;
  const selectScreenshotOffset = (offset: number) => {
    if (selectedScreenshotIndex < 0 || screenshots.length < 2) return;
    const next = (selectedScreenshotIndex + offset + screenshots.length) % screenshots.length;
    setSelectedScreenshot(screenshots[next]);
  };
  const [search, setSearch] = useState('');
  const [healthLoading, setHealthLoading] = useState(false);
  const [conflicts, setConflicts] = useState<Array<{ mod_a: string; mod_b: string; reason: string }>>([]);
  const [healthChecked, setHealthChecked] = useState(false);
  const [duplicateBusy, setDuplicateBusy] = useState<string | null>(null);
  const [showHistory, setShowHistory] = useState(false);
  const [history, setHistory] = useState<Array<{ timestamp: string; action: string; file_name: string; mod_type: string }>>([]);
  const [editorPath, setEditorPath] = useState<string | null>(null);
  const [editorContent, setEditorContent] = useState('');
  const [editorLoading, setEditorLoading] = useState(false);
  const [editorSaving, setEditorSaving] = useState(false);
  const [editorDirty, setEditorDirty] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const curseforgeApiKey = useSettingsStore(s => s.curseforgeApiKey);

  const enrichMissingMetadata = useCallback(async (items: ModEntry[]) => {
    const candidates = items.filter(item =>
      item.source === 'modrinth' || (item.source === 'curseforge' && curseforgeApiKey && /^\d+$/.test(item.id))
    ).filter(item => !item.author || !item.icon);
    if (!candidates.length) return;
    const patches = await Promise.all(candidates.slice(0, 24).map(async item => {
      const cacheKey = `portal-project-meta:v1:${item.source}:${item.id}`;
      try {
        const cached = localStorage.getItem(cacheKey);
        if (cached) {
          const parsed = JSON.parse(cached) as { author?: string; icon?: string; authorId?: number };
          if (parsed.author || parsed.icon) return { id: item.id, ...parsed };
        }
      } catch { /* optional cache */ }
      try {
        const project = item.source === 'curseforge'
          ? await invoke<any>('get_curseforge_mod', { projectId: Number(item.id), apiKey: curseforgeApiKey })
          : await getModrinthProjectGateway(item.id);
        const author = item.source === 'curseforge' ? project?.authors?.[0]?.name : (project?.author || project?.team);
        const icon = item.source === 'curseforge' ? (project?.logo?.thumbnail_url || project?.logo?.thumbnailUrl) : project?.icon_url;
        const authorId = item.source === 'curseforge' ? project?.authors?.[0]?.id : undefined;
        const patch = { id: item.id, author: typeof author === 'string' ? author : undefined, icon: typeof icon === 'string' ? icon : undefined, authorId: typeof authorId === 'number' ? authorId : undefined };
        try { localStorage.setItem(cacheKey, JSON.stringify(patch)); } catch { /* optional cache */ }
        return patch;
      } catch { return null; }
    }));
    const valid = patches.filter(Boolean) as Array<{ id: string; author?: string; icon?: string; authorId?: number }>;
    if (!valid.length) return;
    setMods(current => {
      const enriched = current.map(item => {
        const patch = valid.find(value => value.id === item.id);
        return patch ? { ...item, author: item.author || patch.author, authorId: item.authorId || patch.authorId, icon: item.icon || patch.icon } : item;
      });
      try { localStorage.setItem(`portal-instance-mods:v2:${instanceId}`, JSON.stringify({ savedAt: Date.now(), mods: enriched })); } catch { /* optional cache */ }
      return enriched;
    });
  }, [curseforgeApiKey]);

  const loadMods = useCallback(async (force = false) => {
    const cacheKey = `portal-instance-mods:v2:${instanceId}`;
    let cached: { savedAt: number; mods: ModEntry[] } | null = null;
    try {
      const raw = localStorage.getItem(cacheKey);
      if (raw) cached = JSON.parse(raw) as { savedAt: number; mods: ModEntry[] };
    } catch { cached = null; }
    if (!force && cached && Array.isArray(cached.mods) && Date.now() - cached.savedAt < 30_000) {
      setMods(cached.mods);
      setLoading(false);
      return;
    }
    if (cached && Array.isArray(cached.mods)) {
      setMods(cached.mods);
      setLoading(false);
    } else {
      setLoading(true);
    }
    setError(null);
    try {
      const res = (await invoke('get_instance_mods', { instanceId })) as any[] | string;
      if (typeof res === 'string') { setError(res); setMods([]); return; }
      const list: ModEntry[] = [];
      for (const m of res || []) {
        const name = m.name || m.file_name || m.fileName || 'Unknown';
        const modType = normalizeContentType(m.mod_type ?? m.modType ?? m.type);
        list.push({
          ...m,
          name,
          fileName: m.file_name || m.fileName,
          authorId: typeof (m.author_id ?? m.authorId) === 'number' ? (m.author_id ?? m.authorId) : undefined,
          mod_type: modType,
          enabled: m.enabled !== false,
          updateAvailable: !!(m.update_available ?? m.updateAvailable ?? (m.latestVersion && m.installedVersion && m.latestVersion !== m.installedVersion)),
        });
      }
      setMods(list);
      setSelectedModIds(previous => new Set([...previous].filter(id => list.some(mod => mod.id === id))));
      try { localStorage.setItem(cacheKey, JSON.stringify({ savedAt: Date.now(), mods: list })); } catch { /* cache is optional */ }
      void enrichMissingMetadata(list);
      setContentFilter(current => current === 'disabled' && !list.some(mod => mod.enabled === false) ? 'all' : current);
    } catch (e: any) {
      setError(e?.toString() ?? 'Failed to load mods'); setMods([]);
    } finally { setLoading(false); }
  }, [instanceId, enrichMissingMetadata]);

  const loadDeletedMods = useCallback(async () => {
    try {
      setDeletedMods(await invoke<Array<{ id: string; timestamp: string; file_name: string; mod_type: string; was_disabled: boolean }>>('list_deleted_mods', { instanceId }) || []);
    } catch { setDeletedMods([]); }
  }, [instanceId]);

  const loadWorlds = useCallback(async () => {
    try { setWorlds((await invoke('instance_list_worlds', { instanceId })) as WorldInfo[] || []); } catch { setWorlds([]); }
  }, [instanceId]);

  const loadScreenshots = useCallback(async () => {
    try {
      const paths = await invoke<string[]>('list_screenshots', { id: instanceId });
      setScreenshots((paths || []).map(path => ({ path, name: path.split(/[\\\\/]/).pop() || path, url: toIconSrc(path) || '' })));
    } catch { setScreenshots([]); }
  }, [instanceId]);

  const loadFiles = useCallback(async (path: string) => {
    try { setFiles((await invoke('instance_list_dir', { instanceId, path })) as FsEntry[] || []); }
    catch (e: any) { setError(e?.toString() ?? 'Failed to read folder'); setFiles([]); }
  }, [instanceId]);

  const openEditor = async (path: string) => {
    setEditorLoading(true); setEditorPath(path); setEditorDirty(false);
    try {
      const content = await invoke<string>('instance_read_text', { instanceId, path });
      setEditorContent(content);
    } catch (e: any) {
      setEditorPath(null); setError(e?.toString() ?? 'Failed to open file');
    } finally { setEditorLoading(false); }
  };

  const saveEditor = async () => {
    if (!editorPath || editorSaving) return;
    setEditorSaving(true);
    try {
      await invoke('instance_write_text', { instanceId, path: editorPath, content: editorContent });
      setEditorDirty(false);
      setError(null);
    } catch (e: any) { setError(e?.toString() ?? 'Failed to save file'); }
    finally { setEditorSaving(false); }
  };

  useEffect(() => {
    void loadMods(); void loadDeletedMods(); void loadWorlds(); void loadScreenshots(); void loadFiles('');
    const unsubs: UnlistenFn[] = [];
    (async () => {
      const handler = (e: any) => {
        const p = e.payload as any; if (!p) return;
        const id = p.id || p.modId || 'global';
        const percent = typeof p.percent === 'number'
          ? p.percent
          : Math.floor((p.downloaded / Math.max(1, p.total || 1)) * 100);
        setProgressMap(prev => ({ ...prev, [id]: { percent, message: p.message || p.status || '' } }));
      };
      unsubs.push(await listen('download-progress', handler));
      unsubs.push(await listen('install-progress', handler));
      unsubs.push(await listen('download-complete', (e: any) => { handler(e); void loadMods(true); }));
    })();
    return () => { unsubs.forEach(u => u()); };
  }, [instanceId, loadMods, loadDeletedMods, loadWorlds, loadScreenshots, loadFiles]);

  const visibleMods = useMemo(() => {
    let list = mods;
    if (contentFilter === 'mods') list = list.filter(m => m.mod_type === 'mod');
    else if (contentFilter === 'resourcepacks') list = list.filter(m => m.mod_type === 'resourcepack');
    else if (contentFilter === 'shaders') list = list.filter(m => m.mod_type === 'shaderpack');
    else if (contentFilter === 'updates') list = list.filter(m => m.updateAvailable);
    else if (contentFilter === 'disabled') list = list.filter(m => m.enabled === false);
    if (search) list = list.filter(m => m.name.toLowerCase().includes(search.toLowerCase()));
    return [...list].sort((a, b) => a.name.localeCompare(b.name));
  }, [mods, contentFilter, search]);

  const contentFilters = useMemo(() => [
    ...CONTENT_FILTERS,
    ...(mods.some(mod => mod.enabled === false) ? [{ id: 'disabled' as ContentFilter, label: 'Выключено' }] : []),
    { id: 'deleted' as ContentFilter, label: deletedMods.length ? `Удалённые · ${deletedMods.length}` : 'Удалённые' },
  ], [mods, deletedMods.length]);

  const duplicateGroups = useMemo(() => {
    const groups = new Map<string, ModEntry[]>();
    for (const mod of mods) {
      if (mod.mod_type !== 'mod') continue;
      const key = mod.name.toLowerCase().replace(/[-_ ](?:fabric|forge|quilt|neoforge)?[-_ ]?\d+(?:\.\d+)+$/i, '').replace(/[\s_-]+/g, '');
      const current = groups.get(key) ?? [];
      current.push({ ...mod, id: mod.id || mod.fileName || `${key}-${current.length}` });
      groups.set(key, current);
    }
    return Array.from(groups.entries())
      .filter(([, entries]) => entries.length > 1)
      .map(([key, entries]) => ({ key, name: entries[0].name, entries }));
  }, [mods]);

  async function keepDuplicateVersion(groupKey: string, keep: ModEntry) {
    const group = duplicateGroups.find(item => item.key === groupKey);
    if (!group || !keep.fileName) return;
    const remove = group.entries.filter(item => item.id !== keep.id && item.fileName);
    setDuplicateBusy(groupKey);
    try {
      for (const item of remove) {
        await invoke('remove_mod', { instanceId, fileName: item.fileName, modType: item.mod_type || 'mod' });
      }
      await Promise.all([loadMods(true), loadDeletedMods()]);
      setError(null);
    } catch (e: any) {
      setError(`Не удалось удалить лишние версии: ${e?.toString?.() ?? e}`);
    } finally {
      setDuplicateBusy(null);
    }
  }

  const filteredWorlds = useMemo(
    () => search ? worlds.filter(w => w.name.toLowerCase().includes(search.toLowerCase())) : worlds,
    [worlds, search],
  );
  const filteredFiles = useMemo(
    () => search ? files.filter(f => f.name.toLowerCase().includes(search.toLowerCase())) : files,
    [files, search],
  );
  const visibleFilesSize = useMemo(() => filteredFiles.reduce((sum, file) => sum + (file.is_dir ? 0 : file.size || 0), 0), [filteredFiles]);
  const fileIconFor = (entry: FsEntry) => {
    if (entry.is_dir) {
      const n = entry.name.toLowerCase();
      if (n === 'resourcepacks') return <ImageIcon className="w-4 h-4 shrink-0" style={{ color:'var(--color-primary)' }} />;
      if (n === 'shaderpacks') return <Sparkles className="w-4 h-4 shrink-0" style={{ color:'var(--color-primary)' }} />;
      if (n === 'logs') return <Braces className="w-4 h-4 shrink-0" style={{ color:'var(--color-primary)' }} />;
      return <Folder className="w-4 h-4 shrink-0" style={{ color:'var(--color-primary)' }} />;
    }
    if (/\\.jar$/i.test(entry.name)) return <Package className="w-4 h-4 shrink-0" style={{ color:'var(--color-primary)' }} />;
    if (/\\.(zip|mrpack)$/i.test(entry.name)) return <Archive className="w-4 h-4 shrink-0" style={{ color:'var(--color-primary)' }} />;
    return <FileText className="w-4 h-4 shrink-0" style={{ color:'var(--color-text-tertiary)' }} />;
  };

  async function handleRemove(mod: ModEntry) {
    try { await invoke('remove_mod', { instanceId, fileName: mod.fileName, modType: mod.mod_type }); await Promise.all([loadMods(true), loadDeletedMods()]); }
    catch (e: any) { setError(e?.toString() ?? 'Не удалось удалить файл'); }
  }

  async function handleToggle(mod: ModEntry) {
    const nowEnabled = !mod.enabled;
    setMods(prev => prev.map(m => m.id === mod.id ? { ...m, enabled: nowEnabled } : m));
    try {
      await invoke('toggle_mod', { instanceId, fileName: mod.fileName, modType: mod.mod_type || 'mod', enabled: nowEnabled });
    } catch (e: any) {
      setMods(prev => prev.map(m => m.id === mod.id ? { ...m, enabled: !nowEnabled } : m));
      setError(e?.toString() ?? 'Failed to toggle');
    }
  }

  const toggleSelectedMod = (id: string) => {
    setSelectedModIds(previous => {
      const next = new Set(previous);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const toggleAllVisibleMods = () => {
    setSelectedModIds(previous => {
      const next = new Set(previous);
      const everyVisibleSelected = visibleMods.length > 0 && visibleMods.every(mod => next.has(mod.id));
      visibleMods.forEach(mod => everyVisibleSelected ? next.delete(mod.id) : next.add(mod.id));
      return next;
    });
  };

  const selectedMods = useMemo(() => mods.filter(mod => selectedModIds.has(mod.id)), [mods, selectedModIds]);

  async function setSelectedModsEnabled(enabled: boolean) {
    const targets = selectedMods.filter(mod => (mod.enabled !== false) !== enabled);
    if (!targets.length) return;
    setMods(previous => previous.map(mod => selectedModIds.has(mod.id) ? { ...mod, enabled } : mod));
    try {
      await Promise.all(targets.map(mod => invoke('toggle_mod', {
        instanceId,
        fileName: mod.fileName,
        modType: mod.mod_type || 'mod',
        enabled,
      })));
    } catch (e: any) {
      await loadMods(true);
      setError(e?.toString() ?? 'Не удалось изменить состояние выбранных элементов');
    }
  }

  async function removeSelectedMods() {
    const targets = selectedMods.filter(mod => mod.fileName);
    if (!targets.length) return;
    try {
      for (const mod of targets) {
        await invoke('remove_mod', { instanceId, fileName: mod.fileName, modType: mod.mod_type || 'mod' });
      }
      setSelectedModIds(new Set());
      await Promise.all([loadMods(true), loadDeletedMods()]);
    } catch (e: any) {
      setError(e?.toString() ?? 'Не удалось удалить выбранные элементы');
    }
  }

  async function checkInstanceHealth() {
    setHealthLoading(true); setError(null);
    try {
      const [foundConflicts, checkedMods] = await Promise.all([
        invoke<Array<{ mod_a: string; mod_b: string; reason: string }>>('detect_mod_conflicts', { instanceId }),
        invoke<any[]>('check_mod_updates', { instanceId }),
      ]);
      setConflicts(foundConflicts ?? []);
      if (Array.isArray(checkedMods)) setMods(checkedMods.map(m => ({
        ...m,
        fileName: m.file_name,
        installedVersion: m.version,
        latestVersion: m.latest_version,
        icon: m.icon_url,
        mod_type: normalizeContentType(m.mod_type ?? m.modType ?? m.type),
      })));
      setHealthChecked(true);
    } catch (e: any) { setError(e?.toString() ?? 'Не удалось проверить сборку'); }
    finally { setHealthLoading(false); }
  }

  async function loadHistory() {
    try { setHistory(await invoke('list_mod_history', { instanceId }) as any[]); } catch { setHistory([]); }
  }

  async function undoLastAction() {
    try {
      const undone = await invoke<any>('undo_last_mod_action', { instanceId });
      if (undone) { await loadMods(true); await loadHistory(); }
    } catch (e: any) { setError(e?.toString() ?? 'Не удалось отменить последнее действие'); }
  }

  async function importPaths(paths: string[]) {
    if (!paths.length) return;
    try {
      // A Modrinth pack is an instance archive, not ordinary content. Route it
      // through the real importer so its manifest, overrides and dependencies
      // are processed and a launchable instance is created.
      const mrpack = paths.find(path => /\.mrpack$/i.test(path));
      if (mrpack) {
        const imported = await invoke<any>('import_modrinth_pack', { mrpackPath: mrpack });
        if (imported?.id) {
          navigate('/library');
          return;
        }
      }
      await invoke('instance_drop_files', {
        instanceId,
        files: paths,
        targetDir: mainTab === 'files' ? (cwd || null) : null,
      });
      await Promise.all([loadMods(), loadFiles(cwd)]);
    } catch (e: any) {
      setError(e?.toString() ?? 'Не удалось импортировать файлы');
    }
  }

  async function moveEntryIntoFolder(ev: React.DragEvent, toDir: string) {
    const from = ev.dataTransfer.getData('text/plain');
    if (!from) return;
    ev.preventDefault();
    ev.stopPropagation();
    try {
      await invoke('instance_move_path', { instanceId, from, toDir });
      await loadFiles(cwd);
    } catch (e: any) {
      setError(e?.toString() ?? 'Не удалось переместить файл');
    }
  }

  /** Drag&Drop конкретного мода/архива прямо в файловую систему сборки. */
  async function handleDrop(ev: React.DragEvent) {
    ev.preventDefault(); setDragOver(false);
    const paths: string[] = [];
    for (const item of Array.from(ev.dataTransfer.files || [])) {
      const p = (item as any).path as string | undefined;
      if (p) paths.push(p);
    }
    if (!paths.length) { setError('Перетащите файлы из Проводника или файлового менеджера'); return; }
    importPaths(paths);
  }

  function handleFilePicked(ev: React.ChangeEvent<HTMLInputElement>) {
    const paths: string[] = [];
    for (const f of Array.from(ev.target.files || [])) {
      const p = (f as any).path as string | undefined;
      if (p) paths.push(p);
    }
    ev.target.value = '';
    if (!paths.length) { setError('Не удалось получить путь к выбранному файлу'); return; }
    importPaths(paths);
  }

  const cardStyle = { background: 'var(--color-surface)', border: '1px solid var(--color-border)' } as const;
  const filteredScreenshots = useMemo(() => search ? screenshots.filter(s => s.name.toLowerCase().includes(search.toLowerCase())) : screenshots, [screenshots, search]);
  const searchCount = mainTab === 'content' ? mods.length : mainTab === 'worlds' ? worlds.length : mainTab === 'screenshots' ? screenshots.length : files.length;
  const searchLabel = mainTab === 'content' ? 'проектов' : mainTab === 'worlds' ? 'миров' : mainTab === 'screenshots' ? 'скриншотов' : 'файлов';

  const isEmpty = mainTab === 'content' ? contentFilter === 'deleted' ? deletedMods.length === 0 : visibleMods.length === 0
    : mainTab === 'worlds' ? filteredWorlds.length === 0
    : mainTab === 'screenshots' ? filteredScreenshots.length === 0
    : filteredFiles.length === 0;

  return (
    <div className="h-full flex flex-col min-h-0 relative"
      onDragOver={e => { e.preventDefault(); setDragOver(true); }}
      onDragLeave={() => setDragOver(false)}
      onDrop={handleDrop}>

      <input ref={fileInputRef} type="file" multiple className="hidden" onChange={handleFilePicked} />

      {/* Main tabs */}
      <div className="flex items-center gap-4 px-4 pt-3 shrink-0" style={{ borderBottom: '1px solid var(--color-border)' }}>
        {MAIN_TABS.map(({ id, label, icon: Icon }) => (
          <button key={id} onClick={() => { setMainTab(id); setSearch(''); }}
            className="flex items-center gap-1.5 pb-2.5 px-1 text-sm font-semibold whitespace-nowrap transition-colors relative"
            style={{ color: mainTab === id ? 'var(--color-primary)' : 'var(--color-text-secondary)' }}>
            <Icon className="w-4 h-4" />{label}
            {mainTab === id && (
              <span className="absolute left-0 right-0 -bottom-px h-0.5 rounded-full" style={{ background: 'var(--color-primary)' }} />
            )}
          </button>
        ))}
      </div>

      {/* Toolbar */}
      <div className="flex items-center gap-2 px-4 py-3 shrink-0">
        {mainTab === 'files' && (
          <button onClick={() => { setCwd(''); loadFiles(''); }}
            className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0" style={cardStyle}>
            <Home className="w-4 h-4" style={{ color: 'var(--color-text-secondary)' }} />
          </button>
        )}
        <div className="flex-1 relative">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2" style={{ color: 'var(--color-text-tertiary)' }} />
          <input value={search} onChange={e => setSearch(e.target.value)}
            placeholder={`Найти среди ${searchCount} ${searchLabel}…`}
            className="w-full pl-9 pr-3 py-2.5 rounded-xl text-sm outline-none"
            style={{ ...cardStyle, color: 'var(--color-text)' }} />
        </div>
        {mainTab === 'content' && (
          <>
            <button onClick={() => fileInputRef.current?.click()}
              className="flex items-center gap-1.5 px-3.5 py-2.5 rounded-xl text-sm font-semibold whitespace-nowrap"
              style={cardStyle}>
              <FolderPlus className="w-4 h-4" style={{ color: 'var(--color-text-secondary)' }} />Добавить файлы
            </button>
            <button onClick={() => navigate('/gallery', { state:{ instanceId } })}
              className="w-9 h-9 rounded-xl flex items-center justify-center"
              title="Менеджер скриншотов" style={{ background:'var(--color-surface-2)', color:'var(--color-text-secondary)', border:'1px solid var(--color-border)' }}><Camera className="w-4 h-4" /></button>
            <button onClick={() => { setShowHistory(v => !v); if (!showHistory) loadHistory(); }}
              className="flex items-center gap-1.5 px-3 py-2.5 rounded-xl text-sm font-bold whitespace-nowrap"
              style={{ background:'var(--color-surface-2)', color:'var(--color-text-secondary)', border:'1px solid var(--color-border)' }}><History className="w-4 h-4" />История</button>
            <button onClick={undoLastAction} title="Откатить последнее действие"
              className="w-9 h-9 rounded-xl flex items-center justify-center"
              style={{ background:'var(--color-primary-dim)', color:'var(--color-primary)', border:'1px solid var(--color-border)' }}><Undo2 className="w-4 h-4" /></button>
            <button onClick={checkInstanceHealth} disabled={healthLoading}
              className="flex items-center gap-1.5 px-3.5 py-2.5 rounded-xl text-sm font-bold whitespace-nowrap disabled:opacity-60"
              style={{ background:'var(--color-surface-2)', color:'var(--color-text-secondary)', border:'1px solid var(--color-border)' }}>
              <ShieldAlert className={`w-4 h-4 ${healthLoading ? 'animate-pulse' : ''}`} style={{ color:'var(--color-warning)' }} />Проверить сборку
            </button>
            <button onClick={() => navigate(`/find-projects?instanceId=${instanceId}`)}
              className="flex items-center gap-1.5 px-3.5 py-2.5 rounded-xl text-sm font-bold whitespace-nowrap"
              style={{ background: 'var(--color-primary)', color: 'var(--color-primary-text)' }}>
              <Compass className="w-4 h-4" />Найти проекты
            </button>
          </>
        )}
        {mainTab === 'files' && (
          <button onClick={() => { loadFiles(cwd); }}
            className="flex items-center gap-1.5 px-3.5 py-2.5 rounded-xl text-sm font-semibold whitespace-nowrap"
            style={cardStyle}>
            <RefreshCw className="w-3.5 h-3.5" style={{ color: 'var(--color-text-secondary)' }} />Перезагрузить
          </button>
        )}
      </div>

      {/* Filter row */}
      {mainTab === 'content' && (
        <div className="flex items-center gap-2 px-4 pb-3 shrink-0 overflow-x-auto">
          {contentFilters.map(f => (
            <button key={f.id} onClick={() => setContentFilter(f.id)}
              className="px-3 py-1.5 rounded-full text-xs font-bold whitespace-nowrap transition-colors"
              style={contentFilter === f.id
                ? { background: 'var(--color-primary-dim)', color: 'var(--color-primary)', border: '1px solid var(--color-primary)' }
                : { color: 'var(--color-text-secondary)', border: '1px solid var(--color-border)' }}>
              {f.label}
            </button>
          ))}
          <button className="ml-auto flex items-center gap-1 text-xs font-semibold whitespace-nowrap"
            style={{ color: 'var(--color-text-secondary)' }}>
            <ArrowUpDown className="w-3 h-3" />По алфавиту
          </button>
        </div>
      )}
      {mainTab === 'worlds' && (
        <div className="flex items-center gap-2 px-4 pb-3 shrink-0">
          <span className="px-3 py-1.5 rounded-full text-xs font-bold"
            style={{ background: 'var(--color-primary-dim)', color: 'var(--color-primary)', border: '1px solid var(--color-primary)' }}>
            Всё
          </span>
        </div>
      )}

      {error && <div className="px-4 pb-2 text-xs shrink-0" style={{ color: 'var(--color-error)' }}>{error}</div>}
      {loading && <div className="px-4 pb-2 text-xs shrink-0" style={{ color: 'var(--color-text-secondary)' }}>Загрузка…</div>}
      {mainTab === 'content' && showHistory && (
        <div className="mx-4 mb-3 rounded-xl overflow-hidden shrink-0" style={{ background:'var(--color-surface)', border:'1px solid var(--color-border)' }}>
          <div className="px-3 py-2 text-xs font-bold" style={{ color:'var(--color-text)' }}>История изменений</div>
          {history.length ? history.slice().reverse().slice(0, 6).map((entry, index) => <p key={index} className="px-3 pb-2 text-[11px]" style={{ color:'var(--color-text-secondary)' }}>{entry.action === 'remove' ? 'Удалено' : entry.action === 'toggle' ? 'Изменён статус' : entry.action} · <b>{entry.file_name}</b></p>) : <p className="px-3 pb-3 text-[11px]" style={{ color:'var(--color-text-tertiary)' }}>Пока нет операций, которые можно откатить.</p>}
        </div>
      )}
      {mainTab === 'content' && duplicateGroups.length > 0 && (
        <div className="mx-4 mb-3 rounded-xl overflow-hidden shrink-0" style={{ background:'var(--color-surface)', border:'1px solid var(--color-danger, #E74C3C)' }}>
          <div className="flex items-center gap-2 px-3 py-2 text-xs font-bold" style={{ color:'var(--color-danger, #E74C3C)' }}>
            <ShieldAlert className="w-4 h-4" /> Найдены дубликаты модов — выберите версию, которую оставить
          </div>
          <div className="px-3 pb-3 space-y-3">
            {duplicateGroups.map(group => (
              <div key={group.key} className="rounded-lg p-2" style={{ background:'var(--color-surface-2)', border:'1px solid var(--color-border)' }}>
                <div className="text-xs font-bold mb-2" style={{ color:'var(--color-text)' }}>{group.name}</div>
                <div className="space-y-1.5">
                  {group.entries.map(entry => (
                    <div key={entry.id} className="flex items-center gap-2 rounded-lg px-2 py-1.5" style={{ background:'var(--color-surface)' }}>
                      <span className="flex-1 min-w-0 text-[11px] truncate font-mono" style={{ color:'var(--color-text-secondary)' }}>{entry.fileName || entry.name}</span>
                      <span className="text-[10px] shrink-0" style={{ color:'var(--color-text-tertiary)' }}>{entry.installedVersion || 'версия не указана'}</span>
                      <button disabled={duplicateBusy === group.key || !entry.fileName} onClick={() => keepDuplicateVersion(group.key, entry)} className="shrink-0 px-2 py-1 rounded-md text-[10px] font-bold disabled:opacity-50" style={{ background:'var(--color-primary)', color:'var(--color-primary-text)' }}>
                        {duplicateBusy === group.key ? 'Удаление…' : 'Оставить эту'}
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {mainTab === 'content' && healthChecked && (
        <div className="mx-4 mb-3 rounded-xl overflow-hidden shrink-0" style={{ background:'var(--color-surface)', border:`1px solid ${conflicts.length ? 'var(--color-warning)' : 'var(--color-border)'}` }}>
          <div className="flex items-center gap-2 px-3 py-2 text-xs font-bold" style={{ color:conflicts.length ? 'var(--color-warning)' : 'var(--color-success)' }}>
            {conflicts.length ? <ShieldAlert className="w-4 h-4" /> : <CheckCircle2 className="w-4 h-4" />}{conflicts.length ? `Найдено конфликтов: ${conflicts.length}` : 'Проверка завершена: конфликтов не найдено'}
          </div>
          {conflicts.slice(0, 3).map((conflict, index) => <div key={index} className="border-t px-3 py-2 text-[11px]" style={{ borderColor:'var(--color-border)' }}>
            <p style={{ color:'var(--color-text-secondary)' }}><b style={{ color:'var(--color-warning)' }}>{conflict.mod_a}</b> <span aria-hidden>×</span> <b style={{ color:'var(--color-warning)' }}>{conflict.mod_b}</b> — {conflict.reason}</p>
            <p className="mt-1" style={{ color:'var(--color-text-tertiary)' }}>Действие: обновите один из этих модов до совместимой версии или временно отключите один из них. Перед запуском проверьте версию Minecraft и загрузчик сборки.</p>
          </div>)}
        </div>
      )}

      <div className="flex-1 min-h-0 overflow-y-auto scroll-area px-4" style={{ paddingBottom: selectedModIds.size ? 104 : 32 }}>
        {/* ---------- Content ---------- */}
        {mainTab === 'content' && contentFilter !== 'deleted' && (
          <div className="rounded-2xl overflow-hidden" style={cardStyle}>
            <div className="flex items-center gap-3 px-3 py-2 text-[11px] font-bold uppercase tracking-wide"
              style={{ color: 'var(--color-text-tertiary)', borderBottom: '1px solid var(--color-border)' }}>
              <input
                type="checkbox"
                aria-label="Выбрать все видимые элементы"
                checked={visibleMods.length > 0 && visibleMods.every(mod => selectedModIds.has(mod.id))}
                ref={node => { if (node) node.indeterminate = selectedModIds.size > 0 && !visibleMods.every(mod => selectedModIds.has(mod.id)); }}
                onChange={toggleAllVisibleMods}
                className="w-4 h-4 shrink-0 accent-[var(--color-primary)]"
              />
              <span className="flex-1">Проект</span>
              <span className="w-24 shrink-0">Версия</span>
              <span className="w-24 shrink-0 text-right">Действия</span>
            </div>
            {visibleMods.map((m, i) => (
              <div key={m.id} className="flex items-center gap-3 px-3 py-2.5"
                style={{ borderBottom: i < visibleMods.length - 1 ? '1px solid var(--color-border)' : 'none' }}>
                <input
                  type="checkbox"
                  aria-label={`Выбрать ${m.name}`}
                  checked={selectedModIds.has(m.id)}
                  onChange={() => toggleSelectedMod(m.id)}
                  className="w-4 h-4 shrink-0 accent-[var(--color-primary)]"
                />
                <div className="flex items-center gap-2.5 flex-1 min-w-0">
                  <div className="w-9 h-9 rounded-lg overflow-hidden shrink-0 flex items-center justify-center"
                    style={{ background: 'var(--color-surface-2)' }}>
                    {m.icon
                      ? <img src={m.icon} alt={m.name} className="w-full h-full object-cover"
                          onError={e => { (e.target as HTMLImageElement).style.display = 'none'; }} />
                      : <span className="text-sm font-black" style={{ color: 'var(--color-text-secondary)' }}>
                          {m.name.charAt(0).toUpperCase()}
                        </span>}
                  </div>
                  <div className="min-w-0">
                    <p className="text-sm font-semibold truncate" style={{ color: 'var(--color-text)' }}>{m.name}</p>
                    <AuthorLink author={m.author} authorId={m.authorId} source={m.source} />
                  </div>
                </div>
                <div className="w-24 shrink-0 text-xs truncate" style={{ color: 'var(--color-text-secondary)' }}>
                  {progressMap[m.id] ? `${progressMap[m.id].percent}%` : (m.installedVersion ?? '—')}
                  {m.updateAvailable && !progressMap[m.id] && (
                    <div className="text-[10px]" style={{ color: 'var(--color-primary)' }}>→ {m.latestVersion}</div>
                  )}
                </div>
                <div className="w-24 shrink-0 flex items-center justify-end gap-2">
                  {m.updateAvailable && (
                    <button onClick={async () => {
                        try {
                          const result = await invoke<any[]>('update_all_mods', { instanceId, modId: m.id });
                          const failed = Array.isArray(result) ? result.filter(item => !item.success) : [];
                          if (failed.length) console.error('Mod update failed:', failed[0]?.error ?? 'Unknown update error');
                          await loadMods(true);
                        } catch (error) {
                          console.error('Mod update failed:', error);
                        }
                      }}
                      className="p-1.5 rounded-lg" style={{ background: 'var(--color-primary-dim)', color: 'var(--color-primary)' }} title="Обновить">
                      <RefreshCw className="w-3.5 h-3.5" />
                    </button>
                  )}
                  <Toggle checked={m.enabled !== false} onChange={() => handleToggle(m)} />
                  <button onClick={() => handleRemove(m)} className="p-1.5 rounded-lg"
                    style={{ background: 'rgba(231,76,60,0.1)', color: 'var(--color-error)' }} title="Удалить">
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}

        {mainTab === 'content' && contentFilter === 'deleted' && (
          <div className="rounded-2xl overflow-hidden" style={cardStyle}>
            <div className="flex items-center gap-3 px-3 py-3" style={{ borderBottom:'1px solid var(--color-border)' }}>
              <Trash2 className="w-4 h-4" style={{ color:'var(--color-error)' }} />
              <div><p className="text-sm font-bold" style={{ color:'var(--color-text)' }}>Удалённые модификации</p><p className="text-[11px]" style={{ color:'var(--color-text-secondary)' }}>Файлы можно восстановить в сборку или удалить окончательно.</p></div>
            </div>
            {deletedMods.map((mod, index) => (
              <div key={mod.id} className="flex items-center gap-3 px-3 py-3" style={{ borderBottom:index < deletedMods.length - 1 ? '1px solid var(--color-border)' : 'none' }}>
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg" style={{ background:'rgba(231,76,60,0.10)', color:'var(--color-error)' }}><Package className="w-4 h-4" /></div>
                <div className="min-w-0 flex-1"><p className="truncate text-sm font-semibold" style={{ color:'var(--color-text)' }}>{mod.file_name}</p><p className="text-[10px]" style={{ color:'var(--color-text-tertiary)' }}>{mod.mod_type} · удалено {fmtDate(mod.timestamp)}{mod.was_disabled ? ' · было выключено' : ''}</p></div>
                <button onClick={async () => { try { await invoke('restore_deleted_mod', { instanceId, id: mod.id }); await Promise.all([loadDeletedMods(), loadMods(true)]); } catch (e: any) { setError(e?.toString() ?? 'Не удалось восстановить файл'); } }} className="rounded-xl px-3 py-2 text-xs font-bold" style={{ background:'var(--color-primary)', color:'var(--color-primary-text)' }}>Восстановить</button>
                <button onClick={async () => { try { await invoke('permanently_delete_deleted_mod', { instanceId, id: mod.id }); await loadDeletedMods(); } catch (e: any) { setError(e?.toString() ?? 'Не удалось удалить файл окончательно'); } }} className="rounded-xl px-3 py-2 text-xs font-bold" style={{ background:'rgba(231,76,60,0.10)', color:'var(--color-error)' }}>Удалить</button>
              </div>
            ))}
          </div>
        )}

        {/* ---------- Worlds & Servers ---------- */}
        {mainTab === 'worlds' && (
          <div className="space-y-2">
            {filteredWorlds.map(w => {
              const worldIcon = toIconSrc(w.icon);
              return (
              <div key={w.folder} className="p-3 rounded-2xl flex items-center justify-between gap-3" style={cardStyle}>
                <div className="flex items-center gap-3 min-w-0">
                  <div className="w-12 h-12 rounded-xl overflow-hidden shrink-0 flex items-center justify-center"
                    title={w.icon ? 'Превью мира из Minecraft' : 'Minecraft не создал icon.png для этого мира'}
                    style={{ background: 'linear-gradient(145deg, var(--color-surface-2), var(--color-surface))', border: '1px solid var(--color-border)' }}>
                    {worldIcon
                      ? <>
                          <img src={worldIcon} alt={`Превью мира ${w.name}`}
                            className="w-full h-full object-cover" style={{ imageRendering: 'pixelated' }}
                            onError={e => {
                              e.currentTarget.style.display = 'none';
                              const fallback = e.currentTarget.parentElement?.querySelector<SVGElement>('[data-world-fallback]');
                              if (fallback) fallback.style.display = 'block';
                            }} />
                          <Globe data-world-fallback className="w-5 h-5" style={{ color: 'var(--color-text-tertiary)', display: 'none' }} />
                        </>
                      : <Globe className="w-5 h-5" style={{ color: 'var(--color-text-tertiary)' }} />}
                  </div>
                  <div className="min-w-0">
                    <p className="text-sm font-semibold truncate" style={{ color: 'var(--color-text)' }}>{w.name}</p>
                    <div className="flex items-center gap-1.5 text-[11px]" style={{ color: 'var(--color-text-tertiary)' }}>
                      <span>Одиночная игра</span>
                      {fmtAgo(w.last_played) && <span>· Сыграно {fmtAgo(w.last_played)}</span>}
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-3 shrink-0">
                  <GameModeBadge mode={w.game_mode} hardcore={w.hardcore} />
                  <button onClick={() => invoke('launch_instance', { instanceId, quickPlay: { world: w.folder } }).catch(e => setError(String(e)))}
                    className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl text-xs font-bold"
                    style={{ background: 'var(--color-surface-2)', color: 'var(--color-text)', border: '1px solid var(--color-border)' }}>
                    Играть
                  </button>
                  <button onClick={() => invoke('instance_delete_world', { instanceId, folder: w.folder }).then(loadWorlds)}
                    className="p-1.5 rounded-lg" style={{ background: 'rgba(231,76,60,0.1)', color: 'var(--color-error)' }}>
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            );
            })}
          </div>
        )}

        {/* ---------- Screenshots ---------- */}
        {mainTab === 'screenshots' && (
          <div className="space-y-4">
            <div className="flex items-center justify-between rounded-2xl px-4 py-3" style={cardStyle}>
              <div><p className="text-sm font-bold" style={{ color:'var(--color-text)' }}>Скриншоты</p><p className="text-xs" style={{ color:'var(--color-text-secondary)' }}>{screenshots.length} изображений в .minecraft/screenshots</p></div>
              <div className="flex items-center gap-2"><button onClick={() => invoke('instance_open_dir', { instanceId, path:'screenshots' }).catch(() => {})} className="flex items-center gap-1.5 rounded-xl px-3 py-2 text-xs font-bold" style={{ background:'var(--color-surface-2)', color:'var(--color-text-secondary)', border:'1px solid var(--color-border)' }}><Folder className="h-3.5 w-3.5" />Показать в папке</button><button onClick={loadScreenshots} className="rounded-xl p-2" style={{ background:'var(--color-surface-2)', color:'var(--color-text-secondary)', border:'1px solid var(--color-border)' }} title="Обновить"><RefreshCw className="h-3.5 w-3.5" /></button></div>
            </div>
            {filteredScreenshots.length === 0 ? <div className="flex flex-col items-center justify-center rounded-2xl py-20" style={cardStyle}><Camera className="mb-3 h-10 w-10" style={{ color:'var(--color-text-tertiary)' }} /><p className="text-sm font-bold" style={{ color:'var(--color-text)' }}>Скриншотов пока нет</p><p className="mt-1 text-xs" style={{ color:'var(--color-text-secondary)' }}>Нажми F2 в Minecraft, затем обнови список.</p></div> : <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">{filteredScreenshots.map(s => <button key={s.path} onClick={() => setSelectedScreenshot(s)} className="group overflow-hidden rounded-2xl text-left transition-transform hover:-translate-y-0.5" style={cardStyle}><div className="aspect-video overflow-hidden" style={{ background:'var(--color-surface-2)' }}><img src={s.url} alt={s.name} className="h-full w-full object-cover transition-transform group-hover:scale-[1.03]" /></div><div className="flex items-center gap-2 px-3 py-2"><span className="min-w-0 flex-1 truncate text-xs font-semibold" style={{ color:'var(--color-text)' }}>{s.name}</span><Camera className="h-3.5 w-3.5 shrink-0" style={{ color:'var(--color-primary)' }} /></div></button>)}</div>}
          </div>
        )}

        {/* ---------- Files ---------- */}
        {mainTab === 'files' && (
          <div className="rounded-2xl overflow-hidden" style={cardStyle}>
            {cwd && (
              <div className="flex items-center gap-2 px-3 py-2 text-xs" style={{ borderBottom: '1px solid var(--color-border)', color: 'var(--color-text-secondary)' }}>
                <button onClick={() => { setCwd(''); loadFiles(''); }} className="font-bold" style={{ color: 'var(--color-primary)' }}>.minecraft</button>
                <span>/ {cwd}</span>
                <button onClick={() => { const parent = cwd.split('/').slice(0, -1).join('/'); setCwd(parent); loadFiles(parent); }}
                  className="ml-auto px-2 py-1 rounded-md" style={{ background: 'var(--color-surface-2)' }}>Вверх</button>
              </div>
            )}
            <div className="flex items-center gap-3 px-3 py-2 text-[11px] font-bold uppercase tracking-wide"
              style={{ color: 'var(--color-text-tertiary)', borderBottom: '1px solid var(--color-border)' }}>
              <span className="flex-1">Имя</span>
              <span className="w-28 shrink-0 text-right">Размер · {fmtSize(visibleFilesSize)}</span>
              <span className="w-28 shrink-0">Изменён</span>
              <span className="w-16 shrink-0 text-right">Действия</span>
            </div>
            {filteredFiles.map((f, i) => (
              <div key={f.path} draggable
                onDragStart={e => { e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', f.path); }}
                onDragOver={e => { if (f.is_dir && e.dataTransfer.types.includes('text/plain')) { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; } }}
                onDrop={e => { if (f.is_dir) void moveEntryIntoFolder(e, f.path); }}
                className="flex items-center gap-3 px-3 py-2"
                style={{ borderBottom: i < filteredFiles.length - 1 ? '1px solid var(--color-border)' : 'none', outline: f.is_dir ? '1px solid transparent' : undefined }}>
                <button className="flex items-center gap-2.5 flex-1 min-w-0 text-left"
                  onClick={() => { if (f.is_dir) { setCwd(f.path); loadFiles(f.path); } }}>
                  {fileIconFor(f)}
                  <span className="text-sm truncate" style={{ color: 'var(--color-text)' }}>{f.name}</span>
                </button>
                <span className="w-28 shrink-0 text-right text-xs tabular-nums" style={{ color: f.is_dir ? 'var(--color-text-tertiary)' : 'var(--color-text-secondary)' }}>
                  {f.is_dir ? 'Папка' : fmtSize(f.size)}
                </span>
                <span className="w-28 shrink-0 text-xs" style={{ color: 'var(--color-text-tertiary)' }}>
                  {fmtDate(f.modified)}
                </span>
                <div className="w-24 shrink-0 flex justify-end gap-1">
                  {!f.is_dir && (f.kind === 'text' || /\.(json|toml|cfg|properties|txt|log|css|js|ts|mcmeta|yaml|yml)$/i.test(f.name)) && (
                    <button onClick={() => openEditor(f.path)} title="Edit file"
                      className="p-1.5 rounded-lg" style={{ background: 'var(--color-primary-dim)', color: 'var(--color-primary)' }}>
                      <Edit3 className="w-3.5 h-3.5" />
                    </button>
                  )}
                  <button onClick={() => invoke('instance_delete_path', { instanceId, path: f.path }).then(() => loadFiles(cwd))}
                    className="p-1.5 rounded-lg" style={{ background: 'rgba(231,76,60,0.1)', color: 'var(--color-error)' }}>
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}

        {!loading && !error && isEmpty && (
          <div className="flex flex-col items-center py-14 gap-2">
            <Upload className="w-6 h-6" style={{ color: 'var(--color-text-tertiary)' }} />
            <p className="text-sm" style={{ color: 'var(--color-text-secondary)' }}>Здесь пока ничего нет</p>
            <p className="text-xs" style={{ color: 'var(--color-text-tertiary)' }}>
              Перетащите файлы сюда, чтобы добавить их в эту сборку
            </p>
          </div>
        )}
      </div>

      <AnimatePresence>
        {dragOver && (
          <motion.div
            key="drop-zone"
            className="pointer-events-none absolute inset-2 z-30 flex items-center justify-center rounded-3xl border-2 border-dashed p-6 backdrop-blur-sm"
            initial={{ opacity: 0, scale: 0.985, y: 10, borderColor: 'color-mix(in srgb, var(--color-primary) 20%, transparent)' }}
            animate={{ opacity: 1, scale: 1, y: 0, borderColor: 'var(--color-primary)' }}
            exit={{ opacity: 0, scale: 0.99, y: 6 }}
            transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
            style={{ background: 'color-mix(in srgb, var(--color-primary) 14%, var(--color-surface) 82%)', boxShadow: '0 0 0 0 color-mix(in srgb, var(--color-primary) 0%, transparent)' }}
          >
            <motion.span
              className="absolute inset-3 rounded-[1.35rem]"
              initial={{ opacity: 0, scale: 0.94 }}
              animate={{ opacity: [0.2, 0.52, 0.2], scale: [0.94, 1.015, 0.94] }}
              transition={{ duration: 1.8, repeat: Infinity, ease: 'easeInOut' }}
              style={{ boxShadow: '0 0 44px 10px color-mix(in srgb, var(--color-primary) 20%, transparent)' }}
            />
            <div className="relative flex max-w-sm flex-col items-center text-center">
              <motion.span
                className="mb-3 flex h-14 w-14 items-center justify-center rounded-2xl"
                initial={{ opacity: 0, scale: 0.72, y: 10, rotate: -7 }}
                animate={{ opacity: 1, scale: [1, 1.06, 1], y: [0, -5, 0], rotate: 0 }}
                transition={{ opacity: { duration: 0.16 }, scale: { duration: 1.7, repeat: Infinity, ease: 'easeInOut' }, y: { duration: 1.7, repeat: Infinity, ease: 'easeInOut' }, rotate: { duration: 0.24 } }}
                style={{ background: 'var(--color-primary-dim)', color: 'var(--color-primary)', border: '1px solid var(--color-primary)', boxShadow: '0 10px 28px color-mix(in srgb, var(--color-primary) 22%, transparent)' }}
              ><Upload className="h-7 w-7" /></motion.span>
              <motion.p initial={{ opacity: 0, y: 5 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.08, duration: 0.2 }} className="text-base font-black" style={{ color: 'var(--color-text)' }}>Отпустите файлы здесь</motion.p>
              <motion.p initial={{ opacity: 0, y: 5 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.13, duration: 0.2 }} className="mt-1 text-xs" style={{ color: 'var(--color-text-secondary)' }}>Они будут добавлены в <strong style={{ color: 'var(--color-primary)' }}>{mainTab === 'files' ? (cwd || '.minecraft') : 'нужную папку сборки'}</strong></motion.p>
              <motion.p initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.18, duration: 0.25 }} className="mt-3 text-[10px]" style={{ color: 'var(--color-text-tertiary)' }}>Моды · ресурспаки · шейдеры · `.mrpack` · конфигурации</motion.p>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {mainTab === 'content' && contentFilter !== 'deleted' && selectedMods.length > 0 && (
        <div
          className="absolute bottom-4 left-1/2 z-30 flex max-w-[calc(100%-2rem)] -translate-x-1/2 items-center gap-1.5 rounded-2xl p-2 shadow-xl"
          style={{ background:'var(--color-surface-2)', border:'1px solid var(--color-border)', boxShadow:'var(--shadow-lg)' }}
          role="toolbar"
          aria-label="Действия с выбранными элементами"
        >
          <span className="px-2.5 text-xs font-bold whitespace-nowrap" style={{ color:'var(--color-text)' }}>
            Выбрано: {selectedMods.length}
          </span>
          <span className="h-5 w-px" style={{ background:'var(--color-border)' }} />
          <button onClick={() => setSelectedModIds(new Set())} className="px-2.5 py-2 rounded-xl text-xs font-semibold whitespace-nowrap hover:bg-white/5" style={{ color:'var(--color-text-secondary)' }}>
            Очистить
          </button>
          <button onClick={() => void setSelectedModsEnabled(true)} className="px-2.5 py-2 rounded-xl text-xs font-semibold whitespace-nowrap hover:bg-white/5" style={{ color:'var(--color-text-secondary)' }}>
            Включить
          </button>
          <button onClick={() => void setSelectedModsEnabled(false)} className="px-2.5 py-2 rounded-xl text-xs font-semibold whitespace-nowrap hover:bg-white/5" style={{ color:'var(--color-text-secondary)' }}>
            Отключить
          </button>
          <span className="h-5 w-px" style={{ background:'var(--color-border)' }} />
          <button onClick={() => void removeSelectedMods()} className="flex items-center gap-1.5 px-2.5 py-2 rounded-xl text-xs font-bold whitespace-nowrap" style={{ color:'var(--color-error)', background:'rgba(231,76,60,0.10)' }}>
            <Trash2 className="w-3.5 h-3.5" />Удалить
          </button>
        </div>
      )}

      {selectedScreenshot && (
        <div className="fixed inset-0 z-[220] flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm" onClick={() => setSelectedScreenshot(null)}>
          <div className="flex max-h-[calc(100vh-2rem)] w-full max-w-6xl flex-col overflow-hidden rounded-2xl" style={{ background:'var(--color-surface)', border:'1px solid var(--color-border)' }} onClick={e => e.stopPropagation()}>
            <div className="flex items-center gap-3 border-b px-4 py-3" style={{ borderColor:'var(--color-border)' }}><Camera className="h-4 w-4" style={{ color:'var(--color-primary)' }} /><p className="min-w-0 flex-1 truncate text-sm font-bold" style={{ color:'var(--color-text)' }}>{selectedScreenshot.name}</p><button onClick={() => navigator.clipboard?.writeText(selectedScreenshot.path)} className="rounded-lg px-2.5 py-1.5 text-xs font-semibold" style={{ background:'var(--color-surface-2)', color:'var(--color-text-secondary)' }}>Копировать путь</button><button onClick={() => invoke('instance_open_dir', { instanceId, path:'screenshots' }).catch(() => {})} className="rounded-lg px-2.5 py-1.5 text-xs font-semibold" style={{ background:'var(--color-surface-2)', color:'var(--color-text-secondary)' }}>Показать в папке</button><button onClick={() => setSelectedScreenshot(null)} className="rounded-lg p-1.5" style={{ color:'var(--color-text-secondary)' }}><X className="h-4 w-4" /></button></div>
            <div className="relative flex min-h-0 flex-1 items-center justify-center overflow-hidden p-5" style={{ background:'radial-gradient(circle, var(--color-surface-2), var(--color-bg))' }}>
              {screenshots.length > 1 && <button onClick={() => selectScreenshotOffset(-1)} title="Предыдущий скриншот" className="absolute left-6 z-10 grid h-14 w-14 place-items-center rounded-2xl transition-transform hover:scale-105 active:scale-95" style={{ background:'color-mix(in srgb, var(--color-surface) 86%, transparent)', border:'1px solid var(--color-border)', color:'var(--color-text)', boxShadow:'var(--shadow-md)' }}><ChevronLeft className="h-8 w-8" /></button>}
              <img src={selectedScreenshot.url} alt={selectedScreenshot.name} className="max-h-[calc(100vh-11rem)] max-w-[calc(100vw-10rem)] rounded-xl object-contain shadow-2xl" />
              {screenshots.length > 1 && <button onClick={() => selectScreenshotOffset(1)} title="Следующий скриншот" className="absolute right-6 z-10 grid h-14 w-14 place-items-center rounded-2xl transition-transform hover:scale-105 active:scale-95" style={{ background:'color-mix(in srgb, var(--color-surface) 86%, transparent)', border:'1px solid var(--color-border)', color:'var(--color-text)', boxShadow:'var(--shadow-md)' }}><ChevronRight className="h-8 w-8" /></button>}
            </div>
            <div className="flex items-center justify-center gap-2 border-t px-4 py-3" style={{ borderColor:'var(--color-border)' }}><button onClick={() => setEditorScreenshot(selectedScreenshot)} className="flex items-center gap-1.5 rounded-xl px-4 py-2 text-xs font-bold" style={{ background:'var(--color-primary)', color:'var(--color-primary-text)' }}><Edit3 className="h-3.5 w-3.5" />Редактировать</button><button onClick={async () => { await invoke('delete_instance_screenshot', { id: instanceId, fileName: selectedScreenshot.name }); setSelectedScreenshot(null); await loadScreenshots(); }} className="flex items-center gap-1.5 rounded-xl px-4 py-2 text-xs font-bold" style={{ background:'rgba(231,76,60,.12)', color:'var(--color-error)' }}><Trash2 className="h-3.5 w-3.5" />Удалить</button></div>
          </div>
        </div>
      )}

      {editorScreenshot && (
        <ScreenshotEditor
          instanceId={instanceId}
          fileName={editorScreenshot.name}
          imageUrl={editorScreenshot.url}
          onClose={() => setEditorScreenshot(null)}
          onSaved={async () => { setEditorScreenshot(null); setSelectedScreenshot(null); await loadScreenshots(); }}
        />
      )}

    </div>
  );
}

export default InstanceMods;

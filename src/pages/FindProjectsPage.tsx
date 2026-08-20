import { useState, useEffect, useRef, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  Search, Download, Star, X, ChevronDown, Grid, List,
  Package, Sparkles, Database, SlidersHorizontal, RefreshCw, AlertCircle, TriangleAlert,
  Image as ImageIcon, ArrowLeft, Check, Wifi, Compass, Wrench, Shield, BookOpen, Skull, Gauge, Globe2, Utensils, Archive, Map, Gamepad2, Palette,
} from 'lucide-react';
import { useSettingsStore } from '@/stores/settingsStore';
import { useInstanceStore } from '@/stores/instanceStore';
import { useInstalledStore, useIsInstalled } from '@/stores/installedStore';
import { triggerInstallEffect } from '@/components/InstallEffectOverlay';
import curseforgeAnvil from '@/assets/curseforge-anvil.png';
import modrinthWrench from '@/assets/modrinth-wrench-clean.png';
import { invoke } from '@/lib/invoke-shim';
import { getModrinthVersionsGateway, searchModrinthGateway } from '@/lib/modrinth-gateway';
import { toIconSrc } from '@/lib/icon-src';
import { consumeSearchReturn, targetSearchScroll } from '@/lib/search-navigation';
import { useUiStore } from '@/stores/uiStore';
import { useLaunchStore } from '@/stores/launchStore';

type ProjectType = 'mods' | 'resourcepacks' | 'shaders';
type SortOrder = 'relevance' | 'downloads' | 'follows' | 'newest' | 'updated';
type Platform = 'modrinth' | 'curseforge';
type FindProjectsFilterSnapshot = {
  platform?: Platform;
  projectType?: ProjectType;
  showFilters?: boolean;
  selectedCats?: string[];
  selectedLoaders?: string[];
  selectedVersions?: string[];
};

function findProjectsFilterKey(instanceId: string) {
  return `portal-find-projects-filters:${instanceId || 'global'}`;
}

function readFindProjectsFilters(instanceId: string): FindProjectsFilterSnapshot {
  try {
    const raw = sessionStorage.getItem(findProjectsFilterKey(instanceId));
    return raw ? JSON.parse(raw) as FindProjectsFilterSnapshot : {};
  } catch {
    return {};
  }
}

function ModrinthLogo({ size = 16 }: { size?: number }) {
  return <img src={modrinthWrench} width={size} height={size} alt="Modrinth" className="shrink-0 object-contain" />;
}

interface ModrinthHit {
  project_id: string; slug: string; title: string; description: string;
  author: string; downloads: number; follows: number; icon_url?: string;
  categories: string[]; game_versions: string[]; loaders: string[];
  date_modified: string; color?: number;
}
interface ModrinthResult { hits: ModrinthHit[]; total_hits: number; }
interface CfMod {
  id: number; name: string; summary: string;
  authors: { id?: number; name: string }[];
  download_count: number; thumbs_up_count: number;
  logo?: { thumbnail_url: string };
  categories: { name: string }[];
  latest_files_indexes: { game_version: string; mod_loader_type: number }[];
  date_modified: string; slug: string;
}
interface CfResult { data: CfMod[]; pagination: { total_count: number }; reachable_count?: number; capped?: boolean }
interface Project {
  id: string; slug: string; title: string; description: string;
  author: string; authorId?: number; downloads: number; follows: number; iconUrl?: string;
  categories: string[]; gameVersions: string[]; loaders: string[];
  dateModified: string; platform: Platform; projectType: ProjectType;
  color?: string;
}

type FindProjectsCache = {
  savedAt: number;
  results: Project[];
  total: number;
  reachableTotal: number | null;
  capped: boolean;
};
const FIND_PROJECTS_CACHE_TTL = 5 * 60_000;
const FIND_PROJECTS_STALE_TTL = 30 * 60_000;
function findProjectsCacheKey(query: string, pt: ProjectType, pl: Platform, sort: SortOrder, page: number, cats: string[], loaders: string[], versions: string[]) {
  return `portal-find-projects-cache:v2:${JSON.stringify({ query, pt, pl, sort, page, cats, loaders, versions })}`;
}
function readFindProjectsCache(key: string): FindProjectsCache | null {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const entry = JSON.parse(raw) as FindProjectsCache;
    return Array.isArray(entry.results) && Date.now() - entry.savedAt < FIND_PROJECTS_STALE_TTL ? entry : null;
  } catch { return null; }
}
function writeFindProjectsCache(key: string, entry: FindProjectsCache) {
  try { localStorage.setItem(key, JSON.stringify(entry)); } catch { /* storage can be unavailable in privacy mode */ }
}

const TYPE_DEFS: Record<ProjectType, { modrinthFacet: string; cfClass: number; labelKey: string; icon: any }> = {
  mods:          { modrinthFacet: 'mod',          cfClass: 6,    labelKey: 'mods',          icon: Package },
  resourcepacks: { modrinthFacet: 'resourcepack', cfClass: 12,   labelKey: 'resourcePacks', icon: ImageIcon },
  shaders:       { modrinthFacet: 'shader',       cfClass: 6552, labelKey: 'shaders',       icon: Sparkles },
};
const SORT_OPTIONS = [
  { value:'relevance', labelKey:'relevance' },
  { value:'downloads', labelKey:'downloads' },
  { value:'follows',   labelKey:'follows' },
  { value:'newest',    labelKey:'newest' },
  { value:'updated',   labelKey:'updated' },
];
const CF_LOADER_MAP: Record<string, number> = { forge:1, fabric:4, quilt:5, neoforge:6, vanilla:0 };

const MODRINTH_CATS: Record<ProjectType, string[]> = {
  mods:          ['Adventure','Cursed','Decoration','Economy','Equipment','Food','Game Mechanics','Library','Magic','Mobs','Optimization','Storage','Technology','Transportation','Utility','World Generation'],
  resourcepacks: ['8x – 16x','32x','64x','128x and above','Alternate','Animated','Realistic','Themed','Vanilla-like'],
  shaders:       ['Atmosphere','Cartoon','Realistic','Semi-Realistic','Vanilla-like'],
};

// Modrinth facets use stable slugs, not the human-readable labels shown in the sidebar.
const MODRINTH_CATEGORY_SLUGS: Record<ProjectType, Record<string, string>> = {
  mods: {
    'Game Mechanics': 'game-mechanics', 'World Generation': 'world-gen',
    'Cursed': 'cursed', 'Adventure': 'adventure', 'Decoration': 'decoration',
    'Economy': 'economy', 'Equipment': 'equipment', 'Food': 'food', 'Library': 'library',
    'Magic': 'magic', 'Mobs': 'mobs', 'Optimization': 'optimization', 'Storage': 'storage',
    'Technology': 'technology', 'Transportation': 'transportation', 'Utility': 'utility',
  },
  resourcepacks: {
    '8x – 16x': '8x', '32x': '32x', '64x': '64x', '128x and above': '128x',
    'Alternate': 'alternate', 'Animated': 'animated', 'Realistic': 'realistic',
    'Themed': 'themed', 'Vanilla-like': 'vanilla-like',
  },
  shaders: {
    'Atmosphere': 'atmosphere', 'Cartoon': 'cartoon', 'Realistic': 'realistic',
    'Semi-Realistic': 'semi-realistic', 'Vanilla-like': 'vanilla-like',
  },
};

function modrinthCategorySlug(projectType: ProjectType, label: string): string {
  return MODRINTH_CATEGORY_SLUGS[projectType][label] ?? label.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

function installContentType(projectType: ProjectType): 'mod' | 'resourcepack' | 'shaderpack' {
  if (projectType === 'resourcepacks') return 'resourcepack';
  if (projectType === 'shaders') return 'shaderpack';
  return 'mod';
}
const LOADERS = ['fabric','forge','quilt','neoforge','vanilla'];
const CATEGORY_ICONS: Record<string, any> = {
  Adventure: Compass, Technology: Wrench, Magic: Sparkles, Storage: Archive,
  Decoration: Palette, Economy: Database, Equipment: Shield, Food: Utensils,
  Library: BookOpen, Mobs: Skull, Optimization: Gauge, 'World Generation': Globe2,
  Transportation: Map, Utility: Wrench, 'Game Mechanics': Gamepad2,
  Realistic: Palette, 'Semi-Realistic': Palette, 'Vanilla-like': Package,
  Animated: Sparkles, Themed: Palette, Alternate: Palette, Atmosphere: Sparkles,
  Cartoon: Palette, 'Path Traced': Sparkles, 'API and Library': BookOpen,
  'Quality of Life': Shield, 'Map and Information': Map, Cosmetic: Palette,
};

const MC_VERSIONS_BASE = [
  '1.21.4','1.21.3','1.21.2','1.21.1','1.21',
  '1.20.6','1.20.5','1.20.4','1.20.3','1.20.2','1.20.1','1.20',
  '1.19.4','1.19.3','1.19.2','1.19.1','1.19',
  '1.18.2','1.18.1','1.18',
  '1.17.1','1.17',
  '1.16.5','1.16.4','1.16.3','1.16.2','1.16.1','1.16',
  '1.15.2','1.15.1','1.15',
  '1.14.4','1.14.3','1.14.2','1.14.1','1.14',
  '1.13.2','1.13.1','1.13',
  '1.12.2','1.12.1','1.12',
  '1.11.2','1.11.1','1.11',
  '1.10.2','1.10.1','1.10',
  '1.9.4','1.9.2','1.9',
  '1.8.9','1.8.8','1.8.7','1.8.6','1.8.5','1.8.4','1.8.3','1.8.2','1.8.1','1.8',
  '1.7.10','1.7.9','1.7.8','1.7.7','1.7.6','1.7.5','1.7.4','1.7.3','1.7.2',
];

function fmtNum(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M';
  if (n >= 1_000) return (n / 1_000).toFixed(1) + 'K';
  return String(n);
}

// ── Install Button ──────────────────────────────────────────────────────────
function InstallBtn({ project, instanceId, mcVersion, loader }: {
  project: Project; instanceId: string; mcVersion: string; loader: string;
}) {
  const [state, setState] = useState<'idle'|'busy'|'done'|'err'>('idle');
  const [errorMsg, setErrorMsg] = useState('');
  const [confirmRunningInstall, setConfirmRunningInstall] = useState(false);
  const isInstalled = useIsInstalled(instanceId, [project.id, project.title, project.slug]);
  const cfApiKey = useSettingsStore(s => s.curseforgeApiKey);
  const launchStatus = useLaunchStore(s => s.getStatus(instanceId));

  if (isInstalled) return (
    <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold"
      style={{ background:'rgba(108,92,231,0.15)', color:'var(--color-primary)', border:'1px solid rgba(108,92,231,0.3)' }}>
      <Check className="w-3.5 h-3.5" />Downloaded
    </div>
  );

  async function doInstall(e: React.MouseEvent) {
    e.stopPropagation();
    if (state !== 'idle') return;
    if (launchStatus === 'running' && !confirmRunningInstall) {
      setConfirmRunningInstall(true);
      return;
    }
    setConfirmRunningInstall(false);
    setState('busy');
    try {
      if (project.platform === 'modrinth') {
        // Только у модов есть смысл фильтровать по загрузчику (fabric/forge/quilt).
        // У ресурспаков/шейдеров/датапаков такого тега нет вообще — если всё
        // равно слать loaders:[fabric], Modrinth просто вернёт пустой список,
        // и установка "с карточки" будет молча падать с "no version found".
        const isModType = project.projectType === 'mods';
        const versionParams = {
          projectId: project.id,
          loader: isModType && loader && loader !== 'vanilla' ? loader : undefined,
          gameVersion: mcVersion || undefined,
        };
        let vers = await getModrinthVersionsGateway(
          versionParams.projectId,
          versionParams.gameVersion,
          versionParams.loader,
        );
        // У resourcepack/shader в Modrinth часто нет точного тега патч-версии,
        // хотя архив полностью подходит (например, 1.21.4 для 1.21.1). Страница
        // проекта уже использовала неотфильтрованный список как резервный;
        // повторяем это поведение и для быстрой кнопки Install.
        if (!vers || vers.length === 0) {
          vers = await getModrinthVersionsGateway(project.id);
        }
        if (!vers || vers.length === 0) {
          setErrorMsg('No downloadable versions were returned by Modrinth.');
          setState('err');
          setTimeout(() => setState('idle'), 4000);
          return;
        }
        // Для обычных модов сохраняем строгую проверку загрузчика и версии.
        // Для resourcepack/shader сначала выбираем точное совпадение MC, а при
        // отсутствии такого тега ставим новейшую версию — как в деталях проекта.
        const compatible = vers.filter((v: any) => {
          const mcOk = !mcVersion || (v.game_versions ?? []).includes(mcVersion);
          const loaderOk = !isModType || !loader || loader === 'vanilla' || (v.loaders ?? []).includes(loader);
          return mcOk && loaderOk;
        });
        const downloadable = (vers ?? []).filter((v: any) => Array.isArray(v.files) && v.files.some((f: any) => Boolean(f?.url)));
        const ver = compatible.find((v: any) => downloadable.includes(v)) ?? downloadable[0] ?? null;
        if (!ver) {
          setErrorMsg(`No version compatible with ${mcVersion || 'this game version'}${loader ? ' / ' + loader : ''}.`);
          setState('err');
          setTimeout(() => setState('idle'), 4000);
          return;
        }
        const file = ver.files?.find((f: any) => f.primary && f.url) ?? ver.files?.find((f: any) => f.url) ?? ver.files?.[0];
        if (!file) { setState('err'); setTimeout(() => setState('idle'), 2500); return; }
        const contentType = installContentType(project.projectType);
        await invoke('install_mod', {
          instanceId,
          downloadUrl: file.url,
          fileName: file.filename,
          modId: project.id,
          modName: project.title,
          modVersion: ver.version_number || '',
          versionId: ver.id || '',
          source: 'modrinth',
          modType: contentType,
          projectId: project.id,
          author: project.author || null,
          iconUrl: project.iconUrl || null,
        });
        useInstalledStore.getState().mark(instanceId, [project.id, project.title, project.slug]);
        triggerInstallEffect({ name: project.title, iconUrl: project.iconUrl, contentType });
        setState('done');
      } else {
        // CurseForge installs directly from the card. Opening project details is
        // reserved for a deliberate click on the card itself, not Install.
        const numericProjectId = Number(project.id);
        if (!Number.isSafeInteger(numericProjectId) || numericProjectId <= 0) {
          throw new Error('CurseForge project ID is missing or invalid. Refresh the results and try again.');
        }

        const contentType = installContentType(project.projectType);
        const loaderNum = project.projectType === 'mods' && loader && loader !== 'vanilla'
          ? CF_LOADER_MAP[loader]
          : undefined;
        const filesResp = await invoke<any>('get_curseforge_mod_files', {
          modId: numericProjectId,
          gameVersion: mcVersion || undefined,
          modLoaderType: loaderNum,
          apiKey: cfApiKey,
        });
        const rawFiles = Array.isArray(filesResp?.data) ? filesResp.data : [];
        const candidates = rawFiles
          .filter((file: any) => Number(file?.id) > 0 && Boolean(file?.fileName))
          .sort((a: any, b: any) => new Date(b.fileDate ?? 0).getTime() - new Date(a.fileDate ?? 0).getTime());
        const isMod = project.projectType === 'mods';
        const compatible = candidates.filter((file: any) => {
          const tags = Array.isArray(file.gameVersions) ? file.gameVersions.map((tag: unknown) => String(tag).toLowerCase()) : [];
          const versionOk = !mcVersion || tags.includes(mcVersion.toLowerCase());
          const loaderOk = !isMod || !loader || loader === 'vanilla' || Number(file?.modLoaderType ?? 0) === Number(loaderNum ?? 0);
          return versionOk && loaderOk;
        });
        // Resource packs and shader packs may omit an exact patch-version tag, so they
        // can use a non-mod fallback. Mods never fall back across loader boundaries.
        const selectedFile = compatible[0] ?? (!isMod ? candidates[0] : null);
        if (!selectedFile) {
          throw new Error(`No CurseForge file is compatible with ${mcVersion || 'this Minecraft version'}${isMod && loader ? ` / ${loader}` : ''}.`);
        }

        // Use the same direct-file installation route as ModDetail. The
        // CurseForge download-url endpoint can return a CDN response that
        // fails in the list-only installer, while the detail page already
        // proves that direct URLs plus install_mod work reliably.
        const rawDownloadUrl = selectedFile.downloadUrl || selectedFile.download_url;
        const fileIdText = String(selectedFile.id ?? '');
        const derivedDownloadUrl = fileIdText.length >= 5 && selectedFile.fileName
          ? `https://edge.forgecdn.net/files/${fileIdText.slice(0, 4)}/${fileIdText.slice(4).replace(/^0+/, '')}/${selectedFile.fileName}`
          : '';
        const downloadUrl = rawDownloadUrl || derivedDownloadUrl;
        if (!downloadUrl) {
          throw new Error('CurseForge did not provide a downloadable file URL for this version.');
        }

        await invoke('install_mod', {
          instanceId,
          downloadUrl,
          fileName: selectedFile.fileName,
          modId: project.id,
          modName: project.title,
          modVersion: selectedFile.displayName ?? selectedFile.fileName,
          versionId: String(selectedFile.id),
          source: 'curseforge',
          modType: contentType,
          projectId: project.id,
          author: project.author || null,
          iconUrl: project.iconUrl || null,
        });
        useInstalledStore.getState().mark(instanceId, [project.id, project.title, project.slug]);
        triggerInstallEffect({ name: project.title, iconUrl: project.iconUrl, contentType });
        setState('done');
      }
    } catch (e: any) {
      const msg = e?.message || (typeof e === 'string' ? e : String(e));
      console.error('Install failed:', project.title, msg);
      setErrorMsg(msg);
      setState('err');
      setTimeout(() => setState('idle'), 4000);
    }
  }

  if (state === 'done') return (
    <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold"
      style={{ background:'rgba(46,204,113,0.15)', color:'#2ECC71' }}>
      <Check className="w-3.5 h-3.5" />Done
    </div>
  );
  if (state === 'err') return (
    <div title={errorMsg || 'No compatible version found'}
      className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold cursor-help"
      style={{ background:'rgba(231,76,60,0.15)', color:'var(--color-error)' }}>
      <X className="w-3.5 h-3.5" />Failed
    </div>
  );
  if (confirmRunningInstall && state === 'idle') return (
    <div className="flex max-w-[240px] items-center gap-2 rounded-xl px-2.5 py-2 text-[10px] font-medium" style={{ background:'rgba(241,196,15,0.13)', border:'1px solid rgba(241,196,15,0.45)', color:'var(--color-text)' }}>
      <TriangleAlert className="h-4 w-4 shrink-0" style={{ color:'var(--color-warning)' }} />
      <span className="min-w-0 leading-snug">Minecraft is running. Restart the game after installation for changes to apply.</span>
      <button onClick={doInstall} title="Install anyway" className="shrink-0 rounded-lg px-2 py-1 text-[10px] font-bold" style={{ background:'var(--color-warning)', color:'#1c1600' }}>Continue</button>
      <button onClick={event => { event.stopPropagation(); setConfirmRunningInstall(false); }} title="Отмена" className="shrink-0"><X className="h-3.5 w-3.5" /></button>
    </div>
  );
  return (
    <button onClick={doInstall}
      className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold hover:opacity-90 transition-all"
      style={{ background:'var(--color-primary)', color:'#fff', opacity: state==='busy' ? 0.7 : 1 }}>
      {state === 'busy'
        ? <><span className="w-3.5 h-3.5 border-2 border-white/40 border-t-white rounded-full animate-spin" />Installing…</>
        : <><Download className="w-3.5 h-3.5" />Install</>}
    </button>
  );
}

// ── Project Card ─────────────────────────────────────────────────────────────
function ProjectCard({ p, view, instanceId, mcVersion, loader, onClick }: {
  p: Project; view: 'grid'|'list'; instanceId: string; mcVersion: string; loader: string;
  onClick: () => void;
}) {
  const accent = p.color || '#6C5CE7';
  if (view === 'list') return (
    <div
      className="flex items-center gap-3 p-3 rounded-2xl cursor-pointer hover:bg-white/3 transition-all group"
      style={{ background:'var(--color-surface)', border:'1px solid var(--color-border)' }}
      onClick={onClick}>
      <div className="w-12 h-12 rounded-xl shrink-0 overflow-hidden flex items-center justify-center"
        style={{ background:`${accent}1A` }}>
        {p.iconUrl
          ? <img src={p.iconUrl} className="w-full h-full object-cover" alt="" />
          : <span className="text-xl font-black" style={{ color: accent }}>{p.title[0]}</span>}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <p className="font-bold text-sm truncate" style={{ color:'var(--color-text)' }}>{p.title}</p>
        </div>
        <p className="text-xs mt-0.5 truncate" style={{ color:'var(--color-text-secondary)' }}>{p.description}</p>
        <div className="flex items-center gap-3 mt-1">
          <span className="flex items-center gap-1 text-[10px]" style={{ color:'var(--color-text-tertiary)' }}>
            <Download className="w-3 h-3" />{fmtNum(p.downloads)}
          </span>
          <span className="flex items-center gap-1 text-[10px]" style={{ color:'var(--color-text-tertiary)' }}>
            <Star className="w-3 h-3" />{fmtNum(p.follows)}
          </span>
          <span className="text-[10px]" style={{ color:'var(--color-text-tertiary)' }}>by {p.author}</span>
        </div>
      </div>
      <div onClick={e => e.stopPropagation()}>
        <InstallBtn project={p} instanceId={instanceId} mcVersion={mcVersion} loader={loader} />
      </div>
    </div>
  );
  return (
    <div
      className="flex flex-col p-3 rounded-2xl cursor-pointer hover:bg-white/3 transition-all"
      style={{ background:'var(--color-surface)', border:'1px solid var(--color-border)' }}
      onClick={onClick}>
      <div className="w-full aspect-square rounded-xl mb-3 overflow-hidden flex items-center justify-center"
        style={{ background:`${accent}1A` }}>
        {p.iconUrl
          ? <img src={p.iconUrl} className="w-full h-full object-cover" alt="" />
          : <span className="text-4xl font-black" style={{ color: accent }}>{p.title[0]}</span>}
      </div>
      <p className="font-bold text-sm truncate mb-0.5" style={{ color:'var(--color-text)' }}>{p.title}</p>
      <p className="text-xs mb-2 line-clamp-2 flex-1" style={{ color:'var(--color-text-secondary)' }}>{p.description}</p>
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="flex items-center gap-1 text-[10px]" style={{ color:'var(--color-text-tertiary)' }}>
            <Download className="w-3 h-3" />{fmtNum(p.downloads)}
          </span>
        </div>
        <div onClick={e => e.stopPropagation()}>
          <InstallBtn project={p} instanceId={instanceId} mcVersion={mcVersion} loader={loader} />
        </div>
      </div>
    </div>
  );
}

// ── Filter Sidebar ───────────────────────────────────────────────────────────
function FilterSidebar({ projectType, selectedCats, selectedLoaders, selectedVersions, mcVersions, onCat, onLoader, onVersion, onClear }: {
  projectType: ProjectType;
  selectedCats: string[]; selectedLoaders: string[]; selectedVersions: string[]; mcVersions: string[];
  onCat(c: string): void; onLoader(l: string): void; onVersion(v: string): void; onClear(): void;
}) {
  const { t } = useTranslation();
  const cats = MODRINTH_CATS[projectType] ?? [];
  const hasFilters = selectedCats.length>0||selectedLoaders.length>0||selectedVersions.length>0;
  return (
    <div className="flex h-full flex-col gap-4 overflow-hidden p-3">
      {hasFilters && (
        <button onClick={onClear} className="w-full text-xs font-semibold py-1.5 rounded-lg hover:opacity-80"
          style={{ background:'rgba(231,76,60,0.1)', color:'var(--color-error)' }}>
          {t('findProjects.clearAll')}
        </button>
      )}
      {cats.length > 0 && (
        <div className="shrink-0">
          <p className="flex items-center gap-1.5 text-[10px] font-black uppercase tracking-wider mb-2" style={{ color:'var(--color-text-tertiary)' }}><Package className="w-3.5 h-3.5" style={{ color:'var(--color-primary)' }} />{t('findProjects.category')}</p>
          <div className="space-y-0.5">
            {cats.map(c => (
                  <button key={c} onClick={() => onCat(c)}
                className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-xs text-left"
                style={selectedCats.includes(c)
                  ? { background:'var(--color-primary)', color:'#fff' }
                  : { color:'var(--color-text-secondary)' }}>
                {(() => { const CategoryIcon = CATEGORY_ICONS[c] || Package; return <span className="flex items-center gap-1.5"><CategoryIcon className="h-3.5 w-3.5 shrink-0" style={{ color: selectedCats.includes(c) ? '#fff' : 'var(--color-text-tertiary)' }} />{c}</span>; })()}
              </button>
            ))}
          </div>
        </div>
      )}
      {projectType === 'mods' && (
        <div className="shrink-0">
          <p className="flex items-center gap-1.5 text-[10px] font-black uppercase tracking-wider mb-2" style={{ color:'var(--color-text-tertiary)' }}><Sparkles className="w-3.5 h-3.5" style={{ color:'var(--color-primary)' }} />{t('findProjects.loader')}</p>
          <div className="flex flex-wrap gap-1.5">
            {LOADERS.map(l => (
              <button key={l} onClick={() => onLoader(l)}
                className="px-2 py-1 rounded-lg text-[10px] font-semibold capitalize"
                style={selectedLoaders.includes(l)
                  ? { background:'var(--color-primary)', color:'#fff' }
                  : { background:'var(--color-surface-2)', color:'var(--color-text-secondary)', border:'1px solid var(--color-border)' }}>
                {l}
              </button>
            ))}
          </div>
        </div>
      )}
      <div className="flex min-h-0 flex-1 flex-col">
        <p className="flex items-center gap-1.5 text-[10px] font-black uppercase tracking-wider mb-2" style={{ color:'var(--color-text-tertiary)' }}><RefreshCw className="w-3.5 h-3.5" style={{ color:'var(--color-primary)' }} />{t('findProjects.minecraftVersion')}</p>
        <div className="min-h-0 flex-1 space-y-0.5 overflow-y-auto">
          {mcVersions.map(v => (
            <button key={v} onClick={() => onVersion(v)}
              className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-xs text-left"
              style={selectedVersions.includes(v)
                ? { background:'var(--color-primary)', color:'#fff' }
                : { color:'var(--color-text-secondary)' }}>
              {v}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

// ── Main Component ────────────────────────────────────────────────────────────
export function FindProjectsPage() {
  const navigate = useNavigate();
  const { t } = useTranslation();
  const [searchParams] = useSearchParams();
  const instanceId = searchParams.get('instanceId') ?? '';
  const defaultPlatform = useSettingsStore(s => s.defaultPlatform);
  const cfApiKey = useSettingsStore(s => s.curseforgeApiKey);
  const showSnapshots = useSettingsStore(s => s.showSnapshots);
  const { instances } = useInstanceStore();
  const instance = instances.find(i => i.id === instanceId);
  const searchDetailReturnPosition = useUiStore(s => s.searchDetailReturnPosition);
  const instanceIcon = toIconSrc(instance?.iconPath);
  const restoredFilters = useRef<FindProjectsFilterSnapshot>(readFindProjectsFilters(instanceId));

  const [platform, setPlatform] = useState<Platform>(() => restoredFilters.current.platform ?? defaultPlatform);
  const [projectType, setProjectType] = useState<ProjectType>(() => restoredFilters.current.projectType ?? 'mods');
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<SortOrder>('relevance');
  const [view, setView] = useState<'grid'|'list'>('list');
  const [showFilters, setShowFilters] = useState(() => restoredFilters.current.showFilters ?? true);

  // Auto-set from instance
  const [selectedVersions, setSelectedVersions] = useState<string[]>(() => restoredFilters.current.selectedVersions ?? (instance?.minecraftVersion ? [instance.minecraftVersion] : []));
  const [selectedLoaders, setSelectedLoaders] = useState<string[]>(() => restoredFilters.current.selectedLoaders ?? (instance?.modLoader && instance.modLoader !== 'vanilla' ? [instance.modLoader] : []));
  const [selectedCats, setSelectedCats] = useState<string[]>(() => restoredFilters.current.selectedCats ?? []);

  const [results, setResults] = useState<Project[]>([]);
  const [total, setTotal] = useState(0);
  const [reachableTotal, setReachableTotal] = useState<number | null>(null);
  const [capped, setCapped] = useState(false);
  const [loading, setLoading] = useState(false);
  const [netError, setNetError] = useState(false);
  const [page, setPage] = useState(0);
  const PAGE_SIZE = 20;
  const searchTimeout = useRef<ReturnType<typeof setTimeout>|null>(null);
  const resultsScrollRef = useRef<HTMLDivElement | null>(null);
  const pendingScrollRestore = useRef(consumeSearchReturn(findProjectsFilterKey(instanceId)));

  const applyInstanceCompatibility = useCallback((targetType: ProjectType = projectType) => {
    if (!instance) return;
    setSelectedVersions(instance.minecraftVersion ? [instance.minecraftVersion] : []);
    setSelectedLoaders(
      targetType === 'mods' && instance.modLoader && instance.modLoader !== 'vanilla'
        ? [instance.modLoader]
        : [],
    );
  }, [instance?.minecraftVersion, instance?.modLoader, projectType]);

  // MC versions — always load from Mojang manifest (fallback to base list)
  const [mcVersions, setMcVersions] = useState<string[]>(MC_VERSIONS_BASE);
  useEffect(() => {
    fetch('https://launchermeta.mojang.com/mc/game/version_manifest_v2.json')
      .then(r => r.json())
      .then(data => {
        const SNAPSHOT_RE = /[a-zA-Z]/;
        const all: string[] = data.versions.map((v: any) => v.id);
        const filtered = showSnapshots ? all : all.filter((v: string) => !SNAPSHOT_RE.test(v.replace(/\./g,'')));
        if (filtered.length > 0) setMcVersions(filtered);
      })
      .catch(() => setMcVersions(MC_VERSIONS_BASE));
  }, [showSnapshots]);

  // Refresh the shared installed-mods index for badge display (shared with ModDetail)
  useEffect(() => {
    if (!instanceId) return;
    useInstalledStore.getState().refresh(instanceId, true);
  }, [instanceId]);

  // The initial Find Projects view always starts compatible with the selected
  // instance. Manual changes remain available until the user changes source.
  useEffect(() => {
    if (!instance) return;
    applyInstanceCompatibility();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [instance?.id, projectType]);

  useEffect(() => {
    const snapshot: FindProjectsFilterSnapshot = {
      platform, projectType, showFilters, selectedCats, selectedLoaders, selectedVersions,
    };
    try { sessionStorage.setItem(findProjectsFilterKey(instanceId), JSON.stringify(snapshot)); } catch {}
  }, [instanceId, platform, projectType, showFilters, selectedCats, selectedLoaders, selectedVersions]);

  function fromModrinth(h: ModrinthHit): Project {
    return {
      id: h.project_id, slug: h.slug, title: h.title, description: h.description,
      author: h.author, downloads: h.downloads, follows: h.follows, iconUrl: h.icon_url,
      categories: h.categories, gameVersions: h.game_versions, loaders: h.loaders,
      dateModified: h.date_modified, platform: 'modrinth', projectType,
      color: h.color ? '#' + h.color.toString(16).padStart(6,'0') : undefined,
    };
  }
  function fromCurseForge(m: CfMod): Project {
    const lmap: Record<number,string> = {0:'any',1:'forge',2:'cauldron',3:'liteloader',4:'fabric',5:'quilt',6:'neoforge'};
    return {
      id: String(m.id), slug: m.slug, title: m.name, description: m.summary,
      author: (m.authors ?? [])[0]?.name ?? 'Неизвестный автор', authorId: (m.authors ?? [])[0]?.id, downloads: m.download_count ?? 0, follows: m.thumbs_up_count ?? 0,
      iconUrl: m.logo?.thumbnail_url,
      categories: (m.categories ?? []).map(c => c.name),
      gameVersions: [...new Set((m.latest_files_indexes ?? []).map(f => f.game_version).filter(Boolean))],
      loaders: [...new Set((m.latest_files_indexes ?? []).map(f => lmap[f.mod_loader_type]||'unknown').filter(l=>l!=='any'))],
      dateModified: m.date_modified, platform: 'curseforge', projectType,
    };
  }

  const doSearch = useCallback(async (q: string, pt: ProjectType, pl: Platform, s: SortOrder, pg: number, cats: string[], ldrs: string[], vers: string[]) => {
    const cacheKey = findProjectsCacheKey(q, pt, pl, s, pg, cats, ldrs, vers);
    const cached = readFindProjectsCache(cacheKey);
    if (cached) {
      setResults(cached.results);
      setTotal(cached.total);
      setReachableTotal(cached.reachableTotal);
      setCapped(cached.capped);
      setNetError(false);
      if (Date.now() - cached.savedAt < FIND_PROJECTS_CACHE_TTL) {
        setLoading(false);
        return;
      }
    }
    setLoading(!cached);
    setNetError(false);
    const offset = pg * PAGE_SIZE;
    try {
      if (pl === 'modrinth') {
        const res = await searchModrinthGateway({
          query: q, limit: PAGE_SIZE, offset,
          categories: cats.length>0 ? cats.map(cat => modrinthCategorySlug(pt, cat)) : undefined,
          versions: vers.length>0 ? vers : undefined,
          loaders: pt === 'mods' && ldrs.length>0 ? ldrs : undefined,
          sort: s.charAt(0).toUpperCase()+s.slice(1),
          projectType: TYPE_DEFS[pt].modrinthFacet,
        });
        const mapped = (res.hits || []).map(h => fromModrinth(h));
        setResults(mapped);
        setTotal(res.total_hits);
        setReachableTotal(null);
        setCapped(false);
        writeFindProjectsCache(cacheKey, { savedAt: Date.now(), results: mapped, total: res.total_hits, reachableTotal: null, capped: false });
      } else {
        if (!cfApiKey) {
          setResults([]); setTotal(0); setReachableTotal(null); setCapped(false); return;
        }
        const loaderNum = pt === 'mods' && ldrs.length > 0 ? (CF_LOADER_MAP[ldrs[0]] ?? undefined) : undefined;
        const sortField = s==='downloads'?6:s==='newest'?11:s==='updated'?3:2;
        const res = await invoke<CfResult>('search_curseforge', {
          query: q, limit: PAGE_SIZE, offset,
          classId: TYPE_DEFS[pt].cfClass,
          gameVersion: vers.length>0 ? vers[0] : undefined,
          modLoaderType: loaderNum,
          sortField,
          apiKey: cfApiKey,
        });
        const mapped = (res.data || []).map(m => fromCurseForge(m));
        setResults(mapped);
        setTotal(res.pagination?.total_count ?? 0);
        setReachableTotal(res.reachable_count ?? null);
        setCapped(!!res.capped);
        writeFindProjectsCache(cacheKey, { savedAt: Date.now(), results: mapped, total: res.pagination?.total_count ?? 0, reachableTotal: res.reachable_count ?? null, capped: !!res.capped });
      }
    } catch {
      // Only show error if definitely offline
      if (!navigator.onLine) setNetError(true);
      setResults([]); setTotal(0); setReachableTotal(null); setCapped(false);
    } finally {
      setLoading(false);
    }
  }, [cfApiKey]);

  const trigger = useCallback((immediate = false) => {
    if (searchTimeout.current) clearTimeout(searchTimeout.current);
    searchTimeout.current = setTimeout(() => {
      setPage(0);
      doSearch(query, projectType, platform, sort, 0, selectedCats, selectedLoaders, selectedVersions);
    }, immediate ? 0 : 350);
  }, [query, projectType, platform, sort, selectedCats, selectedLoaders, selectedVersions, doSearch]);

  useEffect(() => {
    trigger();
    return () => { if (searchTimeout.current) clearTimeout(searchTimeout.current); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, projectType, platform, sort, selectedCats, selectedLoaders, selectedVersions]);

  const pageMounted = useRef(false);
  useEffect(() => {
    if (!pageMounted.current) { pageMounted.current = true; return; }
    doSearch(query, projectType, platform, sort, page, selectedCats, selectedLoaders, selectedVersions);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page]);

  useEffect(() => {
    const restore = pendingScrollRestore.current;
    if (!restore || loading) return;
    const frame = requestAnimationFrame(() => {
      const node = resultsScrollRef.current;
      if (!node) return;
      node.scrollTop = targetSearchScroll(searchDetailReturnPosition, restore.scrollTop, node.scrollHeight - node.clientHeight);
      pendingScrollRestore.current = null;
    });
    return () => cancelAnimationFrame(frame);
  }, [loading, results.length, searchDetailReturnPosition]);

  const toggleCat    = (c: string) => setSelectedCats(s    => s.includes(c)?s.filter(x=>x!==c):[...s,c]);
  const toggleLoader = (l: string) => setSelectedLoaders(s => s.includes(l)?s.filter(x=>x!==l):[...s,l]);
  const toggleVersion= (v: string) => setSelectedVersions(s=> s.includes(v)?s.filter(x=>x!==v):[...s,v]);
  const clearFilters = () => { setSelectedCats([]); setSelectedLoaders([]); setSelectedVersions([]); };

  const hasFilters = selectedCats.length>0||selectedLoaders.length>0||selectedVersions.length>0;
  const effectiveTotal = reachableTotal != null ? Math.min(total, reachableTotal) : total;
  const totalPages = Math.ceil(effectiveTotal / PAGE_SIZE);
  const mcVer  = selectedVersions[0] ?? instance?.minecraftVersion ?? '';
  const loader = selectedLoaders[0]  ?? instance?.modLoader ?? '';
  // Установка ВСЕГДА идёт под реальную версию/загрузчик сборки — а не под
  // то, что сейчас выбрано в фильтрах поиска. Раньше "Install" читал те же
  // mcVer/loader, что и поисковая выдача: стоило пользователю поменять
  // фильтр версии/загрузчика, просто чтобы посмотреть, поддерживает ли мод
  // другую сборку, — и следующий клик "Install" ставил версию мода именно
  // под этот временный фильтр, а не под фактическую сборку.
  const installMcVersion = instance?.minecraftVersion ?? mcVer;
  const installLoader = instance?.modLoader ?? loader;

  return (
    <div className="h-full flex flex-col overflow-hidden" style={{ background:'var(--color-bg)' }}>
      {/* ── Header ── */}
      <div className="flex items-center gap-3 px-5 py-3 shrink-0 flex-wrap"
        style={{ borderBottom:'1px solid var(--color-border)', background:'color-mix(in srgb, var(--color-surface) 92%, transparent)' }}>
        <button onClick={() => navigate(-1)}
          className="w-8 h-8 flex items-center justify-center rounded-xl hover:bg-white/5 transition-colors shrink-0"
          style={{ color:'var(--color-text-secondary)', border:'1px solid var(--color-border)' }}>
          <ArrowLeft className="w-4 h-4" />
        </button>

        {/* Instance badge */}
        {instance && (
          <div className="flex items-center gap-2 px-3 py-1.5 rounded-xl shrink-0"
            style={{ background:`${instance.color||'var(--color-primary)'}15`, border:`1px solid ${instance.color||'var(--color-primary)'}30` }}>
            <div className="relative w-5 h-5 rounded-lg flex items-center justify-center overflow-hidden text-[10px] font-black"
              style={{ background:`${instance.color||'var(--color-primary)'}25`, color:instance.color||'var(--color-primary)' }}>
              {instanceIcon && <img src={instanceIcon} alt="" className="w-full h-full object-cover" onError={e => {
                e.currentTarget.style.display = 'none';
                const fallback = e.currentTarget.parentElement?.querySelector<HTMLElement>('[data-instance-fallback]');
                if (fallback) fallback.style.display = 'flex';
              }} />}
              <span data-instance-fallback className="absolute inset-0 items-center justify-center" style={{ display: instanceIcon ? 'none' : 'flex' }}>{instance.name[0]}</span>
            </div>
            <p className="text-xs font-bold" style={{ color:'var(--color-text)' }}>
              {instance.name}
              <span className="font-normal ml-1.5" style={{ color:'var(--color-text-secondary)' }}>
                {instance.minecraftVersion} · {instance.modLoader}
              </span>
            </p>
          </div>
        )}

        {/* Type tabs */}
        <div className="flex gap-1 flex-wrap">
          {(Object.entries(TYPE_DEFS) as [ProjectType, typeof TYPE_DEFS[ProjectType]][]).map(([typeId, def]) => {
            const Icon = def.icon;
            return (
              <button key={typeId} onClick={() => {
                setProjectType(typeId);
                setSelectedCats([]);
                applyInstanceCompatibility(typeId);
              }}
                className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold transition-all"
                style={projectType===typeId
                  ? { background:'var(--color-primary-dim)', color:'var(--color-primary)', border:'1px solid color-mix(in srgb, var(--color-primary) 46%, var(--color-border))', boxShadow:'0 5px 16px color-mix(in srgb, var(--color-primary) 12%, transparent)' }
                  : { color:'var(--color-text-secondary)', border:'1px solid transparent' }}>
                <Icon className="w-3.5 h-3.5" />{t(`findProjects.types.${def.labelKey}`)}
              </button>
            );
          })}
        </div>



        <div className="flex-1" />

        {/* Sort */}
        <div className="relative shrink-0">
          <select value={sort} onChange={e => setSort(e.target.value as SortOrder)}
            className="appearance-none pl-3 pr-7 py-1.5 rounded-xl text-xs font-semibold cursor-pointer"
            style={{ background:'var(--color-surface-2)', border:'1px solid var(--color-border)', color:'var(--color-text)' }}>
            {SORT_OPTIONS.map(o => <option key={o.value} value={o.value}>{t(`findProjects.sort.${o.labelKey}`)}</option>)}
          </select>
          <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 pointer-events-none" style={{ color:'var(--color-text-secondary)' }} />
        </div>

        {/* View toggle */}
        <div className="flex rounded-xl overflow-hidden shrink-0" style={{ border:'1px solid var(--color-border)' }}>
          {([['list',List],['grid',Grid]] as const).map(([v, Icon]) => (
            <button key={v} onClick={() => setView(v as 'grid'|'list')}
              className="w-8 h-8 flex items-center justify-center transition-all"
              style={view===v?{background:'var(--color-primary)',color:'#fff'}:{color:'var(--color-text-secondary)'}}>
              <Icon className="w-4 h-4" />
            </button>
          ))}
        </div>

        {/* Filters toggle */}
        <button onClick={() => setShowFilters(v => !v)}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold transition-all shrink-0"
          style={showFilters
            ? { background:'var(--color-primary)', color:'#fff' }
            : { background:'var(--color-surface-2)', color:'var(--color-text-secondary)', border:'1px solid var(--color-border)' }}>
          <SlidersHorizontal className="w-3.5 h-3.5" />{t('findProjects.filters')}
          {hasFilters && <span className="w-4 h-4 rounded-full text-[9px] font-black flex items-center justify-center bg-white text-[var(--color-primary)]">
            {selectedCats.length+selectedLoaders.length+selectedVersions.length}
          </span>}
        </button>
      </div>

      {/* ── Body ── */}
      <div className="flex flex-1 overflow-hidden">
        {/* Filters sidebar */}
        <AnimatePresence>
          {showFilters && (
            <motion.aside key="fs" className="h-full shrink-0 overflow-hidden"
              style={{ borderRight:'1px solid var(--color-border)', background:'var(--color-surface)' }}
              initial={{ width:0, opacity:0 }} animate={{ width:220, opacity:1 }} exit={{ width:0, opacity:0 }}
              transition={{ duration:0.2 }}>
              <FilterSidebar
                projectType={projectType}
                selectedCats={selectedCats} selectedLoaders={selectedLoaders} selectedVersions={selectedVersions}
                mcVersions={mcVersions}
                onCat={toggleCat} onLoader={toggleLoader} onVersion={toggleVersion} onClear={clearFilters} />
            </motion.aside>
          )}
        </AnimatePresence>

        {/* Main */}
        <div className="flex-1 min-w-0 flex flex-col overflow-hidden">
          {/* Search bar */}
          <div className="px-5 py-3 shrink-0" style={{ borderBottom:'1px solid var(--color-border)', background:'var(--color-surface)' }}>
            <div className="flex items-center gap-2">
              <div className="flex-1 flex items-center gap-2 px-3.5 py-2.5 rounded-2xl"
                style={{ background:'var(--color-surface-2)', border:'1px solid var(--color-border)' }}>
                <Search className="w-4 h-4 shrink-0" style={{ color:'var(--color-text-tertiary)' }} />
                <input className="flex-1 bg-transparent text-sm"
                  placeholder={t('findProjects.search', { count: total || undefined, type: t(`findProjects.types.${TYPE_DEFS[projectType].labelKey}`).toLowerCase() })}
                  value={query} onChange={e => setQuery(e.target.value)}
                  style={{ color:'var(--color-text)' }} />
                {query && <button onClick={() => setQuery('')}><X className="w-3.5 h-3.5" style={{ color:'var(--color-text-tertiary)' }} /></button>}
              </div>
              <button onClick={() => { setPage(0); doSearch(query, projectType, platform, sort, 0, selectedCats, selectedLoaders, selectedVersions); }}
                className="w-10 h-10 flex items-center justify-center rounded-2xl shrink-0"
                style={{ background:'var(--color-surface-2)', border:'1px solid var(--color-border)' }}
                title="Обновить каталог">
                <RefreshCw className={`w-4 h-4 ${loading?'animate-spin':''}`} style={{ color:'var(--color-text-secondary)' }} />
              </button>
              {/* Platform toggle — Modrinth ⇄ CurseForge */}
              <button
                onClick={() => {
                  setPlatform(p => p === 'modrinth' ? 'curseforge' : 'modrinth');
                  // Switching providers returns to the actual compatibility
                  // of the selected instance rather than stale saved chips.
                  applyInstanceCompatibility();
                  setShowFilters(true);
                }}
                className="flex h-10 w-10 items-center justify-center rounded-2xl shrink-0 transition-all hover:bg-white/5"
                style={{
                  background: 'var(--color-surface-2)',
                  border:     '1px solid var(--color-border)',
                  color:      'var(--color-text-secondary)',
                }}
                title={`Переключить на ${platform === 'modrinth' ? 'CurseForge' : 'Modrinth'}`}>
                 {platform === 'modrinth'
                   ? <ModrinthLogo size={20} />
                   : <img src={curseforgeAnvil} alt="" className="h-5 w-5 object-contain grayscale opacity-70" />}
              </button>
            </div>
          </div>

          {hasFilters && (
            <div className="flex items-center justify-end gap-1 px-4 py-1.5 shrink-0">
              {[...selectedCats,...selectedLoaders,...selectedVersions].slice(0,4).map(tag => {
                const TagIcon = CATEGORY_ICONS[tag] || (LOADERS.includes(tag) ? Sparkles : RefreshCw);
                return <button key={tag}
                  onClick={() => { setSelectedCats(s=>s.filter(x=>x!==tag)); setSelectedLoaders(s=>s.filter(x=>x!==tag)); setSelectedVersions(s=>s.filter(x=>x!==tag)); }}
                  className="flex items-center gap-1 px-2 py-0.5 rounded-lg text-[10px] font-semibold"
                  style={{ background:'var(--color-surface-2)', color:'var(--color-text-secondary)', border:'1px solid var(--color-border)' }}>
                  <TagIcon className="w-2.5 h-2.5 shrink-0" style={{ color:'var(--color-primary)' }} />{tag} <X className="w-2.5 h-2.5" />
                </button>;
              })}
            </div>
          )}

          {/* Results */}
          <div ref={resultsScrollRef} className="flex-1 overflow-y-auto px-4 pb-4">
            {/* CurseForge API key missing — visible inline banner */}
            {platform === 'curseforge' && !cfApiKey && (
              <div className="flex items-center gap-2 px-3 py-2 rounded-xl mb-3 text-xs"
                style={{ background:'rgba(241,100,54,0.08)', border:'1px solid rgba(241,100,54,0.3)', color:'#F16436' }}>
                <Wifi className="w-3.5 h-3.5 shrink-0" />
                <span className="flex-1">Ключ CurseForge не задан. Добавь его в Настройки → Дополнительно.</span>
                <button onClick={() => navigate('/settings#advanced')}
                  className="underline font-semibold hover:opacity-80">Открыть настройки</button>
              </div>
            )}
            {/* Network error */}
            {netError && !loading && (
              <div className="flex items-start gap-3 p-4 rounded-2xl mb-4"
                style={{ background:'rgba(231,76,60,0.08)', border:'1px solid rgba(231,76,60,0.2)' }}>
                <Wifi className="w-4 h-4 mt-0.5 shrink-0" style={{ color:'var(--color-error)' }} />
                <div>
                  <p className="text-sm font-semibold" style={{ color:'var(--color-error)' }}>Нет подключения</p>
                  <p className="text-xs mt-0.5" style={{ color:'var(--color-text-secondary)' }}>Проверьте подключение к интернету и попробуйте снова.</p>
                </div>
              </div>
            )}

            {/* Loading skeletons */}
            {loading && results.length===0 && (
              <div className="space-y-2">
                {Array.from({length:8}).map((_,i) => (
                  <div key={i} className="h-20 rounded-2xl animate-pulse"
                    style={{ background:'var(--color-surface)', border:'1px solid var(--color-border)' }} />
                ))}
              </div>
            )}

            {/* Empty */}
            {!loading && !netError && results.length===0 && (
              <div className="flex flex-col items-center py-16 gap-4">
                <div className="w-16 h-16 rounded-2xl flex items-center justify-center"
                  style={{ background:'var(--color-surface)', border:'1px solid var(--color-border)' }}>
                  <Search className="w-8 h-8" style={{ color:'var(--color-text-tertiary)' }} />
                </div>
                <div className="text-center">
                  <p className="font-bold" style={{ color:'var(--color-text)' }}>Ничего не найдено</p>
                  <p className="text-sm mt-1" style={{ color:'var(--color-text-secondary)' }}>
                    {query ? t('findProjects.tryDifferent') : t('findProjects.startSearching', { type: t(`findProjects.types.${TYPE_DEFS[projectType].labelKey}`).toLowerCase() })}
                  </p>
                </div>
                {hasFilters && (
                  <button onClick={clearFilters} className="px-4 py-2 rounded-xl text-sm font-semibold"
                    style={{ background:'var(--color-primary)', color:'var(--color-primary-text)' }}>Сбросить фильтры</button>
                )}
              </div>
            )}

            {/* Results grid/list */}
            {results.length>0 && (
              view==='grid' ? (
                <div className="grid grid-cols-2 xl:grid-cols-3 gap-3 py-2">
                  {results.map(p => (
                    <ProjectCard key={`${p.platform}-${p.id}`} p={p} view="grid"
                      instanceId={instanceId} mcVersion={installMcVersion} loader={installLoader}
                      onClick={() => navigate(`/discover/${p.platform}/${p.platform === 'curseforge' ? p.id : p.slug}`, {
                        state: { ...p, contextInstanceId: instanceId, contextMcVersion: installMcVersion, contextLoader: installLoader, fromFindProjects: true, searchOrigin: { storageKey: findProjectsFilterKey(instanceId), scrollTop: resultsScrollRef.current?.scrollTop ?? 0 } }
                      })} />
                  ))}
                </div>
              ) : (
                <div className="space-y-2 py-2">
                  {results.map(p => (
                    <ProjectCard key={`${p.platform}-${p.id}`} p={p} view="list"
                      instanceId={instanceId} mcVersion={installMcVersion} loader={installLoader}
                      onClick={() => navigate(`/discover/${p.platform}/${p.platform === 'curseforge' ? p.id : p.slug}`, {
                        state: { ...p, contextInstanceId: instanceId, contextMcVersion: installMcVersion, contextLoader: installLoader, fromFindProjects: true, searchOrigin: { storageKey: findProjectsFilterKey(instanceId), scrollTop: resultsScrollRef.current?.scrollTop ?? 0 } }
                      })} />
                  ))}
                </div>
              )
            )}

            {/* Pagination */}
            {totalPages>1 && !loading && (
              <div className="flex flex-col items-center gap-1.5 py-4">
              <div className="flex items-center justify-center gap-2">
                <button onClick={() => setPage(p=>Math.max(0,p-1))} disabled={page===0}
                  className="px-3 py-1.5 rounded-xl text-xs font-semibold disabled:opacity-40"
                  style={{ background:'var(--color-surface-2)', color:'var(--color-text-secondary)', border:'1px solid var(--color-border)' }}>
                  ← Prev
                </button>
                <span className="text-xs" style={{ color:'var(--color-text-secondary)' }}>Page {page+1} of {totalPages}</span>
                <button onClick={() => setPage(p=>Math.min(totalPages-1,p+1))} disabled={page>=totalPages-1}
                  className="px-3 py-1.5 rounded-xl text-xs font-semibold disabled:opacity-40"
                  style={{ background:'var(--color-surface-2)', color:'var(--color-text-secondary)', border:'1px solid var(--color-border)' }}>
                  Next →
                </button>
              </div>
              {capped && platform === 'curseforge' && (
                <p className="text-[11px] text-center max-w-md" style={{ color:'var(--color-text-tertiary)' }}>
                  CurseForge only lets us browse the first {(reachableTotal ?? 20000).toLocaleString()} results for this search — try narrowing your filters to find more.
                </p>
              )}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

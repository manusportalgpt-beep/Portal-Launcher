import { useParams, useNavigate } from 'react-router-dom';
import { useEffect, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { ChevronLeft, Save, Cpu, Folder, Play, Wrench, ShieldCheck, Database, Package, Settings2, History, RefreshCw, RotateCcw, ImagePlus, Trash2, Layers, Box, Sparkles, Check, Info } from 'lucide-react';
import { useInstanceStore } from '@/stores/instanceStore';
import { useSettingsStore } from '@/stores/settingsStore';
import { useTranslation } from 'react-i18next';
import { invoke } from '@/lib/invoke-shim';
import { fetchMcVersionIds, MC_VERSIONS_FALLBACK } from '@/lib/mc-versions';
import { toIconSrc } from '@/lib/icon-src';
import { dialog } from '@/stores/dialogStore';

const LOADERS = ['vanilla','fabric','forge','quilt','neoforge'] as const;
const VERSIONS = ['1.21.1','1.21','1.20.6','1.20.4','1.20.1','1.19.4','1.18.2','1.16.5','1.12.2'];
type LoaderVersionOption = { value: string; recommended: boolean; unstable: boolean };
const LOADER_META: Record<string, { label: string; description: string; Icon: any }> = {
  vanilla: { label:'Vanilla', description:'Чистый Minecraft', Icon:Box },
  fabric: { label:'Fabric', description:'Лёгкие и современные моды', Icon:Layers },
  forge: { label:'Forge', description:'Крупные модпаки и классика', Icon:Wrench },
  quilt: { label:'Quilt', description:'Совместимый модлоадер', Icon:Layers },
  neoforge: { label:'NeoForge', description:'Новое поколение Forge', Icon:Sparkles },
};

const tabs = [
  { id:'general', labelKey:'instanceUi.tabs.general', descKey:'instanceUi.tabs.generalDesc', icon:Settings2 },
  { id:'java', labelKey:'instanceUi.tabs.java', descKey:'instanceUi.tabs.javaDesc', icon:Cpu },
  { id:'content', labelKey:'instanceUi.tabs.content', descKey:'instanceUi.tabs.contentDesc', icon:Package },
  { id:'maintenance', labelKey:'instanceUi.tabs.maintenance', descKey:'instanceUi.tabs.maintenanceDesc', icon:Wrench },
];

type UpdateSnapshot = {
  id: string;
  timestamp: string;
  entries: Array<{
    mod_id: string;
    mod_name: string;
    previous: { version: string };
    updated: { version: string };
  }>;
};

function UpdateRollbackPanel({ instanceId }: { instanceId: string }) {
  const [snapshots, setSnapshots] = useState<UpdateSnapshot[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState('');

  const loadSnapshots = async () => {
    setLoading(true);
    try {
      setSnapshots(await invoke<UpdateSnapshot[]>('list_update_snapshots', { instanceId }));
      setError('');
    } catch (reason) {
      setError(String(reason));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void loadSnapshots(); }, [instanceId]);

  const restore = async (snapshot: UpdateSnapshot, modId?: string) => {
    const subject = modId ? snapshot.entries.find(entry => entry.mod_id === modId)?.mod_name ?? 'этот мод' : 'все моды из этого обновления';
    const approved = await dialog.confirm(`Восстановить ${subject} к состоянию до ${new Date(snapshot.timestamp).toLocaleString('ru-RU')}? Текущие обновлённые файлы будут заменены.`, { title:'Откат обновления', confirmLabel:'Восстановить', cancelLabel:'Отмена', danger:true });
    if (!approved) return;
    const key = `${snapshot.id}:${modId ?? 'all'}`;
    setBusy(key);
    try {
      await invoke<number>('restore_update_snapshot', { instanceId, snapshotId: snapshot.id, modId: modId ?? null });
      setSnapshots(previous => previous.flatMap(item => {
        if (item.id !== snapshot.id) return [item];
        if (!modId) return [];
        const entries = item.entries.filter(entry => entry.mod_id !== modId);
        return entries.length ? [{ ...item, entries }] : [];
      }));
    } catch (reason) {
      setError(String(reason));
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="rounded-2xl p-4" style={{ background:'var(--color-bg)', border:'1px solid var(--color-border)' }}>
      <div className="flex items-start justify-between gap-3">
        <div><div className="flex items-center gap-2"><History className="w-4 h-4" style={{ color:'var(--color-primary)' }} /><p className="text-sm font-black" style={{ color:'var(--color-text)' }}>История отката обновлений</p></div><p className="mt-1 text-xs" style={{ color:'var(--color-text-secondary)' }}>Перед каждым успешным автообновлением Modrinth сохраняется предыдущий файл. Можно восстановить один мод или весь пакет обновления по дате.</p></div>
        <button onClick={() => void loadSnapshots()} className="h-8 w-8 shrink-0 rounded-lg flex items-center justify-center hover:bg-white/5" title="Обновить историю" style={{ color:'var(--color-text-secondary)', border:'1px solid var(--color-border)' }}><RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} /></button>
      </div>
      {error && <p className="mt-3 rounded-xl px-3 py-2 text-xs" style={{ background:'rgba(231,76,60,0.1)', color:'var(--color-error)' }}>{error}</p>}
      {!loading && snapshots.length === 0 && <p className="mt-3 rounded-xl border border-dashed px-3 py-4 text-center text-xs" style={{ borderColor:'var(--color-border)', color:'var(--color-text-tertiary)' }}>Снимков обновлений пока нет. Лаунчер создаст снимок перед следующим успешным обновлением мода.</p>}
      <div className="mt-3 space-y-2">
        {snapshots.map(snapshot => (
          <div key={snapshot.id} className="rounded-xl p-3" style={{ background:'transparent', border:'1px solid var(--color-border)' }}>
            <div className="flex items-center justify-between gap-2"><div><p className="text-xs font-black" style={{ color:'var(--color-text)' }}>{new Date(snapshot.timestamp).toLocaleString('ru-RU')}</p><p className="text-[10px]" style={{ color:'var(--color-text-tertiary)' }}>{snapshot.entries.length} сохранён(о) перед установкой</p></div><button onClick={() => void restore(snapshot)} disabled={busy !== null} className="flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[10px] font-black disabled:opacity-50" style={{ background:'transparent', color:'var(--color-primary)', border:'1px solid var(--color-primary)' }}>{busy === `${snapshot.id}:all` ? <RefreshCw className="w-3 h-3 animate-spin" /> : <RotateCcw className="w-3 h-3" />}Восстановить всё</button></div>
            <div className="mt-2 space-y-1">
              {snapshot.entries.map(entry => <div key={entry.mod_id} className="flex items-center gap-2 rounded-lg px-2 py-1.5" style={{ background:'transparent', border:'1px solid var(--color-border)' }}><span className="min-w-0 flex-1 truncate text-[11px] font-semibold" style={{ color:'var(--color-text)' }}>{entry.mod_name}</span><span className="text-[10px]" style={{ color:'var(--color-text-tertiary)' }}>{entry.updated.version} → {entry.previous.version}</span><button onClick={() => void restore(snapshot, entry.mod_id)} disabled={busy !== null} className="rounded-md px-2 py-1 text-[9px] font-black disabled:opacity-50" style={{ color:'var(--color-primary)', border:'1px solid var(--color-border)' }}>Восстановить мод</button></div>)}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

type DeletedContentEntry = { id: string; timestamp: string; file_name: string; mod_type: string; was_disabled: boolean; is_directory?: boolean };

function DeletedContentPanel({ instanceId }: { instanceId: string }) {
  const retentionMinutes = useSettingsStore(state => state.deletedInstanceRetentionMinutes);
  const [items, setItems] = useState<DeletedContentEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState('');
  const load = async () => {
    setLoading(true);
    try { setItems(await invoke<DeletedContentEntry[]>('list_deleted_mods', { instanceId, retentionMinutes })); setError(''); }
    catch (reason) { setError(String(reason)); }
    finally { setLoading(false); }
  };
  useEffect(() => { void load(); }, [instanceId, retentionMinutes]);
  const restore = async (item: DeletedContentEntry) => {
    setBusy(item.id);
    try { await invoke('restore_deleted_mod', { instanceId, id:item.id }); await load(); }
    catch (reason) { setError(String(reason)); }
    finally { setBusy(null); }
  };
  const permanentlyDelete = async (item: DeletedContentEntry) => {
    const approved = await dialog.confirm(`Удалить «${item.file_name}» навсегда? Восстановить его после этого будет нельзя.`, { title:'Удалить навсегда', confirmLabel:'Удалить', cancelLabel:'Отмена', danger:true });
    if (!approved) return;
    setBusy(item.id);
    try { await invoke('permanently_delete_deleted_mod', { instanceId, id:item.id }); await load(); }
    catch (reason) { setError(String(reason)); }
    finally { setBusy(null); }
  };
  const permanentlyDeleteAll = async () => {
    if (!items.length || busy !== null) return;
    const approved = await dialog.confirm(`Удалить навсегда все ${items.length} ${items.length === 1 ? 'элемент' : 'элемента'} из корзины этой сборки? Восстановить их после этого будет нельзя. Активные файлы, миры и другие сборки затронуты не будут.`, { title:'Удалить всё из корзины', confirmLabel:'Удалить всё', cancelLabel:'Отмена', danger:true });
    if (!approved) return;
    setBusy('__all__');
    try {
      await invoke('permanently_delete_all_deleted_mods', { instanceId });
      setItems([]);
      setError('');
    } catch (reason) { setError(String(reason)); }
    finally { setBusy(null); }
  };
  return <div className="space-y-3"><section className="rounded-2xl p-4" style={{ background:'var(--color-bg)', border:'1px solid var(--color-border)' }}><div className="flex items-start justify-between gap-3"><div><div className="flex items-center gap-2"><Folder className="h-4 w-4" style={{ color:'var(--color-primary)' }} /><p className="text-sm font-black" style={{ color:'var(--color-text)' }}>Удалённые файлы сборки</p></div><p className="mt-1 text-xs" style={{ color:'var(--color-text-secondary)' }}>Моды, ресурс-паки, шейдеры, дата-паки и миры хранятся здесь до автоочистки. Срок задан в Настройки → Дополнительно.</p></div><div className="flex shrink-0 items-center gap-2"><button type="button" disabled={!items.length || busy !== null} onClick={() => void permanentlyDeleteAll()} className="flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[10px] font-black transition-colors disabled:cursor-not-allowed disabled:opacity-45" style={{ background:'transparent', color:'var(--color-error)', border:'1px solid var(--color-border)' }}><Trash2 className="h-3.5 w-3.5" />{busy === '__all__' ? 'Удаляю…' : 'Удалить всё'}</button><button type="button" onClick={() => void load()} title="Обновить" className="flex h-8 w-8 items-center justify-center rounded-lg" style={{ color:'var(--color-text-secondary)', border:'1px solid var(--color-border)' }}><RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} /></button></div></div></section>{error && <p className="rounded-xl px-3 py-2 text-xs" style={{ background:'rgba(231,76,60,0.1)', color:'var(--color-error)' }}>{error}</p>}{!loading && !items.length && <div className="rounded-2xl border border-dashed px-4 py-10 text-center" style={{ borderColor:'var(--color-border)', color:'var(--color-text-tertiary)' }}><Folder className="mx-auto h-8 w-8" /><p className="mt-3 text-sm font-bold" style={{ color:'var(--color-text)' }}>Корзина пуста</p><p className="mt-1 text-xs">После удаления контент сборки появится здесь и его можно будет восстановить.</p></div>}<div className="space-y-2">{items.map(item => <div key={item.id} className="flex flex-wrap items-center gap-3 rounded-xl p-3" style={{ background:'transparent', border:'1px solid var(--color-border)' }}><div className="flex h-9 w-9 items-center justify-center rounded-lg" style={{ background:'var(--color-bg)', color:'var(--color-primary)', border:'1px solid var(--color-border)' }}><Package className="h-4 w-4" /></div><div className="min-w-0 flex-1"><p className="truncate text-xs font-black" style={{ color:'var(--color-text)' }}>{item.file_name}</p><p className="mt-0.5 text-[10px]" style={{ color:'var(--color-text-secondary)' }}>{item.mod_type} · {item.is_directory ? 'папка' : 'файл'} · {new Date(item.timestamp).toLocaleString('ru-RU')}</p></div><button disabled={busy !== null} onClick={() => void restore(item)} className="flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[10px] font-black disabled:opacity-50" style={{ background:'transparent', color:'var(--color-primary)', border:'1px solid var(--color-primary)' }}><RotateCcw className="h-3.5 w-3.5" />Восстановить</button><button disabled={busy !== null} onClick={() => void permanentlyDelete(item)} title="Удалить навсегда" className="flex h-8 w-8 items-center justify-center rounded-lg disabled:opacity-50" style={{ background:'transparent', color:'var(--color-error)', border:'1px solid var(--color-border)' }}><Trash2 className="h-3.5 w-3.5" /></button></div>)}</div></div>;
}

export function InstanceSettings() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { t } = useTranslation();
  const { instances, update } = useInstanceStore();
  const inst = instances.find(i => i.id === id);
  const [tab, setTab] = useState('general');
  const [saved, setSaved] = useState(false);
  const [showSnapshots, setShowSnapshots] = useState(false);
  const [mcVersions, setMcVersions] = useState<string[]>(VERSIONS);
  const [loaderVersions, setLoaderVersions] = useState<LoaderVersionOption[]>([]);
  const [loaderVersionsLoading, setLoaderVersionsLoading] = useState(false);
  const coverInputRef = useRef<HTMLInputElement>(null);

  if (!inst) return (
    <div className="flex flex-col items-center justify-center h-64 gap-4">
      <p style={{color:'var(--color-text-secondary)'}}>Сборка не найдена</p>
      <button onClick={()=>navigate('/instances')} style={{color:'var(--color-primary)'}}>← К библиотеке</button>
    </div>
  );

  const [form, setForm] = useState({
    name: inst.name,
    description: inst.description,
    minecraftVersion: inst.minecraftVersion,
    modLoader: inst.modLoader,
    modLoaderVersion: inst.modLoaderVersion || '',
    iconPath: inst.iconPath || '',
    javaPath: inst.javaPath || '',
    jvmArgs: inst.jvmArgs || '',
    minRam: inst.minRam,
    maxRam: inst.maxRam,
  });

  const minor = Number(form.minecraftVersion.split('.')[1] ?? 20);
  const recommendedJava = minor <= 16 ? 8 : minor <= 20 ? 17 : 21;
  const coverSrc = toIconSrc(form.iconPath);
  const activeLoader = LOADER_META[form.modLoader] ?? LOADER_META.vanilla;
  const recommendedLoaderVersion = loaderVersions.find(item => item.recommended && !item.unstable) ?? loaderVersions.find(item => !item.unstable) ?? loaderVersions[0];

  useEffect(() => {
    let active = true;
    fetchMcVersionIds(showSnapshots).then(versions => {
      if (active && versions.length) setMcVersions(versions);
    }).catch(() => { if (active) setMcVersions(MC_VERSIONS_FALLBACK); });
    return () => { active = false; };
  }, [showSnapshots]);

  useEffect(() => {
    let active = true;
    const loadLoaderVersions = async () => {
      if (!['fabric', 'forge', 'neoforge'].includes(form.modLoader)) {
        setLoaderVersions([]);
        return;
      }
      setLoaderVersionsLoading(true);
      try {
        const raw = await invoke<any>(form.modLoader === 'fabric' ? 'get_fabric_versions' : form.modLoader === 'neoforge' ? 'get_neoforge_versions' : 'get_forge_versions', { mcVersion: form.minecraftVersion });
        const values: LoaderVersionOption[] = form.modLoader === 'fabric'
          ? (Array.isArray(raw) ? raw.map((entry: any) => {
              const value = entry?.loader?.version ?? entry?.version;
              const unstable = /(?:alpha|beta|rc|pre|snapshot)/i.test(String(value ?? ''));
              return value ? { value, recommended: Boolean(entry?.loader?.stable) && !unstable, unstable } : null;
            }).filter((entry): entry is LoaderVersionOption => entry !== null) : [])
          : (Array.isArray(raw) ? raw.filter(Boolean).map((value: string, index: number) => ({ value, recommended: index === 0 && !/(?:alpha|beta|rc|pre|snapshot)/i.test(value), unstable: /(?:alpha|beta|rc|pre|snapshot)/i.test(value) })) : []);
        if (active) setLoaderVersions(values.slice(0, 80));
      } catch {
        if (active) setLoaderVersions([]);
      } finally {
        if (active) setLoaderVersionsLoading(false);
      }
    };
    void loadLoaderVersions();
    return () => { active = false; };
  }, [form.minecraftVersion, form.modLoader]);

  const pickCover = (file?: File | null) => {
    if (!file || !file.type.startsWith('image/')) return;
    if (file.size > 8 * 1024 * 1024) return;
    const reader = new FileReader();
    reader.onload = () => setForm(current => ({ ...current, iconPath: String(reader.result ?? '') }));
    reader.readAsDataURL(file);
  };

  const handleSave = async () => {
    const gameCoreChanged = form.minecraftVersion !== inst.minecraftVersion || form.modLoader !== inst.modLoader;
    if (gameCoreChanged) {
      try {
        const compat = await invoke<Array<{ name: string; source: string; file_name: string; status: string; detail: string }>>('check_instance_target_mod_compatibility', {
          instanceId: inst.id, targetVersion: form.minecraftVersion, targetLoader: form.modLoader,
        });
        const needUpdate = compat.filter(item => item.status === 'update');
        const unstable = compat.filter(item => item.status === 'unstable');
        if (needUpdate.length || unstable.length) {
          const parts: string[] = [];
          if (needUpdate.length) {
            const names = needUpdate.map(item => item.name).slice(0, 8).join(', ');
            parts.push(`Требуют обновления (${needUpdate.length}): ${names}${needUpdate.length > 8 ? ' и другие' : ''}`);
          }
          if (unstable.length) {
            const names = unstable.map(item => item.name).slice(0, 8).join(', ');
            parts.push(`Могут работать нестабильно (${unstable.length}): ${names}${unstable.length > 8 ? ' и другие' : ''}`);
          }
          const approved = await dialog.confirm(`${parts.join('\n\n')}\n\nПродолжить смену ядра на Minecraft ${form.minecraftVersion} с ${form.modLoader}? После сохранения запустится проверка обновлений модов.`, { title: 'Предупреждение о совместимости модов', confirmLabel: 'Изменить всё равно', cancelLabel: 'Отмена', danger: true });
          if (!approved) return;
        }
      } catch {
        // Network/platform checks must not silently block an offline user from
        // editing an instance. The installed mod metadata remains available to mclo.gs.
      }
    }
    try {
      await invoke('update_instance', { id: inst.id, updates: {
        name: form.name, description: form.description, mc_version: form.minecraftVersion, loader: form.modLoader,
        loader_version: form.modLoaderVersion, java_path: form.javaPath, custom_jvm_args: form.jvmArgs,
        min_ram: form.minRam, max_ram: form.maxRam,
      } });
      update(inst.id, form as any);
      if (gameCoreChanged) await invoke('check_mod_updates', { instanceId: inst.id }).catch(() => undefined);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (reason) {
      await dialog.alert(`Настройки сборки не сохранены: ${String(reason)}`, { title:'Ошибка сохранения' });
    }
  };

  const Field = ({ label, desc, children }: { label: string; desc?: string; children: React.ReactNode }) => (
    <div className="space-y-1.5">
      <label className="block text-sm font-medium" style={{color:'var(--color-text)'}}>{label}</label>
      {desc && <p className="text-xs" style={{color:'var(--color-text-secondary)'}}>{desc}</p>}
      {children}
    </div>
  );

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center p-4 sm:p-8"
      style={{ background:'rgba(0,0,0,0.42)', backdropFilter:'blur(2px)' }}
      onMouseDown={e => { if (e.target === e.currentTarget) navigate(-1); }}>
      <motion.div initial={{ opacity:0, y:16, scale:0.97 }} animate={{ opacity:1, y:0, scale:1 }} transition={{ type:'spring', stiffness:420, damping:32 }}
        className="w-full max-w-6xl max-h-[92vh] overflow-hidden flex flex-col"
        style={{ background:'var(--color-bg)', border:'1px solid var(--color-border)', borderRadius:'var(--radius-modal)', boxShadow:'none' }}>
        <div className="flex items-center justify-between gap-4 px-5 py-3.5 shrink-0" style={{ background:'var(--color-bg)', borderBottom:'1px solid var(--color-border)' }}>
          <div className="flex min-w-0 items-center gap-2 text-sm"><button onClick={()=>navigate(-1)} className="flex items-center gap-1.5 hover:opacity-80" style={{ color:'var(--color-text-secondary)' }}><ChevronLeft className="h-4 w-4" />{t('instanceUi.backToLibrary')}</button><span style={{ color:'var(--color-text-tertiary)' }}>/</span><span className="truncate font-semibold" style={{ color:'var(--color-text)' }}>{form.name || inst.name}</span></div>
          <div className="flex shrink-0 items-center gap-2"><button onClick={() => navigate(`/library/${inst.id}`)} className="flex items-center gap-2 rounded-xl px-4 py-2 text-sm font-bold" style={{ background:'var(--color-surface-2)', border:'1px solid var(--color-border)', color:'var(--color-text-secondary)' }}><Play className="h-3.5 w-3.5 fill-current" />{t('instanceUi.play')}</button><button onClick={handleSave} className="flex items-center gap-2 rounded-xl px-4 py-2 text-sm font-bold transition-all" style={{ background:saved?'rgba(46,204,113,0.15)':'var(--color-primary)', color:saved?'var(--color-success)':'var(--color-primary-text)', border:saved?'1px solid var(--color-success)':'1px solid var(--color-primary)' }}><Save className="h-3.5 w-3.5" />{saved?t('instanceUi.saved'):t('instanceUi.saveChanges')}</button></div>
        </div>

        <div className="flex min-h-0 flex-1 gap-4 p-4 sm:p-5">
          <aside className="flex w-52 shrink-0 flex-col gap-1.5 p-2.5" style={{ background:'var(--color-bg)', border:'1px solid var(--color-border)', borderRadius:'var(--radius-card)' }}>
            {tabs.map(({id:tabId,labelKey,icon:Icon,descKey}) => <button key={tabId} onClick={() => setTab(tabId)} className="flex items-center gap-2.5 px-2.5 py-2.5 text-left transition-all" style={{ borderRadius:'var(--radius-button)', background:tab===tabId?'var(--color-primary-dim)':'transparent', color:tab===tabId?'var(--color-text)':'var(--color-text-secondary)', border:`1px solid ${tab===tabId?'var(--color-primary)':'transparent'}` }}><span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg" style={{ background:tab===tabId?'var(--color-primary)':'var(--color-surface-2)', color:tab===tabId?'var(--color-primary-text)':'var(--color-text-secondary)' }}><Icon className="h-4 w-4" /></span><span className="min-w-0"><span className="block text-xs font-black">{t(labelKey)}</span><span className="block truncate text-[9px]" style={{ color:'var(--color-text-tertiary)' }}>{t(descKey)}</span></span></button>)}
            <div className="mt-auto p-3" style={{ background:'transparent', borderRadius:'var(--radius-button)', border:'1px solid var(--color-border)' }}><div className="flex items-center gap-1.5 text-[10px] font-black" style={{ color:'var(--color-primary)' }}><ShieldCheck className="h-3.5 w-3.5" />{t('instanceUi.safeChanges')}</div><p className="mt-1 text-[9px] leading-3" style={{ color:'var(--color-text-secondary)' }}>{t('instanceUi.safeChangesDesc')}</p></div>
          </aside>

          <motion.main key={tab} initial={{ opacity:0, y:6 }} animate={{ opacity:1, y:0 }} className="min-w-0 flex-1 overflow-y-auto scroll-area" style={{ background:'var(--color-bg)', border:'1px solid var(--color-border)', borderRadius:'var(--radius-card)' }}>
            <div className="space-y-6 p-5 sm:p-6">
              {tab==='general' && <>
                <section className="relative overflow-hidden p-4 sm:p-5" style={{ background:'transparent', border:'1px solid var(--color-border)', borderRadius:'var(--radius-card)' }}>
                  <div className="relative flex flex-col gap-4 sm:flex-row sm:items-center"><input ref={coverInputRef} hidden type="file" accept="image/png,image/jpeg,image/webp" onChange={event => pickCover(event.target.files?.[0])} /><button onClick={() => coverInputRef.current?.click()} className="group relative flex h-24 w-24 shrink-0 items-center justify-center overflow-hidden" style={{ background:'var(--color-bg)', border:'2px dashed var(--color-border)', borderRadius:'var(--radius-card)' }}>{coverSrc ? <img src={coverSrc} alt="Обложка сборки" className="h-full w-full object-cover" /> : <Package className="h-8 w-8" style={{ color:'var(--color-text-tertiary)' }} />}<span className="absolute inset-0 flex items-center justify-center bg-black/55 opacity-0 transition-opacity group-hover:opacity-100"><ImagePlus className="h-5 w-5 text-white" /></span></button><div className="min-w-0 flex-1"><p className="text-[10px] font-black uppercase tracking-[0.16em]" style={{ color:'var(--color-primary)' }}>Профиль сборки</p><h1 className="mt-1 truncate text-xl font-black" style={{ color:'var(--color-text)' }}>{form.name || inst.name}</h1><div className="mt-2 flex flex-wrap gap-1.5"><span className="rounded-lg px-2 py-1 text-[10px] font-bold" style={{ background:'transparent', border:'1px solid var(--color-border)', color:'var(--color-text-secondary)' }}>Minecraft {form.minecraftVersion}</span><span className="rounded-lg px-2 py-1 text-[10px] font-bold capitalize" style={{ background:'transparent', border:'1px solid var(--color-primary)', color:'var(--color-primary)' }}>{activeLoader.label}{form.modLoaderVersion ? ` ${form.modLoaderVersion}` : ''}</span></div><div className="mt-3 flex gap-2"><button onClick={() => coverInputRef.current?.click()} className="flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[10px] font-bold" style={{ background:'transparent', border:'1px solid var(--color-border)', color:'var(--color-text-secondary)' }}><ImagePlus className="h-3.5 w-3.5" />Изменить обложку</button>{form.iconPath && <button onClick={() => setForm(current => ({ ...current, iconPath:'' }))} className="flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[10px] font-bold" style={{ background:'transparent', color:'var(--color-error)', border:'1px solid var(--color-border)' }}><Trash2 className="h-3.5 w-3.5" />Убрать</button>}</div></div></div>
                </section>

                <div className="grid gap-3 sm:grid-cols-2"><div className="p-3.5" style={{ background:'transparent', border:'1px solid var(--color-border)', borderRadius:'var(--radius-button)' }}><div className="flex items-center gap-2"><Cpu className="h-4 w-4" style={{ color:'var(--color-primary)' }} /><p className="text-xs font-black" style={{ color:'var(--color-text)' }}>Автоматическая Java {recommendedJava}</p></div><p className="mt-1 text-[10px] leading-relaxed" style={{ color:'var(--color-text-secondary)' }}>{form.javaPath ? 'Для этой сборки выбрана своя Java.' : `Portal Launcher выберет или скачает совместимую Java ${recommendedJava} при запуске сборки.`}</p></div><div className="p-3.5" style={{ background:'transparent', border:'1px solid var(--color-border)', borderRadius:'var(--radius-button)' }}><div className="flex items-center gap-2"><Info className="h-4 w-4" style={{ color:'var(--color-primary)' }} /><p className="text-xs font-black" style={{ color:'var(--color-text)' }}>Можно настроить</p></div><p className="mt-1 text-[10px] leading-relaxed" style={{ color:'var(--color-text-secondary)' }}>Смена версии игры или загрузчика сохранит профиль сборки; перед изменением установленного контента создайте резервную копию.</p></div></div>

                <div className="grid gap-5 sm:grid-cols-2"><Field label={t('instances.name')}><input value={form.name} onChange={event => setForm(current => ({ ...current, name:event.target.value }))} className="w-full px-3 py-2.5 text-sm outline-none" style={{ background:'var(--color-surface-2)', border:'1px solid var(--color-border)', color:'var(--color-text)', borderRadius:'var(--radius-button)' }} /></Field><Field label={t('instances.description')}><textarea value={form.description} onChange={event => setForm(current => ({ ...current, description:event.target.value }))} rows={3} className="w-full resize-none px-3 py-2.5 text-sm outline-none" style={{ background:'var(--color-surface-2)', border:'1px solid var(--color-border)', color:'var(--color-text)', borderRadius:'var(--radius-button)' }} /></Field></div>

                <section><div className="mb-2 flex items-center justify-between"><div><p className="text-sm font-black" style={{ color:'var(--color-text)' }}>Игровое ядро</p><p className="mt-0.5 text-[10px]" style={{ color:'var(--color-text-secondary)' }}>Сначала выберите загрузчик, затем совместимую с ним сборку.</p></div></div><div className="grid grid-cols-2 gap-2 sm:grid-cols-3">{LOADERS.map(loader => { const meta = LOADER_META[loader]; if (!meta) return null; const selected = form.modLoader === loader; return <button key={loader} onClick={() => setForm(current => ({ ...current, modLoader:loader as any, modLoaderVersion:'' }))} className="flex items-center gap-2.5 p-3 text-left transition-all" style={{ background:'transparent', border:`1px solid ${selected?'var(--color-primary)':'var(--color-border)'}`, borderRadius:'var(--radius-button)' }}><span className="flex h-8 w-8 items-center justify-center rounded-lg" style={{ background:'transparent', border:'1px solid var(--color-border)', color:selected?'var(--color-primary)':'var(--color-text-secondary)' }}><meta.Icon className="h-4 w-4" /></span><span className="min-w-0"><span className="block text-xs font-bold" style={{ color:'var(--color-text)' }}>{meta.label}</span><span className="block truncate text-[9px]" style={{ color:'var(--color-text-tertiary)' }}>{meta.description}</span></span>{selected && <Check className="ml-auto h-3.5 w-3.5" style={{ color:'var(--color-primary)' }} />}</button>; })}</div></section>

                <div className="grid gap-5 sm:grid-cols-2"><Field label={t('instances.version')} desc="По умолчанию показаны релизы. Включайте снимки только при необходимости."><div className="flex gap-2"><select value={form.minecraftVersion} onChange={event => setForm(current => ({ ...current, minecraftVersion:event.target.value, modLoaderVersion:'' }))} className="min-w-0 flex-1 px-3 py-2.5 text-sm font-bold outline-none" style={{ background:'var(--color-bg)', border:'1px solid var(--color-border)', color:'var(--color-text)', borderRadius:'var(--radius-button)' }}>{(mcVersions.includes(form.minecraftVersion) ? mcVersions : [form.minecraftVersion, ...mcVersions]).map(version => <option key={version} value={version}>{version}</option>)}</select><button onClick={() => setShowSnapshots(value => !value)} className="shrink-0 rounded-xl px-2.5 text-[10px] font-bold" style={{ background:'transparent', border:`1px solid ${showSnapshots?'var(--color-primary)':'var(--color-border)'}`, color:showSnapshots?'var(--color-primary)':'var(--color-text-secondary)' }}>{showSnapshots?'Снимки':'Релизы'}</button></div></Field><Field label="Сборка загрузчика" desc={loaderVersionsLoading ? 'Ищу совместимые сборки…' : recommendedLoaderVersion ? `Рекомендуемая: ${recommendedLoaderVersion.value}` : 'Выберите совместимую сборку или укажите её вручную.'}><div className="flex gap-2"><select value={form.modLoaderVersion} onChange={event => setForm(current => ({ ...current, modLoaderVersion:event.target.value }))} disabled={loaderVersionsLoading || loaderVersions.length === 0} className="min-w-0 flex-1 px-3 py-2.5 text-sm outline-none disabled:opacity-60" style={{ background:'var(--color-bg)', border:'1px solid var(--color-border)', color:'var(--color-text)', borderRadius:'var(--radius-button)' }}><option value="">{loaderVersionsLoading ? 'Загрузка…' : loaderVersions.length ? 'Автоматически / рекомендуемая' : 'Версия вручную'}</option>{loaderVersions.map(version => <option key={version.value} value={version.value}>{version.value}{version.recommended ? ' · Рекомендуемая' : version.unstable ? ' · Предпросмотр' : ''}</option>)}</select>{recommendedLoaderVersion && <button onClick={() => setForm(current => ({ ...current, modLoaderVersion:recommendedLoaderVersion.value }))} title="Использовать рекомендуемую сборку" className="shrink-0 rounded-xl px-2.5" style={{ background:'transparent', border:'1px solid var(--color-primary)', color:'var(--color-primary)' }}><Check className="h-4 w-4" /></button>}</div><input value={form.modLoaderVersion} onChange={event => setForm(current => ({ ...current, modLoaderVersion:event.target.value }))} placeholder={recommendedLoaderVersion?.value || 'Версия загрузчика'} className="mt-2 w-full px-3 py-2 text-xs outline-none" style={{ background:'var(--color-bg)', border:'1px solid var(--color-border)', color:'var(--color-text)', borderRadius:'var(--radius-button)' }} /></Field></div>
              </>}

              {tab==='java' && <><section className="p-4" style={{ background:'transparent', border:'1px solid var(--color-border)', borderRadius:'var(--radius-card)' }}><div className="flex items-center gap-2"><Cpu className="h-5 w-5" style={{ color:'var(--color-primary)' }} /><div><p className="text-sm font-black" style={{ color:'var(--color-text)' }}>Автоматически рекомендуется Java {recommendedJava}</p><p className="text-[11px]" style={{ color:'var(--color-text-secondary)' }}>Лаунчер сначала проверяет выбранную Java, затем управляемую Java и скачивает совместимую среду только при необходимости.</p></div></div></section><Field label="Путь Java для этой сборки" desc="Оставьте пустым, чтобы использовать автоматический выбор из Настройки → Minecraft."><input value={form.javaPath} onChange={event=>setForm(current=>({...current,javaPath:event.target.value}))} placeholder={`Автоматическая Java ${recommendedJava}`} className="w-full px-3 py-2.5 text-sm outline-none" style={{background:'var(--color-bg)',border:'1px solid var(--color-border)',color:'var(--color-text)',borderRadius:'var(--radius-button)'}} /></Field><Field label="Аргументы JVM" desc="Необязательные аргументы, используемые только этой сборкой."><input value={form.jvmArgs} onChange={event=>setForm(current=>({...current,jvmArgs:event.target.value}))} placeholder="-XX:+UseG1GC" className="w-full px-3 py-2.5 text-sm outline-none" style={{background:'var(--color-bg)',border:'1px solid var(--color-border)',color:'var(--color-text)',borderRadius:'var(--radius-button)'}} /></Field><div className="grid grid-cols-2 gap-4"><Field label="Минимальная память"><input type="number" value={form.minRam} onChange={event=>setForm(current=>({...current,minRam:Number(event.target.value)}))} className="w-full px-3 py-2.5 text-sm outline-none" style={{background:'var(--color-bg)',border:'1px solid var(--color-border)',color:'var(--color-text)',borderRadius:'var(--radius-button)'}} /></Field><Field label="Максимальная память"><input type="number" value={form.maxRam} onChange={event=>setForm(current=>({...current,maxRam:Number(event.target.value)}))} className="w-full px-3 py-2.5 text-sm outline-none" style={{background:'var(--color-bg)',border:'1px solid var(--color-border)',color:'var(--color-text)',borderRadius:'var(--radius-button)'}} /></Field></div></>}

              {tab==='content' && <DeletedContentPanel instanceId={inst.id} />}
              {tab==='maintenance' && <div className="space-y-3"><section className="p-4" style={{ background:'transparent', border:'1px solid var(--color-border)', borderRadius:'var(--radius-card)' }}><div className="flex items-center gap-2"><ShieldCheck className="h-4 w-4" style={{ color:'var(--color-primary)' }} /><p className="text-sm font-black" style={{ color:'var(--color-text)' }}>Безопасный режим</p></div><p className="mt-1 text-xs" style={{ color:'var(--color-text-secondary)' }}>Временно отключает Java-моды, не затрагивая миры, конфиги, ресурс-паки и шейдеры. Используйте его только для диагностики сбоя запуска.</p></section><UpdateRollbackPanel instanceId={inst.id} /><section className="p-4" style={{ background:'transparent', border:'1px solid var(--color-border)', borderRadius:'var(--radius-card)' }}><div className="flex items-center gap-2"><Database className="h-4 w-4" style={{ color:'var(--color-primary)' }} /><p className="text-sm font-black" style={{ color:'var(--color-text)' }}>Резервная копия вручную</p></div><p className="mt-1 text-xs" style={{ color:'var(--color-text-secondary)' }}>Создайте полную резервную копию перед сменой версии Minecraft, загрузчика, миров или конфигов. Откат обновления восстанавливает только файлы, изменённые зафиксированным обновлением мода.</p></section><button onClick={() => navigate(`/library/${inst.id}`)} className="rounded-xl px-4 py-2 text-xs font-black" style={{ background:'transparent', color:'var(--color-primary)', border:'1px solid var(--color-primary)' }}>Открыть инструменты обслуживания</button></div>}
            </div>
          </motion.main>
        </div>
      </motion.div>
    </div>
  );
}

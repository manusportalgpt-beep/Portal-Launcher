import { useEffect, useMemo, useState } from 'react';
import { CheckCircle2, Download, FolderOpen, Loader2, RefreshCw, Search, ServerCog, XCircle } from 'lucide-react';
import { listen } from '@tauri-apps/api/event';
import { invoke } from '@/lib/invoke-shim';

type JavaInfo = { path: string; major_version: number; version: string; vendor: string; architecture: string; managed?: boolean };
type DownloadProgress = { percent: number; message: string; version?: number };
const RUNTIME_VERSIONS = [8, 17, 21, 25] as const;

function runtimePurpose(version: number) {
  if (version === 8) return 'Для Minecraft 1.16.5 и более старых версий';
  if (version === 17) return 'Для Minecraft 1.17–1.20.4';
  if (version === 21) return 'Рекомендуется для современных 1.20.5–1.21.x';
  return 'Новая Java для совместимых будущих версий';
}

export function JavaManager({ selectedPath, onSelect }: { selectedPath: string; onSelect: (path: string) => void }) {
  const [installed, setInstalled] = useState<JavaInfo[]>([]);
  const [busyVersion, setBusyVersion] = useState<number | null>(null);
  const [progress, setProgress] = useState<DownloadProgress | null>(null);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');

  const runtimeByVersion = useMemo(() => {
    const runtimes = new Map<number, JavaInfo>();
    for (const java of installed) {
      if (!RUNTIME_VERSIONS.includes(java.major_version as typeof RUNTIME_VERSIONS[number])) continue;
      const current = runtimes.get(java.major_version);
      if (!current || (java.managed && !current.managed)) runtimes.set(java.major_version, java);
    }
    return runtimes;
  }, [installed]);

  const reload = async () => {
    try { setInstalled(await invoke<JavaInfo[]>('get_managed_java_versions')); }
    catch (reason) { setError(String(reason)); }
  };

  useEffect(() => { void reload(); }, []);
  useEffect(() => {
    let off: (() => void) | undefined;
    void listen<any>('java-download', event => {
      setProgress({ percent: Number(event.payload?.percent ?? 0), message: String(event.payload?.message ?? 'Устанавливаю Java…'), version: Number(event.payload?.version ?? 0) || undefined });
    }).then(unlisten => { off = unlisten; });
    return () => off?.();
  }, []);

  const installRecommended = async (version: number, existing?: JavaInfo) => {
    if (existing) {
      onSelect(existing.path);
      setNotice(`Java ${version} уже установлена и будет использована без повторной загрузки.`);
      setError('');
      return;
    }
    setBusyVersion(version); setError(''); setNotice('');
    setProgress({ percent: 0, message: `Подготавливаю рекомендуемую Java ${version}…`, version });
    try {
      const path = await invoke<string>('download_java', { majorVersion: version });
      onSelect(path);
      await reload();
      setNotice(`Java ${version} установлена и выбрана для запуска.`);
    } catch (reason) { setError(String(reason)); }
    finally { setBusyVersion(null); }
  };

  const detect = async (version: number) => {
    setBusyVersion(version); setError(''); setNotice('');
    try {
      const found = await invoke<JavaInfo | null>('detect_java_for_version', { majorVersion: version });
      if (!found) { setNotice(`Совместимая 64-битная Java ${version} не найдена. Установите рекомендуемую версию.`); return; }
      onSelect(found.path);
      await reload();
      setNotice(`Найдена Java ${version}: ${found.vendor || found.path}`);
    } catch (reason) { setError(String(reason)); }
    finally { setBusyVersion(null); }
  };

  const browse = async (expectedVersion: number) => {
    setBusyVersion(expectedVersion); setError(''); setNotice('');
    try {
      const picked = await invoke<JavaInfo | null>('pick_java_executable');
      if (!picked) return;
      if (picked.major_version !== expectedVersion) {
        setError(`Выбрана Java ${picked.major_version}, а в этой карточке нужна Java ${expectedVersion}. Выберите подходящую карточку или правильный java.exe.`);
        return;
      }
      onSelect(picked.path);
      await reload();
      setNotice(`Выбрана Java ${expectedVersion}: ${picked.vendor || picked.path}`);
    } catch (reason) { setError(String(reason)); }
    finally { setBusyVersion(null); }
  };

  return <section className="mt-5 overflow-hidden rounded-2xl" style={{ border:'1px solid var(--color-border)', background:'color-mix(in srgb, var(--color-surface) 96%, transparent)' }}>
    <header className="flex items-start justify-between gap-4 border-b px-4 py-4" style={{ borderColor:'var(--color-border)' }}>
      <div className="flex items-start gap-3"><div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl" style={{ background:'var(--color-primary-dim)', color:'var(--color-primary)' }}><ServerCog className="h-4 w-4" /></div><div><h3 className="text-sm font-black" style={{ color:'var(--color-text)' }}>Установки Java</h3><p className="mt-1 max-w-xl text-[11px] leading-relaxed" style={{ color:'var(--color-text-secondary)' }}>Отдельные совместимые runtime для разных поколений Minecraft. Лаунчер использует точную версию Java, требуемую игрой, а не случайную более новую Java.</p></div></div>
      <button type="button" onClick={() => void reload()} title="Обновить список Java" className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full transition-colors hover:bg-white/5" style={{ color:'var(--color-text-secondary)', border:'1px solid var(--color-border)' }}><RefreshCw className="h-3.5 w-3.5" /></button>
    </header>
    <div className="space-y-4 p-4">
      {RUNTIME_VERSIONS.map(version => {
        const runtime = runtimeByVersion.get(version);
        const isInstalled = Boolean(runtime);
        const isBusy = busyVersion === version;
        const isDownloading = isBusy && progress?.version === version;
        return <article key={version} className="rounded-2xl p-3.5" style={{ background:'var(--color-surface-2)', border:'1px solid var(--color-border)' }}>
          <div className="flex flex-wrap items-start justify-between gap-2"><div><div className="flex items-center gap-2"><h4 className="text-sm font-black" style={{ color:'var(--color-text)' }}>Java {version}</h4>{runtime ? <span className="inline-flex items-center gap-1 text-[10px] font-bold" style={{ color:'var(--color-success, var(--color-primary))' }}><CheckCircle2 className="h-3.5 w-3.5" />Установлено</span> : <span className="inline-flex items-center gap-1 text-[10px] font-bold" style={{ color:'var(--color-text-tertiary)' }}><XCircle className="h-3.5 w-3.5" />Не установлена</span>}</div><p className="mt-1 text-[10px]" style={{ color:'var(--color-text-secondary)' }}>{runtimePurpose(version)}</p></div></div>
          <div className="mt-3 flex min-w-0 items-center gap-2 rounded-xl px-3 py-2" style={{ background:'var(--color-surface)', border:'1px solid var(--color-border)' }}><span className="min-w-0 flex-1 truncate text-[11px]" style={{ color: runtime ? 'var(--color-text-secondary)' : 'var(--color-text-tertiary)' }}>{runtime?.path || '/путь/к/java'}</span>{runtime ? <CheckCircle2 className="h-4 w-4 shrink-0" style={{ color:'var(--color-success, var(--color-primary))' }} /> : <XCircle className="h-4 w-4 shrink-0" style={{ color:'var(--color-error)' }} />}</div>
          <div className="mt-2.5 flex flex-wrap gap-2"><button type="button" disabled={busyVersion !== null} onClick={() => void installRecommended(version, runtime)} className="inline-flex items-center gap-1.5 rounded-xl px-3 py-2 text-[11px] font-black disabled:cursor-wait disabled:opacity-50" style={{ background:'var(--color-primary)', color:'var(--color-primary-text)' }}>{isDownloading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : isInstalled ? <CheckCircle2 className="h-3.5 w-3.5" /> : <Download className="h-3.5 w-3.5" />}{isDownloading ? 'Устанавливаю…' : isInstalled ? 'Использовать установленную' : 'Установить рекомендуемую'}</button><button type="button" disabled={busyVersion !== null} onClick={() => void detect(version)} className="inline-flex items-center gap-1.5 rounded-xl px-3 py-2 text-[11px] font-bold disabled:opacity-50" style={{ background:'var(--color-surface)', color:'var(--color-text-secondary)', border:'1px solid var(--color-border)' }}><Search className="h-3.5 w-3.5" />Найти</button><button type="button" disabled={busyVersion !== null} onClick={() => void browse(version)} className="inline-flex items-center gap-1.5 rounded-xl px-3 py-2 text-[11px] font-bold disabled:opacity-50" style={{ background:'var(--color-surface)', color:'var(--color-text-secondary)', border:'1px solid var(--color-border)' }}><FolderOpen className="h-3.5 w-3.5" />Выбрать файл</button></div>
          {isDownloading && progress && <div className="mt-3"><div className="mb-1 flex justify-between gap-3 text-[10px]" style={{ color:'var(--color-text-secondary)' }}><span className="truncate">{progress.message}</span><span>{progress.percent}%</span></div><div className="h-1.5 overflow-hidden rounded-full" style={{ background:'var(--color-surface)' }}><div className="h-full rounded-full transition-all" style={{ width:`${progress.percent}%`, background:'var(--color-primary)' }} /></div></div>}
        </article>;
      })}
      {notice && <p className="rounded-xl px-3 py-2 text-xs" style={{ background:'var(--color-primary-dim)', color:'var(--color-primary)' }}>{notice}</p>}
      {error && <p className="rounded-xl px-3 py-2 text-xs" style={{ background:'rgba(231,76,60,0.12)', color:'var(--color-error)' }}>{error}</p>}
    </div>
  </section>;
}

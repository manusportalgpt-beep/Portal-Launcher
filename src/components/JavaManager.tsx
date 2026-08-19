import { useEffect, useState } from 'react';
import { Check, Download, Loader2, RefreshCw, ServerCog } from 'lucide-react';
import { listen } from '@tauri-apps/api/event';
import { invoke } from '@/lib/invoke-shim';

type JavaInfo = { path: string; major_version: number; version: string; vendor: string; architecture: string; managed?: boolean };
type Vendor = 'zulu' | 'temurin';
const VERSIONS = [8, 17, 21, 25];

export function JavaManager({ selectedPath, onSelect }: { selectedPath: string; onSelect: (path: string) => void }) {
  const [installed, setInstalled] = useState<JavaInfo[]>([]);
  const [version, setVersion] = useState(21);
  const [vendor, setVendor] = useState<Vendor>('zulu');
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<{ percent: number; message: string } | null>(null);
  const [error, setError] = useState('');

  const reload = async () => {
    try { setInstalled(await invoke<JavaInfo[]>('get_managed_java_versions')); } catch (e) { setError(String(e)); }
  };
  useEffect(() => { void reload(); }, []);
  useEffect(() => {
    let off: (() => void) | undefined;
    void listen<any>('java-download', event => setProgress({ percent: Number(event.payload?.percent ?? 0), message: String(event.payload?.message ?? 'Downloading Java…') })).then(fn => { off = fn; });
    return () => off?.();
  }, []);

  const download = async () => {
    setBusy(true); setError(''); setProgress({ percent: 0, message: `Preparing Java ${version}…` });
    try {
      const command = vendor === 'zulu' ? 'download_java_zulu' : 'download_java_temurin';
      const path = await invoke<string>(command, { majorVersion: version });
      onSelect(path);
      await reload();
      setProgress({ percent: 100, message: `Java ${version} installed and selected.` });
    } catch (e) { setError(String(e)); setProgress(null); }
    finally { setBusy(false); }
  };

  return <div className="mt-4 overflow-hidden rounded-2xl" style={{ border: '1px solid var(--color-border)', background: 'var(--color-surface)' }}>
    <div className="flex items-center gap-2 border-b px-4 py-3" style={{ borderColor: 'var(--color-border)' }}><ServerCog className="h-4 w-4" style={{ color: 'var(--color-primary)' }} /><div><p className="text-sm font-black" style={{ color: 'var(--color-text)' }}>Java Manager</p><p className="text-[11px]" style={{ color: 'var(--color-text-secondary)' }}>Install and select a managed Java runtime. Minecraft uses Java 8, 17 or 21 depending on version; 25 is available for testing.</p></div></div>
    <div className="p-4">
      <div className="grid gap-3 sm:grid-cols-[1fr_auto]">
        <div>
          <p className="mb-1.5 text-[10px] font-black uppercase tracking-wide" style={{ color: 'var(--color-text-tertiary)' }}>Java version</p>
          <div className="grid grid-cols-4 gap-1.5">{VERSIONS.map(item => <button key={item} onClick={() => setVersion(item)} className="rounded-xl px-2 py-2 text-xs font-black" style={{ background: version === item ? 'var(--color-primary)' : 'var(--color-surface-2)', color: version === item ? 'var(--color-primary-text)' : 'var(--color-text-secondary)', border: `1px solid ${version === item ? 'var(--color-primary)' : 'var(--color-border)'}` }}>{item}</button>)}</div>
        </div>
        <div>
          <p className="mb-1.5 text-[10px] font-black uppercase tracking-wide" style={{ color: 'var(--color-text-tertiary)' }}>Provider</p>
          <div className="flex overflow-hidden rounded-xl" style={{ border: '1px solid var(--color-border)' }}>{(['zulu', 'temurin'] as Vendor[]).map(item => <button key={item} onClick={() => setVendor(item)} className="px-3 py-2 text-xs font-bold" style={{ background: vendor === item ? 'var(--color-primary)' : 'var(--color-surface-2)', color: vendor === item ? 'var(--color-primary-text)' : 'var(--color-text-secondary)' }}>{item === 'zulu' ? 'Azul Zulu' : 'Adoptium'}</button>)}</div>
        </div>
      </div>
      <button onClick={() => void download()} disabled={busy} className="mt-3 flex w-full items-center justify-center gap-2 rounded-xl py-2.5 text-xs font-black disabled:opacity-50" style={{ background: 'var(--color-primary)', color: 'var(--color-primary-text)' }}>{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}{busy ? 'Downloading Java…' : `Install ${vendor === 'zulu' ? 'Azul Zulu' : 'Adoptium Temurin'} Java ${version}`}</button>
      {progress && <div className="mt-3"><div className="mb-1 flex justify-between text-[10px]" style={{ color: 'var(--color-text-secondary)' }}><span className="truncate">{progress.message}</span><span>{progress.percent}%</span></div><div className="h-1.5 overflow-hidden rounded-full" style={{ background: 'var(--color-surface-2)' }}><div className="h-full rounded-full transition-all" style={{ width: `${progress.percent}%`, background: 'var(--color-primary)' }} /></div></div>}
      {error && <p className="mt-2 text-xs" style={{ color: 'var(--color-error)' }}>{error}</p>}
      <div className="mt-4"><div className="mb-1.5 flex items-center justify-between"><p className="text-[10px] font-black uppercase tracking-wide" style={{ color: 'var(--color-text-tertiary)' }}>Detected Java runtimes</p><button onClick={() => void reload()} title="Refresh"><RefreshCw className="h-3.5 w-3.5" style={{ color: 'var(--color-text-secondary)' }} /></button></div><div className="max-h-32 space-y-1 overflow-y-auto">{installed.length === 0 ? <p className="text-xs" style={{ color: 'var(--color-text-tertiary)' }}>No managed Java found yet.</p> : installed.map(java => <button key={java.path} onClick={() => onSelect(java.path)} className="flex w-full items-center gap-2 rounded-xl px-2.5 py-2 text-left" style={{ background: selectedPath === java.path ? 'var(--color-primary-dim)' : 'var(--color-surface-2)', border: `1px solid ${selectedPath === java.path ? 'var(--color-primary)' : 'var(--color-border)'}` }}><span className="flex h-6 w-6 items-center justify-center rounded-lg text-[10px] font-black" style={{ background: 'var(--color-bg)', color: 'var(--color-primary)' }}>{java.major_version}</span><span className="min-w-0 flex-1"><span className="block truncate text-[11px] font-bold" style={{ color: 'var(--color-text)' }}>{java.vendor || 'Java'} {java.version}</span><span className="block truncate text-[9px]" style={{ color: 'var(--color-text-tertiary)' }}>{java.path}</span></span>{selectedPath === java.path && <Check className="h-3.5 w-3.5" style={{ color: 'var(--color-primary)' }} />}</button>)}</div></div>
    </div>
  </div>;
}

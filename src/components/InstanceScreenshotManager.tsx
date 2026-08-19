import { useCallback, useEffect, useState } from 'react';
import { Camera, Copy, Edit3, Folder, RefreshCw, Trash2, X } from 'lucide-react';
import { invoke } from '@/lib/invoke-shim';
import { toIconSrc } from '@/lib/icon-src';
import { ScreenshotEditor } from '@/components/ScreenshotEditor';

type Screenshot = { path: string; name: string; url: string };

export function InstanceScreenshotManager({ instanceId }: { instanceId: string }) {
  const [screenshots, setScreenshots] = useState<Screenshot[]>([]);
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState<Screenshot | null>(null);
  const [editing, setEditing] = useState<Screenshot | null>(null);
  const [error, setError] = useState('');

  const loadScreenshots = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const paths = await invoke<string[]>('list_screenshots', { id: instanceId });
      const mapped = (paths || []).map(path => ({
        path,
        name: path.split(/[\\/]/).pop() || path,
        url: toIconSrc(path) || '',
      })).sort((a, b) => b.name.localeCompare(a.name));
      setScreenshots(mapped);
    } catch (e: any) { setScreenshots([]); setError(String(e?.message ?? e)); }
    finally { setLoading(false); }
  }, [instanceId]);

  useEffect(() => { void loadScreenshots(); }, [loadScreenshots]);

  const remove = async (shot: Screenshot) => {
    try {
      await invoke('delete_instance_screenshot', { id: instanceId, fileName: shot.name });
      setSelected(null); setEditing(null); await loadScreenshots();
    } catch (e: any) { setError(String(e?.message ?? e)); }
  };

  return <div className="space-y-4 p-4">
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl px-4 py-3" style={{ background:'var(--color-surface)', border:'1px solid var(--color-border)' }}>
      <div className="flex min-w-0 items-center gap-3"><span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl" style={{ background:'var(--color-primary-dim)', color:'var(--color-primary)' }}><Camera className="h-5 w-5" /></span><div><p className="text-sm font-black" style={{ color:'var(--color-text)' }}>Screenshots</p><p className="text-[11px]" style={{ color:'var(--color-text-secondary)' }}>{screenshots.length} screenshot{screenshots.length === 1 ? '' : 's'} in this instance</p></div></div>
      <div className="flex items-center gap-2"><button onClick={() => invoke('instance_open_dir', { instanceId, path:'screenshots' }).catch(() => {})} className="flex items-center gap-1.5 rounded-xl px-3 py-2 text-xs font-bold" style={{ background:'var(--color-surface-2)', color:'var(--color-text-secondary)', border:'1px solid var(--color-border)' }}><Folder className="h-3.5 w-3.5" />Open folder</button><button onClick={() => void loadScreenshots()} className="rounded-xl p-2" style={{ background:'var(--color-surface-2)', color:'var(--color-text-secondary)', border:'1px solid var(--color-border)' }} title="Refresh screenshots"><RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} /></button></div>
    </div>
    {error && <p className="rounded-xl px-3 py-2 text-xs" style={{ background:'rgba(231,76,60,.12)', color:'var(--color-error)' }}>{error}</p>}
    {!loading && screenshots.length === 0 ? <div className="flex flex-col items-center justify-center rounded-2xl py-20" style={{ background:'var(--color-surface)', border:'1px solid var(--color-border)' }}><Camera className="mb-3 h-10 w-10" style={{ color:'var(--color-text-tertiary)' }} /><p className="text-sm font-black" style={{ color:'var(--color-text)' }}>No screenshots yet</p><p className="mt-1 text-xs" style={{ color:'var(--color-text-secondary)' }}>Press F2 in Minecraft, then refresh this page.</p></div> : <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-4">{screenshots.map(shot => <button key={shot.path} onClick={() => setSelected(shot)} className="group overflow-hidden rounded-2xl text-left transition-transform hover:-translate-y-0.5" style={{ background:'var(--color-surface)', border:'1px solid var(--color-border)' }}><div className="aspect-video overflow-hidden" style={{ background:'var(--color-surface-2)' }}><img src={shot.url} alt={shot.name} className="h-full w-full object-cover transition-transform group-hover:scale-[1.03]" /></div><div className="flex items-center gap-2 px-3 py-2"><span className="min-w-0 flex-1 truncate text-xs font-semibold" style={{ color:'var(--color-text)' }}>{shot.name}</span><Camera className="h-3.5 w-3.5 shrink-0" style={{ color:'var(--color-primary)' }} /></div></button>)}</div>}

    {selected && <div className="fixed inset-0 z-[150] flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm" onClick={() => setSelected(null)}><div className="flex max-h-[92vh] w-full max-w-6xl flex-col overflow-hidden rounded-2xl" style={{ background:'var(--color-surface)', border:'1px solid var(--color-border)' }} onClick={event => event.stopPropagation()}><div className="flex items-center gap-3 border-b px-4 py-3" style={{ borderColor:'var(--color-border)' }}><Camera className="h-4 w-4" style={{ color:'var(--color-primary)' }} /><p className="min-w-0 flex-1 truncate text-sm font-bold" style={{ color:'var(--color-text)' }}>{selected.name}</p><button onClick={() => navigator.clipboard?.writeText(selected.path)} className="flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-xs font-semibold" style={{ background:'var(--color-surface-2)', color:'var(--color-text-secondary)' }}><Copy className="h-3 w-3" />Copy path</button><button onClick={() => setSelected(null)} className="rounded-lg p-1.5" style={{ color:'var(--color-text-secondary)' }}><X className="h-4 w-4" /></button></div><div className="flex min-h-0 flex-1 items-center justify-center overflow-auto p-5" style={{ background:'radial-gradient(circle, var(--color-surface-2), var(--color-bg))' }}><img src={selected.url} alt={selected.name} className="max-h-[70vh] max-w-full rounded-xl object-contain shadow-2xl" /></div><div className="flex flex-wrap items-center justify-center gap-2 border-t px-4 py-3" style={{ borderColor:'var(--color-border)' }}><button onClick={() => setEditing(selected)} className="flex items-center gap-1.5 rounded-xl px-4 py-2 text-xs font-bold" style={{ background:'var(--color-primary)', color:'var(--color-primary-text)' }}><Edit3 className="h-3.5 w-3.5" />Edit</button><button onClick={() => void remove(selected)} className="flex items-center gap-1.5 rounded-xl px-4 py-2 text-xs font-bold" style={{ background:'rgba(231,76,60,.12)', color:'var(--color-error)' }}><Trash2 className="h-3.5 w-3.5" />Delete</button></div></div></div>}
    {editing && <ScreenshotEditor instanceId={instanceId} fileName={editing.name} imageUrl={editing.url} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); setSelected(null); void loadScreenshots(); }} />}
  </div>;
}

export default InstanceScreenshotManager;

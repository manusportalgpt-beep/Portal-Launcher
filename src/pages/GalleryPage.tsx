import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Image, X, ChevronLeft, ChevronRight, Folder, Camera, RefreshCw, Trash2 } from 'lucide-react';
import { useInstanceStore } from '@/stores/instanceStore';
import { useLocation } from 'react-router-dom';
import { invoke } from '@/lib/invoke-shim';
import { screenshotBytesToDataUrl } from '@/lib/screenshot-url';

interface Screenshot {
  id: string;
  path: string;
  url: string;
  instanceName: string;
  instanceId: string;
  createdAt: string;
}

export function GalleryPage() {
  const { instances } = useInstanceStore();
  const location = useLocation();
  const [screenshots, setScreenshots] = useState<Screenshot[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedIdx, setSelectedIdx] = useState<number | null>(null);
  const [filterInstance, setFilterInstance] = useState<string>(() => (location.state as any)?.instanceId ?? 'all');

  useEffect(() => {
    loadScreenshots();
  }, []);

  const loadScreenshots = async () => {
    setLoading(true);
    try {
      const all: Screenshot[] = [];
      for (const inst of instances) {
        try {
          const paths = await invoke<string[]>('list_screenshots', { id: inst.id });
          for (const p of paths || []) {
            const fileName = p.split(/[\\/]/).pop() || p;
            const bytes = await invoke<number[]>('read_instance_screenshot', { id: inst.id, fileName });
            all.push({
              id: `${inst.id}-${p}`,
              path: p,
              url: screenshotBytesToDataUrl(bytes, fileName),
              instanceName: inst.name,
              instanceId: inst.id,
              createdAt: new Date().toISOString(),
            });
          }
        } catch { /* instance may have no screenshots */ }
      }
      setScreenshots(all);
    } catch { /* ignore */ } finally {
      setLoading(false);
    }
  };

  const filtered = filterInstance === 'all'
    ? screenshots
    : screenshots.filter(s => s.instanceId === filterInstance);

  const openScreenshotsFolder = async (instanceId: string) => {
    await invoke('instance_open_dir', { instanceId, path: 'screenshots' }).catch(() => {});
  };
  const deleteScreenshot = async (screenshot: Screenshot) => {
    const fileName = screenshot.path.split(/[\\/]/).pop() ?? '';
    if (!fileName) return;
    await invoke('delete_instance_screenshot', { id: screenshot.instanceId, fileName });
    setSelectedIdx(null);
    await loadScreenshots();
  };

  const selected = selectedIdx !== null ? filtered[selectedIdx] : null;

  return (
    <div className="h-full flex flex-col overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-4 shrink-0"
        style={{ borderBottom: '1px solid var(--color-border)' }}>
        <div>
          <h1 className="text-lg font-black flex items-center gap-2" style={{ color: 'var(--color-text)' }}>
            <Camera className="w-5 h-5" style={{ color: 'var(--color-primary)' }} />
            Gallery
          </h1>
          <p className="text-xs mt-0.5" style={{ color: 'var(--color-text-secondary)' }}>
            Screenshots from your Minecraft instances
          </p>
        </div>
          <div className="flex items-center gap-2">
          <button onClick={loadScreenshots} title="Refresh gallery" className="w-8 h-8 rounded-xl flex items-center justify-center" style={{ background:'var(--color-surface-2)', border:'1px solid var(--color-border)', color:'var(--color-text-secondary)' }}><RefreshCw className="w-3.5 h-3.5" /></button>
          {filterInstance !== 'all' && <button onClick={() => openScreenshotsFolder(filterInstance)} title="Open screenshots folder" className="w-8 h-8 rounded-xl flex items-center justify-center" style={{ background:'var(--color-surface-2)', border:'1px solid var(--color-border)', color:'var(--color-text-secondary)' }}><Folder className="w-3.5 h-3.5" /></button>}
          {/* Instance filter */}
          <select
            value={filterInstance}
            onChange={e => setFilterInstance(e.target.value)}
            className="px-3 py-1.5 rounded-xl text-xs font-semibold appearance-none cursor-pointer"
            style={{ background: 'var(--color-surface-2)', border: '1px solid var(--color-border)', color: 'var(--color-text)' }}>
            <option value="all">All instances</option>
            {instances.map(i => <option key={i.id} value={i.id}>{i.name}</option>)}
          </select>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-6">
        {loading ? (
          <div className="grid grid-cols-4 gap-3">
            {Array.from({ length: 8 }).map((_, i) => (
              <div key={i} className="aspect-video rounded-2xl animate-pulse"
                style={{ background: 'var(--color-surface)' }} />
            ))}
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full gap-4 py-20">
            <div className="w-20 h-20 rounded-3xl flex items-center justify-center"
              style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)' }}>
              <Image className="w-10 h-10" style={{ color: 'var(--color-text-tertiary)' }} />
            </div>
            <div className="text-center">
              <p className="font-bold text-lg" style={{ color: 'var(--color-text)' }}>No screenshots yet</p>
              <p className="text-sm mt-1" style={{ color: 'var(--color-text-secondary)' }}>
                Screenshots from your Minecraft sessions will appear here.
              </p>
              <p className="text-xs mt-1" style={{ color: 'var(--color-text-tertiary)' }}>
                Press F2 in-game to take a screenshot
              </p>
            </div>
            {instances.length > 0 && (
              <button
                onClick={loadScreenshots}
                className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold"
                style={{ background: 'var(--color-primary)', color: 'var(--color-primary-text)' }}>
                <Folder className="w-4 h-4" />Open screenshots folder
              </button>
            )}
          </div>
        ) : (
          <div className="grid grid-cols-4 gap-3">
            {filtered.map((s, i) => (
              <motion.button
                key={s.id}
                className="aspect-video rounded-2xl overflow-hidden relative group"
                style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)' }}
                whileHover={{ scale: 1.02 }}
                onClick={() => setSelectedIdx(i)}>
                <img src={s.url} alt="" className="w-full h-full object-cover" onError={e => { (e.target as HTMLImageElement).style.display = 'none'; }} />
                <div className="absolute inset-0 bg-black/0 group-hover:bg-black/30 transition-all flex items-end p-2">
                  <span className="text-[10px] font-semibold text-white opacity-0 group-hover:opacity-100 transition-opacity truncate">
                    {s.instanceName}
                  </span>
                </div>
              </motion.button>
            ))}
          </div>
        )}
      </div>

      {/* Lightbox */}
      <AnimatePresence>
        {selected && selectedIdx !== null && (
          <motion.div
            className="fixed inset-0 z-50 flex items-center justify-center"
            style={{ background: 'rgba(0,0,0,0.9)', backdropFilter: 'blur(8px)' }}
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            onClick={() => setSelectedIdx(null)}>
            <motion.div
              className="relative max-w-4xl w-full mx-8"
              initial={{ scale: 0.9 }} animate={{ scale: 1 }} exit={{ scale: 0.9 }}
              onClick={e => e.stopPropagation()}>
              <img src={selected.url} alt="" className="w-full rounded-2xl object-contain max-h-[80vh]" />
              <div className="flex items-center justify-between mt-3">
                <div className="flex items-center gap-2"><p className="text-sm text-white/70">{selected.instanceName}</p><button onClick={() => openScreenshotsFolder(selected.instanceId)} className="px-2.5 py-1.5 rounded-lg text-xs font-semibold bg-white/10 hover:bg-white/20">Folder</button><button onClick={() => deleteScreenshot(selected)} className="w-8 h-8 rounded-lg flex items-center justify-center bg-red-500/20 hover:bg-red-500/35" title="Delete screenshot"><Trash2 className="w-3.5 h-3.5 text-red-200" /></button></div>
                <button onClick={() => setSelectedIdx(null)}
                  className="w-8 h-8 rounded-xl flex items-center justify-center bg-white/10 hover:bg-white/20 transition-colors">
                  <X className="w-4 h-4 text-white" />
                </button>
              </div>
            </motion.div>
            {selectedIdx > 0 && (
              <button
                className="absolute left-4 w-10 h-10 rounded-xl flex items-center justify-center bg-white/10 hover:bg-white/20 transition-colors"
                onClick={e => { e.stopPropagation(); setSelectedIdx(selectedIdx - 1); }}>
                <ChevronLeft className="w-5 h-5 text-white" />
              </button>
            )}
            {selectedIdx < filtered.length - 1 && (
              <button
                className="absolute right-4 w-10 h-10 rounded-xl flex items-center justify-center bg-white/10 hover:bg-white/20 transition-colors"
                onClick={e => { e.stopPropagation(); setSelectedIdx(selectedIdx + 1); }}>
                <ChevronRight className="w-5 h-5 text-white" />
              </button>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

import { useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Check, Code, Download, EyeOff, X } from 'lucide-react';

export type ModpackPreviewEntry = {
  path: string;
  name: string;
  version: string;
  author: string;
  author_url?: string;
  author_avatar_url?: string;
  icon_url?: string;
  required: boolean;
  kind: string;
  source?: string;
};

export type ModpackPreview = {
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
};

const labels: Record<string, string> = { mod: 'Модификации', resourcepack: 'Наборы ресурсов', shaderpack: 'Шейдеры', datapack: 'Дата-паки' };

export function ModpackManifestPreview({ preview, onClose, onInstall }: { preview: ModpackPreview; onClose: () => void; onInstall: (excludedPaths: string[]) => void }) {
  const [excluded, setExcluded] = useState<Set<string>>(() => new Set());
  const groups = useMemo(() => ['mod', 'resourcepack', 'shaderpack', 'datapack'].map(kind => ({ kind, entries: preview.entries.filter(entry => entry.kind === kind) })).filter(group => group.entries.length), [preview.entries]);
  const toggle = (path: string) => setExcluded(current => { const next = new Set(current); next.has(path) ? next.delete(path) : next.add(path); return next; });
  return <AnimatePresence>
    <motion.div data-portal-overlay="true" className="fixed inset-0 z-[170] flex items-center justify-center p-4" style={{ background:'color-mix(in srgb, var(--color-bg) 54%, rgba(0,0,0,0.8))', backdropFilter:'blur(10px)' }} initial={{ opacity:0 }} animate={{ opacity:1 }} exit={{ opacity:0 }} onClick={event => { if (event.target === event.currentTarget) onClose(); }}>
      <motion.div className="w-full max-w-2xl overflow-hidden rounded-[28px]" style={{ background:'color-mix(in srgb, var(--color-surface) 96%, transparent)', border:'1px solid color-mix(in srgb, var(--color-border) 75%, var(--color-primary))', boxShadow:'var(--shadow-lg)' }} initial={{ opacity:0, y:12, scale:0.97 }} animate={{ opacity:1, y:0, scale:1 }} exit={{ opacity:0, y:12, scale:0.97 }}>
        <header className="relative flex items-start justify-between gap-4 overflow-hidden px-5 py-4" style={{ background:'linear-gradient(120deg, color-mix(in srgb, var(--color-surface-2) 84%, var(--color-primary) 16%), var(--color-surface))', borderBottom:'1px solid var(--color-border)' }}>
          <span aria-hidden className="pointer-events-none absolute -right-8 -top-9 h-28 w-28 rounded-full" style={{ background:'radial-gradient(circle, color-mix(in srgb, var(--color-primary) 22%, transparent), transparent 72%)' }} />
          <div className="min-w-0 flex-1"><p className="text-[10px] font-black uppercase tracking-wider" style={{ color:'var(--color-primary)' }}>Содержимое перед установкой</p><div className="mt-1 flex items-center gap-3"><div className="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-xl" style={{ background:'var(--color-surface-2)' }}>{preview.icon_url ? <img src={preview.icon_url} className="h-full w-full object-cover" alt="" /> : <Code className="h-4 w-4" style={{ color:'var(--color-primary)' }} />}</div><div className="min-w-0"><h2 className="truncate text-lg font-black" style={{ color:'var(--color-text)' }}>{preview.name}</h2><p className="truncate text-[11px]" style={{ color:'var(--color-text-secondary)' }}>{preview.author || 'Автор не указан'} · {preview.minecraft_version} · {preview.loader}</p></div></div><p className="mt-2 text-xs" style={{ color:'var(--color-text-secondary)' }}>Отключите только те файлы, которые не хотите устанавливать. Архив и manifest не изменятся.</p></div>
          <button data-portal-close="true" type="button" onClick={onClose} aria-label="Закрыть просмотр manifest" className="relative flex h-9 w-9 shrink-0 items-center justify-center rounded-xl outline-none transition-colors hover:bg-white/10 focus-visible:ring-2 focus-visible:ring-[var(--color-primary)]" style={{ background:'color-mix(in srgb, var(--color-surface-2) 86%, transparent)', color:'var(--color-text-secondary)' }}><X className="h-4 w-4" /></button>
        </header>
        <div className="max-h-[52vh] space-y-4 overflow-y-auto p-3">{groups.map(group => <section key={group.kind}><div className="mb-1.5 flex items-center justify-between px-1"><p className="text-[10px] font-black uppercase tracking-wider" style={{ color:'var(--color-primary)' }}>{labels[group.kind] || group.kind}</p><span className="rounded-full px-2 py-0.5 text-[10px] font-bold" style={{ background:'var(--color-surface-2)', color:'var(--color-text-tertiary)' }}>{group.entries.length}</span></div><div className="space-y-1.5">{group.entries.map(entry => { const active = !excluded.has(entry.path); return <button type="button" key={entry.path} onClick={() => toggle(entry.path)} className="flex w-full items-center gap-3 rounded-2xl p-2.5 text-left outline-none transition-transform duration-150 hover:-translate-y-0.5 focus-visible:ring-2 focus-visible:ring-[var(--color-primary)]" style={{ background:active ? 'var(--color-surface-2)' : 'color-mix(in srgb, var(--color-warning) 8%, var(--color-surface-2))', border:`1px solid ${active ? 'var(--color-border)' : 'color-mix(in srgb, var(--color-warning) 55%, transparent)'}`, opacity:active ? 1 : 0.72 }}><span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-md" style={{ background:active ? 'var(--color-primary)' : 'rgba(243,156,18,0.14)', color:active ? 'var(--color-primary-text)' : 'var(--color-warning)' }}>{active ? <Check className="h-3.5 w-3.5" /> : <EyeOff className="h-3.5 w-3.5" />}</span><div className="flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-xl" style={{ background:'var(--color-surface)' }}>{entry.icon_url ? <img src={entry.icon_url} className="h-full w-full object-cover" alt="" /> : <Code className="h-4 w-4" style={{ color:'var(--color-primary)' }} />}</div><div className="min-w-0 flex-1"><p className="truncate text-sm font-bold" style={{ color:'var(--color-text)' }}>{entry.name}</p><p className="truncate text-[10px]" style={{ color:'var(--color-text-secondary)' }}>{entry.author || 'Автор не указан'} · {entry.version} · {entry.source || preview.source}</p><p className="mt-0.5 truncate text-[9px]" style={{ color:'var(--color-text-tertiary)' }}>{entry.path}</p></div>{!active && <span className="text-[9px] font-bold" style={{ color:'var(--color-warning)' }}>НЕ УСТАНАВЛИВАТЬ</span>}</button>; })}</div></section>)}</div>
        <footer className="flex items-center justify-between gap-3 px-5 py-4" style={{ background:'color-mix(in srgb, var(--color-surface) 92%, transparent)', borderTop:'1px solid var(--color-border)' }}><span className="text-xs" style={{ color:'var(--color-text-secondary)' }}>{excluded.size ? `Будет исключено: ${excluded.size}` : 'Все элементы будут установлены'}</span><div className="flex gap-2"><button type="button" onClick={onClose} className="rounded-xl px-4 py-2 text-sm font-semibold transition-colors hover:bg-white/5" style={{ background:'var(--color-surface-2)', color:'var(--color-text-secondary)', border:'1px solid var(--color-border)' }}>Отмена</button><button type="button" onClick={() => onInstall([...excluded])} className="flex items-center gap-2 rounded-xl px-4 py-2 text-sm font-bold transition-transform duration-150 hover:-translate-y-0.5 active:scale-[0.98]" style={{ background:'var(--color-primary)', color:'var(--color-primary-text)', boxShadow:'var(--shadow-glow)' }}><Download className="h-4 w-4" />Установить выбранное</button></div></footer>
      </motion.div>
    </motion.div>
  </AnimatePresence>;
}

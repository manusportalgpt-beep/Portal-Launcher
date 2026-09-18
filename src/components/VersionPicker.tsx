import { useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { ChevronDown, Search, Check } from 'lucide-react';

export function VersionPicker({ versions, value, onChange, showSnapshots }: { versions: string[]; value: string; onChange: (value: string) => void; showSnapshots: boolean }) {
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
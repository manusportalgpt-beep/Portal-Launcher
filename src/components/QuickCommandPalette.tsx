import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Command, Compass, FolderOpen, GalleryHorizontal, Home, Search, Settings, X, BarChart3 } from 'lucide-react';
import { useInstanceStore } from '@/stores/instanceStore';

type CommandItem = { id: string; title: string; subtitle: string; Icon: any; run: () => void };

export function QuickCommandPalette() {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const navigate = useNavigate();
  const instances = useInstanceStore(state => state.instances);
  const select = useInstanceStore(state => state.select);

  useEffect(() => {
    const listener = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault(); setOpen(value => !value); setQuery('');
      }
      if (event.key === 'Escape') setOpen(false);
    };
    window.addEventListener('keydown', listener);
    return () => window.removeEventListener('keydown', listener);
  }, []);

  const items = useMemo<CommandItem[]>(() => {
    const routes: CommandItem[] = [
      { id:'home', title:'Home', subtitle:'Open launcher home', Icon:Home, run:() => navigate('/home') },
      { id:'discover', title:'Discover', subtitle:'Browse mods and modpacks', Icon:Compass, run:() => navigate('/discover') },
      { id:'library', title:'Library', subtitle:'Manage all instances', Icon:FolderOpen, run:() => navigate('/library') },
      { id:'gallery', title:'Screenshot manager', subtitle:'Browse Minecraft screenshots', Icon:GalleryHorizontal, run:() => navigate('/gallery') },
      { id:'control-center', title:'Control center', subtitle:'Statistics, achievements and recovery', Icon:BarChart3, run:() => navigate('/control-center') },
      { id:'settings', title:'Settings', subtitle:'Appearance, accounts and launcher options', Icon:Settings, run:() => navigate('/settings') },
    ];
    return [...routes, ...instances.map(instance => ({
      id:`instance-${instance.id}`, title:instance.name, subtitle:`${instance.minecraftVersion} · ${instance.modLoader}`, Icon:FolderOpen,
      run:() => { select(instance.id); navigate('/library'); },
    }))];
  }, [instances, navigate, select]);

  const visible = items.filter(item => `${item.title} ${item.subtitle}`.toLowerCase().includes(query.toLowerCase())).slice(0, 12);
  const run = (item: CommandItem) => { item.run(); setOpen(false); };
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[100] flex items-start justify-center pt-[16vh] p-4" style={{ background:'rgba(0,0,0,0.64)', backdropFilter:'blur(7px)' }} onClick={() => setOpen(false)}>
      <div className="w-full max-w-xl rounded-2xl overflow-hidden" style={{ background:'var(--color-surface)', border:'1px solid var(--color-border)', boxShadow:'var(--shadow-lg)' }} onClick={event => event.stopPropagation()}>
        <div className="flex items-center gap-2 px-4 py-3" style={{ borderBottom:'1px solid var(--color-border)' }}><Search className="w-4 h-4" style={{ color:'var(--color-primary)' }} /><input autoFocus value={query} onChange={event => setQuery(event.target.value)} placeholder="Search commands, pages and instances…" className="flex-1 bg-transparent text-sm outline-none" style={{ color:'var(--color-text)' }} /><kbd className="text-[10px] px-1.5 py-1 rounded-md" style={{ background:'var(--color-surface-2)', color:'var(--color-text-tertiary)' }}>ESC</kbd><button onClick={() => setOpen(false)}><X className="w-4 h-4" style={{ color:'var(--color-text-secondary)' }} /></button></div>
        <div className="p-2 max-h-[50vh] overflow-y-auto">
          {visible.length ? visible.map(item => <button key={item.id} onClick={() => run(item)} className="w-full flex items-center gap-3 p-3 rounded-xl text-left hover:bg-white/5"><span className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ background:'var(--color-primary-dim)', color:'var(--color-primary)' }}><item.Icon className="w-4 h-4" /></span><span className="flex-1 min-w-0"><span className="block text-sm font-bold truncate" style={{ color:'var(--color-text)' }}>{item.title}</span><span className="block text-[11px] truncate" style={{ color:'var(--color-text-secondary)' }}>{item.subtitle}</span></span></button>) : <p className="py-8 text-center text-sm" style={{ color:'var(--color-text-tertiary)' }}>No commands found</p>}
        </div>
        <div className="px-4 py-2 flex items-center gap-1.5 text-[10px]" style={{ color:'var(--color-text-tertiary)', borderTop:'1px solid var(--color-border)' }}><Command className="w-3 h-3" />Quick command palette</div>
      </div>
    </div>
  );
}

export default QuickCommandPalette;

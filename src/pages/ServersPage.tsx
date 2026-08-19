import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, ChevronDown, ExternalLink, Filter, Globe2, Heart, Search, Server, Wifi, X } from 'lucide-react';
import { invoke } from '@/lib/invoke-shim';

type ServerType = 'all' | 'vanilla' | 'modded';
type SortMode = 'relevance' | 'online' | 'players';

type SavedServer = {
  id: string;
  name: string;
  address: string;
  description: string;
  region: string;
  type: Exclude<ServerType, 'all'>;
  tags: string[];
  online?: number;
  players?: number;
};

const CATALOG_URL = 'https://modrinth.com/discover/servers?sst=online';

function numberLabel(value?: number) {
  return typeof value === 'number' ? value.toLocaleString() : '—';
}

export function ServersPage() {
  const navigate = useNavigate();
  const [query, setQuery] = useState('');
  const [type, setType] = useState<ServerType>('all');
  const [region, setRegion] = useState('all');
  const [sort, setSort] = useState<SortMode>('relevance');
  const [onlyOnline, setOnlyOnline] = useState(true);
  const [showAddForm, setShowAddForm] = useState(false);
  const [draft, setDraft] = useState({ name:'', address:'', description:'', region:'Custom', type:'vanilla' as Exclude<ServerType, 'all'> });
  const [favorites, setFavorites] = useState<string[]>(() => {
    try { return JSON.parse(localStorage.getItem('portal-server-favorites') || '[]'); } catch { return []; }
  });
  const [savedServers, setSavedServers] = useState<SavedServer[]>(() => {
    try { return JSON.parse(localStorage.getItem('portal-saved-servers') || '[]'); } catch { return []; }
  });

  const regions = useMemo(() => ['all', ...Array.from(new Set(savedServers.map(server => server.region).filter(Boolean)))], [savedServers]);
  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return savedServers
      .filter(server => type === 'all' || server.type === type)
      .filter(server => region === 'all' || server.region === region)
      .filter(server => !onlyOnline || (server.online ?? 0) > 0)
      .filter(server => !needle || `${server.name} ${server.address} ${server.description} ${server.tags.join(' ')}`.toLowerCase().includes(needle))
      .sort((a, b) => sort === 'online' ? (b.online ?? 0) - (a.online ?? 0) : sort === 'players' ? (b.players ?? 0) - (a.players ?? 0) : a.name.localeCompare(b.name));
  }, [onlyOnline, query, region, savedServers, sort, type]);

  const saveFavorites = (next: string[]) => {
    setFavorites(next);
    localStorage.setItem('portal-server-favorites', JSON.stringify(next));
  };

  const toggleFavorite = (id: string) => saveFavorites(favorites.includes(id) ? favorites.filter(item => item !== id) : [...favorites, id]);
  const openOfficialCatalog = () => { void invoke('open_modrinth_servers_webview').catch(() => invoke('open_url', { url: CATALOG_URL }).catch(() => window.open(CATALOG_URL, '_blank'))); };
  const addServer = () => setShowAddForm(true);
  const submitServer = () => {
    if (!draft.name.trim() || !draft.address.trim()) return;
    const next: SavedServer = { id: `local-${Date.now()}`, name: draft.name.trim(), address: draft.address.trim(), description: draft.description.trim() || 'Saved from Portal Launcher', region: draft.region.trim() || 'Custom', type: draft.type, tags: ['Custom'] };
    const all = [next, ...savedServers];
    setSavedServers(all);
    localStorage.setItem('portal-saved-servers', JSON.stringify(all));
    setDraft({ name:'', address:'', description:'', region:'Custom', type:'vanilla' });
    setShowAddForm(false);
  };

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden">
      <header className="flex shrink-0 flex-wrap items-center gap-3 border-b px-4 py-3" style={{ borderColor:'var(--color-border)' }}>
        <button onClick={() => navigate('/discover')} className="flex h-8 w-8 items-center justify-center rounded-xl" style={{ color:'var(--color-text-secondary)', border:'1px solid var(--color-border)' }}><ArrowLeft className="h-4 w-4" /></button>
        <div className="flex items-center gap-2"><Server className="h-5 w-5" style={{ color:'var(--color-primary)' }} /><div><h1 className="text-base font-black" style={{ color:'var(--color-text)' }}>Servers</h1><p className="text-[10px]" style={{ color:'var(--color-text-tertiary)' }}>Modrinth server discovery</p></div></div>
        <div className="flex-1" />
        <button onClick={openOfficialCatalog} className="flex items-center gap-2 rounded-xl px-3 py-2 text-xs font-bold" style={{ background:'var(--color-primary-dim)', color:'var(--color-primary)', border:'1px solid var(--color-primary)' }}><ExternalLink className="h-3.5 w-3.5" />Open Modrinth</button>
        <button onClick={addServer} className="flex items-center gap-2 rounded-xl px-3 py-2 text-xs font-bold" style={{ background:'var(--color-primary)', color:'var(--color-primary-text)' }}><Server className="h-3.5 w-3.5" />Add server</button>
      </header>

      <div className="flex shrink-0 items-center gap-2 border-b px-4 py-2" style={{ borderColor:'var(--color-border)', background:'var(--color-surface)' }}>
        <div className="relative min-w-0 flex-1"><Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2" style={{ color:'var(--color-text-tertiary)' }} /><input value={query} onChange={event => setQuery(event.target.value)} placeholder="Search servers..." className="w-full rounded-xl py-2 pl-9 pr-3 text-sm outline-none" style={{ background:'var(--color-surface-2)', border:'1px solid var(--color-border)', color:'var(--color-text)' }} /></div>
        <label className="hidden items-center gap-2 rounded-xl px-3 py-2 text-xs font-semibold md:flex" style={{ background:'var(--color-surface-2)', border:'1px solid var(--color-border)', color:'var(--color-text-secondary)' }}><Wifi className="h-3.5 w-3.5" style={{ color:'#F1C40F' }} /><input type="checkbox" checked={onlyOnline} onChange={event => setOnlyOnline(event.target.checked)} />Online</label>
        <div className="relative"><select value={sort} onChange={event => setSort(event.target.value as SortMode)} className="appearance-none rounded-xl py-2 pl-3 pr-8 text-xs font-bold" style={{ background:'var(--color-surface-2)', border:'1px solid var(--color-border)', color:'var(--color-text)' }}><option value="relevance">Relevance</option><option value="online">Online now</option><option value="players">Players</option></select><ChevronDown className="pointer-events-none absolute right-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2" style={{ color:'var(--color-text-secondary)' }} /></div>
      </div>

      <div className="flex min-h-0 flex-1">
        <aside className="hidden w-64 shrink-0 overflow-y-auto border-r p-4 lg:block" style={{ borderColor:'var(--color-border)', background:'var(--color-surface)' }}>
          <div className="mb-5 flex items-center gap-2 text-xs font-black uppercase tracking-wider" style={{ color:'var(--color-text)' }}><Filter className="h-3.5 w-3.5" style={{ color:'var(--color-primary)' }} />Filters</div>
          <p className="mb-2 text-[10px] font-black uppercase tracking-wider" style={{ color:'var(--color-text-tertiary)' }}>Type</p>
          <div className="mb-5 space-y-1">{(['all','vanilla','modded'] as ServerType[]).map(item => <button key={item} onClick={() => setType(item)} className="block w-full rounded-lg px-2.5 py-2 text-left text-xs font-semibold" style={{ background:type === item ? 'var(--color-primary-dim)' : 'transparent', color:type === item ? 'var(--color-primary)' : 'var(--color-text-secondary)' }}>{item === 'all' ? 'All servers' : item === 'vanilla' ? 'Vanilla' : 'Modded'}</button>)}</div>
          <p className="mb-2 text-[10px] font-black uppercase tracking-wider" style={{ color:'var(--color-text-tertiary)' }}>Region</p>
          <div className="space-y-1">{regions.map(item => <button key={item} onClick={() => setRegion(item)} className="block w-full rounded-lg px-2.5 py-2 text-left text-xs font-semibold" style={{ background:region === item ? 'var(--color-primary-dim)' : 'transparent', color:region === item ? 'var(--color-primary)' : 'var(--color-text-secondary)' }}>{item === 'all' ? 'All regions' : item}</button>)}</div>
        </aside>
        <main className="min-w-0 flex-1 overflow-y-auto p-4">
          <div className="mb-4 flex items-center justify-between"><p className="text-xs" style={{ color:'var(--color-text-tertiary)' }}>{filtered.length ? `${filtered.length} saved servers` : 'Official Modrinth catalog'}</p><span className="flex items-center gap-1 text-[10px]" style={{ color:'var(--color-text-tertiary)' }}><Globe2 className="h-3.5 w-3.5" />modrinth.com/discover/servers</span></div>
          {filtered.length === 0 ? <div className="flex min-h-[360px] flex-col items-center justify-center rounded-2xl p-8 text-center" style={{ background:'var(--color-surface)', border:'1px solid var(--color-border)' }}><Server className="mb-3 h-10 w-10" style={{ color:'var(--color-primary)' }} /><h2 className="text-sm font-black" style={{ color:'var(--color-text)' }}>Open the live Modrinth server catalog</h2><p className="mt-2 max-w-md text-xs leading-relaxed" style={{ color:'var(--color-text-secondary)' }}>Modrinth currently serves this catalog as a web page rather than a public documented API. Use the official catalog for live results, or add your own server to keep it inside Portal Launcher.</p><button onClick={openOfficialCatalog} className="mt-4 rounded-xl px-4 py-2.5 text-xs font-bold" style={{ background:'var(--color-primary)', color:'var(--color-primary-text)' }}>Open official servers</button></div> : <div className="space-y-3">{filtered.map(server => <article key={server.id} className="flex items-center gap-3 rounded-2xl p-3" style={{ background:'var(--color-surface)', border:'1px solid var(--color-border)' }}><div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl" style={{ background:'var(--color-primary-dim)', color:'var(--color-primary)' }}><Server className="h-6 w-6" /></div><div className="min-w-0 flex-1"><h3 className="truncate text-sm font-black" style={{ color:'var(--color-text)' }}>{server.name}</h3><p className="truncate text-xs" style={{ color:'var(--color-text-secondary)' }}>{server.description}</p><div className="mt-1 flex flex-wrap items-center gap-1.5 text-[10px]" style={{ color:'var(--color-text-tertiary)' }}><span>{server.address}</span><span>·</span><span>{server.region}</span>{server.tags.map(tag => <span key={tag} className="rounded-md px-1.5 py-0.5" style={{ background:'var(--color-surface-2)' }}>{tag}</span>)}</div></div><div className="hidden text-right sm:block"><p className="text-xs font-bold" style={{ color:'var(--color-primary)' }}>{numberLabel(server.online)} online</p><p className="text-[10px]" style={{ color:'var(--color-text-tertiary)' }}>{numberLabel(server.players)} players</p></div><button onClick={() => toggleFavorite(server.id)} className="rounded-lg p-2" style={{ color:favorites.includes(server.id) ? '#F1C40F' : 'var(--color-text-tertiary)' }}><Heart className={favorites.includes(server.id) ? 'h-4 w-4 fill-current' : 'h-4 w-4'} /></button></article>)}</div>}
        </main>
      </div>
      {showAddForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm" onClick={() => setShowAddForm(false)}>
          <div className="w-full max-w-lg rounded-2xl p-5" style={{ background:'var(--color-surface)', border:'1px solid var(--color-border)', boxShadow:'var(--shadow-lg)' }} onClick={event => event.stopPropagation()}>
            <div className="mb-4 flex items-center gap-3"><div className="flex h-9 w-9 items-center justify-center rounded-xl" style={{ background:'var(--color-primary-dim)', color:'var(--color-primary)' }}><Server className="h-4 w-4" /></div><div className="min-w-0 flex-1"><h2 className="text-sm font-black" style={{ color:'var(--color-text)' }}>Add server</h2><p className="text-[11px]" style={{ color:'var(--color-text-secondary)' }}>Save a server for quick access inside Portal Launcher.</p></div><button onClick={() => setShowAddForm(false)} className="rounded-lg p-1.5" style={{ color:'var(--color-text-secondary)' }}><X className="h-4 w-4" /></button></div>
            <div className="grid gap-3 sm:grid-cols-2">
              {([['name','Name'],['address','Address'],['region','Region'],['description','Description']] as const).map(([key,label]) => <label key={key} className="block text-xs font-semibold sm:col-span-1" style={{ color:'var(--color-text-secondary)' }}>{label}<input value={draft[key]} onChange={event => setDraft(value => ({ ...value, [key]: event.target.value }))} placeholder={key === 'address' ? 'play.example.net:25565' : ''} className="mt-1.5 w-full rounded-xl px-3 py-2.5 text-sm outline-none" style={{ background:'var(--color-surface-2)', border:'1px solid var(--color-border)', color:'var(--color-text)' }} /></label>)}
              <label className="block text-xs font-semibold" style={{ color:'var(--color-text-secondary)' }}>Type<select value={draft.type} onChange={event => setDraft(value => ({ ...value, type: event.target.value as Exclude<ServerType, 'all'> }))} className="mt-1.5 w-full rounded-xl px-3 py-2.5 text-sm outline-none" style={{ background:'var(--color-surface-2)', border:'1px solid var(--color-border)', color:'var(--color-text)' }}><option value="vanilla">Vanilla</option><option value="modded">Modded</option></select></label>
            </div>
            <div className="mt-5 flex justify-end gap-2"><button onClick={() => setShowAddForm(false)} className="rounded-xl px-4 py-2.5 text-xs font-bold" style={{ background:'var(--color-surface-2)', color:'var(--color-text-secondary)', border:'1px solid var(--color-border)' }}>Cancel</button><button onClick={submitServer} disabled={!draft.name.trim() || !draft.address.trim()} className="rounded-xl px-4 py-2.5 text-xs font-bold disabled:opacity-50" style={{ background:'var(--color-primary)', color:'var(--color-primary-text)' }}>Save server</button></div>
          </div>
        </div>
      )}
    </div>
  );
}

export default ServersPage;

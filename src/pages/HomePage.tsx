import { useState, useEffect, useMemo } from 'react';
import { motion } from 'framer-motion';
import { useNavigate } from 'react-router-dom';
import { Play, Plus, Compass, ArrowRight, Clock, Square, TrendingUp, Zap, Camera, Star, Sparkles, Rocket, Boxes, Library, Box, Layers } from 'lucide-react';
import { useCurrentUser, useIsAuthenticated } from '@/stores/authStore';
import { useInstanceStore, Instance } from '@/stores/instanceStore';
import { invoke } from '@/lib/invoke-shim';
import { dialog } from '@/stores/dialogStore';
import { toIconSrc } from '@/lib/icon-src';
import { listen } from '@tauri-apps/api/event';

function fmtTime(s: number) {
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60);
  return h > 0 ? `${h}h ${m}m` : m > 0 ? `${m}m played` : 'Never played';
}

const LOADER_COLOR: Record<string, string> = {
  vanilla: '#DA2A3F', fabric: '#DBB171', forge: '#1162A0', quilt: '#C397C5', neoforge: '#E87225',
};

function ProjectIcon({ iconUrl, color, size = 'h-5 w-5' }: { iconUrl?: string; color: string; size?: string }) {
  return iconUrl
    ? <img src={iconUrl} alt="" className={`${size} object-contain`} onError={event => { (event.currentTarget as HTMLImageElement).style.display = 'none'; }} />
    : <Box className={size} style={{ color }} />;
}

function InstanceCard({ inst }: { inst: Instance }) {
  const navigate = useNavigate();
  const [launching, setLaunching] = useState(false);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState('');
  const user = useCurrentUser();
  const { update } = useInstanceStore();

  const log = (...args: any[]) => console.log('[InstanceCard]', ...args);

  const offerCrashLogShare = async () => {
    const share = await dialog.confirm('Игра завершилась с ошибкой. Отправить latest.log в mclo.gs для анализа?', { title: 'Анализ сбоя', confirmLabel: 'Отправить лог', cancelLabel: 'Не сейчас' });
    if (!share) return;
    try {
      const content = await invoke<string>('instance_read_text', { instanceId: inst.id, path: 'logs/latest.log' });
      const result = await invoke<{ url: string; errors: number; lines: number; insights?: { problems?: Array<{ message?: string; solutions?: Array<{ message?: string }> }> }; diagnosis?: { title?: string; summary?: string; evidence?: string[]; suggestions?: string[] } }>('publish_log_mclogs', {
        content, source: 'Portal Launcher', instanceId: inst.id, minecraftVersion: inst.minecraftVersion, loader: inst.modLoader,
      });
      const problems = result.insights?.problems || [];
      const first = problems[0];
      const local = result.diagnosis;
      const diagnosis = local ? `\\n\\nПричина: ${local.title || 'Причина обнаружена'}\\n${local.summary || ''}${local.evidence?.length ? `\\n\\nСтрока лога:\\n${local.evidence[0]}` : ''}${local.suggestions?.length ? `\\n\\nЧто сделать:\\n${local.suggestions.join('\\n')}` : ''}` : '';
      const remote = first?.message ? `\\n\\nДополнительный анализ:\\n${first.message}${first.solutions?.[0]?.message ? `\\n\\nРешение:\\n${first.solutions[0].message}` : ''}` : '';
      const fallback = !local && !first ? '\\n\\nПричина сбоя не определена по текущему логу. Полный лог сохранён для повторной проверки.' : '';
      await dialog.alert(`Ссылка: ${result.url}\\n\\nНайдено ошибок: ${result.errors}\\nСтрок: ${result.lines}${diagnosis || remote || fallback}`, { title: 'Анализ mclo.gs готов' });
    } catch (shareError) {
      await dialog.alert(`Не удалось отправить latest.log: ${String(shareError)}`, { title: 'mclo.gs', danger: true });
    }
  };

  useEffect(() => {
    let unsub: (() => void) | undefined;
    listen<any>('launch-status', e => {
      if (e.payload.instance_id !== inst.id) return;
      const s = e.payload.status;
      if (['launching','preparing','downloading'].includes(s)) { setLaunching(true); setRunning(false); }
      if (s === 'running') { setLaunching(false); setRunning(true); }
      if (['stopped','error','crashed'].includes(s)) {
        setLaunching(false); setRunning(false);
        if (s !== 'stopped') { setError(e.payload.message || 'Launch failed'); setTimeout(() => setError(''), 5000); void offerCrashLogShare(); }
      }
    }).then(fn => { unsub = fn; });
    return () => unsub?.();
  }, [inst.id]);

  const launch = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (launching || running) return;
    if (!user) { 
      log('❌ No user authenticated, redirecting to settings');
      navigate('/settings/account'); 
      return; 
    }
    
    log(`🚀 Launching instance ${inst.id} with auth: username=${user.username}, token_len=${(user.accessToken || '').length}`);
    
    setLaunching(true); setError('');
    try {
      update(inst.id, { lastPlayed: new Date().toISOString() });
      await invoke('launch_instance', {
        instance_id: inst.id,
        access_token: user.accessToken || '',
        uuid: user.uuid,
        username: user.username,
        provider: user.provider,
      });
    } catch (err: any) {
      log('❌ Launch failed:', err);
      setError(String(err));
      setLaunching(false);
      void offerCrashLogShare();
    }
  };

  const stop = async (e: React.MouseEvent) => {
    e.stopPropagation();
    try { await invoke('kill_instance', { instance_id: inst.id }); } catch {}
    setRunning(false); setLaunching(false);
  };

  return (
    <motion.div
      className="rounded-2xl overflow-hidden cursor-pointer group"
      style={{ background: 'var(--color-surface)', border: `1px solid ${error ? 'var(--color-error)' : 'var(--color-border)'}` }}
      whileHover={{ y: -2, boxShadow: '0 8px 24px rgba(0,0,0,0.4)' }}
      transition={{ duration: 0.15 }}
      onClick={() => navigate(`/library`)}>
      <div className="h-1 w-full" style={{ background: `linear-gradient(90deg, ${inst.color}, ${inst.color}44)` }} />
      <div className="p-4">
        <div className="flex items-center gap-3 mb-2.5">
          {inst.iconPath ? (
            <img src={toIconSrc(inst.iconPath)} className="w-10 h-10 rounded-xl object-cover" alt="" />
          ) : (
            <div className="w-10 h-10 rounded-xl flex items-center justify-center text-lg font-black shrink-0"
              style={{ background: `${inst.color}18`, color: inst.color }}>
              <ProjectIcon color={inst.color || 'var(--color-primary)'} size="h-5 w-5" />
            </div>
          )}
          <div className="flex-1 min-w-0">
            <h3 className="font-bold text-sm truncate" style={{ color: 'var(--color-text)' }}>{inst.name}</h3>
            <div className="flex items-center gap-1.5 mt-1 flex-wrap">
              <span className="inline-flex items-center gap-1 text-[10px]" style={{ color:'var(--color-text-secondary)' }}><Box className="w-3 h-3" style={{ color:'var(--color-primary)' }} />{inst.minecraftVersion}</span>
              <span className="inline-flex items-center gap-1 text-[10px] capitalize" style={{ color:LOADER_COLOR[inst.modLoader] || 'var(--color-text-secondary)' }}><Layers className="w-3 h-3" />{inst.modLoaderVersion ? `${inst.modLoader} ${inst.modLoaderVersion}` : inst.modLoader}</span>
            </div>
          </div>
        </div>
        {error && <p className="text-[10px] mb-2 px-2 py-1 rounded-lg" style={{ color: 'var(--color-error)', background: 'rgba(231,76,60,0.08)' }}>{error}</p>}
        <div className="flex items-center justify-between">
          <span className="text-[10px] inline-flex items-center gap-1" style={{ color: 'var(--color-text-tertiary)' }}>
            <Clock className="w-3 h-3" />{inst.lastPlayed ? `Played ${fmtTime(inst.totalPlayTime)}` : 'Never played'}
          </span>
          {running ? (
            <button onClick={stop}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold"
              style={{ background: 'rgba(231,76,60,0.15)', color: 'var(--color-error)' }}>
              <Square className="w-3 h-3 fill-current" />Stop
            </button>
          ) : (
            <button onClick={launch} disabled={launching}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold transition-all hover:opacity-90"
              style={{ background: 'var(--color-primary)', color: '#fff', opacity: launching ? 0.7 : 1 }}>
              {launching
                ? <><div className="w-3 h-3 border border-white/40 border-t-white rounded-full animate-spin" />Launching</>
                : <><Play className="w-3 h-3 fill-current" />Play</>}
            </button>
          )}
        </div>
      </div>
    </motion.div>
  );
}

const FEATURED = [
  { id:'fabulously-optimized', name:'Fabulously Optimized', desc:'Beautiful graphics, speedy performance and familiar features in a simple package.', color:'#f97316', icon:'FO', tags:['Performance','Lightweight'], downloads:'12.9M', mc:'1.21.1', loader:'fabric' },
  { id:'cobblemon-fabric', name:'Cobblemon [Fabric]', desc:'The official Cobblemon mod for Fabric. Catch, battle, and train your Pokémon!', color:'#3b82f6', icon:'C', tags:['Adventure','Gameplay'], downloads:'7.7M', mc:'1.21.1', loader:'fabric' },
  { id:'vanilla-perfected', name:'Vanilla Perfected', desc:'A compilation of Vanilla Plus mods & packs to perfect the Minecraft experience.', color:'#8b5cf6', icon:'VP', tags:['Vanilla+','Optimization'], downloads:'1.8M', mc:'1.21.1', loader:'fabric' },
  { id:'aged', name:'Aged', desc:'Realistic/medieval progression modpack for Fabric 1.20.1 with unique challenges.', color:'#a16207', icon:'A', tags:['RPG','Medieval'], downloads:'1.1M', mc:'1.20.1', loader:'fabric' },
];

const TRENDING_MODS = [
  { id:'sodium', name:'Sodium', desc:'Rendering optimization mod', color:'#f59e0b', icon:'S', iconUrl:'https://cdn.modrinth.com/data/AANobbMI/icon.png', downloads:'12.4M', source:'modrinth' },
  { id:'fabric-api', name:'Fabric API', desc:'Core API library', color:'#8b5cf6', icon:'F', iconUrl:'https://cdn.modrinth.com/data/P7dR8mSH/icon.png', downloads:'45.2M', source:'modrinth' },
  { id:'iris', name:'Iris Shaders', desc:'Beautiful shader support', color:'#06b6d4', icon:'I', iconUrl:'https://cdn.modrinth.com/data/YL57xq9/icon.png', downloads:'7.3M', source:'modrinth' },
  { id:'jei', name:'Just Enough Items', desc:'Recipe viewer', color:'#10b981', icon:'J', downloads:'18.7M', source:'curseforge' },
];

const RESOURCE_PACKS = [
  { id:'faithful-32x', name:'Faithful 32x', desc:'A faithful recreation of the default Minecraft textures in 32x resolution', color:'#f59e0b', icon:'F32', downloads:'8.2M', source:'modrinth' },
  { id:'complementary-reimagined', name:'Complementary Reimagined', desc:'Beautiful shaders balanced for gameplay', color:'#818cf8', icon:'CR', downloads:'5.1M', source:'modrinth' },
  { id:'visual-overhaul', name:'Visual Overhaul', desc:'Enhances Minecraft\'s look with modern textures', color:'#34d399', icon:'VO', downloads:'2.3M', source:'modrinth' },
  { id:'xekr-fresh-animations', name:'Fresh Animations', desc:'Dynamic entity animations for a lively world', color:'#f87171', icon:'FA', downloads:'4.7M', source:'modrinth' },
];

// Recommended by Creator section content
const CREATOR_PICKS = [
  { id:'portal-pack', name:'Portal Pack', desc:'The official modpack curated by Portalrolls — optimized performance + beautiful visuals', color:'#E74C3C', icon:'PP', type:'Modpack', downloads:'Featured', source:'modrinth', featured: true },
  { id:'sodium', name:'Sodium', desc:'The best performance mod for Minecraft — massive FPS boost', color:'#f59e0b', icon:'S', type:'Mod', downloads:'12.4M', source:'modrinth', featured: false },
  { id:'iris', name:'Iris Shaders', desc:'Use any OptiFine shader with Fabric', color:'#06b6d4', icon:'I', type:'Shader', downloads:'7.3M', source:'modrinth', featured: false },
];

const TICKER_MODS = [
  { name:'Sodium', color:'#f59e0b', tag:'Performance' },
  { name:'Iris', color:'#06b6d4', tag:'Shaders' },
  { name:'Create', color:'#f97316', tag:'Technology' },
  { name:'JEI', color:'#10b981', tag:'Utility' },
  { name:'Xaero’s Minimap', color:'#8b5cf6', tag:'Navigation' },
  { name:'Better Combat', color:'#e74c3c', tag:'Gameplay' },
  { name:'Fresh Animations', color:'#f87171', tag:'Visuals' },
  { name:'Waystones', color:'#60a5fa', tag:'Adventure' },
];

function ModTicker() {
  const navigate = useNavigate();
  const mods = useMemo(() => [...TICKER_MODS].sort(() => Math.random() - 0.5), []);
  const track = [...mods, ...mods];
  return (
    <div className="rounded-2xl overflow-hidden py-2.5" style={{ background:'var(--color-surface)', border:'1px solid var(--color-border)' }}>
      <div className="flex items-center gap-2 px-3 mb-2">
        <Sparkles className="w-3.5 h-3.5" style={{ color:'var(--color-primary)' }} />
        <span className="text-[10px] font-black uppercase tracking-[0.14em]" style={{ color:'var(--color-text-tertiary)' }}>Discover the community</span>
      </div>
      <div className="overflow-hidden">
        <motion.div className="flex w-max gap-2 px-3"
          animate={{ x: ['0%', '-50%'] }}
          transition={{ duration: 26, ease: 'linear', repeat: Infinity }}>
          {track.map((mod, index) => (
            <button key={`${mod.name}-${index}`} onClick={() => navigate('/discover')}
              className="flex items-center gap-2 px-2.5 py-1.5 rounded-xl shrink-0 hover:-translate-y-0.5"
              style={{ background:'var(--color-surface-2)', border:'1px solid var(--color-border)' }}>
              <span className="w-5 h-5 rounded-md flex items-center justify-center text-[9px] font-black" style={{ background:`${mod.color}22`, color:mod.color }}>{mod.name[0]}</span>
              <span className="text-xs font-bold" style={{ color:'var(--color-text)' }}>{mod.name}</span>
              <span className="text-[9px] font-semibold px-1.5 py-0.5 rounded-md" style={{ background:`${mod.color}18`, color:mod.color }}>{mod.tag}</span>
            </button>
          ))}
        </motion.div>
      </div>
    </div>
  );
}

const stagger = { hidden: {}, show: { transition: { staggerChildren: 0.05 } } };
const fadeUp = { hidden: { opacity: 0, y: 10 }, show: { opacity: 1, y: 0 } };

export function HomePage() {
  const navigate = useNavigate();
  const user = useCurrentUser();
  const isAuth = useIsAuthenticated();
  const instances = useInstanceStore(s => s.instances);
  const recent = instances
    .filter(i => i.lastPlayed)
    .sort((a, b) => new Date(b.lastPlayed!).getTime() - new Date(a.lastPlayed!).getTime())
    .slice(0, 3);

  return (
    <div className="h-full overflow-y-auto" style={{ padding: '24px 28px' }}>
      <div className="max-w-4xl mx-auto space-y-8">

        {/* Hero: all colours come from theme-engine variables */}
        <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }}
          className="relative rounded-3xl overflow-hidden p-6 sm:p-7"
          style={{ background:'linear-gradient(135deg, var(--color-surface), var(--color-surface-2))', border:'1px solid var(--color-border)', boxShadow:'var(--shadow-md)' }}>
          <div className="absolute inset-0 pointer-events-none animate-aurora"
            style={{ backgroundImage:'radial-gradient(circle at 10% 20%, var(--color-primary-dim), transparent 34%), radial-gradient(circle at 88% 12%, var(--color-info), transparent 42%)', opacity:0.42 }} />
          <div className="relative z-10 flex flex-col lg:flex-row lg:items-end gap-6 justify-between">
            <div className="max-w-xl">
              <div className="inline-flex items-center gap-2 px-2.5 py-1 rounded-full mb-3" style={{ background:'var(--color-primary-dim)', color:'var(--color-primary)', border:'1px solid var(--color-primary)' }}>
                <Rocket className="w-3.5 h-3.5" /><span className="text-[10px] font-black uppercase tracking-wider">Your Minecraft hub</span>
              </div>
              <h1 className="text-3xl font-black mb-2 font-display" style={{ color:'var(--color-text)' }}>{user ? `Welcome back, ${user.username}` : 'Build your next adventure'}</h1>
              <p className="text-sm leading-relaxed" style={{ color:'var(--color-text-secondary)' }}>{user ? 'Launch a recent world, create a new setup or discover the next essential modpack.' : 'Sign in, build a setup and keep your Minecraft worlds in one place.'}</p>
              <div className="flex gap-2.5 flex-wrap mt-5">
                <button onClick={() => navigate(isAuth ? '/library' : '/settings/account')} className="flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-bold hover:-translate-y-0.5" style={{ background:'var(--color-primary)', color:'var(--color-primary-text)', boxShadow:'0 6px 20px var(--color-primary-dim)' }}>
                  {isAuth ? <><Play className="w-4 h-4 fill-current" />Play now</> : <><Rocket className="w-4 h-4" />Sign in</>}
                </button>
                <button onClick={() => navigate('/library')} className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-bold hover:-translate-y-0.5" style={{ background:'var(--color-surface-active)', color:'var(--color-text)', border:'1px solid var(--color-border)' }}><Plus className="w-4 h-4" />New setup</button>
                <button onClick={() => navigate('/discover')} className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-bold hover:-translate-y-0.5" style={{ background:'var(--color-surface-active)', color:'var(--color-text)', border:'1px solid var(--color-border)' }}><Compass className="w-4 h-4" />Discover</button>
                <button onClick={() => navigate('/control-center')} className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-bold hover:-translate-y-0.5" style={{ background:'var(--color-surface-active)', color:'var(--color-text)', border:'1px solid var(--color-border)' }}><TrendingUp className="w-4 h-4" />Progress</button>
              </div>
            </div>
            <div className="grid grid-cols-3 gap-2 w-full lg:w-[300px]">
              {[
                { icon:Library, label:'Setups', value:String(instances.length) },
                { icon:Clock, label:'Played', value:instances.length ? `${Math.round(instances.reduce((sum, i) => sum + (i.totalPlayTime || 0), 0) / 60)} h` : '—' },
                { icon:Boxes, label:'Explore', value:'Mods' },
              ].map(stat => (
                <div key={stat.label} className="p-3 rounded-2xl" style={{ background:'color-mix(in srgb, var(--color-surface) 68%, transparent)', border:'1px solid var(--color-border)' }}>
                  <stat.icon className="w-4 h-4 mb-2" style={{ color:'var(--color-primary)' }} />
                  <p className="text-sm font-black truncate" style={{ color:'var(--color-text)' }}>{stat.value}</p>
                  <p className="text-[10px] font-semibold" style={{ color:'var(--color-text-tertiary)' }}>{stat.label}</p>
                </div>
              ))}
            </div>
          </div>
        </motion.div>

        <ModTicker />

        {/* Jump back in */}
        {recent.length > 0 && (
          <section>
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-base font-bold flex items-center gap-2 font-display" style={{ color: 'var(--color-text)' }}>
                <Clock className="w-4 h-4" style={{ color: 'var(--color-primary)' }} />Jump back in
              </h2>
              <button onClick={() => navigate('/library')}
                className="flex items-center gap-1 text-xs font-semibold hover:opacity-80"
                style={{ color: 'var(--color-primary)' }}>
                View all <ArrowRight className="w-3.5 h-3.5" />
              </button>
            </div>
            <motion.div className="grid grid-cols-3 gap-3" variants={stagger} initial="hidden" animate="show">
              {recent.map(inst => (
                <motion.div key={inst.id} variants={fadeUp}>
                  <InstanceCard inst={inst} />
                </motion.div>
              ))}
            </motion.div>
          </section>
        )}

        {/* Recommended by Creator */}
        <section>
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-base font-bold flex items-center gap-2 font-display" style={{ color: 'var(--color-text)' }}>
              <Star className="w-4 h-4 fill-current" style={{ color: '#f59e0b' }} />
              Recommended by Creator
            </h2>
            <span className="text-xs font-semibold px-2 py-0.5 rounded-lg"
              style={{ background: 'rgba(231,76,60,0.1)', color: 'var(--color-error)', border: '1px solid rgba(231,76,60,0.2)' }}>
              by Portalrolls
            </span>
          </div>
          <motion.div className="grid grid-cols-3 gap-3" variants={stagger} initial="hidden" animate="show">
            {CREATOR_PICKS.map(pick => (
              <motion.div key={pick.id} variants={fadeUp}
                className="p-4 rounded-2xl cursor-pointer transition-all hover:-translate-y-0.5 relative overflow-hidden"
                style={{ background: 'var(--color-surface)', border: `1px solid ${pick.featured ? 'rgba(231,76,60,0.4)' : 'var(--color-border)'}` }}
                onClick={() => navigate(`/discover/modrinth/${pick.id}`)}>
                {pick.featured && (
                  <div className="absolute top-0 left-0 right-0 h-0.5"
                    style={{ background: 'linear-gradient(90deg, #E74C3C, #E74C3C44)' }} />
                )}
                <div className="flex items-center gap-3 mb-2">
                  <div className="w-10 h-10 rounded-xl flex items-center justify-center text-base font-black shrink-0"
                    style={{ background: `${pick.color}18`, color: pick.color }}>
                    <ProjectIcon color={pick.color} size="h-5 w-5" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-bold text-sm truncate" style={{ color: 'var(--color-text)' }}>{pick.name}</p>
                    <p className="text-[10px]" style={{ color: 'var(--color-text-secondary)' }}>{pick.type}</p>
                  </div>
                </div>
                <p className="text-[11px] line-clamp-2 leading-relaxed" style={{ color: 'var(--color-text-secondary)' }}>{pick.desc}</p>
                <div className="flex items-center justify-between mt-2 pt-2" style={{ borderTop: '1px solid var(--color-border)' }}>
                  <span className="text-[10px]" style={{ color: 'var(--color-text-tertiary)' }}>↓ {pick.downloads}</span>
                  {pick.featured && (
                    <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-md"
                      style={{ background: 'rgba(231,76,60,0.1)', color: 'var(--color-error)' }}>
                      FEATURED
                    </span>
                  )}
                </div>
              </motion.div>
            ))}
          </motion.div>
        </section>

        {/* Discover modpacks */}
        <section>
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-base font-bold flex items-center gap-2 font-display" style={{ color: 'var(--color-text)' }}>
              <Zap className="w-4 h-4" style={{ color: '#f59e0b' }} />Discover modpacks
            </h2>
            <button onClick={() => navigate('/discover')}
              className="flex items-center gap-1 text-xs font-semibold hover:opacity-80"
              style={{ color: 'var(--color-primary)' }}>
              View more <ArrowRight className="w-3.5 h-3.5" />
            </button>
          </div>
          <motion.div className="grid grid-cols-4 gap-3" variants={stagger} initial="hidden" animate="show">
            {FEATURED.map(mp => (
              <motion.div key={mp.id} variants={fadeUp}
                className="rounded-2xl overflow-hidden cursor-pointer group transition-all hover:-translate-y-1"
                style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)' }}
                onClick={() => navigate('/discover')}>
                <div className="h-20 flex items-center justify-center text-3xl font-black"
                  style={{ background: `linear-gradient(135deg, ${mp.color}33, ${mp.color}11)`, color: mp.color }}>
                  <ProjectIcon color={mp.color} size="h-9 w-9" />
                </div>
                <div className="p-3">
                  <h3 className="font-bold text-xs truncate" style={{ color: 'var(--color-text)' }}>{mp.name}</h3>
                  <p className="text-[10px] mt-0.5 line-clamp-2 leading-relaxed" style={{ color: 'var(--color-text-secondary)' }}>{mp.desc}</p>
                  <div className="flex items-center gap-1.5 mt-2 flex-wrap">
                    {mp.tags.slice(0, 2).map(t => (
                      <span key={t} className="text-[9px] font-semibold px-1.5 py-0.5 rounded-md"
                        style={{ background: 'var(--color-surface-2)', color: 'var(--color-text-secondary)', border: '1px solid var(--color-border)' }}>
                        {t}
                      </span>
                    ))}
                  </div>
                  <div className="flex items-center gap-2 mt-2">
                    <span className="text-[10px]" style={{ color: 'var(--color-text-tertiary)' }}>↓ {mp.downloads}</span>
                  </div>
                </div>
              </motion.div>
            ))}
          </motion.div>
        </section>

        {/* Trending mods */}
        <section>
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-base font-bold flex items-center gap-2 font-display" style={{ color: 'var(--color-text)' }}>
              <TrendingUp className="w-4 h-4" style={{ color: 'var(--color-error)' }} />Popular mods
            </h2>
            <button onClick={() => navigate('/discover')}
              className="flex items-center gap-1 text-xs font-semibold hover:opacity-80"
              style={{ color: 'var(--color-primary)' }}>
              View more <ArrowRight className="w-3.5 h-3.5" />
            </button>
          </div>
          <div className="grid grid-cols-4 gap-3">
            {TRENDING_MODS.map(mod => (
              <div key={mod.id}
                className="p-4 rounded-2xl cursor-pointer transition-all hover:-translate-y-0.5"
                style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)' }}
                onClick={() => navigate(`/discover/${mod.source}/${mod.id}`)}>
                <div className="w-10 h-10 rounded-xl flex items-center justify-center text-base font-black mb-3"
                  style={{ background: `${mod.color}18`, color: mod.color }}>
                  <ProjectIcon iconUrl={(mod as any).iconUrl} color={mod.color} size="h-6 w-6" />
                </div>
                <h3 className="font-bold text-xs" style={{ color: 'var(--color-text)' }}>{mod.name}</h3>
                <p className="text-[10px] mt-0.5" style={{ color: 'var(--color-text-secondary)' }}>{mod.desc}</p>
                <p className="text-[10px] mt-1.5" style={{ color: 'var(--color-text-tertiary)' }}>↓ {mod.downloads}</p>
              </div>
            ))}
          </div>
        </section>

        {/* Resource packs */}
        <section>
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-base font-bold flex items-center gap-2 font-display" style={{ color: 'var(--color-text)' }}>
              <span className="w-4 h-4 text-base" style={{ color: '#a78bfa' }}>🎨</span>
              Popular resource packs & shaders
            </h2>
            <button onClick={() => navigate('/discover')}
              className="flex items-center gap-1 text-xs font-semibold hover:opacity-80"
              style={{ color: 'var(--color-primary)' }}>
              View more <ArrowRight className="w-3.5 h-3.5" />
            </button>
          </div>
          <div className="grid grid-cols-4 gap-3">
            {RESOURCE_PACKS.map(rp => (
              <div key={rp.id}
                className="p-4 rounded-2xl cursor-pointer transition-all hover:-translate-y-0.5"
                style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)' }}
                onClick={() => navigate(`/discover/${rp.source}/${rp.id}`)}>
                <div className="w-10 h-10 rounded-xl flex items-center justify-center text-sm font-black mb-3"
                  style={{ background: `${rp.color}18`, color: rp.color }}>
                  <ProjectIcon color={rp.color} size="h-6 w-6" />
                </div>
                <h3 className="font-bold text-xs" style={{ color: 'var(--color-text)' }}>{rp.name}</h3>
                <p className="text-[10px] mt-0.5 line-clamp-2" style={{ color: 'var(--color-text-secondary)' }}>{rp.desc}</p>
                <p className="text-[10px] mt-1.5" style={{ color: 'var(--color-text-tertiary)' }}>↓ {rp.downloads}</p>
              </div>
            ))}
          </div>
        </section>

      </div>
    </div>
  );
}

import { useState, useCallback, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import {
  Play, Plus, Upload, Settings, FolderOpen, Search, MoreVertical,
  StopCircle, Clock3, Box, ChevronRight, ArrowUpRight, Filter as FilterIcon,
} from 'lucide-react';
import { useInstanceStore, type Instance } from '@/stores/instanceStore';
import { useCurrentUser } from '@/stores/authStore';
import { useSettingsStore } from '@/stores/settingsStore';
import { useLaunchStore } from '@/stores/launchStore';
import { invoke } from '@/lib/invoke-shim';
import { toIconSrc } from '@/lib/icon-src';

const stagger = { hidden: {}, show: { transition: { staggerChildren: 0.05 } } };
const fadeUp = { hidden: { opacity: 0, y: 14 }, show: { opacity: 1, y: 0, transition: { duration: 0.38, ease: [0.16, 1, 0.3, 1] } } };

const LOADER_COLORS: Record<string, string> = {
  vanilla: 'var(--color-text-secondary)', fabric: '#E274F2', forge: '#F97316',
  neoforge: '#45D6FF', quilt: '#DB2777', bedrock: '#2ECC71', optifine: '#5C8BF4', labymod: '#EAB308',
};

function fmtMinutes(mins: number) {
  if (!mins) return '';
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return h ? `${h} ч ${m ? `${m} мин` : ''}`.trim() : `${m} мин`;
}

export function InnovativeLibrary() {
  const navigate = useNavigate();
  const instances = useInstanceStore(s => s.instances);
  const update = useInstanceStore(s => s.update);
  const user = useCurrentUser();
  const globalSettings = useSettingsStore(s => ({
    minRam: s.minRam, maxRam: s.maxRam, javaPath: s.javaPath, customJvmArgs: s.customJvmArgs,
  }));
  const getStatus = useLaunchStore(s => s.getStatus);
  const setStatus = useLaunchStore(s => s.setStatus);

  const [search, setSearch] = useState('');
  const [sortBy, setSortBy] = useState<'name' | 'lastPlayed' | 'version'>('lastPlayed');

  const filtered = instances
    .filter(i => i.name.toLowerCase().includes(search.toLowerCase()))
    .sort((a, b) => {
      if (sortBy === 'name') return a.name.localeCompare(b.name);
      if (sortBy === 'lastPlayed') return (b.lastPlayed || b.createdAt).localeCompare(a.lastPlayed || a.createdAt);
      return a.minecraftVersion.localeCompare(b.minecraftVersion);
    });

  const totalHours = Math.round(instances.reduce((s, i) => s + (i.totalPlayTime || 0), 0) / 60);

  const handleLaunch = useCallback(async (inst: Instance) => {
    const current = getStatus(inst.id);
    if (current === 'running') { navigate(`/library/${inst.id}`); return; }
    if (current === 'launching') return;
    if (!user) { navigate('/settings/account'); return; }

    if (inst.modLoader === 'bedrock') {
      try { await invoke('launch_bedrock', { family: inst.modLoaderVersion || null }); } catch (e) { console.error(e); }
      update(inst.id, { lastPlayed: new Date().toISOString() });
      return;
    }

    setStatus(inst.id, 'launching');
    try {
      await invoke('ensure_instance', {
        id: inst.id, name: inst.name, mcVersion: inst.minecraftVersion,
        loader: inst.modLoader, loaderVersion: inst.modLoaderVersion || '',
        minRam: globalSettings.minRam, maxRam: globalSettings.maxRam,
        javaPath: globalSettings.javaPath || '', customJvmArgs: globalSettings.customJvmArgs || '',
        color: inst.color, icon: inst.iconPath || null,
      });
      update(inst.id, { lastPlayed: new Date().toISOString() });
      if (!user.uuid || !user.username) throw new Error('Нужно войти в аккаунт');
      await invoke('launch_instance', {
        instance_id: inst.id, access_token: user.accessToken || '',
        uuid: user.uuid, username: user.username, provider: user.provider,
      });
    } catch (err) { console.error(err); setStatus(inst.id, 'idle'); }
  }, [user, globalSettings, getStatus, setStatus, navigate, update]);

  const handleStop = useCallback(async (inst: Instance) => {
    try { await invoke('cancel_launch', { instanceId: inst.id }); } catch (e) { console.error(e); }
    setStatus(inst.id, 'idle');
  }, [setStatus]);

  return (
    <motion.div className="h-full overflow-auto" variants={stagger} initial="hidden" animate="show">
      <div className="mx-6 mt-6">
        {/* header */}
        <motion.div variants={fadeUp} className="flex flex-col sm:flex-row sm:items-end gap-5 mb-6">
          <div className="flex-1">
            <h1 className="text-[28px] font-extrabold tracking-tight" style={{ color: 'var(--color-text)' }}>
              Библиотека
            </h1>
            <p className="mt-1 text-[13px]" style={{ color: 'var(--color-text-secondary)' }}>
              {instances.length} {instances.length === 1 ? 'сборка' : instances.length < 5 ? 'сборки' : 'сборок'} · {totalHours} ч в игре
            </p>
          </div>
          <div className="flex gap-2">
            <button onClick={() => navigate('/library?create=1')}
              className="flex items-center gap-2 rounded-2xl px-5 py-2.5 text-[13px] font-bold transition-all hover:scale-[1.03] active:scale-[0.97]"
              style={{ background: 'var(--color-primary)', color: 'var(--color-primary-text)', boxShadow: '0 10px 28px -10px color-mix(in srgb, var(--color-primary) 70%, transparent)' }}>
              <Plus size={15} /> Создать
            </button>
            <button onClick={() => navigate('/library?import=1')}
              className="flex items-center gap-2 rounded-2xl px-5 py-2.5 text-[13px] font-semibold transition-all hover:scale-[1.03] active:scale-[0.97]"
              style={{ background: 'color-mix(in srgb, var(--color-surface-2) 70%, transparent)', color: 'var(--color-text)', border: '1px solid var(--color-border)' }}>
              <Upload size={15} /> Импорт
            </button>
          </div>
        </motion.div>

        {/* search + sort */}
        <motion.div variants={fadeUp} className="flex gap-3 mb-5">
          <div className="flex-1 flex items-center gap-2 rounded-2xl px-4 py-2.5"
            style={{ background: 'color-mix(in srgb, var(--color-surface) 72%, transparent)', border: '1px solid var(--color-border)' }}>
            <Search size={15} style={{ color: 'var(--color-text-tertiary)' }} />
            <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Найти сборку…"
              className="flex-1 bg-transparent text-[13px] font-semibold outline-none" style={{ color: 'var(--color-text)' }} />
          </div>
          <select value={sortBy} onChange={e => setSortBy(e.target.value as any)}
            className="rounded-2xl px-4 py-2.5 text-[12px] font-bold outline-none"
            style={{ background: 'color-mix(in srgb, var(--color-surface) 72%, transparent)', border: '1px solid var(--color-border)', color: 'var(--color-text)' }}>
            <option value="lastPlayed">По дате</option>
            <option value="name">По имени</option>
            <option value="version">По версии</option>
          </select>
        </motion.div>

        {/* grid */}
        {filtered.length > 0 ? (
          <motion.div variants={fadeUp} className="grid grid-cols-3 gap-4">
            {filtered.map(inst => {
              const status = getStatus(inst.id);
              const isRunning = status === 'running';
              const isLaunching = status === 'launching';
              return (
                <div key={inst.id} className="group relative overflow-hidden rounded-[22px] transition-all hover:scale-[1.01]"
                  style={{ background: 'color-mix(in srgb, var(--color-surface) 72%, transparent)', border: '1px solid var(--color-border)' }}>
                  {/* icon cover */}
                  <div className="relative h-36 overflow-hidden"
                    style={{ background: `linear-gradient(135deg, ${inst.color || 'var(--color-primary)'}, color-mix(in srgb, ${inst.color || 'var(--color-primary)'} 44%, var(--color-bg)))` }}>
                    {inst.iconPath ? (
                      <img src={toIconSrc(inst.iconPath)} className="absolute inset-0 h-full w-full object-cover opacity-80 transition-opacity group-hover:opacity-100" alt="" draggable={false} />
                    ) : (
                      <div className="absolute inset-0 flex items-center justify-center text-[42px] font-black opacity-30" style={{ color: '#fff' }}>
                        {inst.name[0]?.toUpperCase()}
                      </div>
                    )}
                    {/* loader badge */}
                    <span className="absolute left-3 top-3 rounded-full px-2.5 py-1 text-[9px] font-bold uppercase tracking-wide backdrop-blur-sm"
                      style={{ background: 'rgba(0,0,0,0.55)', color: LOADER_COLORS[inst.modLoader] || '#fff' }}>
                      {inst.modLoader}
                    </span>
                    {/* play button */}
                    <button
                      onClick={() => isRunning ? navigate(`/library/${inst.id}`) : handleLaunch(inst)}
                      disabled={isLaunching}
                      className="absolute right-3 top-3 flex h-10 w-10 items-center justify-center rounded-full transition-all hover:scale-110 active:scale-95"
                      style={{
                        background: isRunning ? 'var(--color-success)' : 'var(--color-primary)',
                        boxShadow: `0 6px 20px -4px ${isRunning ? 'color-mix(in srgb, var(--color-success) 70%, transparent)' : 'color-mix(in srgb, var(--color-primary) 70%, transparent)'}`,
                      }}>
                      {isLaunching
                        ? <div className="h-5 w-5 rounded-full border-2 border-white/80 border-t-transparent animate-spin" />
                        : isRunning
                          ? <ArrowUpRight size={16} color="#fff" />
                          : <Play size={16} fill="#fff" color="#fff" />
                      }
                    </button>
                    {/* running indicator ring */}
                    {isRunning && (
                      <div className="absolute bottom-3 right-3 flex items-center gap-1.5 rounded-full px-2.5 py-1"
                        style={{ background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(12px)' }}>
                        <span className="h-2 w-2 rounded-full animate-pulse" style={{ background: 'var(--color-success)' }} />
                        <span className="text-[10px] font-bold text-white/90">Запущена</span>
                      </div>
                    )}
                  </div>

                  {/* info */}
                  <div className="p-4">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-[14px] font-bold" style={{ color: 'var(--color-text)' }}>{inst.name}</p>
                        <p className="mt-1 text-[11px] font-semibold" style={{ color: 'var(--color-text-secondary)' }}>
                          {inst.minecraftVersion}
                          {inst.modLoaderVersion ? ` · ${inst.modLoaderVersion}` : ''}
                        </p>
                      </div>
                      <button onClick={() => navigate(`/library/${inst.id}`)}
                        className="shrink-0 flex h-8 w-8 items-center justify-center rounded-xl transition-all hover:bg-white/5"
                        style={{ color: 'var(--color-text-tertiary)' }}>
                        <Settings size={14} />
                      </button>
                    </div>
                    <div className="mt-3 flex items-center justify-between">
                      <div className="flex items-center gap-1.5 text-[10px]" style={{ color: 'var(--color-text-tertiary)' }}>
                        <Clock3 size={12} />
                        {inst.lastPlayed
                          ? new Date(inst.lastPlayed).toLocaleDateString('ru-RU')
                          : 'Не запускалась'}
                      </div>
                      {inst.totalPlayTime > 0 && (
                        <span className="rounded-full px-2 py-0.5 text-[9px] font-bold"
                          style={{ background: 'color-mix(in srgb, var(--color-primary) 12%, transparent)', color: 'var(--color-primary)' }}>
                          {fmtMinutes(inst.totalPlayTime)}
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </motion.div>
        ) : (
          <motion.div variants={fadeUp} className="flex h-64 flex-col items-center justify-center rounded-[24px] border border-dashed text-center"
            style={{ borderColor: 'var(--color-border)', background: 'color-mix(in srgb, var(--color-surface) 42%, transparent)' }}>
            <div className="flex h-14 w-14 items-center justify-center rounded-2xl"
              style={{ background: 'color-mix(in srgb, var(--color-primary) 14%, transparent)', color: 'var(--color-primary)' }}>
              <FolderOpen size={22} />
            </div>
            <p className="mt-3 text-[15px] font-bold" style={{ color: 'var(--color-text)' }}>
              {search ? 'Ничего не найдено' : 'Пока пусто'}
            </p>
            <p className="mt-1 max-w-sm text-[12px]" style={{ color: 'var(--color-text-tertiary)' }}>
              {search ? 'Попробуйте другой запрос' : 'Импортируйте MRPACK, ZIP или создайте сборку вручную'}
            </p>
            {!search && (
              <div className="mt-5 flex gap-2">
                <button onClick={() => navigate('/library?create=1')}
                  className="flex items-center gap-2 rounded-2xl px-5 py-2.5 text-[12px] font-bold"
                  style={{ background: 'var(--color-primary)', color: 'var(--color-primary-text)' }}>
                  <Plus size={14} /> Создать сборку
                </button>
                <button onClick={() => navigate('/library?import=1')}
                  className="flex items-center gap-2 rounded-2xl px-5 py-2.5 text-[12px] font-semibold"
                  style={{ background: 'color-mix(in srgb, var(--color-surface-2) 70%, transparent)', color: 'var(--color-text)', border: '1px solid var(--color-border)' }}>
                  <Upload size={14} /> Импорт
                </button>
              </div>
            )}
          </motion.div>
        )}
      </div>
    </motion.div>
  );
}

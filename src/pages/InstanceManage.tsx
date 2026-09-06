import { useCallback, useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ArrowLeft, Play, Square } from 'lucide-react';
import { invoke } from '@/lib/invoke-shim';
import { listen } from '@tauri-apps/api/event';
import { toIconSrc } from '@/lib/icon-src';
import { useInstanceStore } from '@/stores/instanceStore';
import { useCurrentUser } from '@/stores/authStore';
import { useSettingsStore } from '@/stores/settingsStore';
import { InstanceMods } from './InstanceMods';

/**
 * Per-instance management page: launch/stop the instance and browse its
 * mods/resourcepacks/shaders/datapacks/worlds/servers/files. InstanceMods
 * already implemented all of this — it just had no page mounting it, so it
 * was unreachable from the actual app.
 */
export default function InstanceManage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const instances = useInstanceStore(s => s.instances);
  const update = useInstanceStore(s => s.update);
  const inst = instances.find(i => i.id === id);
  const user = useCurrentUser();
  const globalSettings = useSettingsStore();

  const [status, setStatus] = useState<'idle' | 'launching' | 'running'>('idle');
  const [error, setError] = useState('');

  // Sync with backend on mount and listen for launch events so that the
  // running/stopped state survives tab switches.
  useEffect(() => {
    if (!id) return;
    invoke<string[]>('get_running_instances')
      .then(running => { if (running.includes(id)) setStatus('running'); })
      .catch(() => {});
    const unlisten = listen<{ instance_id?: string; status?: string }>('launch-status', e => {
      if (e.payload.instance_id !== id) return;
      const s = e.payload.status;
      if (['launching','preparing','downloading','classpath'].includes(s)) setStatus('launching');
      if (s === 'running') setStatus('running');
      if (s === 'stopped' || s === 'error' || s === 'crashed') setStatus('idle');
    });
    return () => { unlisten.then(fn => fn()); };
  }, [id]);

  const launch = useCallback(async () => {
    if (!inst || status !== 'idle') return;
    if (!user) { navigate('/settings/account'); return; }
    setStatus('launching'); setError('');
    try {
      await invoke('ensure_instance', {
        id: inst.id,
        name: inst.name,
        mcVersion: inst.minecraftVersion,
        loader: inst.modLoader,
        loaderVersion: inst.modLoaderVersion || '',
        minRam: globalSettings.minRam,
        maxRam: globalSettings.maxRam,
        javaPath: globalSettings.javaPath || '',
        customJvmArgs: globalSettings.customJvmArgs || '',
        color: inst.color,
        icon: inst.iconPath || null,
      }).catch(() => {});
      update(inst.id, { lastPlayed: new Date().toISOString() });
      if (!user.uuid || !user.username) {
        throw new Error('Authentication data missing. Please sign in again in Settings → Account.');
      }
      await invoke('launch_instance', {
        instance_id: inst.id,
        access_token: user.accessToken || '',
        uuid: user.uuid,
        username: user.username,
        provider: user.provider,
      });
      setStatus('running');
    } catch (e: any) {
      setStatus('idle');
      setError(e?.message || String(e));
      setTimeout(() => setError(''), 6000);
    }
  }, [inst, status, user, navigate, update, globalSettings]);

  const stop = useCallback(async () => {
    if (!inst) return;
    try { await invoke('kill_instance', { instance_id: inst.id }); } catch {}
    setStatus('idle');
  }, [inst]);

  if (!inst) {
    return (
      <div className="p-6">
        <p style={{ color: 'var(--color-text-secondary)' }}>Instance not found.</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center gap-3 px-5 py-4 shrink-0" style={{ borderBottom: '1px solid var(--color-border)' }}>
        <button onClick={() => navigate('/library')} className="p-1.5 rounded-lg hover:bg-white/5">
          <ArrowLeft className="w-4 h-4" style={{ color: 'var(--color-text-secondary)' }} />
        </button>
        <div className="w-11 h-11 rounded-2xl overflow-hidden shrink-0 flex items-center justify-center font-bold text-sm"
          style={{ background: inst.color || 'var(--color-surface-2)', color: '#fff' }}>
          {inst.iconPath ? <img src={toIconSrc(inst.iconPath)} className="w-full h-full object-cover" alt="" /> : inst.name[0]?.toUpperCase()}
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-base font-bold truncate" style={{ color: 'var(--color-text)' }}>{inst.name}</p>
          <div className="flex items-center gap-1.5 text-xs" style={{ color: 'var(--color-text-tertiary)' }}>
            <span>Minecraft {inst.minecraftVersion}</span>
            {inst.modLoader !== 'vanilla' && (
              <>
                <span>·</span>
                <span>{inst.modLoader[0].toUpperCase()}{inst.modLoader.slice(1)} {inst.modLoaderVersion || ''}</span>
              </>
            )}
            <span>·</span>
            <span>{inst.lastPlayed ? `Играли ${new Date(inst.lastPlayed).toLocaleDateString('ru-RU')}` : 'Не запускалась'}</span>
          </div>
        </div>
        {status === 'running' ? (
          <button onClick={stop}
            className="flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm font-bold"
            style={{ background: 'var(--color-error)', color: '#fff' }}>
            <Square className="w-4 h-4" />Стоп
          </button>
        ) : (
          <button onClick={launch} disabled={status === 'launching'}
            className="flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm font-bold"
            style={{ background: '#2ECC71', color: '#062', opacity: status === 'launching' ? 0.7 : 1 }}>
            <Play className="w-4 h-4" />{status === 'launching' ? 'Запуск…' : 'Играть'}
          </button>
        )}
      </div>
      {error && (
        <div className="px-5 py-2 text-xs shrink-0" style={{ background: 'rgba(231,76,60,0.1)', color: 'var(--color-error)' }}>{error}</div>
      )}
      <div className="flex-1 min-h-0">
        <InstanceMods instanceId={inst.id} />
      </div>
    </div>
  );
}

import { useCallback, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ArrowLeft, CircleDot, Play, Square } from 'lucide-react';
import { invoke } from '@/lib/invoke-shim';
import { toIconSrc } from '@/lib/icon-src';
import { useInstanceStore } from '@/stores/instanceStore';
import { useCurrentUser } from '@/stores/authStore';
import { useSettingsStore } from '@/stores/settingsStore';
import { useUiStore } from '@/stores/uiStore';
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
  const uiMode = useUiStore(s => s.uiMode);

  const [status, setStatus] = useState<'idle' | 'launching' | 'running'>('idle');
  const [error, setError] = useState('');

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
        minRam: inst.minRam || globalSettings.minRam,
        maxRam: inst.maxRam || globalSettings.maxRam,
        javaPath: inst.javaPath || globalSettings.javaPath || '',
        customJvmArgs: inst.jvmArgs || globalSettings.customJvmArgs || '',
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
    <div className="flex h-full flex-col" style={{ background: uiMode === 'new' ? 'linear-gradient(180deg, color-mix(in srgb, var(--color-surface-2) 30%, transparent), transparent 180px)' : 'transparent' }}>
      <div className="relative m-3 mb-0 flex items-center gap-3 overflow-hidden rounded-2xl px-3.5 py-3 shrink-0" style={{ background: uiMode === 'new' ? 'linear-gradient(115deg, color-mix(in srgb, var(--color-surface) 94%, var(--color-primary) 6%), var(--color-surface))' : 'var(--color-surface)', border: '1px solid var(--color-border)', boxShadow: uiMode === 'new' ? 'var(--shadow-sm)' : 'none' }}>
        <span aria-hidden className="pointer-events-none absolute -right-8 -top-12 h-32 w-32 rounded-full" style={{ background: 'radial-gradient(circle, color-mix(in srgb, var(--color-primary) 16%, transparent), transparent 70%)' }} />
        <button type="button" onClick={() => navigate('/library')} title="Вернуться в библиотеку" aria-label="Вернуться в библиотеку" className="relative rounded-xl p-2 outline-none transition-colors hover:bg-white/5 focus-visible:ring-2 focus-visible:ring-[var(--color-primary)]">
          <ArrowLeft className="w-4 h-4" style={{ color: 'var(--color-text-secondary)' }} />
        </button>
        <div className="relative w-11 h-11 rounded-2xl overflow-hidden shrink-0 flex items-center justify-center font-bold text-sm"
          style={{ background: inst.color || 'var(--color-surface-2)', color: '#fff' }}>
          {inst.iconPath ? <img src={toIconSrc(inst.iconPath)} className="w-full h-full object-cover" alt="" /> : inst.name[0]?.toUpperCase()}
        </div>
        <div className="relative min-w-0 flex-1">
          <div className="flex items-center gap-2"><p className="text-base font-black truncate" style={{ color: 'var(--color-text)' }}>{inst.name}</p><span className="hidden shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[9px] font-black sm:inline-flex" style={{ background: status === 'running' ? 'color-mix(in srgb, var(--color-success) 15%, transparent)' : 'var(--color-surface-2)', color: status === 'running' ? 'var(--color-success)' : 'var(--color-text-tertiary)' }}><CircleDot className="h-2.5 w-2.5" />{status === 'running' ? 'В ИГРЕ' : status === 'launching' ? 'ЗАПУСК' : 'ГОТОВО'}</span></div>
          <div className="mt-1 flex items-center gap-1.5 text-xs" style={{ color: 'var(--color-text-tertiary)' }}>
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
          <button type="button" onClick={stop}
            className="relative flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm font-bold transition-transform duration-150 hover:-translate-y-0.5 active:scale-[0.98]"
            style={{ background: 'var(--color-error)', color: '#fff' }}>
            <Square className="w-4 h-4" />Стоп
          </button>
        ) : (
          <button type="button" onClick={launch} disabled={status === 'launching'}
            className="relative flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm font-bold transition-transform duration-150 hover:-translate-y-0.5 active:scale-[0.98]"
            style={{ background: 'var(--color-success)', color: '#fff', opacity: status === 'launching' ? 0.7 : 1, boxShadow: status === 'launching' ? 'none' : '0 8px 18px color-mix(in srgb, var(--color-success) 20%, transparent)' }}>
            <Play className="w-4 h-4" />{status === 'launching' ? 'Запуск…' : 'Играть'}
          </button>
        )}
      </div>
      {error && (
        <div className="mx-3 mt-2 rounded-xl px-3 py-2 text-xs shrink-0" style={{ background: 'color-mix(in srgb, var(--color-error) 10%, transparent)', border: '1px solid color-mix(in srgb, var(--color-error) 35%, transparent)', color: 'var(--color-error)' }}>{error}</div>
      )}
      <div className="flex-1 min-h-0">
        <InstanceMods instanceId={inst.id} />
      </div>
    </div>
  );
}

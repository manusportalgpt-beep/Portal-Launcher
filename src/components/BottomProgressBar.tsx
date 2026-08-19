import { useEffect, useRef, useState } from 'react';
import { listen } from '@tauri-apps/api/event';
import { invoke } from '@/lib/invoke-shim';
import { ChevronDown, ChevronUp, FolderDown, LoaderCircle, X } from 'lucide-react';
import { useInstanceStore } from '@/stores/instanceStore';
import { toIconSrc } from '@/lib/icon-src';

type ProgressSource = 'game' | 'java' | 'download' | 'launch' | 'instance';

interface ProgressEvent {
  stage: string;
  current: number;
  total: number;
  message: string;
  percent: number;
  source: ProgressSource;
  javaVersion?: number;
  instanceId?: string;
  instanceName?: string;
  iconPath?: string;
}

interface LaunchStatusEvent {
  instance_id?: string;
  status?: string;
  message?: string;
}

function mb(bytes: number) { return bytes / 1024 / 1024; }

function launchPercent(stage?: string): number {
  switch (stage) {
    case 'auth': return 4;
    case 'resolve': return 9;
    case 'install': return 15;
    case 'java': return 20;
    case 'natives': return 84;
    case 'starting': return 94;
    default: return 0;
  }
}

function stageLabel(event: ProgressEvent): string {
  if (event.source === 'java') {
    return `Java ${event.javaVersion ?? ''}`.trim();
  }
  if (event.source === 'instance') {
    switch (event.stage) {
      case 'importing': return 'Reading instance manifest';
      case 'extracting': return 'Extracting instance files';
      case 'downloading': return 'Downloading instance files';
      case 'copying': return 'Copying instance files';
      case 'done': return 'Instance installation';
      default: return 'Instance installation';
    }
  }
  switch (event.stage) {
    case 'client': return 'Minecraft client';
    case 'libraries': return 'Game libraries';
    case 'natives': return 'Native libraries';
    case 'assets': return 'Game assets';
    case 'done': return 'Game files';
    default: return event.stage || 'Preparing game';
  }
}

/**
 * Global first-launch progress strip.
 * It combines the staged Minecraft installer, Java installation, ordinary
 * downloads and launch-status events into one bottom panel.
 */
export function BottomProgressBar() {
  const [event, setEvent] = useState<ProgressEvent | null>(null);
  const [launching, setLaunching] = useState<string | null>(null);
  const launchingRef = useRef<string | null>(null);
  const [collapsed, setCollapsed] = useState(true);
  const instance = useInstanceStore(state => state.instances.find(item => item.id === (event?.instanceId || launching)));
  const instanceIcon = toIconSrc(instance?.iconPath);
  const progressIcon = instanceIcon || toIconSrc(event?.iconPath);
  const [speed, setSpeed] = useState(0);
  const last = useRef<{ t: number; bytes: number } | null>(null);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearLater = (delay = 1300) => {
    if (hideTimer.current) clearTimeout(hideTimer.current);
    hideTimer.current = setTimeout(() => {
      setEvent(null);
      setLaunching(null);
      setSpeed(0);
      last.current = null;
    }, delay);
  };

  useEffect(() => {
    const unsubs: Array<() => void> = [];
    const push = (next: ProgressEvent) => {
      if (hideTimer.current) clearTimeout(hideTimer.current);
      setEvent(next);
    };

    listen<any>('instance-progress', e => {
      const p = e.payload ?? {};
      push({
        source: 'instance',
        stage: String(p.stage ?? 'installing'),
        message: String(p.message ?? 'Installing instance…'),
        current: Number(p.current ?? 0),
        total: Number(p.total ?? 0),
        percent: Number(p.percent ?? 0),
        instanceId: String(p.instance_id ?? p.instanceId ?? ''),
        instanceName: String(p.instance_name ?? p.instanceName ?? ''),
        iconPath: String(p.icon ?? p.icon_path ?? ''),
      });
      if (p.stage === 'done') clearLater(2200);
    }).then(unsub => unsubs.push(unsub));

    listen<any>('java-download', e => {
      const p = e.payload ?? {};
      const percent = Math.max(0, Math.min(100, Number(p.percent ?? 0)));
      push({
        source: 'java',
        stage: 'java',
        message: String(p.message ?? 'Installing Java…'),
        current: percent,
        total: 100,
        percent,
        javaVersion: Number(p.version ?? 0) || undefined,
      });
      if (percent >= 100 || /(?:done|complete|installed|error|cancel)/i.test(String(p.stage ?? p.message ?? ''))) {
        clearLater(1200);
      }
    }).then(unsub => unsubs.push(unsub));

    // Keep support for other byte-based downloads used by the launcher.
    listen<any>('download-progress', e => {
      // Byte downloads can continue briefly while launch-status is already in
      // auth/resolve/starting. Do not replace the clear launch state with a
      // misleading "Downloading" card during a normal Minecraft start.
      if (launchingRef.current) return;
      const p = e.payload ?? {};
      const current = Number(p.current ?? p.downloaded ?? 0);
      const total = Number(p.total ?? 0);
      const now = performance.now();
      if (last.current && current > last.current.bytes) {
        const seconds = (now - last.current.t) / 1000;
        if (seconds > 0.25) {
          setSpeed((current - last.current.bytes) / seconds);
          last.current = { t: now, bytes: current };
        }
      } else {
        last.current = { t: now, bytes: current };
      }
      push({
        source: 'download',
        stage: String(p.stage ?? 'download'),
        message: String(p.message ?? 'Downloading files…'),
        current,
        total,
        percent: Number(p.percent ?? (total > 0 ? Math.round(current / total * 100) : 0)),
        instanceId: String(p.instance_id ?? p.instanceId ?? ''),
        instanceName: String(p.instance_name ?? p.instanceName ?? ''),
        iconPath: String(p.icon ?? p.icon_path ?? ''),
      });
      const isFinished = Number(p.percent ?? 0) >= 100 || /^(?:done|complete|completed|error|cancelled|canceled)$/i.test(String(p.stage ?? ''));
      if (isFinished) clearLater(1200);
    }).then(unsub => unsubs.push(unsub));

    listen<LaunchStatusEvent>('launch-status', e => {
      const p = e.payload ?? {};
      const status = p.status ?? '';
      const instanceId = p.instance_id ?? null;

      if (['auth', 'resolve', 'install', 'java', 'natives', 'starting'].includes(status)) {
        if (hideTimer.current) clearTimeout(hideTimer.current);
        launchingRef.current = instanceId;
        setLaunching(instanceId);
        // A launch status owns the global card until the process is running;
        // stale byte-download events must not survive into this state.
        setEvent({
              source: 'launch',
              stage: status,
              message: p.message ?? 'Preparing Minecraft…',
              current: launchPercent(status),
              total: 100,
              percent: launchPercent(status),
            });
      } else if (status === 'running') {
        launchingRef.current = null;
        clearLater(1100);
      } else if (status === 'stopped' || status === 'error') {
        launchingRef.current = null;
        clearLater(450);
      }
    }).then(unsub => unsubs.push(unsub));

    return () => {
      unsubs.forEach(unsub => unsub());
      if (hideTimer.current) clearTimeout(hideTimer.current);
    };
  }, []);

  if (!event && !launching) return null;

  const percent = Math.max(0, Math.min(100, event?.percent ?? 0));
  const total = event?.total ?? 0;
  const current = event?.current ?? 0;
  const isByteProgress = event?.source === 'download' && total > 1024 * 1024;
  const itemCounter = total > 0 && !isByteProgress ? `${Math.min(current, total)}/${total} files` : null;
  const cancelTarget = event?.source === 'instance' ? event.instanceId : launching;
  const canCancelInstallation = Boolean(cancelTarget) && event?.source === 'instance';

  if (collapsed) {
    return (
      <div className="fixed right-4 top-12 z-[150]">
        <button
          type="button"
          onClick={() => setCollapsed(false)}
          title="Show installation progress"
          className="flex items-center gap-2 rounded-xl px-2 py-1.5 shadow-xl transition-transform hover:scale-[1.03]"
          style={{ background: 'color-mix(in srgb, var(--color-surface) 96%, transparent)', border: '1px solid var(--color-border)', backdropFilter: 'blur(18px)' }}
        >
          <span className="relative h-7 w-7 overflow-hidden rounded-lg flex items-center justify-center" style={{ background: 'color-mix(in srgb, var(--color-primary) 14%, transparent)', color: 'var(--color-primary)' }}>
            {progressIcon ? <img src={progressIcon} alt="" className="h-full w-full object-cover" /> : <FolderDown className="h-3.5 w-3.5" />}
          </span>
          <span className="text-[10px] font-black tabular-nums" style={{ color: 'var(--color-primary)' }}>{percent}%</span>
          <ChevronDown className="h-3 w-3" style={{ color: 'var(--color-text-secondary)' }} />
        </button>
      </div>
    );
  }

  return (
    <div className="fixed right-4 top-12 z-[150] w-[min(420px,calc(100vw-2rem))] rounded-2xl px-3.5 py-3 shadow-2xl"
      style={{ background: 'color-mix(in srgb, var(--color-surface) 94%, transparent)', border: '1px solid var(--color-border)', backdropFilter: 'blur(18px)' }}>
      <div className="flex items-center gap-3">
        <div className="relative w-9 h-9 rounded-xl flex items-center justify-center shrink-0 overflow-hidden"
          style={{ background: 'color-mix(in srgb, var(--color-primary) 14%, transparent)', color: 'var(--color-primary)' }}>
          {progressIcon ? <img src={progressIcon} alt="" className="h-full w-full object-cover" /> : event?.source === 'java' ? <LoaderCircle className="w-4 h-4 animate-spin" /> : <FolderDown className="w-4 h-4" />}
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between gap-3 mb-1.5">
            <div className="min-w-0">
              <p className="text-[11px] font-bold truncate" style={{ color: 'var(--color-text)' }}>
                {instance?.name || event?.instanceName || event?.message || 'Preparing Minecraft…'}
              </p>
              <p className="text-[10px] truncate" style={{ color: 'var(--color-text-secondary)' }}>
                {event ? `${stageLabel(event)}${itemCounter ? ` · ${itemCounter}` : ''}` : 'Preparing launch'}
              </p>
            </div>
            <span className="text-[11px] font-black tabular-nums shrink-0" style={{ color: 'var(--color-primary)' }}>{percent}%</span>
          </div>
          <div className="h-1.5 rounded-full overflow-hidden" style={{ background: 'var(--color-surface-2)' }}>
            <div className="h-full rounded-full transition-all duration-300"
              style={{ width: `${percent}%`, background: 'linear-gradient(90deg, color-mix(in srgb, var(--color-primary) 60%, black), var(--color-primary))' }} />
          </div>
        </div>

        <span className="text-[10px] font-semibold shrink-0 tabular-nums hidden sm:block" style={{ color: 'var(--color-text-secondary)' }}>
          {isByteProgress
            ? `${Math.max(0, mb(total) - mb(current)).toFixed(1)} MB left`
            : speed > 0 ? `${(speed / 1024 / 1024).toFixed(2)} MB/s` : ''}
        </span>

        <button type="button" onClick={() => setCollapsed(true)} title="Collapse installation progress" className="flex items-center justify-center rounded-lg p-1" style={{ color: 'var(--color-text-secondary)' }}>
          <ChevronUp className="h-3.5 w-3.5" />
        </button>

        {canCancelInstallation && cancelTarget && (
          <button
            onClick={() => {
              invoke('cancel_launch', { instanceId: cancelTarget })
                .catch(() => undefined)
                .finally(() => clearLater(250));
            }}
            className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[11px] font-bold shrink-0"
            style={{ background: 'rgba(231,76,60,0.12)', color: 'var(--color-error)' }}>
            <X className="w-3 h-3" />Cancel
          </button>
        )}
      </div>
    </div>
  );
}

export default BottomProgressBar;

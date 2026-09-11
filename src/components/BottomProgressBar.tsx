import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react';
import { listen } from '@tauri-apps/api/event';
import { invoke } from '@/lib/invoke-shim';
import { AnimatePresence, motion } from 'framer-motion';
import {
  ArrowDownToLine, Package, Play, Coffee, AlertTriangle, LoaderCircle,
  Pause, X, Minus,
} from 'lucide-react';
import { useInstanceStore } from '@/stores/instanceStore';
import { toIconSrc } from '@/lib/icon-src';

/* ── types ────────────────────────────────────────────────────────────────── */

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

/* ── helpers ──────────────────────────────────────────────────────────────── */

const RING_R = 23;
const RING_CIRC = 2 * Math.PI * RING_R;

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

function stageLabel(e: ProgressEvent): string {
  if (e.source === 'java') return `Java ${e.javaVersion ?? ''}`.trim();
  if (e.source === 'instance') {
    switch (e.stage) {
      case 'importing': return 'Чтение манифеста';
      case 'extracting': return 'Распаковка файлов';
      case 'downloading': return 'Загрузка файлов';
      case 'copying': return 'Копирование файлов';
      default: return 'Установка сборки';
    }
  }
  if (e.source === 'launch') {
    switch (e.stage) {
      case 'auth': return 'Аккаунт';
      case 'resolve': return 'Метаданные версии';
      case 'install': return 'Установка Minecraft';
      case 'java': return 'Java';
      case 'natives': return 'Нативные библиотеки';
      case 'starting': return 'Запуск игры';
      case 'running': return 'Готово';
      case 'error': return 'Ошибка';
      default: return 'Подготовка Minecraft';
    }
  }
  switch (e.stage) {
    case 'client': return 'Клиент Minecraft';
    case 'libraries': return 'Библиотеки';
    case 'natives': return 'Natives';
    case 'assets': return 'Ассеты';
    case 'done': return 'Готово';
    default: return e.stage || 'Подготовка';
  }
}

/* ── stage icon (repeating micro-animations per source) ──────────────────── */

function StageIcon({ source, stage, size = 18 }: { source?: ProgressSource; stage?: string; size?: number }) {
  const isError = source === 'launch' && stage === 'error';
  const isDone = source === 'launch' && stage === 'running';
  const cls = `w-[${size}px] h-[${size}px]`;
  if (isError) return <AlertTriangle className={`${cls} pl-anim-pulse-soft`} style={{ color:'var(--color-error)' }} />;
  if (isDone) return <Play className={`${cls}`} style={{ color:'var(--color-success)' }} />;
  if (source === 'java') return <Coffee className={`${cls} pl-anim-rotate`} style={{ color:'var(--color-primary)' }} />;
  if (source === 'launch') return <Play className={`${cls} pl-anim-pulse-soft`} style={{ color:'var(--color-primary)' }} />;
  if (source === 'instance') return <Package className={`${cls} pl-anim-bob`} style={{ color:'var(--color-primary)' }} />;
  return <ArrowDownToLine className={`${cls} pl-anim-bob`} style={{ color:'var(--color-primary)' }} />;
}

/* ── circular ring progress ──────────────────────────────────────────────── */

function RingProgress({ percent, size = 56, stroke = 3, color }: {
  percent: number; size?: number; stroke?: number; color?: string;
}) {
  const r = (size / 2) - stroke;
  const circ = 2 * Math.PI * r;
  const offset = circ - (Math.min(100, Math.max(0, percent)) / 100) * circ;
  const accent = color ?? 'var(--color-primary)';
  return (
    <svg width={size} height={size} className="shrink-0">
      <circle cx={size / 2} cy={size / 2} r={r}
        fill="none" stroke="color-mix(in srgb, var(--color-surface-2) 60%, transparent)" strokeWidth={stroke} />
      <circle cx={size / 2} cy={size / 2} r={r}
        fill="none" stroke={accent} strokeWidth={stroke}
        strokeLinecap="round"
        strokeDasharray={circ} strokeDashoffset={offset}
        transform={`rotate(-90 ${size / 2} ${size / 2})`}
        style={{ transition:'stroke-dashoffset 0.4s cubic-bezier(0.22,1,0.36,1), stroke 0.3s ease' }} />
    </svg>
  );
}

/* ── main component ──────────────────────────────────────────────────────── */

export function BottomProgressBar() {
  const [event, setEvent] = useState<ProgressEvent | null>(null);
  const [launching, setLaunching] = useState<string | null>(null);
  const launchingRef = useRef<string | null>(null);
  const suppressLaunchDownloadsRef = useRef(false);
  const [expanded, setExpanded] = useState(false);
  const [paused, setPaused] = useState(false);

  /* drag (collapsed only) */
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const drag = useRef({ active: false, sx: 0, sy: 0, ox: 0, oy: 0, moved: false });

  const onPointerDown = useCallback((e: React.PointerEvent) => {
    drag.current = { active: true, sx: e.clientX, sy: e.clientY, ox: offset.x, oy: offset.y, moved: false };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  }, [offset]);
  const onPointerMove = useCallback((e: React.PointerEvent) => {
    if (!drag.current.active) return;
    const dx = e.clientX - drag.current.sx;
    const dy = e.clientY - drag.current.sy;
    if (Math.abs(dx) + Math.abs(dy) > 4) drag.current.moved = true;
    setOffset({ x: drag.current.ox + dx, y: drag.current.oy + dy });
  }, []);
  const onPointerUp = useCallback((e: React.PointerEvent) => {
    drag.current.active = false;
    if (!drag.current.moved) setExpanded(v => !v);
  }, []);

  const instance = useInstanceStore(s => s.instances.find(i => i.id === (event?.instanceId || launching)));
  const instanceIcon = toIconSrc(instance?.iconPath);
  const progressIcon = instanceIcon || toIconSrc(event?.iconPath);

  const [speed, setSpeed] = useState(0);
  const [etaSeconds, setEtaSeconds] = useState<number | null>(null);
  const last = useRef<{ t: number; bytes: number } | null>(null);
  const itemProgressStart = useRef<{ stage: string; at: number } | null>(null);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearLater = (delay = 1300) => {
    if (hideTimer.current) clearTimeout(hideTimer.current);
    hideTimer.current = setTimeout(() => {
      setEvent(null);
      setLaunching(null);
      setSpeed(0);
      setEtaSeconds(null);
      last.current = null;
      itemProgressStart.current = null;
      setExpanded(false);
      setPaused(false);
    }, delay);
  };

  useEffect(() => {
    const unsubs: Array<() => void> = [];

    const push = (next: ProgressEvent) => {
      if (hideTimer.current) clearTimeout(hideTimer.current);
      if (paused) return;
      const cur = Number(next.current ?? 0);
      const tot = Number(next.total ?? 0);
      if (!itemProgressStart.current || itemProgressStart.current.stage !== next.stage || cur === 0) {
        itemProgressStart.current = { stage: next.stage, at: performance.now() };
      }
      if (tot > 0 && cur > 0 && cur < tot) {
        const elapsed = (performance.now() - itemProgressStart.current.at) / 1000;
        setEtaSeconds(elapsed > 0 ? Math.ceil((elapsed / cur) * (tot - cur)) : null);
      } else {
        setEtaSeconds(null);
      }
      setEvent(next);
    };

    /* instance progress */
    listen<any>('instance-progress', e => {
      const p = e.payload ?? {};
      push({
        source: 'instance',
        stage: String(p.stage ?? 'installing'),
        message: String(p.message ?? 'Установка…'),
        current: Number(p.current ?? 0),
        total: Number(p.total ?? 0),
        percent: Number(p.percent ?? (p.total > 0 ? Math.round((p.current / p.total) * 100) : 0)),
        instanceId: String(p.instance_id ?? ''),
        instanceName: String(p.name ?? ''),
        iconPath: String(p.icon ?? ''),
      });
      const pct = Number(p.percent ?? 0);
      if (pct >= 100 || /^(?:done|complete|error|cancelled|canceled)$/i.test(String(p.stage ?? ''))) clearLater(1400);
    }).then(unsub => unsubs.push(unsub));

    /* java */
    listen<any>('java-progress', e => {
      const p = e.payload ?? {};
      const percent = Number(p.percent ?? 0);
      push({
        source: 'java', stage: 'java',
        message: String(p.message ?? 'Установка Java…'),
        current: percent, total: 100, percent,
        javaVersion: Number(p.version ?? 0) || undefined,
      });
      if (percent >= 100 || /(?:done|complete|installed|error|cancel)/i.test(String(p.stage ?? p.message ?? ''))) clearLater(1200);
    }).then(unsub => unsubs.push(unsub));

    /* downloads */
    listen<any>('download-progress', e => {
      if (launchingRef.current || suppressLaunchDownloadsRef.current) return;
      const p = e.payload ?? {};
      const current = Number(p.current ?? p.downloaded ?? 0);
      const total = Number(p.total ?? 0);
      const now = performance.now();
      if (last.current && current > last.current.bytes) {
        const seconds = (now - last.current.t) / 1000;
        if (seconds > 0.25) { setSpeed((current - last.current.bytes) / seconds); last.current = { t: now, bytes: current }; }
      } else { last.current = { t: now, bytes: current }; }
      push({
        source: 'download', stage: String(p.stage ?? 'download'),
        message: String(p.message ?? 'Загрузка…'), current, total,
        percent: Number(p.percent ?? (total > 0 ? Math.round(current / total * 100) : 0)),
        instanceId: String(p.instance_id ?? ''), instanceName: String(p.instance_name ?? ''),
        iconPath: String(p.icon ?? ''),
      });
      if (Number(p.percent ?? 0) >= 100 || /^(?:done|complete|error|cancelled)$/i.test(String(p.stage ?? ''))) clearLater(1200);
    }).then(unsub => unsubs.push(unsub));

    /* launch status */
    listen<LaunchStatusEvent>('launch-status', e => {
      const p = e.payload ?? {};
      const status = p.status ?? '';
      const iid = p.instance_id ?? null;
      if (['auth','resolve','install','java','natives','starting'].includes(status)) {
        if (hideTimer.current) clearTimeout(hideTimer.current);
        launchingRef.current = iid;
        suppressLaunchDownloadsRef.current = true;
        setLaunching(iid);
        push({ source:'launch', stage:status, message:p.message ?? 'Подготовка Minecraft…', current:launchPercent(status), total:100, percent:launchPercent(status), instanceId:iid ?? undefined });
      } else if (status === 'running') {
        launchingRef.current = null;
        suppressLaunchDownloadsRef.current = true;
        push({ source:'launch', stage:'running', message:p.message ?? 'Minecraft запущен', current:100, total:100, percent:100, instanceId:iid ?? undefined });
        clearLater(950);
      } else if (status === 'error') {
        launchingRef.current = null;
        suppressLaunchDownloadsRef.current = false;
        push({ source:'launch', stage:'error', message:String(p.message ?? 'Ошибка подготовки'), current:0, total:0, percent:0, instanceId:iid ?? undefined });
        clearLater(8000);
      } else if (status === 'stopped') {
        launchingRef.current = null;
        suppressLaunchDownloadsRef.current = false;
        clearLater(450);
      }
    }).then(unsub => unsubs.push(unsub));

    return () => { unsubs.forEach(fn => fn()); if (hideTimer.current) clearTimeout(hideTimer.current); };
  }, [paused]);

  if (!event && !launching) return null;

  const pct = Math.max(0, Math.min(100, event?.percent ?? 0));
  const total = event?.total ?? 0;
  const current = event?.current ?? 0;
  const isByte = event?.source === 'download' && total > 1024 * 1024;
  const eta = etaSeconds == null || etaSeconds <= 0 ? '' : etaSeconds < 60 ? `~${etaSeconds}s` : `~${Math.ceil(etaSeconds / 60)}m`;
  const cancelTarget = event?.source === 'instance' ? event.instanceId : launching;
  const canCancel = Boolean(cancelTarget) && event?.source === 'instance';
  const isError = event?.source === 'launch' && event.stage === 'error';
  const ringColor = isError ? 'var(--color-error)' : pct >= 100 ? 'var(--color-success)' : 'var(--color-primary)';

  const etaLabel = eta ? `· ${eta}` : '';
  const fileCount = total > 0 && !isByte ? `${Math.min(current, total)}/${total}` : '';

  const containerStyle: CSSProperties = {
    position:'fixed', top:24, right:24,
    transform:`translate(${offset.x}px, ${offset.y}px)`,
    zIndex:155, pointerEvents:'none',
  };

  return (
    <div style={containerStyle}>
      <AnimatePresence mode="wait">
        {!expanded ? (
          <motion.button key="orb"
            type="button"
            initial={{ scale:0.6, opacity:0 }}
            animate={{ scale:1, opacity:1 }}
            exit={{ scale:0.6, opacity:0 }}
            transition={{ type:'spring', stiffness:560, damping:34, mass:0.7 }}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerUp}
            className="relative flex items-center justify-center cursor-grab active:cursor-grabbing pointer-events-auto"
            title={instance?.name || 'Прогресс загрузки'}
            style={{ width:56, height:56, touchAction:'none' }}
          >
            <div className="absolute inset-0 rounded-full"
              style={{ boxShadow:`0 0 24px ${pct > 0 && pct < 100 ? 'color-mix(in srgb, var(--color-primary) 22%, transparent)' : 'transparent'}`, transition:'box-shadow 0.5s ease' }} />
            <div className="absolute inset-0 rounded-full"
              style={{ background:'color-mix(in srgb, var(--color-surface) 88%, var(--color-bg))', border:'1px solid color-mix(in srgb, var(--color-border) 60%, var(--color-primary))' }} />
            <RingProgress percent={pct} size={56} stroke={3} color={ringColor} />
            <div className="absolute inset-0 flex items-center justify-center">
              {progressIcon
                ? <img src={progressIcon} alt="" className="h-5 w-5 rounded-[4px] object-cover" />
                : <StageIcon source={event?.source} stage={event?.stage} size={20} />}
            </div>
            {pct > 0 && (
              <span className="absolute -bottom-0.5 -right-0.5 flex items-center justify-center rounded-full px-1.5 py-px text-[8px] font-black tabular-nums leading-none"
                style={{ background:'var(--color-surface)', border:'1.5px solid var(--color-border)', color: isError ? 'var(--color-error)' : 'var(--color-primary)' }}>
                {pct}
              </span>
            )}
          </motion.button>
        ) : (
          <motion.div key="panel"
            initial={{ opacity:0, scale:0.82, y:-10, originX:1, originY:0 }}
            animate={{ opacity:1, scale:1, y:0 }}
            exit={{ opacity:0, scale:0.82, y:-10 }}
            transition={{ type:'spring', stiffness:520, damping:36 }}
            className="overflow-hidden rounded-2xl pointer-events-auto"
            style={{
              width:360,
              background:'color-mix(in srgb, var(--color-surface) 94%, var(--color-bg))',
              border:'1px solid color-mix(in srgb, var(--color-border) 70%, var(--color-primary))',
              boxShadow:'0 12px 40px rgba(0,0,0,0.45), 0 0 0 1px color-mix(in srgb, var(--color-primary) 8%, transparent)',
              backdropFilter:'blur(24px) saturate(1.4)',
            }}
          >
            {/* top progress line */}
            <div className="h-[3px] w-full" style={{ background:'var(--color-surface-2)' }}>
              <div className="h-full" style={{
                width:`${pct}%`,
                background: isError
                  ? 'var(--color-error)'
                  : pct >= 100
                    ? 'linear-gradient(90deg, var(--color-success), color-mix(in srgb, var(--color-success) 60%, var(--color-primary)))'
                    : 'var(--color-primary)',
                transition:'width 0.4s cubic-bezier(0.22,1,0.36,1), background 0.4s ease',
              }} />
            </div>

            <div className="px-4 py-3">
              <div className="flex items-center gap-3">
                <div className="relative flex items-center justify-center" style={{ width:44, height:44 }}>
                  <RingProgress percent={pct} size={44} stroke={2.5} color={ringColor} />
                  <div className="absolute inset-0 flex items-center justify-center">
                    {progressIcon
                      ? <img src={progressIcon} alt="" className="h-4 w-4 rounded-[3px] object-cover" />
                      : <StageIcon source={event?.source} stage={event?.stage} size={16} />}
                  </div>
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-bold truncate" style={{ color:'var(--color-text)' }}>
                    {instance?.name || event?.instanceName || event?.message || 'Подготовка…'}
                  </p>
                  <p className="mt-0.5 text-[10px] truncate" style={{ color:'var(--color-text-secondary)' }}>
                    {stageLabel(event!)}{fileCount ? ` · ${fileCount}` : ''}{etaLabel ? ` ${etaLabel}` : ''}
                  </p>
                </div>
                <span className="text-xs font-black tabular-nums shrink-0" style={{ color: isError ? 'var(--color-error)' : pct >= 100 ? 'var(--color-success)' : 'var(--color-primary)' }}>
                  {pct}%
                </span>
                <button type="button" onClick={() => setExpanded(false)}
                  className="flex items-center justify-center rounded-lg p-1 transition-colors hover:bg-white/5" style={{ color:'var(--color-text-secondary)' }}>
                  <Minus className="h-3.5 w-3.5" />
                </button>
              </div>

              {(isByte || (speed > 0 && pct < 100)) && (
                <div className="mt-2 flex items-center justify-between text-[10px]" style={{ color:'var(--color-text-tertiary)' }}>
                  <span className="truncate">{event?.message}</span>
                  <span className="shrink-0 tabular-nums">
                    {isByte ? `${Math.max(0, mb(total) - mb(current)).toFixed(1)} MB` : `${(speed / 1024 / 1024).toFixed(1)} MB/s`}
                  </span>
                </div>
              )}

              {(canCancel || event?.source === 'launch') && pct < 100 && !isError && (
                <div className="mt-3 flex items-center gap-2">
                  <button type="button" onClick={() => setPaused(v => !v)}
                    className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[11px] font-semibold transition-colors"
                    style={{
                      background: paused ? 'color-mix(in srgb, var(--color-primary) 18%, transparent)' : 'var(--color-surface-2)',
                      color: paused ? 'var(--color-primary)' : 'var(--color-text-secondary)',
                      border:'1px solid var(--color-border)',
                    }}>
                    {paused ? <Play className="h-3 w-3" /> : <Pause className="h-3 w-3" />}
                    {paused ? 'Продолжить' : 'Пауза'}
                  </button>
                  {canCancel && cancelTarget && (
                    <button type="button"
                      onClick={() => { invoke('cancel_instance_install', { instanceId: cancelTarget }).catch(() => {}).finally(() => { setEvent(null); setLaunching(null); setExpanded(false); }); }}
                      className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[11px] font-semibold transition-colors"
                      style={{ background:'rgba(231,76,60,0.10)', color:'var(--color-error)', border:'1px solid rgba(231,76,60,0.18)' }}>
                      <X className="h-3 w-3" />Отмена
                    </button>
                  )}
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

export default BottomProgressBar;

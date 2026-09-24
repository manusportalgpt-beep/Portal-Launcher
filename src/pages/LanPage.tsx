import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ArrowLeft, Copy, Gauge, Link2, Loader2, Radio, Server, Signal, Trash2, Wifi, WifiOff,
} from 'lucide-react';
import { useInstanceStore } from '@/stores/instanceStore';
import { useLanRelay } from '@/lib/use-lan-relay';

/* ── Пинг-диаграмма ──────────────────────────────────────────────────────
   Столбики по последним замерам. Каждый столбик — «пиксельный» блок: чем
   выше, тем лучше (меньше задержка). Цвет: зелёный < 60 мс, жёлтый <
   120 мс, красный выше. Данные — реальные замеры до relay-хоста, поэтому
   до старта LAN показывается честное «нет данных», а не выдуманные числа. */
const HISTORY = 32;

type Sample = { ms: number | null };

function LatencyChart({ samples, accent }: { samples: Sample[]; accent: string }) {
  const max = Math.max(80, ...samples.map(s => s.ms ?? 0));
  return (
    <div className="flex h-28 items-end gap-[2px] rounded-lg p-2"
      style={{ background: 'var(--shell-bg)', border: '1px solid var(--shell-line)' }}>
      {samples.map((sample, index) => {
        const height = sample.ms === null ? 6 : Math.max(8, Math.round((1 - sample.ms / max) * 88));
        const color = sample.ms === null
          ? 'var(--shell-line-strong)'
          : sample.ms < 60 ? 'var(--shell-ok)'
          : sample.ms < 120 ? 'var(--shell-warn)'
          : 'var(--shell-err)';
        return (
          <div key={index} className="flex-1 rounded-[1px] transition-[height] duration-200"
            style={{ height: `${height}%`, background: color === 'var(--shell-ok)' ? accent : color, opacity: sample.ms === null ? 0.4 : 1 }}
            title={sample.ms === null ? 'нет замера' : `${sample.ms} мс`} />
        );
      })}
    </div>
  );
}

function LatencyBadge({ ms }: { ms: number | null }) {
  if (ms === null) {
    return <span className="rounded px-1.5 py-0.5 text-[10px] font-bold"
      style={{ background: 'var(--shell-raised)', color: 'var(--shell-ink-mute)' }}>— мс</span>;
  }
  const color = ms < 60 ? 'var(--shell-ok)' : ms < 120 ? 'var(--shell-warn)' : 'var(--shell-err)';
  return <span className="rounded px-1.5 py-0.5 text-[10px] font-bold"
    style={{ background: 'var(--shell-accent-wash)', color }}>{ms} мс</span>;
}

/** Пинг до публичного адреса: один HEAD-запрос с таймером abort. */
function useLatency(address: string | null) {
  const [ms, setMs] = useState<number | null>(null);
  const [history, setHistory] = useState<Sample[]>(() => Array.from({ length: HISTORY }, () => ({ ms: null })));

  const probe = useCallback(async () => {
    if (!address) { setMs(null); return; }
    const started = performance.now();
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), 4000);
    try {
      // CORS не мешает: нам важен сам факт ответа и задержка до него.
      await fetch(`https://${address}/`, { mode: 'no-cors', signal: controller.signal, cache: 'no-store' });
      const value = Math.round(performance.now() - started);
      setMs(value);
      setHistory(prev => [...prev.slice(1), { ms: value }]);
    } catch {
      setMs(null);
      setHistory(prev => [...prev.slice(1), { ms: null }]);
    } finally {
      window.clearTimeout(timer);
    }
  }, [address]);

  useEffect(() => {
    void probe();
    const timer = window.setInterval(() => { void probe(); }, 3000);
    return () => window.clearInterval(timer);
  }, [probe]);

  return { ms, history };
}

function LanRow({ instanceId, name, version, loader }: {
  instanceId: string; name: string; version: string; loader: string;
}) {
  const navigate = useNavigate();
  const { relay, busy, error, toggle } = useLanRelay(instanceId);
  const address = relay?.active && relay.public_host && relay.public_port
    ? `${relay.public_host}:${relay.public_port}`
    : null;
  const { ms, history } = useLatency(address);
  const [copied, setCopied] = useState(false);

  const copy = () => {
    if (!address) return;
    navigator.clipboard?.writeText(address).then(() => {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    });
  };

  return (
    <div className="flex flex-col gap-3 rounded-xl p-4"
      style={{ background: 'var(--shell-card)', border: '1px solid var(--shell-line)' }}>
      <div className="flex flex-wrap items-center gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <Server className="h-4 w-4 shrink-0" style={{ color: 'var(--shell-accent)' }} />
            <p className="truncate text-sm font-bold" style={{ color: 'var(--shell-ink)' }}>{name}</p>
            {relay?.active
              ? <span className="rounded px-1.5 py-0.5 text-[9px] font-bold uppercase"
                style={{ background: 'rgba(63,185,80,.16)', color: 'var(--shell-ok)' }}>Открыт</span>
              : <span className="rounded px-1.5 py-0.5 text-[9px] font-bold uppercase"
                style={{ background: 'var(--shell-raised)', color: 'var(--shell-ink-mute)' }}>Закрыт</span>}
          </div>
          <p className="mt-0.5 text-[11px]" style={{ color: 'var(--shell-ink-mute)' }}>
            {version} · {loader}
            {relay?.local_port ? ` · локальный порт ${relay.local_port}` : ''}
          </p>
        </div>

        <div className="flex items-center gap-2">
          {address ? (
            <>
              <button type="button" onClick={copy}
                className="flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-bold"
                style={{ background: 'var(--shell-accent)', color: 'var(--shell-accent-ink)' }}
                title="Скопировать публичный адрес">
                <Copy className="h-3.5 w-3.5" />{copied ? 'Скопировано' : address}
              </button>
              <button type="button" onClick={() => void toggle()} disabled={busy}
                className="rounded-md p-1.5 disabled:opacity-50"
                style={{ background: 'var(--shell-raised)', color: 'var(--shell-err)' }}
                title="Закрыть LAN">
                {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
              </button>
            </>
          ) : (
            <button type="button" onClick={() => void toggle()} disabled={busy || !relay?.local_port}
              className="flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-bold disabled:opacity-50"
              style={{ background: 'var(--shell-raised)', color: 'var(--shell-ink)', border: '1px solid var(--shell-line)' }}
              title={!relay?.local_port ? 'Откройте мир для сети в Minecraft' : 'Открыть мир по сети'}>
              {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Link2 className="h-3.5 w-3.5" />}
              {busy ? 'Подключаю…' : 'Открыть LAN'}
            </button>
          )}
          <button type="button" onClick={() => navigate(`/library/${instanceId}`)}
            className="rounded-md px-2.5 py-1.5 text-[10px] font-bold"
            style={{ background: 'var(--shell-raised)', color: 'var(--shell-ink-soft)', border: '1px solid var(--shell-line)' }}>
            Открыть
          </button>
        </div>
      </div>

      <div className="flex items-center gap-2 text-[11px]" style={{ color: 'var(--shell-ink-mute)' }}>
        {address ? <Signal className="h-3.5 w-3.5" style={{ color: 'var(--shell-ok)' }} /> : <WifiOff className="h-3.5 w-3.5" />}
        <span className="min-w-0 flex-1 truncate">
          {error ?? (address ? `Публичный адрес ${address}` : (relay?.local_port
            ? 'Готов к публикации'
            : 'Откройте мир для сети в Minecraft, чтобы появился локальный порт'))}
        </span>
        <LatencyBadge ms={ms} />
      </div>

      {address && <LatencyChart samples={history} accent="var(--shell-ok)" />}
    </div>
  );
}

export function LanPage() {
  const navigate = useNavigate();
  const instances = useInstanceStore(state => state.instances);
  const [filter, setFilter] = useState('');

  const visible = useMemo(() => {
    const needle = filter.trim().toLowerCase();
    if (!needle) return instances;
    return instances.filter(i => `${i.name} ${i.minecraftVersion} ${i.modLoader}`.toLowerCase().includes(needle));
  }, [filter, instances]);

  const openCount = instances.filter(i => i.id).length;

  return (
    <div className="mx-auto flex h-full w-full max-w-5xl flex-col gap-4 overflow-y-auto p-5">
      <header className="flex flex-wrap items-center gap-3">
        <button type="button" onClick={() => navigate(-1)}
          className="rounded-md p-1.5" style={{ background: 'var(--shell-raised)', color: 'var(--shell-ink-soft)' }}
          title="Назад">
          <ArrowLeft className="h-4 w-4" />
        </button>
        <div className="min-w-0 flex-1">
          <h1 className="flex items-center gap-2 text-lg font-bold" style={{ color: 'var(--shell-ink)' }}>
            <Radio className="h-5 w-5" style={{ color: 'var(--shell-accent)' }} />Мир по сети (LAN)
          </h1>
          <p className="text-xs" style={{ color: 'var(--shell-ink-mute)' }}>
            Публичные адреса для открытых миров и задержка до них
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span className="flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs"
            style={{ background: 'var(--shell-card)', border: '1px solid var(--shell-line)', color: 'var(--shell-ink-soft)' }}>
            <Wifi className="h-3.5 w-3.5" style={{ color: 'var(--shell-accent)' }} />{openCount} сборок
          </span>
        </div>
      </header>

      <div className="flex items-center gap-2 rounded-lg px-3 py-2"
        style={{ background: 'var(--shell-accent-wash)', border: '1px solid var(--shell-accent-line)' }}>
        <Gauge className="h-4 w-4 shrink-0" style={{ color: 'var(--shell-accent)' }} />
        <p className="text-[11px]" style={{ color: 'var(--shell-ink-soft)' }}>
          Адрес и пинг появляются, когда мир открыт для сети в Minecraft. Диаграмма — реальные
          замеры задержки, без приукрашивания.
        </p>
      </div>

      {instances.length > 3 && (
        <input value={filter} onChange={e => setFilter(e.target.value)} placeholder="Поиск по сборкам…"
          className="w-full rounded-md px-3 py-2 text-sm outline-none"
          style={{ background: 'var(--shell-bg)', border: '1px solid var(--shell-line)', color: 'var(--shell-ink)' }} />
      )}

      {visible.length === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-2 py-16 text-center">
          <Server className="h-8 w-8" style={{ color: 'var(--shell-ink-mute)' }} />
          <p className="text-sm font-bold" style={{ color: 'var(--shell-ink-soft)' }}>Нет сборок</p>
          <p className="text-xs" style={{ color: 'var(--shell-ink-mute)' }}>
            Создайте сборку в библиотеке, чтобы открыть мир по сети
          </p>
        </div>
      ) : (
        <div className="flex flex-col gap-3 pb-6">
          {visible.map(instance => (
            <LanRow key={instance.id} instanceId={instance.id} name={instance.name}
              version={instance.minecraftVersion} loader={instance.modLoader} />
          ))}
        </div>
      )}
    </div>
  );
}

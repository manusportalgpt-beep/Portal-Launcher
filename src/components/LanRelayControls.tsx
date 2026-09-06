import { Copy, Link, Loader2 } from 'lucide-react';
import { useLanRelay } from '@/lib/use-lan-relay';

function relayAddress(relay: { active: boolean; public_host?: string; public_port?: number } | null) {
  return relay?.active && relay.public_host && relay.public_port
    ? `${relay.public_host}:${relay.public_port}`
    : null;
}

/** Панель «Мир / LAN»: статус, открыть/закрыть relay, скопировать адрес. */
export function LanRelayBanner({ instanceId }: { instanceId: string }) {
  const { relay, busy, error, toggle } = useLanRelay(instanceId);
  const address = relayAddress(relay);
  return (
    <div className="flex flex-wrap items-center gap-3 rounded-2xl px-4 py-3"
      style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)' }}>
      <div className="flex min-w-0 flex-1 items-center gap-2">
        <Link className="h-4 w-4 shrink-0" style={{ color: 'var(--color-primary)' }} />
        <div className="min-w-0">
          <p className="text-sm font-bold" style={{ color: 'var(--color-text)' }}>Мир / LAN</p>
          <p className="text-[11px]" style={{ color: error ? 'var(--color-error)' : 'var(--color-text-secondary)' }}>
            {error ?? (relay?.local_port ? `Порт Minecraft: ${relay.local_port}` : 'Сначала откройте мир для сети в Minecraft')}
          </p>
        </div>
      </div>
      {address ? (
        <button onClick={() => navigator.clipboard?.writeText(address)}
          className="flex items-center gap-1.5 rounded-xl px-3 py-2 text-xs font-bold"
          style={{ background: 'var(--color-primary)', color: 'var(--color-primary-text)' }}
          title="Скопировать адрес LAN">
          <Copy className="h-3.5 w-3.5" />{address}
        </button>
      ) : (
        <button onClick={() => void toggle()} disabled={busy || !relay?.local_port}
          className="flex items-center gap-1.5 rounded-xl px-3 py-2 text-xs font-bold disabled:opacity-50"
          style={{ background: 'var(--color-surface-2)', color: 'var(--color-text)', border: '1px solid var(--color-border)' }}
          title={!relay?.local_port ? 'Порт ещё не найден — откройте мир для сети в Minecraft' : 'Создать публичный адрес LAN'}>
          {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Link className="h-3.5 w-3.5" />}
          {busy ? 'Подключаю…' : 'Открыть LAN'}
        </button>
      )}
    </div>
  );
}

/** Кнопка-чип с адресом relay для карточки мира. */
export function LanRelayAddressChip({ instanceId }: { instanceId: string }) {
  const { relay } = useLanRelay(instanceId);
  const address = relayAddress(relay);
  if (!address) return null;
  return (
    <button onClick={() => navigator.clipboard?.writeText(address)}
      className="flex items-center gap-1 rounded-xl px-2.5 py-1.5 text-[10px] font-bold"
      style={{ background: 'var(--color-primary-dim)', color: 'var(--color-primary)', border: '1px solid var(--color-primary)' }}
      title="Скопировать адрес LAN relay">
      <Copy className="h-3 w-3" />{address}
    </button>
  );
}

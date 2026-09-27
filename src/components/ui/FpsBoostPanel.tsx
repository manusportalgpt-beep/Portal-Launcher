import { useMemo, useState } from 'react';
import { Check, Loader2, Zap } from 'lucide-react';
import { invoke } from '@/lib/invoke-shim';
import { useLaunchStore } from '@/stores/launchStore';
import { LOADER_LABEL, planFpsBoost, type BoostMod } from '@/lib/fps-boost';

/**
 * Панель «Буст FPS».
 *
 * Показывает, что именно будет поставлено, до установки — и ставит по
 * одной кнопке. Совместимость не угадывается: список приходит из
 * fps-boost.ts, а версия файла и загрузчик проверяются на стороне Modrinth
 * при подборе (см. подбор в agent.ts). Пользователю не нужно знать, что
 * такое Sodium, — он видит человеческое название и объяснение.
 */
export function FpsBoostPanel({ instanceId, loader, mcVersion, onDone }: {
  instanceId: string;
  loader: string;
  mcVersion?: string;
  /** Вызывается после установки: родитель может обновить список модов. */
  onDone?: () => void;
}) {
  const plan = useMemo(() => planFpsBoost(loader, mcVersion), [loader, mcVersion]);
  const setStatus = useLaunchStore(s => s.setStatus);

  const [picked, setPicked] = useState<Record<string, boolean>>({});
  const [busy, setBusy] = useState(false);
  const [log, setLog] = useState<string[]>([]);

  if (!plan.supported) {
    return (
      <div className="px-well px-3 py-2.5">
        <p className="flex items-center gap-2 text-[11px] font-black" style={{ color: 'var(--color-text)' }}>
          <Zap size={13} style={{ color: 'var(--color-primary)' }} /> Буст FPS
        </p>
        <p className="mt-1 text-[10px] leading-4" style={{ color: 'var(--color-text-secondary)' }}>
          {plan.reason}
        </p>
      </div>
    );
  }

  // По умолчанию выбраны база и первые три ускорителя: полный набор
  // иногда конфликтует, а три дают основной выигрыш.
  const defaultPicked = (m: BoostMod) => m.required === true
    || (m.slug === plan.boosts[0]?.slug)
    || (m.slug === 'lithium')
    || (m.slug === 'embeddium');
  const isPicked = (m: BoostMod) => picked[m.slug] ?? defaultPicked(m);

  const install = async () => {
    if (busy) return;
    setBusy(true);
    setLog([]);
    const targets = [...plan.base, ...plan.boosts].filter(isPicked);
    const lines: string[] = [];

    for (const mod of targets) {
      try {
        setLog(prev => [...prev, `Ищу ${mod.title}…`]);
        // Поиск с фильтром по загрузчику и версии: несовместимый файл
        // в список не попадёт, и поставить его не получится.
        const found = await invoke<any>('search_modrinth', {
          query: mod.slug,
          limit: 5,
          index: 0,
          filters: JSON.stringify({
            versions: mcVersion ? [mcVersion] : undefined,
            loaders: [loader.toLowerCase()],
            project_type: 'mod',
          }),
        });
        const hit = (found?.hits ?? []).find(
          (h: any) => h?.project_id === mod.slug || h?.slug === mod.slug,
        ) ?? (found?.hits ?? [])[0];
        const file = hit?.files?.[0];
        if (!hit || !file?.url) {
          lines.push(`${mod.title} — не найден для ${mcVersion ?? 'этой версии'} / ${loader}`);
          continue;
        }
        setLog(prev => [...prev, `Ставлю ${mod.title} ${hit.version_number ?? ''}…`]);
        await invoke('install_mod', {
          instanceId,
          downloadUrl: file.url,
          fileName: file.filename,
          modId: hit.project_id ?? mod.slug,
          modName: hit.title ?? mod.title,
          modVersion: hit.version_number ?? '',
          versionId: hit.id ?? '',
          source: 'modrinth',
          modType: 'mod',
          projectId: hit.project_id ?? mod.slug,
          author: hit.author ?? null,
          iconUrl: hit.icon_url ?? null,
        });
        lines.push(`${mod.title} ${hit.version_number ?? ''} — установлен`);
      } catch (e) {
        lines.push(`${mod.title} — ошибка: ${String(e).slice(0, 120)}`);
      }
    }
    setLog(lines);
    setBusy(false);
    onDone?.();
  };

  const all = [...plan.base, ...plan.boosts];

  return (
    <div className="px-frame p-3">
      <div className="flex items-center gap-2">
        <Zap size={14} style={{ color: 'var(--color-primary)' }} />
        <p className="flex-1 text-[11px] font-black" style={{ color: 'var(--color-text)' }}>
          Буст FPS
        </p>
        <span className="text-[10px] font-bold" style={{ color: 'var(--color-text-tertiary)' }}>
          {LOADER_LABEL[loader.toLowerCase()] ?? loader}
          {mcVersion ? ` · ${mcVersion}` : ''}
        </span>
      </div>

      <p className="mt-1 text-[10px] leading-4" style={{ color: 'var(--color-text-secondary)' }}>
        Подбор модов под этот загрузчик и версию игры. Сними лишние, если не нужен.
      </p>

      <div className="mt-2 flex flex-col gap-1">
        {all.map(mod => (
          <label
            key={mod.slug}
            className="flex cursor-pointer items-start gap-2 rounded px-1.5 py-1.5"
            style={{ background: 'var(--color-surface-2)' }}>
            <input
              type="checkbox"
              checked={isPicked(mod)}
              disabled={mod.required}
              onChange={e => setPicked(p => ({ ...p, [mod.slug]: e.target.checked }))}
              className="mt-0.5"
            />
            <span className="min-w-0 flex-1">
              <span className="flex items-center gap-1.5">
                <span className="text-[11px] font-bold" style={{ color: 'var(--color-text)' }}>
                  {mod.title}
                </span>
                {mod.required && (
                  <span className="text-[9px] font-bold" style={{ color: 'var(--color-primary)' }}>
                    обязательно
                  </span>
                )}
              </span>
              <span className="block text-[10px] leading-4" style={{ color: 'var(--color-text-tertiary)' }}>
                {mod.note}
              </span>
            </span>
          </label>
        ))}
      </div>

      <div className="mt-2 flex items-center gap-2">
        <button
          type="button"
          onClick={() => void install()}
          disabled={busy}
          className="px-btn px-btn-primary px-3 py-1.5 text-[11px]">
          {busy ? <><Loader2 size={13} className="animate-spin" /> Ставлю…</> : <><Zap size={13} /> Установить и пересобрать</>}
        </button>
        <button
          type="button"
          onClick={() => { setPicked({}); setLog([]); }}
          disabled={busy}
          className="px-btn px-btn-quiet px-3 py-1.5 text-[11px]">
          Сбросить
        </button>
      </div>

      {log.length > 0 && (
        <ul className="mt-2 flex flex-col gap-0.5 border-t pt-2" style={{ borderColor: 'var(--color-border)' }}>
          {log.map((line, i) => (
            <li key={i} className="flex items-start gap-1.5 text-[10px] leading-4">
              <Check size={11} className="mt-0.5 shrink-0" style={{ color: line.includes('ошибка') || line.includes('не найден') ? 'var(--color-warning)' : 'var(--color-success)' }} />
              <span className="portal-selectable" style={{ color: 'var(--color-text-secondary)' }}>{line}</span>
            </li>
          ))}
        </ul>
      )}

      {log.length > 0 && !busy && (
        <p className="mt-2 text-[10px]" style={{ color: 'var(--color-text-tertiary)' }}>
          Пересобери сборку, чтобы моды проиндексировались.
          <button type="button" onClick={() => setStatus(instanceId, 'idle')} className="ml-1 font-bold" style={{ color: 'var(--color-primary)' }}>
            готово
          </button>
        </p>
      )}
    </div>
  );
}

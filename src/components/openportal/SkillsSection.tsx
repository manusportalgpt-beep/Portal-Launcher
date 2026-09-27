import { useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight, FolderCog, Sparkles } from 'lucide-react';
import { useOpenCoreStore } from '@/stores/opencoreStore';
import { useSettingsStore } from '@/stores/settingsStore';
import { Toggle } from '@/components/Toggle';
import type { SkillSource } from '@/lib/opencore/types';

/** Сколько навыков показываем за раз — остальные листаются стрелками. */
const PAGE = 6;

/**
 * Навыки и источники навыков в «Управлении моделями».
 *
 * Показывает ровно 6 навыков с описаниями, остальные листаются стрелками.
 * Ниже — переключатель внешних папок: по умолчанию подключена только папка
 * самого лаунчера, чужие каталоги (ChatGPT, Claude, Codex и другие) агент
 * читает только если пользователь их включил.
 */
export function SkillsSection() {
  const skills = useOpenCoreStore(s => s.skills);
  const sources = useOpenCoreStore(s => s.skillSources);
  const refreshSkills = useOpenCoreStore(s => s.refreshSkills);
  const enabledSources = useSettingsStore(s => s.skillSources) ?? [];
  const setSetting = useSettingsStore(s => s.setSetting);

  const [page, setPage] = useState(0);
  const [sourcesOpen, setSourcesOpen] = useState(false);

  const total = skills.length;
  const pages = Math.max(1, Math.ceil(total / PAGE));
  const safePage = Math.min(page, pages - 1);
  const visible = useMemo(
    () => skills.slice(safePage * PAGE, safePage * PAGE + PAGE),
    [skills, safePage],
  );

  const external: SkillSource[] = sources.filter(s => !s.builtin);

  const toggleSource = async (id: string, on: boolean) => {
    const next = on ? [...enabledSources, id] : enabledSources.filter(s => s !== id);
    setSetting('skillSources', next);
    await refreshSkills();
  };

  return (
    <div className="mb-5">
      <div className="mb-2 mt-1 flex items-center gap-2">
        <Sparkles size={13} style={{ color: 'var(--color-primary)' }} />
        <p className="flex-1 text-[11px] font-black uppercase tracking-wide" style={{ color: 'var(--color-text)' }}>
          Навыки
        </p>
        <span className="text-[10px] font-bold" style={{ color: 'var(--color-text-tertiary)' }}>{total}</span>
      </div>

      <div className="rounded-2xl border p-3" style={{ borderColor: 'var(--color-border)' }}>
        {total === 0 ? (
          <p className="py-2 text-[11px] leading-5" style={{ color: 'var(--color-text-tertiary)' }}>
            Навыков нет. Они лежат в папке OpenPortal/Skills — положи туда папку с файлом SKILL.md.
          </p>
        ) : (
          <>
            <div className="grid gap-1.5 sm:grid-cols-2">
              {visible.map(skill => (
                <div key={skill.name} className="rounded-lg px-2 py-1.5"
                  style={{ background: 'var(--color-surface-2)', border: '1px solid var(--color-border)' }}>
                  <div className="flex items-baseline gap-1.5">
                    <span className="truncate font-mono text-[11px] font-black" style={{ color: 'var(--color-primary)' }}>
                      /{skill.name}
                    </span>
                    {skill.source !== 'portal' && (
                      <span className="shrink-0 text-[9px] font-bold"
                        style={{ color: 'var(--color-text-tertiary)' }}
                        title={`Источник: ${skill.source_label}`}>
                        {skill.source_label}
                      </span>
                    )}
                  </div>
                  {skill.description && (
                    <p className="mt-0.5 line-clamp-2 text-[10px] leading-4"
                      style={{ color: 'var(--color-text-secondary)' }}
                      title={skill.description}>
                      {skill.description}
                    </p>
                  )}
                </div>
              ))}
            </div>

            {pages > 1 && (
              <div className="mt-2 flex items-center justify-between">
                <button
                  onClick={() => setPage(p => Math.max(0, p - 1))}
                  disabled={safePage === 0}
                  title="Предыдущие"
                  className="flex h-6 w-6 items-center justify-center rounded border transition-colors disabled:opacity-30"
                  style={{ color: 'var(--color-text-secondary)', borderColor: 'var(--color-border)' }}>
                  <ChevronLeft size={12} />
                </button>
                <span className="text-[10px] font-bold" style={{ color: 'var(--color-text-tertiary)' }}>
                  {safePage * PAGE + 1}–{Math.min(total, (safePage + 1) * PAGE)} из {total}
                </span>
                <button
                  onClick={() => setPage(p => Math.min(pages - 1, p + 1))}
                  disabled={safePage >= pages - 1}
                  title="Следующие"
                  className="flex h-6 w-6 items-center justify-center rounded border transition-colors disabled:opacity-30"
                  style={{ color: 'var(--color-text-secondary)', borderColor: 'var(--color-border)' }}>
                  <ChevronRight size={12} />
                </button>
              </div>
            )}
          </>
        )}
      </div>

      {/* Источники навыков. Своя папка всегда включена, внешние — по кнопке. */}
      <button
        onClick={() => setSourcesOpen(o => !o)}
        className="mt-2 flex w-full items-center gap-1.5 rounded-lg px-1 py-1 text-left transition-colors hover:bg-[var(--color-surface-2)]">
        <FolderCog size={12} style={{ color: 'var(--color-text-tertiary)' }} />
        <span className="flex-1 text-[10px] font-black uppercase tracking-wide" style={{ color: 'var(--color-text-secondary)' }}>
          Источники навыков
        </span>
        <span className="text-[9px] font-bold" style={{ color: 'var(--color-text-tertiary)' }}>
          {enabledSources.length ? `подключено ${enabledSources.length}` : 'только свои'}
        </span>
        <ChevronRight size={12} className={sourcesOpen ? 'rotate-90 transition-transform' : 'transition-transform'}
          style={{ color: 'var(--color-text-tertiary)' }} />
      </button>

      {sourcesOpen && (
        <div className="mt-1.5 grid gap-1 sm:grid-cols-2">
          {external.map(src => {
            const on = enabledSources.includes(src.id);
            return (
              <button
                key={src.id}
                onClick={() => void toggleSource(src.id, !on)}
                title={src.exists ? src.path.join('\n') : 'Папка не найдена — навыков отсюда не будет'}
                className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-left transition-colors hover:bg-[var(--color-surface-2)]"
                style={{ background: 'var(--color-surface-2)' }}>
                <Toggle value={on} onChange={v => void toggleSource(src.id, v)} decorative />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[10px] font-bold" style={{ color: 'var(--color-text-secondary)' }}>
                    {src.label}
                  </span>
                  {!src.exists && (
                    <span className="block text-[9px]" style={{ color: 'var(--color-text-tertiary)' }}>
                      папка не найдена
                    </span>
                  )}
                </span>
              </button>
            );
          })}
          <p className="col-span-full px-1 pt-1 text-[9px] leading-4" style={{ color: 'var(--color-text-tertiary)' }}>
            Из своей папки лаунчера навыки берутся всегда. Остальные папки подключаются
            вручную и читаются только когда включены.
          </p>
        </div>
      )}
    </div>
  );
}

import { useMemo, useState } from 'react';
import { ChevronDown, ChevronRight, ChevronLeft, FolderCog, Sparkles } from 'lucide-react';
import { useOpenCoreStore } from '@/stores/opencoreStore';
import { useSettingsStore } from '@/stores/settingsStore';
import { Toggle } from '@/components/Toggle';
import type { SkillMeta, SkillSource } from '@/lib/opencore/types';

/** Сколько навыков показываем за раз — остальные листаются стрелками. */
const PAGE = 6;

/**
 * Панель навыков в боковой колонке OpenPortal.
 *
 * Показывает ровно 6 навыков с описаниями, остальные листаются стрелками.
 * Ниже — переключатель внешних папок: по умолчанию подключена только папка
 * самого лаунчера, чужие каталоги (ChatGPT, Claude, Codex и другие) агент
 * читает только если пользователь их включил.
 */
export function SkillsPanel() {
  const skills = useOpenCoreStore(s => s.skills);
  const sources = useOpenCoreStore(s => s.skillSources);
  const refreshSkills = useOpenCoreStore(s => s.refreshSkills);
  const enabledSources = useSettingsStore(s => s.skillSources) ?? [];
  const setSetting = useSettingsStore(s => s.setSetting);

  const [open, setOpen] = useState(false);
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
    <div className="border-t px-2 py-2" style={{ borderColor: 'var(--color-border)' }}>
      <button
        onClick={() => setOpen(o => !o)}
        className="flex w-full items-center gap-1.5 rounded px-2 py-1.5 text-left transition-colors hover:bg-[var(--color-surface-2)]"
        style={{ color: 'var(--color-text-secondary)' }}
      >
        {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        <Sparkles size={12} />
        <span className="flex-1 text-[11px] font-black uppercase tracking-wide">Навыки</span>
        <span className="text-[10px] font-bold" style={{ color: 'var(--color-text-tertiary)' }}>{total}</span>
      </button>

      {open && (
        <div className="mt-1">
          {total === 0 ? (
            <p className="px-2 py-1.5 text-[10px] leading-4" style={{ color: 'var(--color-text-tertiary)' }}>
              Навыков нет. Они лежат в папке OpenPortal/Skills.
            </p>
          ) : (
            <>
              <div className="grid gap-1 px-1">
                {visible.map(skill => (
                  <div
                    key={skill.name}
                    className="rounded px-2 py-1.5"
                    style={{ background: 'var(--color-surface-2)', border: '1px solid var(--color-border)' }}
                  >
                    <div className="flex items-baseline gap-1.5">
                      <span className="truncate text-[11px] font-black" style={{ color: 'var(--color-text)' }}>
                        /{skill.name}
                      </span>
                      {skill.source !== 'portal' && (
                        <span
                          className="shrink-0 text-[9px] font-bold"
                          style={{ color: 'var(--color-text-tertiary)' }}
                          title={`Источник: ${skill.source_label}`}
                        >
                          {skill.source_label}
                        </span>
                      )}
                    </div>
                    {skill.description && (
                      <p
                        className="mt-0.5 line-clamp-2 text-[10px] leading-4"
                        style={{ color: 'var(--color-text-secondary)' }}
                        title={skill.description}
                      >
                        {skill.description}
                      </p>
                    )}
                  </div>
                ))}
              </div>

              {pages > 1 && (
                <div className="mt-1 flex items-center justify-between px-1">
                  <button
                    onClick={() => setPage(p => Math.max(0, p - 1))}
                    disabled={safePage === 0}
                    title="Предыдущие"
                    className="flex h-5 w-5 items-center justify-center rounded transition-colors disabled:opacity-30"
                    style={{ color: 'var(--color-text-secondary)', border: '1px solid var(--color-border)' }}
                  >
                    <ChevronLeft size={11} />
                  </button>
                  <span className="text-[9px] font-bold" style={{ color: 'var(--color-text-tertiary)' }}>
                    {safePage * PAGE + 1}–{Math.min(total, (safePage + 1) * PAGE)} из {total}
                  </span>
                  <button
                    onClick={() => setPage(p => Math.min(pages - 1, p + 1))}
                    disabled={safePage >= pages - 1}
                    title="Следующие"
                    className="flex h-5 w-5 items-center justify-center rounded transition-colors disabled:opacity-30"
                    style={{ color: 'var(--color-text-secondary)', border: '1px solid var(--color-border)' }}
                  >
                    <ChevronRight size={11} />
                  </button>
                </div>
              )}
            </>
          )}

          {/* Источники навыков. Своя папка всегда включена, внешние — по кнопке. */}
          <button
            onClick={() => setSourcesOpen(o => !o)}
            className="mt-1 flex w-full items-center gap-1.5 rounded px-2 py-1.5 text-left transition-colors hover:bg-[var(--color-surface-2)]"
            style={{ color: 'var(--color-text-tertiary)' }}
          >
            {sourcesOpen ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
            <FolderCog size={11} />
            <span className="flex-1 text-[10px] font-black uppercase tracking-wide">
              Источники навыков
            </span>
            <span className="text-[9px] font-bold">
              {enabledSources.length ? `+${enabledSources.length}` : 'только свои'}
            </span>
          </button>

          {sourcesOpen && (
            <div className="mt-0.5 flex flex-col gap-0.5 px-1">
              <p className="px-1 pb-1 text-[9px] leading-3.5" style={{ color: 'var(--color-text-tertiary)' }}>
                Из своей папки лаунчера навыки берутся всегда. Остальные папки
                подключаются вручную и читаются только когда включены.
              </p>
              {external.map(src => {
                const on = enabledSources.includes(src.id);
                return (
                  <button
                    key={src.id}
                    onClick={() => void toggleSource(src.id, !on)}
                    title={src.exists ? src.path.join('\n') : 'Папка не найдена — навыков отсюда не будет'}
                    className="flex items-center gap-2 rounded px-1.5 py-1 text-left transition-colors hover:bg-[var(--color-surface-2)]"
                  >
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
            </div>
          )}
        </div>
      )}
    </div>
  );
}

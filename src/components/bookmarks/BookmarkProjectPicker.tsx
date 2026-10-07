import { useEffect, useMemo, useState } from 'react';
import { Check, Plus, Search, X } from 'lucide-react';
import { searchModrinthGateway } from '@/lib/modrinth-gateway';
import { useBookmarkStore, type Bookmark } from '@/stores/bookmarkStore';

const PAGE_SIZE = 20;

/** Разделы Modrinth. Нам нужен один мод на проект — ресурсы и шейдеры в закладку
 *  тоже кладутся, поэтому показываем все типы, но по вкладкам. */
const SECTIONS = [
  { id: 'mods', label: 'Модификации', facet: 'mod' },
  { id: 'resourcepack', label: 'Наборы ресурсов', facet: 'resourcepack' },
  { id: 'shaderpack', label: 'Шейдеры', facet: 'shader' },
  { id: 'datapack', label: 'Дата-паки', facet: 'datapack' },
] as const;

type Section = typeof SECTIONS[number];

/**
 * Поиск проектов для наполнения закладки.
 *
 * Источник только Modrinth: у CurseForge нельзя отфильтровать файлы проекта по
 * загрузчику, поэтому пересобрать набор под другой лоадер для CurseForge не
 * получилось бы — закладка в этом просто не работала бы.
 */
export function BookmarkProjectPicker({ bookmark, onClose, onAdded }: {
  bookmark: Bookmark;
  onClose: () => void;
  onAdded: () => void;
}) {
  const addMod = useBookmarkStore(s => s.addMod);
  const [section, setSection] = useState<Section>(SECTIONS[0]);
  const [query, setQuery] = useState('');
  const [hits, setHits] = useState<any[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [busyId, setBusyId] = useState('');

  // Уже лежащие в закладке — чтобы не предлагать добавить второй раз.
  const inBookmark = useMemo(
    () => new Set(bookmark.mods.map(m => m.project_id)),
    [bookmark.mods],
  );

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError('');
    void searchModrinthGateway({
      query,
      limit: PAGE_SIZE,
      offset: page * PAGE_SIZE,
      projectType: section.facet,
      loaders: bookmark.loader && bookmark.loader !== 'vanilla' ? [bookmark.loader] : undefined,
      versions: bookmark.mc_version ? [bookmark.mc_version] : undefined,
      sort: 'Relevance',
    })
      .then(res => {
        if (!alive) return;
        setHits(res.hits ?? []);
        setTotal(res.total_hits ?? 0);
      })
      .catch(e => {
        if (!alive) return;
        setError(String(e?.message ?? e));
        setHits([]);
      })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [query, section, page, bookmark.loader, bookmark.mc_version]);

  return (
    <div
      className="fixed inset-0 z-[170] flex items-center justify-center p-4"
      style={{ background: 'rgba(0,0,0,0.7)' }}
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="flex max-h-[85vh] w-full max-w-3xl flex-col overflow-hidden rounded-2xl"
        style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)' }}>
        <header className="flex items-start justify-between gap-4 px-5 py-4" style={{ borderBottom: '1px solid var(--color-border)' }}>
          <div>
            <h3 className="text-base font-black" style={{ color: 'var(--color-text)' }}>Найти проекты</h3>
            <p className="mt-0.5 text-[11px]" style={{ color: 'var(--color-text-secondary)' }}>
              Добавляем в «{bookmark.name}» · {bookmark.loader}
              {bookmark.mc_version ? ` · ${bookmark.mc_version}` : ''}
            </p>
          </div>
          <button onClick={onClose} className="flex h-7 w-7 items-center justify-center rounded-lg"
            style={{ background: 'var(--color-surface-2)', color: 'var(--color-text-secondary)' }}>
            <X className="h-4 w-4" />
          </button>
        </header>

        <div className="px-5 py-3">
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex flex-wrap gap-1.5">
              {SECTIONS.map(s => (
                <button
                  key={s.id}
                  onClick={() => { setSection(s); setPage(0); }}
                  className="rounded-lg px-2.5 py-1 text-[11px] font-bold"
                  style={{
                    background: section.id === s.id ? 'var(--color-primary)' : 'var(--color-surface-2)',
                    color: section.id === s.id ? 'var(--color-primary-text)' : 'var(--color-text-secondary)',
                    border: '1px solid var(--color-border)',
                  }}>
                  {s.label}
                </button>
              ))}
            </div>
            <div className="relative ml-auto min-w-[200px] flex-1">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2"
                style={{ color: 'var(--color-text-tertiary)' }} />
              <input
                value={query}
                onChange={e => { setQuery(e.target.value); setPage(0); }}
                placeholder="Поиск по Modrinth"
                className="w-full rounded-lg py-1.5 pl-8 pr-3 text-xs outline-none"
                style={{ background: 'var(--color-surface-2)', color: 'var(--color-text)', border: '1px solid var(--color-border)' }}
              />
            </div>
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-4">
          {error && (
            <p className="py-6 text-center text-xs" style={{ color: 'var(--color-error)' }}>
              {error}
            </p>
          )}
          {!error && !loading && hits.length === 0 && (
            <p className="py-6 text-center text-xs" style={{ color: 'var(--color-text-tertiary)' }}>
              Ничего не найдено.
            </p>
          )}

          <div className="space-y-1.5">
            {hits.map(hit => {
              const id = String(hit.project_id ?? hit.id ?? '');
              const added = inBookmark.has(id);
              const busy = busyId === id;
              return (
                <div key={id} className="flex items-center gap-3 rounded-xl p-2.5"
                  style={{ background: 'var(--color-surface-2)', border: '1px solid var(--color-border)' }}>
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-lg"
                    style={{ background: 'var(--color-surface)' }}>
                    {hit.icon_url
                      ? <img src={hit.icon_url} alt="" className="h-full w-full object-cover" />
                      : null}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-bold" style={{ color: 'var(--color-text)' }}>
                      {hit.title ?? hit.name ?? id}
                    </p>
                    <p className="truncate text-[11px]" style={{ color: 'var(--color-text-secondary)' }}>
                      {hit.author ?? '—'}
                      {hit.latest_version ? ` · ${hit.latest_version}` : ''}
                      {hit.downloads != null ? ` · ${hit.downloads} загрузок` : ''}
                    </p>
                    {hit.description && (
                      <p className="truncate text-[10px]" style={{ color: 'var(--color-text-tertiary)' }}>
                        {String(hit.description).replace(/\s+/g, ' ')}
                      </p>
                    )}
                  </div>
                  <button
                    disabled={added || busy}
                    onClick={async () => {
                      setBusyId(id);
                      try {
                        await addMod(bookmark.id, id, section.id);
                        onAdded();
                      } catch (e) {
setError(e instanceof Error ? e.message : String(e));
                      } finally {
                        setBusyId('');
                      }
                    }}
                    className="flex shrink-0 items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[11px] font-bold disabled:opacity-60"
                    style={added
                      ? { background: 'var(--color-surface)', color: 'var(--color-text-tertiary)', border: '1px solid var(--color-border)' }
                      : { background: 'var(--color-primary)', color: 'var(--color-primary-text)' }}>
                    {added ? <><Check className="h-3.5 w-3.5" />Есть</> : <><Plus className="h-3.5 w-3.5" />{busy ? '…' : 'Добавить'}</>}
                  </button>
                </div>
              );
            })}
          </div>
        </div>

        <footer className="flex items-center justify-between px-5 py-3" style={{ borderTop: '1px solid var(--color-border)' }}>
          <span className="text-[11px]" style={{ color: 'var(--color-text-tertiary)' }}>Найдено: {total}</span>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setPage(p => Math.max(0, p - 1))}
              disabled={page === 0 || loading}
              className="rounded-lg px-3 py-1 text-[11px] font-bold disabled:opacity-40"
              style={{ background: 'var(--color-surface-2)', color: 'var(--color-text-secondary)', border: '1px solid var(--color-border)' }}>
              Назад
            </button>
            <span className="text-[11px]" style={{ color: 'var(--color-text-secondary)' }}>{page + 1}</span>
            <button
              onClick={() => setPage(p => p + 1)}
              disabled={loading || (page + 1) * PAGE_SIZE >= total}
              className="rounded-lg px-3 py-1 text-[11px] font-bold disabled:opacity-40"
              style={{ background: 'var(--color-surface-2)', color: 'var(--color-text-secondary)', border: '1px solid var(--color-border)' }}>
              Вперёд
            </button>
          </div>
        </footer>
      </div>
    </div>
  );
}

export default BookmarkProjectPicker;
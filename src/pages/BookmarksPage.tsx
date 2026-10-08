import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Boxes, Check, ChevronLeft, ChevronRight, Info, Layers, Plus, Search,
  Trash2, TriangleAlert, X,
} from 'lucide-react';
import { useInstanceStore } from '@/stores/instanceStore';
import { invoke } from '@/lib/invoke-shim';
import { fetchMcVersionIds } from '@/lib/mc-versions';
import {
  useBookmarkStore, type Bookmark, type BookmarkModReport, type BookmarkCompatReport,
  type DeletedBookmark,
} from '@/stores/bookmarkStore';
import { BookmarkProjectPicker } from '@/components/bookmarks/BookmarkProjectPicker';

const LOADERS = [
  { id: 'fabric', label: 'Fabric' },
  { id: 'forge', label: 'Forge' },
  { id: 'quilt', label: 'Quilt' },
  { id: 'neoforge', label: 'NeoForge' },
  { id: 'vanilla', label: 'Ванильный' },
];

/** Сколько модов помещается на экране без прокрутки. Дальше — постранично. */
const PAGE_SIZE = 6;

export function BookmarksPage() {
  const {
    bookmarks, activeId, loading, report, reportLoading, applied, deleted,
    refresh, create, select, remove, checkCompatibility, apply, clearReport,
    refreshDeleted, restoreDeleted, purgeDeleted,
  } = useBookmarkStore();
  const instances = useInstanceStore(s => s.instances);
  const navigate = useNavigate();

  const [creating, setCreating] = useState(false);
  const [picking, setPicking] = useState(false);
  const [choosing, setChoosing] = useState(false);
  const [showDetails, setShowDetails] = useState(false);
  // Сборка, к которой считался отчёт. Хранится здесь, а не в отчёте: отчёт
  // описывает совместимость модов, а решение «применять» принимается здесь же.
  const [pendingInstance, setPendingInstance] = useState('');
  const [page, setPage] = useState(0);
  const [query, setQuery] = useState('');
  const [section, setSection] = useState('all');
  const [showDeleted, setShowDeleted] = useState(false);
  const [trashError, setTrashError] = useState('');

  useEffect(() => { void refresh(); void refreshDeleted(); }, [refresh, refreshDeleted]);

  const active = useMemo(
    () => bookmarks.find(b => b.id === activeId) ?? null,
    [bookmarks, activeId],
  );

  useEffect(() => {
    setPage(0);
    clearReport();
  }, [activeId, clearReport]);

  const SECTIONS = useMemo(() => {
    if (!active) return [];
    const kinds = [...new Set(active.mods.map(m => m.kind))];
    return [{ id: 'all', label: 'Все' }, ...kinds.map(k => ({ id: k, label: sectionLabel(k) }))];
  }, [active]);

  const filtered = useMemo(() => {
    if (!active) return [];
    const needle = query.trim().toLowerCase();
    return active.mods.filter(m => {
      if (section !== 'all' && m.kind !== section) return false;
      if (!needle) return true;
      return `${m.name} ${m.author ?? ''} ${m.file_name}`.toLowerCase().includes(needle);
    });
  }, [active, section, query]);

  const pages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(page, pages - 1);
  const visible = filtered.slice(safePage * PAGE_SIZE, safePage * PAGE_SIZE + PAGE_SIZE);

  if (!bookmarks.length && !loading) {
    return (
      <div className="h-full overflow-y-auto">
        <div className="mx-auto max-w-2xl px-6 py-16">
          <h1 className="text-xl font-black" style={{ color: 'var(--color-text)' }}>Закладки</h1>
          <p className="mt-2 text-sm" style={{ color: 'var(--color-text-secondary)' }}>
            Закладка — это набор модификаций под один загрузчик, который можно
            применять к сборке одной кнопкой. Сама она не запускается и хранит
            только моды.
          </p>
          <button
            onClick={() => setCreating(true)}
            className="mt-5 flex items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-bold"
            style={{ background: 'var(--color-primary)', color: 'var(--color-primary-text)' }}>
            <Plus className="h-4 w-4" />Создать закладку
          </button>
          {deleted.length > 0 && (
            <button
              onClick={() => setShowDeleted(true)}
              className="ml-2 mt-5 flex items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-bold"
              style={{ background: 'var(--color-surface-2)', color: 'var(--color-text)', border: '1px solid var(--color-border)' }}>
              <Trash2 className="h-4 w-4" />Удалённые · {deleted.length}
            </button>
          )}
        </div>
        {showDeleted && (
          <DeletedBookmarksPanel
            items={deleted}
            error={trashError}
            onError={setTrashError}
            onBack={() => setShowDeleted(false)}
            onRestore={restoreDeleted}
            onPurge={purgeDeleted}
          />
        )}
        {!showDeleted && creating && <CreateDialog onClose={() => setCreating(false)} onCreate={create} />}
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-4xl px-6 py-6">
        <div className="flex items-center justify-between gap-4">
          <h1 className="text-xl font-black" style={{ color: 'var(--color-text)' }}>Закладки</h1>
          <div className="flex items-center gap-2">
            {deleted.length > 0 && (
              <button
                onClick={() => setShowDeleted(s => !s)}
                className="flex items-center gap-1.5 rounded-xl px-3 py-2 text-xs font-bold"
                style={{
                  background: showDeleted ? 'var(--color-surface-active)' : 'var(--color-surface-2)',
                  color: showDeleted ? 'var(--color-text)' : 'var(--color-text-secondary)',
                  border: '1px solid var(--color-border)',
                }}>
                <Trash2 className="h-3.5 w-3.5" />Удалённые · {deleted.length}
              </button>
            )}
            <button
              onClick={() => setCreating(true)}
              disabled={showDeleted}
              className="flex items-center gap-1.5 rounded-xl px-3 py-2 text-xs font-bold disabled:opacity-40"
              style={{ background: 'var(--color-primary)', color: 'var(--color-primary-text)' }}>
              <Plus className="h-3.5 w-3.5" />Создать
            </button>
          </div>
        </div>

        {showDeleted ? (
          <DeletedBookmarksPanel
            items={deleted}
            error={trashError}
            onError={setTrashError}
            onBack={() => setShowDeleted(false)}
            onRestore={restoreDeleted}
            onPurge={purgeDeleted}
          />
        ) : (
        <div className="mt-4 grid gap-2 sm:grid-cols-2">
          {bookmarks.map(b => (
            <button
              key={b.id}
              onClick={() => select(b.id)}
              className="flex items-center gap-3 rounded-xl p-3 text-left"
              style={{
                background: b.id === activeId ? 'var(--color-primary-dim)' : 'var(--color-surface)',
                border: `1px solid ${b.id === activeId ? 'var(--color-primary)' : 'var(--color-border)'}`,
              }}>
              <Layers className="h-4 w-4 shrink-0" style={{ color: 'var(--color-text-secondary)' }} />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-bold" style={{ color: 'var(--color-text)' }}>{b.name}</span>
                <span className="block truncate text-[11px]" style={{ color: 'var(--color-text-tertiary)' }}>
                  {loaderLabel(b.loader)} · {b.mc_version || 'любая версия'} · {b.mods.length} мод.
                </span>
              </span>
            </button>
          ))}
        </div>
        )}
      </div>

      {active && !showDeleted && (
        <div className="mx-auto max-w-4xl px-6 pb-16">
          <div className="mt-6 flex flex-wrap items-end justify-between gap-3">
            <div>
              <h2 className="text-base font-black" style={{ color: 'var(--color-text)' }}>{active.name}</h2>
              <p className="mt-0.5 text-xs" style={{ color: 'var(--color-text-secondary)' }}>
                Версия: <span style={{ color: 'var(--color-text)' }}>{active.mc_version || 'любая'}</span>
                {' '}Лоадер: <span style={{ color: 'var(--color-text)' }}>{loaderLabel(active.loader)}{active.loader_version ? ' ' + active.loader_version : ''}</span>
              </p>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setPicking(true)}
                className="flex items-center gap-1.5 rounded-xl px-3 py-2 text-xs font-bold"
                style={{ background: 'var(--color-primary)', color: 'var(--color-primary-text)' }}>
                <Search className="h-3.5 w-3.5" />Найти проекты
              </button>
              <button
                onClick={() => { setChoosing(true); setPage(0); }}
                disabled={!active.mods.length || reportLoading}
                className="flex items-center gap-1.5 rounded-xl px-3 py-2 text-xs font-bold disabled:opacity-50"
                style={{ background: 'var(--color-surface-2)', color: 'var(--color-text)', border: '1px solid var(--color-border)' }}>
                <Boxes className="h-3.5 w-3.5" />Применить на сборку
              </button>
              <button
                onClick={() => { if (confirm(`Удалить закладку «${active.name}»?`)) void remove(active.id); }}
                className="flex h-8 w-8 items-center justify-center rounded-xl"
                style={{ background: 'var(--color-surface-2)', color: 'var(--color-error)', border: '1px solid var(--color-border)' }}
                title="Удалить закладку">
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>

          {applied && (
            <div className="mt-4 rounded-xl px-3 py-2.5 text-xs" style={{ background: 'var(--color-surface)', border: '1px solid var(--color-success)' }}>
              <span style={{ color: 'var(--color-text)' }}>Закладка применена.</span>
              <span style={{ color: 'var(--color-text-secondary)' }}>
                {' '}Установлено {applied.installed}
                {applied.skipped ? `, пропущено ${applied.skipped}` : ''}
                {applied.failed.length ? `, с ошибкой ${applied.failed.length}` : ''}.
              </span>
              {applied.failed.length > 0 && (
                <p className="mt-1" style={{ color: 'var(--color-error)' }}>{applied.failed.join('; ')}</p>
              )}
            </div>
          )}

          <div className="mt-5 flex items-center gap-3">
            <h3 className="text-sm font-bold" style={{ color: 'var(--color-text)' }}>Модификации</h3>
            <input
              value={query}
              onChange={e => { setQuery(e.target.value); setPage(0); }}
              placeholder="Поиск по названию или автору"
              className="flex-1 rounded-lg px-3 py-1.5 text-xs outline-none"
              style={{ background: 'var(--color-surface-2)', color: 'var(--color-text)', border: '1px solid var(--color-border)' }}
            />
          </div>

          {SECTIONS.length > 1 && (
            <div className="mt-2.5 flex flex-wrap gap-1.5">
              {SECTIONS.map(s => (
                <button
                  key={s.id}
                  onClick={() => { setSection(s.id); setPage(0); }}
                  className="rounded-lg px-2.5 py-1 text-[11px] font-bold"
                  style={{
                    background: section === s.id ? 'var(--color-surface-active)' : 'var(--color-surface-2)',
                    color: section === s.id ? 'var(--color-text)' : 'var(--color-text-secondary)',
                    border: `1px solid ${section === s.id ? 'var(--color-border-strong)' : 'var(--color-border)'}`,
                  }}>
                  {s.label}
                </button>
              ))}
            </div>
          )}

          <div className="mt-3 space-y-2">
            {visible.length === 0 && (
              <p className="py-6 text-center text-xs" style={{ color: 'var(--color-text-tertiary)' }}>
                {active.mods.length === 0 ? 'В закладке пока нет модификаций.' : 'Ничего не найдено.'}
              </p>
            )}
            {visible.map(m => (
              <ModRow
                key={`${m.project_id}:${m.file_name}`}
                mod={m}
                onRemove={() => void useBookmarkStore.getState().removeMod(active.id, m.project_id)}
              />
            ))}
          </div>

          {pages > 1 && (
            <div className="mt-4 flex items-center justify-center gap-2">
              <button
                onClick={() => setPage(p => Math.max(0, p - 1))}
                disabled={safePage === 0}
                className="flex h-8 w-8 items-center justify-center rounded-lg disabled:opacity-40"
                style={{ background: 'var(--color-surface-2)', border: '1px solid var(--color-border)', color: 'var(--color-text)' }}>
                <ChevronLeft className="h-4 w-4" />
              </button>
              <span className="text-xs" style={{ color: 'var(--color-text-secondary)' }}>
                {safePage + 1} из {pages}
              </span>
              <button
                onClick={() => setPage(p => Math.min(pages - 1, p + 1))}
                disabled={safePage >= pages - 1}
                className="flex h-8 w-8 items-center justify-center rounded-lg disabled:opacity-40"
                style={{ background: 'var(--color-surface-2)', border: '1px solid var(--color-border)', color: 'var(--color-text)' }}>
                <ChevronRight className="h-4 w-4" />
              </button>
            </div>
          )}
        </div>
      )}

      {creating && !showDeleted && <CreateDialog onClose={() => setCreating(false)} onCreate={create} />}

      {picking && active && (
        <BookmarkProjectPicker
          bookmark={active}
          onClose={() => setPicking(false)}
          onAdded={() => void refresh()}
        />
      )}

      {choosing && active && (
        <InstancePicker
          instances={instances}
          busy={reportLoading}
          onClose={() => setChoosing(false)}
          onPick={async instance => {
            const r = await checkCompatibility(active.id, instance.id);
            setChoosing(false);
            if (!r) return;
            if (r.exact_match) {
              void apply(active.id, instance.id, false);
            } else {
              setPendingInstance(instance.id);
            }
          }}
        />
      )}

      {report && active && (
        <ConfirmDialog
          report={report}
          onClose={() => { setPendingInstance(''); clearReport(); }}
          onDetails={() => setShowDetails(true)}
          onApplyAnyway={() => {
            const target = pendingInstance;
            setShowDetails(false);
            setPendingInstance('');
            clearReport();
            void apply(active.id, target, true);
          }}
        />
      )}

      {showDetails && report && (
        <DetailsDialog
          mods={report.mods.filter(m => !m.compatible)}
          onClose={() => setShowDetails(false)}
        />
      )}
    </div>
  );
}

function sectionLabel(kind: string): string {
  switch (kind) {
    case 'resourcepack': return 'Наборы ресурсов';
    case 'shaderpack': return 'Шейдеры';
    case 'datapack': return 'Дата-паки';
    default: return 'Модификации';
  }
}

function loaderLabel(id: string): string {
  return LOADERS.find(l => l.id === id)?.label ?? id;
}

/**
 * Корзина закладок. Папка не стирается сразу, а переезжает в recovery, поэтому
 * восстановление возможно. Ошибки показываем строкой, а не модалкой: список
 * может обновиться после клика, и молчание выглядело бы как баг.
 */
function DeletedBookmarksPanel({ items, error, onError, onBack, onRestore, onPurge }: {
  items: DeletedBookmark[];
  error: string;
  onError: (value: string) => void;
  onBack: () => void;
  onRestore: (id: string) => Promise<void>;
  onPurge: (id: string) => Promise<void>;
}) {
  const [busy, setBusy] = useState('');

  const run = async (id: string, action: (value: string) => Promise<void>, fallback: string) => {
    setBusy(id);
    onError('');
    try {
      await action(id);
    } catch (e) {
      onError(e instanceof Error && e.message ? e.message : fallback);
    } finally {
      setBusy('');
    }
  };

  return (
    <div className="mt-5">
      <div className="flex items-center gap-2">
        <button
          onClick={onBack}
          className="flex h-8 w-8 items-center justify-center rounded-lg"
          style={{ background: 'var(--color-surface-2)', border: '1px solid var(--color-border)', color: 'var(--color-text)' }}
          title="Назад к закладкам">
          <ChevronLeft className="h-4 w-4" />
        </button>
        <h2 className="text-base font-black" style={{ color: 'var(--color-text)' }}>Удалённые закладки</h2>
      </div>

      {error && (
        <p className="mt-3 text-xs" style={{ color: 'var(--color-error)' }}>{error}</p>
      )}

      {items.length === 0 ? (
        <p className="py-10 text-center text-xs" style={{ color: 'var(--color-text-tertiary)' }}>
          Удалённых закладок нет.
        </p>
      ) : (
        <div className="mt-3">
          {items.map((item, index) => (
            <div
              key={item.id}
              className="flex items-center gap-3 py-3"
              style={{ borderBottom: index < items.length - 1 ? '1px solid var(--color-border)' : 'none' }}>
              <Layers className="h-4 w-4 shrink-0" style={{ color: 'var(--color-text-tertiary)' }} />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-bold" style={{ color: 'var(--color-text)' }}>{item.name}</span>
                <span className="block truncate text-[11px]" style={{ color: 'var(--color-text-tertiary)' }}>
                  {loaderLabel(item.loader)} · {item.mc_version || 'любая версия'} · {item.mods} мод.
                  {item.deleted_at ? ` · ${new Date(item.deleted_at).toLocaleString()}` : ''}
                </span>
              </span>
              <button
                onClick={() => void run(item.id, onRestore, 'Не удалось восстановить закладку')}
                disabled={busy === item.id}
                className="rounded-xl px-3 py-2 text-xs font-bold disabled:opacity-50"
                style={{ background: 'var(--color-primary)', color: 'var(--color-primary-text)' }}>
                Восстановить
              </button>
              <button
                onClick={() => {
                  if (confirm(`Удалить закладку «${item.name}» без возможности восстановления?`)) {
                    void run(item.id, onPurge, 'Не удалось удалить закладку');
                  }
                }}
                disabled={busy === item.id}
                className="flex h-8 w-8 items-center justify-center rounded-xl disabled:opacity-50"
                style={{ background: 'var(--color-surface-2)', color: 'var(--color-error)', border: '1px solid var(--color-border)' }}
                title="Удалить безвозвратно">
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function ModRow({ mod, onRemove }: { mod: Bookmark['mods'][number]; onRemove: () => void }) {
  return (
    <div className="flex items-center gap-3 rounded-xl p-3" style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)' }}>
      <div className="flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-lg" style={{ background: 'var(--color-surface-2)' }}>
        {mod.icon_url
          ? <img src={mod.icon_url} alt="" className="h-full w-full object-cover" />
          : <Layers className="h-4 w-4" style={{ color: 'var(--color-text-tertiary)' }} />}
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-bold" style={{ color: 'var(--color-text)' }}>{mod.name}</p>
        <p className="truncate text-[11px]" style={{ color: 'var(--color-text-secondary)' }}>
          {mod.author || 'Автор не указан'} · {sectionLabel(mod.kind)}
          {mod.mc_version ? ` · ${mod.mc_version}` : ''}
        </p>
        <p className="truncate text-[10px]" style={{ color: 'var(--color-text-tertiary)' }}>{mod.file_name}</p>
      </div>
      <button
        onClick={onRemove}
        className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg"
        style={{ color: 'var(--color-text-tertiary)' }}
        title="Убрать из закладки">
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}

function CreateDialog({ onClose, onCreate }: {
  onClose: () => void;
  onCreate: (name: string, loader: string, mcVersion: string, loaderVersion: string) => Promise<unknown>;
}) {
  const [name, setName] = useState('');
  const [loader, setLoader] = useState('fabric');
  const [mcVersion, setMcVersion] = useState('');
  const [loaderVersion, setLoaderVersion] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  // Списки тянутся теми же командами, что и при создании сборки, иначе
  // набор версий в закладке и в сборке разошлись бы.
  const [mcVersions, setMcVersions] = useState<string[]>([]);
  const [showSnapshots, setShowSnapshots] = useState(false);
  const [loaderVersions, setLoaderVersions] = useState<string[]>([]);
  const [loaderVersionsBusy, setLoaderVersionsBusy] = useState(false);

  useEffect(() => {
    let alive = true;
    void invoke<boolean>('should_show_snapshots').then(v => { if (alive) setShowSnapshots(Boolean(v)); }).catch(() => {});
    void fetchMcVersionIds(false).then(list => { if (alive) setMcVersions(list); }).catch(() => {});
    return () => { alive = false; };
  }, []);

  useEffect(() => {
    if (!showSnapshots) {
      void fetchMcVersionIds(false).then(list => setMcVersions(prev => prev.length ? prev : list)).catch(() => {});
    }
  }, [showSnapshots]);

  // Версии загрузчика зависят от его вида и версии Minecraft.
  useEffect(() => {
    if (!loader || loader === 'vanilla') { setLoaderVersions([]); return; }
    let alive = true;
    setLoaderVersionsBusy(true);
    setLoaderVersion('');
    const command =
      loader === 'fabric' ? 'get_fabric_versions'
        : loader === 'neoforge' ? 'get_neoforge_versions'
          : loader === 'quilt' ? 'get_quilt_versions'
            : loader === 'forge' ? 'get_forge_versions'
              : null;
    if (!command) { setLoaderVersionsBusy(false); return () => { alive = false; }; }
    void invoke<any>(command, { mcVersion: mcVersion || undefined })
      .then(raw => {
        if (!alive) return;
        const list = (Array.isArray(raw) ? raw : [])
          .map((v: any) => (typeof v === 'string' ? v : v?.loader?.version ?? v?.version))
          .filter((v: any): v is string => typeof v === 'string' && v.length > 0);
        setLoaderVersions([...new Set(list)].slice(0, 80));
      })
      .catch(() => { if (alive) setLoaderVersions([]); })
      .finally(() => { if (alive) setLoaderVersionsBusy(false); });
    return () => { alive = false; };
  }, [loader, mcVersion]);

  const snapshot = (v: string) => /[a-zA-Z]/.test(v.replace(/\./g, ''));

  return (
    <Overlay onClose={onClose}>
      <div className="max-h-[85vh] w-full max-w-md overflow-y-auto rounded-2xl p-5"
        style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)' }}>
        <h3 className="text-base font-black" style={{ color: 'var(--color-text)' }}>Новая закладка</h3>
        <Field label="Название">
          <input
            value={name} onChange={e => setName(e.target.value)} placeholder="Оптимизация для RTX" autoFocus
            className="w-full rounded-lg px-3 py-2 text-sm outline-none"
            style={{ background: 'var(--color-surface-2)', color: 'var(--color-text)', border: '1px solid var(--color-border)' }} />
        </Field>
        <Field label="Загрузчик" hint="обязательно">
          <div className="flex flex-wrap gap-1.5">
            {LOADERS.map(l => (
              <button key={l.id} onClick={() => setLoader(l.id)} className="rounded-lg px-3 py-1.5 text-xs font-bold"
                style={{
                  background: loader === l.id ? 'var(--color-primary)' : 'var(--color-surface-2)',
                  color: loader === l.id ? 'var(--color-primary-text)' : 'var(--color-text-secondary)',
                  border: '1px solid var(--color-border)',
                }}>
                {l.label}
              </button>
            ))}
          </div>
        </Field>
        <Field label="Версия Minecraft" hint="необязательно — если пусто, берутся любые версии">
          <select
            value={mcVersion} onChange={e => { setMcVersion(e.target.value); setLoaderVersion(''); }}
            className="w-full rounded-lg px-3 py-2 text-sm outline-none"
            style={{ background: 'var(--color-surface-2)', color: 'var(--color-text)', border: '1px solid var(--color-border)' }}>
            <option value="">Любая</option>
            {mcVersions.map(v => <option key={v} value={v}>{v}</option>)}
          </select>
          <label className="mt-2 flex items-center gap-2 text-[11px]" style={{ color: 'var(--color-text-secondary)' }}>
            <input type="checkbox" checked={showSnapshots} onChange={e => {
              setShowSnapshots(e.target.checked);
              void fetchMcVersionIds(e.target.checked).then(setMcVersions).catch(() => {});
            }} />
            Показывать снапшоты
          </label>
        </Field>
        <Field label="Версия загрузчика" hint={loaderVersionsBusy ? 'загрузка…' : 'необязательно'}>
          {loader === 'vanilla' || !loader ? (
            <p className="text-[11px]" style={{ color: 'var(--color-text-tertiary)' }}>У ванильного загрузчика нет версий.</p>
          ) : loaderVersions.length === 0 ? (
            <p className="text-[11px]" style={{ color: 'var(--color-text-tertiary)' }}>
              {!mcVersion ? 'Сначала выберите версию Minecraft.' : 'Список пуст — можно создать и без неё.'}
            </p>
          ) : (
            <select
              value={loaderVersion} onChange={e => setLoaderVersion(e.target.value)}
              className="w-full rounded-lg px-3 py-2 text-sm outline-none"
              style={{ background: 'var(--color-surface-2)', color: 'var(--color-text)', border: '1px solid var(--color-border)' }}>
              <option value="">Любая</option>
              {loaderVersions.map(v => <option key={v} value={v}>{v}</option>)}
            </select>
          )}
        </Field>
        {error && <p className="text-xs" style={{ color: 'var(--color-error)' }}>{error}</p>}
        <div className="mt-4 flex justify-end gap-2">
          <button onClick={onClose} className="rounded-xl px-3.5 py-2 text-xs font-bold"
            style={{ background: 'var(--color-surface-2)', color: 'var(--color-text-secondary)', border: '1px solid var(--color-border)' }}>
            Отмена
          </button>
          <button
            disabled={busy}
            onClick={async () => {
              setBusy(true); setError('');
              try {
                await onCreate(name, loader, mcVersion, loaderVersion);
                onClose();
              } catch (e) {
                setError(e instanceof Error ? e.message : String(e));
              } finally { setBusy(false); }
            }}
            className="flex items-center gap-1.5 rounded-xl px-3.5 py-2 text-xs font-bold disabled:opacity-60"
            style={{ background: 'var(--color-primary)', color: 'var(--color-primary-text)' }}>
            <Check className="h-3.5 w-3.5" />Создать
          </button>
        </div>
      </div>
    </Overlay>
  );
}

function InstancePicker({ instances, busy, onClose, onPick }: {
  instances: { id: string; name: string; modLoader?: string; minecraftVersion?: string }[];
  busy: boolean;
  onClose: () => void;
  onPick: (instance: { id: string }) => void;
}) {
  return (
    <Overlay onClose={onClose}>
      <div className="max-h-[70vh] w-full max-w-lg overflow-y-auto rounded-2xl p-5" style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)' }}>
        <h3 className="text-base font-black" style={{ color: 'var(--color-text)' }}>Выберите сборку</h3>
        {instances.length === 0 ? (
          <p className="mt-3 text-xs" style={{ color: 'var(--color-text-tertiary)' }}>Сборок пока нет.</p>
        ) : (
          <div className="mt-3 space-y-1.5">
            {instances.map(inst => (
              <button
                key={inst.id}
                disabled={busy}
                onClick={() => onPick(inst)}
                className="flex w-full items-center gap-3 rounded-xl p-3 text-left disabled:opacity-50"
                style={{ background: 'var(--color-surface-2)', border: '1px solid var(--color-border)' }}>
                <Boxes className="h-4 w-4 shrink-0" style={{ color: 'var(--color-text-tertiary)' }} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-bold" style={{ color: 'var(--color-text)' }}>{inst.name}</span>
                  <span className="block truncate text-[11px]" style={{ color: 'var(--color-text-tertiary)' }}>
                    {inst.minecraftVersion || '—'} · {inst.modLoader || '—'}
                  </span>
                </span>
              </button>
            ))}
          </div>
        )}
      </div>
    </Overlay>
  );
}

/**
 * Подтверждение перед применением к несовместимой сборке. Показывает ровно то,
 * что не встанет, и даёт посмотреть детали по каждому моду.
 */
function ConfirmDialog({ report, onClose, onDetails, onApplyAnyway }: {
  report: BookmarkCompatReport;
  onClose: () => void;
  onDetails: () => void;
  onApplyAnyway: () => void;
}) {
  const bad = report.mods.filter(m => !m.compatible);
  const mismatch = [
    !report.loader_match && 'загрузчик',
    !report.version_match && 'версия Minecraft',
  ].filter(Boolean).join(' и ');

  return (
    <Overlay onClose={onClose}>
      <div className="w-full max-w-lg rounded-2xl p-5" style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)' }}>
        <div className="flex items-start gap-3">
          <TriangleAlert className="mt-0.5 h-5 w-5 shrink-0" style={{ color: 'var(--color-warning)' }} />
          <div className="min-w-0">
            <h3 className="text-base font-black" style={{ color: 'var(--color-text)' }}>
              Закладка не подходит этой сборке
            </h3>
            <p className="mt-1 text-xs" style={{ color: 'var(--color-text-secondary)' }}>
              Сборка на {report.loader} {report.mc_version}. Закладка сделана под
              {' '}{loaderLabel(report.loader) === report.loader ? report.loader : report.loader}
              {mismatch ? ` — не совпадает ${mismatch}` : ''}.
            </p>
          </div>
        </div>

        <p className="mt-3 text-sm" style={{ color: 'var(--color-text)' }}>
          Встанет {report.compatible} из {report.total}.
          {report.incompatible > 0 && (
            <span style={{ color: 'var(--color-warning)' }}> Не установятся: {report.incompatible}.</span>
          )}
        </p>

        {bad.length > 0 && (
          <>
            <ul className="mt-2 max-h-40 space-y-1 overflow-y-auto">
              {bad.map(m => (
                <li key={m.project_id} className="flex items-center justify-between gap-2 rounded-lg px-2.5 py-1.5 text-[11px]"
                    style={{ background: 'var(--color-surface-2)', color: 'var(--color-text-secondary)' }}>
                  <span className="truncate">{m.name}</span>
                  <span className="shrink-0" style={{ color: 'var(--color-text-tertiary)' }}>{m.reason}</span>
                </li>
              ))}
            </ul>
            <button
              onClick={onDetails}
              className="mt-2 flex items-center gap-1.5 text-xs font-bold"
              style={{ color: 'var(--color-primary)' }}>
              <Info className="h-3.5 w-3.5" />Подробнее
            </button>
          </>
        )}

        <div className="mt-4 flex justify-end gap-2">
          <button onClick={onClose} className="rounded-xl px-3.5 py-2 text-xs font-bold" style={{ background: 'var(--color-surface-2)', color: 'var(--color-text-secondary)', border: '1px solid var(--color-border)' }}>
            Отмена
          </button>
          <button
            onClick={onApplyAnyway}
            className="rounded-xl px-3.5 py-2 text-xs font-bold"
            style={{ background: 'var(--color-warning)', color: '#000' }}>
            Установить всё равно
          </button>
        </div>
      </div>
    </Overlay>
  );
}

function DetailsDialog({ mods, onClose }: { mods: BookmarkModReport[]; onClose: () => void }) {
  return (
    <Overlay onClose={onClose}>
      <div className="max-h-[70vh] w-full max-w-xl overflow-y-auto rounded-2xl p-5" style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)' }}>
        <h3 className="text-base font-black" style={{ color: 'var(--color-text)' }}>Не установятся</h3>
        <div className="mt-3 space-y-2">
          {mods.map(m => (
            <div key={m.project_id} className="flex gap-3 rounded-xl p-3" style={{ background: 'var(--color-surface-2)', border: '1px solid var(--color-border)' }}>
              <div className="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-lg" style={{ background: 'var(--color-surface)' }}>
                {m.icon_url
                  ? <img src={m.icon_url} alt="" className="h-full w-full object-cover" />
                  : <Layers className="h-4 w-4" style={{ color: 'var(--color-text-tertiary)' }} />}
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-bold" style={{ color: 'var(--color-text)' }}>{m.name}</p>
                <p className="truncate text-[11px]" style={{ color: 'var(--color-text-secondary)' }}>
                  {m.author || 'Автор не указан'} · {sectionLabel(m.kind)} · Modrinth
                </p>
                {m.description && (
                  <p className="mt-1 line-clamp-3 text-[11px]" style={{ color: 'var(--color-text-tertiary)' }}>{m.description}</p>
                )}
                <p className="mt-1 text-[10px]" style={{ color: 'var(--color-warning)' }}>
                  Версия в закладке: {m.bookmark_version || 'любая'} — {m.reason}
                </p>
              </div>
            </div>
          ))}
        </div>
        <div className="mt-4 flex justify-end">
          <button onClick={onClose} className="rounded-xl px-3.5 py-2 text-xs font-bold" style={{ background: 'var(--color-surface-2)', color: 'var(--color-text-secondary)', border: '1px solid var(--color-border)' }}>
            Закрыть
          </button>
        </div>
      </div>
    </Overlay>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="mt-3">
      <p className="mb-1.5 text-[11px] font-bold uppercase tracking-wide" style={{ color: 'var(--color-text-tertiary)' }}>
        {label}
        {hint && <span className="ml-1.5 normal-case" style={{ color: 'var(--color-text-tertiary)' }}>— {hint}</span>}
      </p>
      {children}
    </div>
  );
}

function Overlay({ children, onClose }: { children: React.ReactNode; onClose: () => void }) {
  return (
    <div
      className="fixed inset-0 z-[170] flex items-center justify-center p-4"
      style={{ background: 'rgba(0,0,0,0.7)' }}
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      {children}
    </div>
  );
}

export default BookmarksPage;



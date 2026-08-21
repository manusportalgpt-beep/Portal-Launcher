import { useEffect, useMemo, useState } from 'react';
import { ChevronDown, ChevronLeft, ChevronRight, ChevronUp, Compass, Home, Library, RotateCcw, Save, Server, Settings, User, X } from 'lucide-react';
import { useUiStore } from '@/stores/uiStore';

const NAV_ITEMS = [
  { id: 'home', label: 'Главная', Icon: Home },
  { id: 'discover', label: 'Поиск', Icon: Compass },
  { id: 'skins', label: 'Скины', Icon: User },
  { id: 'library', label: 'Библиотека', Icon: Library },
  { id: 'hosting', label: 'Хостинг', Icon: Server },
];

type Draft = {
  navItemOrder: string[];
  navHoverMs: number;
  notchWidth: number;
  sidebarWidth: number;
  navItemScale: number;
  navInstanceCount: number;
  panelVersion: 'old' | 'new';
};

export function NavigationPanelEditor() {
  const ui = useUiStore();
  // The Appearance page should remain calm on entry. The editor opens only when
  // the user intentionally clicks its header.
  const [open, setOpen] = useState(false);
  const snapshot = useMemo<Draft>(() => ({
    navItemOrder: ui.navItemOrder,
    navHoverMs: ui.navHoverMs,
    notchWidth: ui.notchWidth,
    sidebarWidth: ui.sidebarWidth,
    navItemScale: ui.navItemScale,
    navInstanceCount: ui.navInstanceCount,
    panelVersion: ui.panelVersion,
  }), [ui.navItemOrder, ui.navHoverMs, ui.notchWidth, ui.sidebarWidth, ui.navItemScale, ui.navInstanceCount, ui.panelVersion]);
  const [draft, setDraft] = useState<Draft>(snapshot);

  useEffect(() => { if (!open) setDraft(snapshot); }, [open, snapshot]);

  const move = (index: number, direction: -1 | 1) => {
    const next = [...draft.navItemOrder];
    const target = index + direction;
    if (target < 0 || target >= next.length) return;
    [next[index], next[target]] = [next[target], next[index]];
    setDraft(value => ({ ...value, navItemOrder: next }));
  };

  const save = () => {
    ui.set('navItemOrder', draft.navItemOrder);
    ui.set('navHoverMs', draft.navHoverMs);
    ui.set('notchWidth', draft.notchWidth);
    ui.set('sidebarWidth', draft.sidebarWidth);
    ui.set('navItemScale', draft.navItemScale);
    ui.set('navInstanceCount', draft.navInstanceCount);
    ui.set('panelVersion', draft.panelVersion);
    setOpen(false);
  };

  const setNumber = (key: keyof Omit<Draft, 'navItemOrder'>, value: number) => setDraft(current => ({ ...current, [key]: value }));
  const isNotch = ui.navMode === 'notch';
  const orderedItems = draft.navItemOrder.map(id => NAV_ITEMS.find(item => item.id === id)).filter(Boolean) as typeof NAV_ITEMS;

  return (
    <div className="mt-3 rounded-md" style={{ border: '1px solid var(--color-border)', background: 'transparent' }}>
      <button onClick={() => setOpen(value => !value)} className="flex w-full items-center justify-between px-3.5 py-3 text-left">
        <span>
          <span className="block text-sm font-bold" style={{ color: 'var(--color-text)' }}>{isNotch ? 'Редактор Notch-панели' : 'Редактор боковой панели'}</span>
          <span className="block text-[11px]" style={{ color: 'var(--color-text-secondary)' }}>Порядок иконок, hover-анимация, лимит сборок, размер и предпросмотр</span>
        </span>
        {open ? <ChevronUp className="h-4 w-4" style={{ color: 'var(--color-primary)' }} /> : <ChevronDown className="h-4 w-4" style={{ color: 'var(--color-text-secondary)' }} />}
      </button>

      {open && (
        <div className="p-3.5">
          <div className="mb-3 p-1" style={{ background: 'transparent', border: '0' }}>
            <div className="mb-2 flex items-center justify-between gap-2"><p className="text-[10px] font-black uppercase tracking-wide" style={{ color: 'var(--color-text-tertiary)' }}>Предпросмотр</p><div className="flex overflow-hidden rounded-lg" style={{ border: '1px solid var(--color-border)' }}>{(['old', 'new'] as const).map(version => <button key={version} onClick={() => setDraft(current => ({ ...current, panelVersion: version }))} className="px-2 py-1 text-[10px] font-bold" style={{ background: draft.panelVersion === version ? 'var(--color-primary)' : 'var(--color-surface-2)', color: draft.panelVersion === version ? 'var(--color-primary-text)' : 'var(--color-text-secondary)' }}>{version === 'old' ? 'Старый интерфейс' : 'Новый интерфейс'}</button>)}</div></div>
            {isNotch ? (
              <div className="mx-auto flex items-center justify-center gap-1 rounded-sm px-1.5 py-1" style={{ width: `${draft.notchWidth}%`, maxWidth: '100%', background: 'var(--color-surface)', border: '1px solid var(--color-border)', boxShadow:'none', backdropFilter:'none' }}>
                {orderedItems.map(({ id, Icon }) => <span key={id} className="flex items-center justify-center rounded-lg" style={{ width: 30 * draft.navItemScale / 100, height: 28 * draft.navItemScale / 100, color: 'var(--color-primary)' }}><Icon size={14 * draft.navItemScale / 100} /></span>)}
                <span className="mx-0.5 h-5 w-px" style={{ background: 'var(--color-border)' }} />
                <Settings size={14} style={{ color: 'var(--color-text-secondary)' }} />
                <ChevronLeft size={13} style={{ color: 'var(--color-text-secondary)' }} />
                <ChevronRight size={13} style={{ color: 'var(--color-text-secondary)' }} />
              </div>
            ) : (
              <div className="flex min-h-[116px] items-start" style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-sm)', boxShadow:'none' }}>
                <div className="flex flex-col items-center gap-1 py-2" style={{ width: draft.sidebarWidth, borderRight: '0' }}>
                  {orderedItems.map(({ id, Icon }) => <span key={id} className="flex items-center justify-center rounded-lg" style={{ width: 30 * draft.navItemScale / 100, height: 28 * draft.navItemScale / 100, color: 'var(--color-primary)' }}><Icon size={14 * draft.navItemScale / 100} /></span>)}
                </div>
                <span className="p-3 text-[10px]" style={{ color: 'var(--color-text-secondary)' }}>Содержимое Portal Launcher</span>
              </div>
            )}
          </div>

          <p className="mb-2 text-[10px] font-black uppercase tracking-wide" style={{ color: 'var(--color-text-tertiary)' }}>Порядок иконок</p>
          <div className="mb-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
            {orderedItems.map(({ id, label, Icon }, index) => (
              <div key={id} className="flex items-center gap-1 rounded-sm p-1.5" style={{ background: 'transparent', border: '1px solid var(--color-border)' }}>
                <Icon className="h-3.5 w-3.5" style={{ color: 'var(--color-primary)' }} />
                <span className="min-w-0 flex-1 truncate text-[10px] font-bold" style={{ color: 'var(--color-text)' }}>{label}</span>
                <div className="flex flex-col">
                  <button onClick={() => move(index, -1)} disabled={index === 0} className="disabled:opacity-25"><ChevronUp className="h-3 w-3" /></button>
                  <button onClick={() => move(index, 1)} disabled={index === orderedItems.length - 1} className="disabled:opacity-25"><ChevronDown className="h-3 w-3" /></button>
                </div>
              </div>
            ))}
          </div>

          <div className="grid gap-2 sm:grid-cols-2">
            <Range label="Анимация наведения" value={draft.navHoverMs} min={80} max={700} step={20} unit=" мс" onChange={value => setNumber('navHoverMs', value)} />
            <Range label="Размер иконок" value={draft.navItemScale} min={75} max={155} step={5} unit="%" onChange={value => setNumber('navItemScale', value)} />
            <Range label="Иконки сборок в панели" value={draft.navInstanceCount} min={0} max={16} step={1} unit="" onChange={value => setNumber('navInstanceCount', value)} />
            {isNotch
              ? <Range label="Ширина Notch-панели" value={draft.notchWidth} min={38} max={100} step={2} unit="%" onChange={value => setNumber('notchWidth', value)} />
              : <Range label="Ширина боковой панели" value={draft.sidebarWidth} min={48} max={168} step={4} unit=" px" onChange={value => setNumber('sidebarWidth', value)} />}
          </div>

          <div className="mt-3 flex justify-end gap-2">
            <button onClick={() => { setDraft(snapshot); setOpen(false); }} className="flex items-center gap-1.5 rounded-sm px-3 py-2 text-xs font-bold" style={{ color: 'var(--color-text-secondary)', border: '1px solid var(--color-border)' }}><X className="h-3.5 w-3.5" />Отменить</button>
            <button onClick={() => setDraft({ ...snapshot, navItemOrder: ['home', 'discover', 'skins', 'library', 'hosting'] })} className="flex items-center gap-1.5 rounded-sm px-3 py-2 text-xs font-bold" style={{ color: 'var(--color-text-secondary)', border: '1px solid var(--color-border)' }}><RotateCcw className="h-3.5 w-3.5" />Сбросить</button>
            <button onClick={save} className="flex items-center gap-1.5 rounded-sm px-3 py-2 text-xs font-bold" style={{ background: 'var(--color-primary)', color: 'var(--color-primary-text)' }}><Save className="h-3.5 w-3.5" />Сохранить</button>
          </div>
        </div>
      )}
    </div>
  );
}

function Range({ label, value, min, max, step, unit, onChange }: { label: string; value: number; min: number; max: number; step: number; unit: string; onChange: (value: number) => void }) {
  return <label className="rounded-sm p-2.5" style={{ background: 'transparent', border: '1px solid var(--color-border)' }}>
    <span className="mb-1.5 flex items-center justify-between text-[10px] font-bold" style={{ color: 'var(--color-text)' }}><span>{label}</span><span style={{ color: 'var(--color-primary)' }}>{value}{unit}</span></span>
    <input className="w-full accent-current" style={{ accentColor: 'var(--color-primary)' }} type="range" value={value} min={min} max={max} step={step} onChange={event => onChange(Number(event.target.value))} />
  </label>;
}

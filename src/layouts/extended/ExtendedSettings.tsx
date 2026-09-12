import { useState } from 'react';
import { motion } from 'framer-motion';
import { useNavigate } from 'react-router-dom';
import { ChevronLeft, ArrowUp, ArrowDown, RotateCcw, Palette, LayoutGrid } from 'lucide-react';
import { useLayoutStore, type LayoutMode } from '@/stores/layoutStore';

const PRESET_ACCENTS = ['#DA2A3F', '#4299E1', '#10B981', '#F59E0B', '#8B5CF6', '#EC4899', '#14B8A6', '#F97316'];

const NAV_LABELS: Record<string, string> = {
  home: 'Главная',
  discover: 'Обзор',
  library: 'Библиотека',
  skins: 'Скины',
  settings: 'Настройки',
};

export function ExtendedSettings() {
  const navigate = useNavigate();
  const { mode, setMode, extended, updateExtended } = useLayoutStore();
  const [customAccent, setCustomAccent] = useState('');

  const applyAccent = (c: string) => {
    updateExtended({ colorAccent: c });
    setCustomAccent('');
  };

  const move = (key: string, dir: -1 | 1) => {
    const list = [...extended.sidebarOrder];
    const idx = list.indexOf(key);
    if (idx < 0) return;
    const target = idx + dir;
    if (target < 0 || target >= list.length) return;
    [list[idx], list[target]] = [list[target], list[idx]];
    updateExtended({ sidebarOrder: list });
  };

  return (
    <div className="h-full overflow-auto p-6">
      <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }} className="max-w-xl mx-auto">
        <button onClick={() => navigate(-1)} className="flex items-center gap-1.5 mb-5 text-[11px] font-semibold transition-colors hover:opacity-80"
          style={{ color: 'var(--color-text-secondary)' }}>
          <ChevronLeft size={14} /> Назад
        </button>

        <div className="flex items-center gap-3 mb-6">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl" style={{ background: 'color-mix(in srgb, var(--color-primary) 14%, transparent)', color: 'var(--color-primary)' }}>
            <Palette size={18} />
          </div>
          <div>
            <h1 className="text-lg font-extrabold" style={{ color: 'var(--color-text)' }}>Расширенный интерфейс</h1>
            <p className="text-[11px]" style={{ color: 'var(--color-text-secondary)' }}>Настройте иконки, порядок и акцент стандартного интерфейса</p>
          </div>
        </div>

        {/* режим */}
        <div className="mb-6 flex gap-2">
          {(['standard', 'innovative', 'extended'] as LayoutMode[]).map(m => (
            <button key={m} onClick={() => setMode(m)}
              className="flex-1 rounded-xl px-3 py-2.5 text-[12px] font-bold transition-all"
              style={{
                background: mode === m ? 'var(--color-primary)' : 'var(--color-surface-2)',
                color: mode === m ? 'var(--color-primary-text)' : 'var(--color-text-secondary)',
                border: `1px solid ${mode === m ? 'var(--color-primary)' : 'var(--color-border)'}`,
              }}>
              {m === 'standard' ? 'Стандартный' : m === 'innovative' ? 'Инновационный' : 'Расширенный'}
            </button>
          ))}
        </div>

        {/* акцент */}
        <div className="rounded-2xl p-5" style={{ background: 'var(--color-surface-2)', border: '1px solid var(--color-border)' }}>
          <div className="flex items-center gap-2 mb-3">
            <LayoutGrid size={15} style={{ color: 'var(--color-primary)' }} />
            <p className="text-[12px] font-bold" style={{ color: 'var(--color-text)' }}>Акцентный цвет</p>
          </div>
          <div className="flex flex-wrap gap-2">
            {PRESET_ACCENTS.map(c => (
              <button key={c} onClick={() => applyAccent(c)}
                className="h-8 w-8 rounded-full transition-transform hover:scale-110"
                style={{ background: c, border: extended.colorAccent === c ? '2px solid var(--color-text)' : '2px solid transparent' }} />
            ))}
          </div>
          <div className="mt-3 flex gap-2">
            <input value={customAccent} onChange={e => setCustomAccent(e.target.value)} placeholder="#DA2A3F"
              className="w-28 rounded-lg px-3 py-2 text-[11px] font-mono outline-none"
              style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', color: 'var(--color-text)' }} />
            <button onClick={() => /^#[0-9a-fA-F]{6}$/.test(customAccent) && applyAccent(customAccent)}
              className="rounded-lg px-3 py-2 text-[11px] font-bold"
              style={{ background: 'var(--color-primary)', color: 'var(--color-primary-text)' }}>
              Применить
            </button>
          </div>
        </div>

        {/* порядок иконок */}
        <div className="mt-4 rounded-2xl p-5" style={{ background: 'var(--color-surface-2)', border: '1px solid var(--color-border)' }}>
          <p className="text-[12px] font-bold mb-3" style={{ color: 'var(--color-text)' }}>Порядок иконок</p>
          <div className="flex flex-col gap-1.5">
            {extended.sidebarOrder.map((key, idx) => (
              <div key={key} className="flex items-center justify-between rounded-xl px-3 py-2.5"
                style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)' }}>
                <span className="flex items-center gap-2 text-[12px] font-semibold" style={{ color: 'var(--color-text)' }}>
                  <span className="text-[9px] font-mono" style={{ color: 'var(--color-text-tertiary)' }}>{idx + 1}</span>
                  {NAV_LABELS[key] ?? key}
                </span>
                <div className="flex gap-1">
                  <button onClick={() => move(key, -1)} disabled={idx === 0}
                    className="h-7 w-7 flex items-center justify-center rounded-lg transition-colors hover:bg-white/5 disabled:opacity-30"
                    style={{ color: 'var(--color-text-secondary)' }}>
                    <ArrowUp size={13} />
                  </button>
                  <button onClick={() => move(key, 1)} disabled={idx === extended.sidebarOrder.length - 1}
                    className="h-7 w-7 flex items-center justify-center rounded-lg transition-colors hover:bg-white/5 disabled:opacity-30"
                    style={{ color: 'var(--color-text-secondary)' }}>
                    <ArrowDown size={13} />
                  </button>
                </div>
              </div>
            ))}
          </div>
          <button onClick={() => updateExtended({ sidebarOrder: ['home', 'discover', 'library', 'skins', 'settings'] })}
            className="mt-3 flex items-center gap-1.5 text-[11px] font-semibold transition-colors hover:opacity-80"
            style={{ color: 'var(--color-text-secondary)' }}>
            <RotateCcw size={12} /> Сбросить порядок
          </button>
        </div>

        {/* компактность */}
        <div className="mt-4 rounded-2xl p-5" style={{ background: 'var(--color-surface-2)', border: '1px solid var(--color-border)' }}>
          <div className="flex items-center justify-between">
            <div>
              <p className="text-[12px] font-bold" style={{ color: 'var(--color-text)' }}>Компактный режим</p>
              <p className="text-[10px] mt-0.5" style={{ color: 'var(--color-text-tertiary)' }}>Уменьшает отступы боковой панели</p>
            </div>
            <button onClick={() => updateExtended({ compactMode: !extended.compactMode })}
              className="relative h-6 w-11 rounded-full transition-colors"
              style={{ background: extended.compactMode ? 'var(--color-primary)' : 'var(--color-surface)' }}>
              <motion.div className="absolute top-1 h-4 w-4 rounded-full bg-white shadow"
                animate={{ left: extended.compactMode ? 24 : 4 }}
                transition={{ type: 'spring', stiffness: 500, damping: 30 }} />
            </button>
          </div>
        </div>
      </motion.div>
    </div>
  );
}

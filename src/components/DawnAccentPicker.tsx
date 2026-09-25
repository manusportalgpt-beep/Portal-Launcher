import { useState } from 'react';
import { motion } from 'framer-motion';
import { Check, Plus, RotateCcw } from 'lucide-react';
import { useUiStore } from '@/stores/uiStore';
import { OREUI_DEFAULT_ACCENT } from '@/lib/style-presets';
import { playClick, playSuccess } from '@/lib/soundEngine';

const ACCENT_SWATCHES = [
  { id: 'green', color: '#2ECC71', label: 'Светло-зелёный' },
  { id: 'minecraft', color: '#3c8527', label: 'Зелёный Minecraft (по умолчанию)' },
  { id: 'red', color: '#DA2A3F', label: 'Красный' },
  { id: 'blue', color: '#4299E1', label: 'Синий' },
  { id: 'purple', color: '#8B5CF6', label: 'Фиолетовый' },
  { id: 'orange', color: '#F59E0B', label: 'Оранжевый' },
  { id: 'teal', color: '#14B8A6', label: 'Бирюзовый' },
  { id: 'pink', color: '#E91E63', label: 'Розовый' },
];

export function DawnAccentPicker() {
  const ui = useUiStore();
  const applied = ui.accentColor ?? OREUI_DEFAULT_ACCENT;
  const [showCustom, setShowCustom] = useState(false);

  // Цвет применяется сразу при выборе — отдельной кнопки «Подтвердить» нет.
  const apply = (color: string) => {
    playClick();
    ui.set('accentColor', color.toLowerCase() === OREUI_DEFAULT_ACCENT.toLowerCase() ? null : color);
  };
  const pick = (color: string) => {
    apply(color);
    setShowCustom(false);
    playSuccess();
  };

  return (
    <div>
      <div className="flex items-center justify-between">
        <p className="text-xs font-bold" style={{ color: 'var(--color-text)' }}>Цвет акцента OreUI</p>
        <span className="inline-flex items-center gap-1 rounded-lg px-2 py-0.5 text-[10px] font-bold"
          style={{ background: 'var(--color-surface-2)', border: `1px solid ${applied}`, color: 'var(--color-text)' }}>
          <span className="h-2 w-2 rounded-full" style={{ background: applied }} />
          {applied.toUpperCase()}
        </span>
      </div>
      <p className="mt-1 text-[10px] mb-3" style={{ color: 'var(--color-text-tertiary)' }}>
        Перекрашивает весь интерфейс: кнопки, вкладки, выделение. По умолчанию — зелёный. Применяется сразу.
      </p>
      <div className="flex items-center gap-2 flex-wrap mb-3">
        {ACCENT_SWATCHES.map(c => {
          const isActive = applied.toLowerCase() === c.color.toLowerCase();
          return (
            <motion.button
              key={c.id}
              onClick={() => pick(c.color)}
              whileHover={{ scale: 1.12 }}
              whileTap={{ scale: 0.94 }}
              title={c.label}
              className="relative h-8 w-8 shrink-0 rounded-xl transition-all duration-150"
              style={{
                // Сплошной цвет вместо градиента на color-mix(): если движок не
                // поддерживает color-mix, значение background отбрасывается и
                // свотч остаётся пустым.
                background: c.color,
                border: isActive ? '2px solid var(--color-bg)' : '2px solid transparent',
                boxShadow: isActive
                  ? `0 0 0 2px ${c.color}, inset 0 2px 0 rgba(255,255,255,.28), inset 0 -2px 0 rgba(0,0,0,.3)`
                  : 'inset 0 2px 0 rgba(255,255,255,.22), inset 0 -2px 0 rgba(0,0,0,.3)',
              }}
            >
              {isActive && (
                <Check className="absolute inset-0 m-auto h-3.5 w-3.5" style={{ color: '#fff', filter: 'drop-shadow(0 1px 2px rgba(0,0,0,0.35))' }} />
              )}
            </motion.button>
          );
        })}
        <button
          onClick={() => { setShowCustom(v => !v); playClick(); }}
          title="Свой цвет"
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl transition-all duration-150"
          style={{ background: 'var(--color-surface-2)', border: '2px dashed var(--color-border)', color: 'var(--color-text-tertiary)' }}
        >
          <Plus className="h-3.5 w-3.5" />
        </button>
      </div>
      {showCustom && (
        <label className="mb-3 flex items-center gap-2 rounded-xl px-3 py-2"
          style={{ background: 'var(--color-surface-2)', border: '1px solid var(--color-border)' }}>
          <span className="text-[10px] font-bold" style={{ color: 'var(--color-text-secondary)' }}>Свой цвет</span>
          <input
            type="color"
            value={applied}
            onChange={e => apply(e.target.value)}
            className="h-6 w-9 cursor-pointer rounded-md border-none bg-transparent"
          />
          <span className="ml-auto text-[10px] font-mono" style={{ color: 'var(--color-text-tertiary)' }}>{applied.toUpperCase()}</span>
        </label>
      )}
      <div className="flex items-center gap-2">
        <button onClick={() => { apply(OREUI_DEFAULT_ACCENT); playSuccess(); }} className="dbtn dbtn-ghost px-4 py-2 text-xs">
          <RotateCcw className="h-3.5 w-3.5" />По умолчанию
        </button>
      </div>
    </div>
  );
}
import { useState } from 'react';
import { motion } from 'framer-motion';
import { Check, Plus, CheckCircle2, RotateCcw } from 'lucide-react';
import { useUiStore } from '@/stores/uiStore';
import { DAWN_DEFAULT_ACCENT } from '@/lib/style-presets';
import { playClick, playSuccess } from '@/lib/soundEngine';

const ACCENT_SWATCHES = [
  { id: 'green', color: '#2ECC71', label: 'Зелёный (по умолчанию)' },
  { id: 'mint', color: '#3c8527', label: 'Ореховый (Minecraft)' },
  { id: 'red', color: '#DA2A3F', label: 'Красный' },
  { id: 'blue', color: '#4299E1', label: 'Синий' },
  { id: 'purple', color: '#8B5CF6', label: 'Фиолетовый' },
  { id: 'orange', color: '#F59E0B', label: 'Оранжевый' },
  { id: 'teal', color: '#14B8A6', label: 'Бирюзовый' },
  { id: 'pink', color: '#E91E63', label: 'Розовый' },
];

export function DawnAccentPicker() {
  const ui = useUiStore();
  const applied = ui.accentColor ?? DAWN_DEFAULT_ACCENT;
  const [draft, setDraft] = useState<string>(applied);
  const [showCustom, setShowCustom] = useState(false);
  const changed = draft.toLowerCase() !== applied.toLowerCase();

  const pick = (color: string) => {
    playClick();
    setDraft(color);
    setShowCustom(false);
  };
  const commit = () => {
    ui.set('accentColor', draft.toLowerCase() === DAWN_DEFAULT_ACCENT.toLowerCase() ? null : draft);
    playSuccess();
  };
  const reset = () => {
    playClick();
    setDraft(DAWN_DEFAULT_ACCENT);
  };

  return (
    <div>
      <div className="flex items-center justify-between">
        <p className="text-xs font-bold" style={{ color: 'var(--color-text)' }}>Цвет акцента Dawn</p>
        <span className="inline-flex items-center gap-1 rounded-lg px-2 py-0.5 text-[10px] font-bold"
          style={{ background: 'color-mix(in srgb, var(--color-primary) 14%, transparent)', color: 'var(--color-primary)' }}>
          <span className="h-2 w-2 rounded-full" style={{ background: applied }} />
          {applied.toUpperCase()}
        </span>
      </div>
      <p className="mt-1 text-[10px] mb-3" style={{ color: 'var(--color-text-tertiary)' }}>
        Перекрашивает весь интерфейс: кнопки, вкладки, выделение. По умолчанию — зелёный.
      </p>
      <div className="flex items-center gap-2 flex-wrap mb-3">
        {ACCENT_SWATCHES.map(c => {
          const isActive = draft.toLowerCase() === c.color.toLowerCase();
          return (
            <motion.button
              key={c.id}
              onClick={() => pick(c.color)}
              whileHover={{ scale: 1.12 }}
              whileTap={{ scale: 0.94 }}
              title={c.label}
              className="relative h-8 w-8 shrink-0 rounded-xl transition-all duration-150"
              style={{
                background: `linear-gradient(180deg, color-mix(in srgb, ${c.color} 76%, #fff) 0%, ${c.color} 45%, ${c.color} 55%, color-mix(in srgb, ${c.color} 52%, #000) 100%)`,
                border: isActive ? '2px solid var(--color-bg)' : '2px solid transparent',
                boxShadow: isActive ? `0 0 0 2px ${c.color}` : 'none',
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
            value={draft}
            onChange={e => { playClick(); setDraft(e.target.value); }}
            className="h-6 w-9 cursor-pointer rounded-md border-none bg-transparent"
          />
          <span className="ml-auto text-[10px] font-mono" style={{ color: 'var(--color-text-tertiary)' }}>{draft.toUpperCase()}</span>
        </label>
      )}
      <div className="flex items-center gap-2">
        <button onClick={commit} className="dbtn dbtn-primary px-4 py-2 text-xs">
          <CheckCircle2 className="h-3.5 w-3.5" />Подтвердить
        </button>
        <button onClick={reset} className="dbtn dbtn-ghost px-4 py-2 text-xs">
          <RotateCcw className="h-3.5 w-3.5" />По умолчанию
        </button>
        {changed && (
          <span className="text-[10px]" style={{ color: 'var(--color-text-tertiary)' }}>применится после «Подтвердить»</span>
        )}
      </div>
    </div>
  );
}
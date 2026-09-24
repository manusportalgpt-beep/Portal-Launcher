import { useState } from 'react';
import { motion } from 'framer-motion';
import { Plus, Check, CheckCircle2 } from 'lucide-react';
import { useThemeStore } from '@/stores/themeStore';
import { themes, type ThemeId } from '@/lib/theme-engine';
import { useUiStore } from '@/stores/uiStore';
import { playClick } from '@/lib/soundEngine';

const PRESET_COLORS = [
  { id: 'red',    color: '#DA2A3F', label: 'Красный' },
  { id: 'blue',   color: '#4299E1', label: 'Синий' },
  { id: 'green',  color: '#2ECC71', label: 'Зелёный' },
  { id: 'purple', color: '#8B5CF6', label: 'Фиолетовый' },
  { id: 'orange', color: '#F59E0B', label: 'Оранжевый' },
  { id: 'pink',   color: '#E91E63', label: 'Розовый' },
  { id: 'teal',   color: '#14B8A6', label: 'Бирюзовый' },
  { id: 'white',  color: '#CCCCCC', label: 'Серебро' },
];

export function AccentColorPicker() {
  const { themeId } = useThemeStore();
  const ui = useUiStore();
  const [showCustom, setShowCustom] = useState(false);

  const themeDefault = (themes[themeId as keyof typeof themes] ?? themes.dark).colors.primary;
  const applied = ui.accentColor ?? themeDefault;
  const [draft, setDraft] = useState<string>(applied);

  const pick = (color: string) => {
    playClick();
    setDraft(color);
    setShowCustom(false);
  };
  const commit = () => {
    ui.set('accentColor', draft.toLowerCase() === themeDefault.toLowerCase() ? null : draft);
    playClick();
  };

  return (
    <div>
      <div className="flex items-center justify-between">
        <p className="text-xs font-bold mb-3" style={{ color: 'var(--color-text)' }}>Цвет акцента</p>
        <span className="mb-3 inline-flex items-center gap-1 rounded-lg px-2 py-0.5 text-[10px] font-bold"
          style={{ background: 'color-mix(in srgb, var(--color-primary) 14%, transparent)', color: 'var(--color-primary)' }}>
          {applied.toUpperCase()}
        </span>
      </div>
      <div className="flex items-center gap-2 flex-wrap">
        {PRESET_COLORS.map(c => {
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
                // Сплошной цвет вместо градиента на color-mix(): если движок не
                // поддерживает color-mix, значение background отбрасывается и
                // свотч выглядит пустым.
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
        <label className="mt-2 flex items-center gap-2 rounded-xl px-3 py-2"
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
      <div className="mt-3 flex items-center gap-2">
        <button type="button" onClick={commit} className="dbtn dbtn-primary px-4 py-2 text-xs">
          <CheckCircle2 className="h-3.5 w-3.5" />Применить
        </button>
      </div>
    </div>
  );
}
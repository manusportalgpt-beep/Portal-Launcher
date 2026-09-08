import { useState, useRef } from 'react';
import { motion } from 'framer-motion';
import { Plus, Check } from 'lucide-react';
import { useThemeStore } from '@/stores/themeStore';
import { themes, type ThemeId } from '@/lib/theme-engine';
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
  const { themeId, setTheme } = useThemeStore();
  const [customColor, setCustomColor] = useState<string | null>(null);
  const [showPicker, setShowPicker] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const currentTheme = themes[themeId as keyof typeof themes] ?? themes.dark;
  const currentAccent = currentTheme.colors.primary;

  const handlePreset = (color: string) => {
    playClick();
    setCustomColor(color);
    // Apply accent by updating CSS variable directly
    document.documentElement.style.setProperty('--color-primary', color);
    document.documentElement.style.setProperty('--color-primary-dim', color + '26');
  };

  const handleCustom = () => {
    inputRef.current?.click();
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const color = e.target.value;
    if (color) handlePreset(color);
  };

  return (
    <div>
      <p className="text-xs font-bold mb-3" style={{ color: 'var(--color-text)' }}>Цвет акцента</p>
      <div className="flex items-center gap-2 flex-wrap">
        {PRESET_COLORS.map(c => {
          const isActive = customColor === c.color || (!customColor && currentAccent === c.color);
          return (
            <motion.button
              key={c.id}
              onClick={() => handlePreset(c.color)}
              whileHover={{ scale: 1.2 }}
              whileTap={{ scale: 0.95 }}
              title={c.label}
              className="relative w-7 h-7 rounded-full shrink-0 transition-all duration-150"
              style={{
                background: c.color,
                boxShadow: isActive ? `0 0 0 2px var(--color-bg), 0 0 0 4px ${c.color}` : 'none',
                border: isActive ? 'none' : '2px solid transparent',
              }}
            >
              {isActive && (
                <motion.div
                  initial={{ scale: 0 }}
                  animate={{ scale: 1 }}
                  className="absolute inset-0 flex items-center justify-center"
                >
                  <Check className="w-3 h-3" style={{ color: '#fff', filter: 'drop-shadow(0 1px 2px rgba(0,0,0,0.3))' }} />
                </motion.div>
              )}
            </motion.button>
          );
        })}
        {/* Custom color "+" button */}
        <motion.button
          onClick={handleCustom}
          whileHover={{ scale: 1.15 }}
          whileTap={{ scale: 0.95 }}
          title="Свой цвет"
          className="w-7 h-7 rounded-full shrink-0 flex items-center justify-center transition-all duration-150"
          style={{
            background: 'var(--color-surface-2)',
            border: '2px dashed var(--color-border)',
            color: 'var(--color-text-tertiary)',
          }}
        >
          <Plus className="w-3.5 h-3.5" />
        </motion.button>
        <input
          ref={inputRef}
          type="color"
          value={customColor || currentAccent}
          onChange={handleFileChange}
          className="sr-only"
        />
      </div>
    </div>
  );
}

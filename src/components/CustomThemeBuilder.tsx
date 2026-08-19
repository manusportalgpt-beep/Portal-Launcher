import { useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Check, Palette, Plus, Trash2, X, Wand2, Contrast, Upload } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useThemeStore, type CustomThemeColors, type CustomThemeOptions } from '@/stores/themeStore';
import { useUiStore } from '@/stores/uiStore';
import { loadBackgroundMedia, removeBackgroundMedia, saveBackgroundMedia } from '@/lib/background-media';

const COLOR_FIELDS: Array<{ key: keyof CustomThemeColors; label: string; description: string }> = [
  { key: 'background', label: 'Background', description: 'Главный фон' },
  { key: 'surface', label: 'Surface', description: 'Основная поверхность' },
  { key: 'surfaceHover', label: 'Surface hover', description: 'Поверхность при наведении' },
  { key: 'surfaceActive', label: 'Surface active', description: 'Выбранная поверхность' },
  { key: 'primary', label: 'Accent', description: 'Основной акцент' },
  { key: 'outline', label: 'Outline', description: 'Обычная обводка' },
  { key: 'outlineStrong', label: 'Strong outline', description: 'Сильная обводка' },
  { key: 'text', label: 'Text', description: 'Основной текст' },
  { key: 'mutedText', label: 'Muted text', description: 'Вторичный текст' },
  { key: 'success', label: 'Success', description: 'Успешное состояние' },
  { key: 'warning', label: 'Warning', description: 'Предупреждение' },
  { key: 'error', label: 'Error', description: 'Ошибка' },
  { key: 'info', label: 'Info', description: 'Информация' },
];

const DEFAULT_COLORS: CustomThemeColors = {
  background: '#080A12', surface: '#121827', surfaceHover: '#1A2234', surfaceActive: '#242F48',
  primary: '#7C5CFC', outline: '#35415F', outlineStrong: '#596B95', text: '#F4F6FF', mutedText: '#9AA7C2',
  success: '#2ECC71', warning: '#F39C12', error: '#E74C3C', info: '#3498DB',
};
const DEFAULT_OPTIONS: CustomThemeOptions = { radiusScale: 1, shadowStrength: 1, glowStrength: 1, font: "'Inter',system-ui,sans-serif" };

function relativeLuminance(hex: string) {
  const clean = hex.replace('#', '');
  if (!/^[0-9a-f]{6}$/i.test(clean)) return 0;
  const channels = [0, 2, 4].map(offset => Number.parseInt(clean.slice(offset, offset + 2), 16) / 255)
    .map(value => value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4);
  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
}

function contrastRatio(a: string, b: string) {
  const [light, dark] = [relativeLuminance(a), relativeLuminance(b)].sort((x, y) => y - x);
  return (light + 0.05) / (dark + 0.05);
}

export function CustomThemeBuilder() {
  const { t } = useTranslation();
  const { themeId, customThemes, setTheme, addCustomTheme, deleteCustomTheme } = useThemeStore();
  const backgroundImage = useUiStore(state => state.backgroundImage);
  const setUi = useUiStore(state => state.set);
  const [backgroundPreview, setBackgroundPreview] = useState('');

  useEffect(() => {
    let active = true;
    void loadBackgroundMedia(backgroundImage).then(src => {
      if (active) setBackgroundPreview(src);
    });
    return () => { active = false; };
  }, [backgroundImage]);
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('My Portal Theme');
  const [colors, setColors] = useState<CustomThemeColors>(DEFAULT_COLORS);
  const [options, setOptions] = useState<CustomThemeOptions>(DEFAULT_OPTIONS);

  const updateColor = (key: keyof CustomThemeColors, value: string) => {
    setColors(current => ({ ...current, [key]: value }));
  };
  const updateOption = (key: keyof CustomThemeOptions, value: number | string) => {
    setOptions(current => ({ ...current, [key]: value }));
  };
  const useRandomPalette = () => {
    const hue = Math.floor(Math.random() * 360);
    const hex = (lightness: number, saturation = 54) => {
      const chroma = (1 - Math.abs(2 * lightness / 100 - 1)) * saturation / 100;
      const part = hue / 60;
      const x = chroma * (1 - Math.abs(part % 2 - 1));
      const [r, g, b] = part < 1 ? [chroma, x, 0] : part < 2 ? [x, chroma, 0] : part < 3 ? [0, chroma, x] : part < 4 ? [0, x, chroma] : part < 5 ? [x, 0, chroma] : [chroma, 0, x];
      const match = lightness / 100 - chroma / 2;
      return '#' + [r, g, b].map(value => Math.round((value + match) * 255).toString(16).padStart(2, '0')).join('');
    };
    setColors({ ...DEFAULT_COLORS, background: hex(8, 35), surface: hex(15, 30), surfaceHover: hex(20, 30), surfaceActive: hex(25, 34), primary: hex(62, 72), outline: hex(29, 35), outlineStrong: hex(38, 38), text: '#F7F8FB', mutedText: '#B5BBC7' });
  };
  const repairContrast = () => setColors(current => ({ ...current, text: relativeLuminance(current.background) > 0.24 ? '#11151E' : '#F7F8FB', mutedText: relativeLuminance(current.background) > 0.24 ? '#45515F' : '#B5BBC7' }));
  const contrast = contrastRatio(colors.text, colors.background);
  const importBackground = (file?: File) => {
    if (!file || !/^image\/(png|jpeg|jpg|webp)$/i.test(file.type) || file.size > 8 * 1024 * 1024) return;
    const reader = new FileReader();
    reader.onload = () => {
      void saveBackgroundMedia('image', String(reader.result || ''))
        .then(token => setUi('backgroundImage', token))
        .catch(() => undefined);
    };
    reader.readAsDataURL(file);
  };

  return (
    <div className="mt-3">
      <button
        onClick={() => setOpen(value => !value)}
        className="group flex min-h-[98px] w-full items-center justify-center gap-3 rounded-2xl border-2 border-dashed px-4 py-4 text-left transition-all hover:-translate-y-0.5"
        style={{ borderColor: 'var(--color-primary)', background: 'var(--color-primary-dim)' }}
      >
        <span className="flex h-10 w-10 items-center justify-center rounded-xl" style={{ background: 'var(--color-surface-2)', color: 'var(--color-primary)' }}>
          {open ? <X className="h-5 w-5" /> : <Plus className="h-5 w-5 transition-transform group-hover:rotate-90" />}
        </span>
        <span>
          <span className="block text-sm font-black" style={{ color: 'var(--color-text)' }}>Добавить тему</span>
          <span className="mt-0.5 block text-[11px]" style={{ color: 'var(--color-text-secondary)' }}>Создай свою палитру Portal Launcher</span>
        </span>
      </button>

      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            initial={{ opacity: 0, height: 0, y: -8 }}
            animate={{ opacity: 1, height: 'auto', y: 0 }}
            exit={{ opacity: 0, height: 0, y: -8 }}
            className="mt-3 overflow-hidden rounded-2xl"
            style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)' }}
          >
            <div className="p-4">
              <div className="mb-3 flex items-center gap-2">
                <Palette className="h-4 w-4" style={{ color: 'var(--color-primary)' }} />
                <div>
                  <p className="text-sm font-black" style={{ color: 'var(--color-text)' }}>Theme builder</p>
                  <p className="text-[11px]" style={{ color: 'var(--color-text-secondary)' }}>Палитра, поверхности, статусы, радиусы, тени и шрифт сохраняются после перезапуска.</p>
                </div>
              </div>
              <input value={name} onChange={e => setName(e.target.value)} maxLength={32} placeholder="Название темы"
                className="mb-3 w-full rounded-xl px-3 py-2 text-xs outline-none"
                style={{ background: 'var(--color-surface-2)', color: 'var(--color-text)', border: '1px solid var(--color-border)' }} />
              <div className="mb-3 flex flex-wrap gap-1.5">
                <button onClick={useRandomPalette} title="Generate a new original color direction" className="flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-[10px] font-bold" style={{ background:'var(--color-surface-2)', color:'var(--color-text-secondary)', border:'1px solid var(--color-border)' }}><Wand2 className="h-3.5 w-3.5" />Generate colors</button>
                <button onClick={repairContrast} title="Choose readable text colors for this background" className="flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-[10px] font-bold" style={{ background:'var(--color-surface-2)', color:'var(--color-text-secondary)', border:'1px solid var(--color-border)' }}><Contrast className="h-3.5 w-3.5" />Fix contrast</button>
                <button onClick={() => { setColors(DEFAULT_COLORS); setOptions(DEFAULT_OPTIONS); }} title="Restore builder defaults" className="rounded-lg px-2 py-1.5 text-[10px] font-bold" style={{ background:'var(--color-surface-2)', color:'var(--color-text-secondary)', border:'1px solid var(--color-border)' }}>Reset</button>
              </div>
              <div className="mb-3 rounded-xl p-3" style={{ background:'var(--color-surface-2)', border:'1px solid var(--color-border)' }}>
                <div className="mb-2 flex items-center justify-between gap-2">
                  <div><p className="text-[11px] font-bold" style={{ color:'var(--color-text)' }}>{t('settings.appearanceUi.customBackground')}</p><p className="text-[9px]" style={{ color:'var(--color-text-secondary)' }}>{t('settings.appearanceUi.customBackgroundDescription')}</p></div>
                  <input type="file" accept="image/png,image/jpeg,image/webp" className="hidden" id="custom-theme-background" onChange={event => importBackground(event.target.files?.[0])} />
                  <label htmlFor="custom-theme-background" className="flex cursor-pointer items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[10px] font-bold" style={{ background:'var(--color-primary)', color:'var(--color-primary-text)' }}><Upload className="h-3.5 w-3.5" />{t('settings.appearanceUi.chooseBackground')}</label>
                </div>
                {backgroundImage && <div className="flex items-center gap-2"><div className="h-9 flex-1 rounded-lg bg-cover bg-center" style={{ backgroundImage: backgroundPreview ? `url("${backgroundPreview}")` : 'none' }} /><button type="button" onClick={() => { void removeBackgroundMedia('image'); setUi('backgroundImage', ''); }} className="rounded-lg px-2 py-1.5 text-[10px] font-bold" style={{ background:'var(--color-bg)', color:'var(--color-text-secondary)', border:'1px solid var(--color-border)' }}>{t('settings.appearanceUi.removeBackground')}</button></div>}
              </div>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                {COLOR_FIELDS.map(field => (
                  <label key={field.key} className="rounded-xl p-2.5" style={{ background: 'var(--color-surface-2)', border: '1px solid var(--color-border)' }}>
                    <div className="flex items-center gap-2">
                      <input type="color" value={colors[field.key]} onChange={e => updateColor(field.key, e.target.value)} className="h-8 w-8 cursor-pointer rounded-lg border-0 bg-transparent p-0" />
                      <span className="min-w-0">
                        <span className="block truncate text-[11px] font-bold" style={{ color: 'var(--color-text)' }}>{field.label}</span>
                        <span className="block truncate text-[9px]" style={{ color: 'var(--color-text-secondary)' }}>{field.description}</span>
                      </span>
                    </div>
                    <input value={colors[field.key]} maxLength={7} onChange={e => {
                      const value = e.target.value;
                      if (/^#[0-9a-f]{0,6}$/i.test(value)) updateColor(field.key, value);
                    }} className="mt-2 w-full rounded-md px-1.5 py-1 font-mono text-[10px] uppercase outline-none" style={{ background:'var(--color-background)', color:'var(--color-text)', border:'1px solid var(--color-border)' }} />
                  </label>
                ))}
              </div>
              <div className="mt-3 grid gap-2 sm:grid-cols-4">
                <label className="rounded-xl p-2" style={{ background:'var(--color-surface-2)', border:'1px solid var(--color-border)' }}><span className="block text-[10px] font-bold" style={{ color:'var(--color-text)' }}>Скругление {options.radiusScale.toFixed(1)}×</span><input type="range" min="0.5" max="1.8" step="0.1" value={options.radiusScale} onChange={e => updateOption('radiusScale', Number(e.target.value))} className="w-full" style={{ accentColor:'var(--color-primary)' }} /></label>
                <label className="rounded-xl p-2" style={{ background:'var(--color-surface-2)', border:'1px solid var(--color-border)' }}><span className="block text-[10px] font-bold" style={{ color:'var(--color-text)' }}>Тени {Math.round(options.shadowStrength * 100)}%</span><input type="range" min="0" max="1.5" step="0.05" value={options.shadowStrength} onChange={e => updateOption('shadowStrength', Number(e.target.value))} className="w-full" style={{ accentColor:'var(--color-primary)' }} /></label>
                <label className="rounded-xl p-2" style={{ background:'var(--color-surface-2)', border:'1px solid var(--color-border)' }}><span className="block text-[10px] font-bold" style={{ color:'var(--color-text)' }}>Glow {Math.round(options.glowStrength * 100)}%</span><input type="range" min="0" max="1.8" step="0.05" value={options.glowStrength} onChange={e => updateOption('glowStrength', Number(e.target.value))} className="w-full" style={{ accentColor:'var(--color-primary)' }} /></label>
                <label className="rounded-xl p-2" style={{ background:'var(--color-surface-2)', border:'1px solid var(--color-border)' }}><span className="block text-[10px] font-bold" style={{ color:'var(--color-text)' }}>Шрифт</span><select value={options.font} onChange={e => updateOption('font', e.target.value)} className="mt-1 w-full rounded-lg px-1.5 py-1 text-[10px]" style={{ background:'var(--color-surface)', color:'var(--color-text)', border:'1px solid var(--color-border)' }}><option value="'Inter',system-ui,sans-serif">Inter</option><option value="'Space Grotesk','Inter',system-ui,sans-serif">Space Grotesk</option><option value="'Manrope','Inter',system-ui,sans-serif">Manrope</option><option value="'JetBrains Mono',monospace">JetBrains Mono</option><option value="'Press Start 2P',monospace">Pixel</option></select></label>
              </div>
              <div className="mt-3 flex items-center gap-2">
                <div className="h-8 flex-1 rounded-xl" style={{ background: colors.background, border: `1px solid ${colors.outline}` }}>
                  <div className="m-1 h-6 rounded-lg" style={{ background: colors.surface }}><span className="ml-2 text-[10px] font-bold" style={{ color: colors.text }}>Portal Launcher</span><span className="ml-2 text-[10px]" style={{ color: colors.primary }}>Aa</span></div>
                </div>
                <span className="hidden rounded-lg px-2 py-1 text-[9px] font-bold sm:block" style={{ background: contrast >= 4.5 ? 'rgba(46,204,113,0.14)' : 'rgba(243,156,18,0.14)', color: contrast >= 4.5 ? '#2ECC71' : '#F39C12' }}>Text {contrast.toFixed(1)}:1</span>
                <button onClick={() => { addCustomTheme(name, colors, options); setOpen(false); }} className="flex items-center gap-1.5 rounded-xl px-3 py-2 text-xs font-bold" style={{ background: 'var(--color-primary)', color: 'var(--color-primary-text)' }}>
                  <Check className="h-3.5 w-3.5" />Save theme
                </button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {Object.values(customThemes).length > 0 && (
        <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3">
          {Object.values(customThemes).map(theme => (
            <div key={theme.id} className="flex items-center gap-2 rounded-xl p-2" style={{ background: 'var(--color-surface-2)', border: `1px solid ${themeId === theme.id ? theme.colors.primary : 'var(--color-border)'}` }}>
              <button onClick={() => setTheme(theme.id)} className="flex min-w-0 flex-1 items-center gap-2 text-left">
                <span className="h-7 w-7 shrink-0 rounded-lg" style={{ background: `linear-gradient(135deg, ${theme.colors.background}, ${theme.colors.primary})` }} />
                <span className="truncate text-[10px] font-bold" style={{ color: 'var(--color-text)' }}>{theme.name}</span>
              </button>
              <button onClick={() => deleteCustomTheme(theme.id)} className="rounded-lg p-1 hover:bg-white/10" style={{ color: 'var(--color-text-secondary)' }} aria-label="Delete theme"><Trash2 className="h-3 w-3" /></button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

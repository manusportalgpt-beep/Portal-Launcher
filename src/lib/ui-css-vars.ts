/**
 * Переменные оформления лаунчера, которые можно переопределить в своём CSS.
 *
 * Один список на две вещи: подсказка в Настройки → Оформление (рядом с
 * редактором CSS) и справочник для агента. Поэтому он вынесен отдельно, чтобы
 * агент и интерфейс не расходились: агент получает ровно эти имена.
 */
export interface UiCssVar {
  name: string;
  example: string;
}

export interface UiCssVarGroup {
  title: string;
  vars: UiCssVar[];
}

export const UI_CSS_VARS: UiCssVarGroup[] = [
  {
    title: 'Цвета',
    vars: [
      { name: '--color-bg', example: '#16161A' },
      { name: '--color-surface', example: '#1D1D22' },
      { name: '--color-surface-2', example: '#26262C' },
      { name: '--color-surface-hover', example: '#26262C' },
      { name: '--color-surface-active', example: '#2E2E35' },
      { name: '--color-border', example: '#2E2E35' },
      { name: '--color-border-strong', example: '#45454F' },
      { name: '--color-text', example: '#EDEDF0' },
      { name: '--color-text-secondary', example: '#9A9AA5' },
      { name: '--color-text-tertiary', example: '#5C5C68' },
      { name: '--color-primary', example: '#DA2A3F' },
      { name: '--color-primary-hover', example: '#EE3A50' },
      { name: '--color-primary-dim', example: 'rgba(218,42,63,0.15)' },
      { name: '--color-primary-text', example: '#FFFFFF' },
      { name: '--color-success', example: '#2ECC71' },
      { name: '--color-warning', example: '#F39C12' },
      { name: '--color-error', example: '#E74C3C' },
      { name: '--color-info', example: '#3498DB' },
    ],
  },
  {
    title: 'Скругления и тени',
    vars: [
      { name: '--radius-button', example: '10px' },
      { name: '--radius-card', example: '12px' },
      { name: '--radius-modal', example: '18px' },
      { name: '--portal-shadow-strength', example: '1' },
    ],
  },
  {
    title: 'Масштаб и движение',
    vars: [
      { name: '--ui-scale', example: '1' },
      { name: '--portal-motion-multiplier', example: '1' },
      { name: '--portal-interface-opacity', example: '1' },
      { name: '--portal-surface-opacity', example: '1' },
      { name: '--portal-border-opacity', example: '1' },
      { name: '--portal-accent-glow-opacity', example: '0' },
    ],
  },
  {
    title: 'Фон',
    vars: [
      { name: '--custom-bg', example: 'url("bg.png")' },
      { name: '--custom-bg-opacity', example: '1' },
      { name: '--custom-bg-size', example: 'cover' },
      { name: '--custom-bg-position', example: 'center' },
      { name: '--custom-bg-blur', example: '0px' },
      { name: '--custom-bg-saturation', example: '100%' },
      { name: '--custom-bg-readability', example: '0' },
    ],
  },
];

/** Готовая подсказка для агента: короткий текст о том, как писать CSS лаунчера. */
export function uiCssGuide(): string {
  const list = UI_CSS_VARS
    .map(g => `  ${g.title}: ${g.vars.map(v => `${v.name} (например ${v.example})`).join(', ')}`)
    .join('\n');
  return [
    'Оформление лаунчера переопределяется пользовательским CSS в',
    'Настройки -> Оформление -> Пользовательский CSS. Файл custom.css в папке',
    'лаунчера подхватывается при запуске.',
    '',
    'Правила:',
    '  1) Цвета и размеры задаются переменными ниже, а не хардкодом.',
    '  2) Не переопределяй :root целиком — только нужные переменные,',
    '     иначе сломаешь тему, выбранную пользователем.',
    '  3) Для точечных правок используй существующие классы интерфейса.',
    '  4) Проверяй контраст: основной текст не ниже 4.5:1.',
    '',
    'Переменные:',
    list,
  ].join('\n');
}

/* ═══════════════════════════════════════════════════════════════════════
   PIXEL ICONS — оригинальный набор иконок в пиксель-стиле.

   Не копия ассетов Mojang: каждая иконка нарисована с нуля как сетка
   «пикселей» на 24×24 с чёткими краями (shape-rendering: crispEdges).
   Компонент <PxIcon name="…" /> подставляет нужный путь.

   Цвет наследует currentColor, поэтому иконки красятся через CSS-переменные
   и работают в светлой и тёмной темах. Размер задаётся классом (h-4 w-4 и т. п.)
   ═══════════════════════════════════════════════════════════════════════ */

import type { SVGProps } from 'react';

/** Пиксельные пути 24×24. Каждый путь — набор прямоугольных ступенек. */
const PATHS = {
  /* играть: стрелка вправо из «платформы» */
  play: 'M4 4h2v2H4zM4 6h2v2H4zM6 4h2v2H6zM8 6h2v2H8zM10 8h2v2h-2zM12 10h2v2h-2zM14 12h2v2h-2zM12 14h2v2h-2zM10 16h2v2h-2zM8 18h2v2H8zM6 20h2v2H6zM4 22h2v2H4zM2 20h2v2H2zM2 4h2v2H2z',
  /* куб: изометрический блок */
  cube: 'M8 2h8v2H8zM6 4h2v2H6zM16 4h2v2h-2zM4 6h2v2H4zM18 6h2v2h-2zM2 8h2v2H2zM20 8h2v2h-2zM4 10h2v2H4zM18 10h2v2h-2zM6 12h2v2H6zM16 12h2v2h-2zM8 14h8v2H8zM10 16h4v2h-4zM12 18h2v2h-2zM10 20h2v2h-2z',
  /* папка */
  folder: 'M2 6h8v2H2zM2 8h20v12H2zM4 10h16v8H4zM6 12h12v2H6zM6 16h8v2H6z',
  /* список/библиотека */
  library: 'M3 4h18v2H3zM3 8h18v2H3zM3 12h18v2H3zM3 16h12v2H3zM3 20h12v2H3z',
  /* поиск: лупа */
  search: 'M10 4h6v2h-6zM6 8h2v2H6zM18 8h2v2h-2zM4 10h2v6H4zM8 16h4v2H8zM12 8h2v2h-2zM16 6h2v2h-2zM20 10h2v2h-2zM18 12h2v2h-2zM16 14h2v2h-2zM14 16h2v2h-2zM12 18h2v2h-2zM10 20h2v2h-2z',
  /* шестерёнка */
  gear: 'M10 2h4v4h-4zM8 6h2v2H8zM14 6h2v2h-2zM6 8h2v2H6zM16 8h2v2h-2zM4 10h16v4H4zM6 16h2v2H6zM16 16h2v2h-2zM4 18h2v2H4zM18 18h2v2h-2zM8 20h8v2H8zM10 18h4v2h-4z',
  /* мир/глобус */
  globe: 'M10 2h4v2h-4zM6 4h2v2H6zM16 4h2v2h-2zM4 8h16v2H4zM2 10h2v4H2zM20 10h2v4h-2zM4 14h16v2H4zM6 18h2v2H6zM16 18h2v2h-2zM10 20h4v2h-4z',
  /* сервер/стойка */
  server: 'M2 4h20v6H2zM2 12h20v8H2zM4 6h2v2H4zM8 6h2v2H8zM4 14h2v2H4zM8 14h2v2H8zM14 6h6v2h-6zM14 14h6v2h-6z',
  /* радио/связь — волны */
  radio: 'M10 10h4v10h-4zM6 8h2v2H6zM16 8h2v2h-2zM4 6h2v2H4zM18 6h2v2h-2zM2 4h2v2H2zM20 4h2v2h-2z',
  /* бот/ИИ */
  bot: 'M8 6h8v2H8zM4 10h2v2H4zM18 10h2v2h-2zM2 12h2v6H2zM20 12h2v6h-2zM4 18h16v2H4zM8 12h2v2H8zM14 12h2v2h-2zM10 16h4v2h-4zM6 8h2v2H6zM16 8h2v2h-2z',
  /* терминал */
  terminal: 'M2 4h20v16H2zM4 6h2v2H4zM6 10h2v2H6zM8 12h2v2H8zM12 10h2v2h-2zM14 12h2v2h-2zM16 14h2v2h-2zM8 16h8v2H8z',
  /* галерея/скриншоты */
  image: 'M2 4h20v16H2zM4 6h16v12H4zM6 14l3-3 2 2 3-4 4 5H6zM6 8h4v2H6z',
  /* скачать */
  download: 'M10 2h4v8h-4zM6 8h2v2H6zM16 8h2v2h-2zM4 10h2v4H4zM18 10h2v4h-2zM6 14h2v2H6zM16 14h2v2h-2zM4 16h2v2H4zM18 16h2v2h-2zM2 18h20v2H2zM8 20h8v2H8z',
  /* загрузка/апдейт */
  upload: 'M8 20h8v2H8zM10 12h4v8h-4zM6 14h2v2H6zM16 14h2v2h-2zM4 12h2v2H4zM18 12h2v2h-2zM2 10h20v2H2zM8 8h2v2H8zM14 8h2v2h-2zM10 6h2v2h-2zM12 4h2v2h-2z',
  /* настройки/слайдеры */
  sliders: 'M2 6h20v2H2zM2 16h20v2H2zM6 4h4v6H6zM14 14h4v6h-4z',
  /* корзина */
  trash: 'M8 2h8v2H8zM4 6h16v2H4zM6 8h12v14H6zM9 11h2v8H9zM13 11h2v8h-2z',
  /* копировать */
  copy: 'M4 2h10v2H4zM2 4h2v14H2zM4 16h10v2H4zM14 16h2v2h-2zM16 4h4v2h-4zM20 6h2v10h-2zM16 16h4v2h-4zM8 6h6v2H8zM6 8h2v8H6zM8 16h6v2H8z',
  /* плюс */
  plus: 'M10 4h4v6h6v4h-6v6h-4v-6H4v-4h6z',
  /* минус */
  minus: 'M4 10h16v4H4z',
  /* крестик */
  close: 'M4 4h4v2H4zM8 6h2v2H8zM6 8h2v2H6zM4 10h2v2H4zM6 12h2v2H6zM8 14h2v2H8zM4 16h2v2H4zM14 4h4v2h-4zM16 6h2v2h-2zM18 8h2v2h-2zM20 10h2v2h-2zM18 12h2v2h-2zM16 14h2v2h-2zM14 16h4v2h-4zM10 10h4v4h-4z',
  /* чек */
  check: 'M6 4h4v2H6zM4 8h2v4H4zM6 12h2v2H6zM8 14h4v2H8zM10 16h4v2h-4zM12 14h4v2h-4zM14 12h4v2h-4zM16 10h4v2h-4zM18 8h2v4h-2zM18 12h2v2h-2z',
  /* стрелка влево */
  left: 'M10 2h4v2h-4zM6 4h4v2H6zM4 6h2v2H4zM2 8h2v8H2zM4 16h2v2H4zM6 18h4v2H6zM10 20h4v2h-4zM14 18h6v2h-6zM18 16h4v2h-4zM20 10h2v4h-2zM18 6h4v2h-4zM14 4h6v2h-6z',
  /* шестерёнка-звезда для «AI» */
  spark: 'M10 2h4v6h-4zM4 6h4v4H4zM16 6h4v4h-4zM2 12h6v4H2zM16 12h6v4h-6zM6 18h4v4H6zM14 18h4v4h-4zM10 18h4v4h-4z',
  /* облако (фон) */
  cloud: 'M8 6h8v2H8zM6 8h2v2H6zM16 8h2v2h-2zM4 10h16v2H4zM2 12h20v4H2zM6 16h12v2H6z',
  /* предупреждение */
  warn: 'M10 2h4v4h-4zM8 6h2v4H8zM14 6h2v4h-2zM6 10h2v4H6zM16 10h2v4h-2zM4 14h16v2H4zM8 16h2v2H8zM14 16h2v2h-2zM10 18h4v4h-4z',
  /* информация */
  info: 'M10 2h4v4h-4zM10 8h4v2h-4zM10 12h4v10h-4zM10 8h4v2h-4z',
  /* документ */
  file: 'M6 2h8v2H6zM4 4h2v16H4zM6 20h12v2H6zM16 4h2v2h-2zM18 6h2v14h-2zM6 4h2v16H6zM8 8h6v2H8zM8 12h6v2H8z',
  /* папка с плюсом (создать) */
  folderPlus: 'M2 6h8v2H2zM2 8h18v10H2zM4 10h14v6H4zM9 12h2v4H9zM8 13h4v2H8z',
  /* часы (время) */
  clock: 'M10 2h4v2h-4zM6 4h2v2H6zM16 4h2v2h-2zM4 8h2v2H4zM18 8h2v2h-2zM2 10h2v4H2zM20 10h2v4h-2zM4 14h2v2H4zM18 14h2v2h-2zM6 18h2v2H6zM16 18h2v2h-2zM10 20h4v2h-4zM11 6h2v8h-2z',
} as const;

export type PixelIconName = keyof typeof PATHS;

export interface PxIconProps extends Omit<SVGProps<SVGSVGElement>, 'name'> {
  name: PixelIconName;
}

/** Пиксельная иконка 24×24 на текущем цвете текста. */
export function PxIcon({ name, ...props }: PxIconProps) {
  return (
    <svg viewBox="0 0 24 24" width="1em" height="1em" aria-hidden="true" focusable="false"
      shapeRendering="crispEdges" {...props}>
      <path d={PATHS[name]} fill="currentColor" />
    </svg>
  );
}

export default PxIcon;

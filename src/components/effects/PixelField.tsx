import { useEffect, useRef } from 'react';

/**
 * Сетка пикселей с радужным переливом, полем глубины и эффектом
 * вдавливания под курсором.
 *
 * Отличие от DotField: там точки круглые и под курсором просто
 * гаснут, здесь квадратные и уходят в углубление - пиксель
 * уменьшается, темнеет, и по краям прорисовывается внутренняя
 * тень: сверху и слева темнее, снизу и справа светлее. Из-за
 * этого клетка читается как вдавленная, а не как подсвеченная.
 *
 * Всё остальное - 30 кадров в секунду, остановка на скрытой
 * вкладке, режим меньшего движения - как в DotField.
 */
interface Props {
  /** Сторона клетки в пикселях. Больше - крупнее пиксели. */
  cell?: number;
  /** Радиус углубления в пикселях. */
  radius?: number;
  /** Сила углубления: 0 - нет, 1 - максимальная. */
  depth?: number;
  /** Размытость углубления: меньше - резче граница. */
  softness?: number;
  /** Скорость перелива. 0 - статичный цвет. */
  flow?: number;
  /** Своя палитра вместо встроенного перелива: от 2 до 10 цветов. */
  palette?: string[];
  /** Сторона, с которой начинается переход между цветами палитры. */
  gradientSide?: 'left' | 'right' | 'top' | 'bottom';
  /** Насыщенность цвета пикселя, 0..1. */
  saturation?: number;
  /** Общая непрозрачность сетки, 0..1. */
  opacity?: number;
  className?: string;
}

/** #rrggbb или #rgb в тройку 0..255. Неверный цвет - нейтральный серый. */
function hexToRgb(hex: string): [number, number, number] {
  const raw = hex.trim().replace('#', '',);
  const full = raw.length === 3 ? raw.split('').map(c => c + c).join('') : raw;
  if (!/^[0-9a-fA-F]{6}$/.test(full)) return [140, 140, 140];
  return [
    parseInt(full.slice(0, 2), 16),
    parseInt(full.slice(2, 4), 16),
    parseInt(full.slice(4, 6), 16),
  ];
}

export function PixelField({
  cell = 15,
  radius = 132,
  depth = 1,
  gradientSide = 'left',
  palette,
  softness = 2.1,
  flow = 0.14,
  saturation = 0.62,
  opacity = 0.72,
  className,
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const pointerRef = useRef({ x: -9999, y: -9999, active: false });

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d', { alpha: true });
    if (!ctx) return;

    let frame = 0;
    let width = 0;
    let height = 0;
    let phase = 0;
    let lastDraw = 0;

    const reduced =
      typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
    // Перелив при включённом «меньше движения» не останавливается
    // совсем: у DotField это приводило к тому, что поле замирало
    // навсегда и выглядело сломанным. Здесь просто медленнее.
    const motion = flow > 0;
    const speed = reduced ? 0.3 : 1;
    // Углубление - прямое следствие движения, его отключаем.
    const dip = !reduced;

    // Пространственные фазы. Сумма даёт гладкое поле: соседние клетки
    // почти одинаковой глубины, поэтому границ не видно.
    const spaceA = 2.3;
    const spaceB = 3.7;
    const timeA = (p: number) => Math.sin(spaceA * 1.7 + p * 0.37);
    const timeB = (p: number) => Math.sin(spaceB * 1.1 - p * 0.23 + 1.7);

    const depthAt = (nx: number, ny: number, p: number): number => {
      const spatial =
        Math.sin(nx * 3.9 + spaceA) +
        Math.sin(ny * 3.3 - spaceB) +
        Math.sin((nx * 0.6 + ny * 0.8) * 4.7 + spaceB);
      const drift = timeA(p) + timeB(p);
      const raw = (spatial + drift * 1.1) / 7.2;
      return Math.min(1, Math.max(0, raw));
    };

    /** HSL в rgb. Оттенок плавно уходит по кругу. */
    const hsl = (h: number, s: number, l: number, out: [number, number, number]) => {
      const hue = (((h % 360) + 360) % 360) / 360;
      const sat = Math.min(1, Math.max(0, s));
      const lum = Math.min(1, Math.max(0, l));
      if (sat === 0) {
        out[0] = out[1] = out[2] = lum * 255;
        return out;
      }
      const q = lum < 0.5 ? lum * (1 + sat) : lum + sat - lum * sat;
      const p = 2 * lum - q;
      const channel = (t: number): number => {
        let v = t;
        if (v < 0) v += 1;
        if (v > 1) v -= 1;
        if (v < 1 / 6) return p + (q - p) * 6 * v;
        if (v < 1 / 2) return q;
        if (v < 2 / 3) return p + (q - p) * (2 / 3 - v) * 6;
        return p;
      };
      out[0] = channel(hue + 1 / 3) * 255;
      out[1] = channel(hue) * 255;
      out[2] = channel(hue - 1 / 3) * 255;
      return out;
    };

    const rgb: [number, number, number] = [0, 0, 0];

    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      width = Math.max(1, Math.round(rect.width));
      height = Math.max(1, Math.round(rect.height));
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      draw();
    };

    const draw = () => {
      ctx.clearRect(0, 0, width, height);
      const pointer = pointerRef.current;
      const usePointer = pointer.active && dip;
      const gap = Math.max(1.4, cell * 0.22);
    // Своя палитра: цвета разбираем один раз, дальше только выбор по позиции.
    const pal = palette && palette.length >= 2
      ? palette.slice(0, 10).map(hexToRgb)
      : null;
    const sideT = (nx: number, ny: number) => {
      switch (gradientSide) {
        case 'right': return 1 - nx;
        case 'top': return ny;
        case 'bottom': return 1 - ny;
        default: return nx;
      }
    };
      const size = cell - gap;

      for (let y = cell / 2; y < height + cell; y += cell) {
        for (let x = cell / 2; x < width + cell; x += cell) {
          const nx = x / width;
          const ny = y / height;

          // Глубина клетки: дальние тусклее и мельче, ближние ярче.
          const depth01 = depthAt(nx, ny, phase);
          if (pal) {
            // Палитра: берём два соседних цвета и смешиваем их по позиции,
            // поэтому переход остаётся плавным даже из 2 цветов.
            const t = Math.min(1, Math.max(0, sideT(nx, ny) + (timeA(phase) + timeB(phase)) * 0.06));
            const scaled = t * (pal.length - 1);
            const i0 = Math.min(pal.length - 1, Math.floor(scaled));
            const i1 = Math.min(pal.length - 1, i0 + 1);
            const f = scaled - i0;
            rgb[0] = pal[i0][0] + (pal[i1][0] - pal[i0][0]) * f;
            rgb[1] = pal[i0][1] + (pal[i1][1] - pal[i0][1]) * f;
            rgb[2] = pal[i0][2] + (pal[i1][2] - pal[i0][2]) * f;
          } else {
            const hue = 150 - nx * 96 + (timeA(phase) + timeB(phase)) * 28;
            const light = 0.26 + 0.36 * depth01;
            hsl(hue, saturation, light, rgb);
          }

          // Углубление под курсором: 0 - ровно, 1 - максимум.
          let press = 0;
          if (usePointer) {
            const dx = x - pointer.x;
            const dy = y - pointer.y;
            const distance = Math.sqrt(dx * dx + dy * dy);
            if (distance < radius) {
              const falloff = 1 - distance / radius;
              press = Math.pow(falloff, softness) * depth;
            }
          }

          // Вдавленная клетка меньше и темнее: глаз читает это как
          // глубину, а не как подсветку.
          const s = size * (1 - 0.34 * press);
          const half2 = s / 2;
          const dim = (1 - 0.52 * press) * (0.55 + 0.45 * depth01) * opacity;

          ctx.fillStyle = `rgba(${rgb[0] | 0}, ${rgb[1] | 0}, ${rgb[2] | 0}, ${dim})`;
          ctx.fillRect(x - half2, y - half2, s, s);

          if (press > 0.02) {
            // Внутренняя тень углубления: сверху и слева темнее,
            // снизу и справа светлее - клетка выглядит вдавленной.
            const inner = Math.max(1, Math.round(s * 0.14));
            const x0 = x - half2;
            const y0 = y - half2;
            ctx.fillStyle = `rgba(0, 0, 0, ${0.55 * press})`;
            ctx.fillRect(x0, y0, s, inner);
            ctx.fillRect(x0, y0, inner, s);
            ctx.fillStyle = `rgba(255, 255, 255, ${0.16 * press})`;
            ctx.fillRect(x0, y0 + s - inner, s, inner);
            ctx.fillRect(x0 + s - inner, y0, inner, s);
          }
        }
      }
    };

    const loop = (now: number) => {
      frame = requestAnimationFrame(loop);
      if (now - lastDraw < 32) return;
      lastDraw = now;
      phase += 0.02 * flow * speed;
      if (phase > Math.PI * 2) phase -= Math.PI * 2;
      draw();
    };

    const start = () => {
      if (motion && !frame && !document.hidden) frame = requestAnimationFrame(loop);
    };

    const stop = () => {
      if (frame) {
        cancelAnimationFrame(frame);
        frame = 0;
      }
    };

    const onVisibility = () => (document.hidden ? stop() : start());
    const onPointerMove = (event: PointerEvent) => {
      const rect = canvas.getBoundingClientRect();
      pointerRef.current = {
        x: event.clientX - rect.left,
        y: event.clientY - rect.top,
        active: true,
      };
      if (!motion) draw();
    };
    const onPointerLeave = () => {
      pointerRef.current = { x: -9999, y: -9999, active: false };
      if (!motion) draw();
    };

    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(canvas);
    window.addEventListener('pointermove', onPointerMove, { passive: true });
    canvas.addEventListener('pointerleave', onPointerLeave);
    document.addEventListener('visibilitychange', onVisibility);
    start();

    return () => {
      stop();
      observer.disconnect();
      window.removeEventListener('pointermove', onPointerMove);
      canvas.removeEventListener('pointerleave', onPointerLeave);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [cell, radius, depth, softness, flow, saturation, opacity, palette, gradientSide]);

  return <canvas ref={canvasRef} className={className} aria-hidden="true" />;
}

import { useEffect, useRef } from 'react';

/**
 * Сетка точек с радужным переливом и эффектом глубины. Пункт 12.2 из
 * RULES.md.
 *
 * Точки окрашены переливом: слева зелёные, справа синие, по диагонали
 * через середину тёмная полоса. Цвет ЖИВОЙ - по диагонали медленно
 * бежит волна яркости, поэтому поле переливается.
 *
 * Под курсором область ПРОВАЛИВАЕТСЯ: точки мельче и тусклее, с мягким
 * краем. Это не подсветка: подсветка светлеет, здесь темнеет и
 * уменьшается - так глаз читает глубину.
 */
interface Props {
  /** Шаг сетки в пикселях. Меньше — плотнее и дороже. */
  spacing?: number;
  /** Радиус провала в пикселях. */
  radius?: number;
  /** Глубина провала: 0 — нет эффекта, 1 — максимальный. */
  depth?: number;
  /** Максимальный размер точки в пикселях. */
  maxSize?: number;
  /** Скорость перелива. 0 — статичный цвет. */
  flow?: number;
  /**
   * Как падает яркость.
   * 'diagonal' — тёмная полоса по диагонали, для чата.
   * 'edges' — по бокам светло, к центру темно, для первого запуска.
   */
  profile?: 'diagonal' | 'edges';
  className?: string;
}

export function DotField({
  spacing = 11,
  radius = 150,
  depth = 1,
  maxSize = 2.6,
  flow = 0.55,
  profile = 'diagonal',
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
    // Раньше при включённом «меньше движения» перелив останавливался
    // совсем: motion становился false, цикл не запускался, и сетка
    // замирала навсегда - выглядело как сломанная, а не как
    // специально сделанное «меньше движения». Теперь режим снижает
    // скорость и амплитуду, но перелив продолжается.
    const motion = flow > 0;
    const speed = reduced ? 0.3 : 1;
    // Провал под курсором - прямое следствие движения, его отключаем.
    const dip = !reduced;

    // Три несинхронные фазы. Сумма синусов разной частоты даёт поле,
    // которое меняется во времени без резких скачков: на глаз это
    // выглядит случайно, но движется плавно. Постоянные синусы в
    // пространстве добавляют вторую составляющую - области с разной
    // глубиной в разных местах экрана.
    const spaceA = 1.7 + (spacing % 7) * 0.21;
    const spaceB = 3.1 + (spacing % 5) * 0.17;
    const timeA = (p: number) => Math.sin(spaceA * 1.9 + p * 0.41);
    const timeB = (p: number) => Math.sin(spaceB * 1.3 - p * 0.29 + 1.7);
    const timeC = (p: number) => Math.sin(2.4 - p * 0.17);

    /** Глубина точки 0..1: соседи почти равны, поэтому границ не видно. */
    const depthAt = (nx: number, ny: number, p: number) => {
      const spatial =
        Math.sin(nx * 4.3 + spaceA) +
        Math.sin(ny * 3.7 - spaceB) +
        Math.sin((nx * 0.7 + ny * 0.7) * 5.1 + spaceB);
      const drift = timeA(p) + timeB(p) + timeC(p);
      // Усиление и делитель подобраны так, чтобы сумма rarely упиралась
      // в 0 или 1: при старых 1.6 и 6.8 поле выходило за пределы и
      // залипало плоскими пятнами вместо плавного перепада глубины.
      const raw = (spatial + drift * 1.15) / 7.4;
      return Math.min(1, Math.max(0, raw));
    };

    /** HSL -> rgb. Оттенок меняется плавно, поэтому полос не видно. */
    const hsl = (h: number, s: number, l: number, out: [number, number, number]) => {
      const hue = ((h % 360) + 360) % 360 / 360;
      const sat = Math.min(1, Math.max(0, s));
      const lum = Math.min(1, Math.max(0, l));
      if (sat === 0) {
        out[0] = out[1] = out[2] = lum * 255;
        return out;
      }
      const q = lum < 0.5 ? lum * (1 + sat) : lum + sat - lum * sat;
      const p = 2 * lum - q;
      const channel = (t: number) => {
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

      for (let y = spacing / 2; y < height; y += spacing) {
        for (let x = spacing / 2; x < width; x += spacing) {
          const nx = x / width;
          const ny = y / height;

          // Профиль - общая рамка: в 'edges' по бокам светлее, в
          // 'diagonal' тёмная полоса проходит по диагонали.
          const profileDim = profile === 'edges'
            ? 0.26 + 0.74 * Math.abs(nx - 0.5) * 2
            : 0.32 + 0.68 * Math.abs((nx + ny) / 2 - 0.5) * 2;

          // Глубина именно этой точки. Разные области экрана лежат на
          // разной глубине: дальние тусклее и мельче, ближние ярче.
          const depth01 = depthAt(nx, ny, phase);
          const dim = profileDim * (0.52 + 0.72 * depth01);

          // Оттенок дрейфует по кругу плавно: зелёный слева, синий
          // справа, но со временем вся радуга смещается.
          const hue = 152 - nx * 104 + (timeA(phase) + timeB(phase)) * 26;
          hsl(hue, 0.6 + 0.18 * depth01, 0.4 + 0.22 * depth01, rgb);
          let r = rgb[0];
          let g = rgb[1];
          let b = rgb[2];

          let size = maxSize * (0.6 + 0.58 * depth01);

          // Провал под курсором: расстояние, спад и уменьшение точки.
          if (usePointer) {
            const dx = x - pointer.x;
            const dy = y - pointer.y;
            const distance = Math.hypot(dx, dy);
            if (distance < radius) {
              const falloff = 1 - distance / radius;
              const eased = falloff * falloff * (3 - 2 * falloff);
              size *= 1 - 0.72 * eased * depth;
              const shade = 1 - 0.78 * eased * depth;
              r *= shade;
              g *= shade;
              b *= shade;
            }
          }

          if (size <= 0.12) continue;
          r *= dim;
          g *= dim;
          b *= dim;
          ctx.fillStyle = `rgba(${r | 0}, ${g | 0}, ${b | 0}, 0.92)`;
          ctx.beginPath();
          ctx.arc(x, y, size, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    };

    // Отрисовка ограничена 30 кадрами в секунду: перелив медленный и
    // глаз разницы не видит, а батарея - видит. Между кадрами фаза
    // домножается на реальное время, поэтому скорость не зависит от
    // того, успевает ли браузер.
    const loop = (now: number) => {
      frame = requestAnimationFrame(loop);
      if (now - lastDraw < 32) return;
      lastDraw = now;
      phase += 0.022 * flow * speed;
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
  }, [spacing, radius, depth, maxSize, flow, profile]);

  return <canvas ref={canvasRef} className={className} aria-hidden="true" />;
}
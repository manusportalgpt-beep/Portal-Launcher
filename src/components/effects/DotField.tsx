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
  className?: string;
}

export function DotField({
  spacing = 11,
  radius = 150,
  depth = 1,
  maxSize = 2.6,
  flow = 0.55,
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
    // При включённом «меньше движения» перелив останавливается, провал
    // отключается. Сама сетка нужна, она не анимация.
    const motion = flow > 0 && !reduced;
    const dip = !reduced;

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

          // Радуга: зелёный слева, синий справа.
          let r = 24 + nx * 18;
          let g = 196 - nx * 132;
          let b = 128 + nx * 126;

          // Тёмная диагональ через середину.
          const offDiagonal = Math.abs((nx + ny) / 2 - 0.5) * 2;
          let dim = 0.32 + 0.68 * offDiagonal;

          // Бегущая волна яркости: диагональ ползёт, поле переливается.
          if (motion) {
            const wave = Math.sin((nx + ny) * 3.4 - phase);
            dim *= 0.82 + 0.34 * (wave * 0.5 + 0.5);
          }

          let size = maxSize;

          // Провал под курсором: расстояние, спад и уменьшение точки.
          if (usePointer) {
            const dx = x - pointer.x;
            const dy = y - pointer.y;
            const distance = Math.hypot(dx, dy);
            if (distance < radius) {
              const falloff = 1 - distance / radius;
              const eased = falloff * falloff * (3 - 2 * falloff);
              size = maxSize * (1 - 0.72 * eased * depth);
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
      phase += 0.022 * flow;
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
  }, [spacing, radius, depth, maxSize, flow]);

  return <canvas ref={canvasRef} className={className} aria-hidden="true" />;
}
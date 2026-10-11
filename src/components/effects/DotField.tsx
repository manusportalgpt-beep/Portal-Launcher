import { useEffect, useRef } from 'react';

/**
 * Сетка точек с эффектом глубины. Пункт 12.2 из RULES.md.
 *
 * Точки окрашены радужным переливом: слева зелёные, справа синие,
 * по диагонали через середину тёмная полоса. Под курсором область
 * ПРОВАЛИВАЕТСЯ: точки там мельче и тусклее, с мягким краем.
 *
 * Важно: это не подсветка под курсором. Подсветка светлеет, здесь
 * темнеет и уменьшается — так читается глубина.
 *
 * Перерисовка идёт только при движении мыши, а не постоянно: фоновый
 * слой не должен жечь батарею впустую.
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
  className?: string;
}

export function DotField({
  spacing = 11,
  radius = 150,
  depth = 1,
  maxSize = 2.6,
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
    let dpr = 1;

    const reduced =
      typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      dpr = Math.min(window.devicePixelRatio || 1, 2);
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
      const active = pointer.active && !reduced;

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
          const dim = 0.32 + 0.68 * offDiagonal;
          r *= dim;
          g *= dim;
          b *= dim;

          let size = maxSize;

          // Провал под курсором: расстояние, спад и уменьшение точки.
          if (active) {
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
          ctx.fillStyle = `rgba(${r | 0}, ${g | 0}, ${b | 0}, 0.92)`;
          ctx.beginPath();
          ctx.arc(x, y, size, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    };

    const schedule = () => {
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        draw();
      });
    };

    const onPointerMove = (event: PointerEvent) => {
      const rect = canvas.getBoundingClientRect();
      pointerRef.current = {
        x: event.clientX - rect.left,
        y: event.clientY - rect.top,
        active: true,
      };
      schedule();
    };

    const onPointerLeave = () => {
      pointerRef.current = { x: -9999, y: -9999, active: false };
      schedule();
    };

    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(canvas);
    window.addEventListener('pointermove', onPointerMove, { passive: true });
    canvas.addEventListener('pointerleave', onPointerLeave);

    return () => {
      if (frame) cancelAnimationFrame(frame);
      observer.disconnect();
      window.removeEventListener('pointermove', onPointerMove);
      canvas.removeEventListener('pointerleave', onPointerLeave);
    };
  }, [spacing, radius, depth, maxSize]);

  return <canvas ref={canvasRef} className={className} aria-hidden="true" />;
}
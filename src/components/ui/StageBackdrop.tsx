import { useEffect, useRef } from 'react';
import { useUiStore } from '@/stores/uiStore';

/**
 * Живой задний фон сцены: лучи, пиксельные волны и частицы.
 *
 * Три слоя, снизу вверх:
 *   1) мягкое свечение из центра — даёт «освещение» сцены;
 *   2) расходящиеся лучи — медленный оборот, фон не отвлекает;
 *   3) частицы и пиксельные волны поверх.
 *
 * Всё рисуется на canvas с привязкой к пиксельной сетке (округление
 * координат), иначе частицы «плавают» и выглядят не пиксельными.
 *
 * Два важных правила:
 *   - анимация встаёт на паузу, когда окно скрыто или идёт игра
 *     (html.m-quiet из render-gate): иначе кадры уходят Minecraft;
 *   - при prefers-reduced-motion рисуем один статичный кадр.
 */

interface Particle {
  x: number;
  y: number;
  /** Скорость вверх, px/кадр. */
  vy: number;
  /** Дрейф по горизонтали. */
  drift: number;
  /** Сторона частицы в пикселях. */
  size: number;
  /** Прозрачность. */
  alpha: number;
  /** Мерцание: амплитуда и период. */
  twinkleAmp: number;
  twinklePhase: number;
}

interface Wave {
  y: number;
  amp: number;
  speed: number;
  phase: number;
  alpha: number;
}

export function StageBackdrop({ density = 1, rays = true, waves = true }: {
  /** Множитель количества частиц: 1 — обычный фон, 2 — вдвое гуще. */
  density?: number;
  rays?: boolean;
  waves?: boolean;
}) {
  const ref = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const root = document.documentElement;
    const readToken = (name: string, fallback: string) =>
      (getComputedStyle(root).getPropertyValue(name) || fallback).trim() || fallback;

    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    let width = 0;
    let height = 0;
    let dpr = 1;
    let particles: Particle[] = [];
    let waveList: Wave[] = [];
    let raf = 0;
    let frame = 0;

    const accent = () => readToken('--color-primary', '#DA2A3F');
    const accentText = () => readToken('--color-text', '#EDEDF0');
    const bg = () => readToken('--color-bg', '#16161A');

    const makeParticles = () => {
      const count = Math.round(Math.min(150, (width * height) / 16000) * density);
      particles = Array.from({ length: count }, () => ({
        // Стартовая позиция случайна по всей высоте, иначе частицы
        // «набегают» снизу полосой в первую секунду.
        x: Math.random() * width,
        y: Math.random() * height,
        vy: 0.06 + Math.random() * 0.22,
        drift: (Math.random() - 0.5) * 0.16,
        size: Math.random() < 0.86 ? 2 : 3,
        alpha: 0.12 + Math.random() * 0.5,
        twinkleAmp: 0.2 + Math.random() * 0.4,
        twinklePhase: Math.random() * Math.PI * 2,
      }));
    };

    const makeWaves = () => {
      waveList = Array.from({ length: 5 }, (_, i) => ({
        y: height * (0.32 + i * 0.13),
        amp: 8 + i * 5,
        speed: 0.4 + i * 0.18,
        phase: Math.random() * Math.PI * 2,
        alpha: 0.06 - i * 0.008,
      }));
    };

    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      // Ограничиваем dpr: на 4K иначе частицы превращаются в мелкую рябь
      // и сцена начинает «кипеть».
      dpr = Math.min(window.devicePixelRatio || 1, 1.5);
      width = Math.max(1, Math.round(rect.width));
      height = Math.max(1, Math.round(rect.height));
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      makeParticles();
      makeWaves();
    };

    /** Один кадр. `t` — время в секундах для мерцания. */
    const draw = (t: number) => {
      ctx.clearRect(0, 0, width, height);

      const cx = width / 2;
      const cy = height * 0.46;

      // 1) Свечение из центра: даёт ощущение источника света за моделью.
      const glow = ctx.createRadialGradient(cx, cy, 0, cx, cy, Math.max(width, height) * 0.62);
      glow.addColorStop(0, `${accent()}38`);
      glow.addColorStop(0.42, `${accent()}14`);
      glow.addColorStop(1, 'transparent');
      ctx.fillStyle = glow;
      ctx.fillRect(0, 0, width, height);

      // 2) Лучи. Рисуем клиньями, а не conic-gradient: так они совпадают
      //    с пиксельной сеткой и не выглядят как гладкий градиент.
      if (rays) {
        const spin = t * 0.02;
        const count = 26;
        const reach = Math.max(width, height) * 0.78;
        ctx.save();
        ctx.translate(cx, cy);
        ctx.rotate(spin);
        ctx.fillStyle = `${accent()}12`;
        for (let i = 0; i < count; i += 2) {
          const a0 = (i / count) * Math.PI * 2;
          const a1 = ((i + 0.9) / count) * Math.PI * 2;
          ctx.beginPath();
          ctx.moveTo(0, 0);
          // Округляем до пикселей: клин с дробными углами даёт лесенку.
          ctx.lineTo(Math.round(Math.cos(a0) * reach), Math.round(Math.sin(a0) * reach));
          ctx.lineTo(Math.round(Math.cos(a1) * reach), Math.round(Math.sin(a1) * reach));
          ctx.closePath();
          ctx.fill();
        }
        ctx.restore();
      }

      // 3) Пиксельные волны: горизонтальные полосы с бегущей высотой.
      if (waves) {
        for (const w of waveList) {
          ctx.fillStyle = `${accent()}${Math.round(Math.max(0, w.alpha) * 255).toString(16).padStart(2, '0')}`;
          for (let x = 0; x < width; x += 6) {
            const y = w.y
              + Math.sin((x / 90) * w.speed + w.phase + t * 0.5) * w.amp
              + Math.sin((x / 31) * w.speed * 1.7 + t * 0.3) * (w.amp * 0.25);
            ctx.fillRect(x, Math.round(y), 6, 2);
          }
        }
      }

      // 4) Частицы: белые искры и красные пиксели, оба вида в движении.
      for (const p of particles) {
        if (!reduceMotion) {
          p.y -= p.vy;
          p.x += Math.sin((p.y + p.twinklePhase * 20) / 90) * p.drift;
          if (p.y < -4) {
            p.y = height + 4;
            p.x = Math.random() * width;
          }
        }
        const tw = 0.55 + Math.abs(Math.sin(t * p.twinkleAmp + p.twinklePhase)) * p.twinkleAmp;
        ctx.fillStyle = p.twinklePhase > Math.PI
          ? `${accent()}${Math.round(p.alpha * tw * 255).toString(16).padStart(2, '0')}`
          : `${accentText()}${Math.round(p.alpha * tw * 255).toString(16).padStart(2, '0')}`;
        ctx.fillRect(Math.round(p.x), Math.round(p.y), p.size, p.size);
      }

      // 5) Пол над моделью: тёмная эллиптическая тень, чтобы фигура «стояла»,
      //    а не висела в воздухе.
      const shadow = ctx.createRadialGradient(cx, height * 0.84, 0, cx, height * 0.84, width * 0.22);
      shadow.addColorStop(0, 'rgba(0,0,0,0.45)');
      shadow.addColorStop(1, 'transparent');
      ctx.fillStyle = shadow;
      ctx.beginPath();
      ctx.ellipse(cx, height * 0.84, width * 0.22, height * 0.05, 0, 0, Math.PI * 2);
      ctx.fill();
    };

    const loop = () => {
      frame += 1;
      draw(frame / 60);
      raf = requestAnimationFrame(loop);
    };

    resize();
    draw(0);

    if (!reduceMotion) {
      raf = requestAnimationFrame(loop);
      // Пауза вместе со всем окном: render-gate вешает класс m-quiet.
      const observer = new MutationObserver(() => {
        const quiet = document.documentElement.classList.contains('m-quiet');
        if (quiet) {
          cancelAnimationFrame(raf);
          raf = 0;
        } else if (!raf) {
          raf = requestAnimationFrame(loop);
        }
      });
      observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
      window.addEventListener('resize', resize);
      return () => {
        observer.disconnect();
        window.removeEventListener('resize', resize);
        cancelAnimationFrame(raf);
      };
    }
    window.addEventListener('resize', resize);
    return () => window.removeEventListener('resize', resize);
  }, [density, rays, waves]);

  // Фон пользователя должен просвечивать сквозь сцену, поэтому под
  // собственным заливкой лаунчера мы его не перекрываем.
  const bgOpacity = useUiStore(s => s.backgroundOpacity);

  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden>
      <div
        className="absolute inset-0"
        style={{
          backgroundImage: bgOpacity > 0 ? 'var(--custom-bg)' : 'none',
          backgroundSize: 'var(--custom-bg-size, cover)',
          backgroundPosition: 'var(--custom-bg-position, center)',
          opacity: Math.min(1, bgOpacity / 100),
        }}
      />
      <canvas ref={ref} className="absolute inset-0 h-full w-full" style={{ background: 'var(--color-bg)' }} />
    </div>
  );
}

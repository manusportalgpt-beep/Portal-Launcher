import { ReactNode, useEffect, useState } from 'react';
import { TopNav } from './TopNav';
import { useUiStore } from '@/stores/uiStore';
import { useThemeStore } from '@/stores/themeStore';
import { loadBackgroundMedia } from '@/lib/background-media';

export function MainLayout({ children }: { children: ReactNode }) {
  const navMode = useUiStore(s => s.navMode);
  const themeId = useThemeStore(s => s.themeId);
  const backgroundImage = useUiStore(s => s.backgroundImage);
  const [backgroundSrc, setBackgroundSrc] = useState('');

  useEffect(() => {
    let active = true;
    void loadBackgroundMedia(backgroundImage).then(src => {
      if (active) setBackgroundSrc(src);
    });
    return () => { active = false; };
  }, [backgroundImage]);

  return (
    <div className="flex h-full min-h-0 overflow-hidden relative" style={{ background: 'transparent' }}>
      {/* Пользовательский фон (.prtheme / Appearance) */}
      <div aria-hidden className="pointer-events-none absolute inset-0" style={{
        backgroundImage: backgroundSrc ? `url("${backgroundSrc}")` : 'none',
        backgroundSize: 'var(--custom-bg-size, cover)',
        backgroundRepeat: 'var(--custom-bg-repeat, no-repeat)',
        backgroundPosition: 'var(--custom-bg-position, center)',
        opacity: 'var(--custom-bg-opacity, 0.35)',
        filter: 'blur(var(--custom-bg-blur, 0px)) saturate(var(--custom-bg-saturation, 100%))',
        transform: 'scale(var(--custom-bg-scale, 1))',
      }} />
      <div aria-hidden className="pointer-events-none absolute inset-0" style={{ background:'rgba(4, 6, 12, var(--custom-bg-readability, 0.48))' }} />
      {/* Clean mode intentionally has no decorative ambient glows. */}
      {themeId !== 'clean' && <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className="absolute rounded-full" style={{
          width: 520, height: 520, top: -180, left: -140,
          background: 'radial-gradient(circle, color-mix(in srgb, var(--color-primary) 26%, transparent), transparent 70%)',
          filter: 'blur(70px)',
          opacity: 'var(--portal-accent-glow-opacity, 1)',
        }} />
        <div className="absolute rounded-full" style={{
          width: 560, height: 560, bottom: -220, right: -160,
          background: 'radial-gradient(circle, rgba(120,20,32,0.30), transparent 70%)',
          filter: 'blur(80px)',
          opacity: 'var(--portal-accent-glow-opacity, 1)',
        }} />
      </div>}

      {navMode === 'sidebar' && <TopNav />}
      <main className="flex-1 min-w-0 min-h-0 overflow-hidden relative z-10">
        <div className="h-full min-h-0 w-full">
          {children}
        </div>
      </main>
      {navMode === 'notch' && <TopNav />}
    </div>
  );
}

import { ReactNode, useEffect, useState } from 'react';
import { TopNav } from './TopNav';
import { useUiStore } from '@/stores/uiStore';
import { loadBackgroundMedia } from '@/lib/background-media';

export function MainLayout({ children }: { children: ReactNode }) {
  const navMode = useUiStore(s => s.navMode);
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
    <div className="portal-workspace-material flex h-full min-h-0 overflow-hidden relative" style={{ background: 'transparent' }}>
      {/* Пользовательский фон (.prtheme / Appearance) */}
      <div aria-hidden className="portal-background-layer pointer-events-none absolute inset-0" style={{
        backgroundImage: backgroundSrc ? `url("${backgroundSrc}")` : 'none',
        backgroundSize: 'var(--custom-bg-size, cover)',
        backgroundRepeat: 'var(--custom-bg-repeat, no-repeat)',
        backgroundPosition: 'var(--custom-bg-position, center)',
        opacity: 'var(--custom-bg-opacity, 0.35)',
        filter: 'blur(var(--custom-bg-blur, 0px)) saturate(var(--custom-bg-saturation, 100%))',
        transform: 'scale(var(--custom-bg-scale, 1))',
      }} />
      <div aria-hidden className="portal-background-scrim pointer-events-none absolute inset-0" style={{ background:'rgba(4, 6, 12, var(--custom-bg-readability, 0.48))' }} />
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

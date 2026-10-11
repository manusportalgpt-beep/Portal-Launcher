import { ReactNode, useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { TopNav } from './TopNav';
import { useUiStore } from '@/stores/uiStore';
import { loadBackgroundMedia } from '@/lib/background-media';
import { PixelField } from '@/components/effects/PixelField';

export function MainLayout({ children, extendedAccent, extendedCompact, extendedIcons, extendedOrder }: {
  children: ReactNode;
  extendedAccent?: string;
  extendedCompact?: boolean;
  extendedIcons?: Record<string, string>;
  extendedOrder?: string[];
}) {
  const navMode = useUiStore(s => s.navMode);
  const backgroundImage = useUiStore(s => s.backgroundImage);
  const particleFieldEnabled = useUiStore(s => s.particleFieldEnabled);
  const [backgroundSrc, setBackgroundSrc] = useState('');
  const location = useLocation();
  // Сетка пикселей рисуется здесь, а не внутри страницы чата. Раньше канвас
  // лежал внутри <main class="relative z-10">, а это собственный контекст
  // наложения, поэтому сетка всегда оказывалась поверх сайдбара. Здесь она
  // обычный слой под навигацией и содержимым.
  const showPixelField = particleFieldEnabled && location.pathname === '/openportal';

  useEffect(() => {
    let active = true;
    void loadBackgroundMedia(backgroundImage).then(src => {
      if (active) setBackgroundSrc(src);
    });
    return () => { active = false; };
  }, [backgroundImage]);

  return (
    <div className="portal-workspace-material flex h-full min-h-0 overflow-hidden relative" style={{
      background: 'transparent',
      ...(extendedAccent ? { ['--ext-accent' as string]: extendedAccent, ['--color-primary' as string]: extendedAccent } : {}),
    }}>
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
      {showPixelField && <PixelField className="pointer-events-none absolute inset-0 z-0 h-full w-full" />}
      {navMode === 'sidebar' && <TopNav extendedAccent={extendedAccent} extendedCompact={extendedCompact} extendedIcons={extendedIcons} extendedOrder={extendedOrder} />}
      <main className="flex-1 min-w-0 min-h-0 overflow-hidden relative z-10">
        <div className="h-full min-h-0 w-full">
          {children}
        </div>
      </main>
      {navMode === 'notch' && <TopNav extendedAccent={extendedAccent} extendedCompact={extendedCompact} extendedIcons={extendedIcons} extendedOrder={extendedOrder} />}
    </div>
  );
}

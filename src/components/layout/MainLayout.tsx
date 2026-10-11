import { ReactNode, useEffect, useState } from 'react';
import { TopNav } from './TopNav';
import { useUiStore } from '@/stores/uiStore';
import { loadBackgroundMedia } from '@/lib/background-media';

export function MainLayout({ children, extendedAccent, extendedCompact, extendedIcons, extendedOrder }: {
  children: ReactNode;
  extendedAccent?: string;
  extendedCompact?: boolean;
  extendedIcons?: Record<string, string>;
  extendedOrder?: string[];
}) {
  const navMode = useUiStore(s => s.navMode);
  const backgroundImage = useUiStore(s => s.backgroundImage);
  const backgroundImageStored = useUiStore(s => s.backgroundImageStored);
  const backgroundVideo = useUiStore(s => s.backgroundVideo);
  const backgroundEnabled = useUiStore(s => s.backgroundEnabled);
  const backgroundReadability = useUiStore(s => s.backgroundReadability);
  const [backgroundSrc, setBackgroundSrc] = useState('');

  useEffect(() => {
    let active = true;
    void loadBackgroundMedia(backgroundImage).then(src => {
      if (active) setBackgroundSrc(src);
    });
    return () => { active = false; };
  }, [backgroundImage]);

  return (
    <div className="portal-workspace-material flex h-full min-h-0 overflow-hidden relative" style={{
      background: backgroundEnabled && (backgroundImage || backgroundImageStored || backgroundVideo) ? 'transparent' : 'var(--color-bg)',
      ...(extendedAccent ? { ['--ext-accent' as string]: extendedAccent, ['--color-primary' as string]: extendedAccent } : {}),
    }}>
      {/* Пользовательский фон (.prtheme / Appearance) */}
      <div aria-hidden className="portal-background-layer pointer-events-none absolute inset-0" style={{
        backgroundImage: backgroundEnabled && backgroundSrc ? `url("${backgroundSrc}")` : 'none',
        backgroundSize: 'var(--custom-bg-size, cover)',
        backgroundRepeat: 'var(--custom-bg-repeat, no-repeat)',
        backgroundPosition: 'var(--custom-bg-position, center)',
        opacity: backgroundEnabled ? 'var(--custom-bg-opacity, 0.35)' : 0,
        filter: 'blur(var(--custom-bg-blur, 0px)) saturate(var(--custom-bg-saturation, 100%))',
        transform: 'scale(var(--custom-bg-scale, 1))',
      }} />
      {backgroundEnabled && backgroundSrc && <div aria-hidden className="portal-background-scrim pointer-events-none absolute inset-0" style={{ background:`rgba(4, 6, 12, ${Math.max(0, Math.min(90, backgroundReadability)) / 100})` }} />}
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

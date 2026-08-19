import { useEffect, useState } from 'react';
import { useUiStore } from '@/stores/uiStore';
import { loadBackgroundMedia } from '@/lib/background-media';

/** Optional local video background. It stays behind every interactive surface. */
export function BackgroundVideo() {
  const video = useUiStore(state => state.backgroundVideo);
  const opacity = useUiStore(state => state.backgroundVideoOpacity);
  const muted = useUiStore(state => state.backgroundVideoMuted);
  const readability = useUiStore(state => state.backgroundReadability);
  const [videoSrc, setVideoSrc] = useState('');
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let active = true;
    setFailed(false);
    setVideoSrc('');
    void loadBackgroundMedia(video).then(src => {
      if (active) setVideoSrc(src);
    });
    return () => { active = false; };
  }, [video]);

  if (!videoSrc || failed) return null;

  return (
    <>
      <video
        key={videoSrc}
        className="pointer-events-none fixed inset-0 z-0 h-full w-full object-cover"
        src={videoSrc}
        autoPlay
        loop
        muted={muted}
        playsInline
        preload="auto"
        aria-hidden="true"
        onError={() => setFailed(true)}
        onCanPlay={event => {
          const element = event.currentTarget;
          void element.play().catch(() => {
            // Browsers allow autoplay only when muted; if the user selected
            // sound, keep the visual background and let them start it manually.
          });
        }}
        style={{ opacity: Math.max(0, Math.min(100, opacity)) / 100 }}
      />
      <div
        className="pointer-events-none fixed inset-0 z-[1]"
        aria-hidden="true"
        style={{ background: `rgba(0,0,0,${Math.max(0, Math.min(90, readability)) / 100})` }}
      />
    </>
  );
}

export default BackgroundVideo;

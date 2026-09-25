import { useEffect, useState } from 'react';
import { useUiStore } from '@/stores/uiStore';
import { loadBackgroundMedia } from '@/lib/background-media';

/**
 * Фоновый слой лаунчера: загруженная картинка/gif и/или видео. Всё хранится в
 * IndexedDB, потому что data-URL в localStorage не помещается (квота ~5 МБ).
 * Слой остаётся позади интерфейса и полностью подчиняется общему выключателю
 * фонового режима.
 */
export function BackgroundVideo() {
  const enabled = useUiStore(state => state.backgroundEnabled);
  const video = useUiStore(state => state.backgroundVideo);
  const storedImage = useUiStore(state => state.backgroundImageStored);
  const videoOpacity = useUiStore(state => state.backgroundVideoOpacity);
  const imageOpacity = useUiStore(state => state.backgroundOpacity);
  const muted = useUiStore(state => state.backgroundVideoMuted);
  const readability = useUiStore(state => state.backgroundReadability);
  const [videoSrc, setVideoSrc] = useState('');
  const [imageSrc, setImageSrc] = useState('');
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

  useEffect(() => {
    let active = true;
    setImageSrc('');
    void loadBackgroundMedia(storedImage).then(src => {
      if (active) setImageSrc(src);
    });
    return () => { active = false; };
  }, [storedImage]);

  // Выключенный фоновый режим обязан убирать и видео, и картинку: раньше
  // переключатель в настройках писал в backgroundImage, а видео продолжало
  // играть.
  if (!enabled) return null;

  const hasImage = Boolean(imageSrc);
  const hasVideo = Boolean(videoSrc) && !failed;
  if (!hasImage && !hasVideo) return null;

  const shade = Math.max(0, Math.min(90, readability)) / 100;

  return (
    <>
      {hasImage && (
        <img
          key={imageSrc}
          src={imageSrc}
          alt=""
          aria-hidden="true"
          className="pointer-events-none fixed inset-0 z-0 h-full w-full object-cover"
          style={{ opacity: Math.max(0, Math.min(100, imageOpacity)) / 100 }}
        />
      )}
      {hasVideo && (
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
              // Браузер разрешает автозапуск только без звука; если пользователь
              // выбрал звук, визуальный фон остаётся — запустить можно вручную.
            });
          }}
          style={{ opacity: Math.max(0, Math.min(100, videoOpacity)) / 100 }}
        />
      )}
      <div
        className="pointer-events-none fixed inset-0 z-[1]"
        aria-hidden="true"
        style={{ background: `rgba(0,0,0,${shade})` }}
      />
    </>
  );
}

export default BackgroundVideo;

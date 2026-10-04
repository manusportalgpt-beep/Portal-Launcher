import { useEffect, useRef, useState } from 'react';
import { useSettingsStore } from '@/stores/settingsStore';
import { MusicCard } from '@/components/uiverse/MusicCard';

export function BackgroundMusicPlayer() {
  const music = useSettingsStore(s => s.backgroundMusic);
  const name = useSettingsStore(s => s.backgroundMusicName);
  const volume = useSettingsStore(s => s.musicVolume);
  const loop = useSettingsStore(s => s.musicLoop);
  const autoplay = useSettingsStore(s => s.musicAutoplay);
  const position = useSettingsStore(s => s.musicPlayerPosition);
  const updateSettings = useSettingsStore(s => s.update);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [playing, setPlaying] = useState(false);
  const dragRef = useRef<{ pointerId: number; offsetX: number; offsetY: number } | null>(null);

  useEffect(() => {
    if (!audioRef.current) audioRef.current = new Audio();
    const audio = audioRef.current;
    audio.src = music;
    const onPlay = () => setPlaying(true);
    const onPause = () => setPlaying(false);
    audio.addEventListener('play', onPlay);
    audio.addEventListener('pause', onPause);
    if (music && autoplay === 'startup') audio.play().catch(() => setPlaying(false));
    if (!music) { audio.pause(); audio.removeAttribute('src'); audio.load(); }
    return () => { audio.removeEventListener('play', onPlay); audio.removeEventListener('pause', onPause); };
  }, [music, autoplay]);

  useEffect(() => {
    if (!audioRef.current) return;
    audioRef.current.loop = loop;
    audioRef.current.volume = Math.max(0, Math.min(100, volume)) / 100;
  }, [volume, loop]);

  if (!music) return null;
  const toggle = () => {
    const audio = audioRef.current;
    if (!audio) return;
    if (audio.paused) audio.play().catch(() => setPlaying(false)); else audio.pause();
  };

  const beginDrag = (event: React.PointerEvent<HTMLButtonElement>) => {
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = { pointerId: event.pointerId, offsetX: event.clientX - position.x, offsetY: event.clientY - position.y };
  };
  const drag = (event: React.PointerEvent<HTMLButtonElement>) => {
    const active = dragRef.current;
    if (!active || active.pointerId !== event.pointerId) return;
    updateSettings({ musicPlayerPosition: { x: Math.max(6, Math.min(window.innerWidth - 178, event.clientX - active.offsetX)), y: Math.max(30, Math.min(window.innerHeight - 42, event.clientY - active.offsetY)) } });
  };
  const endDrag = (event: React.PointerEvent<HTMLButtonElement>) => {
    if (dragRef.current?.pointerId === event.pointerId) dragRef.current = null;
  };

  return (
    <div className="fixed z-40" style={{ left: position.x, top: position.y }}>
      <MusicCard
        name={name}
        playing={playing}
        volume={volume}
        loop={loop}
        onToggle={toggle}
        onBeginDrag={beginDrag}
        onDrag={drag}
        onEndDrag={endDrag}
      />
    </div>
  );
}

import { useEffect, useRef, useState } from 'react';
import { Music2, Pause, Play, Repeat2, Volume2 } from 'lucide-react';
import { useSettingsStore } from '@/stores/settingsStore';

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
    <div className="fixed z-40 flex w-[172px] items-center gap-1.5 rounded-lg px-1.5 py-1" style={{ left:position.x, top:position.y, background:'color-mix(in srgb, var(--color-surface) 92%, transparent)', border:'1px solid var(--color-border)', backdropFilter:'blur(14px)', boxShadow:'var(--shadow-sm)' }}>
      <button onPointerDown={beginDrag} onPointerMove={drag} onPointerUp={endDrag} onPointerCancel={endDrag} className="flex h-5 w-4 shrink-0 cursor-grab touch-none items-center justify-center active:cursor-grabbing" title="Перетащить плеер"><Music2 className="h-2.5 w-2.5" style={{ color:'var(--color-primary)' }} /></button>
      <button onClick={toggle} className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md" style={{ background:'var(--color-primary)', color:'var(--color-primary-text)' }} title={playing ? 'Пауза' : 'Воспроизвести'}>{playing ? <Pause className="h-3 w-3" /> : <Play className="ml-0.5 h-3 w-3" />}</button>
      <div className="min-w-0 flex-1"><span className="block truncate text-[9px] font-black" style={{ color:'var(--color-text)' }}>{name || 'Фоновая музыка'}</span><div className="flex items-center gap-1"><Volume2 className="h-2 w-2" style={{ color:'var(--color-text-tertiary)' }} /><span className="text-[8px]" style={{ color:'var(--color-text-secondary)' }}>{volume}%</span>{loop && <Repeat2 className="ml-auto h-2 w-2" style={{ color:'var(--color-primary)' }} />}</div></div>
    </div>
  );
}

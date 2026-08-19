import { useEffect, useRef, useState } from 'react';
import { Music2, Pause, Play, Repeat2, Volume2 } from 'lucide-react';
import { useSettingsStore } from '@/stores/settingsStore';

export function BackgroundMusicPlayer() {
  const music = useSettingsStore(s => s.backgroundMusic);
  const name = useSettingsStore(s => s.backgroundMusicName);
  const volume = useSettingsStore(s => s.musicVolume);
  const loop = useSettingsStore(s => s.musicLoop);
  const autoplay = useSettingsStore(s => s.musicAutoplay);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [playing, setPlaying] = useState(false);

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

  return (
    <div className="fixed left-3 top-10 z-40 flex max-w-[230px] items-center gap-2 rounded-xl px-2 py-1.5" style={{ background:'color-mix(in srgb, var(--color-surface) 92%, transparent)', border:'1px solid var(--color-border)', backdropFilter:'blur(14px)', boxShadow:'var(--shadow-sm)' }}>
      <button onClick={toggle} className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg" style={{ background:'var(--color-primary)', color:'var(--color-primary-text)' }} title={playing ? 'Pause background music' : 'Play background music'}>{playing ? <Pause className="h-3.5 w-3.5" /> : <Play className="ml-0.5 h-3.5 w-3.5" />}</button>
      <div className="min-w-0 flex-1"><div className="flex items-center gap-1"><Music2 className="h-3 w-3 shrink-0" style={{ color:'var(--color-primary)' }} /><span className="truncate text-[10px] font-black" style={{ color:'var(--color-text)' }}>{name || 'Background music'}</span></div><div className="mt-0.5 flex items-center gap-1"><Volume2 className="h-2.5 w-2.5" style={{ color:'var(--color-text-tertiary)' }} /><span className="text-[9px]" style={{ color:'var(--color-text-secondary)' }}>{volume}%</span>{loop && <Repeat2 className="ml-auto h-2.5 w-2.5" style={{ color:'var(--color-primary)' }} />}</div></div>
    </div>
  );
}

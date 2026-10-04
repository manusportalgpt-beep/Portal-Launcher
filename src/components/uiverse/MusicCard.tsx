import { Pause, Play, Repeat2, Volume2 } from 'lucide-react';

interface MusicCardProps {
  name: string;
  playing: boolean;
  volume: number;
  loop: boolean;
  currentTime: number;
  duration: number;
  onToggle: () => void;
  onToggleLoop: () => void;
  onSeek: (value: number) => void;
  onVolumeChange: (value: number) => void;
  onBeginDrag: (event: React.PointerEvent<HTMLButtonElement>) => void;
  onDrag: (event: React.PointerEvent<HTMLButtonElement>) => void;
  onEndDrag: (event: React.PointerEvent<HTMLButtonElement>) => void;
}

/**
 * Локальная React-обёртка над музыкальной карточкой Uiverse.
 * Управление аудио остаётся в BackgroundMusicPlayer, компонент отвечает только
 * за отображение и передачу pointer-событий перетаскивания.
 */
export function MusicCard({
  name,
  playing,
  volume,
  loop,
  currentTime,
  duration,
  onToggle,
  onToggleLoop,
  onSeek,
  onVolumeChange,
  onBeginDrag,
  onDrag,
  onEndDrag,
}: MusicCardProps) {
  const formatTime = (value: number) => {
    if (!Number.isFinite(value) || value < 0) return '0:00';
    const minutes = Math.floor(value / 60);
    const seconds = Math.floor(value % 60).toString().padStart(2, '0');
    return `${minutes}:${seconds}`;
  };

  return (
    <div className="uiv-music-card" role="group" aria-label="Фоновая музыка">
      <div className="uiv-music-card__top">
        <button
          type="button"
          className="uiv-music-card__drag"
          onPointerDown={onBeginDrag}
          onPointerMove={onDrag}
          onPointerUp={onEndDrag}
          onPointerCancel={onEndDrag}
          title="Перетащить плеер"
          aria-label="Перетащить плеер"
        >
          <span className="uiv-music-card__disc" aria-hidden="true" />
        </button>
        <div className="uiv-music-card__meta">
          <strong title={name}>{name || 'Фоновая музыка'}</strong>
          <span>{playing ? 'Воспроизводится' : 'Пауза'}</span>
        </div>
        <button
          type="button"
          className="uiv-music-card__play"
          onClick={onToggle}
          title={playing ? 'Пауза' : 'Воспроизвести'}
          aria-label={playing ? 'Пауза' : 'Воспроизвести'}
        >
          {playing ? <Pause size={13} /> : <Play size={13} />}
        </button>
      </div>
      <div className="uiv-music-card__visualizer" aria-hidden="true">
        {[0, 1, 2, 3, 4].map(index => <i key={index} className={playing ? `is-playing delay-${index}` : ''} />)}
      </div>
      <div className="uiv-music-card__progress">
        <input
          type="range"
          min={0}
          max={Math.max(duration, 0)}
          step={0.1}
          value={Math.min(currentTime, duration || 0)}
          onChange={event => onSeek(Number(event.target.value))}
          disabled={!duration}
          aria-label="Позиция трека"
        />
        <span>{formatTime(currentTime)} / {formatTime(duration)}</span>
      </div>
      <div className="uiv-music-card__footer">
        <label className="uiv-music-card__volume" title="Громкость">
          <Volume2 size={11} />
          <input
            type="range"
            min={0}
            max={100}
            value={volume}
            onChange={event => onVolumeChange(Number(event.target.value))}
            aria-label="Громкость"
          />
          <span>{volume}%</span>
        </label>
        <button type="button" className={`uiv-music-card__loop${loop ? ' is-active' : ''}`} onClick={onToggleLoop} title={loop ? 'Выключить повтор' : 'Включить повтор'}>
          <Repeat2 size={11} />
          <span>Повтор</span>
        </button>
      </div>
    </div>
  );
}

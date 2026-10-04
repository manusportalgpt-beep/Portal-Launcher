import { Pause, Play, Repeat2, Volume2 } from 'lucide-react';

interface MusicCardProps {
  name: string;
  playing: boolean;
  volume: number;
  loop: boolean;
  onToggle: () => void;
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
  onToggle,
  onBeginDrag,
  onDrag,
  onEndDrag,
}: MusicCardProps) {
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
      <div className="uiv-music-card__footer">
        <span><Volume2 size={11} /> {volume}%</span>
        {loop && <span title="Повтор включён"><Repeat2 size={11} /> Повтор</span>}
      </div>
    </div>
  );
}

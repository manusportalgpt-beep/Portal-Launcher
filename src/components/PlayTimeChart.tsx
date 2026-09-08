import { useMemo } from 'react';
import { Clock, BarChart3 } from 'lucide-react';

interface Props {
  totalPlayTime: number;
  lastPlayed?: string;
  sessions?: Array<{ date: string; minutes: number }>;
}

function formatMinutes(minutes: number): string {
  if (!minutes) return '0';
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return h ? `${h}ч ${m ? `${m}м` : ''}`.trim() : `${m}м`;
}

function formatRelative(date?: string): string {
  if (!date) return 'Никогда';
  const days = Math.floor((Date.now() - new Date(date).getTime()) / 86_400_000);
  if (days === 0) return 'Сегодня';
  if (days === 1) return 'Вчера';
  if (days < 7) return `${days} дн. назад`;
  return new Date(date).toLocaleDateString('ru-RU');
}

/** Mini bar chart showing play sessions over the last 14 days. */
export function PlayTimeChart({ totalPlayTime, lastPlayed, sessions = [] }: Props) {
  const bars = useMemo(() => {
    const now = new Date();
    const days: Array<{ label: string; value: number; date: string }> = [];
    for (let i = 13; i >= 0; i--) {
      const d = new Date(now);
      d.setDate(d.getDate() - i);
      const key = d.toISOString().slice(0, 10);
      const label = d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' });
      const matched = sessions.filter(s => s.date === key);
      const total = matched.reduce((sum, s) => sum + s.minutes, 0);
      days.push({ label, value: total, date: key });
    }
    return days;
  }, [sessions]);

  const maxVal = Math.max(1, ...bars.map(b => b.value));

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Clock className="h-4 w-4" style={{ color: 'var(--color-primary)' }} />
          <span className="text-sm font-bold" style={{ color: 'var(--color-text)' }}>Время игры</span>
        </div>
        <div className="flex items-center gap-2 text-xs" style={{ color: 'var(--color-text-secondary)' }}>
          <BarChart3 className="h-3.5 w-3.5" />
          <span className="font-bold">{formatMinutes(totalPlayTime)}</span>
          <span>всего</span>
        </div>
      </div>

      <div className="flex items-end gap-1 h-20 px-1">
        {bars.map((bar, i) => (
          <div key={i} className="flex-1 flex flex-col items-center gap-1 group" title={`${bar.label}: ${formatMinutes(bar.value)}`}>
            <div className="w-full rounded-t transition-all"
              style={{
                height: bar.value > 0 ? `${Math.max(8, (bar.value / maxVal) * 100)}%` : 2,
                background: bar.value > 0 ? 'var(--color-primary)' : 'var(--color-border)',
                opacity: bar.value > 0 ? 1 : 0.4,
              }} />
          </div>
        ))}
      </div>

      <div className="flex items-center justify-between text-[9px]" style={{ color: 'var(--color-text-tertiary)' }}>
        <span>{bars[0]?.label}</span>
        <span>Последняя сессия: {formatRelative(lastPlayed)}</span>
        <span>{bars[bars.length - 1]?.label}</span>
      </div>
    </div>
  );
}

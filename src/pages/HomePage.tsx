import { ArrowRight, ArrowUpRight, Boxes, CalendarClock, Compass, FolderPlus, Gamepad2, Library, Play, Rocket, Search, ShieldCheck, Wand2 } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useCurrentUser, useIsAuthenticated } from '@/stores/authStore';
import { useInstanceStore } from '@/stores/instanceStore';
import { toIconSrc } from '@/lib/icon-src';

function relativeDate(value?: string) {
  if (!value) return 'Ещё не запускалась';
  const days = Math.max(0, Math.floor((Date.now() - new Date(value).getTime()) / 86_400_000));
  return days === 0 ? 'Запускалась сегодня' : days === 1 ? 'Запускалась вчера' : `Запускалась ${days} дн. назад`;
}

export function HomePage() {
  const navigate = useNavigate();
  const user = useCurrentUser();
  const signedIn = useIsAuthenticated();
  const instances = useInstanceStore(state => state.instances);
  const recent = [...instances].sort((a, b) => new Date(b.lastPlayed || b.createdAt).getTime() - new Date(a.lastPlayed || a.createdAt).getTime()).slice(0, 4);
  const playHours = Math.round(instances.reduce((sum, item) => sum + (item.totalPlayTime || 0), 0) / 60);
  const activeCount = instances.filter(item => item.lastPlayed).length;
  const nextAction = !signedIn
    ? { icon: ShieldCheck, eyebrow: 'Учётная запись', title: 'Подключите игровой аккаунт', text: 'Microsoft, Ely.by и другие доступные способы входа находятся в настройках аккаунта.', label: 'Открыть аккаунты', to: '/settings/account' }
    : !instances.length
      ? { icon: FolderPlus, eyebrow: 'Первая сборка', title: 'Создайте или импортируйте сборку', text: 'Выберите версию Minecraft либо импортируйте MRPACK или ZIP с предварительным просмотром manifest.', label: 'Создать сборку', to: '/library?create=1' }
      : { icon: Rocket, eyebrow: 'Следующий шаг', title: 'Продолжайте играть', text: 'Откройте библиотеку, чтобы запустить, настроить или дополнить одну из своих сборок.', label: 'К библиотеке', to: '/library' };
  const NextIcon = nextAction.icon;

  return <div className="h-full overflow-y-auto px-4 py-4 sm:px-7 sm:py-6">
    <main className="mx-auto flex max-w-7xl flex-col gap-3 pb-16">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold" style={{ color: 'var(--color-text)' }}>Библиотека</h1>
          <p className="mt-1 truncate text-sm" style={{ color: 'var(--color-text-secondary)' }}>{signedIn ? `С возвращением, ${user?.username || 'игрок'}` : 'Сборки, проекты и настройки Portal Launcher'}</p>
        </div>
        <div className="flex shrink-0 items-center gap-2" aria-label="Сводка библиотеки">
          {[{ icon: Library, value: String(instances.length), label: 'сборок' }, { icon: Gamepad2, value: playHours ? `${playHours} ч` : '—', label: 'в игре' }, { icon: Boxes, value: String(activeCount), label: 'запускались' }].map(stat => <div key={stat.label} className="flex items-center gap-2 rounded-lg px-2.5 py-2" style={{ background: 'var(--color-surface-2)', border: '1px solid var(--color-border)' }}><stat.icon className="h-3.5 w-3.5" style={{ color: 'var(--color-primary)' }} /><span className="text-xs font-black tabular-nums" style={{ color: 'var(--color-text)' }}>{stat.value}</span><span className="hidden text-[10px] font-semibold sm:inline" style={{ color: 'var(--color-text-tertiary)' }}>{stat.label}</span></div>)}
        </div>
      </header>

      <section aria-label="Действия библиотеки" className="flex flex-col gap-2">
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={() => navigate(signedIn ? '/library' : '/settings/account')} className="dbtn inline-flex min-h-10 items-center gap-2 px-3.5 py-2 text-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-primary)]">{signedIn ? <><Play className="h-4 w-4" />Открыть библиотеку</> : <><ShieldCheck className="h-4 w-4" />Войти в аккаунт</>}</button>
          <button type="button" onClick={() => navigate('/discover')} className="dbtn dbtn-ghost inline-flex min-h-10 items-center gap-2 px-3.5 py-2 text-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-primary)]"><Search className="h-4 w-4" />Найти проект</button>
          <button type="button" onClick={() => navigate('/library?create=1')} className="dbtn dbtn-primary inline-flex min-h-10 items-center gap-2 px-3.5 py-2 text-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-primary)]"><FolderPlus className="h-4 w-4" />Новая сборка</button>
        </div>
        <div className="flex min-h-10 flex-wrap items-center gap-x-3 gap-y-1 border-y px-0.5 py-2" style={{ borderColor: 'var(--color-border)' }}>
          <span className="text-xs font-semibold" style={{ color: 'var(--color-text-secondary)' }}>{nextAction.eyebrow}</span>
          <span className="hidden h-4 w-px sm:block" style={{ background: 'var(--color-border)' }} />
          <button type="button" onClick={() => navigate(nextAction.to)} className="group inline-flex min-w-0 items-center gap-1.5 text-left text-xs font-semibold focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-primary)]" style={{ color: 'var(--color-primary)' }}><NextIcon className="h-3.5 w-3.5 shrink-0" /><span className="min-w-0"><span className="block truncate">{nextAction.title}</span><span className="hidden max-w-xl truncate text-[10px] font-medium lg:block" style={{ color: 'var(--color-text-secondary)' }}>{nextAction.text}</span></span><span className="hidden shrink-0 text-[10px] font-bold sm:inline">{nextAction.label}</span><ArrowRight className="h-3.5 w-3.5 shrink-0 transition-transform group-hover:translate-x-0.5" /></button>
        </div>
      </section>

      <section aria-labelledby="recent-instances-heading">
        <div className="flex h-10 items-center gap-2 border-b" style={{ borderColor: 'var(--color-border)' }}>
          <h2 id="recent-instances-heading" className="min-w-0 text-base font-semibold" style={{ color: 'var(--color-text)' }}>{recent.length ? 'Недавние сборки' : 'Сборки'}</h2>
          {instances.length > 0 && <span className="rounded-md px-1.5 py-0.5 text-[10px] font-bold tabular-nums" style={{ background: 'var(--color-surface-2)', color: 'var(--color-text-secondary)', border: '1px solid var(--color-border)' }}>{instances.length}</span>}
          <span className="min-w-0 flex-1" />
          <button type="button" onClick={() => navigate('/library')} className="inline-flex min-h-9 items-center gap-1 rounded-md px-2 text-xs font-semibold focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-primary)]" style={{ color: 'var(--color-primary)' }}>Вся библиотека <ArrowRight className="h-3.5 w-3.5" /></button>
        </div>
        {recent.length ? <div className="mt-2.5 grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">{recent.map(instance => { const icon = toIconSrc(instance.iconPath); return <button key={instance.id} type="button" onClick={() => navigate('/library')} className="group relative flex min-w-0 flex-col overflow-hidden rounded-xl border p-3 text-left transition-[background-color,border-color,filter] hover:brightness-110 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-primary)]" style={{ background: 'var(--color-surface-2)', borderColor: 'var(--color-border)' }}><span className="relative flex aspect-square w-full items-center justify-center overflow-hidden rounded-lg" style={{ background: 'var(--color-surface-3)', border: `1px solid ${instance.color || 'var(--color-border)'}`, color: instance.color || 'var(--color-primary)' }}>{icon ? <img src={icon} className="h-full w-full object-cover" alt="" /> : <Boxes className="h-8 w-8" />}<span className="absolute right-2 top-2 flex h-8 w-8 items-center justify-center rounded-md opacity-0 transition-opacity group-hover:opacity-100" style={{ background: 'var(--color-surface-2)', color: 'var(--color-primary)', border: '1px solid var(--color-border)' }}><ArrowUpRight className="h-4 w-4" /></span></span><span className="mt-3 block min-w-0 px-0.5"><span className="block truncate text-base font-semibold leading-5" style={{ color: 'var(--color-text)' }}>{instance.name}</span><span className="mt-1 block truncate text-sm font-medium" style={{ color: 'var(--color-primary)' }}>{instance.modLoader} {instance.minecraftVersion}</span><span className="mt-2 block truncate text-[10px]" style={{ color: 'var(--color-text-tertiary)' }}>{relativeDate(instance.lastPlayed)}</span></span></button>; })}</div> : <div className="mt-2.5 flex min-h-[180px] flex-col items-center justify-center rounded-xl border border-dashed px-6 py-8 text-center" style={{ background: 'var(--color-surface-2)', borderColor: 'var(--color-border)' }}><Library className="h-7 w-7" style={{ color: 'var(--color-primary)' }} /><p className="mt-3 text-sm font-semibold" style={{ color: 'var(--color-text)' }}>Библиотека пока пуста</p><p className="mt-1 max-w-md text-xs leading-relaxed" style={{ color: 'var(--color-text-secondary)' }}>Создайте новую сборку или импортируйте готовый MRPACK либо ZIP в библиотеке.</p><button type="button" onClick={() => navigate('/library?create=1')} className="dbtn dbtn-primary mt-4 inline-flex min-h-10 items-center gap-2 px-3.5 py-2 text-xs focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-primary)]"><FolderPlus className="h-3.5 w-3.5" />Создать сборку</button></div>}
      </section>

      <section aria-label="Другие действия" className="grid gap-2 md:grid-cols-3">{[{ icon: Compass, title: 'Найти проект', text: 'Моды, модпаки, ресурс-паки и шейдеры.', to: '/discover' }, { icon: Wand2, title: 'Оформление', text: 'Тема, фон, панели и вид интерфейса.', to: '/settings?tab=appearance' }, { icon: CalendarClock, title: 'Настроить лаунчер', text: 'Java, память, управление и аккаунты.', to: '/settings' }].map(action => <button key={action.title} type="button" onClick={() => navigate(action.to)} className="group flex min-h-16 items-center gap-3 rounded-lg border px-3 text-left transition-[background-color,border-color] hover:bg-[var(--color-surface-2)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-primary)]" style={{ background: 'var(--color-surface)', borderColor: 'var(--color-border)' }}><span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md" style={{ background: 'var(--color-surface-2)', color: 'var(--color-primary)' }}><action.icon className="h-4 w-4" /></span><span className="min-w-0 flex-1"><span className="block text-xs font-semibold" style={{ color: 'var(--color-text)' }}>{action.title}</span><span className="mt-1 block truncate text-[10px]" style={{ color: 'var(--color-text-secondary)' }}>{action.text}</span></span><ArrowRight className="h-4 w-4 shrink-0 opacity-0 transition-[opacity,transform] group-hover:translate-x-0.5 group-hover:opacity-100" style={{ color: 'var(--color-primary)' }} /></button>)}</section>
    </main>
  </div>;
}

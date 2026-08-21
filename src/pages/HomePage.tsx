import { motion } from 'framer-motion';
import { ArrowRight, ArrowUpRight, Boxes, CalendarClock, Compass, FolderPlus, Gamepad2, Library, Play, Rocket, Search, ShieldCheck, Sparkles, Wand2 } from 'lucide-react';
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
    <main className="mx-auto max-w-7xl space-y-4 pb-6">
      <motion.section initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.18 }} className="clean-home-hero relative overflow-hidden rounded-md p-5 sm:p-7" style={{ background: 'transparent', border: '1px solid var(--color-border)', boxShadow: 'none' }}>
        <div className="relative grid gap-7 xl:grid-cols-[minmax(0,1fr)_340px] xl:items-end">
          <div className="max-w-3xl">
            <span className="inline-flex items-center gap-2 rounded-sm px-2.5 py-1 text-[10px] font-black uppercase tracking-[0.14em]" style={{ background: 'transparent', color: 'var(--color-primary)', border: '1px solid var(--color-primary)' }}><Sparkles className="h-3.5 w-3.5" /> Portal Launcher</span>
            <h1 className="mt-4 text-3xl font-black tracking-tight sm:text-4xl" style={{ color: 'var(--color-text)' }}>{signedIn ? `С возвращением, ${user?.username || 'игрок'}` : 'Minecraft — в вашем ритме'}</h1>
            <p className="mt-3 max-w-2xl text-sm leading-relaxed" style={{ color: 'var(--color-text-secondary)' }}>{signedIn ? 'Открывайте сборки, находите новые проекты и управляйте всей библиотекой из одного понятного пространства.' : 'Войдите в игровой аккаунт, создайте первую сборку и настройте лаунчер под свой стиль.'}</p>
            <div className="mt-6 flex flex-wrap gap-2">
              <button type="button" onClick={() => navigate(signedIn ? '/library' : '/settings/account')} className="inline-flex items-center gap-2 rounded-sm px-4 py-2.5 text-sm font-black transition-colors" style={{ background: 'var(--color-primary)', color: 'var(--color-primary-text)', boxShadow: 'none' }}>{signedIn ? <><Play className="h-4 w-4 fill-current" />Мои сборки</> : <><ShieldCheck className="h-4 w-4" />Войти в аккаунт</>}</button>
              <button type="button" onClick={() => navigate('/library?create=1')} className="inline-flex items-center gap-2 rounded-sm px-4 py-2.5 text-sm font-bold transition-colors" style={{ background: 'transparent', color: 'var(--color-text)', border: '1px solid var(--color-border)' }}><FolderPlus className="h-4 w-4" />Новая сборка</button>
              <button type="button" onClick={() => navigate('/discover')} className="inline-flex items-center gap-2 rounded-xl px-3.5 py-2.5 text-sm font-bold transition-colors hover:bg-white/5" style={{ color: 'var(--color-text-secondary)' }}><Compass className="h-4 w-4" />Найти проект</button>
            </div>
          </div>
          <div className="grid grid-cols-3 gap-2">
            {[{ icon: Library, value: String(instances.length), label: 'Сборок' }, { icon: Gamepad2, value: playHours ? `${playHours} ч` : '—', label: 'В игре' }, { icon: Boxes, value: String(activeCount), label: 'Запускались' }].map(stat => <div key={stat.label} className="clean-home-stat rounded-sm p-3" style={{ background: 'transparent', border: '1px solid var(--color-border)' }}><stat.icon className="h-4 w-4" style={{ color: 'var(--color-primary)' }} /><p className="mt-5 text-lg font-black leading-none" style={{ color: 'var(--color-text)' }}>{stat.value}</p><p className="mt-1.5 text-[10px] font-semibold" style={{ color: 'var(--color-text-tertiary)' }}>{stat.label}</p></div>)}
          </div>
        </div>
      </motion.section>

      <section className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_300px]">
        <div className="clean-home-panel rounded-md p-4 sm:p-5" style={{ background: 'transparent', border: '1px solid var(--color-border)' }}>
          <div className="mb-4 flex items-center justify-between gap-3"><div><p className="text-[10px] font-black uppercase tracking-[0.15em]" style={{ color: 'var(--color-primary)' }}>Библиотека</p><h2 className="mt-1 text-lg font-black" style={{ color: 'var(--color-text)' }}>{recent.length ? 'Недавние сборки' : 'Пока нет сборок'}</h2></div><button type="button" onClick={() => navigate('/library')} className="inline-flex items-center gap-1 rounded-lg px-2 py-1.5 text-xs font-bold transition-colors hover:bg-white/5" style={{ color: 'var(--color-primary)' }}>Вся библиотека <ArrowRight className="h-3.5 w-3.5" /></button></div>
          {recent.length ? <div className="grid gap-2.5 sm:grid-cols-2 xl:grid-cols-4">{recent.map(instance => { const icon = toIconSrc(instance.iconPath); return <button key={instance.id} type="button" onClick={() => navigate('/library')} className="clean-home-instance group relative flex min-h-[120px] flex-col justify-between overflow-hidden rounded-sm p-3.5 text-left transition-colors" style={{ background: 'transparent', border: '1px solid var(--color-border)' }}><span className="relative flex items-start justify-between gap-3"><span className="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-sm text-sm font-black" style={{ background: 'transparent', border:`1px solid ${instance.color || 'var(--color-primary)'}`, color: instance.color || 'var(--color-primary)' }}>{icon ? <img src={icon} className="h-full w-full object-cover" alt="" /> : instance.name.slice(0, 1).toUpperCase()}</span><ArrowUpRight className="h-4 w-4 opacity-0 transition-opacity group-hover:opacity-100" style={{ color: 'var(--color-primary)' }} /></span><span className="relative mt-4 block min-w-0"><span className="block truncate text-sm font-black" style={{ color: 'var(--color-text)' }}>{instance.name}</span><span className="mt-1 block truncate text-[10px] font-semibold" style={{ color: 'var(--color-text-secondary)' }}>{instance.minecraftVersion} · {instance.modLoader}</span><span className="mt-2 block text-[10px]" style={{ color: 'var(--color-text-tertiary)' }}>{relativeDate(instance.lastPlayed)}</span></span></button>; })}</div> : <div className="clean-home-instance flex min-h-[150px] flex-col items-center justify-center rounded-sm border border-dashed p-6 text-center" style={{ borderColor: 'var(--color-border)', background: 'transparent' }}><Library className="h-7 w-7" style={{ color: 'var(--color-primary)' }} /><p className="mt-3 text-sm font-black" style={{ color: 'var(--color-text)' }}>Создайте свою первую сборку</p><p className="mt-1 max-w-md text-xs leading-relaxed" style={{ color: 'var(--color-text-secondary)' }}>Версия, loader, иконка и содержимое будут сохранены отдельно от остальных сборок.</p><button type="button" onClick={() => navigate('/library?create=1')} className="mt-4 inline-flex items-center gap-2 rounded-sm px-3.5 py-2 text-xs font-black" style={{ background: 'var(--color-primary)', color: 'var(--color-primary-text)' }}><FolderPlus className="h-3.5 w-3.5" />Создать сборку</button></div>}
        </div>
        <aside className="clean-home-next rounded-md p-4 sm:p-5" style={{ background: 'transparent', border: '1px solid var(--color-border)' }}><span className="flex h-10 w-10 items-center justify-center rounded-sm" style={{ background: 'transparent', border:'1px solid var(--color-border)', color: 'var(--color-primary)' }}><NextIcon className="h-[18px] w-[18px]" /></span><p className="mt-5 text-[10px] font-black uppercase tracking-[0.15em]" style={{ color: 'var(--color-primary)' }}>{nextAction.eyebrow}</p><h2 className="mt-2 text-lg font-black leading-tight" style={{ color: 'var(--color-text)' }}>{nextAction.title}</h2><p className="mt-2 text-xs leading-relaxed" style={{ color: 'var(--color-text-secondary)' }}>{nextAction.text}</p><button type="button" onClick={() => navigate(nextAction.to)} className="mt-5 inline-flex items-center gap-2 rounded-sm px-3.5 py-2.5 text-xs font-black" style={{ background: 'var(--color-primary)', color: 'var(--color-primary-text)' }}>{nextAction.label}<ArrowRight className="h-3.5 w-3.5" /></button></aside>
      </section>

      <section className="grid gap-2.5 md:grid-cols-3">{[{ icon: Search, title: 'Найти проект', text: 'Моды, модпаки, ресурс-паки и шейдеры.', to: '/discover' }, { icon: Wand2, title: 'Оформление', text: 'Тема, фон, панели и вид интерфейса.', to: '/settings?tab=appearance' }, { icon: CalendarClock, title: 'Настроить лаунчер', text: 'Java, память, управление и аккаунты.', to: '/settings' }].map(action => <button key={action.title} type="button" onClick={() => navigate(action.to)} className="group flex items-center gap-3 rounded-sm p-3.5 text-left transition-colors" style={{ background: 'transparent', border: '1px solid var(--color-border)' }}><span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-sm" style={{ background: 'transparent', border:'1px solid var(--color-border)', color: 'var(--color-primary)' }}><action.icon className="h-4 w-4" /></span><span className="min-w-0 flex-1"><span className="block text-xs font-black" style={{ color: 'var(--color-text)' }}>{action.title}</span><span className="mt-1 block truncate text-[10px]" style={{ color: 'var(--color-text-secondary)' }}>{action.text}</span></span><ArrowRight className="h-4 w-4 opacity-0 transition-opacity group-hover:opacity-100" style={{ color: 'var(--color-primary)' }} /></button>)}</section>
    </main>
  </div>;
}

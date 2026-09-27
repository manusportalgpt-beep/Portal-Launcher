import { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ArrowRight, Compass, FolderPlus, Gamepad2, Library as LibraryIcon, Palette, Rocket,
  Settings2, ShieldCheck, Sparkles, Square, Store, User, Wand2,
} from 'lucide-react';
import { useCurrentUser, useIsAuthenticated } from '@/stores/authStore';
import { useInstanceStore } from '@/stores/instanceStore';
import { useSettingsStore } from '@/stores/settingsStore';
import { useLaunchStore } from '@/stores/launchStore';
import { invoke } from '@/lib/invoke-shim';
import { toIconSrc } from '@/lib/icon-src';
import { BlockIcon } from '@/components/ui/Pixel';

function relativeDate(value?: string) {
  if (!value) return 'Ещё не запускалась';
  const days = Math.max(0, Math.floor((Date.now() - new Date(value).getTime()) / 86_400_000));
  if (days === 0) return 'Сегодня';
  if (days === 1) return 'Вчера';
  return `${days} дн. назад`;
}

/**
 * Главный экран.
 *
 * Раскладка повторяет приём из millida/launcher: сцена по центру, слева
 * крупные плитки-входы, справа сверху ряд служебных кнопок, снизу панель
 * активной сборки и широкая кнопка «Играть». Косметики и плащей нет — это
 * сознательное решение, а не недоделка.
 */
export function HomePage() {
  const navigate = useNavigate();
  const user = useCurrentUser();
  const signedIn = useIsAuthenticated();
  const instances = useInstanceStore(s => s.instances);
  const settings = useSettingsStore(s => s);
  const setStatus = useLaunchStore(s => s.setStatus);
  const getStatus = useLaunchStore(s => s.getStatus);

  // Активная сборка: последняя запущенная, иначе первая.
  const active = useMemo(() => {
    if (!instances.length) return null;
    return [...instances].sort(
      (a, b) => new Date(b.lastPlayed || b.createdAt).getTime() - new Date(a.lastPlayed || a.createdAt).getTime(),
    )[0];
  }, [instances]);

  const others = useMemo(
    () => instances.filter(i => i.id !== active?.id).slice(0, 3),
    [instances, active],
  );

  const playHours = Math.round(instances.reduce((sum, i) => sum + (i.totalPlayTime || 0), 0) / 60);
  const activeState = active ? getStatus(active.id) : 'idle';
  const running = activeState === 'running';
  const launching = activeState === 'launching';

  const play = async () => {
    if (!active || running || launching) return;
    setStatus(active.id, 'launching');
    try {
      await invoke('update_instance', {
        id: active.id, name: active.name,
        mc_version: active.minecraftVersion, loader: active.modLoader,
        loader_version: active.modLoaderVersion || '',
        min_ram: settings.minRam, max_ram: settings.maxRam,
        java_path: settings.javaPath || '', custom_jvm_args: settings.customJvmArgs || '',
        color: active.color, icon: active.iconPath || null,
      });
      useInstanceStore.getState().update(active.id, { lastPlayed: new Date().toISOString() });
      if (!user?.uuid || !user?.username) throw new Error('Нет аккаунта: войдите в настройках аккаунта.');
      await invoke('launch_instance', {
        instance_id: active.id,
        access_token: user.accessToken || '',
        uuid: user.uuid,
        username: user.username,
        provider: user.provider,
      });
      setStatus(active.id, 'running');
    } catch (e) {
      setStatus(active.id, 'idle');
      navigate('/settings/account');
      console.error('launch failed', e);
    }
  };

  const stop = async () => {
    if (!active) return;
    try {
      await invoke('kill_instance', { instanceId: active.id });
    } catch { /* процесс уже вышел */ }
    setStatus(active.id, 'idle');
  };

  const tiles = [
    { icon: Store, title: 'Обзор', text: 'Моды, паки и шейдеры', to: '/discover' },
    { icon: Palette, title: 'Скины', text: 'Свои и из библиотеки', to: '/skins' },
    { icon: Wand2, title: 'Оформление', text: 'Тема, фон, панели', to: '/settings?tab=appearance' },
  ];

  return (
    <div className="relative flex h-full min-h-0 flex-col overflow-hidden">
      {/* Сцена: луч света за 3D-моделью. Модель по центру, панели поверх. */}
      <div aria-hidden className="px-sunburst pointer-events-none absolute inset-0" />

      <div className="relative z-10 flex min-h-0 flex-1 flex-col">
        {/* Верхний ряд служебных кнопок */}
        <div className="flex items-start justify-end gap-2 px-4 pt-4 sm:px-6">
          <button
            type="button"
            onClick={() => navigate('/library')}
            title="Мои сборки"
            className="px-btn px-btn-quiet h-11 w-11"
            aria-label="Мои сборки">
            <LibraryIcon size={17} />
          </button>
          <button
            type="button"
            onClick={() => navigate('/settings')}
            title="Настройки"
            className="px-btn px-btn-quiet h-11 w-11"
            aria-label="Настройки">
            <Settings2 size={17} />
          </button>
          <button
            type="button"
            onClick={() => navigate('/settings/account')}
            title={signedIn ? user?.username || 'Аккаунт' : 'Войти'}
            className="px-btn px-btn-quiet h-11 w-11"
            aria-label="Аккаунт">
            {signedIn ? <User size={17} /> : <ShieldCheck size={17} />}
          </button>
        </div>

        {/* Сцена: крупные плитки слева, статистика справа */}
        <div className="flex min-h-0 flex-1 items-center gap-4 px-4 py-4 sm:px-6">
          <div className="flex w-[180px] shrink-0 flex-col gap-3 sm:w-[220px]">
            {tiles.map(tile => (
              <button
                key={tile.title}
                type="button"
                onClick={() => navigate(tile.to)}
                className="px-tile group flex flex-col items-start gap-2 p-3 text-left">
                <span
                  className="flex h-12 w-12 items-center justify-center"
                  style={{ background: 'color-mix(in srgb, var(--color-primary) 20%, transparent)', color: 'var(--color-primary)' }}>
                  <tile.icon size={22} />
                </span>
                <span className="block text-sm font-black" style={{ color: 'var(--color-text)' }}>
                  {tile.title}
                </span>
                <span className="block text-[10px] leading-4" style={{ color: 'var(--color-text-secondary)' }}>
                  {tile.text}
                </span>
              </button>
            ))}
          </div>

          {/* Зона под 3D-модель: заголовок и имя игрока, сама модель — сюда
              встаёт нашим SkinStand3D, когда он подключён. */}
          <div className="flex min-w-0 flex-1 flex-col items-center justify-center">
            <span className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-[0.2em]"
              style={{ color: 'var(--color-primary)' }}>
              <Sparkles size={12} /> Portal Launcher
            </span>
            <h1 className="mt-2 text-center text-2xl font-black sm:text-3xl"
              style={{ color: 'var(--color-text)' }}>
              {signedIn ? `С возвращением, ${user?.username || 'игрок'}` : 'Minecraft — в вашем ритме'}
            </h1>
            <p className="mt-2 max-w-xl text-center text-xs leading-relaxed"
              style={{ color: 'var(--color-text-secondary)' }}>
              {instances.length
                ? 'Выбери сборку и нажми «Играть». Моды, паки и шейдеры ставятся в пару кликов.'
                : 'Войди в игровой аккаунт и создай первую сборку — версию, загрузчик и моды подберём сами.'}
            </p>
          </div>

          {/* Статистика */}
          <div className="hidden w-[180px] shrink-0 flex-col gap-2 lg:flex">
            {[
              { icon: LibraryIcon, value: String(instances.length), label: 'Сборок' },
              { icon: Gamepad2, value: playHours ? `${playHours} ч` : '—', label: 'В игре' },
            ].map(stat => (
              <div key={stat.label} className="px-frame px-3 py-2.5">
                <div className="flex items-center gap-2">
                  <stat.icon size={14} style={{ color: 'var(--color-primary)' }} />
                  <span className="text-lg font-black leading-none" style={{ color: 'var(--color-text)' }}>
                    {stat.value}
                  </span>
                </div>
                <p className="mt-1 text-[10px] font-bold" style={{ color: 'var(--color-text-tertiary)' }}>
                  {stat.label}
                </p>
              </div>
            ))}
            {others.map(inst => (
              <button
                key={inst.id}
                type="button"
                onClick={() => navigate('/library')}
                className="px-frame flex items-center gap-2 px-2.5 py-2 text-left">
                <BlockIcon loader={inst.modLoader} size={22} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[11px] font-black" style={{ color: 'var(--color-text)' }}>
                    {inst.name}
                  </span>
                  <span className="block truncate text-[9px]" style={{ color: 'var(--color-text-tertiary)' }}>
                    {relativeDate(inst.lastPlayed)}
                  </span>
                </span>
              </button>
            ))}
          </div>
        </div>

        {/* Нижняя панель: активная сборка и «Играть» */}
        <div className="px-4 pb-4 sm:px-6">
          <div className="mx-auto flex max-w-5xl flex-col gap-3 sm:flex-row sm:items-stretch">
            {active ? (
              <div className="px-frame flex min-w-0 flex-1 items-center gap-3 px-3 py-3">
                <span
                  className="flex h-14 w-14 shrink-0 items-center justify-center overflow-hidden"
                  style={{ background: 'var(--color-surface-2)' }}>
                  {toIconSrc(active.iconPath)
                    ? <img src={toIconSrc(active.iconPath)!} alt="" className="h-full w-full object-cover" />
                    : <BlockIcon loader={active.modLoader} size={40} />}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-[10px] font-bold uppercase tracking-wider"
                    style={{ color: 'var(--color-primary)' }}>
                    Сегодня играем
                  </span>
                  <span className="mt-0.5 block truncate text-lg font-black leading-tight"
                      style={{ color: 'var(--color-text)' }}>
                    {active.name}
                  </span>
                  <span className="mt-0.5 block truncate text-[11px]"
                      style={{ color: 'var(--color-text-secondary)' }}>
                    {active.minecraftVersion} · {active.modLoader}
                  </span>
                </span>
              </div>
            ) : (
              <div className="px-frame flex min-w-0 flex-1 items-center gap-3 px-3 py-3">
                <span className="flex h-14 w-14 shrink-0 items-center justify-center"
                  style={{ background: 'var(--color-surface-2)', color: 'var(--color-primary)' }}>
                  <FolderPlus size={24} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-[10px] font-bold uppercase tracking-wider"
                    style={{ color: 'var(--color-primary)' }}>
                    Сначала сборка
                  </span>
                  <span className="mt-0.5 block text-lg font-black leading-tight"
                    style={{ color: 'var(--color-text)' }}>
                    {signedIn ? 'Создайте первую сборку' : 'Войдите в аккаунт'}
                  </span>
                  <span className="mt-0.5 block text-[11px]"
                    style={{ color: 'var(--color-text-secondary)' }}>
                    {signedIn
                      ? 'Выберите версию и загрузчик — моды подтянем сами.'
                      : 'Microsoft, Ely.by и другие способы входа — в настройках аккаунта.'}
                  </span>
                </span>
              </div>
            )}

            {active ? (
              running ? (
                <button type="button" onClick={() => void stop()}
                  className="px-btn px-5 text-base sm:min-w-[240px]" style={{ color: 'var(--color-text)' }}>
                  <Square size={16} /> Остановить
                </button>
              ) : (
                <button type="button" onClick={() => void play()} disabled={launching}
                  className="px-btn px-btn-primary text-base sm:min-w-[240px]">
                  {launching ? 'Запуск…' : <><Rocket size={17} /> Играть</>}
                </button>
              )
            ) : (
              <button type="button"
                onClick={() => navigate(signedIn ? '/library?create=1' : '/settings/account')}
                className="px-btn px-btn-primary text-base sm:min-w-[240px]">
                {signedIn ? <><FolderPlus size={17} /> Создать сборку</> : <><ShieldCheck size={17} /> Войти</>}
              </button>
            )}
          </div>

          {/* Быстрые переходы */}
          <div className="mx-auto mt-3 flex max-w-5xl flex-wrap justify-center gap-2">
            <button type="button" onClick={() => navigate('/discover')}
              className="px-btn px-btn-quiet px-3 py-1.5 text-[11px]">
              <Compass size={13} /> Найти проект
            </button>
            <button type="button" onClick={() => navigate('/library')}
              className="px-btn px-btn-quiet px-3 py-1.5 text-[11px]">
              <LibraryIcon size={13} /> Библиотека
            </button>
            <button type="button" onClick={() => navigate('/settings?tab=appearance')}
              className="px-btn px-btn-quiet px-3 py-1.5 text-[11px]">
              <Palette size={13} /> Оформление
            </button>
            <button type="button" onClick={() => navigate('/settings')}
              className="px-btn px-btn-quiet px-3 py-1.5 text-[11px]">
              Настройки <ArrowRight size={12} />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

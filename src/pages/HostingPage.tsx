import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowRight, Check, ExternalLink, Gauge, Globe2, HardDrive, Play, Server, ShieldCheck, TerminalSquare, Users, X } from 'lucide-react';
import { useMillidaAuthStore } from '@/stores/millidaAuthStore';
import { useHostingStore } from '@/stores/hostingStore';

const HOSTING_URL = 'https://millida.net/hosting';
const CREATE_URL = 'https://millida.net/auth/login?next=/hosting/new';
const API_DOCS_URL = 'https://millida.net/docs/hosting/api';

function openExternal(url: string) {
  window.open(url, '_blank', 'noopener,noreferrer');
}

function StatusPill({ connected }: { connected: boolean }) {
  return (
    <span className="inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-[11px] font-bold" style={{ background: connected ? 'color-mix(in srgb, #35d07f 16%, var(--color-surface-2))' : 'var(--color-surface-2)', color: connected ? '#54e28d' : 'var(--color-text-secondary)', border: `1px solid ${connected ? 'color-mix(in srgb, #35d07f 38%, transparent)' : 'var(--color-border)'}` }}>
      <span className="h-1.5 w-1.5 rounded-full" style={{ background: connected ? '#54e28d' : 'var(--color-text-tertiary)' }} />
      {connected ? 'Millida подключён' : 'Millida не подключён'}
    </span>
  );
}

export default function HostingPage() {
  const navigate = useNavigate();
  const { profile, connected, refresh, startLogin } = useMillidaAuthStore();
  const { keyConfigured, server, status, console: consoleText, files, backups, busy: hostingBusy, error: hostingError, refresh: refreshHosting, loadConsole, loadFiles, loadBackups, createBackup, saveKey, clearKey, start, stop, restart } = useHostingStore();
  const [showApiNote, setShowApiNote] = useState(false);
  const [apiKey, setApiKey] = useState('');
  const serverStatus = String(status?.status ?? 'UNKNOWN').toUpperCase();
  const serverAddress = String(server?.address ?? status?.address ?? '');

  useEffect(() => { void refresh(); void refreshHosting(); }, [refresh, refreshHosting]);
  useEffect(() => {
    if (!keyConfigured) return;
    void loadFiles();
    void loadBackups();
  }, [keyConfigured, loadFiles, loadBackups]);

  return (
    <div className="h-full min-h-0 overflow-y-auto" style={{ background: 'transparent' }}>
      <div className="mx-auto max-w-6xl px-5 pb-14 pt-6 lg:px-8">
        <section className="relative overflow-hidden rounded-[28px] border p-7 md:p-10" style={{ borderColor: 'var(--color-border)', background: 'linear-gradient(135deg, color-mix(in srgb, var(--color-primary) 16%, var(--color-surface)), var(--color-surface))', boxShadow: 'var(--shadow-lg)' }}>
          <div className="pointer-events-none absolute -right-20 -top-24 h-72 w-72 rounded-full" style={{ background: 'color-mix(in srgb, var(--color-primary) 28%, transparent)', filter: 'blur(55px)' }} />
          <div className="pointer-events-none absolute -bottom-28 left-1/3 h-60 w-60 rounded-full" style={{ background: 'color-mix(in srgb, #55c7ff 18%, transparent)', filter: 'blur(65px)' }} />
          <div className="relative grid items-center gap-8 lg:grid-cols-[1.15fr_.85fr]">
            <div>
              <p className="mb-3 text-[11px] font-black uppercase tracking-[0.24em]" style={{ color: 'var(--color-primary)' }}>Portal Hosting</p>
              <h1 className="max-w-2xl text-3xl font-black tracking-tight md:text-5xl" style={{ color: 'var(--color-text)' }}>Сервер для друзей — без лишнего шума</h1>
              <p className="mt-4 max-w-xl text-sm leading-6 md:text-base" style={{ color: 'var(--color-text-secondary)' }}>Подключи Millida Hosting к Portal Launcher, выбери версию Minecraft и позови друзей из одного спокойного интерфейса. Состояния сервера, адрес и быстрые действия будут жить рядом с твоими сборками.</p>
              <div className="mt-6 flex flex-wrap gap-3">
                <button onClick={() => openExternal(connected ? CREATE_URL : HOSTING_URL)} className="inline-flex items-center gap-2 rounded-xl px-4 py-3 text-sm font-black transition-transform active:scale-[.98]" style={{ background: 'var(--color-primary)', color: 'var(--color-primary-text)', boxShadow: '0 10px 24px color-mix(in srgb, var(--color-primary) 28%, transparent)' }}>
                  <Play className="h-4 w-4" /> {connected ? 'Создать сервер' : 'Открыть Millida Hosting'}
                </button>
                <button onClick={() => navigate('/friends')} className="inline-flex items-center gap-2 rounded-xl border px-4 py-3 text-sm font-bold" style={{ borderColor: 'var(--color-border)', background: 'var(--color-surface-2)', color: 'var(--color-text)' }}>
                  <Users className="h-4 w-4" /> Пригласить друзей
                </button>
              </div>
              <div className="mt-5"><StatusPill connected={connected} /></div>
            </div>
            <div className="relative mx-auto flex h-52 w-full max-w-sm items-center justify-center rounded-3xl border" style={{ borderColor: 'color-mix(in srgb, var(--color-primary) 30%, var(--color-border))', background: 'color-mix(in srgb, var(--color-surface-2) 70%, transparent)' }}>
              <div className="absolute inset-5 rounded-2xl" style={{ background: 'radial-gradient(circle at 50% 30%, color-mix(in srgb, var(--color-primary) 24%, transparent), transparent 58%)' }} />
              <Server className="relative h-24 w-24" strokeWidth={1.2} style={{ color: 'var(--color-primary)', filter: 'drop-shadow(0 12px 20px color-mix(in srgb, var(--color-primary) 25%, transparent))' }} />
              <div className="absolute bottom-4 left-1/2 flex -translate-x-1/2 items-center gap-2 rounded-full px-3 py-1.5 text-[10px] font-bold" style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', color: 'var(--color-text-secondary)' }}><ShieldCheck className="h-3.5 w-3.5" style={{ color: 'var(--color-primary)' }} /> Безопасный доступ</div>
            </div>
          </div>
        </section>

        <section className="mt-6 grid gap-4 md:grid-cols-3">
          {[
            { icon: Gauge, title: 'Статус рядом', text: 'Запуск, остановка и доступность сервера в одном месте.' },
            { icon: HardDrive, title: 'Сборки и миры', text: 'Подготовь модпак, карту или серверную конфигурацию без лишних окон.' },
            { icon: Globe2, title: 'Адрес для друзей', text: 'Скопируй адрес Millida и отправь его друзьям из Friends.' },
          ].map(({ icon: Icon, title, text }) => <div key={title} className="rounded-2xl border p-5" style={{ background: 'color-mix(in srgb, var(--color-surface) 90%, transparent)', borderColor: 'var(--color-border)' }}><Icon className="h-5 w-5" style={{ color: 'var(--color-primary)' }} /><h2 className="mt-4 text-sm font-black" style={{ color: 'var(--color-text)' }}>{title}</h2><p className="mt-2 text-xs leading-5" style={{ color: 'var(--color-text-secondary)' }}>{text}</p></div>)}
        </section>

        <section className="mt-6 rounded-2xl border p-5 md:p-6" style={{ background: 'var(--color-surface)', borderColor: 'var(--color-border)' }}>
          <div className="flex flex-col justify-between gap-4 md:flex-row md:items-center"><div><p className="text-[11px] font-black uppercase tracking-[0.2em]" style={{ color: 'var(--color-text-tertiary)' }}>Millida account</p><h2 className="mt-2 text-xl font-black" style={{ color: 'var(--color-text)' }}>{profile ? `Добро пожаловать, ${profile.nickname ?? profile.id}` : 'Войди в Millida, чтобы продолжить'}</h2><p className="mt-1 text-sm" style={{ color: 'var(--color-text-secondary)' }}>{profile ? 'Профиль используется для друзей и доступа к Hosting. Игровой Microsoft/Ely.by вход остаётся отдельным.' : 'Millida-вход нужен для социальных функций и связки с Hosting.'}</p></div>{profile ? <div className="flex h-12 w-12 items-center justify-center overflow-hidden rounded-2xl" style={{ background: 'var(--color-surface-2)' }}>{profile.avatarUrl ? <img src={profile.avatarUrl} alt="" className="h-full w-full object-cover" draggable={false} /> : <span className="text-lg font-black" style={{ color: 'var(--color-primary)' }}>{(profile.nickname ?? profile.id)?.[0]?.toUpperCase() || 'M'}</span>}</div> : <button onClick={() => void startLogin()} className="rounded-xl px-4 py-2.5 text-sm font-black" style={{ background: 'var(--color-primary)', color: 'var(--color-primary-text)' }}>Войти в Millida</button>}</div>
        </section>

        <section className="mt-6 rounded-2xl border p-5 md:p-6" style={{ background: 'var(--color-surface)', borderColor: 'var(--color-border)' }}>
          <div className="flex flex-col justify-between gap-4 md:flex-row md:items-start"><div className="flex items-start gap-3"><TerminalSquare className="mt-0.5 h-5 w-5 shrink-0" style={{ color: 'var(--color-primary)' }} /><div><h2 className="text-sm font-black" style={{ color: 'var(--color-text)' }}>Управление из лаунчера</h2><p className="mt-1 max-w-2xl text-xs leading-5" style={{ color: 'var(--color-text-secondary)' }}>Ключ хранится только в системном keyring Portal Launcher. Он не попадает в localStorage, логи или URL.</p></div></div><div className="flex items-center gap-2"><span className="rounded-full px-2.5 py-1 text-[10px] font-bold" style={{ background: keyConfigured ? 'color-mix(in srgb, #35d07f 14%, var(--color-surface-2))' : 'var(--color-surface-2)', color: keyConfigured ? '#54e28d' : 'var(--color-text-tertiary)' }}>{keyConfigured ? 'API подключён' : 'API не подключён'}</span><button onClick={() => setShowApiNote(v => !v)} className="inline-flex shrink-0 items-center gap-2 rounded-xl border px-3 py-2 text-xs font-bold" style={{ borderColor: 'var(--color-border)', color: 'var(--color-text-secondary)' }}>{showApiNote ? <X className="h-3.5 w-3.5" /> : <ShieldCheck className="h-3.5 w-3.5" />} {showApiNote ? 'Скрыть' : 'Настроить'}</button></div></div>
          {showApiNote && <div className="mt-4 space-y-4 rounded-xl p-4" style={{ background: 'var(--color-surface-2)' }}><div className="flex flex-col gap-2 sm:flex-row"><input value={apiKey} onChange={event => setApiKey(event.target.value)} type="password" autoComplete="off" placeholder="mhk_live_…" className="min-w-0 flex-1 rounded-lg border px-3 py-2 text-xs outline-none" style={{ background: 'var(--color-surface)', borderColor: 'var(--color-border)', color: 'var(--color-text)' }} /><button disabled={hostingBusy || !apiKey.trim()} onClick={() => void saveKey(apiKey)} className="rounded-lg px-3 py-2 text-xs font-bold disabled:opacity-40" style={{ background: 'var(--color-primary)', color: 'var(--color-primary-text)' }}>Подключить ключ</button>{keyConfigured && <button disabled={hostingBusy} onClick={() => void clearKey()} className="rounded-lg border px-3 py-2 text-xs font-bold disabled:opacity-40" style={{ borderColor: 'var(--color-border)', color: 'var(--color-text-secondary)' }}>Удалить</button>}</div><div className="flex flex-wrap items-center gap-2"><button disabled={!keyConfigured || hostingBusy} onClick={() => void refreshHosting()} className="rounded-lg border px-3 py-2 text-xs font-bold disabled:opacity-40" style={{ borderColor: 'var(--color-border)', color: 'var(--color-text-secondary)' }}>Обновить статус</button><button onClick={() => openExternal(API_DOCS_URL)} className="inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-bold" style={{ background: 'var(--color-primary-dim)', color: 'var(--color-primary)' }}>Документация <ExternalLink className="h-3 w-3" /></button></div>{hostingError && <p className="text-xs font-semibold" style={{ color: 'var(--color-error)' }}>{hostingError}</p>}</div>}
        </section>

        {keyConfigured && <><section className="mt-6 rounded-2xl border p-5 md:p-6" style={{ background: 'var(--color-surface)', borderColor: 'var(--color-border)' }}><div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between"><div><p className="text-[10px] font-black uppercase tracking-[0.2em]" style={{ color: 'var(--color-text-tertiary)' }}>Server</p><h2 className="mt-1 text-xl font-black" style={{ color: 'var(--color-text)' }}>{String(server?.name ?? 'Millida server')}</h2><p className="mt-1 text-xs" style={{ color: 'var(--color-text-secondary)' }}>{serverAddress || 'Адрес будет показан после ответа Hosting API'}</p></div><div className="flex items-center gap-2"><span className="rounded-full px-3 py-1.5 text-[11px] font-bold" style={{ background: 'var(--color-surface-2)', color: serverStatus === 'RUNNING' ? '#54e28d' : 'var(--color-text-secondary)' }}>{serverStatus}</span><button disabled={hostingBusy} onClick={() => void start()} className="rounded-lg px-3 py-2 text-xs font-bold disabled:opacity-40" style={{ background: 'var(--color-primary)', color: 'var(--color-primary-text)' }}>Запустить</button><button disabled={hostingBusy} onClick={() => void stop()} className="rounded-lg border px-3 py-2 text-xs font-bold disabled:opacity-40" style={{ borderColor: 'var(--color-border)', color: 'var(--color-text-secondary)' }}>Остановить</button><button disabled={hostingBusy} onClick={() => void restart()} className="rounded-lg border px-3 py-2 text-xs font-bold disabled:opacity-40" style={{ borderColor: 'var(--color-border)', color: 'var(--color-text-secondary)' }}>Перезапуск</button></div></div><div className="mt-5 flex items-center justify-between gap-3"><p className="text-[11px] font-bold" style={{ color: 'var(--color-text-tertiary)' }}>Консоль сервера</p><button disabled={hostingBusy} onClick={() => void loadConsole()} className="rounded-lg border px-3 py-2 text-xs font-bold disabled:opacity-40" style={{ borderColor: 'var(--color-border)', color: 'var(--color-text-secondary)' }}>Загрузить лог</button></div><pre className="mt-2 max-h-56 overflow-auto rounded-xl p-3 text-[11px] leading-5" style={{ background: '#0b0d12', color: '#b9c3d0', border: '1px solid var(--color-border)' }}>{consoleText || 'Лог ещё не загружен.'}</pre></section>

        <section className="mt-4 grid gap-4 lg:grid-cols-2"><div className="rounded-2xl border p-5" style={{ background: 'var(--color-surface)', borderColor: 'var(--color-border)' }}><div className="flex items-center justify-between gap-3"><div><p className="text-[10px] font-black uppercase tracking-[0.2em]" style={{ color: 'var(--color-text-tertiary)' }}>Server files</p><p className="mt-1 text-xs" style={{ color: 'var(--color-text-secondary)' }}>Только список файлов: редактирование требует отдельного права API.</p></div><button disabled={hostingBusy} onClick={() => void loadFiles()} className="rounded-lg border px-3 py-2 text-xs font-bold disabled:opacity-40" style={{ borderColor: 'var(--color-border)', color: 'var(--color-text-secondary)' }}>Обновить</button></div><div className="mt-4 max-h-52 space-y-1 overflow-auto">{files.length ? files.slice(0, 100).map((file, index) => <div key={String(file.path ?? file.name ?? index)} className="flex items-center justify-between gap-3 rounded-lg px-2.5 py-2 text-xs" style={{ background: 'var(--color-surface-2)', color: 'var(--color-text-secondary)' }}><span className="min-w-0 truncate">{String(file.path ?? file.name ?? 'Файл')}</span><span className="shrink-0 text-[10px]" style={{ color: 'var(--color-text-tertiary)' }}>{String(file.size ?? file.sizeMb ?? '')}</span></div>) : <p className="py-8 text-center text-xs" style={{ color: 'var(--color-text-tertiary)' }}>Список файлов пока не получен или ключу не выдано право «Файлы».</p>}</div></div><div className="rounded-2xl border p-5" style={{ background: 'var(--color-surface)', borderColor: 'var(--color-border)' }}><div className="flex items-center justify-between gap-3"><div><p className="text-[10px] font-black uppercase tracking-[0.2em]" style={{ color: 'var(--color-text-tertiary)' }}>Backups</p><p className="mt-1 text-xs" style={{ color: 'var(--color-text-secondary)' }}>Копия создаётся в фоне Millida; готовность обновляется по списку.</p></div><div className="flex gap-2"><button disabled={hostingBusy} onClick={() => void loadBackups()} className="rounded-lg border px-3 py-2 text-xs font-bold disabled:opacity-40" style={{ borderColor: 'var(--color-border)', color: 'var(--color-text-secondary)' }}>Обновить</button><button disabled={hostingBusy} onClick={() => void createBackup()} className="rounded-lg px-3 py-2 text-xs font-black disabled:opacity-40" style={{ background: 'var(--color-primary)', color: 'var(--color-primary-text)' }}>Создать копию</button></div></div><div className="mt-4 max-h-52 space-y-1 overflow-auto">{backups.length ? backups.slice(0, 50).map((backup, index) => <div key={String(backup.id ?? index)} className="flex items-center justify-between gap-3 rounded-lg px-2.5 py-2 text-xs" style={{ background: 'var(--color-surface-2)', color: 'var(--color-text-secondary)' }}><span className="min-w-0 truncate">{String(backup.name ?? backup.id ?? 'Резервная копия')}</span><span className="shrink-0 text-[10px] font-bold" style={{ color: String(backup.status).toLowerCase() === 'ready' ? '#54e28d' : 'var(--color-text-tertiary)' }}>{String(backup.status ?? 'pending')}</span></div>) : <p className="py-8 text-center text-xs" style={{ color: 'var(--color-text-tertiary)' }}>Копий пока нет или ключу не выдано право «Копии».</p>}</div></div></section></>}

        <div className="mt-6 flex flex-wrap items-center justify-between gap-3 text-xs" style={{ color: 'var(--color-text-tertiary)' }}><span>Hosting подстраивается под активную тему Portal Launcher.</span><button onClick={() => openExternal(HOSTING_URL)} className="inline-flex items-center gap-2 font-bold" style={{ color: 'var(--color-primary)' }}>Открыть Millida Hosting <ArrowRight className="h-3.5 w-3.5" /></button></div>
      </div>
    </div>
  );
}

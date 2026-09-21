import { useEffect, useRef, useState } from 'react';
import {
  Server as ServerIcon, User, Lock, KeyRound, LogIn, LogOut, RefreshCw,
  Play, Square, RotateCw, FileText, Wrench, Package, FolderOpen, Download,
  ShieldCheck, Globe, Search, Loader2, ExternalLink,
  Terminal, Wifi, WifiOff, Trophy, Copy, Check,
} from 'lucide-react';
import { invoke } from '@/lib/invoke-shim';

type AternosLoginResult =
  | { kind: 'Success'; username: string }
  | { kind: 'Needs2fa'; username: string }
  | { kind: 'InvalidCredentials' }
  | { kind: 'BrowserSessionRequired'; reason: string };

interface AternosServer {
  id: string;
  name?: string | null;
  ip?: string | null;
  status?: string | null;
  online?: boolean;
  class?: string | null;
  version?: string | null;
  software?: string | null;
}

interface AternosInfo {
  id: string;
  online: boolean;
  starting: boolean;
  class?: string | null;
  status_text?: string | null;
  ip?: string | null;
  domain?: string | null;
  port?: number | null;
  version?: string | null;
  software?: string | null;
  motd?: string | null;
  players?: string[] | null;
  slots?: number | null;
  ram?: string | null;
  mem?: string | null;
}

interface AternosFile {
  path: string;
  kind: string;
  size?: string | null;
}

type Tab = 'console' | 'settings' | 'catalog' | 'files';

export function AternosPage() {
  const [login, setLogin] = useState({
    username: '',
    password: '',
    code: '',
    session: '',
    token: '',
    method: 'password' as 'password' | 'session' | 'token',
  });
  const [auth, setAuth] = useState<{ ok: boolean; connecting: boolean; need2fa: boolean; error: string }>({ ok: false, connecting: false, need2fa: false, error: '' });

  const [servers, setServers] = useState<AternosServer[]>([]);
  const [loadingServers, setLoadingServers] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [info, setInfo] = useState<AternosInfo | null>(null);
  const [tab, setTab] = useState<Tab>('console');
  const [busy, setBusy] = useState<string | null>(null);

  const [consoleLines, setConsoleLines] = useState<string[]>([]);
  const [consoleInput, setConsoleInput] = useState('');
  const consoleRef = useRef<HTMLDivElement>(null);

  const [motd, setMotd] = useState('');
  const [subdomain, setSubdomain] = useState('');
  const [settingsNote, setSettingsNote] = useState('');

  const [watchOn, setWatchOn] = useState(false);
  const [afkOn, setAfkOn] = useState(false);
  const [afkNick, setAfkNick] = useState('PortalAFK');
  const [watching, setWatching] = useState(false);

  const [filesPath, setFilesPath] = useState('');
  const [files, setFiles] = useState<AternosFile[]>([]);
  const [loadingFiles, setLoadingFiles] = useState(false);

  const [catQuery, setCatQuery] = useState('');
  const [catResults, setCatResults] = useState<any[]>([]);
  const [searching, setSearching] = useState(false);

  const [copied, setCopied] = useState(false);

  // restore session on mount
  useEffect(() => {
    (async () => {
      try {
        await invoke('aternos_list_servers');
        setAuth({ ok: true, connecting: false, need2fa: false, error: '' });
      } catch (e) {
        setAuth({ ok: false, connecting: false, need2fa: false, error: String(e) });
      }
    })();
  }, []);

  useEffect(() => {
    if (!consoleRef.current) return;
    consoleRef.current.scrollTop = consoleRef.current.scrollHeight;
  }, [consoleLines]);

  const doLogin = async () => {
    setAuth({ ok: false, connecting: true, need2fa: false, error: '' });
    try {
      let res: AternosLoginResult;
      if (login.method === 'session') {
        try {
          await invoke('aternos_login_with_session', { username: login.username, sessionCookie: login.session });
          setAuth({ ok: true, connecting: false, need2fa: false, error: '' });
          await refreshServers(false);
          return;
        } catch (e) {
          setAuth({ ok: false, connecting: false, need2fa: false, error: String(e) });
          return;
        }
      }
      if (login.method === 'token') {
        try {
          await invoke('aternos_login_with_token', { username: login.username, ajaxToken: login.token });
          setAuth({ ok: true, connecting: false, need2fa: false, error: '' });
          await refreshServers(false);
          return;
        } catch (e) {
          setAuth({ ok: false, connecting: false, need2fa: false, error: String(e) });
          return;
        }
      }
      res = await invoke<AternosLoginResult>('aternos_login', {
        username: login.username,
        password: login.password,
        code: login.code || null,
      });
      if (res.kind === 'Success') {
        setAuth({ ok: true, connecting: false, need2fa: false, error: '' });
        await refreshServers(false);
      } else if (res.kind === 'Needs2fa') {
        setAuth({ ok: false, connecting: false, need2fa: true, error: 'Введите код двухфакторной аутентификации (Authenticator)' });
      } else if (res.kind === 'InvalidCredentials') {
        setAuth({ ok: false, connecting: false, need2fa: false, error: 'Неверный логин или пароль' });
      } else {
        setAuth({ ok: false, connecting: false, need2fa: false, error: res.reason });
        void res;
      }
    } catch (e) {
      setAuth({ ok: false, connecting: false, need2fa: false, error: String(e) });
    }
  };

  const doLogout = async () => {
    try { await invoke('aternos_logout'); } catch { /* ignore */ }
    setAuth({ ok: false, connecting: false, need2fa: false, error: '' });
    setServers([]);
    setSelectedId(null);
    setInfo(null);
  };

  const refreshServers = async (spin = true) => {
    if (spin) setLoadingServers(true);
    try {
      const list = await invoke<AternosServer[]>('aternos_list_servers');
      setServers(list);
    } catch (e) {
      setAuth({ ok: false, connecting: false, need2fa: false, error: `Не удалось получить список серверов: ${String(e)}` });
    } finally {
      if (spin) setLoadingServers(false);
    }
  };

  useEffect(() => {
    if (auth.ok) void refreshServers();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auth.ok]);

  useEffect(() => {
    let un = (ev: Event) => {
      const d = (ev as CustomEvent).detail as any;
      if (d.servid !== selectedId) return;
      if ('line' in d && typeof d.line === 'string') {
        setConsoleLines(prev => {
          const next = [...prev, d.line!];
          return next.length > 2000 ? next.slice(next.length - 2000) : next;
        });
      } else {
        setInfo(i => (i ? { ...i, ...d } : i));
      }
    };
    window.addEventListener('aternos-console', un);
    window.addEventListener('aternos-status', un);
    return () => {
      window.removeEventListener('aternos-console', un);
      window.removeEventListener('aternos-status', un);
    };
  }, [selectedId]);

  useEffect(() => {
    if (selectedId) void loadServerInfo(selectedId);
    if (selectedId && tab === 'files') void loadFiles();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId]);

  useEffect(() => {
    setMotd(info?.motd ?? '');
    setSubdomain(info?.domain?.replace(/\.aternos\.me$/, '') ?? '');
  }, [info]);

  const loadServerInfo = async (id: string) => {
    try {
      const i = await invoke<AternosInfo>('aternos_server_info', { servid: id });
      setInfo(i);
      setMotd(i.motd ?? '');
      setSubdomain(i.domain?.replace(/\.aternos\.me$/, '') ?? '');
    } catch (e) {
      setAuth(a => ({ ...a, error: String(e) }));
    }
  };

  const act = async (name: string, args: any, msg: string) => {
    setBusy(name);
    try {
      await invoke(name, args);
      void loadServerInfo(selectedId!);
    } catch (e) {
      setBusy(null);
      setAuth(a => ({ ...a, error: `${msg}: ${String(e)}` }));
      return;
    }
    setBusy(null);
  };

  const startServer = () => {
    void act('aternos_start', { servid: selectedId }, 'Не удалось запустить сервер');
  };
  const stopServer = () => {
    void act('aternos_stop', { servid: selectedId }, 'Не удалось остановить сервер');
  };
  const restartServer = () => {
    void act('aternos_restart', { servid: selectedId }, 'Не удалось перезапустить сервер');
  };

  const sendCommand = async () => {
    const c = consoleInput.trim();
    if (!c) return;
    setConsoleInput('');
    try {
      await invoke('aternos_console_command', { servid: selectedId, cmd: c });
    } catch (e) {
      setConsoleLines(l => [...l, `[error] ${String(e)}`]);
      try {
        await invoke('aternos_console_open', { servid: selectedId });
        await invoke('aternos_console_command', { servid: selectedId, cmd: c });
      } catch (e2) {
        setConsoleLines(l => [...l, `[error] ${String(e2)}`]);
      }
    }
  };

  const openConsole = async () => {
    if (!selectedId) return;
    try {
      await invoke('aternos_console_open', { servid: selectedId });
    } catch (e) {
      setAuth(a => ({ ...a, error: String(e) }));
    }
  };

  const saveMotd = async () => {
    setSettingsNote('');
    try {
      await invoke('aternos_set_motd', { servid: selectedId, motd });
      setSettingsNote('MOTD сохранён');
    } catch (e) {
      setSettingsNote(`Ошибка: ${String(e)}`);
    }
  };

  const saveSubdomain = async () => {
    setSettingsNote('');
    const clean = subdomain.replace(/[^a-z0-9-]/gi, '').toLowerCase();
    try {
      await invoke('aternos_set_subdomain', { servid: selectedId, subdomain: clean });
      setSettingsNote('Поддомен обновлён');
    } catch (e) {
      setSettingsNote(`Ошибка: ${String(e)}`);
    }
  };

  const toggleWatch = async () => {
    if (!selectedId) return;
    setWatching(!watching);
    try {
      await invoke('aternos_watch_set', { servid: selectedId, enabled: !watchOn, intervalSecs: null });
      setWatchOn(!watchOn);
    } catch (e) {
      setSettingsNote(`Ошибка автоперезапуска: ${String(e)}`);
    } finally {
      setWatching(false);
    }
  };

  const toggleAfk = async () => {
    if (!selectedId) return;
    try {
      await invoke('aternos_afk_set', { servid: selectedId, enabled: !afkOn, nickname: afkNick, maxProtocol: null });
      setAfkOn(!afkOn);
    } catch (e) {
      setSettingsNote(`Ошибка AFK-бота: ${String(e)}`);
    }
  };

  const loadFiles = async () => {
    if (!selectedId) return;
    setLoadingFiles(true);
    try {
      const list = await invoke<AternosFile[]>('aternos_files', { servid: selectedId, path: filesPath });
      setFiles(list);
    } catch (e) {
      setAuth(a => ({ ...a, error: String(e) }));
    } finally {
      setLoadingFiles(false);
    }
  };

  const downloadFile = async (f: AternosFile) => {
    if (!selectedId) return;
    const baseName = f.path.split('/').filter(Boolean).pop() ?? 'file';
    try {
      const saved = await invoke<string>('aternos_download_file', { servid: selectedId, filePath: f.path, filename: baseName });
      setSettingsNote(`Скачано: ${saved}`);
    } catch (e) {
      setSettingsNote(`Ошибка скачивания: ${String(e)}`);
    }
  };

  const searchCatalog = async () => {
    const q = catQuery.trim();
    if (!q) return;
    setSearching(true);
    try {
      const res = await invoke<any>('search_mods', { query: q, platform: 'modrinth', limit: 12, curseforgeApiKey: '' });
      const hits = Array.isArray(res) ? res : res?.hits ?? res?.modrinth ?? [];
      setCatResults(hits);
    } catch (e) {
      setCatResults([]);
      setSettingsNote(`Ошибка поиска: ${String(e)}`);
    } finally {
      setSearching(false);
    }
  };

  const openCreateBrowser = () => {
    void invoke('open_url', { url: 'https://aternos.org/servers/' }).catch(() => {});
  };
  const openServerBrowser = () => {
    if (!selectedId) return;
    void invoke('open_url', { url: `https://aternos.org/server/${selectedId}/` }).catch(() => {});
  };

  const copyField = async (v: string) => {
    try {
      await navigator.clipboard.writeText(v);
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    } catch { /* ignore */ }
  };

  if (!auth.ok) {
    return (
      <div className="h-full w-full flex items-start justify-center overflow-y-auto"
        style={{ background: 'var(--color-bg)' }}>
        <div className="w-full max-w-md mx-auto px-6 py-10">
          <div className="flex items-center gap-3 mb-2">
            <span className="flex items-center justify-center w-11 h-11 rounded-xl"
              style={{ background: 'var(--color-surface-2)', border: '1px solid var(--color-border)' }}>
              <ServerIcon size={20} style={{ color: 'var(--color-primary)' }} />
            </span>
            <div>
              <h1 className="text-xl font-bold" style={{ color: 'var(--color-text)' }}>Aternos</h1>
              <div className="text-xs" style={{ color: 'var(--color-text-secondary)' }}>
                Бесплатный хостинг Minecraft-серверов прямо из лаунчера
              </div>
            </div>
          </div>

          {auth.error && !auth.need2fa && (
            <div className="mb-4 px-3 py-2 rounded-lg text-xs font-medium"
              style={{ background: 'var(--color-danger-bg, rgba(239,68,68,.12))', color: 'var(--color-danger, #ef4444)', border: '1px solid var(--color-danger, #ef4444)' }}>
              {loginResultData.error}
            </div>
          )}

          <div className="p-4 rounded-xl space-y-3"
            style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)' }}>

            {/* method switch */}
            <div className="flex gap-1 rounded-lg p-1" style={{ background: 'var(--color-bg)' }}>
              {(['password', 'session', 'token'] as const).map(m => (
                <button key={m}
                  onClick={() => setLogin(l => ({ ...l, method: m }))}
                  className="flex-1 px-2 py-1.5 rounded-md text-xs font-semibold transition-colors"
                  style={{
                    background: login.method === m ? 'var(--color-surface-hover)' : 'transparent',
                    color: login.method === m ? 'var(--color-text)' : 'var(--color-text-secondary)',
                    border: login.method === m ? '1px solid var(--color-border-strong)' : '1px solid transparent',
                  }}>
                  {m === 'password' ? 'Пароль' : m === 'session' ? 'Сессия из браузера' : 'AJAX-токен'}
                </button>
              ))}
            </div>

            <label className="block">
              <span className="flex items-center gap-1.5 text-xs font-semibold mb-1" style={{ color: 'var(--color-text-secondary)' }}>
                <User size={13} /> Имя пользователя Aternos
              </span>
              <input
                value={login.username}
                onChange={e => setLogin(l => ({ ...l, username: e.target.value }))}
                placeholder="username"
                className="w-full px-3 py-2 rounded-lg text-sm outline-none"
                style={{ background: 'var(--color-bg)', color: 'var(--color-text)', border: '1px solid var(--color-border)' }}
              />
            </label>

            {login.method === 'password' && (
              <>
                <label className="block">
                  <span className="flex items-center gap-1.5 text-xs font-semibold mb-1" style={{ color: 'var(--color-text-secondary)' }}>
                    <Lock size={13} /> Пароль (хранится в защищённом хранилище Windows)
                  </span>
                  <input
                    type="password"
                    value={login.password}
                    onChange={e => setLogin(l => ({ ...l, password: e.target.value }))}
                    placeholder="••••••••"
                    className="w-full px-3 py-2 rounded-lg text-sm outline-none"
                    style={{ background: 'var(--color-bg)', color: 'var(--color-text)', border: '1px solid var(--color-border)' }}
                  />
                </label>
                {auth.need2fa && (
                  <label className="block">
                    <span className="flex items-center gap-1.5 text-xs font-semibold mb-1" style={{ color: 'var(--color-text-secondary)' }}>
                      <KeyRound size={13} /> Код двухфакторной аутентификации
                    </span>
                    <input
                      value={login.code}
                      onChange={e => setLogin(l => ({ ...l, code: e.target.value }))}
                      placeholder="6 цифр из Authenticator"
                      className="w-full px-3 py-2 rounded-lg text-sm outline-none"
                      style={{ background: 'var(--color-bg)', color: 'var(--color-text)', border: '1px solid var(--color-border)' }}
                    />
                  </label>
                )}
              </>
            )}

            {login.method === 'session' && (
              <label className="block">
                <span className="flex items-center gap-1.5 text-xs font-semibold mb-1" style={{ color: 'var(--color-text-secondary)' }}>
                  <KeyRound size={13} /> ATERNOS_SESSION (куки)
                </span>
                <textarea
                  value={login.session}
                  onChange={e => setLogin(l => ({ ...l, session: e.target.value }))}
                  rows={3}
                  placeholder="Войдите на aternos.org в браузере, затем в DevTools → Application → Cookies скопируйте значение ATERNOS_SESSION"
                  className="w-full px-3 py-2 rounded-lg text-xs outline-none resize-none"
                  style={{ background: 'var(--color-bg)', color: 'var(--color-text)', border: '1px solid var(--color-border)' }}
                />
              </label>
            )}

            {login.method === 'token' && (
              <label className="block">
                <span className="flex items-center gap-1.5 text-xs font-semibold mb-1" style={{ color: 'var(--color-text-secondary)' }}>
                  <KeyRound size={13} /> AJAX-токен (window.AJAX_TOKEN)
                </span>
                <input
                  value={login.token}
                  onChange={e => setLogin(l => ({ ...l, token: e.target.value }))}
                  placeholder="В DevTools выполните window.AJAX_TOKEN на aternos.org"
                  className="w-full px-3 py-2 rounded-lg text-sm outline-none"
                  style={{ background: 'var(--color-bg)', color: 'var(--color-text)', border: '1px solid var(--color-border)' }}
                />
              </label>
            )}

            <button
              onClick={() => void doLogin()}
              disabled={auth.connecting}
              className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg text-sm font-bold transition-opacity"
              style={{ background: 'var(--color-primary)', color: '#fff', opacity: auth.connecting ? 0.65 : 1 }}>
              {auth.connecting ? <Loader2 size={16} className="animate-spin" /> : <LogIn size={16} />}
              {auth.connecting ? 'Вход…' : 'Войти'}
            </button>

            <div className="flex items-center justify-center gap-3 text-xs" style={{ color: 'var(--color-text-tertiary)' }}>
              <button onClick={() => void invoke('open_url', { url: 'https://aternos.org/go/' }).catch(() => {})}
                className="flex items-center gap-1 hover:underline" style={{ color: 'var(--color-text-secondary)' }}>
                <Globe size={12} /> Нет аккаунта? Создать
              </button>
              <span>·</span>
              <button onClick={openCreateBrowser} className="flex items-center gap-1 hover:underline" style={{ color: 'var(--color-text-secondary)' }}>
                <ExternalLink size={12} /> Сервер в браузере
              </button>
            </div>
          </div>

          <p className="mt-4 px-3 py-2 rounded-lg text-[11px] leading-relaxed" style={{ background: 'var(--color-surface-2)', color: 'var(--color-text-secondary)', border: '1px solid var(--color-border)' }}>
            Запросы к API отправляются с задержкой ~1.4 с, чтобы не заблокировали аккаунт.
            Если вход по паролю не работает, используйте режим «Сессия из браузера» — Aternos часто требует JS-подпись страницы.
          </p>
        </div>
      </div>
    );
  }

  const srv = servers.find(s => s.id === selectedId);
  const addr = info?.domain ? `${info.domain}${info.port ? `:${info.port}` : ''}` : (info?.ip ? `${info.ip}${info.port ? `:${info.port}` : ''}` : '');

  return (
    <div className="h-full w-full flex flex-col overflow-hidden" style={{ background: 'var(--color-bg)' }}>
      <div className="flex items-center gap-3 px-5 pt-4 pb-2">
        <span className="flex items-center justify-center w-9 h-9 rounded-lg"
          style={{ background: 'var(--color-surface-2)', border: '1px solid var(--color-border)' }}>
          <ServerIcon size={18} style={{ color: 'var(--color-primary)' }} />
        </span>
        <div className="flex-1 min-w-0">
          <div className="text-sm font-bold" style={{ color: 'var(--color-text)' }}>Aternos</div>
          <div className="text-[11px] truncate" style={{ color: 'var(--color-text-secondary)' }}>
            {servers.length > 0 ? `${servers.length} сервер(ов)` : 'Бесплатный хостинг'} — аккаунт {login.username || 'Aternos'}
          </div>
        </div>
        <button onClick={openCreateBrowser}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold"
          style={{ background: 'var(--color-surface-2)', color: 'var(--color-text)', border: '1px solid var(--color-border)' }}>
          <Globe size={13} /> Создать сервер
        </button>
        <button onClick={() => void refreshServers()} disabled={loadingServers}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold"
          style={{ background: 'var(--color-surface-2)', color: 'var(--color-text)', border: '1px solid var(--color-border)', opacity: loadingServers ? 0.6 : 1 }}>
          <RefreshCw size={13} className={loadingServers ? 'animate-spin' : ''} /> Обновить
        </button>
        <button onClick={() => void doLogout()}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold"
          style={{ background: 'var(--color-surface-2)', color: 'var(--color-text)', border: '1px solid var(--color-border)' }}>
          <LogOut size={13} /> Выйти
        </button>
      </div>

      {auth.error && (
        <div className="mx-5 mb-2 px-3 py-2 rounded-lg text-xs font-medium"
          style={{ background: 'var(--color-danger-bg, rgba(239,68,68,.12))', color: 'var(--color-danger, #ef4444)', border: '1px solid var(--color-danger, #ef4444)' }}>
          {auth.error}
        </div>
      )}

      {/* server list */}
      <div className="flex gap-2 px-5 pb-2 overflow-x-auto shrink-0">
        {servers.map(s => (
          <button key={s.id}
            onClick={() => setSelectedId(s.id)}
            className={`shrink-0 flex flex-col items-start gap-0.5 px-3 py-2 rounded-lg text-left min-w-[150px] transition-colors`}
            style={{
              background: selectedId === s.id ? 'var(--color-surface-hover)' : 'var(--color-surface)',
              border: `1px solid ${selectedId === s.id ? 'var(--color-primary)' : 'var(--color-border)'}`,
            }}>
            <span className="text-xs font-bold truncate w-full" style={{ color: 'var(--color-text)' }}>
              {s.name || s.id}
            </span>
            <span className="text-[10px] flex items-center gap-1" style={{ color: 'var(--color-text-secondary)' }}>
              <span className="inline-block w-2 h-2 rounded-full" style={{ background: s.online ? 'var(--color-success, #22c55e)' : 'var(--color-text-tertiary)' }} />
              {s.status || s.class || '…'}
            </span>
          </button>
        ))}
        {servers.length === 0 && !loadingServers && (
          <div className="flex items-center gap-2 px-3 py-2 rounded-lg text-xs"
            style={{ background: 'var(--color-surface)', border: '1px dashed var(--color-border-strong)', color: 'var(--color-text-secondary)' }}>
            <ServerIcon size={13} /> Серверов не найдено — создайте в браузере
          </div>
        )}
      </div>

      {!selectedId && (
        <div className="flex-1 flex flex-col items-center justify-center gap-3 text-center px-6">
          <ServerIcon size={36} style={{ color: 'var(--color-text-tertiary)' }} />
          <div className="text-sm font-semibold" style={{ color: 'var(--color-text-secondary)' }}>
            Выберите сервер слева, чтобы управлять им
          </div>
          <div className="text-xs max-w-md leading-relaxed" style={{ color: 'var(--color-text-tertiary)' }}>
            Консоль с командами Minecraft, MOTD и поддомен, каталог модов (поиск по Modrinth),
            файловый менеджер, а также режим «24/7»: автоперезапуск + AFK-бот, который удерживает сервер онлайн.
          </div>
        </div>
      )}

      {selectedId && info && (
        <div className="flex-1 flex flex-col min-h-0 px-5 pb-4 gap-3">
          {/* header info */}
          <div className="flex items-center gap-3 px-4 py-2.5 rounded-xl shrink-0"
            style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)' }}>
            <span className="inline-block w-3 h-3 rounded-full" style={{
              background: info.online ? 'var(--color-success, #22c55e)' : info.starting ? 'var(--color-warning, #f59e0b)' : 'var(--color-text-tertiary)',
              boxShadow: info.online ? '0 0 8px var(--color-success, #22c55e)' : 'none',
            }} />
            <span className="text-xs font-bold" style={{ color: 'var(--color-text)' }}>
              {info.online ? 'Онлайн' : info.starting ? 'Запуск…' : 'Выключен'}
            </span>
            {addr && (
              <button onClick={() => void copyField(addr)}
                className="flex items-center gap-1.5 text-xs font-mono" style={{ color: 'var(--color-primary)' }}>
                <Globe size={12} /> {addr}
                {copied ? <Check size={12} style={{ color: 'var(--color-success, #22c55e)' }} /> : <Copy size={12} />}
              </button>
            )}
            {info.players && info.players.length > 0 && (
              <span className="text-[11px] flex items-center gap-1" style={{ color: 'var(--color-text-secondary)' }}>
                <Trophy size={12} /> {info.players.length}{info.slots ? `/${info.slots}` : ''}
              </span>
            )}
            <div className="flex-1" />
            <button onClick={openServerBrowser}
              className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-semibold"
              style={{ background: 'var(--color-surface-2)', color: 'var(--color-text)', border: '1px solid var(--color-border)' }}>
              <ExternalLink size={12} /> Настройки
            </button>
            <button onClick={startServer} disabled={busy === 'aternos_start' || info.online}
              className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-bold"
              style={{ background: 'var(--color-success, #22c55e)', color: '#fff', opacity: busy === 'aternos_start' || info.online ? 0.6 : 1 }}>
              {busy === 'aternos_start' ? <Loader2 size={12} className="animate-spin" /> : <Play size={12} />} Старт
            </button>
            <button onClick={stopServer} disabled={busy === 'aternos_stop' || info.starting}
              className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-bold"
              style={{ background: 'var(--color-danger, #ef4444)', color: '#fff', opacity: busy === 'aternos_stop' || info.starting ? 0.6 : 1 }}>
              {busy === 'aternos_stop' ? <Loader2 size={12} className="animate-spin" /> : <Square size={12} />} Стоп
            </button>
            <button onClick={restartServer} disabled={busy === 'aternos_restart'}
              className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-semibold"
              style={{ background: 'var(--color-surface-2)', color: 'var(--color-text)', border: '1px solid var(--color-border)', opacity: busy === 'aternos_restart' ? 0.6 : 1 }}>
              {busy === 'aternos_restart' ? <Loader2 size={12} className="animate-spin" /> : <RotateCw size={12} />} Рестарт
            </button>
          </div>

          {/* tabs */}
          <div className="flex gap-1 shrink-0">
            {([
              ['console', Terminal, 'Консоль'],
              ['catalog', Package, 'Каталог модов'],
              ['settings', Wrench, 'Настройки'],
              ['files', FolderOpen, 'Файлы'],
            ] as [Tab, any, string][]).map(([key, Icon, label]) => (
              <button key={key}
                onClick={() => { setTab(key); if (key === 'console') void openConsole(); if (key === 'files') void loadFiles(); }}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors"
                style={{
                  background: tab === key ? 'var(--color-surface-hover)' : 'transparent',
                  color: tab === key ? 'var(--color-primary)' : 'var(--color-text-secondary)',
                  border: `1px solid ${tab === key ? 'var(--color-border-strong)' : 'transparent'}`,
                }}>
                <Icon size={13} /> {label}
              </button>
            ))}
          </div>

          {/* panel */}
          <div className="flex-1 min-h-0 overflow-hidden rounded-xl"
            style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)' }}>

            {tab === 'console' && (
              <div className="flex flex-col h-full">
                <div ref={consoleRef}
                  className="flex-1 overflow-y-auto px-3 py-2 font-mono text-[11px] leading-relaxed space-y-0.5"
                  style={{ background: 'rgba(0,0,0,.28)', color: '#cbd5e1' }}
                  onClick={() => void openConsole()}>
                  {consoleLines.length === 0 && (
                    <div className="text-xs opacity-60">Подключение к консоли… Введите /help для списка команд.</div>
                  )}
                  {consoleLines.map((l, i) => (
                    <div key={i} className="whitespace-pre-wrap break-words">{l}</div>
                  ))}
                </div>
                <form onSubmit={e => { e.preventDefault(); void sendCommand(); }}
                  className="flex gap-2 p-2.5 shrink-0" style={{ borderTop: '1px solid var(--color-border)' }}>
                  <input
                    value={consoleInput}
                    onChange={e => setConsoleInput(e.target.value)}
                    placeholder="/op ник · /gamemode creative · /give …"
                    className="flex-1 px-3 py-2 rounded-lg text-xs font-mono outline-none"
                    style={{ background: 'var(--color-bg)', color: 'var(--color-text)', border: '1px solid var(--color-border)' }}
                  />
                  <button type="submit"
                    className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-bold"
                    style={{ background: 'var(--color-primary)', color: '#fff' }}>
                    <Terminal size={13} /> Отправить
                  </button>
                </form>
              </div>
            )}

            {tab === 'catalog' && (
              <div className="flex flex-col h-full">
                <form onSubmit={e => { e.preventDefault(); void searchCatalog(); }}
                  className="flex gap-2 p-3 shrink-0">
                  <input
                    value={catQuery}
                    onChange={e => setCatQuery(e.target.value)}
                    placeholder="Поиск модов на Modrinth… («fabric api», «create», «sodium»)"
                    className="flex-1 px-3 py-2 rounded-lg text-xs outline-none"
                    style={{ background: 'var(--color-bg)', color: 'var(--color-text)', border: '1px solid var(--color-border)' }}
                  />
                  <button type="submit" disabled={searching}
                    className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-bold"
                    style={{ background: 'var(--color-primary)', color: '#fff', opacity: searching ? 0.6 : 1 }}>
                    {searching ? <Loader2 size={13} className="animate-spin" /> : <Search size={13} />} Найти
                  </button>
                </form>
                <div className="flex-1 overflow-y-auto px-3 pb-3 space-y-2">
                  {catResults.map((m: any, idx) => (
                    <div key={m?.project_id || idx}
                      className="flex items-center gap-3 px-3 py-2.5 rounded-lg"
                      style={{ background: 'var(--color-surface-2)', border: '1px solid var(--color-border)' }}>
                      {m?.icon_url && (
                        <img src={m.icon_url} alt="" className="w-9 h-9 rounded-md object-cover shrink-0" style={{ background: 'var(--color-bg)' }} />
                      )}
                      <div className="flex-1 min-w-0">
                        <div className="text-xs font-bold truncate" style={{ color: 'var(--color-text)' }}>{m?.title ?? m?.slug ?? m?.project_id}</div>
                        <div className="text-[10px] truncate" style={{ color: 'var(--color-text-secondary)' }}>
                          {m?.description || m?.downloads ? `↓ ${m?.downloads ?? ''}` : ''}
                        </div>
                      </div>
                      <button
                        onClick={() => { setSettingsNote(`Мод «${m?.title ?? m?.project_id}»: установка обрабатывается вручную — добавьте его через «Настройки» Aternos (Addons tray) или загрузите .jar в «Файлы».`); }}
                        className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[11px] font-semibold"
                        style={{ background: 'var(--color-surface-hover)', color: 'var(--color-primary)', border: '1px solid var(--color-border-strong)' }}>
                        <Package size={11} /> Установить
                      </button>
                    </div>
                  ))}
                  {catResults.length === 0 && !searching && (
                    <div className="text-xs text-center py-8" style={{ color: 'var(--color-text-tertiary)' }}>
                      Найдите мод — и установите через Aternos: добавьте его на сервер в разделе
                      Addons, либо поместите .jar в файлы (mods/).
                    </div>
                  )}
                </div>
              </div>
            )}

            {tab === 'settings' && (
              <div className="h-full overflow-y-auto p-4 space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <div className="p-3.5 rounded-lg" style={{ background: 'var(--color-surface-2)', border: '1px solid var(--color-border)' }}>
                    <span className="flex items-center gap-1.5 text-xs font-bold mb-1.5" style={{ color: 'var(--color-text)' }}>
                      <FileText size={13} /> MOTD
                    </span>
                    <input value={motd}
                      onChange={e => setMotd(e.target.value)}
                      className="w-full px-3 py-2 rounded-lg text-xs outline-none mb-2"
                      style={{ background: 'var(--color-bg)', color: 'var(--color-text)', border: '1px solid var(--color-border)' }} />
                    <button onClick={() => void saveMotd()}
                      className="px-3 py-1.5 rounded-lg text-[11px] font-bold"
                      style={{ background: 'var(--color-primary)', color: '#fff' }}>Сохранить MOTD</button>
                  </div>
                  <div className="p-3.5 rounded-lg" style={{ background: 'var(--color-surface-2)', border: '1px solid var(--color-border)' }}>
                    <span className="flex items-center gap-1.5 text-xs font-bold mb-1.5" style={{ color: 'var(--color-text)' }}>
                      <Globe size={13} /> Поддомен
                    </span>
                    <div className="flex items-center gap-1.5 mb-2">
                      <input value={subdomain}
                        onChange={e => setSubdomain(e.target.value)}
                        className="flex-1 px-3 py-2 rounded-lg text-xs outline-none"
                        style={{ background: 'var(--color-bg)', color: 'var(--color-text)', border: '1px solid var(--color-border)' }} />
                      <span className="text-[11px] font-mono" style={{ color: 'var(--color-text-secondary)' }}>.aternos.me</span>
                    </div>
                    <button onClick={() => void saveSubdomain()}
                      className="px-3 py-1.5 rounded-lg text-[11px] font-bold"
                      style={{ background: 'var(--color-primary)', color: '#fff' }}>Сохранить поддомен</button>
                  </div>
                </div>

                <div className="p-3.5 rounded-lg space-y-3" style={{ background: 'var(--color-surface-2)', border: '1px solid var(--color-border)' }}>
                  <span className="flex items-center gap-1.5 text-xs font-bold" style={{ color: 'var(--color-text)' }}>
                    <Wifi size={13} /> Режим «24/7»
                  </span>
                  <div className="flex items-center gap-2">
                    <button onClick={() => void toggleWatch()} disabled={watching}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-bold"
                      style={{ background: watchOn ? 'var(--color-success, #22c55e)' : 'var(--color-surface-hover)', color: watchOn ? '#fff' : 'var(--color-text)' }}>
                      {watching ? <Loader2 size={12} className="animate-spin" /> : watchOn ? <Wifi size={12} /> : <WifiOff size={12} />}
                      Автоперезапуск: {watchOn ? 'ВКЛ' : 'выкл'}
                    </button>
                    <button onClick={() => void toggleAfk()}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-bold"
                      style={{ background: afkOn ? 'var(--color-primary)' : 'var(--color-surface-hover)', color: afkOn ? '#fff' : 'var(--color-text)' }}>
                      <Trophy size={12} /> AFK-бот: {afkOn ? 'ВКЛ' : 'выкл'}
                    </button>
                    <input value={afkNick}
                      onChange={e => setAfkNick(e.target.value)}
                      placeholder="Ник бота"
                      className="w-32 px-2.5 py-1.5 rounded-lg text-[11px] outline-none"
                      style={{ background: 'var(--color-bg)', color: 'var(--color-text)', border: '1px solid var(--color-border)' }} />
                  </div>
                  <div className="text-[10px] leading-relaxed" style={{ color: 'var(--color-text-tertiary)' }}>
                    Автоперезапуск проверяет сервер раз в ~50 с и поднимает его, если он упал (Aternos может выключить по таймеру).
                    AFK-бот заходит на сервер под выбранным ником и удерживает его от перехода в сон. Бот экспериментальный: если его выкинет, он переподключится.
                  </div>
                </div>

                <div className="p-3.5 rounded-lg" style={{ background: 'var(--color-surface-2)', border: '1px solid var(--color-border)' }}>
                  <span className="flex items-center gap-1.5 text-xs font-bold mb-1.5" style={{ color: 'var(--color-text)' }}>
                    <ShieldCheck size={13} /> Безопасность
                  </span>
                  <div className="text-[11px] leading-relaxed" style={{ color: 'var(--color-text-secondary)' }}>
                    Пароль хранится только в Credential Manager Windows (keyring), не записывается в настройки лаунчера.
                    Запросы к API задерживаются, чтобы не рисковать банами учётной записи.
                  </div>
                </div>

                {settingsNote && (
                  <div className="px-3 py-2 rounded-lg text-[11px] font-medium"
                    style={{ background: 'var(--color-surface-hover)', color: 'var(--color-text-secondary)', border: '1px solid var(--color-border)' }}>
                    {settingsNote}
                  </div>
                )}
              </div>
            )}

            {tab === 'files' && (
              <div className="flex flex-col h-full">
                <div className="flex gap-2 p-3 shrink-0 items-center">
                  <input value={filesPath}
                    onChange={e => setFilesPath(e.target.value)}
                    placeholder="mods/ или оставьте пустым для корня"
                    className="flex-1 px-3 py-2 rounded-lg text-xs font-mono outline-none"
                    style={{ background: 'var(--color-bg)', color: 'var(--color-text)', border: '1px solid var(--color-border)' }} />
                  <button onClick={() => void loadFiles()} disabled={loadingFiles}
                    className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-bold"
                    style={{ background: 'var(--color-primary)', color: '#fff', opacity: loadingFiles ? 0.6 : 1 }}>
                    {loadingFiles ? <Loader2 size={13} className="animate-spin" /> : <FolderOpen size={13} />} Открыть
                  </button>
                </div>
                <div className="flex-1 overflow-y-auto px-3 pb-3 space-y-1">
                  {files.map(f => (
                    <div key={f.path}
                      className="flex items-center gap-3 px-3 py-2 rounded-lg"
                      style={{ background: 'var(--color-surface-2)', border: '1px solid var(--color-border)' }}>
                      {f.kind === 'folder'
                        ? <FolderOpen size={15} style={{ color: 'var(--color-warning, #f59e0b)' }} />
                        : <FileText size={15} style={{ color: 'var(--color-text-secondary)' }} />}
                      <span className="flex-1 text-xs font-medium truncate" style={{ color: 'var(--color-text)' }}>
                        {f.path.split('/').filter(Boolean).pop()}
                      </span>
                      <span className="text-[10px]" style={{ color: 'var(--color-text-tertiary)' }}>{f.size || ''}</span>
                      {f.kind === 'file' && (
                        <button onClick={() => void downloadFile(f)}
                          className="flex items-center gap-1 px-2 py-1 rounded-md text-[10px] font-semibold"
                          style={{ background: 'var(--color-surface-hover)', color: 'var(--color-primary)' }}>
                          <Download size={11} /> Скачать
                        </button>
                      )}
                    </div>
                  ))}
                  {files.length === 0 && !loadingFiles && (
                    <div className="text-xs text-center py-8" style={{ color: 'var(--color-text-tertiary)' }}>
                      Пусто. Попробуйте «mods/» — туда можно класть .jar-моды.
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export default AternosPage;
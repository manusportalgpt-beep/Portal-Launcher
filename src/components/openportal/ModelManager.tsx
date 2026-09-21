import { useEffect, useReducer, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Plus, ChevronLeft, ChevronRight, ChevronDown, KeyRound, Link2, Server, Check, ExternalLink, RefreshCw, PlugZap, WifiOff } from 'lucide-react';
import { invoke } from '@tauri-apps/api/core';
import { OP_PROVIDERS, customProviderId, modelsListUrl, type ProviderDef } from '@/lib/opencore/providers';
import { useOpenCoreStore, activeProviders, isProviderEnabled, isModelEnabled } from '@/stores/opencoreStore';

function Toggle({ value, onChange, disabled }: { value: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <button
      disabled={disabled}
      onClick={e => { e.stopPropagation(); onChange(!value); }}
      className="relative shrink-0 transition-opacity disabled:opacity-40"
      style={{ width: 34, height: 20 }}>
      <div className="absolute inset-0 rounded-full transition-colors"
        style={{ background: value ? 'var(--color-primary)' : 'var(--color-surface)', border: `1px solid ${value ? 'var(--color-primary)' : 'var(--color-border)'}` }} />
      <div className="absolute top-0.5 transition-[left]" style={{ width: 12, height: 12, borderRadius: 6, background: '#fff', left: value ? 18 : 3 }} />
    </button>
  );
}

function KeyInput({ label, value, onChange, placeholder }: { label: string; value: string; onChange: (v: string) => void; placeholder?: string }) {
  return (
    <label className="block">
      <span className="mb-1 block text-[11px] font-semibold" style={{ color: 'var(--color-text-tertiary)' }}>{label}</span>
      <input type="password" value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder}
        className="w-full rounded-lg px-3 py-2 text-sm" style={{ background: 'var(--color-surface-2)', border: '1px solid var(--color-border)', color: 'var(--color-text)' }} />
    </label>
  );
}

function SectionHeader({ title, count }: { title: string; count?: number }) {
  return (
    <div className="mb-2 mt-1 flex items-center gap-2">
      <span className="text-[11px] font-black uppercase tracking-wider" style={{ color: 'var(--color-text-tertiary)' }}>{title}</span>
      {count !== undefined && (
        <span className="rounded-full px-1.5 py-0.5 text-[9px] font-black" style={{ background: 'var(--color-surface-2)', color: 'var(--color-text-secondary)', border: '1px solid var(--color-border)' }}>{count}</span>
      )}
    </div>
  );
}

/** Кто из подключённых провайдеров раскрыт. Хранится на уровне модуля, поэтому
 * переживает закрытие модалки; открыта может быть только одна панель (аккордеон). */
let lastExpandedProviderId: string | null = null;
const accordionListeners = new Set<() => void>();
function setLastExpanded(id: string | null) {
  if (lastExpandedProviderId === id) return;
  lastExpandedProviderId = id;
  accordionListeners.forEach(l => l());
}
/** Подписка ряда на текущую раскрытую панель (общая для всех подключённых). */
function useAccordion(id: string) {
  const [, force] = useReducer((x: number) => x + 1, 0);
  useEffect(() => {
    accordionListeners.add(force);
    return () => accordionListeners.delete(force);
  }, [force]);
  return lastExpandedProviderId === id;
}

/** Подключённый провайдер: заголовок + переключатель + раскрывающийся список моделей из API. */
function ConnectedProviderRow({ p, onToggle }: { p: ProviderDef; onToggle: () => void }) {
  const cfg = useOpenCoreStore(s => s.config);
  const setProviderApiKey = useOpenCoreStore(s => s.setProviderApiKey);
  const setProviderBaseUrl = useOpenCoreStore(s => s.setProviderBaseUrl);
  const setProviderModels = useOpenCoreStore(s => s.setProviderModels);
  const hasApi = Boolean(cfg.providers[p.id]?.apiKey);
  const storedKey = cfg.providers[p.id]?.apiKey ?? '';
  const legacyZenKey = p.id === 'opencode-zen' && storedKey.startsWith('sk-');
  const open = useAccordion(p.id);
  const setOpen = (v: boolean | ((o: boolean) => boolean)) => {
    const next = typeof v === 'function' ? !open : v;
    setLastExpanded(next ? p.id : null);
  };
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const baseUrl = (cfg.providers[p.id]?.baseUrl || p.baseUrl).replace(/\/+$/, '');

  async function loadModels() {
    if (!baseUrl) return;
    setLoading(true); setError(null);
    try {
      const list = await invoke<{ id: string; name?: string | null }[]>('op_list_models', {
        url: modelsListUrl(p, baseUrl),
        apiKey: cfg.providers[p.id]?.apiKey ?? null,
      });
      setProviderModels(p.id, list.map(m => ({
        id: m.id,
        name: m.name || undefined,
        free: m.id.endsWith('-free') || /free/i.test(m.id),
      })));
    } catch (e) {
      setError(String(e));
      setProviderModels(p.id, []);
    } finally {
      setLoading(false);
    }
  }

  // Автозагрузка моделей: на монтирование и при изменении baseUrl (переподключение).
  useEffect(() => {
    if (baseUrl) void loadModels();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Список моделей берётся из активного провайдера (store уже смёрджил модели из API в p.models).
  const models = p.models;

  return (
    <div className="rounded-2xl border p-3" style={{ borderColor: 'var(--color-border)', background: 'var(--color-surface-2)' }}>
      <div className="flex items-center gap-3">
        <button onClick={() => setOpen(o => !o)} className="flex min-w-0 flex-1 items-center gap-3 text-left">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-[11px] font-black"
            style={{ background: 'var(--color-surface)', color: 'var(--color-primary)', border: '1px solid var(--color-border)' }}>
            {p.name.slice(0, 2).toUpperCase()}
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5">
              <p className="truncate text-sm font-bold" style={{ color: 'var(--color-text)' }}>{p.name}</p>
              {p.supportsFree && <span className="text-[10px] font-bold" style={{ color: 'var(--color-success)' }}>free</span>}
            </div>
            <p className="truncate text-[11px]" style={{ color: 'var(--color-text-tertiary)' }}>
              {loading ? 'Загрузка моделей…' : `${models.length} моделей`}
              {p.apiKeyHint ? (hasApi ? ' · ключ задан' : ' · ключ не задан') : ''}
            </p>
          </div>
        </button>
        <span className="flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider" style={{ color: 'var(--color-success)' }}>
          <PlugZap size={11} /> подключено
        </span>
        <Toggle value={true} onChange={onToggle} />
        <button onClick={() => setOpen(o => !o)} title="Модели и ключ"
          className="flex h-7 w-7 items-center justify-center rounded-lg transition-opacity hover:opacity-70"
          style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', color: 'var(--color-text-secondary)' }}>
          {open ? <ChevronLeft size={14} /> : <ChevronRight size={14} />}
        </button>
      </div>

      <AnimatePresence>
      {open && (
        <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="overflow-hidden">
          <div className="mt-3 space-y-2 border-t pt-3" style={{ borderColor: 'var(--color-border)' }}>
            {p.apiKeyHint && (
              <KeyInput label="API-ключ" value={cfg.providers[p.id]?.apiKey ?? ''} placeholder={p.apiKeyHint}
                onChange={v => setProviderApiKey(p.id, v)} />
            )}
            {legacyZenKey && (
              <p className="text-[11px] leading-snug" style={{ color: '#f0b429' }}>
                Ключ sk-... устарел (старый мир OpenCode): free-модели с ним не работают. Получи новый ключ
                (oc_sk_...) на сайте opencode.ai/auth и впиши его ниже.
              </p>
            )}
            {p.keyUrl && (
              <button
                onClick={() => void invoke('open_url', { url: p.keyUrl }).catch(() => window.open(p.keyUrl, '_blank'))}
                className="flex items-center gap-1.5 text-[11px] font-semibold transition-opacity hover:opacity-70"
                style={{ color: 'var(--color-primary)' }}>
                <ExternalLink size={11} /> Получить ключ{p.id === 'opencode-zen' ? ' (новый oc_sk_)' : ''}
              </button>
            )}
            <label className="block">
              <span className="mb-1 flex items-center gap-1 text-[11px] font-semibold" style={{ color: 'var(--color-text-tertiary)' }}>
                <Link2 size={11} /> Base URL (опционально)
              </span>
              <input type="text" value={cfg.providers[p.id]?.baseUrl ?? p.baseUrl} placeholder={p.baseUrl}
                onChange={e => { setProviderBaseUrl(p.id, e.target.value); }}
                onBlur={() => void loadModels()}
                className="w-full rounded-lg px-3 py-2 text-xs font-mono" style={{ background: 'var(--color-surface-2)', border: '1px solid var(--color-border)', color: 'var(--color-text)' }} />
            </label>
            <div className="flex items-center justify-between">
              <span className="flex items-center gap-1 text-[11px] font-semibold" style={{ color: 'var(--color-text-tertiary)' }}>
                <Server size={11} /> Модели из API ({models.length})
              </span>
              <button onClick={() => void loadModels()} disabled={loading || !baseUrl}
                className="flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-bold transition-opacity disabled:opacity-40"
                style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', color: 'var(--color-text-secondary)' }}>
                <RefreshCw size={11} className={loading ? 'animate-spin' : ''} /> {loading ? 'Загрузка…' : error ? 'Повторить' : 'Обновить'}
              </button>
            </div>
            {error && <p className="text-[11px] leading-5" style={{ color: 'var(--color-error)' }}>API недоступен: {error}</p>}
            {models.length > 0 && (
              <div className="max-h-56 overflow-y-auto rounded-xl border p-2" style={{ borderColor: 'var(--color-border)', background: 'var(--color-surface)' }}>
                {models.map(m => {
                  const on = isModelEnabled(p, m.id, cfg);
                  return (
                    <div key={m.id} className="flex items-center gap-2 py-1.5 px-1">
                      <Toggle value={on} onChange={v => useOpenCoreStore.getState().toggleModel(p.id, m.id, v)} />
                      <span className="min-w-0 flex-1 truncate text-xs" style={{ color: 'var(--color-text)' }}>
                        {m.name ?? m.id}
                        {m.free ? <span className="ml-1 text-[10px] font-bold" style={{ color: 'var(--color-success)' }}>Бесплатно</span> : null}
                        {m.reasoning ? <span className="ml-1 text-[10px]" style={{ color: 'var(--color-text-tertiary)' }}>think</span> : null}
                      </span>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </motion.div>
      )}
      </AnimatePresence>
    </div>
  );
}

/** Неподключённый провайдер: компактная карточка с кнопкой «Подключить» и мгновенным вводом API-ключа. */
function AvailableProviderCard({ p }: { p: ProviderDef }) {
  const cfg = useOpenCoreStore(s => s.config);
  const [show, setShow] = useState(false);
  const [apiKey, setApiKey] = useState('');

  function connect() {
    const st = useOpenCoreStore.getState();
    if (apiKey.trim()) st.setProviderApiKey(p.id, apiKey.trim());
    st.toggleProvider(p.id, true);
    setShow(false);
  }

  return (
    <div className="rounded-2xl border p-3" style={{ borderColor: 'var(--color-border)', background: 'var(--color-surface-2)' }}>
      <div className="flex items-center gap-3">
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-[11px] font-black"
          style={{ background: 'var(--color-surface)', color: 'var(--color-text-secondary)', border: '1px solid var(--color-border)' }}>
          {p.name.slice(0, 2).toUpperCase()}
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-bold" style={{ color: 'var(--color-text)' }}>{p.name}</p>
          <p className="flex items-center gap-1 truncate text-[11px]" style={{ color: 'var(--color-text-tertiary)' }}>
            <WifiOff size={10} /> не подключено{cfg.providers[p.id]?.apiKey ? ' (ключ есть)' : ''}
          </p>
        </div>
        <button onClick={() => { setShow(s => !s); setApiKey(''); }}
          className="flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-xs font-bold transition-opacity hover:opacity-80"
          style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', color: 'var(--color-text)' }}>
          {show ? <ChevronRight size={13} /> : <ChevronDown size={13} />} {show ? 'Свернуть' : 'Подключить'}
        </button>
      </div>

      <AnimatePresence>
      {show && (
        <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="overflow-hidden">
          <div className="mt-3 space-y-2 border-t pt-3" style={{ borderColor: 'var(--color-border)' }}>
            {p.apiKeyHint && (
              <KeyInput label="API-ключ" value={apiKey} onChange={setApiKey} placeholder={p.apiKeyHint} />
            )}
            {p.keyUrl && (
              <button
                onClick={() => void invoke('open_url', { url: p.keyUrl }).catch(() => window.open(p.keyUrl, '_blank'))}
                className="flex items-center gap-1.5 text-[11px] font-semibold transition-opacity hover:opacity-70"
                style={{ color: 'var(--color-primary)' }}>
                <ExternalLink size={11} /> Получить ключ{p.id === 'opencode-zen' ? ' (новый oc_sk_)' : ''}
              </button>
            )}
            {!p.apiKeyHint && (
              <p className="text-[11px]" style={{ color: 'var(--color-text-tertiary)' }}>Ключ не требуется — модели появятся после подключения.</p>
            )}
            <button onClick={connect} disabled={Boolean(p.apiKeyHint) && !apiKey.trim()}
              className="flex items-center gap-1.5 rounded-xl px-4 py-2 text-xs font-bold transition-opacity disabled:opacity-40"
              style={{ background: 'var(--color-primary)', color: 'var(--color-primary-text)' }}>
              <Check size={13} /> Подключить и загрузить модели
            </button>
          </div>
        </motion.div>
      )}
      </AnimatePresence>
    </div>
  );
}

/** Настройка провайдера генерации изображений: Stable Horde (бесплатно) или Novita AI (по ключу). */
function ImageGenSection() {
  const cfg = useOpenCoreStore(s => s.config);
  const val = cfg.imageGenProvider ?? 'stable_horde';
  const novitaKey = cfg.serviceTokens?.['api.novita.ai'] ?? '';
  const setToken = useOpenCoreStore(s => s.setServiceToken);

  const radio = (id: 'stable_horde' | 'novita', title: string, desc: string) => (
    <button onClick={() => useOpenCoreStore.getState().setImageGenProvider(id)}
      className="flex min-w-0 flex-1 items-start gap-2 rounded-xl border p-2.5 text-left transition-colors"
      style={{
        borderColor: val === id ? 'var(--color-primary)' : 'var(--color-border)',
        background: val === id ? 'color-mix(in srgb, var(--color-primary) 8%, transparent)' : 'var(--color-surface)',
      }}>
      <span className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full border"
        style={{ borderColor: val === id ? 'var(--color-primary)' : 'var(--color-border)' }}>
        {val === id && <span className="h-2 w-2 rounded-full" style={{ background: 'var(--color-primary)' }} />}
      </span>
      <span className="min-w-0">
        <span className="block text-xs font-bold" style={{ color: 'var(--color-text)' }}>{title}</span>
        <span className="block text-[10px] leading-4" style={{ color: 'var(--color-text-tertiary)' }}>{desc}</span>
      </span>
    </button>
  );

  return (
    <div className="mb-4">
      <SectionHeader title="Генерация Изображений" />
      <div className="rounded-2xl border p-3" style={{ borderColor: 'var(--color-border)', background: 'var(--color-surface-2)' }}>
        <div className="flex flex-col gap-2">
          <div className="flex flex-col gap-2 sm:flex-row">
            {radio('stable_horde', 'Stable Horde', 'Бесплатно, без ключа. Общая очередь краудсорсинг-кластера.')}
            {radio('novita', 'Novita AI', 'По ключу api.novita.ai. Быстрее, модель DreamShaper XL.')}
          </div>
          {val === 'novita' && (
            <div className="space-y-2">
              <KeyInput label="Ключ Novita AI (используется и чат-провайдером Novita)"
                value={novitaKey} placeholder="nvapi-..." onChange={v => setToken('api.novita.ai', v)} />
              <button
                onClick={() => void invoke('open_url', { url: 'https://novita.ai' }).catch(() => window.open('https://novita.ai', '_blank'))}
                className="flex items-center gap-1.5 text-[11px] font-semibold transition-opacity hover:opacity-70"
                style={{ color: 'var(--color-primary)' }}>
                <ExternalLink size={11} /> novita.ai — получить ключ
              </button>
              {!novitaKey && (
                <p className="text-[11px] leading-5" style={{ color: 'var(--color-text-tertiary)' }}>
                  Без ключа агент подскажет открыть эти настройки при попытке генерации.
                </p>
              )}
            </div>
          )}
          {val === 'stable_horde' && (
            <p className="text-[11px] leading-5" style={{ color: 'var(--color-text-tertiary)' }}>
              Анонимные запросы могут стоять в очереди; можно подключить Novita AI для более быстрых результатов.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

export function ModelManager() {
  const open = useOpenCoreStore(s => s.modelsMenuOpen);
  const setOpen = useOpenCoreStore(s => s.setModelsMenuOpen);
  const cfg = useOpenCoreStore(s => s.config);
  const [showCustom, setShowCustom] = useState(false);
  const [cName, setCName] = useState('');
  const [cUrl, setCUrl] = useState('');
  const [cKey, setCKey] = useState('');

  useEffect(() => {
    if (!open) setShowCustom(false);
  }, [open]);

  const all = activeProviders(cfg);
  const connected = all.filter(p => isProviderEnabled(p, cfg));
  const available = all.filter(p => !isProviderEnabled(p, cfg));
  const hasZen = all.some(p => p.id === 'opencode-zen');

  function addCustom() {
    if (!cName.trim()) return;
    const id = customProviderId(cName);
    useOpenCoreStore.setState({
      config: {
        ...useOpenCoreStore.getState().config,
        providers: {
          ...useOpenCoreStore.getState().config.providers,
          [id]: { enabled: true, apiKey: cKey.trim() || undefined, baseUrl: cUrl.trim() || undefined, customName: cName.trim(), modelStates: {} },
        },
      },
    });
    useOpenCoreStore.getState().setActiveModel(id, '');
    setShowCustom(false); setCName(''); setCUrl(''); setCKey('');
  }

  return (
    <AnimatePresence>
    {open && (
      <motion.div
        initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
        className="fixed inset-0 z-50 flex items-center justify-center p-6"
        style={{ background: 'rgba(0,0,0,0.55)', backdropFilter: 'blur(6px)' }}
        onMouseDown={e => { if (e.target === e.currentTarget) setOpen(false); }}>
        <motion.div
          initial={{ scale: 0.97, opacity: 0, y: 8 }} animate={{ scale: 1, opacity: 1, y: 0 }} exit={{ scale: 0.97, opacity: 0, y: 8 }}
          className="flex h-[min(82vh,760px)] w-[min(640px,94vw)] flex-col overflow-hidden rounded-3xl border"
          style={{ background: 'var(--color-surface)', borderColor: 'var(--color-border)', boxShadow: '0 32px 80px rgba(0,0,0,.45)' }}>
          <div className="flex items-center gap-2 px-5 py-4 border-b" style={{ borderColor: 'var(--color-border)' }}>
            <Server size={16} style={{ color: 'var(--color-primary)' }} />
            <h2 className="flex-1 text-base font-black" style={{ color: 'var(--color-text)' }}>Управление моделями</h2>
            <button onClick={() => setOpen(false)} className="flex h-7 w-7 items-center justify-center rounded-lg transition-colors hover:bg-[var(--color-surface-2)]" style={{ color: 'var(--color-text-secondary)' }}>
              <X size={16} />
            </button>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto p-4">
            <ImageGenSection />
            {connected.length > 0 && (
              <>
                <SectionHeader title="Подключено" count={connected.length} />
                <div className="space-y-2">
                  {connected.map(p => (
                    <ConnectedProviderRow key={p.id} p={p}
                      onToggle={() => useOpenCoreStore.getState().toggleProvider(p.id, false)} />
                  ))}
                </div>
              </>
            )}

            {connected.length === 0 && (
              <div className="mb-4 flex flex-col items-center justify-center rounded-2xl border border-dashed py-8 text-center"
                style={{ borderColor: 'var(--color-border)' }}>
                <WifiOff size={22} style={{ color: 'var(--color-text-tertiary)' }} />
                <p className="mt-2 text-sm font-bold" style={{ color: 'var(--color-text-secondary)' }}>Ничего не подключено</p>
                <p className="mt-1 max-w-xs text-[11px] leading-5" style={{ color: 'var(--color-text-tertiary)' }}>
                  Подключите провайдера снизу — сразу можно ввести API-ключ.
                </p>
              </div>
            )}

            {available.length > 0 && (
              <>
                <SectionHeader title="Добавить провайдера" count={available.length} />
                <div className="space-y-2">
                  {available.map(p => <AvailableProviderCard key={p.id} p={p} />)}
                </div>
              </>
            )}

            {!showCustom ? (
              <button onClick={() => setShowCustom(true)}
                className="mt-3 flex w-full items-center justify-center gap-2 rounded-2xl border-2 border-dashed py-3 text-sm font-bold transition-colors hover:opacity-80"
                style={{ borderColor: 'var(--color-border)', color: 'var(--color-text-secondary)' }}>
                <Plus size={16} /> Добавить свой (OpenAI-совместимый)
              </button>
            ) : (
              <div className="mt-3 space-y-3 rounded-2xl border p-3" style={{ borderColor: 'var(--color-border)', background: 'var(--color-surface-2)' }}>
                <p className="text-xs leading-5" style={{ color: 'var(--color-text-secondary)' }}>
                  Любой endpoint <code className="font-mono">…/chat/completions</code>: OpenRouter, Groq, Together, локальные gateway.
                </p>
                <label className="block">
                  <span className="mb-1 block text-[11px] font-semibold" style={{ color: 'var(--color-text-tertiary)' }}>Название</span>
                  <input value={cName} onChange={e => setCName(e.target.value)} placeholder="Мой провайдер"
                    className="w-full rounded-lg px-3 py-2 text-sm" style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', color: 'var(--color-text)' }} />
                </label>
                <label className="block">
                  <span className="mb-1 block text-[11px] font-semibold" style={{ color: 'var(--color-text-tertiary)' }}>Base URL</span>
                  <input value={cUrl} onChange={e => setCUrl(e.target.value)} placeholder="https://api.example.com/v1"
                    className="w-full rounded-lg px-3 py-2 text-sm font-mono" style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', color: 'var(--color-text)' }} />
                </label>
                <KeyInput label="API-ключ" value={cKey} onChange={setCKey} placeholder="sk-..." />
                <div className="flex gap-2">
                  <button onClick={addCustom}
                    className="flex items-center gap-1.5 rounded-xl px-4 py-2 text-sm font-bold"
                    style={{ background: 'var(--color-primary)', color: 'var(--color-primary-text)' }}>
                    <Check size={14} /> Добавить
                  </button>
                  <button onClick={() => setShowCustom(false)}
                    className="rounded-xl px-4 py-2 text-sm font-bold" style={{ background: 'var(--color-surface-2)', color: 'var(--color-text-secondary)', border: '1px solid var(--color-border)' }}>
                    Отмена
                  </button>
                </div>
              </div>
            )}
          </div>

          <div className="border-t px-5 py-3.5 text-[11px] leading-5" style={{ borderColor: 'var(--color-border)', color: 'var(--color-text-tertiary)' }}>
            <KeyRound className="mb-1 inline h-3.5 w-3.5 align-text-bottom" style={{ display: 'inline', marginRight: 6 }} />
            Ключи хранятся локально в папке OpenPortal (Config). По умолчанию подключён OpenCode Zen{hasZen ? ' — бесплатный' : ''}; списки моделей загружаются с API выбранного провайдера.
          </div>
        </motion.div>
      </motion.div>
    )}
    </AnimatePresence>
  );
}
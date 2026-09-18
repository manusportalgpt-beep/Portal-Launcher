import { useEffect, useMemo, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Plus, ChevronLeft, ChevronRight, KeyRound, Link2, Server, Check, ExternalLink, RefreshCw } from 'lucide-react';
import { invoke } from '@tauri-apps/api/core';
import { OP_PROVIDERS, customProviderId, modelsListUrl, type ProviderDef, type ModelDef } from '@/lib/opencore/providers';
import { useOpenCoreStore, activeProviders, isProviderEnabled, isModelEnabled } from '@/stores/opencoreStore';

function Toggle({ value, onChange, disabled }: { value: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <button
      disabled={disabled}
      onClick={e => { e.stopPropagation(); onChange(!value); }}
      className="relative shrink-0 transition-opacity disabled:opacity-40"
      style={{ width: 34, height: 20 }}>
      <div className="absolute inset-0 rounded-full transition-colors"
        style={{ background: value ? 'var(--color-primary)' : 'var(--color-surface-2)', border: `1px solid ${value ? 'var(--color-primary)' : 'var(--color-border)'}` }} />
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

function ProviderRow({ p, onSelect, onToggle, isActive }: {
  p: ProviderDef;
  onSelect: () => void;
  onToggle: () => void;
  isActive: boolean;
}) {
  const cfg = useOpenCoreStore(s => s.config);
  const setProviderApiKey = useOpenCoreStore(s => s.setProviderApiKey);
  const setProviderBaseUrl = useOpenCoreStore(s => s.setProviderBaseUrl);
  const enabled = isProviderEnabled(p, cfg);
  const hasApi = Boolean(cfg.providers[p.id]?.apiKey);
  const [open, setOpen] = useState(false);
  const [remote, setRemote] = useState<ModelDef[] | null>(null);
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
      setRemote(list.map(m => ({
        id: m.id,
        name: m.name || undefined,
        free: m.id.endsWith('-free') || /free/i.test(m.id),
      })));
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (open && !remote && !loading && baseUrl) void loadModels();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const models = useMemo(() => {
    if (!remote) return p.models;
    const seen = new Map<string, ModelDef>();
    for (const m of p.models) seen.set(m.id, m);
    for (const m of remote) {
      const cur = seen.get(m.id);
      seen.set(m.id, cur ? { ...m, ...cur, free: m.free || cur.free } : m);
    }
    return Array.from(seen.values());
  }, [p.models, remote]);

  return (
    <div className="rounded-2xl border p-3" style={{ borderColor: 'var(--color-border)', background: 'var(--color-surface-2)' }}>
      <div className="flex items-center gap-3">
        <button onClick={onToggle} className="flex min-w-0 flex-1 items-center gap-3 text-left">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-[11px] font-black"
            style={{ background: 'var(--color-surface)', color: 'var(--color-primary)', border: '1px solid var(--color-border)' }}>
            {p.name.slice(0, 2).toUpperCase()}
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-bold" style={{ color: 'var(--color-text)' }}>{p.name}</p>
            <p className="truncate text-[11px]" style={{ color: 'var(--color-text-tertiary)' }}>
              {models.length} моделей · {enabled ? 'вкл' : 'выкл'}{p.apiKeyHint ? ' · ключ нужен' : ''}
              {hasApi ? ' · ключ задан' : ''}
            </p>
          </div>
        </button>
        <Toggle value={enabled} onChange={onToggle} />
        <button onClick={() => setOpen(o => !o)} title="Настроить ключ/модели"
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
            {p.keyUrl && (
              <button
                onClick={() => void invoke('open_url', { url: p.keyUrl }).catch(() => window.open(p.keyUrl, '_blank'))}
                className="flex items-center gap-1.5 text-[11px] font-semibold transition-opacity hover:opacity-70"
                style={{ color: 'var(--color-primary)' }}>
                <ExternalLink size={11} /> Получить ключ{p.id === 'opencode-zen' ? ' (бесплатно)' : ''}
              </button>
            )}
            <label className="block">
              <span className="mb-1 flex items-center gap-1 text-[11px] font-semibold" style={{ color: 'var(--color-text-tertiary)' }}>
                <Link2 size={11} /> Base URL (опционально)
              </span>
              <input type="text" value={cfg.providers[p.id]?.baseUrl ?? p.baseUrl}
                onChange={e => setProviderBaseUrl(p.id, e.target.value)}
                className="w-full rounded-lg px-3 py-2 text-xs font-mono" style={{ background: 'var(--color-surface-2)', border: '1px solid var(--color-border)', color: 'var(--color-text)' }} />
            </label>
            <div className="flex items-center justify-between">
              <span className="flex items-center gap-1 text-[11px] font-semibold" style={{ color: 'var(--color-text-tertiary)' }}>
                <Server size={11} /> Модели {remote ? `(${models.length})` : ''}
              </span>
              <button onClick={() => void loadModels()} disabled={loading || !baseUrl}
                className="flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-bold transition-opacity disabled:opacity-40"
                style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', color: 'var(--color-text-secondary)' }}>
                <RefreshCw size={11} className={loading ? 'animate-spin' : ''} /> {remote ? 'Обновить' : 'Загрузить модели'}
              </button>
            </div>
            {error && <p className="text-[11px]" style={{ color: 'var(--color-error)' }}>{error}</p>}
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

export function ModelManager() {
  const open = useOpenCoreStore(s => s.modelsMenuOpen);
  const setOpen = useOpenCoreStore(s => s.setModelsMenuOpen);
  const cfg = useOpenCoreStore(s => s.config);
  const setActiveModel = useOpenCoreStore(s => s.setActiveModel);
  const setProviderApiKey = useOpenCoreStore(s => s.setProviderApiKey);
  const setProviderBaseUrl = useOpenCoreStore(s => s.setProviderBaseUrl);
  const [showCustom, setShowCustom] = useState(false);
  const [cName, setCName] = useState('');
  const [cUrl, setCUrl] = useState('');
  const [cKey, setCKey] = useState('');

  useEffect(() => {
    if (!open) {
      setShowCustom(false);
    }
  }, [open]);

  const providers = activeProviders(cfg);

  function addCustom() {
    if (!cName.trim()) return;
    const id = customProviderId(cName);
    useOpenCoreStore.setState({
      config: {
        ...useOpenCoreStore.getState().config,
        providers: {
          ...useOpenCoreStore.getState().config.providers,
          [id]: {
            enabled: true,
            apiKey: cKey.trim() || undefined,
            baseUrl: cUrl.trim() || undefined,
            customName: cName.trim(),
            modelStates: {},
          },
        },
      },
    });
    // setActiveModel перезапишет конфиг на диск и активирует провайдера.
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
          className="flex h-[min(78vh,720px)] w-[min(620px,94vw)] flex-col overflow-hidden rounded-3xl border"
          style={{ background: 'var(--color-surface)', borderColor: 'var(--color-border)', boxShadow: '0 32px 80px rgba(0,0,0,.45)' }}>
          <div className="flex items-center gap-2 px-5 py-4 border-b" style={{ borderColor: 'var(--color-border)' }}>
            <Server size={16} style={{ color: 'var(--color-primary)' }} />
            <h2 className="flex-1 text-base font-black" style={{ color: 'var(--color-text)' }}>Управление моделями</h2>
            <button onClick={() => setOpen(false)} className="flex h-7 w-7 items-center justify-center rounded-lg transition-colors hover:bg-[var(--color-surface-2)]" style={{ color: 'var(--color-text-secondary)' }}>
              <X size={16} />
            </button>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto p-4">
            {providers.map(p => (
              <div key={p.id} className="mb-2">
                <ProviderRow
                  p={p}
                  isActive={cfg.activeProviderId === p.id}
                  onToggle={() => useOpenCoreStore.getState().toggleProvider(p.id, !isProviderEnabled(p, cfg))}
                  onSelect={() => {
                    const first = p.models[0]?.id ?? '';
                    useOpenCoreStore.getState().setActiveModel(p.id, first);
                    setOpen(false);
                  }}
                />
              </div>
            ))}

            {!showCustom ? (
              <button onClick={() => setShowCustom(true)}
                className="mt-2 flex w-full items-center justify-center gap-2 rounded-2xl border-2 border-dashed py-3 text-sm font-bold transition-colors hover:opacity-80"
                style={{ borderColor: 'var(--color-border)', color: 'var(--color-text-secondary)' }}>
                <Plus size={16} /> Добавить провайдера
              </button>
            ) : (
              <div className="mt-2 space-y-3 rounded-2xl border p-3" style={{ borderColor: 'var(--color-border)', background: 'var(--color-surface-2)' }}>
                <p className="text-xs leading-5" style={{ color: 'var(--color-text-secondary)' }}>
                  Добавьте OpenAI-совместимый провайдер (любой с endpoint <code className="font-mono">…/chat/completions</code>: OpenRouter, Groq, Together, локальные gateway).
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
            Ключи хранятся локально в папке OpenPortal (Config). Провайдеры: <span className="font-semibold" style={{ color: 'var(--color-text-secondary)' }}>{OP_PROVIDERS.length} встроенных + кастомные</span>.
          </div>
        </motion.div>
      </motion.div>
    )}
    </AnimatePresence>
  );
}
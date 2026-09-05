import { useState, useRef, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Bot, Send, X, ChevronDown, Loader2, Copy, Check, Paperclip, Image as ImageIcon, Download, FileText, File, Plus, MessageSquare, Trash } from 'lucide-react';
import { useInstanceStore } from '@/stores/instanceStore';
import { useAuthStore } from '@/stores/authStore';
import { invoke } from '@/lib/invoke-shim';
import { useChatHistory, type ChatMessage as StoredMessage } from '@/components/ai/ChatHistory';
import { toastSuccess, toastError } from '@/components/ai/FileToast';
import { PROVIDERS, endpointFor, defaultModelFor, modelGroups, type ProviderPreset } from '@/lib/ai-providers';


interface Attachment {
  name: string;
  type: string;
  size: number;
  dataUrl?: string;
  base64?: string;
  url?: string;
}

interface AIAgentProps { onClose: () => void }

const SYSTEM_PROMPT = `You are Portal Assistant (PTAgent), an AI built into Portal Launcher for Minecraft.

Capabilities:
- Answer questions about Minecraft modding, versions, loaders, Java
- Recommend mods, resource packs, shaders
- Help create/configure instances (building full modpacks on a chosen loader with all dependencies)
- Read and analyze game logs
- Install content to instances (mods, resource packs, shaders, data packs)
- Generate images for modpack covers
- Use web search when the user asks about external things or when unsure

When helping with instances:
- The user may have selected a specific instance. Work within that instance only for file operations.
- For file installation, ask which source to use (Modrinth or CurseForge) — say this in your own words in context when needed.
- Show current activity when performing actions (e.g., which mod you're looking at).
- If no instance is selected, you can still answer general questions, search the web, generate images, and help create a NEW instance.

Format: clear headers, bullet points. No emojis. Respond in the user's language.`;

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function getFileIcon(name: string) {
  const ext = name.split('.').pop()?.toLowerCase() ?? '';
  if (['png','jpg','jpeg','gif','webp','svg','bmp'].includes(ext)) return ImageIcon;
  if (['txt','log','md','json','xml','yml','yaml','toml','cfg'].includes(ext)) return FileText;
  return File;
}

function getCtx(instances: any[], user: any, selectedInstanceId?: string): string {
  const p: string[] = [];
  if (user) p.push(`Player: ${user.username}`);
  const selected = instances.find(i => i.id === selectedInstanceId);
  if (selected) {
    p.push(`Selected instance: "${selected.name}" (ID: ${selected.id})`);
    p.push(`  MC ${selected.minecraftVersion}, ${selected.modLoader}${selected.modLoaderVersion ? ' ' + selected.modLoaderVersion : ''}, RAM ${selected.maxRam}MB`);
  }
  p.push(`Total instances: ${instances.length}`);
  for (const i of instances.slice(0, 8)) p.push(`- "${i.name}" (ID: ${i.id}): MC ${i.minecraftVersion}, ${i.modLoader}`);
  return p.join('\n');
}

async function callAI(messages: StoredMessage[], ctx: string, settings: any): Promise<string> {
  const { provider, apiKey, model, endpoint, useProxy } = settings;

  if (!apiKey && provider !== 'proxy') {
    return 'API key is not set. Go to Settings > Advanced > AI Agent and configure your provider.';
  }
  if (!endpoint) {
    return 'Endpoint is not configured. Select a provider in Settings > Advanced > AI Agent.';
  }

  const systemMsg = { role: 'system' as const, content: SYSTEM_PROMPT + (ctx ? `\n\nUser context:\n${ctx}` : '') };

  const chatMessages: any[] = messages.map(m => ({ role: m.role, content: m.content }));
  const last = messages[messages.length - 1];
  if (last?.attachments?.length) {
    const images = last.attachments.filter(a => a.type.startsWith('image/') && (a.base64 || a.dataUrl));
    if (images.length > 0) {
      chatMessages[chatMessages.length - 1] = {
        role: 'user',
        content: [
          { type: 'text', text: last.content },
          ...images.map(a => ({ type: 'image_url', image_url: { url: a.dataUrl || `data:${a.type};base64,${a.base64}` } })),
        ],
      };
    }
  }

  const actualEndpoint = endpoint || endpointFor(provider, false);
  const actualModel = model || defaultModelFor(provider) || 'gpt-4o-mini';

  const fail = (status: number) => {
    const label = PROVIDERS.find(p => p.id === provider)?.name ?? provider;
    if (status === 401 || status === 403) {
      return `Ошибка ${status} — «${label}» отклонил ключ. Причины: неверный/просроченный ключ, регион РФ или нерабочий прокси-адрес. Проверь ключ и Endpoint в Настройках → AI Agent; из РФ нужен рабочий прокси-ключ (его endpoint вставь в поле Endpoint).`;
    }
    return `HTTP ${status} — провайдер «${label}» не ответил. Проверь endpoint, прокси и ключ.`;
  };

  try {

    if (provider === 'claude') {
      const response = await fetch(actualEndpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
        body: JSON.stringify({ model: actualModel, max_tokens: 2048, system: systemMsg.content, messages: chatMessages.filter(m => m.role !== 'system') }),
      });
      if (!response.ok) throw new Error(fail(response.status));
      const data = await response.json();
      return data.content?.[0]?.text ?? 'No response.';
    }

    const response = await fetch(actualEndpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
      body: JSON.stringify({ model: actualModel, messages: [systemMsg, ...chatMessages], max_tokens: 2048, temperature: 0.7 }),
    });
    if (!response.ok) throw new Error(fail(response.status));
    const data = await response.json();
    return data.choices?.[0]?.message?.content ?? 'No response.';
  } catch (e: any) {
    if (e instanceof TypeError && /failed to fetch|network/i.test(String(e))) {
      return 'Не удалось подключиться к провайдеру. Проверь интернет и корректность Endpoint в Настройках.';
    }
    return `Ошибка: ${String(e)}`;
  }
}

function AttachmentChip({ att, onRemove }: { att: Attachment; onRemove?: () => void }) {
  const Icon = getFileIcon(att.name);
  const isImage = att.type.startsWith('image/');
  return (
    <div className="inline-flex items-center gap-2 px-2.5 py-1.5 text-[11px] font-medium"
      style={{ background: 'var(--color-surface)', color: 'var(--color-text)', border: '1px solid var(--color-border)', borderRadius: 4 }}>
      {isImage && att.dataUrl
        ? <img src={att.dataUrl} alt="" className="w-5 h-5 object-cover" style={{ borderRadius: 2 }} />
        : <Icon className="w-3.5 h-3.5" style={{ color: 'var(--color-text-secondary)' }} />
      }
      <span className="truncate max-w-[120px]">{att.name}</span>
      <span style={{ color: 'var(--color-text-tertiary)' }}>{formatBytes(att.size)}</span>
      {onRemove && <button onClick={onRemove} className="hover:opacity-70"><X className="w-3 h-3" style={{ color: 'var(--color-text-tertiary)' }} /></button>}
    </div>
  );
}

function saveAttachment(att: Attachment) {
  return async () => {
    try {
      if (att.url) {
        const response = await fetch(att.url);
        const blob = await response.blob();
        const buf = Array.from(new Uint8Array(await blob.arrayBuffer()));
        await invoke('save_to_downloads', { filename: att.name, data: buf });
      } else if (att.base64) {
        const buf = Uint8Array.from(atob(att.base64), c => c.charCodeAt(0));
        await invoke('save_to_downloads', { filename: att.name, data: Array.from(buf) });
      } else if (att.dataUrl) {
        const base64 = att.dataUrl.split(',')[1] || '';
        const buf = Uint8Array.from(atob(base64), c => c.charCodeAt(0));
        await invoke('save_to_downloads', { filename: att.name, data: Array.from(buf) });
      } else {
        throw new Error('no data');
      }
      toastSuccess('Сохранено в Загрузки', att.name);
    } catch (e) {
      console.error(e);
      toastError('Не удалось сохранить', att.name);
    }
  };
}

function FileInMessage({ att }: { att: Attachment }) {
  const Icon = getFileIcon(att.name);
  const isImage = att.type.startsWith('image/');
  const [downloading, setDownloading] = useState(false);
  const handleDownload = async () => {
    setDownloading(true);
    await saveAttachment(att)();
    setDownloading(false);
  };

  if (isImage) {
    return (
      <div className="mt-2 inline-block cursor-pointer" onClick={() => window.dispatchEvent(new CustomEvent('portal:image-view', { detail: att }))}>
        <img src={att.dataUrl || att.url} alt={att.name} className="max-w-[280px] max-h-[200px] object-cover" style={{ borderRadius: 4, border: '1px solid var(--color-border)' }} />
        <div className="flex items-center gap-2 mt-1 text-[10px]" style={{ color: 'var(--color-text-tertiary)' }}>
          <span>{att.name}</span>
          <span>{formatBytes(att.size)}</span>
        </div>
      </div>
    );
  }

  return (
    <div className="mt-2 flex items-center gap-3 px-3 py-2.5"
      style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 4 }}>
      <div className="w-8 h-8 flex items-center justify-center shrink-0" style={{ background: 'var(--color-surface-2)', borderRadius: 4 }}>
        <Icon className="w-4 h-4" style={{ color: 'var(--color-text-secondary)' }} />
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-[12px] font-medium truncate" style={{ color: 'var(--color-text)' }}>{att.name}</p>
        <p className="text-[10px]" style={{ color: 'var(--color-text-tertiary)' }}>{formatBytes(att.size)}</p>
      </div>
      <button onClick={handleDownload} disabled={downloading}
        className="flex items-center gap-1 px-2 py-1 text-[10px] font-medium"
        style={{ background: 'var(--color-primary)', color: 'var(--color-primary-text)', borderRadius: 3, opacity: downloading ? 0.5 : 1 }}>
        <Download className="w-3 h-3" /> {downloading ? '...' : 'Скачать'}
      </button>
    </div>
  );
}

function ImageViewer() {
  const [image, setImage] = useState<Attachment | null>(null);

  useEffect(() => {
    const handler = (e: Event) => setImage((e as CustomEvent).detail);
    window.addEventListener('portal:image-view', handler);
    return () => window.removeEventListener('portal:image-view', handler);
  }, []);

  return (
    <AnimatePresence>
      {image && (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
          className="fixed inset-0 z-[1000] flex items-center justify-center p-8"
          style={{ background: 'rgba(0,0,0,0.8)' }}
          onClick={() => setImage(null)}>
          <motion.div initial={{ scale: 0.96 }} animate={{ scale: 1 }} exit={{ scale: 0.96 }}
            className="relative max-w-[70vw] max-h-[80vh] flex flex-col"
            onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-3 px-1">
              <span className="text-[12px] font-medium" style={{ color: '#ccc' }}>{image.name} — {formatBytes(image.size)}</span>
              <div className="flex items-center gap-2">
                <button onClick={() => void saveAttachment(image)()}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-[11px] font-medium"
                  style={{ background: 'rgba(255,255,255,0.15)', color: '#fff', borderRadius: 4 }}>
                  <Download className="w-3.5 h-3.5" /> В Загрузки
                </button>
                <button onClick={() => setImage(null)} className="p-1.5" style={{ color: '#888' }}>
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>
            <img src={image.dataUrl || image.url} alt={image.name}
              className="max-w-full max-h-[70vh] object-contain" style={{ borderRadius: 4 }} />
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

function InstanceIcon({ instance }: { instance: any }) {
  if (instance.iconPath) {
    return (
      <img src={instance.iconPath} alt="" className="w-6 h-6 object-cover shrink-0" style={{ borderRadius: 4, background: 'var(--color-surface-2)' }} />
    );
  }
  return (
    <div className="w-6 h-6 flex items-center justify-center shrink-0 text-[10px] font-bold"
      style={{ background: instance.color || 'var(--color-primary)', color: '#fff', borderRadius: 4 }}>
      {(instance.name || '?')[0].toUpperCase()}
    </div>
  );
}

export function AIAgent({ onClose }: AIAgentProps) {
  const { sessions, activeSessionId, createSession, deleteSession, setActiveSession, addMessage, getActiveSession, setInstanceForSession } = useChatHistory();
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [minimized, setMinimized] = useState(false);
  const [copiedIdx, setCopiedIdx] = useState<number | null>(null);
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [showProviderMenu, setShowProviderMenu] = useState(false);
  const [showSessions, setShowSessions] = useState(false);
  const [showInstanceMenu, setShowInstanceMenu] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const instances = useInstanceStore(s => s.instances);
  const user = useAuthStore(s => s.user);

  const activeSession = getActiveSession();
  const messages: StoredMessage[] = activeSession?.messages ?? [];

  const getSettings = () => {
    try {
      const raw = localStorage.getItem('portal-ai-settings');
      const parsed = raw ? JSON.parse(raw) : {};
      return { ...parsed, useProxy: parsed.useProxy ?? false };
    } catch { return { useProxy: false }; }
  };

  const saveSettings = (s: any) => {
    localStorage.setItem('portal-ai-settings', JSON.stringify(s));
  };

  const [settings, setSettings] = useState(getSettings);
  const currentProvider = PROVIDERS.find(p => p.id === settings.provider) ?? PROVIDERS[0];

  useEffect(() => { messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages]);
  useEffect(() => {
    if (!minimized) setTimeout(() => inputRef.current?.focus(), 200);
    if (!activeSession) createSession();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const addAttachment = useCallback((file: File) => {
    const maxSize = 8 * 1024 * 1024;
    if (file.size > maxSize) { toastError('Файл слишком большой', 'Максимум 8 МБ'); return; }
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = reader.result as string;
      const base64 = dataUrl.split(',')[1] || '';
      setAttachments(prev => [...prev, { name: file.name, type: file.type, size: file.size, dataUrl, base64 }]);
    };
    reader.readAsDataURL(file);
  }, []);

  const handleFileDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    for (const file of Array.from(e.dataTransfer.files)) addAttachment(file);
  }, [addAttachment]);

  const handlePaste = useCallback((e: React.ClipboardEvent) => {
    const items = e.clipboardData?.items;
    if (!items) return;
    for (const item of Array.from(items)) {
      if (item.kind === 'file') {
        const file = item.getAsFile();
        if (file) { e.preventDefault(); addAttachment(file); }
      }
    }
  }, [addAttachment]);

  const sendMessage = useCallback(async () => {
    if (!activeSession) return;
    const text = input.trim();
    if ((!text && attachments.length === 0) || loading) return;

    const userMsg: StoredMessage = {
      role: 'user',
      content: text || '(вложения)',
      timestamp: Date.now(),
      attachments: attachments.length > 0 ? [...attachments.map(({ name, type, size, dataUrl }) => ({ name, type, size, dataUrl }))] : undefined,
    };
    addMessage(activeSession.id, userMsg);
    setInput('');
    setAttachments([]);
    setLoading(true);

    const sessionInstanceId = activeSession.instanceId;
    const prior = [...messages, userMsg];
    try {
      const ctx = getCtx(instances, user, sessionInstanceId);
      const reply = await callAI(prior, ctx, { ...settings, provider: settings.provider || 'openai', apiKey: settings.apiKey || '', model: settings.model || currentProvider.models[0] || "gpt-4o-mini", endpoint: settings.endpoint || currentProvider.endpoint, useProxy: settings.useProxy ?? false });
      addMessage(activeSession.id, { role: 'assistant', content: reply, timestamp: Date.now() });
    } catch (e: any) {
      addMessage(activeSession.id, { role: 'assistant', content: `Error: ${String(e)}`, timestamp: Date.now() });
    } finally { setLoading(false); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [input, loading, messages, attachments, instances, user, settings, activeSession, currentProvider]);

  const updateSetting = (key: string, value: any) => {
    const next = { ...settings, [key]: value };
    setSettings(next);
    saveSettings(next);
  };

  const selectProvider = (provider: ProviderPreset) => {
    updateSetting('provider', provider.id);
    updateSetting('endpoint', endpointFor(provider.id, false));
    const firstModel = defaultModelFor(provider.id);
    if (firstModel) updateSetting('model', firstModel);
    setShowProviderMenu(false);
  };

  const selectInstance = (id: string | undefined) => {
    if (activeSession) setInstanceForSession(activeSession.id, id);
    setShowInstanceMenu(false);
  };

  const selectedInstance = activeSession?.instanceId ? instances.find(i => i.id === activeSession.instanceId) : undefined;

  if (minimized) {
    return (
      <motion.button initial={{ scale: 0 }} animate={{ scale: 1 }}
        onClick={() => setMinimized(false)}
        className="fixed bottom-5 right-5 z-[900] flex items-center gap-2 px-4 py-2.5 text-sm font-medium"
        style={{ background: 'var(--color-surface)', color: 'var(--color-text)', border: '1px solid var(--color-border)', borderRadius: 6, boxShadow: '0 2px 12px rgba(0,0,0,0.2)' }}
        whileHover={{ y: -1 }} whileTap={{ scale: 0.98 }}>
        <Bot className="w-4 h-4" style={{ color: 'var(--color-primary)' }} />
        PTAgent
      </motion.button>
    );
  }

  return (
    <>
      <ImageViewer />
      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 20 }}
        className="fixed bottom-5 right-5 z-[900] flex flex-col overflow-hidden"
        style={{ width: 440, height: 560, background: 'var(--color-bg)', border: '1px solid var(--color-border)', borderRadius: 8, boxShadow: '0 4px 24px rgba(0,0,0,0.3)' }}
        onDragOver={e => e.preventDefault()} onDrop={handleFileDrop}>

        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 shrink-0" style={{ borderBottom: '1px solid var(--color-border)' }}>
          <div className="flex items-center gap-2 relative">
            <button
              onClick={() => { if (activeSession) deleteSession(activeSession.id); createSession(); }}
              className="flex items-center justify-center w-7 h-7 hover:opacity-80" title="Новый чат"
              style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 4, color: 'var(--color-primary)' }}>
              <Plus className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={() => setShowSessions(!showSessions)}
              className="flex items-center gap-1.5 px-2 py-1.5 text-[12px] font-medium hover:opacity-80" title="История чатов"
              style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 4, color: 'var(--color-text)' }}>
              <MessageSquare className="w-3.5 h-3.5" style={{ color: 'var(--color-text-secondary)' }} />
              <span className="max-w-[110px] truncate">{activeSession?.title || 'Chat'}</span>
            </button>

            {/* Instance selector — right of the + button */}
            <div className="relative">
              <button onClick={() => setShowInstanceMenu(!showInstanceMenu)}
                className="flex items-center gap-1.5 px-2 py-1.5 text-[11px] font-medium hover:opacity-80"
                style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 4, color: 'var(--color-text)' }}>
                {selectedInstance
                  ? <><InstanceIcon instance={selectedInstance} /><span className="max-w-[90px] truncate">{selectedInstance.name}</span></>
                  : <><span className="w-6 h-6 flex items-center justify-center text-[10px] font-bold" style={{ background: 'var(--color-surface-2)', color: 'var(--color-text-secondary)', borderRadius: 4 }}>?</span><span>Нет сборки</span></>
                }
                <ChevronDown className="w-3 h-3" style={{ color: 'var(--color-text-tertiary)' }} />
              </button>
              {showInstanceMenu && (
                <div className="absolute top-full left-0 mt-1 w-60 z-50 py-1 max-h-72 overflow-y-auto"
                  style={{ background: 'var(--color-bg)', border: '1px solid var(--color-border)', borderRadius: 6, boxShadow: '0 4px 16px rgba(0,0,0,0.3)' }}>
                  <button onClick={() => selectInstance(undefined)}
                    className="w-full flex items-center gap-2.5 px-3 py-2 text-[12px] text-left hover:opacity-80"
                    style={{ color: 'var(--color-text)' }}>
                    <span className="w-6 h-6 flex items-center justify-center text-[10px] font-bold" style={{ background: 'var(--color-surface-2)', color: 'var(--color-text-secondary)', borderRadius: 4 }}>?</span>
                    <span className="flex-1">
                      <span className="block font-medium">Нет сборки</span>
                      <span className="block text-[10px]" style={{ color: 'var(--color-text-tertiary)' }}>Создать или просто спросить</span>
                    </span>
                  </button>
                  {instances.map(i => (
                    <button key={i.id} onClick={() => selectInstance(i.id)}
                      className="w-full flex items-center gap-2.5 px-3 py-2 text-[12px] text-left hover:opacity-80"
                      style={{ color: 'var(--color-text)' }}>
                      <InstanceIcon instance={i} />
                      <span className="flex-1 min-w-0">
                        <span className="block font-medium truncate">{i.name}</span>
                        <span className="block text-[10px]" style={{ color: 'var(--color-text-tertiary)' }}>{i.modLoader} {i.minecraftVersion}</span>
                      </span>
                    </button>
                  ))}
                  {currentProvider.models.length > 0 && (
                    <>
                      <div className="px-3 pt-2 pb-1 text-[9px] font-black uppercase tracking-wide" style={{ color: 'var(--color-text-tertiary)' }}>Модель</div>
                      <div className="px-2 pb-1.5">
                        <select value={settings.model || currentProvider.models[0] || ''} onChange={event => updateSetting('model', event.target.value)}
                          className="w-full px-2 py-1.5 text-[11px] outline-none"
                          style={{ background: 'var(--color-surface)', color: 'var(--color-text)', border: '1px solid var(--color-border)', borderRadius: 3 }}>
                          {modelGroups(currentProvider).map(group => (
                            <optgroup key={group.label} label={group.label}>
                              {group.models.map(m => <option key={m} value={m}>{m}{group.label === 'Бесплатные' ? ' · Free' : ''}</option>)}
                            </optgroup>
                          ))}
                        </select>
                      </div>
                    </>
                  )}
                </div>
              )}
            </div>
          </div>

          <div className="flex items-center gap-1">
            <div className="relative mr-1">
              <button onClick={() => setShowProviderMenu(!showProviderMenu)}
                className="flex items-center gap-1 px-2 py-0.5 text-[10px] font-medium"
                style={{ background: 'var(--color-surface)', color: 'var(--color-text-secondary)', border: '1px solid var(--color-border)', borderRadius: 3 }}>
                {currentProvider.icon} {currentProvider.name.split(' ')[0]}
                <ChevronDown className="w-3 h-3" />
              </button>
              {showProviderMenu && (
                <div className="absolute top-full right-0 mt-1 w-64 z-50 py-1 max-h-80 overflow-y-auto"
                  style={{ background: 'var(--color-bg)', border: '1px solid var(--color-border)', borderRadius: 6, boxShadow: '0 4px 16px rgba(0,0,0,0.3)' }}>
                  {PROVIDERS.map(p => (
                    <button key={p.id} onClick={() => selectProvider(p)}
                      className="w-full flex items-center gap-2.5 px-3 py-2 text-[12px] text-left hover:opacity-80"
                      style={{ color: settings.provider === p.id ? 'var(--color-primary)' : 'var(--color-text)' }}>
                      <span className="w-5 h-5 flex items-center justify-center text-[9px] font-bold"
                        style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 3 }}>{p.icon}</span>
                      {p.name}
                      {p.models.length > 0 && <span className="ml-auto text-[9px]" style={{ color: 'var(--color-text-tertiary)' }}>{p.models.length} моделей</span>}
                    </button>
                  ))}
                </div>
              )}
            </div>
            <button onClick={() => setMinimized(true)} className="p-1 hover:opacity-70"><ChevronDown className="w-4 h-4" style={{ color: 'var(--color-text-secondary)' }} /></button>
            <button onClick={onClose} className="p-1 hover:opacity-70"><X className="w-4 h-4" style={{ color: 'var(--color-text-secondary)' }} /></button>
          </div>
        </div>

        {/* Sessions sidebar */}
        <AnimatePresence>
          {showSessions && (
            <motion.div initial={{ height: 0 }} animate={{ height: 'auto' }} exit={{ height: 0 }}
              className="shrink-0 overflow-hidden" style={{ borderBottom: '1px solid var(--color-border)' }}>
              <div className="px-2 py-2 max-h-52 overflow-y-auto">
                <p className="px-2 pb-1.5 text-[10px] font-semibold" style={{ color: 'var(--color-text-tertiary)' }}>История чатов</p>
                {sessions.length === 0 && <p className="px-2 py-2 text-[11px]" style={{ color: 'var(--color-text-tertiary)' }}>Нет сохранённых чатов</p>}
                {sessions.map(s => {
                  const inst = s.instanceId ? instances.find(i => i.id === s.instanceId) : undefined;
                  const isActive = s.id === activeSession?.id;
                  return (
                    <div key={s.id} className="flex items-center gap-1.5 rounded-sm px-2 py-1.5 cursor-pointer hover:opacity-80"
                      style={{ background: isActive ? 'var(--color-surface-2)' : 'transparent', border: isActive ? '1px solid var(--color-border)' : '1px solid transparent' }}
                      onClick={() => { setActiveSession(s.id); setShowSessions(false); }}>
                      <InstanceIcon instance={inst || { name: '?' }} />
                      <div className="min-w-0 flex-1">
                        <p className="text-[11px] font-medium truncate" style={{ color: 'var(--color-text)' }}>{s.title}</p>
                        <p className="text-[9px]" style={{ color: 'var(--color-text-tertiary)' }}>
                          {s.messages.length} сообщ. · {new Date(s.updatedAt).toLocaleDateString()}
                        </p>
                      </div>
                      <button onClick={e => { e.stopPropagation(); deleteSession(s.id); }} className="p-1 hover:opacity-70"><Trash className="w-3.5 h-3.5" style={{ color: 'var(--color-text-tertiary)' }} /></button>
                    </div>
                  );
                })}
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Messages */}
        <div className="flex-1 overflow-y-auto px-4 py-3 space-y-2.5">
          {messages.length === 0 && (
            <div className="flex flex-col items-center justify-center h-full text-center">
              <Bot className="w-8 h-8 mb-3" style={{ color: 'var(--color-text-tertiary)' }} />
              <p className="text-sm font-medium" style={{ color: 'var(--color-text)' }}>PTAgent</p>
              {selectedInstance
                ? <p className="text-xs mt-1 max-w-[260px] leading-relaxed" style={{ color: 'var(--color-text-secondary)' }}>Работаю со сборкой «{selectedInstance.name}» — можно ставить моды, смотреть логи, настраивать.</p>
                : <p className="text-xs mt-1 max-w-[260px] leading-relaxed" style={{ color: 'var(--color-text-secondary)' }}>Задай вопрос, попроси создать сборку или выбрать её для установки файлов.</p>
              }
              <div className="flex flex-wrap gap-1.5 mt-4 justify-center">
                {selectedInstance
                  ? ['Порекомендуй моды', 'Посмотри логи', 'Почини краш', 'Установи мод'].map(hint => (
                      <button key={hint} onClick={() => setInput(hint)}
                        className="px-2.5 py-1.5 text-[11px] font-medium"
                        style={{ background: 'var(--color-surface)', color: 'var(--color-text-secondary)', border: '1px solid var(--color-border)', borderRadius: 4 }}>{hint}</button>
                    ))
                  : ['Создай сборку', 'Порекомендуй моды', 'Что за краш?', 'Найди шейдеры'].map(hint => (
                      <button key={hint} onClick={() => setInput(hint)}
                        className="px-2.5 py-1.5 text-[11px] font-medium"
                        style={{ background: 'var(--color-surface)', color: 'var(--color-text-secondary)', border: '1px solid var(--color-border)', borderRadius: 4 }}>{hint}</button>
                    ))}
              </div>
            </div>
          )}

          {messages.map((msg, idx) => (
            <div key={msg.timestamp + idx} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
              <div className="group relative max-w-[88%]">
                <div className="px-3 py-2 text-[13px] leading-relaxed"
                  style={{
                    background: msg.role === 'user' ? 'var(--color-primary)' : 'var(--color-surface)',
                    color: msg.role === 'user' ? 'var(--color-primary-text)' : 'var(--color-text)',
                    border: msg.role === 'user' ? 'none' : '1px solid var(--color-border)',
                    borderRadius: 6, whiteSpace: 'pre-wrap',
                  }}>
                  {msg.content}
                </div>
                {msg.attachments?.map((att, i) => (<FileInMessage key={i} att={att as any} />))}
                {msg.role === 'assistant' && (
                  <button onClick={() => { navigator.clipboard.writeText(msg.content); setCopiedIdx(idx); setTimeout(() => setCopiedIdx(null), 1500); }}
                    className="absolute -top-2 -right-2 p-1 opacity-0 group-hover:opacity-100 transition-opacity"
                    style={{ background: 'var(--color-bg)', border: '1px solid var(--color-border)', borderRadius: 3 }}>
                    {copiedIdx === idx ? <Check className="w-3 h-3" style={{ color: 'var(--color-success)' }} /> : <Copy className="w-3 h-3" style={{ color: 'var(--color-text-tertiary)' }} />}
                  </button>
                )}
              </div>
            </div>
          ))}

          {loading && (
            <div className="flex justify-start">
              <div className="flex items-center gap-2 px-3 py-2 text-[13px]"
                style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 6, color: 'var(--color-text-secondary)' }}>
                <Loader2 className="w-3.5 h-3.5 animate-spin" style={{ color: 'var(--color-primary)' }} />
                Думаю...
              </div>
            </div>
          )}
          <div ref={messagesEndRef} />
        </div>

        {/* Attachments preview */}
        {attachments.length > 0 && (
          <div className="flex flex-wrap gap-1.5 px-4 pb-2 shrink-0">
            {attachments.map((att, i) => (
              <AttachmentChip key={i} att={att} onRemove={() => setAttachments(prev => prev.filter((_, j) => j !== i))} />
            ))}
          </div>
        )}

        {/* Input */}
        <div className="shrink-0 px-3 py-3" style={{ borderTop: '1px solid var(--color-border)' }}>
          <div className="flex items-end gap-2">
            <button onClick={() => fileInputRef.current?.click()}
              className="flex items-center justify-center w-9 h-9 shrink-0 hover:opacity-80"
              style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 6, color: 'var(--color-text-secondary)' }}>
              <Paperclip className="w-4 h-4" />
            </button>
            <input ref={fileInputRef} type="file" multiple className="hidden"
              onChange={e => { Array.from(e.target.files ?? []).forEach(addAttachment); e.target.value = ''; }} />
            <textarea ref={inputRef} value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); } }}
              onPaste={handlePaste}
              placeholder="Спросить что-нибудь..."
              rows={1}
              className="flex-1 resize-none px-3 py-2.5 text-[13px] outline-none"
              style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', color: 'var(--color-text)', borderRadius: 6, maxHeight: 72, minHeight: 36 }}
            />
            <button onClick={sendMessage} disabled={(!input.trim() && attachments.length === 0) || loading}
              className="flex items-center justify-center w-9 h-9 shrink-0 disabled:opacity-40"
              style={{ background: 'var(--color-primary)', color: 'var(--color-primary-text)', borderRadius: 6 }}>
              <Send className="w-4 h-4" />
            </button>
          </div>
          <div className="flex items-center justify-between mt-1.5">
            <p className="text-[9px]" style={{ color: 'var(--color-text-tertiary)' }}>
              {settings.apiKey ? `${currentProvider.name} · ${settings.model || defaultModelFor(currentProvider.id) || 'модель'}` : 'Нет API-ключа — добавь в Настройках'}
            </p>
            <p className="text-[9px]" style={{ color: 'var(--color-text-tertiary)' }}>
              Файлы: перетащи или вставь из буфера
            </p>
          </div>
        </div>
      </motion.div>
    </>
  );
}

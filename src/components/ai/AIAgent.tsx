import { useState, useRef, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Bot, Send, X, ChevronDown, Loader2, Copy, Check, Trash2, Paperclip, Image as ImageIcon, Download, FileText, File, Settings, Globe } from 'lucide-react';
import { useInstanceStore } from '@/stores/instanceStore';
import { useAuthStore } from '@/stores/authStore';
import { invoke } from '@/lib/invoke-shim';

interface ChatMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: number;
  attachments?: Attachment[];
}

interface Attachment {
  name: string;
  type: string;
  size: number;
  dataUrl?: string;
  base64?: string;
  url?: string;
}

interface AIAgentProps { onClose: () => void }

interface ProviderPreset {
  id: string;
  name: string;
  endpoint: string;
  model: string;
  icon: string;
}

const PROVIDERS: ProviderPreset[] = [
  { id: 'openai', name: 'ChatGPT (OpenAI)', endpoint: 'https://api.openai.com/v1/chat/completions', model: 'gpt-4o-mini', icon: 'AI' },
  { id: 'openrouter', name: 'OpenRouter', endpoint: 'https://openrouter.ai/api/v1/chat/completions', model: 'openai/gpt-4o-mini', icon: 'OR' },
  { id: 'claude', name: 'Claude (Anthropic)', endpoint: 'https://api.anthropic.com/v1/messages', model: 'claude-3-5-haiku-20241022', icon: 'CL' },
  { id: 'proxy', name: 'Custom / Proxy', endpoint: '', model: '', icon: 'PR' },
];

const PROXY_ENDPOINTS: Record<string, string> = {
  'openai': 'https://api.openai-proxy.org/v1/chat/completions',
  'openrouter': 'https://openrouter.ai/api/v1/chat/completions',
  'claude': 'https://api.anthropic-proxy.org/v1/messages',
};

const SYSTEM_PROMPT = `You are Portal Assistant, an AI built into Portal Launcher for Minecraft.

Capabilities:
- Answer questions about Minecraft modding, versions, loaders, Java
- Recommend mods, resource packs, shaders
- Help create/configure instances
- Read and analyze game logs
- Install content to instances
- Generate images for modpack covers

When helping:
- You have access to the user's instance list
- For installation, specify source (Modrinth/CurseForge) and target folder
- Ask which source when not specified
- Show current activity when performing actions
- If user sends files/images, analyze them and respond appropriately

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
  if (['jar','zip','rar','7z','tar','gz'].includes(ext)) return File;
  return File;
}

function getCtx(instances: any[], user: any): string {
  const p: string[] = [];
  if (user) p.push(`User: ${user.username} (${user.provider ?? 'microsoft'})`);
  p.push(`Instances: ${instances.length}`);
  for (const i of instances.slice(0, 6)) p.push(`- "${i.name}" (ID: ${i.id}): MC ${i.minecraftVersion}, ${i.modLoader}${i.modLoaderVersion ? ' ' + i.modLoaderVersion : ''}, RAM ${i.maxRam}MB`);
  return p.join('\n');
}

async function callAI(messages: ChatMessage[], ctx: string, settings: any): Promise<string> {
  const { provider, apiKey, model, endpoint, useProxy } = settings;

  if (!apiKey && provider !== 'proxy') {
    return 'API key is not set. Go to Settings > Advanced > AI Agent and configure your provider.';
  }

  if (!endpoint) {
    return 'Endpoint is not configured. Select a provider in Settings > Advanced > AI Agent.';
  }

  const systemMsg = { role: 'system' as const, content: SYSTEM_PROMPT + (ctx ? `\n\nUser context:\n${ctx}` : '') };

  const chatMessages = messages.map(m => ({ role: m.role, content: m.content }));
  if (messages[messages.length - 1]?.attachments?.length) {
    const last = messages[messages.length - 1];
    if (last.attachments?.length) {
      for (const att of last.attachments) {
        if (att.type.startsWith('image/') && att.base64) {
          chatMessages[chatMessages.length - 1] = {
            role: 'user',
            content: [
              { type: 'text', text: last.content },
              { type: 'image_url', image_url: { url: att.dataUrl || `data:${att.type};base64,${att.base64}` } }
            ] as any,
          };
        }
      }
    }
  }

  const actualEndpoint = useProxy && PROXY_ENDPOINTS[provider] ? PROXY_ENDPOINTS[provider] : endpoint;
  const actualModel = model || PROVIDERS.find(p => p.id === provider)?.model || 'gpt-4o-mini';

  try {
    if (provider === 'claude') {
      const response = await fetch(actualEndpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
        body: JSON.stringify({ model: actualModel, max_tokens: 2048, system: systemMsg.content, messages: chatMessages }),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data = await response.json();
      return data.content?.[0]?.text ?? 'No response.';
    }

    const response = await fetch(actualEndpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
      body: JSON.stringify({ model: actualModel, messages: [systemMsg, ...chatMessages], max_tokens: 2048, temperature: 0.7 }),
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json();
    return data.choices?.[0]?.message?.content ?? 'No response.';
  } catch (e: any) {
    return `Error: ${String(e)}`;
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

function FileInMessage({ att }: { att: Attachment }) {
  const Icon = getFileIcon(att.name);
  const isImage = att.type.startsWith('image/');
  const [downloading, setDownloading] = useState(false);

  const handleDownload = async () => {
    setDownloading(true);
    try {
      if (att.url) {
        const response = await fetch(att.url);
        const blob = await response.blob();
        const buf = Array.from(new Uint8Array(await blob.arrayBuffer()));
        await invoke('save_to_downloads', { filename: att.name, data: buf });
      } else if (att.base64) {
        const buf = Uint8Array.from(atob(att.base64), c => c.charCodeAt(0));
        await invoke('save_to_downloads', { filename: att.name, data: Array.from(buf) });
      }
    } catch (e) { console.error(e); }
    setDownloading(false);
  };

  if (isImage) {
    return (
      <div className="mt-2 inline-block cursor-pointer" onClick={() => window.dispatchEvent(new CustomEvent('portal:image-view', { detail: att }))}>
        <img src={att.dataUrl || att.url} alt={att.name} className="max-w-[300px] max-h-[200px] object-cover" style={{ borderRadius: 4, border: '1px solid var(--color-border)' }} />
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
        <Download className="w-3 h-3" /> {downloading ? '...' : 'Download'}
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

  const handleDownload = async () => {
    if (!image) return;
    try {
      if (image.url) {
        const response = await fetch(image.url);
        const blob = await response.blob();
        const buf = Array.from(new Uint8Array(await blob.arrayBuffer()));
        await invoke('save_to_downloads', { filename: image.name, data: buf });
      } else if (image.base64) {
        const buf = Uint8Array.from(atob(image.base64), c => c.charCodeAt(0));
        await invoke('save_to_downloads', { filename: image.name, data: Array.from(buf) });
      }
    } catch (e) { console.error(e); }
  };

  return (
    <AnimatePresence>
      {image && (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
          className="fixed inset-0 z-[1000] flex items-center justify-center p-8"
          style={{ background: 'rgba(0,0,0,0.8)' }}
          onClick={() => setImage(null)}>
          <motion.div initial={{ scale: 0.95 }} animate={{ scale: 1 }} exit={{ scale: 0.95 }}
            className="relative max-w-[80vw] max-h-[80vh] flex flex-col"
            onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-3 px-1">
              <span className="text-[12px] font-medium" style={{ color: '#ccc' }}>{image.name} — {formatBytes(image.size)}</span>
              <div className="flex items-center gap-2">
                <button onClick={handleDownload}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-[11px] font-medium"
                  style={{ background: 'rgba(255,255,255,0.15)', color: '#fff', borderRadius: 4 }}>
                  <Download className="w-3.5 h-3.5" /> Save
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

export function AIAgent({ onClose }: AIAgentProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [minimized, setMinimized] = useState(false);
  const [copiedIdx, setCopiedIdx] = useState<number | null>(null);
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [showProviderMenu, setShowProviderMenu] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const instances = useInstanceStore(s => s.instances);
  const user = useAuthStore(s => s.user);

  const getSettings = () => {
    try {
      const raw = localStorage.getItem('portal-ai-settings');
      return raw ? JSON.parse(raw) : {};
    } catch { return {}; }
  };

  const saveSettings = (s: any) => {
    localStorage.setItem('portal-ai-settings', JSON.stringify(s));
  };

  const [settings, setSettings] = useState(getSettings);
  const currentProvider = PROVIDERS.find(p => p.id === settings.provider) ?? PROVIDERS[0];

  useEffect(() => { messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages]);
  useEffect(() => { if (!minimized) setTimeout(() => inputRef.current?.focus(), 200); }, [minimized]);

  const addAttachment = useCallback((file: File) => {
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

  const sendMessage = useCallback(async () => {
    const text = input.trim();
    if ((!text && attachments.length === 0) || loading) return;
    const userMsg: ChatMessage = { role: 'user', content: text || '(attachments)', timestamp: Date.now(), attachments: attachments.length > 0 ? [...attachments] : undefined };
    setMessages(prev => [...prev, userMsg]);
    setInput('');
    setAttachments([]);
    setLoading(true);
    try {
      const reply = await callAI([...messages, userMsg], getCtx(instances, user), { ...settings, provider: settings.provider || 'openai', apiKey: settings.apiKey || '', model: settings.model || currentProvider.model, endpoint: settings.endpoint || currentProvider.endpoint });
      setMessages(prev => [...prev, { role: 'assistant', content: reply, timestamp: Date.now() }]);
    } catch (e: any) {
      setMessages(prev => [...prev, { role: 'assistant', content: `Error: ${String(e)}`, timestamp: Date.now() }]);
    } finally { setLoading(false); }
  }, [input, loading, messages, attachments, instances, user, settings, currentProvider]);

  const updateSetting = (key: string, value: any) => {
    const next = { ...settings, [key]: value };
    setSettings(next);
    saveSettings(next);
  };

  const selectProvider = (provider: ProviderPreset) => {
    updateSetting('provider', provider.id);
    if (provider.endpoint) updateSetting('endpoint', provider.endpoint);
    if (provider.model) updateSetting('model', provider.model);
    setShowProviderMenu(false);
  };

  if (minimized) {
    return (
      <motion.button initial={{ scale: 0 }} animate={{ scale: 1 }}
        onClick={() => setMinimized(false)}
        className="fixed bottom-5 right-5 z-[900] flex items-center gap-2 px-4 py-2.5 text-sm font-medium"
        style={{ background: 'var(--color-surface)', color: 'var(--color-text)', border: '1px solid var(--color-border)', borderRadius: 6, boxShadow: '0 2px 12px rgba(0,0,0,0.2)' }}
        whileHover={{ y: -1 }} whileTap={{ scale: 0.98 }}>
        <Bot className="w-4 h-4" style={{ color: 'var(--color-primary)' }} />
        Assistant
      </motion.button>
    );
  }

  return (
    <>
      <ImageViewer />
      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 20 }}
        className="fixed bottom-5 right-5 z-[900] flex flex-col overflow-hidden"
        style={{ width: 420, height: 540, background: 'var(--color-bg)', border: '1px solid var(--color-border)', borderRadius: 8, boxShadow: '0 4px 24px rgba(0,0,0,0.3)' }}
        onDragOver={e => e.preventDefault()} onDrop={handleFileDrop}>

        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 shrink-0" style={{ borderBottom: '1px solid var(--color-border)' }}>
          <div className="flex items-center gap-2.5">
            <Bot className="w-4 h-4" style={{ color: 'var(--color-primary)' }} />
            <span className="text-sm font-medium" style={{ color: 'var(--color-text)' }}>Portal Assistant</span>
            <div className="relative">
              <button onClick={() => setShowProviderMenu(!showProviderMenu)}
                className="flex items-center gap-1 px-2 py-0.5 text-[10px] font-medium"
                style={{ background: 'var(--color-surface)', color: 'var(--color-text-secondary)', border: '1px solid var(--color-border)', borderRadius: 3 }}>
                {currentProvider.icon} {currentProvider.name.split(' ')[0]}
                <ChevronDown className="w-3 h-3" />
              </button>
              {showProviderMenu && (
                <div className="absolute top-full left-0 mt-1 w-56 z-50 py-1"
                  style={{ background: 'var(--color-bg)', border: '1px solid var(--color-border)', borderRadius: 6, boxShadow: '0 4px 16px rgba(0,0,0,0.3)' }}>
                  {PROVIDERS.map(p => (
                    <button key={p.id} onClick={() => selectProvider(p)}
                      className="w-full flex items-center gap-2.5 px-3 py-2 text-[12px] text-left hover:opacity-80"
                      style={{ color: settings.provider === p.id ? 'var(--color-primary)' : 'var(--color-text)' }}>
                      <span className="w-5 h-5 flex items-center justify-center text-[9px] font-bold"
                        style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 3 }}>{p.icon}</span>
                      {p.name}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
          <div className="flex items-center gap-1">
            {messages.length > 0 && <button onClick={() => setMessages([])} className="p-1 hover:opacity-70"><Trash2 className="w-3.5 h-3.5" style={{ color: 'var(--color-text-tertiary)' }} /></button>}
            <button onClick={() => setMinimized(true)} className="p-1 hover:opacity-70"><ChevronDown className="w-4 h-4" style={{ color: 'var(--color-text-secondary)' }} /></button>
            <button onClick={onClose} className="p-1 hover:opacity-70"><X className="w-4 h-4" style={{ color: 'var(--color-text-secondary)' }} /></button>
          </div>
        </div>

        {/* Messages */}
        <div className="flex-1 overflow-y-auto px-4 py-3 space-y-2.5">
          {messages.length === 0 && (
            <div className="flex flex-col items-center justify-center h-full text-center">
              <Bot className="w-8 h-8 mb-3" style={{ color: 'var(--color-text-tertiary)' }} />
              <p className="text-sm font-medium" style={{ color: 'var(--color-text)' }}>Portal Assistant</p>
              <p className="text-xs mt-1 max-w-[260px] leading-relaxed" style={{ color: 'var(--color-text-secondary)' }}>
                Select a provider and add your API key in Settings to start.
              </p>
              <div className="flex flex-wrap gap-1.5 mt-4 justify-center">
                {['Recommend mods', 'Create instance', 'Fix crash', 'Install mod'].map(hint => (
                  <button key={hint} onClick={() => setInput(hint)}
                    className="px-2.5 py-1.5 text-[11px] font-medium"
                    style={{ background: 'var(--color-surface)', color: 'var(--color-text-secondary)', border: '1px solid var(--color-border)', borderRadius: 4 }}>
                    {hint}
                  </button>
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
                {msg.attachments?.map((att, i) => <FileInMessage key={i} att={att} />)}
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
                Processing...
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
              placeholder="Ask something..."
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
              {settings.apiKey ? `${currentProvider.name} — configured` : 'No API key — set in Settings'}
            </p>
            <p className="text-[9px]" style={{ color: 'var(--color-text-tertiary)' }}>
              Drop files to attach
            </p>
          </div>
        </div>
      </motion.div>
    </>
  );
}

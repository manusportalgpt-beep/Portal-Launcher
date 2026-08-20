import { useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, Archive, CheckCircle2, ChevronRight, ExternalLink, FileCode2, FilePlus2, Folder, FolderCog, FolderOpen, FolderPlus, Home, ImagePlus, LoaderCircle, Map, PackagePlus, Pencil, Save, Search, Settings2, Share2, ShieldCheck, Sparkles, Trash2, X } from 'lucide-react';
import { invoke } from '@/lib/invoke-shim';
import { dialog } from '@/stores/dialogStore';

type FsEntry = { name: string; path: string; is_dir: boolean; size?: number; modified?: string | null; kind?: string };

const TEXT_EXT = new Set(['txt', 'json', 'json5', 'toml', 'yml', 'yaml', 'properties', 'cfg', 'conf', 'ini', 'lang', 'mcmeta', 'md', 'js', 'ts', 'tsx', 'jsx', 'css', 'html', 'xml', 'java', 'kt', 'gradle', 'sh', 'bat', 'ps1', 'log']);
function isTextFile(name: string) {
  const ext = name.toLowerCase().split('.').pop() ?? '';
  return TEXT_EXT.has(ext) || name === 'options.txt' || name === 'server.dat';
}
function escapeHtml(value: string) { return value.replace(/[&<>\"']/g, char => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '\"':'&quot;', "'":'&#039;' }[char] || char)); }
function highlightCode(value: string, fileName: string) {
  const escaped = escapeHtml(value);
  const ext = fileName.toLowerCase().split('.').pop() ?? '';
  const withComments = escaped.replace(/(\/\/.*|#.*|\/\*[\s\S]*?\*\/)/g, '<span style="color:#718096">$1</span>');
  const withStrings = withComments.replace(/(&quot;.*?&quot;|&#039;.*?&#039;|`.*?`)/g, '<span style="color:#A7F3D0">$1</span>');
  const withKeys = withStrings.replace(/(^|[,{\n]\s*)([A-Za-z0-9_.-]+)(\s*:)/g, '$1<span style="color:#93C5FD">$2</span>$3');
  const keywordPattern = ['json','json5','toml','yaml','yml','properties','cfg','conf','ini','mcmeta'].includes(ext) ? '' : '\\b(const|let|var|function|return|class|public|private|fn|struct|use|import|export|if|else|for|while|true|false|null)\\b';
  return keywordPattern ? withKeys.replace(new RegExp(keywordPattern, 'g'), '<span style="color:#C4B5FD">$1</span>') : withKeys;
}

const OUTLINE_ICON_COLOR = 'var(--color-text-secondary)';
function fileVisual(name: string) {
  const ext = name.toLowerCase().split('.').pop() ?? '';
  if (ext === 'jar') return { Icon: PackagePlus, color: OUTLINE_ICON_COLOR, badge: null };
  if (ext === 'zip') return { Icon: Archive, color: OUTLINE_ICON_COLOR, badge: null };
  if (ext === 'log') return { Icon: FileCode2, color: OUTLINE_ICON_COLOR, badge: null };
  return { Icon: FileCode2, color: OUTLINE_ICON_COLOR, badge: null };
}

function folderVisual(name: string) {
  const key = name.toLowerCase();
  if (key === 'config' || key === 'defaultconfigs') return { Icon: FolderCog, color: OUTLINE_ICON_COLOR, badge: Settings2 };
  if (key === 'mods' || key === 'mod') return { Icon: FolderOpen, color: OUTLINE_ICON_COLOR, badge: PackagePlus };
  if (key === 'resourcepacks' || key === 'resource-pack') return { Icon: ImagePlus, color: OUTLINE_ICON_COLOR, badge: null };
  if (key === 'shaderpacks' || key === 'shaders') return { Icon: Sparkles, color: OUTLINE_ICON_COLOR, badge: null };
  if (key === 'saves' || key === 'worlds') return { Icon: FolderOpen, color: OUTLINE_ICON_COLOR, badge: Map };
  if (key === 'logs') return { Icon: FolderOpen, color: OUTLINE_ICON_COLOR, badge: null, codeLabel: '<>' };
  if (key === 'datapacks' || key === 'scripts' || key === 'kubejs') return { Icon: FolderOpen, color: OUTLINE_ICON_COLOR, badge: Archive };
  return { Icon: Folder, color: OUTLINE_ICON_COLOR, badge: null, codeLabel: undefined };
}

function formatBytes(bytes?: number) {
  if (!bytes) return '0 B';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

type IntegrityReport = { gameReady: boolean; missingGameFiles: string[]; missingFolders: string[] };
type MclogsDiagnosis = { url: string; errors: number; lines: number; title: string; summary: string; evidence: string[]; suggestions: string[] };

export function InstanceFileEditor({ instanceId, minecraftVersion, onContentChanged }: { instanceId: string; minecraftVersion?: string; onContentChanged?: () => void | Promise<void> }) {
  const [cwd, setCwd] = useState('');
  const [entries, setEntries] = useState<FsEntry[]>([]);
  const [selected, setSelected] = useState<FsEntry | null>(null);
  const [content, setContent] = useState('');
  const [savedContent, setSavedContent] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [fileQuery, setFileQuery] = useState('');
  const [integrity, setIntegrity] = useState<IntegrityReport | null>(null);
  const [checkingIntegrity, setCheckingIntegrity] = useState(false);
  const [publishingLog, setPublishingLog] = useState(false);
  const [mclogsDiagnosis, setMclogsDiagnosis] = useState<MclogsDiagnosis | null>(null);
  const highlightedCodeRef = useRef<HTMLPreElement>(null);

  const dirty = !!selected && content !== savedContent;
  const visible = useMemo(() => {
    const query = fileQuery.trim().toLowerCase();
    if (!query) return entries;
    const extensionQuery = query.startsWith('.') ? query.slice(1) : query;
    return entries.filter(entry => {
      const name = entry.name.toLowerCase();
      const dot = name.lastIndexOf('.');
      const extension = dot > 0 ? name.slice(dot + 1) : '';
      return name.includes(query) || extension === extensionQuery || extension.includes(extensionQuery);
    });
  }, [entries, fileQuery]);

  const loadDir = async (path = cwd) => {
    setError('');
    try {
      const result = await invoke<FsEntry[]>('instance_list_dir', { instanceId, path });
      setEntries(result);
      setCwd(path);
    } catch (e) { setError(String(e)); setEntries([]); }
  };
  useEffect(() => { void loadDir(''); /* eslint-disable-next-line */ }, [instanceId]);

  const open = async (entry: FsEntry) => {
    if (entry.is_dir) { setSelected(null); setContent(''); setSavedContent(''); await loadDir(entry.path); return; }
    setSelected(entry); setError('');
    if (!isTextFile(entry.name)) { setContent(''); setSavedContent(''); return; }
    setBusy(true);
    try {
      const text = await invoke<string>('instance_read_text', { instanceId, path: entry.path });
      setContent(text); setSavedContent(text);
    } catch (e) { setError(`Не удалось открыть файл: ${e}`); }
    finally { setBusy(false); }
  };

  const save = async () => {
    if (!selected) return;
    setBusy(true); setError('');
    try { await invoke('instance_write_text', { instanceId, path: selected.path, content }); setSavedContent(content); }
    catch (e) { setError(`Не удалось сохранить: ${e}`); }
    finally { setBusy(false); }
  };
  const create = async (folder: boolean) => {
    const name = await dialog.prompt(
      folder ? 'Введите имя новой папки.' : 'Введите имя нового файла, например config.json.',
      '',
      { title: folder ? 'Новая папка' : 'Новый файл', confirmLabel: 'Создать', cancelLabel: 'Отмена', placeholder: folder ? 'Название папки' : 'config.json' },
    );
    if (!name?.trim()) return;
    try {
      const cleanName = name.trim().replace(/^[/\\]+|[/\\]+$/g, '');
      if (!cleanName || cleanName === '.' || cleanName === '..' || cleanName.includes('/') || cleanName.includes('\\')) {
        setError('Имя файла или папки содержит недопустимые символы');
        return;
      }
      const finalPath = [cwd, cleanName].filter(Boolean).join('/');
      if (folder) await invoke('instance_mkdir', { instanceId, path: finalPath });
      else await invoke('instance_write_text', { instanceId, path: finalPath, content: '' });
      await loadDir(cwd);
    } catch (e) { setError(String(e)); }
  };
  const rename = async (entry: FsEntry) => {
    const next = await dialog.prompt('Введите новое имя элемента.', entry.name, { title: 'Переименовать', confirmLabel: 'Сохранить', cancelLabel: 'Отмена' });
    if (!next?.trim() || next.trim() === entry.name) return;
    try { await invoke('instance_rename_path', { instanceId, path: entry.path, newName: next.trim() }); if (selected?.path === entry.path) setSelected(null); await loadDir(cwd); }
    catch (e) { setError(String(e)); }
  };
  const remove = async (entry: FsEntry) => {
    const ok = await dialog.confirm(`Удалить ${entry.is_dir ? 'папку' : 'файл'} «${entry.name}»? Это действие нельзя отменить.`, { title: 'Подтвердите удаление', danger: true, confirmLabel: 'Удалить', cancelLabel: 'Отмена' });
    if (!ok) return;
    try {
      await invoke('instance_delete_path', { instanceId, path: entry.path });
      if (selected?.path === entry.path) { setSelected(null); setContent(''); setSavedContent(''); }
      await loadDir(cwd);
      await onContentChanged?.();
    } catch (e) { setError(String(e)); }
  };
  const moveEntryIntoFolder = async (event: React.DragEvent, toDir: string) => {
    const from = event.dataTransfer.getData('text/plain');
    if (!from) return;
    event.preventDefault();
    event.stopPropagation();
    try {
      await invoke('instance_move_path', { instanceId, from, toDir });
      await loadDir(cwd);
      await onContentChanged?.();
    } catch (e) { setError(String(e)); }
  };
  const up = () => { const next = cwd.split('/').slice(0, -1).join('/'); void loadDir(next); };
  const publishLog = async (path?: string) => {
    const logPath = path || selected?.path;
    if (!logPath) return;
    setPublishingLog(true); setError('');
    try {
      const logContent = selected?.path === logPath ? content : await invoke<string>('instance_read_text', { instanceId, path: logPath });
      const result = await invoke<{ id: string; url: string; raw_url?: string; errors: number; lines: number; insights?: { problems?: Array<{ message?: string; solutions?: Array<{ message?: string }> }> }; diagnosis?: { title?: string; summary?: string; evidence?: string[]; suggestions?: string[]; confidence?: string } }>('publish_log_mclogs', {
        content: logContent,
        source: 'Portal Launcher',
        instanceId,
        minecraftVersion: minecraftVersion || null,
        loader: null,
      });
      const problems = result.insights?.problems || [];
      const local = result.diagnosis;
      const remoteSummary = problems.slice(0, 5).map((problem, index) => `${index + 1}. ${problem.message || 'Обнаружена проблема'}${problem.solutions?.[0]?.message ? `\n   Решение: ${problem.solutions[0].message}` : ''}`).join('\n');
      const diagnosisSummary = local ? `\n\nПричина: ${local.title || 'Причина обнаружена'}\n${local.summary || ''}${local.evidence?.length ? `\n\nСтроки лога:\n${local.evidence.map(line => `• ${line}`).join('\n')}` : ''}${local.suggestions?.length ? `\n\nЧто сделать:\n${local.suggestions.map(item => `• ${item}`).join('\n')}` : ''}` : '';
      const remoteText = remoteSummary ? `\n\nДополнительный анализ mclo.gs:\n${remoteSummary}` : '';
      const fallback = !local && !remoteSummary ? '\n\nПричина сбоя не определена по текущему логу. Это не означает, что ошибки нет: в отправленном тексте не найдено достаточных признаков.' : '';
      setMclogsDiagnosis({
        url: result.url,
        errors: result.errors,
        lines: result.lines,
        title: local?.title || problems[0]?.message || 'Причина сбоя не определена',
        summary: local?.summary || problems[0]?.solutions?.[0]?.message || 'В текущем логе недостаточно данных для точного вывода.',
        evidence: local?.evidence || problems.map(problem => problem.message || '').filter(Boolean),
        suggestions: local?.suggestions || problems.flatMap(problem => problem.solutions?.map(solution => solution.message || '').filter(Boolean) || []),
      });
      await dialog.alert(`Ссылка: ${result.url}\n\nОшибок: ${result.errors}\nСтрок: ${result.lines}${diagnosisSummary || remoteText || fallback}`, { title: 'Лог отправлен в mclo.gs' });
    } catch (e) { setError(`Не удалось отправить лог в mclo.gs: ${String(e)}`); }
    finally { setPublishingLog(false); }
  };

  const checkIntegrity = async () => {
    setCheckingIntegrity(true); setError('');
    try {
      const [game, root] = await Promise.all([
        minecraftVersion ? invoke<{ jar?: boolean; json?: boolean; assets?: boolean }>('verify_installation', { version: minecraftVersion }) : Promise.resolve({ jar: true, json: true, assets: true }),
        invoke<FsEntry[]>('instance_list_dir', { instanceId, path: '' }),
      ]);
      const requiredFolders = ['mods', 'config', 'resourcepacks', 'shaderpacks', 'saves', 'logs'];
      const names = new Set((root || []).filter(entry => entry.is_dir).map(entry => entry.name.toLowerCase()));
      setIntegrity({
        gameReady: Boolean(game.jar && game.json && game.assets),
        missingGameFiles: [!game.jar ? 'Minecraft JAR' : '', !game.json ? 'версия JSON' : '', !game.assets ? 'индекс assets' : ''].filter(Boolean),
        missingFolders: requiredFolders.filter(folder => !names.has(folder)),
      });
    } catch (e) { setError(`Проверка целостности не выполнена: ${String(e)}`); }
    finally { setCheckingIntegrity(false); }
  };

  return <div className="grid min-h-[430px] overflow-hidden rounded-2xl" style={{ gridTemplateColumns: 'minmax(220px, 34%) minmax(0, 1fr)', border: '1px solid var(--color-border)', background: 'var(--color-surface)' }}>
    <section className="flex min-w-0 flex-col" style={{ borderRight: '1px solid var(--color-border)', background:'linear-gradient(180deg, color-mix(in srgb, var(--color-surface-2) 24%, transparent), transparent)' }}>
      <div className="flex items-center gap-1 border-b px-2 py-2" style={{ borderColor: 'var(--color-border)', background:'linear-gradient(180deg, color-mix(in srgb, var(--color-surface-2) 72%, transparent), transparent)' }}>
        <button onClick={() => void loadDir('')} className="rounded-lg p-1.5 hover:bg-white/5" title="Корень .minecraft"><Home className="h-3.5 w-3.5" /></button>
        <button onClick={up} disabled={!cwd} className="rounded-lg p-1.5 hover:bg-white/5 disabled:opacity-30" title="Вверх"><ChevronRight className="h-3.5 w-3.5 -rotate-90" /></button>
        <span className="min-w-0 flex-1 truncate px-1 text-[10px]" style={{ color: 'var(--color-text-secondary)' }}>{cwd || '.minecraft'}</span>
        <button onClick={() => void checkIntegrity()} disabled={checkingIntegrity} className="rounded-lg p-1.5 hover:bg-white/5 disabled:opacity-40" title="Проверить целостность сборки"><ShieldCheck className={`h-3.5 w-3.5 ${checkingIntegrity ? 'animate-pulse' : ''}`} style={{ color: 'var(--color-primary)' }} /></button>
        <button onClick={() => void create(false)} className="rounded-lg p-1.5 hover:bg-white/5" title="Новый файл"><FilePlus2 className="h-3.5 w-3.5" style={{ color: 'var(--color-primary)' }} /></button>
        <button onClick={() => void create(true)} className="rounded-lg p-1.5 hover:bg-white/5" title="Новая папка"><FolderPlus className="h-3.5 w-3.5" style={{ color: 'var(--color-primary)' }} /></button>
      </div>
      <div className="border-b px-2 py-2" style={{ borderColor: 'var(--color-border)' }}>
        <label className="flex items-center gap-2 rounded-lg px-2 py-1.5" style={{ background: 'var(--color-surface-2)', border: '1px solid var(--color-border)' }}>
          <Search className="h-3.5 w-3.5 shrink-0" style={{ color: 'var(--color-text-tertiary)' }} />
          <input value={fileQuery} onChange={event => setFileQuery(event.target.value)} placeholder="Поиск по имени или расширению…" className="min-w-0 flex-1 bg-transparent text-[10px] outline-none" style={{ color: 'var(--color-text)' }} />
          {fileQuery && <button type="button" onClick={() => setFileQuery('')} className="rounded-md p-0.5" title="Очистить поиск"><X className="h-3 w-3" /></button>}
        </label>
      </div>
      {integrity && <div className="border-b px-2 py-2 text-[10px]" style={{ borderColor: 'var(--color-border)' }}>
        <div className="flex items-center gap-1.5 font-bold" style={{ color: integrity.gameReady && integrity.missingFolders.length === 0 ? 'var(--color-primary)' : 'var(--color-warning)' }}>
          {integrity.gameReady && integrity.missingFolders.length === 0 ? <CheckCircle2 className="h-3.5 w-3.5" /> : <ShieldCheck className="h-3.5 w-3.5" />}
          {integrity.gameReady && integrity.missingFolders.length === 0 ? 'Сборка готова' : 'Найдены отсутствующие элементы'}
        </div>
        {!!integrity.missingGameFiles.length && <p className="mt-1" style={{ color: 'var(--color-text-secondary)' }}>Игра: {integrity.missingGameFiles.join(', ')}</p>}
        {!!integrity.missingFolders.length && <p className="mt-1" style={{ color: 'var(--color-text-secondary)' }}>Папки: {integrity.missingFolders.join(', ')}</p>}
      </div>}
      <div className="min-h-0 flex-1 overflow-y-auto p-1.5">
        {visible.length === 0 ? <p className="m-1 rounded-xl border border-dashed p-4 text-center text-xs" style={{ borderColor: 'var(--color-border)', color: 'var(--color-text-tertiary)' }}>Папка пуста</p> : visible.map(entry => { const visual = entry.is_dir ? folderVisual(entry.name) : fileVisual(entry.name); const MainIcon = visual.Icon; const BadgeIcon = visual.badge; const codeLabel = 'codeLabel' in visual ? visual.codeLabel : undefined; return <div key={entry.path} draggable onDragStart={event => { event.dataTransfer.effectAllowed = 'move'; event.dataTransfer.setData('text/plain', entry.path); }} onDragOver={event => { if (entry.is_dir && event.dataTransfer.types.includes('text/plain')) { event.preventDefault(); event.dataTransfer.dropEffect = 'move'; } }} onDrop={event => { if (entry.is_dir) void moveEntryIntoFolder(event, entry.path); }} className="group flex items-center gap-1 rounded-xl px-2 py-1.5 transition-all duration-200 hover:-translate-y-px hover:bg-white/5" style={{ background: selected?.path === entry.path ? 'var(--color-primary-dim)' : 'transparent', boxShadow: selected?.path === entry.path ? '0 0 0 1px color-mix(in srgb, var(--color-primary) 28%, transparent)' : undefined }}>
          <button onClick={() => void open(entry)} className="flex min-w-0 flex-1 items-center gap-2 text-left">
            <span className="relative flex h-6 w-6 shrink-0 items-center justify-center rounded-lg" style={{ color: visual.color, background: entry.is_dir ? 'var(--color-surface-2)' : 'transparent', border: entry.is_dir ? '1px solid var(--color-border)' : undefined }}>{codeLabel ? <span className="font-mono text-[9px] font-black tracking-tighter">{codeLabel}</span> : <MainIcon className="h-3.5 w-3.5" />}{BadgeIcon && <span className="absolute -bottom-0.5 -right-0.5 flex h-3 w-3 items-center justify-center rounded-full" style={{ background:'var(--color-surface)', color:visual.color }}><BadgeIcon className="h-2.5 w-2.5" /></span>}</span>
            <span className="min-w-0 flex-1 truncate text-xs font-medium" style={{ color: 'var(--color-text)' }}>{entry.name}</span>
            {!entry.is_dir && <span className="text-[9px]" style={{ color: 'var(--color-text-tertiary)' }}>{formatBytes(entry.size)}</span>}
          </button>
          {entry.is_dir && entry.name.toLowerCase() === 'logs' && cwd === '' && <button onClick={() => void publishLog('logs/latest.log')} disabled={publishingLog} className="flex items-center gap-1 rounded-md px-1.5 py-1 text-[9px] font-bold opacity-0 group-hover:opacity-100 disabled:opacity-50" title="Отправить latest.log в mclo.gs" style={{ color:'var(--color-warning)', background:'color-mix(in srgb, var(--color-warning) 12%, transparent)' }}>{publishingLog ? <LoaderCircle className="h-3 w-3 animate-spin" /> : <Share2 className="h-3 w-3" />}mclo.gs</button>}
          {!entry.is_dir && isTextFile(entry.name) && <button onClick={() => void open(entry)} className="rounded-md px-1.5 py-1 text-[9px] font-bold opacity-0 group-hover:opacity-100" title="Открыть файл" style={{ color:'var(--color-primary)', background:'var(--color-primary-dim)' }}>Открыть</button>}
          {!entry.is_dir && /\.log$/i.test(entry.name) && <button onClick={() => void publishLog(entry.path)} disabled={publishingLog} className="flex items-center gap-1 rounded-md px-1.5 py-1 text-[9px] font-bold opacity-0 group-hover:opacity-100 disabled:opacity-50" title="Отправить лог в mclo.gs" style={{ color:'var(--color-warning)', background:'color-mix(in srgb, var(--color-warning) 12%, transparent)' }}>{publishingLog ? <LoaderCircle className="h-3 w-3 animate-spin" /> : <Share2 className="h-3 w-3" />}mclo.gs</button>}
          <button onClick={() => void rename(entry)} className="hidden rounded-md p-1 group-hover:block" title="Переименовать"><Pencil className="h-3 w-3" /></button>
          <button onClick={() => void remove(entry)} className="hidden rounded-md p-1 group-hover:block" title="Удалить" style={{ color: 'var(--color-error)' }}><Trash2 className="h-3 w-3" /></button>
        </div>; })}
      </div>
    </section>
    <section className="flex min-w-0 flex-col">
      {!selected ? <div className="flex flex-1 flex-col items-center justify-center gap-2 p-6 text-center"><FileCode2 className="h-9 w-9" style={{ color: 'var(--color-text-tertiary)' }} /><p className="text-sm font-bold" style={{ color: 'var(--color-text)' }}>Выберите файл для редактирования</p><p className="max-w-sm text-xs" style={{ color: 'var(--color-text-secondary)' }}>Поддерживаются текстовые конфиги, JSON, TOML, YAML, логи, файлы модов и код. Для остальных файлов доступно управление в списке.</p></div> : !isTextFile(selected.name) ? <div className="flex flex-1 flex-col items-center justify-center gap-2 p-6 text-center"><FileCode2 className="h-9 w-9" style={{ color: 'var(--color-text-tertiary)' }} /><p className="text-sm font-bold" style={{ color: 'var(--color-text)' }}>{selected.name}</p><p className="text-xs" style={{ color: 'var(--color-text-secondary)' }}>Это бинарный файл. Его нельзя безопасно открыть как текст.</p></div> : <>
        <div className="flex items-center gap-2 border-b px-3 py-2" style={{ borderColor: 'var(--color-border)' }}><FileCode2 className="h-3.5 w-3.5" style={{ color: 'var(--color-primary)' }} /><span className="min-w-0 flex-1 truncate text-xs font-bold" style={{ color: 'var(--color-text)' }}>{selected.path}</span>{dirty && <span className="text-[10px]" style={{ color: 'var(--color-warning)' }}>Изменено</span>}{/\.log$/i.test(selected.name) && <button onClick={() => void publishLog()} disabled={publishingLog} className="flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-[10px] font-bold disabled:opacity-40" style={{ color: 'var(--color-warning)', background: 'color-mix(in srgb, var(--color-warning) 12%, transparent)' }}>{publishingLog ? <LoaderCircle className="h-3 w-3 animate-spin" /> : <ExternalLink className="h-3 w-3" />}mclo.gs</button>}<button onClick={() => void save()} disabled={busy || !dirty} className="flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-[10px] font-bold disabled:opacity-40" style={{ background: 'var(--color-primary)', color: 'var(--color-primary-text)' }}><Save className="h-3 w-3" />Сохранить</button></div>
        <div className="relative min-h-0 flex-1 overflow-hidden bg-[#10131a] p-3"><pre ref={highlightedCodeRef} aria-hidden dangerouslySetInnerHTML={{ __html: highlightCode(content, selected.name) }} className="pointer-events-none absolute inset-3 overflow-auto whitespace-pre break-normal font-mono text-[12px] leading-5" style={{ color:'#D6E2FF', tabSize: 2, scrollbarWidth:'none' }} /><textarea value={content} onChange={event => setContent(event.target.value)} onScroll={event => { const overlay = highlightedCodeRef.current; if (overlay) { overlay.scrollTop = event.currentTarget.scrollTop; overlay.scrollLeft = event.currentTarget.scrollLeft; } }} onWheel={event => { event.preventDefault(); const editor = event.currentTarget; editor.scrollTop += event.deltaY; editor.scrollLeft += event.deltaX; const overlay = highlightedCodeRef.current; if (overlay) { overlay.scrollTop = editor.scrollTop; overlay.scrollLeft = editor.scrollLeft; } }} onKeyDown={event => { if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') { event.preventDefault(); void save(); } }} spellCheck={false} className="relative block h-full min-h-[360px] w-full resize-none overflow-auto bg-transparent font-mono text-[12px] leading-5 outline-none" style={{ color:'transparent', caretColor:'#FFFFFF', tabSize: 2 }} /></div>
      </>}
      {mclogsDiagnosis && <aside className="border-t px-3 py-2.5" style={{ borderColor: 'var(--color-border)', background: 'rgba(255, 90, 95, 0.045)' }}>
        <div className="flex items-start gap-2">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" style={{ color: '#FF5A5F' }} />
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2"><p className="min-w-0 flex-1 text-xs font-bold" style={{ color: '#FF5A5F' }}>{mclogsDiagnosis.title}</p><button onClick={() => setMclogsDiagnosis(null)} className="rounded p-0.5" title="Закрыть диагностику"><X className="h-3.5 w-3.5" /></button></div>
            <p className="mt-0.5 text-[11px] leading-4" style={{ color: '#FF5A5F' }}>{mclogsDiagnosis.summary}</p>
            {mclogsDiagnosis.evidence.length > 0 && <div className="mt-2 space-y-1"><p className="text-[10px] font-bold uppercase tracking-wide" style={{ color: '#F6C64A' }}>Ключевые моды и строки конфликта</p>{mclogsDiagnosis.evidence.slice(0, 3).map((line, index) => <p key={`${line}-${index}`} className="font-mono text-[10px] leading-4" style={{ color: '#F6C64A' }}>{line}</p>)}</div>}
            {mclogsDiagnosis.suggestions.length > 0 && <p className="mt-2 text-[11px]" style={{ color: 'var(--color-text-secondary)' }}>Что сделать: {mclogsDiagnosis.suggestions.slice(0, 2).join(' · ')}</p>}
            <a href={mclogsDiagnosis.url} target="_blank" rel="noreferrer" className="mt-2 inline-flex items-center gap-1 text-[10px] font-bold" style={{ color: 'var(--color-primary)' }}><ExternalLink className="h-3 w-3" />Открыть mclo.gs · {mclogsDiagnosis.errors} ошибок, {mclogsDiagnosis.lines} строк</a>
          </div>
        </div>
      </aside>}
      {error && <div className="flex items-center gap-2 border-t px-3 py-2 text-xs" style={{ borderColor: 'var(--color-border)', color: 'var(--color-error)' }}><X className="h-3.5 w-3.5" />{error}</div>}
    </section>
  </div>;
}

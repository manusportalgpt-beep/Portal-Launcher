import { useEffect, useMemo, useRef, useState, type PointerEvent } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { invoke } from '@/lib/invoke-shim';
import { Check, Droplet, Eraser, Eye, EyeOff, Layers3, Paintbrush, Plus, Redo2, Save, SlidersHorizontal, Trash2, Undo2, X } from 'lucide-react';

export type ScreenshotEditorProps = {
  instanceId: string;
  fileName: string;
  imageUrl: string;
  onClose: () => void;
  onSaved: () => void;
};

type Tool = 'brush' | 'eraser' | 'fill';
type DrawingLayer = { id: string; name: string; visible: boolean };
type Palette = 'natural' | 'warm' | 'cool' | 'mono';
type LayerHistory = Record<string, { items: string[]; index: number }>;

function clampSize(value: number) { return Math.max(1, Math.min(160, Math.round(value) || 1)); }

function floodFill(ctx: CanvasRenderingContext2D, x: number, y: number, color: string) {
  const image = ctx.getImageData(0, 0, ctx.canvas.width, ctx.canvas.height);
  const start = (y * image.width + x) * 4;
  const target = [image.data[start], image.data[start + 1], image.data[start + 2], image.data[start + 3]];
  const fill = document.createElement('canvas').getContext('2d');
  if (!fill) return;
  fill.fillStyle = color; fill.fillRect(0, 0, 1, 1);
  const c = fill.getImageData(0, 0, 1, 1).data;
  if (target[0] === c[0] && target[1] === c[1] && target[2] === c[2] && target[3] === c[3]) return;
  const queue: Array<[number, number]> = [[x, y]];
  const seen = new Uint8Array(image.width * image.height);
  const matches = (px: number, py: number) => {
    if (px < 0 || py < 0 || px >= image.width || py >= image.height) return false;
    const i = py * image.width + px;
    if (seen[i]) return false;
    const p = i * 4;
    return image.data[p] === target[0] && image.data[p + 1] === target[1] && image.data[p + 2] === target[2] && image.data[p + 3] === target[3];
  };
  while (queue.length) {
    const [px, py] = queue.pop()!;
    if (!matches(px, py)) continue;
    const i = py * image.width + px; seen[i] = 1;
    const p = i * 4; image.data[p] = c[0]; image.data[p + 1] = c[1]; image.data[p + 2] = c[2]; image.data[p + 3] = c[3];
    queue.push([px + 1, py], [px - 1, py], [px, py + 1], [px, py - 1]);
  }
  ctx.putImageData(image, 0, 0);
}

export function ScreenshotEditor({ instanceId, fileName, imageUrl, onClose, onSaved }: ScreenshotEditorProps) {
  const { t } = useTranslation();
  const baseCanvasRef = useRef<HTMLCanvasElement>(null);
  const layerCanvasRefs = useRef<Record<string, HTMLCanvasElement | null>>({});
  const drawingRef = useRef(false);
  const historyRef = useRef<LayerHistory>({});
  const [layers, setLayers] = useState<DrawingLayer[]>([{ id: 'layer-1', name: 'Слой 1', visible: true }]);
  const [activeLayer, setActiveLayer] = useState('layer-1');
  const [tool, setTool] = useState<Tool>('brush');
  const [color, setColor] = useState('#ef233c');
  const [brushSize, setBrushSize] = useState(14);
  const [eraserSize, setEraserSize] = useState(24);
  const [brightness, setBrightness] = useState(100);
  const [contrast, setContrast] = useState(100);
  const [blur, setBlur] = useState(0);
  const [palette, setPalette] = useState<Palette>('natural');
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [, setHistoryRevision] = useState(0);
  const toolSize = tool === 'eraser' ? eraserSize : brushSize;

  const imageFilter = useMemo(() => {
    const paletteFilter = palette === 'mono' ? ' grayscale(1)' : palette === 'warm' ? ' sepia(.2) saturate(1.12)' : palette === 'cool' ? ' hue-rotate(12deg) saturate(1.08)' : '';
    return `brightness(${brightness}%) contrast(${contrast}%) blur(${blur}px)${paletteFilter}`;
  }, [brightness, contrast, blur, palette]);

  useEffect(() => {
    document.body.dataset.portalOverlay = 'screenshot-editor';
    window.dispatchEvent(new Event('portal-overlay-change'));
    return () => { delete document.body.dataset.portalOverlay; window.dispatchEvent(new Event('portal-overlay-change')); };
  }, []);

  useEffect(() => {
    const canvas = baseCanvasRef.current;
    if (!canvas) return;
    const image = new Image();
    image.onload = () => {
      canvas.width = image.naturalWidth; canvas.height = image.naturalHeight;
      canvas.getContext('2d')?.drawImage(image, 0, 0);
      historyRef.current = {};
      for (const layer of layers) {
        const drawing = layerCanvasRefs.current[layer.id];
        if (drawing) {
          drawing.width = image.naturalWidth; drawing.height = image.naturalHeight;
          historyRef.current[layer.id] = { items: [drawing.toDataURL('image/png')], index: 0 };
        }
      }
      setDirty(false);
      setHistoryRevision(value => value + 1);
    };
    image.src = imageUrl;
  // Initial layer refs are mounted before the image finishes loading.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [imageUrl]);

  useEffect(() => {
    const base = baseCanvasRef.current;
    if (!base?.width || !base.height) return;
    for (const layer of layers) {
      const canvas = layerCanvasRefs.current[layer.id];
      if (canvas && (canvas.width !== base.width || canvas.height !== base.height)) {
        canvas.width = base.width; canvas.height = base.height;
        historyRef.current[layer.id] = { items: [canvas.toDataURL('image/png')], index: 0 };
      }
    }
  }, [layers]);

  const activeCanvas = () => layerCanvasRefs.current[activeLayer] ?? null;
  const pushHistory = () => {
    const canvas = activeCanvas(); if (!canvas) return;
    const previous = historyRef.current[activeLayer] ?? { items: [], index: -1 };
    const items = previous.items.slice(0, previous.index + 1);
    items.push(canvas.toDataURL('image/png'));
    if (items.length > 30) items.shift();
    historyRef.current[activeLayer] = { items, index: items.length - 1 };
    setDirty(true); setHistoryRevision(value => value + 1);
  };
  const restore = (layerId: string, data: string) => {
    const canvas = layerCanvasRefs.current[layerId]; if (!canvas) return;
    const image = new Image(); image.onload = () => {
      const ctx = canvas.getContext('2d'); if (!ctx) return;
      ctx.clearRect(0, 0, canvas.width, canvas.height); ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
    }; image.src = data;
  };
  const undo = () => {
    const record = historyRef.current[activeLayer];
    if (!record || record.index <= 0) return;
    record.index -= 1; restore(activeLayer, record.items[record.index]); setDirty(true); setHistoryRevision(value => value + 1);
  };
  const redo = () => {
    const record = historyRef.current[activeLayer];
    if (!record || record.index >= record.items.length - 1) return;
    record.index += 1; restore(activeLayer, record.items[record.index]); setDirty(true); setHistoryRevision(value => value + 1);
  };
  const point = (event: PointerEvent<HTMLCanvasElement>) => {
    const canvas = event.currentTarget; const rect = canvas.getBoundingClientRect();
    return { x: Math.max(0, Math.min(canvas.width - 1, Math.floor((event.clientX - rect.left) * canvas.width / rect.width))), y: Math.max(0, Math.min(canvas.height - 1, Math.floor((event.clientY - rect.top) * canvas.height / rect.height))) };
  };
  const start = (event: PointerEvent<HTMLCanvasElement>) => {
    event.preventDefault(); event.currentTarget.setPointerCapture(event.pointerId); drawingRef.current = true;
    const canvas = activeCanvas(); const ctx = canvas?.getContext('2d'); if (!canvas || !ctx) return;
    const p = point(event);
    if (tool === 'fill') { floodFill(ctx, p.x, p.y, color); pushHistory(); drawingRef.current = false; return; }
    ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.lineWidth = toolSize; ctx.strokeStyle = tool === 'eraser' ? 'rgba(0,0,0,1)' : color; ctx.globalCompositeOperation = tool === 'eraser' ? 'destination-out' : 'source-over'; ctx.lineTo(p.x + 0.1, p.y + 0.1); ctx.stroke();
  };
  const move = (event: PointerEvent<HTMLCanvasElement>) => { if (!drawingRef.current || tool === 'fill') return; const ctx = activeCanvas()?.getContext('2d'); if (!ctx) return; const p = point(event); ctx.lineTo(p.x, p.y); ctx.stroke(); };
  const end = () => { if (!drawingRef.current) return; drawingRef.current = false; activeCanvas()?.getContext('2d')?.closePath(); pushHistory(); };
  const addLayer = () => {
    const id = `layer-${Date.now()}`;
    setLayers(current => [...current, { id, name: `Слой ${current.length + 1}`, visible: true }]);
    setActiveLayer(id); setDirty(true);
  };
  const removeLayer = (id: string) => {
    if (layers.length === 1) return;
    setLayers(current => current.filter(layer => layer.id !== id));
    if (activeLayer === id) setActiveLayer(layers.find(layer => layer.id !== id)?.id ?? 'layer-1');
    delete layerCanvasRefs.current[id]; delete historyRef.current[id]; setDirty(true);
  };
  const save = async () => {
    const baseCanvas = baseCanvasRef.current; if (!baseCanvas) return; setSaving(true);
    try {
      const merged = document.createElement('canvas'); merged.width = baseCanvas.width; merged.height = baseCanvas.height;
      const ctx = merged.getContext('2d'); if (!ctx) throw new Error('Не удалось подготовить итоговое изображение');
      ctx.filter = imageFilter; ctx.drawImage(baseCanvas, 0, 0); ctx.filter = 'none';
      for (const layer of layers) { if (layer.visible) { const canvas = layerCanvasRefs.current[layer.id]; if (canvas) ctx.drawImage(canvas, 0, 0); } }
      const blob = await new Promise<Blob | null>(resolve => merged.toBlob(resolve, 'image/png'));
      if (!blob) throw new Error('Не удалось закодировать скриншот');
      await invoke('save_instance_screenshot', { id: instanceId, fileName: fileName.replace(/\.(jpg|jpeg)$/i, '.png'), data: Array.from(new Uint8Array(await blob.arrayBuffer())) });
      setDirty(false); onSaved();
    } catch (error) { console.error(error); } finally { setSaving(false); }
  };
  const currentHistory = historyRef.current[activeLayer];

  return createPortal(<div data-portal-overlay="true" className="fixed inset-0 flex flex-col bg-[#09090b]" style={{ zIndex: 2147483647 }}>
    <div className="flex items-center gap-3 px-4 py-3" style={{ borderColor:'transparent' }}><Paintbrush className="h-4 w-4" style={{ color:'var(--color-primary)' }} /><p className="min-w-0 flex-1 truncate text-sm font-bold" style={{ color:'var(--color-text)' }}>{fileName}{dirty ? t('instanceUi.editor.modified') : ''}</p><button onClick={undo} disabled={!currentHistory || currentHistory.index <= 0} className="rounded-sm p-2 disabled:opacity-30" title="Отменить"><Undo2 className="h-4 w-4" /></button><button onClick={redo} disabled={!currentHistory || currentHistory.index >= currentHistory.items.length - 1} className="rounded-sm p-2 disabled:opacity-30" title="Повторить"><Redo2 className="h-4 w-4" /></button><button onClick={save} disabled={saving || !dirty} className="flex items-center gap-1.5 rounded-sm px-3 py-1.5 text-xs font-bold disabled:opacity-40" style={{ background:'var(--color-primary)', color:'var(--color-primary-text)' }}><Save className="h-3.5 w-3.5" />{saving ? t('instanceUi.editor.saving') : t('common.save')}</button><button data-portal-close="true" onClick={onClose} className="rounded-sm p-2" title={t('common.close')}><X className="h-4 w-4" /></button></div>
    <div className="flex min-h-0 flex-1 items-center justify-center overflow-hidden p-6"><div className="relative rounded-sm p-2" style={{ background:'repeating-conic-gradient(#202024 0% 25%, #16161a 0% 50%) 50% / 20px 20px' }}><canvas ref={baseCanvasRef} className="block max-h-[calc(100vh-290px)] max-w-[calc(100vw-48px)] object-contain" style={{ filter:imageFilter }} />{layers.map(layer => <canvas key={layer.id} ref={element => { layerCanvasRefs.current[layer.id] = element; }} onPointerDown={start} onPointerMove={move} onPointerUp={end} onPointerCancel={end} className="absolute left-2 top-2 max-h-[calc(100vh-290px)] max-w-[calc(100vw-48px)] touch-none object-contain" style={{ display:layer.visible ? 'block' : 'none', pointerEvents:layer.id === activeLayer && layer.visible ? 'auto' : 'none' }} />)}</div></div>
    <div className="flex flex-wrap items-center justify-center gap-2 px-4 py-3" style={{ borderColor:'transparent', background:'var(--color-bg)' }}>
      <div className="flex max-w-full items-center gap-1 rounded-sm px-2 py-1.5" style={{ background:'transparent', border:'1px solid var(--color-border)' }}><Layers3 className="h-3.5 w-3.5" style={{ color:'var(--color-primary)' }} />{layers.map(layer => <div key={layer.id} className="flex items-center"><button onClick={() => setActiveLayer(layer.id)} className="rounded-sm px-1.5 py-1 text-[10px] font-bold" style={{ background:activeLayer === layer.id ? 'var(--color-primary-dim)' : 'transparent', color:activeLayer === layer.id ? 'var(--color-primary)' : 'var(--color-text-secondary)' }}>{layer.name}</button><button onClick={() => setLayers(current => current.map(item => item.id === layer.id ? { ...item, visible: !item.visible } : item))} className="p-1" title={layer.visible ? 'Скрыть слой' : 'Показать слой'}>{layer.visible ? <Eye className="h-3 w-3" /> : <EyeOff className="h-3 w-3" />}</button>{layers.length > 1 && <button onClick={() => removeLayer(layer.id)} className="p-1" title="Удалить слой"><Trash2 className="h-3 w-3" /></button>}</div>)}<button onClick={addLayer} className="rounded-sm p-1" title="Создать слой"><Plus className="h-3.5 w-3.5" /></button></div>
      {([['brush','instanceUi.editor.brush',Paintbrush],['fill','instanceUi.editor.fill',Droplet],['eraser','instanceUi.editor.eraser',Eraser]] as const).map(([id,labelKey,Icon]) => <button key={id} onClick={() => setTool(id)} className="flex items-center gap-1.5 rounded-xl px-3 py-2 text-xs font-bold" style={{ background:tool === id ? 'var(--color-primary-dim)' : 'var(--color-surface-2)', color:tool === id ? 'var(--color-primary)' : 'var(--color-text-secondary)', border:`1px solid ${tool === id ? 'var(--color-primary)' : 'var(--color-border)'}` }}><Icon className="h-3.5 w-3.5" />{t(labelKey)}</button>)}
      <label className="flex items-center gap-2 rounded-xl px-3 py-2 text-xs" style={{ background:'var(--color-surface-2)', border:'1px solid var(--color-border)', color:'var(--color-text-secondary)' }}>Цвет <input type="color" value={color} onChange={event => setColor(event.target.value)} className="h-6 w-8 cursor-pointer border-0 bg-transparent" /></label>
      {tool !== 'fill' && <label className="flex items-center gap-1.5 rounded-xl px-2 py-2 text-xs" style={{ background:'var(--color-surface-2)', border:'1px solid var(--color-border)', color:'var(--color-text-secondary)' }}>{tool === 'eraser' ? 'Ластик' : 'Кисть'} <input type="number" min="1" max="160" value={toolSize} onChange={event => tool === 'eraser' ? setEraserSize(clampSize(Number(event.target.value))) : setBrushSize(clampSize(Number(event.target.value)))} className="w-12 bg-transparent text-right outline-none" style={{ color:'var(--color-text)' }} /><input type="range" min="1" max="160" value={toolSize} onChange={event => tool === 'eraser' ? setEraserSize(Number(event.target.value)) : setBrushSize(Number(event.target.value))} className="w-20" /></label>}
      <div className="flex items-center gap-1 rounded-xl px-2 py-1.5" style={{ background:'var(--color-surface-2)', border:'1px solid var(--color-border)' }}><SlidersHorizontal className="h-3.5 w-3.5" style={{ color:'var(--color-primary)' }} /><label className="text-[10px]">Ярк.<input type="number" min="0" max="200" value={brightness} onChange={event => { setBrightness(Math.max(0, Math.min(200, Number(event.target.value) || 0))); setDirty(true); }} className="ml-1 w-9 bg-transparent text-center outline-none" /></label><label className="text-[10px]">Конт.<input type="number" min="0" max="200" value={contrast} onChange={event => { setContrast(Math.max(0, Math.min(200, Number(event.target.value) || 0))); setDirty(true); }} className="ml-1 w-9 bg-transparent text-center outline-none" /></label><label className="text-[10px]">Мыл.<input type="number" min="0" max="30" value={blur} onChange={event => { setBlur(Math.max(0, Math.min(30, Number(event.target.value) || 0))); setDirty(true); }} className="ml-1 w-8 bg-transparent text-center outline-none" /></label><select value={palette} onChange={event => { setPalette(event.target.value as Palette); setDirty(true); }} className="bg-transparent text-[10px] outline-none" style={{ color:'var(--color-text-secondary)' }}><option value="natural">Обычная</option><option value="warm">Тёплая</option><option value="cool">Холодная</option><option value="mono">Монохром</option></select></div>
      <span className="hidden items-center gap-1 text-[10px] sm:flex" style={{ color:'var(--color-text-tertiary)' }}><Check className="h-3 w-3" /> Оригинал не изменяется до сохранения</span>
    </div>
  </div>, document.body);
}

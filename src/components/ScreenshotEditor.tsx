import { useEffect, useRef, useState } from 'react';
import type { PointerEvent } from 'react';
import { createPortal } from 'react-dom';
import { invoke } from '@/lib/invoke-shim';
import { Check, Droplet, Eraser, Image as ImageIcon, Layers3, Minus, Paintbrush, Redo2, Save, Undo2, X } from 'lucide-react';

export type ScreenshotEditorProps = {
  instanceId: string;
  fileName: string;
  imageUrl: string;
  onClose: () => void;
  onSaved: () => void;
};

type Tool = 'brush' | 'eraser' | 'fill';

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
  const baseCanvasRef = useRef<HTMLCanvasElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drawingRef = useRef(false);
  const historyRef = useRef<string[]>([]);
  const historyIndexRef = useRef(-1);
  const [tool, setTool] = useState<Tool>('brush');
  const [color, setColor] = useState('#ef233c');
  const [size, setSize] = useState(14);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [, setHistoryRevision] = useState(0);

  // The original screenshot is a locked base layer. All tools operate only on
  // the transparent drawing layer, so the eraser can never delete the source image.
  const [activeLayer, setActiveLayer] = useState<'drawing'>('drawing');

  useEffect(() => {
    document.body.dataset.portalOverlay = 'screenshot-editor';
    window.dispatchEvent(new Event('portal-overlay-change'));
    return () => { delete document.body.dataset.portalOverlay; window.dispatchEvent(new Event('portal-overlay-change')); };
  }, []);

  const pushHistory = () => {
    const canvas = canvasRef.current; if (!canvas) return;
    const next = canvas.toDataURL('image/png');
    const trimmed = historyRef.current.slice(0, historyIndexRef.current + 1);
    trimmed.push(next); if (trimmed.length > 30) trimmed.shift();
    historyRef.current = trimmed; historyIndexRef.current = trimmed.length - 1; setDirty(true); setHistoryRevision(value => value + 1);
  };
  const restore = (data: string) => {
    const canvas = canvasRef.current; if (!canvas) return;
    const image = new Image(); image.onload = () => {
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      ctx.save();
      ctx.globalCompositeOperation = 'source-over';
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
      ctx.restore();
    }; image.src = data;
  };
  const undo = () => { if (historyIndexRef.current <= 0) return; historyIndexRef.current -= 1; restore(historyRef.current[historyIndexRef.current]); setDirty(historyIndexRef.current > 0); setHistoryRevision(value => value + 1); };
  const redo = () => { if (historyIndexRef.current >= historyRef.current.length - 1) return; historyIndexRef.current += 1; restore(historyRef.current[historyIndexRef.current]); setDirty(historyIndexRef.current > 0); setHistoryRevision(value => value + 1); };

  useEffect(() => {
    const canvas = canvasRef.current; const baseCanvas = baseCanvasRef.current; if (!canvas || !baseCanvas) return;
    const image = new Image(); image.onload = () => {
      canvas.width = image.naturalWidth; canvas.height = image.naturalHeight;
      baseCanvas.width = image.naturalWidth; baseCanvas.height = image.naturalHeight;
      baseCanvas.getContext('2d')?.drawImage(image, 0, 0);
      historyRef.current = [canvas.toDataURL('image/png')]; historyIndexRef.current = 0; setDirty(false);
    }; image.src = imageUrl;
  }, [imageUrl]);

  const point = (event: PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current!; const rect = canvas.getBoundingClientRect();
    return { x: Math.max(0, Math.min(canvas.width - 1, Math.floor((event.clientX - rect.left) * canvas.width / rect.width))), y: Math.max(0, Math.min(canvas.height - 1, Math.floor((event.clientY - rect.top) * canvas.height / rect.height))) };
  };
  const start = (event: PointerEvent<HTMLCanvasElement>) => {
    event.preventDefault(); event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId); drawingRef.current = true;
    const canvas = canvasRef.current!; const ctx = canvas.getContext('2d')!; const p = point(event);
    if (tool === 'fill') { floodFill(ctx, p.x, p.y, color); pushHistory(); drawingRef.current = false; return; }
    ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.lineWidth = size; ctx.strokeStyle = tool === 'eraser' ? 'rgba(0,0,0,1)' : color; ctx.globalCompositeOperation = tool === 'eraser' ? 'destination-out' : 'source-over'; ctx.lineTo(p.x + 0.1, p.y + 0.1); ctx.stroke();
  };
  const move = (event: PointerEvent<HTMLCanvasElement>) => { event.stopPropagation(); if (!drawingRef.current || tool === 'fill') return; const ctx = canvasRef.current?.getContext('2d'); if (!ctx) return; const p = point(event); ctx.lineTo(p.x, p.y); ctx.stroke(); };
  const end = () => { if (!drawingRef.current) return; drawingRef.current = false; canvasRef.current?.getContext('2d')?.closePath(); pushHistory(); };

  const save = async () => {
    const canvas = canvasRef.current; const baseCanvas = baseCanvasRef.current; if (!canvas || !baseCanvas) return; setSaving(true);
    try {
      const merged = document.createElement('canvas');
      merged.width = baseCanvas.width; merged.height = baseCanvas.height;
      const mergedContext = merged.getContext('2d');
      if (!mergedContext) throw new Error('Не удалось подготовить итоговое изображение');
      mergedContext.drawImage(baseCanvas, 0, 0);
      mergedContext.drawImage(canvas, 0, 0);
      const blob = await new Promise<Blob | null>(resolve => merged.toBlob(resolve, 'image/png'));
      if (!blob) throw new Error('Could not encode screenshot');
      const data = Array.from(new Uint8Array(await blob.arrayBuffer()));
      await invoke('save_instance_screenshot', { id: instanceId, fileName: fileName.replace(/\.(jpg|jpeg)$/i, '.png'), data });
      setDirty(false); onSaved();
    } catch (e) { console.error(e); } finally { setSaving(false); }
  };

  return createPortal(<div data-portal-overlay="true" className="fixed inset-0 flex flex-col bg-[#09090b]/95 backdrop-blur-md" style={{ zIndex: 2147483647 }}>
    <div className="flex items-center gap-3 border-b px-4 py-3" style={{ borderColor:'var(--color-border)' }}>
      <Paintbrush className="h-4 w-4" style={{ color:'var(--color-primary)' }} /><p className="min-w-0 flex-1 truncate text-sm font-bold" style={{ color:'var(--color-text)' }}>{fileName}{dirty ? ' · изменено' : ''}</p>
      <button onClick={undo} disabled={historyIndexRef.current <= 0} className="rounded-lg p-2 disabled:opacity-30" title="Отменить"><Undo2 className="h-4 w-4" /></button>
      <button onClick={redo} disabled={historyIndexRef.current >= historyRef.current.length - 1} className="rounded-lg p-2 disabled:opacity-30" title="Повторить"><Redo2 className="h-4 w-4" /></button>
      <button onClick={save} disabled={saving || !dirty} className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-bold disabled:opacity-40" style={{ background:'var(--color-primary)', color:'var(--color-primary-text)' }}><Save className="h-3.5 w-3.5" />{saving ? 'Сохраняю…' : 'Сохранить'}</button>
      <button data-portal-close="true" onClick={onClose} className="rounded-lg p-2" title="Закрыть"><X className="h-4 w-4" /></button>
    </div>
    <div className="flex min-h-0 flex-1 items-center justify-center overflow-hidden p-6">
      <div className="relative rounded-xl p-3 shadow-2xl" style={{ background:'repeating-conic-gradient(#242424 0% 25%, #1b1b1b 0% 50%) 50% / 24px 24px' }}>
        <canvas ref={baseCanvasRef} className="block max-h-[calc(100vh-220px)] max-w-[calc(100vw-48px)] object-contain shadow-xl" />
        <canvas ref={canvasRef} onPointerDown={start} onPointerMove={move} onPointerUp={end} onPointerCancel={end} className="absolute left-3 top-3 max-h-[calc(100vh-220px)] max-w-[calc(100vw-48px)] touch-none object-contain" />
      </div>
    </div>
    <div className="flex flex-wrap items-center justify-center gap-2 border-t px-4 py-3" style={{ borderColor:'var(--color-border)', background:'var(--color-surface)' }}>
      <div className="flex items-center gap-1 rounded-xl px-2 py-1.5" style={{ background:'var(--color-surface-2)', border:'1px solid var(--color-border)' }}>
        <Layers3 className="h-3.5 w-3.5" style={{ color:'var(--color-primary)' }} />
        <span className="text-[10px] font-bold" style={{ color:'var(--color-text-secondary)' }}>Слои</span>
        <span className="flex items-center gap-1 rounded-lg px-1.5 py-1 text-[10px]" style={{ color:'var(--color-text-tertiary)' }}><ImageIcon className="h-3 w-3" />Изображение</span>
        <button onClick={() => setActiveLayer('drawing')} className="flex items-center gap-1 rounded-lg px-1.5 py-1 text-[10px] font-bold" style={{ background:activeLayer === 'drawing' ? 'var(--color-primary-dim)' : 'transparent', color:activeLayer === 'drawing' ? 'var(--color-primary)' : 'var(--color-text-secondary)' }}><Paintbrush className="h-3 w-3" />Рисунок</button>
      </div>
      {([['brush','Кисть',Paintbrush],['fill','Заливка',Droplet],['eraser','Ластик',Eraser]] as const).map(([id,label,Icon]) => <button key={id} onClick={() => setTool(id)} className="flex items-center gap-1.5 rounded-xl px-3 py-2 text-xs font-bold" style={{ background:tool === id ? 'var(--color-primary-dim)' : 'var(--color-surface-2)', color:tool === id ? 'var(--color-primary)' : 'var(--color-text-secondary)', border:`1px solid ${tool === id ? 'var(--color-primary)' : 'var(--color-border)'}` }}><Icon className="h-3.5 w-3.5" />{label}</button>)}
      <label className="flex items-center gap-2 rounded-xl px-3 py-2 text-xs" style={{ background:'var(--color-surface-2)', border:'1px solid var(--color-border)', color:'var(--color-text-secondary)' }}>Цвет <input type="color" value={color} onChange={e => setColor(e.target.value)} className="h-6 w-8 cursor-pointer border-0 bg-transparent" /></label>
      <label className="flex items-center gap-2 rounded-xl px-3 py-2 text-xs" style={{ background:'var(--color-surface-2)', border:'1px solid var(--color-border)', color:'var(--color-text-secondary)' }}><Minus className="h-3.5 w-3.5" />Размер <input type="range" min="1" max="120" value={size} onChange={e => setSize(Number(e.target.value))} /><span className="w-7 text-right tabular-nums">{size}</span></label>
      <span className="hidden items-center gap-1 text-[10px] sm:flex" style={{ color:'var(--color-text-tertiary)' }}><Check className="h-3 w-3" /> PNG сохраняется в screenshots этой сборки</span>
    </div>
  </div>, document.body);
}

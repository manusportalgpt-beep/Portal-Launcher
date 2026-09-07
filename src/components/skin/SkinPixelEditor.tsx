import { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Pencil, Eraser, Pipette, PaintBucket, Eye, EyeOff, X, Check, RotateCcw, Save } from 'lucide-react';
import { SkinStand3D, type SkinModel } from './SkinStand3D';

/**
 * Pixel skin editor (64×64 Minecraft sheet) with BlockBench-style tools:
 * pen, eraser, eyedropper, fill bucket, palette, per-body-part layering &
 * show/hide toggles, and a live 3D preview.
 */

type Tool = 'pen' | 'eraser' | 'picker' | 'fill';

interface Props {
  open: boolean;
  initialDataUrl: string | null;   // исходный скин (data URL PNG) или null → чистый Steve
  model: SkinModel;
  onClose: () => void;
  /** Возвращает готовую PNG data URL созданного скина. */
  onSave: (dataUrl: string) => void;
}

const SHEET_W = 64;
const SHEET_H = 64;

// Регионы листа 64×64 (x, y, w, h) для подсветки частей тела —
// стандартная раскладка скина Minecraft (48×32 base + overlay).
const BODY_REGIONS: { id: string; label: string; layer: boolean }[] = [
  { id: 'head', label: 'Голова', layer: false },
  { id: 'headLayer', label: 'Голова · слой', layer: true },
  { id: 'body', label: 'Тело', layer: false },
  { id: 'bodyLayer', label: 'Тело · слой', layer: true },
  { id: 'rightArm', label: 'Пр. рука', layer: false },
  { id: 'rightArmLayer', label: 'Пр. рука · слой', layer: true },
  { id: 'leftArm', label: 'Лев. рука', layer: false },
  { id: 'leftArmLayer', label: 'Лев. рука · слой', layer: true },
  { id: 'rightLeg', label: 'Пр. нога', layer: false },
  { id: 'rightLegLayer', label: 'Пр. нога · слой', layer: true },
  { id: 'leftLeg', label: 'Лев. нога', layer: false },
  { id: 'leftLegLayer', label: 'Лев. нога · слой', layer: true },
];
const REGION_RECTS: Record<string, { x: number; y: number; w: number; h: number }> = {
  head:           { x: 8,  y: 8,  w: 8,  h: 8 },
  headLayer:      { x: 40, y: 8,  w: 8,  h: 8 },
  body:           { x: 20, y: 20, w: 8,  h: 12 },
  bodyLayer:      { x: 20, y: 36, w: 8,  h: 12 },
  rightArm:       { x: 44, y: 20, w: 4,  h: 12 },
  rightArmLayer:  { x: 44, y: 36, w: 4,  h: 12 },
  leftArm:        { x: 36, y: 48, w: 4,  h: 12 },
  leftArmLayer:   { x: 48, y: 48, w: 4,  h: 12 },
  rightLeg:       { x: 4,  y: 20, w: 4,  h: 12 },
  rightLegLayer:  { x: 4,  y: 36, w: 4,  h: 12 },
  leftLeg:        { x: 20, y: 48, w: 4,  h: 12 },
  leftLegLayer:   { x: 4,  y: 48, w: 4,  h: 12 },
};

const PRESET_COLORS = [
  '#FFFFFF', '#C7C7C7', '#8B8B8B', '#555555', '#2B2B2B', '#000000',
  '#F38BAA', '#DB5D8F', '#B52A61', '#8A1E50',
  '#F9801D', '#EF6B1F', '#C44D1A', '#7F3015',
  '#FFD83D', '#F9C400', '#E09C00', '#AA6F00', '#6B4800',
  '#5EBD78', '#6CC26C', '#3F9D4F', '#2C7236', '#1B4D24',
  '#3AAFD9', '#169C9E', '#3C98D9', '#2C6BA0', '#1C4468',
  '#8E8EFF', '#7B6CD9', '#5C4FA6',
];

// Преобразование data URL → ImageData
function loadImageData(dataUrl: string): Promise<ImageData> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = SHEET_W;
      canvas.height = SHEET_H;
      const ctx = canvas.getContext('2d');
      if (!ctx) return reject(new Error('no ctx'));
      ctx.drawImage(img, 0, 0, SHEET_W, SHEET_H);
      resolve(ctx.getImageData(0, 0, SHEET_W, SHEET_H));
    };
    img.onerror = () => reject(new Error('image load failed'));
    img.src = dataUrl;
  });
}

export function SkinPixelEditor({ open, initialDataUrl, model, onClose, onSave }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const pixelData = useRef<ImageData | null>(null);
  const drawing = useRef(false);

  const [tool, setTool] = useState<Tool>('pen');
  const [color, setColor] = useState('#FFFFFF');
  const [recent, setRecent] = useState<string[]>([]);
  const [zoom, setZoom] = useState(8);
  const [activeRegion, setActiveRegion] = useState<string | null>(null);
  const [hiddenParts, setHiddenParts] = useState<Record<string, boolean>>({});
  const [liveUrl, setLiveUrl] = useState<string | null>(null);
  const [savedModel, setSavedModel] = useState<SkinModel>(model);

  const regionForActive = useMemo(() => {
    if (!activeRegion) return null;
    return REGION_RECTS[activeRegion] ?? null;
  }, [activeRegion]);

  // Инициализация/сброс пикселей
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    const init = async () => {
      let id: ImageData;
      if (initialDataUrl) {
        try { id = await loadImageData(initialDataUrl); }
        catch { id = blankSheet(); }
      } else {
        id = blankSheet();
      }
      if (cancelled) return;
      pixelData.current = id;
      setSavedModel(model);
      renderCanvas();
      // предпросмотр
      const url = dataUrlFromPixels(id);
      setLiveUrl(url);
    };
    init();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, initialDataUrl]);

  function blankSheet(): ImageData {
    const canvas = document.createElement('canvas');
    canvas.width = SHEET_W; canvas.height = SHEET_H;
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(0, 0, SHEET_W, SHEET_H);
    return ctx.getImageData(0, 0, SHEET_W, SHEET_H);
  }

  function dataUrlFromPixels(id: ImageData): string {
    const canvas = document.createElement('canvas');
    canvas.width = SHEET_W; canvas.height = SHEET_H;
    const ctx = canvas.getContext('2d')!;
    ctx.putImageData(id, 0, 0);
    return canvas.toDataURL('image/png');
  }

  function renderCanvas() {
    const canvas = canvasRef.current;
    const id = pixelData.current;
    if (!canvas || !id) return;
    const ctx = canvas.getContext('2d')!;
    const displaySize = SHEET_W * zoom;
    canvas.width = displaySize;
    canvas.height = displaySize;
    ctx.imageSmoothingEnabled = false;
    ctx.clearRect(0, 0, displaySize, displaySize);

    // шахматная подложка для прозрачности
    const checker = 16;
    for (let yy = 0; yy < SHEET_H * zoom; yy += checker * 2) {
      for (let xx = 0; xx < SHEET_W * zoom; xx += checker * 2) {
        ctx.fillStyle = 'rgba(128,128,128,0.18)';
        ctx.fillRect(xx, yy, Math.min(checker, SHEET_W * zoom - xx), Math.min(checker, SHEET_H * zoom - yy));
        if (xx + checker < SHEET_W * zoom) ctx.fillRect(xx + checker, yy + checker, Math.min(checker, SHEET_W * zoom - xx - checker), Math.min(checker, SHEET_H * zoom - yy - checker));
      }
    }

    // Основное изображение (увеличиваем)
    ctx.scale(zoom, zoom);
    ctx.drawImage(makeBitmap(id), 0, 0, SHEET_W, SHEET_H);
    ctx.setTransform(1, 0, 0, 1, 0, 0);

    // Сетка
    ctx.strokeStyle = 'rgba(0,0,0,0.08)';
    ctx.lineWidth = 1;
    for (let i = 0; i <= SHEET_W; i++) {
      ctx.beginPath(); ctx.moveTo(i * zoom, 0); ctx.lineTo(i * zoom, SHEET_H * zoom); ctx.stroke();
    }
    for (let j = 0; j <= SHEET_H; j++) {
      ctx.beginPath(); ctx.moveTo(0, j * zoom); ctx.lineTo(SHEET_W * zoom, j * zoom); ctx.stroke();
    }

    // Подсветка активного региона / скрытых частей
    if (regionForActive) {
      ctx.fillStyle = 'rgba(59,130,246,0.16)';
      ctx.fillRect(regionForActive.x * zoom, regionForActive.y * zoom, regionForActive.w * zoom, regionForActive.h * zoom);
      ctx.strokeStyle = 'rgba(59,130,246,0.9)';
      ctx.lineWidth = 2;
      ctx.strokeRect(regionForActive.x * zoom, regionForActive.y * zoom, regionForActive.w * zoom, regionForActive.h * zoom);
    }
    if (activeRegion && hiddenParts[activeRegion]) {
      ctx.fillStyle = 'rgba(239,68,68,0.16)';
      ctx.fillRect(regionForActive!.x * zoom, regionForActive!.y * zoom, regionForActive!.w * zoom, regionForActive!.h * zoom);
    }
  }

  function makeBitmap(id: ImageData): HTMLCanvasElement {
    const c = document.createElement('canvas');
    c.width = SHEET_W; c.height = SHEET_H;
    c.getContext('2d')!.putImageData(id, 0, 0);
    return c;
  }

  // Рисование
  const setPixel = useCallback((px: number, py: number) => {
    const id = pixelData.current;
    if (!id) return;
    const x = Math.floor(px); const y = Math.floor(py);
    if (x < 0 || y < 0 || x >= SHEET_W || y >= SHEET_H) return;
    const idx = (y * SHEET_W + x) * 4;
    if (tool === 'eraser') {
      id.data[idx + 3] = 0;
    } else {
      const r = parseInt(color.slice(1, 3), 16);
      const g = parseInt(color.slice(3, 5), 16);
      const b = parseInt(color.slice(5, 7), 16);
      id.data[idx] = r; id.data[idx + 1] = g; id.data[idx + 2] = b; id.data[idx + 3] = 255;
      if (!recent.includes(color)) {
        const upd = [color, ...recent.filter(c => c !== color)].slice(0, 12);
        setRecent(upd);
      }
    }
    pushHistory();
    renderCanvas();
  }, [tool, color, recent, zoom, activeRegion, hiddenParts]);

  // Заливка (flood fill)
  const floodFill = useCallback((sx: number, sy: number) => {
    const id = pixelData.current;
    if (!id) return;
    const x = Math.floor(sx); const y = Math.floor(sy);
    if (x < 0 || y < 0 || x >= SHEET_W || y >= SHEET_H) return;
    const idx = (y * SHEET_W + x) * 4;
    const targetR = id.data[idx], targetG = id.data[idx + 1], targetB = id.data[idx + 2], targetA = id.data[idx + 3];
    const r = parseInt(color.slice(1, 3), 16), g = parseInt(color.slice(3, 5), 16), b = parseInt(color.slice(5, 7), 16);
    if (targetA === 255 && targetR === r && targetG === g && targetB === b) return;
    const stack: [number, number][] = [[x, y]];
    const visited = new Set<number>();
    while (stack.length) {
      const [cx, cy] = stack.pop()!;
      const ci = (cy * SHEET_W + cx) * 4;
      if (visited.has(ci)) continue;
      visited.add(ci);
      if (id.data[ci + 3] !== targetA || id.data[ci] !== targetR || id.data[ci + 1] !== targetG || id.data[ci + 2] !== targetB) continue;
      id.data[ci] = r; id.data[ci + 1] = g; id.data[ci + 2] = b; id.data[ci + 3] = 255;
      if (cx > 0) stack.push([cx - 1, cy]);
      if (cx < SHEET_W - 1) stack.push([cx + 1, cy]);
      if (cy > 0) stack.push([cx, cy - 1]);
      if (cy < SHEET_H - 1) stack.push([cx, cy + 1]);
    }
    pushHistory();
    renderCanvas();
  }, [color]);

  // История (undo)
  const history = useRef<ImageData[]>([]);
  const historyPos = useRef(-1);
  const pushHistory = () => {
    if (!pixelData.current) return;
    const copy = pixelData.current;
    const snap = new ImageData(new Uint8ClampedArray(copy.data), copy.width, copy.height);
    history.current = history.current.slice(0, historyPos.current + 1);
    history.current.push(snap);
    historyPos.current++;
    if (history.current.length > 40) history.current.shift(), historyPos.current--;
  };
  const undo = () => {
    if (historyPos.current > 0) {
      historyPos.current--;
      pixelData.current = history.current[historyPos.current];
      renderCanvas();
    }
  };

  const getPixelColor = (px: number, py: number) => {
    const id = pixelData.current; if (!id) return;
    const x = Math.floor(px), y = Math.floor(py);
    if (x < 0 || y < 0 || x >= SHEET_W || y >= SHEET_H) return;
    const idx = (y * SHEET_W + x) * 4;
    if (id.data[idx + 3] === 0) return '#000000';
    const toHex = (v: number) => v.toString(16).padStart(2, '0');
    return `#${toHex(id.data[idx])}${toHex(id.data[idx + 1])}${toHex(id.data[idx + 2])}`;
  };

  // Обновление живого предпросмотра
  const refreshLive = () => {
    if (pixelData.current) setLiveUrl(dataUrlFromPixels(pixelData.current));
  };

  const save = () => {
    if (pixelData.current) onSave(dataUrlFromPixels(pixelData.current));
  };

  const mousePos = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current!;
    const rect = canvas.getBoundingClientRect();
    const px = Math.floor((e.clientX - rect.left) / rect.width * SHEET_W);
    const py = Math.floor((e.clientY - rect.top) / rect.height * SHEET_H);
    return [px, py];
  };

  const onPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    e.preventDefault();
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    drawing.current = true;
    const [x, y] = mousePos(e);
    if (tool === 'picker') { const c = getPixelColor(x, y); if (c) setColor(c); }
    else if (tool === 'fill') floodFill(x, y);
    else setPixel(x, y);
  };
  const onPointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!drawing.current || tool === 'picker' || tool === 'fill') return;
    const [x, y] = mousePos(e);
    setPixel(x, y);
  };
  const onPointerUp = () => { drawing.current = false; refreshLive(); };
  const onPointerLeave = () => { drawing.current = false; };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center" style={{ background: 'rgba(0,0,0,0.55)', backdropFilter: 'blur(4px)' }}>
      <motion.div
        initial={{ opacity: 0, scale: 0.96, y: 8 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.96, y: 8 }}
        className="flex h-[90vh] w-[95vw] max-w-[1200px] flex-col overflow-hidden"
        style={{ borderRadius: 'var(--radius-modal, 24px)', background: 'var(--color-surface)', border: '1px solid var(--color-border)', boxShadow: 'var(--shadow-lg, 0 20px 60px rgba(0,0,0,0.4))' }}
      >
        {/* Заголовок */}
        <div className="flex shrink-0 items-center gap-3 px-5 py-3" style={{ borderBottom: '1px solid var(--color-border)' }}>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-bold" style={{ color: 'var(--color-text)' }}>Редактор скина</p>
            <p className="text-[11px]" style={{ color: 'var(--color-text-secondary)' }}>{model === 'slim' ? 'Slim' : 'Classic'} · 64×64 · щелчок — пиксель, заливка и пипетка справа</p>
          </div>
          <div className="flex items-center gap-1.5">
            <button onClick={undo} title="Отменить" className="flex h-8 w-8 items-center justify-center" style={{ borderRadius: 8, background: 'var(--color-surface-2)', color: 'var(--color-text)', border: '1px solid var(--color-border)' }}><RotateCcw className="h-4 w-4" /></button>
            <button onClick={onClose} title="Закрыть" className="flex h-8 w-8 items-center justify-center" style={{ borderRadius: 8, background: 'var(--color-surface-2)', color: 'var(--color-text-secondary)', border: '1px solid var(--color-border)' }}><X className="h-4 w-4" /></button>
          </div>
        </div>

        <div className="grid min-h-0 flex-1 grid-cols-1 gap-0 lg:grid-cols-[280px_1fr_260px]">
          {/* Левая: инструменты + палитра */}
          <div className="flex min-h-0 flex-col gap-4 overflow-y-auto p-4" style={{ borderRight: '1px solid var(--color-border)' }}>
            {/* Инструменты */}
            <div>
              <p className="mb-2 text-[10px] font-bold uppercase tracking-wide" style={{ color: 'var(--color-text-tertiary)' }}>Инструменты</p>
              <div className="grid grid-cols-4 gap-1.5">
                {([
                  { id: 'pen' as Tool, icon: <Pencil className="h-4 w-4" />, label: 'Карандаш' },
                  { id: 'eraser' as Tool, icon: <Eraser className="h-4 w-4" />, label: 'Стёрка' },
                  { id: 'picker' as Tool, icon: <Pipette className="h-4 w-4" />, label: 'Пипетка' },
                  { id: 'fill' as Tool, icon: <PaintBucket className="h-4 w-4" />, label: 'Заливка' },
                ]).map(t => (
                  <button key={t.id} onClick={() => setTool(t.id)} title={t.label}
                    className="flex flex-col items-center gap-1 rounded-xl py-2"
                    style={{ background: tool === t.id ? 'var(--color-primary)' : 'var(--color-surface-2)', color: tool === t.id ? 'var(--color-primary-text)' : 'var(--color-text)', border: `1px solid ${tool === t.id ? 'var(--color-primary)' : 'var(--color-border)'}` }}>
                    {t.icon}
                    <span className="text-[8px] font-semibold">{t.label}</span>
                  </button>
                ))}
              </div>
              <div className="mt-3 flex items-center gap-2">
                <label className="text-[10px] font-semibold" style={{ color: 'var(--color-text-secondary)' }}>Лупа</label>
                <input type="range" min={4} max={16} step={1} value={zoom} onChange={e => setZoom(Number(e.target.value))} className="flex-1" style={{ accentColor: 'var(--color-primary)' }} />
                <span className="w-8 text-right text-[10px]" style={{ color: 'var(--color-text-secondary)' }}>×{zoom}</span>
              </div>
            </div>

            {/* Палитра */}
            <div>
              <p className="mb-2 text-[10px] font-bold uppercase tracking-wide" style={{ color: 'var(--color-text-tertiary)' }}>Палитра</p>
              <div className="grid grid-cols-8 gap-1">
                {PRESET_COLORS.map(c => (
                  <button key={c} onClick={() => setColor(c)} title={c}
                    className="h-6 w-full rounded-md"
                    style={{ background: c, border: color === c ? '2px solid var(--color-primary)' : '1px solid rgba(0,0,0,0.15)', boxShadow: 'inset 0 0 0 1px rgba(255,255,255,0.2)' }} />
                ))}
              </div>
              <div className="mt-3 flex items-center gap-2">
                <input type="color" value={color} onChange={e => { setColor(e.target.value); }} className="h-9 w-12 shrink-0 cursor-pointer rounded-lg" style={{ background: 'transparent', border: '1px solid var(--color-border)' }} />
                <div className="flex h-9 flex-1 items-center gap-2 rounded-lg px-2" style={{ background: 'var(--color-surface-2)', border: '1px solid var(--color-border)' }}>
                  <span className="h-4 w-4 shrink-0 rounded" style={{ background: color }} />
                  <span className="text-[11px] font-mono" style={{ color: 'var(--color-text)' }}>{color}</span>
                </div>
              </div>
              {recent.length > 0 && (
                <div className="mt-3">
                  <p className="mb-1 text-[9px] font-bold uppercase tracking-wide" style={{ color: 'var(--color-text-tertiary)' }}>Недавние</p>
                  <div className="flex flex-wrap gap-1">
                    {recent.map(c => (
                      <button key={c} onClick={() => setColor(c)} className="h-5 w-5 rounded" style={{ background: c, border: color === c ? '2px solid var(--color-primary)' : '1px solid rgba(0,0,0,0.15)' }} />
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Центр: холст */}
          <div className="flex min-h-0 flex-col items-center justify-center gap-3 overflow-auto p-4">
            <canvas
              ref={canvasRef}
              className="max-h-full max-w-full cursor-crosshair"
              style={{ imageRendering: 'pixelated', aspectRatio: '1/1', touchAction: 'none', maxWidth: 'min(100%, 56vh)', maxHeight: '56vh' }}
              onPointerDown={onPointerDown}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerUp}
              onPointerLeave={onPointerLeave}
            />
            <p className="text-[10px]" style={{ color: 'var(--color-text-tertiary)' }}>Лист 64×64 · режим: {toolLabel(tool)}</p>
          </div>

          {/* Право: части тела + предпросмотр */}
          <div className="flex min-h-0 flex-col gap-4 overflow-y-auto p-4" style={{ borderLeft: '1px solid var(--color-border)' }}>
            <div>
              <p className="mb-2 text-[10px] font-bold uppercase tracking-wide" style={{ color: 'var(--color-text-tertiary)' }}>Части тела · Body</p>
              <div className="grid grid-cols-2 gap-1.5">
                {BODY_REGIONS.map(region => {
                  const hidden = hiddenParts[region.id];
                  const active = activeRegion === region.id;
                  return (
                    <button key={region.id} onClick={() => setActiveRegion(active ? null : region.id)}
                      className="flex items-center justify-between gap-1 rounded-lg px-2 py-1.5 text-left"
                      style={{ background: active ? 'var(--color-primary-dim)' : 'var(--color-surface-2)', border: `1px solid ${active ? 'var(--color-primary)' : 'var(--color-border)'}`, color: 'var(--color-text)' }}>
                      <span className="truncate text-[10px] font-semibold">{region.label}</span>
                      <span onClick={(e) => { e.stopPropagation(); setHiddenParts(prev => ({ ...prev, [region.id]: !prev[region.id] })); }}
                        className="flex h-4 w-4 shrink-0 items-center justify-center rounded" style={{ color: hidden ? 'var(--color-error)' : 'var(--color-text-secondary)', opacity: hidden ? 1 : 0.5 }} title={hidden ? 'Показать' : 'Скрыть'}>
                        {hidden ? <EyeOff className="h-3 w-3" /> : <Eye className="h-3 w-3" />}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Предпросмотр */}
            <div className="min-h-0">
              <p className="mb-2 text-[10px] font-bold uppercase tracking-wide" style={{ color: 'var(--color-text-tertiary)' }}>Предпросмотр</p>
              <div className="overflow-hidden rounded-2xl" style={{ background: 'radial-gradient(ellipse at 50% 15%, var(--color-surface-2) 0%, var(--color-bg) 100%)', border: '1px solid var(--color-border)' }}>
                <SkinStand3D key={liveUrl ?? 'blank'} skinUrl={liveUrl ?? ''} model={savedModel} height={230} cameraDistance={54} interactive autoRotate={false}
                  hiddenParts={Object.keys(hiddenParts).filter(k => hiddenParts[k])} />
              </div>
              <button onClick={() => setSavedModel(savedModel === 'slim' ? 'classic' : 'slim')}
                className="mt-2 w-full rounded-xl px-3 py-2 text-[11px] font-bold"
                style={{ background: 'var(--color-surface-2)', color: 'var(--color-text)', border: '1px solid var(--color-border)' }}>
                Тип тела: {savedModel === 'slim' ? 'Slim' : 'Classic'}
              </button>
            </div>
          </div>
        </div>

        {/* Нижняя панель: сохранить */}
        <div className="flex shrink-0 items-center justify-end gap-2 px-5 py-3" style={{ borderTop: '1px solid var(--color-border)' }}>
          <button onClick={onClose} className="rounded-xl px-4 py-2 text-sm font-bold" style={{ background: 'var(--color-surface-2)', color: 'var(--color-text-secondary)', border: '1px solid var(--color-border)' }}>Отмена</button>
          <button onClick={save} className="flex items-center gap-2 rounded-xl px-5 py-2 text-sm font-bold" style={{ background: 'var(--color-primary)', color: 'var(--color-primary-text)' }}>
            <Save className="h-4 w-4" />Сохранить скин
          </button>
        </div>
      </motion.div>
    </div>
  );
}

function toolLabel(tool: Tool) {
  switch (tool) {
    case 'pen': return 'карандаш';
    case 'eraser': return 'стёрка';
    case 'picker': return 'пипетка';
    case 'fill': return 'заливка';
  }
}

export default SkinPixelEditor;

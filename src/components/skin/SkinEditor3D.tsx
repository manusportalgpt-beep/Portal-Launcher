import { useEffect, useRef, useState, useCallback } from 'react';
import * as THREE from 'three';

/**
 * Inline 3D skin editor: renders the same Minecraft model as SkinStand3D
 * but with a Raycaster that lets you paint pixels directly on the model.
 * Returns edited 64×64 ImageData via a ref callback.
 */

type SkinModel = 'classic' | 'slim';
type BufferGeometry = any;
type Texture = any;
type Mesh = any;
type Material = any;
type Object3D = any;
const TEX_W = 64;
const TEX_H = 64;

function applyBoxUv(
  geo: BufferGeometry,
  x: number, y: number, w: number, h: number, d: number,
  textureWidth = TEX_W, textureHeight = TEX_H,
) {
  const face = (x1: number, y1: number, x2: number, y2: number) => [
    [x1 / textureWidth, 1 - y2 / textureHeight],
    [x2 / textureWidth, 1 - y2 / textureHeight],
    [x2 / textureWidth, 1 - y1 / textureHeight],
    [x1 / textureWidth, 1 - y1 / textureHeight],
  ];
  const top    = face(x + d, y,     x + w + d, y + d);
  const bottom = face(x + w + d, y, x + w * 2 + d, y + d);
  const left   = face(x,     y + d, x + d,     y + d + h);
  const front  = face(x + d, y + d, x + w + d, y + d + h);
  const right  = face(x + w + d, y + d, x + w + d * 2, y + h + d);
  const back   = face(x + w + d * 2, y + d, x + w * 2 + d * 2, y + h + d);
  const ordered = [
    [right[3], right[2], right[0], right[1]],
    [left[3],  left[2],  left[0],  left[1]],
    [top[3],   top[2],   top[0],   top[1]],
    [bottom[0], bottom[1], bottom[3], bottom[2]],
    [front[3], front[2], front[0], front[1]],
    [back[3],  back[2],  back[0],  back[1]],
  ];
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(ordered.flat(2), 2));
}

function boxPart(size: [number, number, number], uv: [number, number], inflate = 0): BufferGeometry {
  const [w, h, d] = size;
  const geo = new THREE.BoxGeometry(w + inflate, h + inflate, d + inflate);
  applyBoxUv(geo, uv[0], uv[1], w, h, d);
  return geo;
}

interface Props {
  skinUrl: string | null;
  model: SkinModel;
  color: string;          // active drawing color "#rrggbb"
  tool: string;
  height?: number;
  pixelData: ImageData;   // current 64×64 pixel data
  /** Called after a pixel is painted so parent can refresh canvas/preview. */
  onPaint: (x: number, y: number, color: string | null) => void;
}

export function SkinEditor3D({ skinUrl, model, color, tool, height = 360, pixelData, onPaint }: Props) {
  const hostRef = useRef<HTMLDivElement>(null);
  const stateRef = useRef<any>(null);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(34, 1, 0.1, 100);
    camera.position.set(0, 0, 60);
    const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    host.appendChild(renderer.domElement);
    renderer.domElement.style.width = '100%';
    renderer.domElement.style.height = '100%';
    renderer.domElement.style.cursor = 'crosshair';
    renderer.domElement.style.touchAction = 'none';
    renderer.domElement.style.display = 'block';

    scene.add(new THREE.HemisphereLight(0xffffff, 0x101521, 1.7));
    const key = new THREE.DirectionalLight(0xffffff, 2.0);
    key.position.set(-5, 28, 22);
    scene.add(key);

    const player = new THREE.Group();
    scene.add(player);

    const meshes: Mesh[] = [];

    const solid = () => new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.6, metalness: 0 });
    const layerMat = () => new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.6, metalness: 0, transparent: true, alphaTest: 0.02, side: THREE.DoubleSide, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 });

    const add = (geo: BufferGeometry, mat: Material, pos: [number, number, number], parent: Object3D) => {
      const mesh = new THREE.Mesh(geo, mat) as any;
      mesh.position.set(...pos);
      mesh.userData.isSkinPart = true;
      parent.add(mesh);
      meshes.push(mesh);
      return mesh;
    };

    const armW = model === 'slim' ? 3 : 4;
    const head = new THREE.Group();
    head.position.set(0, 12, 0);
    player.add(head);
    add(boxPart([8, 8, 8], [0, 0]), solid(), [0, 0, 0], head);
    add(boxPart([8, 8, 8], [32, 0], 0.8), layerMat(), [0, 0, 0], head);

    add(boxPart([8, 12, 4], [16, 16]), solid(), [0, 2, 0], player);
    add(boxPart([8, 12, 4], [16, 32], 0.8), layerMat(), [0, 2, 0], player);

    const mkArm = (side: 'left' | 'right') => {
      const pivot = new THREE.Group();
      pivot.position.set(side === 'right' ? -(4 + armW / 2) : 4 + armW / 2, 8, 0);
      player.add(pivot);
      const uv: [number, number] = side === 'right' ? [40, 16] : [32, 48];
      const uvO: [number, number] = side === 'right' ? [40, 32] : [48, 48];
      add(boxPart([armW, 12, 4], uv), solid(), [0, -6, 0], pivot);
      add(boxPart([armW, 12, 4], uvO, 0.8), layerMat(), [0, -6, 0], pivot);
      return pivot;
    };
    mkArm('right'); mkArm('left');

    const mkLeg = (side: 'left' | 'right') => {
      const pivot = new THREE.Group();
      pivot.position.set(side === 'right' ? -2 : 2, -4, 0);
      player.add(pivot);
      const uv: [number, number] = side === 'right' ? [0, 16] : [16, 48];
      const uvO: [number, number] = side === 'right' ? [0, 32] : [0, 48];
      add(boxPart([4, 12, 4], uv), solid(), [0, -6, 0], pivot);
      add(boxPart([4, 12, 4], uvO, 0.8), layerMat(), [0, -6, 0], pivot);
      return pivot;
    };
    mkLeg('right'); mkLeg('left');

    player.scale.setScalar(model === 'slim' ? 1.02 : 1);

    // Texture loader — paint vertex colors from pixelData
    const loader = new THREE.TextureLoader();
    loader.setCrossOrigin('anonymous');
    let tex: Texture | null = null;

    const updateTexture = () => {
      const canvas = document.createElement('canvas');
      canvas.width = TEX_W; canvas.height = TEX_H;
      const ctx = canvas.getContext('2d')!;
      ctx.putImageData(pixelData, 0, 0);
      if (tex) tex.dispose();
      tex = new THREE.CanvasTexture(canvas);
      tex.magFilter = THREE.NearestFilter;
      tex.minFilter = THREE.NearestFilter;
      tex.generateMipmaps = false;
      (tex as any).colorSpace = (THREE as any).SRGBColorSpace ?? undefined;
      meshes.forEach(m => {
        (m.material as any).map = tex;
        (m.material as any).needsUpdate = true;
      });
    };
    updateTexture();

    // Raycaster
    const raycaster = new THREE.Raycaster();
    const pointer = new THREE.Vector2();

    const getUV = (e: PointerEvent): { px: number; py: number } | null => {
      const rect = renderer.domElement.getBoundingClientRect();
      pointer.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      pointer.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
      raycaster.setFromCamera(pointer, camera);
      const hits = raycaster.intersectObjects(meshes, false);
      if (!hits.length) return null;
      const hit = hits[0];
      const uv = hit.uv;
      if (!uv) return null;
      // Map UV → pixel coords
      // Each face has its own UV box within the 64×64 sheet.
      // We need the face index to know which box, but we can reconstruct from UV + hit.faceIndex.
      const faceIdx = (hit as any).face?.materialIndex ?? (hit as any).faceIndex ?? 0;
      // The geometry's UV array tells us the exact box; we decode from UV coordinates.
      // UV is in [0,1] per face — but our custom UV maps UV to actual sheet coords.
      // So: px = uv.x * TEX_W, py = (1 - uv.y) * TEX_H
      const px = Math.floor(uv.x * TEX_W);
      const py = Math.floor((1 - uv.y) * TEX_H);
      if (px < 0 || py < 0 || px >= TEX_W || py >= TEX_H) return null;
      return { px, py };
    };

    let isDragPainting = false;
    const onDown = (e: any) => {
      (e.target as HTMLElement).setPointerCapture(e.pointerId);
      isDragPainting = true;
      const uv = getUV(e);
      if (!uv) return;
      if (tool === 'eraser') onPaint(uv.px, uv.py, null);
      else onPaint(uv.px, uv.py, color);
    };
    const onMove = (e: any) => {
      if (!isDragPainting) return;
      const uv = getUV(e);
      if (!uv) return;
      if (tool === 'eraser') onPaint(uv.px, uv.py, null);
      else onPaint(uv.px, uv.py, color);
    };
    const onUp = () => { isDragPainting = false; };

    renderer.domElement.addEventListener('pointerdown', onDown);
    renderer.domElement.addEventListener('pointermove', onMove);
    renderer.domElement.addEventListener('pointerup', onUp);

    // Rotation
    let yaw = 0.5, pitch = 0;
    let dragging = false, lastX = 0, lastY = 0;
    const rotDown = (e: PointerEvent) => {
      if (e.button === 2 || e.ctrlKey) {
        dragging = true; lastX = e.clientX; lastY = e.clientY;
        renderer.domElement.style.cursor = 'grabbing';
      }
    };
    const rotMove = (e: PointerEvent) => {
      if (!dragging) return;
      yaw += (e.clientX - lastX) * 0.01;
      pitch = Math.max(-0.6, Math.min(0.6, pitch + (e.clientY - lastY) * 0.006));
      lastX = e.clientX; lastY = e.clientY;
    };
    const rotUp = () => { dragging = false; renderer.domElement.style.cursor = 'crosshair'; };
    renderer.domElement.addEventListener('pointerdown', rotDown);
    renderer.domElement.addEventListener('pointermove', rotMove);
    renderer.domElement.addEventListener('pointerup', rotUp);
    renderer.domElement.addEventListener('contextmenu', (e: any) => e.preventDefault());

    // Auto-rotate slowly when not interacting
    let autoRotate = true;
    renderer.domElement.addEventListener('pointerdown', () => { autoRotate = false; });

    // Resize
    const resize = () => {
      const w = host.clientWidth || 300;
      const h = host.clientHeight || height;
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(host);

    // Render loop
    let raf = 0;
    const loop = () => {
      raf = requestAnimationFrame(loop);
      if (autoRotate) yaw += 0.003;
      player.rotation.y = yaw;
      player.rotation.x = pitch;
      renderer.render(scene, camera);
    };
    raf = requestAnimationFrame(loop);

    stateRef.current = { updateTexture, meshes };

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      renderer.domElement.removeEventListener('pointerdown', onDown);
      renderer.domElement.removeEventListener('pointermove', onMove);
      renderer.domElement.removeEventListener('pointerup', onUp);
      renderer.domElement.removeEventListener('pointerdown', rotDown);
      renderer.domElement.removeEventListener('pointermove', rotMove);
      renderer.domElement.removeEventListener('pointerup', rotUp);
      host.removeChild(renderer.domElement);
      renderer.dispose();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [skinUrl, model, color, tool]);

  // Update texture when pixelData changes externally
  useEffect(() => {
    stateRef.current?.updateTexture();
  }, [pixelData]);

  return (
    <div
      ref={hostRef}
      style={{ width: '100%', height, touchAction: 'none', borderRadius: 16, overflow: 'hidden' }}
      aria-label="3D skin pixel editor"
    />
  );
}

export default SkinEditor3D;

import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { useThemeStore } from '@/stores/themeStore';
// Локальные псевдонимы: пакет three в этом проекте не отдаёт свои .d.ts,
// поэтому объявляем минимальные типы вручную.
type BufferGeometry = any;
type Texture = any;
type Mesh = any;
type Material = any;
type Object3D = any;

/**
 * 3D-стенд со скином Minecraft: геометрия 64×64, classic/slim руки,
 * второй слой и плащ 64×32. Стенд сохраняет одну спокойную стойку и поддерживает вращение.
 */

export type SkinModel = 'classic' | 'slim';

interface Props {
  /** URL или data:-URL PNG-скина (64×64 или 64×32) */
  skinUrl: string;
  /** URL плаща 64×32 */
  capeUrl?: string | null;
  model: SkinModel;
  className?: string;
  /** Показывать шляпу/overlay-слой */
  overlay?: boolean;
  height?: number;
  /** Начальный угол поворота модели: 0 — лицо, PI — спина/плащ. */
  initialYaw?: number;
  /** Разрешить перетаскивание стенда мышью. */
  interactive?: boolean;
  /** Автоматически вращать модель, например в мини-превью. */
  autoRotate?: boolean;
  /** Базовая дистанция камеры для больших стендов. */
  cameraDistance?: number;
  /** Сохраняется для совместимости существующих вызовов; отдельная анимация применения отключена. */
  applySequence?: number;
  /** Голова модели плавно следует за курсором внутри стенда. */
  trackCursor?: boolean;
}

const TEX_W = 64;
const TEX_H = 64;

/**
 * Назначает UV для BoxGeometry в формате skin sheet Minecraft.
 * У BoxGeometry порядок вершин граней не совпадает с визуальным обходом
 * прямоугольника; простая последовательность углов переворачивает часть
 * лица, overlay-слой и плащ. Этот порядок совпадает с Three.js и skinview3d.
 */
function applyBoxUv(
  geo: BufferGeometry,
  x: number,
  y: number,
  w: number,
  h: number,
  d: number,
  textureWidth = TEX_W,
  textureHeight = TEX_H,
) {
  const face = (x1: number, y1: number, x2: number, y2: number) => [
    [x1 / textureWidth, 1 - y2 / textureHeight],
    [x2 / textureWidth, 1 - y2 / textureHeight],
    [x2 / textureWidth, 1 - y1 / textureHeight],
    [x1 / textureWidth, 1 - y1 / textureHeight],
  ];

  const top = face(x + d, y, x + w + d, y + d);
  const bottom = face(x + w + d, y, x + w * 2 + d, y + d);
  const left = face(x, y + d, x + d, y + d + h);
  const front = face(x + d, y + d, x + w + d, y + d + h);
  const right = face(x + w + d, y + d, x + w + d * 2, y + h + d);
  const back = face(x + w + d * 2, y + d, x + w * 2 + d * 2, y + h + d);

  // Строгий порядок сторон BoxGeometry: +X, -X, +Y, -Y, +Z, -Z.
  const ordered = [
    [right[3], right[2], right[0], right[1]],
    [left[3], left[2], left[0], left[1]],
    [top[3], top[2], top[0], top[1]],
    [bottom[0], bottom[1], bottom[3], bottom[2]],
    [front[3], front[2], front[0], front[1]],
    [back[3], back[2], back[0], back[1]],
  ];
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(ordered.flat(2), 2));
}

function boxPart(
  size: [number, number, number],
  uv: [number, number],
  inflate = 0,
): BufferGeometry {
  const [w, h, d] = size;
  const geo = new THREE.BoxGeometry(w + inflate, h + inflate, d + inflate);
  applyBoxUv(geo, uv[0], uv[1], w, h, d);
  return geo;
}

export function SkinStand3D({
  skinUrl,
  capeUrl,
  model,
  className,
  overlay = true,
  height = 380,
  initialYaw = 0.5,
  interactive = true,
  autoRotate = false,
  cameraDistance = 60,
  applySequence = 0,
  trackCursor = false,
}: Props) {
  const hostRef = useRef<HTMLDivElement>(null);
  const stateRef = useRef<any>(null);
  const themeId = useThemeStore(state => state.themeId);

  // Инициализация сцены — один раз на монтирование или смену базовых параметров.
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(34, 1, 0.1, 100);
    camera.position.set(0, 0, cameraDistance);

    const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    host.appendChild(renderer.domElement);
    renderer.domElement.style.width = '100%';
    renderer.domElement.style.height = '100%';
    renderer.domElement.style.cursor = interactive ? 'grab' : 'default';
    renderer.domElement.style.pointerEvents = interactive || trackCursor ? 'auto' : 'none';
    renderer.domElement.style.display = 'block';

    scene.add(new THREE.HemisphereLight(0xffffff, 0x101521, 1.7));
    const key = new THREE.DirectionalLight(0xffffff, 2.0);
    key.position.set(-5, 28, 22);
    scene.add(key);
    const topGlow = new THREE.PointLight(0xffffff, 0.95, 70, 2);
    topGlow.position.set(0, 26, 10);
    scene.add(topGlow);

    const player = new THREE.Group();
    scene.add(player);

    const shadow = new THREE.Mesh(
      new THREE.CircleGeometry(10.8, 48),
      new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.25, depthWrite: false }),
    );
    shadow.rotation.x = -Math.PI / 2;
    shadow.scale.set(1.36, 0.58, 1);
    shadow.position.set(0, -16.2, -0.5);
    scene.add(shadow);
    const st: any = { scene, camera, renderer, player, shadow, yaw: initialYaw, pitch: 0, zoom: cameraDistance, drag: null, raf: 0, meshes: [], meshMaterials: [], headTargetYaw: 0, headTargetPitch: 0, bodyTargetYaw: 0, bodyTargetPitch: 0, bodyFollowYaw: 0, bodyFollowPitch: 0, legs: null };
    stateRef.current = st;

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

    const onDown = (e: PointerEvent) => {
      st.drag = { x: e.clientX, y: e.clientY };
      renderer.domElement.style.cursor = 'grabbing';
    };
    const onMove = (e: PointerEvent) => {
      if (trackCursor) {
        const rect = renderer.domElement.getBoundingClientRect();
        const nx = Math.max(-1, Math.min(1, ((e.clientX - rect.left) / Math.max(rect.width, 1) - 0.5) * 2));
        const ny = Math.max(-1, Math.min(1, ((e.clientY - rect.top) / Math.max(rect.height, 1) - 0.5) * 2));
        // Three.js positive X rotation turns the face down for this model;
        // map screen Y directly so top looks up and bottom looks down.
        st.headTargetYaw = nx * 0.38;
        st.headTargetPitch = ny * 0.22;
        st.bodyTargetYaw = nx * 0.058;
        st.bodyTargetPitch = ny * 0.018;
      }
      if (!st.drag) return;
      st.yaw += (e.clientX - st.drag.x) * 0.01;
      st.pitch = Math.max(-0.6, Math.min(0.6, st.pitch + (e.clientY - st.drag.y) * 0.006));
      st.drag = { x: e.clientX, y: e.clientY };
    };
    const onUp = () => {
      st.drag = null;
      renderer.domElement.style.cursor = 'grab';
    };
    const onLeave = () => {
      st.headTargetYaw = 0;
      st.headTargetPitch = 0;
      st.bodyTargetYaw = 0;
      st.bodyTargetPitch = 0;
    };
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      st.zoom = Math.max(38, Math.min(96, st.zoom + e.deltaY * 0.045));
      camera.position.z = st.zoom;
    };
    if (interactive || trackCursor) {
      renderer.domElement.addEventListener('pointermove', onMove);
      renderer.domElement.addEventListener('pointerleave', onLeave);
    }
    if (interactive) {
      renderer.domElement.addEventListener('pointerdown', onDown);
      window.addEventListener('pointerup', onUp);
      renderer.domElement.addEventListener('wheel', onWheel, { passive:false });
    }

    let lastFrame = performance.now();
    const loop = () => {
      st.raf = requestAnimationFrame(loop);
      const now = performance.now();
      const deltaSeconds = Math.min(0.05, (now - lastFrame) / 1000);
      lastFrame = now;
      if (autoRotate && !st.drag) st.yaw += 0.0035;
      const bodyFollow = 1 - Math.exp(-deltaSeconds * (trackCursor ? 8 : 10));
      st.bodyFollowYaw += ((trackCursor ? st.bodyTargetYaw : 0) - st.bodyFollowYaw) * bodyFollow;
      st.bodyFollowPitch += ((trackCursor ? st.bodyTargetPitch : 0) - st.bodyFollowPitch) * bodyFollow;
      player.rotation.y = st.yaw + st.bodyFollowYaw;
      player.rotation.x = st.pitch + st.bodyFollowPitch;
      if (st.head) {
        const follow = 1 - Math.exp(-deltaSeconds * (trackCursor ? 12 : 10));
        st.head.rotation.y += ((trackCursor ? st.headTargetYaw : 0) - st.head.rotation.y) * follow;
        st.head.rotation.x += ((trackCursor ? st.headTargetPitch : 0) - st.head.rotation.x) * follow;
      }
      player.position.y = 0;
      player.rotation.z = 0;
      if (st.arms) {
        st.arms.left.rotation.set(0, 0, 0);
        st.arms.right.rotation.set(0, 0, 0);
      }
      if (st.legs) {
        st.legs.left.rotation.x = 0;
        st.legs.right.rotation.x = 0;
      }
      if (st.cape) {
        st.cape.rotation.x = 0.18;
        st.cape.rotation.z = 0;
      }
      renderer.render(scene, camera);
    };
    loop();

    return () => {
      cancelAnimationFrame(st.raf);
      ro.disconnect();
      if (interactive || trackCursor) {
        renderer.domElement.removeEventListener('pointermove', onMove);
        renderer.domElement.removeEventListener('pointerleave', onLeave);
      }
      if (interactive) {
        renderer.domElement.removeEventListener('pointerdown', onDown);
        window.removeEventListener('pointerup', onUp);
        renderer.domElement.removeEventListener('wheel', onWheel);
      }
      st.meshes.forEach((m: Mesh) => {
        m.geometry.dispose();
        (m.material as Material).dispose();
      });
      st.tex?.dispose?.();
      st.capeTex?.dispose?.();
      st.shadow?.geometry?.dispose?.();
      st.shadow?.material?.dispose?.();
      renderer.dispose();
      host.removeChild(renderer.domElement);
      stateRef.current = null;
    };
  }, [height, initialYaw, interactive, autoRotate, cameraDistance, trackCursor]);

  // Перестройка модели: смена скина, типа тела или плаща.
  useEffect(() => {
    const st = stateRef.current;
    if (!st) return;

    let cancelled = false;
    const loader = new THREE.TextureLoader();
    loader.setCrossOrigin('anonymous');

    const build = (tex: Texture, capeTex: Texture | null) => {
      if (cancelled) return;
      tex.magFilter = THREE.NearestFilter;
      tex.minFilter = THREE.NearestFilter;
      tex.generateMipmaps = false;
      (tex as any).colorSpace = (THREE as any).SRGBColorSpace ?? undefined;

      // Очистка предыдущей модели
      st.player.clear();
      st.meshes.forEach((m: Mesh) => {
        m.geometry.dispose();
        (m.material as Material).dispose();
      });
      st.meshes = [];
      st.meshMaterials = [];
      st.tex?.dispose?.();
      st.tex = tex;

      const solid = () => new THREE.MeshStandardMaterial({ map: tex, roughness: 0.58, metalness: 0 });
      const layer = () => new THREE.MeshStandardMaterial({
        map: tex,
        roughness: 0.58,
        metalness: 0,
        transparent: true,
        alphaTest: 0.02,
        side: THREE.DoubleSide,
        polygonOffset: true,
        polygonOffsetFactor: -2,
        polygonOffsetUnits: -2,
      });

      const add = (geo: BufferGeometry, mat: Material, pos: [number, number, number], parent: Object3D) => {
        const mesh = new THREE.Mesh(geo, mat);
        mesh.position.set(...pos);
        parent.add(mesh);
        st.meshes.push(mesh);
        st.meshMaterials.push(mat);
        return mesh;
      };

      const armW = model === 'slim' ? 3 : 4;
      const slim = model === 'slim';

      // Голова
      const head = new THREE.Group();
      head.position.set(0, 12, 0);
      st.player.add(head);
      st.head = head;
      add(boxPart([8, 8, 8], [0, 0]), solid(), [0, 0, 0], head);
      if (overlay) add(boxPart([8, 8, 8], [32, 0], 0.6), layer(), [0, 0, 0], head);

      // Тело
      add(boxPart([8, 12, 4], [16, 16]), solid(), [0, 2, 0], st.player);
      if (overlay) add(boxPart([8, 12, 4], [16, 32], 0.5), layer(), [0, 2, 0], st.player);

      // Руки: pivot у плеча; центр руки находится на y=2, как у тела.
      const mkArm = (side: 'left' | 'right') => {
        const pivot = new THREE.Group();
        const x = side === 'right' ? -(4 + armW / 2) : 4 + armW / 2;
        pivot.position.set(x, 8, 0);
        st.player.add(pivot);
        const uv: [number, number] = side === 'right' ? [40, 16] : [32, 48];
        const uvOverlay: [number, number] = side === 'right' ? [40, 32] : [48, 48];
        add(boxPart([armW, 12, 4], uv), solid(), [0, -6, 0], pivot);
        if (overlay) add(boxPart([armW, 12, 4], uvOverlay, 0.5), layer(), [0, -6, 0], pivot);
        return pivot;
      };
      st.arms = { right: mkArm('right'), left: mkArm('left') };

      // Ноги: отдельные hip pivots дают лёгкий естественный перенос веса в idle.
      const mkLeg = (side: 'left' | 'right') => {
        const pivot = new THREE.Group();
        const x = side === 'right' ? -2 : 2;
        pivot.position.set(x, -4, 0);
        st.player.add(pivot);
        const uv: [number, number] = side === 'right' ? [0, 16] : [16, 48];
        const overlayUv: [number, number] = side === 'right' ? [0, 32] : [0, 48];
        add(boxPart([4, 12, 4], uv), solid(), [0, -6, 0], pivot);
        if (overlay) add(boxPart([4, 12, 4], overlayUv, 0.5), layer(), [0, -6, 0], pivot);
        return pivot;
      };
      st.legs = { right: mkLeg('right'), left: mkLeg('left') };

      // Плащ Minecraft: 10×16×1, UV лежат в левом верхнем участке 64×32.
      // Внешняя панель — x=12..21, внутренняя — x=1..10. Позиция и поворот
      // совпадают с игровой моделью: плащ остаётся по центру спины, не зеркалится.
      st.capeTex?.dispose?.();
      st.capeTex = capeTex ?? null;
      st.cape = null;
      if (capeTex) {
        capeTex.magFilter = THREE.NearestFilter;
        capeTex.minFilter = THREE.NearestFilter;
        capeTex.generateMipmaps = false;
        (capeTex as any).colorSpace = (THREE as any).SRGBColorSpace ?? undefined;
        const geo = new THREE.BoxGeometry(10, 16, 1);
        applyBoxUv(geo, 0, 0, 10, 16, 1, 64, 32);
        const pivot = new THREE.Group();
        pivot.position.set(0, 8, -2);
        pivot.rotation.y = Math.PI;
        st.player.add(pivot);
        const mesh = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({
          map: capeTex,
          side: THREE.DoubleSide,
          transparent: true,
          alphaTest: 0.02,
        }));
        mesh.position.set(0, -8, 0.5);
        pivot.add(mesh);
        st.meshes.push(mesh);
        st.cape = pivot;
      }

      st.player.scale.setScalar(slim ? 1.02 : 1);
    };

    const loadTex = (url?: string | null) => new Promise<Texture | null>(resolve => {
      if (!url) return resolve(null);
      loader.load(url, (t: Texture) => resolve(t), undefined, () => resolve(null));
    });

    (async () => {
      const [skinTex, capeTex] = await Promise.all([loadTex(skinUrl), loadTex(capeUrl)]);
      if (!skinTex) return;
      build(skinTex, capeTex);
    })();

    return () => { cancelled = true; };
  }, [skinUrl, capeUrl, model, overlay]);

  return (
    <div
      ref={hostRef}
      className={className}
      style={{ width: '100%', height, touchAction: 'none' }}
      aria-label="3D skin preview"
    />
  );
}

export default SkinStand3D;

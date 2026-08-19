import { useEffect, useRef } from 'react';
import * as THREE from 'three';
// Локальные псевдонимы: пакет three в этом проекте не отдаёт свои .d.ts,
// поэтому объявляем минимальные типы вручную.
type BufferGeometry = any;
type Texture = any;
type Mesh = any;
type Material = any;
type Object3D = any;

/**
 * 3D-стенд со скином Minecraft: геометрия 64×64, classic/slim руки,
 * второй слой и плащ 64×32. Стенд поддерживает вращение и idle-анимацию.
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
  /** Изменение этого значения запускает короткую анимацию применения скина. */
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

    scene.add(new THREE.AmbientLight(0xffffff, 0.92));
    const key = new THREE.DirectionalLight(0xffffff, 0.55);
    key.position.set(12, 18, 24);
    scene.add(key);
    const rim = new THREE.DirectionalLight(0xff5566, 0.28);
    rim.position.set(-16, 6, -18);
    scene.add(rim);

    const player = new THREE.Group();
    scene.add(player);

    const st: any = { scene, camera, renderer, player, yaw: initialYaw, pitch: 0, zoom: cameraDistance, drag: null, raf: 0, meshes: [], applyStartedAt: 0, particle: null, headTargetYaw: 0, headTargetPitch: 0 };
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
        st.headTargetYaw = nx * 0.34;
        st.headTargetPitch = -ny * 0.18;
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
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      st.zoom = Math.max(38, Math.min(96, st.zoom + e.deltaY * 0.045));
      camera.position.z = st.zoom;
    };
    if (interactive || trackCursor) {
      renderer.domElement.addEventListener('pointermove', onMove);
    }
    if (interactive) {
      renderer.domElement.addEventListener('pointerdown', onDown);
      window.addEventListener('pointerup', onUp);
      renderer.domElement.addEventListener('wheel', onWheel, { passive:false });
    }

    let t = 0;
    const loop = () => {
      st.raf = requestAnimationFrame(loop);
      t += 0.016;
      if (autoRotate && !st.drag) st.yaw += 0.0035;
      player.rotation.y = st.yaw;
      player.rotation.x = st.pitch;
      if (st.head) {
        const follow = trackCursor ? 0.16 : 0.11;
        st.head.rotation.y += ((trackCursor ? st.headTargetYaw : 0) - st.head.rotation.y) * follow;
        st.head.rotation.x += ((trackCursor ? st.headTargetPitch : 0) - st.head.rotation.x) * follow;
      }
      if (st.applyStartedAt) {
        const progress = Math.min(1, (performance.now() - st.applyStartedAt) / 560);
        if (progress < 0.26) {
          scene.overrideMaterial = st.whiteMaterial;
        } else {
          scene.overrideMaterial = null;
        }
        const turn = Math.sin(Math.min(1, progress / 0.74) * Math.PI) * Math.PI * 1.25;
        player.rotation.y = st.yaw + turn;
        const pulse = 1 + Math.sin(Math.min(1, progress / 0.5) * Math.PI) * 0.045;
        player.scale.setScalar(pulse);
        if (st.particle) {
          st.particle.visible = progress > 0.16 && progress < 0.92;
          st.particle.rotation.y += 0.085;
          st.particle.position.y = 1.5 + progress * 4;
          st.particle.material.opacity = Math.max(0, 1 - Math.max(0, progress - 0.18) / 0.74);
        }
        if (progress >= 1) {
          scene.overrideMaterial = null;
          player.scale.setScalar(1);
          st.applyStartedAt = 0;
          if (st.particle) {
            player.remove(st.particle);
            st.particle.geometry.dispose();
            st.particle.material.dispose();
            st.particle = null;
          }
        }
      }
      player.position.y = Math.sin(t * 1.4) * 0.35;
      if (st.arms) {
        st.arms.left.rotation.x = Math.sin(t * 1.2) * 0.08;
        st.arms.right.rotation.x = -Math.sin(t * 1.2) * 0.08;
      }
      if (st.cape) st.cape.rotation.x = 0.18 + Math.sin(t * 1.1) * 0.05;
      renderer.render(scene, camera);
    };
    loop();

    return () => {
      cancelAnimationFrame(st.raf);
      ro.disconnect();
      if (interactive || trackCursor) {
        renderer.domElement.removeEventListener('pointermove', onMove);
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
      st.whiteMaterial?.dispose?.();
      st.particle?.geometry?.dispose?.();
      st.particle?.material?.dispose?.();
      renderer.dispose();
      host.removeChild(renderer.domElement);
      stateRef.current = null;
    };
  }, [height, initialYaw, interactive, autoRotate, cameraDistance, trackCursor]);

  useEffect(() => {
    const st = stateRef.current;
    if (!st || !applySequence || !st.player) return;
    st.applyStartedAt = performance.now();
    st.whiteMaterial?.dispose?.();
    st.whiteMaterial = new THREE.MeshBasicMaterial({ color: 0xffffff });
    if (st.particle) {
      st.player.remove(st.particle);
      st.particle.geometry.dispose();
      st.particle.material.dispose();
    }
    const points = new Float32Array(72 * 3);
    for (let index = 0; index < 72; index += 1) {
      points[index * 3] = (Math.random() - 0.5) * 15;
      points[index * 3 + 1] = (Math.random() - 0.5) * 24;
      points[index * 3 + 2] = (Math.random() - 0.5) * 10;
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(points, 3));
    const material = new THREE.PointsMaterial({ color: 0xffffff, size: 0.42, transparent: true, opacity: 0.92, depthWrite: false });
    st.particle = new THREE.Points(geometry, material);
    st.particle.visible = false;
    st.player.add(st.particle);
  }, [applySequence]);

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
      st.tex?.dispose?.();
      st.tex = tex;

      const solid = () => new THREE.MeshLambertMaterial({ map: tex });
      const layer = () => new THREE.MeshLambertMaterial({
        map: tex,
        transparent: true,
        alphaTest: 0.02,
        side: THREE.DoubleSide,
        polygonOffset: true,
        polygonOffsetFactor: 1,
        polygonOffsetUnits: 1,
      });

      const add = (geo: BufferGeometry, mat: Material, pos: [number, number, number], parent: Object3D) => {
        const mesh = new THREE.Mesh(geo, mat);
        mesh.position.set(...pos);
        parent.add(mesh);
        st.meshes.push(mesh);
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

      // Ноги
      add(boxPart([4, 12, 4], [0, 16]), solid(), [-2, -10, 0], st.player);
      add(boxPart([4, 12, 4], [16, 48]), solid(), [2, -10, 0], st.player);
      if (overlay) {
        add(boxPart([4, 12, 4], [0, 32], 0.5), layer(), [-2, -10, 0], st.player);
        add(boxPart([4, 12, 4], [0, 48], 0.5), layer(), [2, -10, 0], st.player);
      }

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

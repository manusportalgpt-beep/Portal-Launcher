import { toIconSrc } from '@/lib/icon-src';

const WINDOWS_ICON_SIZES = [16, 24, 32, 48, 64, 128, 256];

function loadImage(source: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('Unable to read instance cover'));
    image.src = source;
  });
}

function canvasPng(canvas: HTMLCanvasElement): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(async blob => {
      if (!blob) return reject(new Error('Unable to render instance cover'));
      resolve(new Uint8Array(await blob.arrayBuffer()));
    }, 'image/png');
  });
}

function writeU16(target: Uint8Array, offset: number, value: number) {
  target[offset] = value & 0xff;
  target[offset + 1] = (value >>> 8) & 0xff;
}

function writeU32(target: Uint8Array, offset: number, value: number) {
  target[offset] = value & 0xff;
  target[offset + 1] = (value >>> 8) & 0xff;
  target[offset + 2] = (value >>> 16) & 0xff;
  target[offset + 3] = (value >>> 24) & 0xff;
}

function toBase64(bytes: Uint8Array) {
  let binary = '';
  const chunk = 0x8000;
  for (let start = 0; start < bytes.length; start += chunk) {
    binary += String.fromCharCode(...bytes.subarray(start, start + chunk));
  }
  return btoa(binary);
}

/**
 * Converts the visible image selected for an instance into a multi-resolution
 * ICO payload. Windows Explorer then has sharp pixels for both desktop and
 * high-DPI views instead of scaling one small image.
 */
export async function createInstanceShortcutIco(iconPath?: string | null): Promise<string | null> {
  const source = toIconSrc(iconPath);
  if (!source) return null;

  try {
    const image = await loadImage(source);
    const pngs = await Promise.all(WINDOWS_ICON_SIZES.map(async size => {
      const canvas = document.createElement('canvas');
      canvas.width = size;
      canvas.height = size;
      const context = canvas.getContext('2d');
      if (!context) throw new Error('Canvas is unavailable');
      context.imageSmoothingEnabled = true;
      context.imageSmoothingQuality = 'high';
      const scale = Math.max(size / image.naturalWidth, size / image.naturalHeight);
      const width = image.naturalWidth * scale;
      const height = image.naturalHeight * scale;
      context.drawImage(image, (size - width) / 2, (size - height) / 2, width, height);
      return canvasPng(canvas);
    }));

    const directorySize = 6 + pngs.length * 16;
    const output = new Uint8Array(directorySize + pngs.reduce((total, png) => total + png.length, 0));
    writeU16(output, 0, 0);
    writeU16(output, 2, 1);
    writeU16(output, 4, pngs.length);
    let offset = directorySize;
    pngs.forEach((png, index) => {
      const size = WINDOWS_ICON_SIZES[index];
      const entry = 6 + index * 16;
      output[entry] = size === 256 ? 0 : size;
      output[entry + 1] = size === 256 ? 0 : size;
      output[entry + 2] = 0;
      output[entry + 3] = 0;
      writeU16(output, entry + 4, 1);
      writeU16(output, entry + 6, 32);
      writeU32(output, entry + 8, png.length);
      writeU32(output, entry + 12, offset);
      output.set(png, offset);
      offset += png.length;
    });

    return `data:image/x-icon;base64,${toBase64(output)}`;
  } catch {
    return null;
  }
}

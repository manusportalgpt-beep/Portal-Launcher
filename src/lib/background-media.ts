const DB_NAME = 'portal-launcher-media';
const STORE_NAME = 'assets';
const DB_VERSION = 1;

export type BackgroundMediaKind = 'image' | 'video';

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB is unavailable'));
      return;
    }
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) db.createObjectStore(STORE_NAME);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('Unable to open media storage'));
  });
}

export function isStoredBackgroundMedia(value: string): boolean {
  return value.startsWith('indexeddb:');
}

export async function saveBackgroundMedia(kind: BackgroundMediaKind, dataUrl: string): Promise<string> {
  const key = `background-${kind}`;
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).put(dataUrl, key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error('Unable to save background media'));
  });
  db.close();
  return `indexeddb:${key}`;
}

export async function loadBackgroundMedia(value: string): Promise<string> {
  if (!value || !isStoredBackgroundMedia(value)) return value;
  const key = value.slice('indexeddb:'.length);
  try {
    const db = await openDb();
    const result = await new Promise<string | undefined>((resolve, reject) => {
      const request = db.transaction(STORE_NAME, 'readonly').objectStore(STORE_NAME).get(key);
      request.onsuccess = () => resolve(typeof request.result === 'string' ? request.result : undefined);
      request.onerror = () => reject(request.error ?? new Error('Unable to load background media'));
    });
    db.close();
    return result ?? '';
  } catch {
    return '';
  }
}

export async function removeBackgroundMedia(kind: BackgroundMediaKind): Promise<void> {
  try {
    const db = await openDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      tx.objectStore(STORE_NAME).delete(`background-${kind}`);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error ?? new Error('Unable to remove background media'));
    });
    db.close();
  } catch {
    // Removing a missing/unavailable asset is intentionally best effort.
  }
}

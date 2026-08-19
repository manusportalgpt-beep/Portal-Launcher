export type SearchOrigin = {
  storageKey: string;
  scrollTop: number;
};

type SearchReturnRequest = { scrollTop: number };

function returnKey(storageKey: string) {
  return `portal-search-return:${storageKey}`;
}

export function saveSearchReturn(origin: SearchOrigin) {
  try {
    sessionStorage.setItem(returnKey(origin.storageKey), JSON.stringify({ scrollTop: Math.max(0, origin.scrollTop) }));
  } catch {}
}

export function consumeSearchReturn(storageKey: string): SearchReturnRequest | null {
  try {
    const key = returnKey(storageKey);
    const raw = sessionStorage.getItem(key);
    sessionStorage.removeItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as SearchReturnRequest;
    return Number.isFinite(parsed.scrollTop) ? parsed : null;
  } catch {
    return null;
  }
}

export function targetSearchScroll(mode: 'remember' | 'top' | 'bottom', savedTop: number, maximum: number) {
  if (mode === 'top') return 0;
  if (mode === 'bottom') return Math.max(0, maximum);
  return Math.max(0, Math.min(savedTop, Math.max(0, maximum)));
}

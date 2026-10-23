import { idbDel, idbGet, idbSet } from './idb';

export function load<T>(key: string, fallback: T): T {
  if (typeof window === 'undefined') return fallback;
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}
export function save<T>(key: string, value: T) {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {}
}

/* Playlist can be tens of MB — lives in IndexedDB */
export async function loadPlaylist<T>(): Promise<T | null> {
  return idbGet<T>('playlist');
}
export async function savePlaylist<T>(playlist: T) {
  await idbSet('playlist', playlist);
}
export async function clearPlaylist() {
  await idbDel('playlist');
}

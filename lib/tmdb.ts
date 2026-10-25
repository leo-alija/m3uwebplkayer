const TTL = 1000 * 60 * 60 * 24 * 30; /* 30 days */

export type TmdbMeta = {
  poster_path?: string;
  backdrop_path?: string;
  overview?: string;
  vote_average?: number;
  release_date?: string;
  first_air_date?: string;
  runtime?: number;
  genres?: { id: number; name: string }[];
  credits?: { cast?: { name: string; character?: string; profile_path?: string }[] };
  videos?: { results?: { key: string; site: string; type: string; name: string }[] };
  similar?: { results?: { id: number; title?: string; name?: string; poster_path?: string; backdrop_path?: string; vote_average?: number; release_date?: string; first_air_date?: string }[] };
  name?: string;
  title?: string;
};

function cacheKey(type: 'movie' | 'tv', title: string) {
  return `tmdb:${type}:${title.toLowerCase()}`;
}

async function cached(key: string): Promise<any | null> {
  try {
    const { idbGet } = await import('./idb');
    const entry = (await idbGet<{ t: number; v: any }>(key)) || null;
    if (entry && Date.now() - entry.t < TTL) return entry.v;
    return entry?.v || null; /* expired but show stale */
  } catch { return null; }
}

async function store(key: string, value: any) {
  try {
    const { idbSet } = await import('./idb');
    const { load, save } = await import('./storage');
    await idbSet(key, { t: Date.now(), v: value });
    const keys = load<string[]>('tmdbKeys', []);
    if (!keys.includes(key)) {
      keys.push(key);
      save('tmdbKeys', keys);
    }
  } catch {}
}

/**
 * Resolves metadata for a title: IndexedDB first, then the server route
 * (which uses a build-time TMDB_API_KEY if present, else the user's key).
 */
export async function getTmdb(type: 'movie' | 'tv', title: string, userKey?: string): Promise<TmdbMeta | null> {
  const key = cacheKey(type, title);
  if (!title.trim()) return null;
  const hit = await cached(key);
  if (hit) return hit as TmdbMeta;
  try {
    const url = new URL('/api/tmdb', window.location.origin);
    url.searchParams.set('type', type);
    url.searchParams.set('query', title);
    if (userKey) url.searchParams.set('key', userKey);
    const res = await fetch(url.toString());
    if (!res.ok) return null;
    const data = (await res.json()) as TmdbMeta | null;
    if (data && (data.overview || data.poster_path || data.name || data.title)) {
      await store(key, data);
      return data;
    }
    return null;
  } catch {
    return null;
  }
}

export async function clearTmdbCache() {
  try {
    const { idbDel } = await import('./idb');
    const { load, save } = await import('./storage');
    const keys = load<string[]>('tmdbKeys', []);
    keys.forEach((k) => idbDel(k));
    save('tmdbKeys', []);
  } catch {}
}

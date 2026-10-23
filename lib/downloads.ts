import { idbGet, idbSet, idbDel } from './idb';

export type DownloadInfo = { id: string; name: string; bytes: number; savedAt: number };
const INDEX_KEY = 'dlIndex';

export function canDownload(url: string): boolean {
  const path = url.split('?')[0].split('#')[0].toLowerCase();
  return /\.(mp4|webm|mkv|mov|m4v|mp3|m4a|aac|ogg|wav)$/.test(path);
}

export async function getDownloadIndex(): Promise<DownloadInfo[]> {
  return (await idbGet<DownloadInfo[]>(INDEX_KEY)) || [];
}

export async function isDownloaded(id: string): Promise<DownloadInfo | null> {
  const list = await getDownloadIndex();
  return list.find((d) => d.id === id) || null;
}

export async function getDownloadBlob(id: string): Promise<Blob | null> {
  return await idbGet<Blob>('dl:' + id);
}

export async function removeDownload(id: string): Promise<void> {
  await idbDel('dl:' + id);
  await idbSet(INDEX_KEY, (await getDownloadIndex()).filter((d) => d.id !== id));
}

function fmtBytes(n: number): string {
  if (n >= 1e9) return (n / 1e9).toFixed(2).replace(/\.0+$/, '') + ' GB';
  if (n >= 1e6) return (n / 1e6).toFixed(1).replace(/\.0$/, '') + ' MB';
  return Math.max(1, Math.round(n / 1e3)) + ' KB';
}

export { fmtBytes };

/* Download a direct-file stream as one blob (films/episodes only). Tries a
   direct fetch first; if CORS blocks it, falls back to the app's own proxy. */
export async function downloadVideo(
  id: string,
  url: string,
  name: string,
  onProgress: (pct: number) => void,
  signal?: AbortSignal,
): Promise<DownloadInfo> {
  let res: Response;
  try {
    res = await fetch(url, { signal });
    if (!res.ok) throw new Error(String(res.status));
  } catch (e: any) {
    if (e?.name === 'AbortError') throw e;
    res = await fetch(`/api/fetch?bin=1&url=${encodeURIComponent(url)}`, { signal });
    if (!res.ok) throw new Error(`Server returned ${res.status}`);
  }
  const total = Number(res.headers.get('content-length')) || 0;
  const chunks: BlobPart[] = [];
  let received = 0;
  let lastPct = -1;
  const reader = res.body?.getReader();
  if (!reader) {
    const all = await res.blob();
    chunks.push(all);
    received = all.size;
    onProgress(100);
  } else {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) {
        chunks.push(value as unknown as BlobPart);
        received += value.byteLength;
        if (total) {
          const pct = Math.min(99, Math.floor((received / total) * 100));
          if (pct !== lastPct) { lastPct = pct; onProgress(pct); }
        } else onProgress(Math.min(99, received));
      }
    }
  }
  const blob = new Blob(chunks, { type: res.headers.get('content-type') || 'video/mp4' });
  if (blob.size < 1024) throw new Error('Download failed — file looks empty');
  const info: DownloadInfo = { id, name, bytes: blob.size, savedAt: Date.now() };
  const list = (await getDownloadIndex()).filter((d) => d.id !== id);
  list.push(info);
  await idbSet(INDEX_KEY, list);
  await idbSet('dl:' + id, blob);
  onProgress(100);
  return info;
}

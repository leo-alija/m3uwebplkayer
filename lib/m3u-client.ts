/* Client-side M3U parse with progress: runs in a module worker when
   available, falls back to chunked main-thread parsing (with yields so the
   UI keeps painting) on browsers without worker support. */
import { M3UScanner, countLines, iterateLines } from './m3u';
import type { Channel } from './types';

export type ParseProgress = { lines: number; total: number };
export type ParseResult = { channels: Channel[]; epgUrl?: string };

const CHUNK = 8000;
/* Idle-based, not total: resets on every progress report, so a huge playlist
   that keeps parsing never trips it — only a wedged worker does. */
const WORKER_IDLE_TIMEOUT_MS = 120_000;

export function parseM3UWithProgress(
  text: string,
  onProgress?: (p: ParseProgress) => void,
): Promise<ParseResult> {
  if (typeof Worker !== 'undefined') {
    try {
      return runInWorker(text, onProgress);
    } catch {
      /* old Safari without module workers → main thread */
    }
  }
  return parseOnMainThread(text, onProgress);
}

function runInWorker(text: string, onProgress?: (p: ParseProgress) => void): Promise<ParseResult> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./m3u-worker.ts', import.meta.url), { type: 'module' });
    const cleanup = () => { clearTimeout(timer); worker.terminate(); };
    let timer = setTimeout(() => { cleanup(); reject(new Error('Parsing stalled — please retry')); }, WORKER_IDLE_TIMEOUT_MS);
    const resetIdle = () => {
      clearTimeout(timer);
      timer = setTimeout(() => { cleanup(); reject(new Error('Parsing stalled — please retry')); }, WORKER_IDLE_TIMEOUT_MS);
    };
    worker.addEventListener('message', (ev: MessageEvent) => {
      const d = ev.data || {};
      if (d.type === 'progress') { resetIdle(); onProgress?.({ lines: d.lines, total: d.total }); }
      else if (d.type === 'done') { cleanup(); resolve({ channels: d.channels, epgUrl: d.epgUrl }); }
      else if (d.type === 'error') { cleanup(); reject(new Error(d.error || 'parse failed')); }
    });
    worker.addEventListener('error', (e) => {
      cleanup();
      reject(new Error((e as ErrorEvent).message || 'parse worker failed'));
    });
    worker.postMessage({ text });
  });
}

async function parseOnMainThread(text: string, onProgress?: (p: ParseProgress) => void): Promise<ParseResult> {
  const total = countLines(text);
  const scanner = new M3UScanner();
  let n = 0;
  for (const line of iterateLines(text)) {
    scanner.pushLine(line);
    n++;
    if (n % CHUNK === 0) {
      onProgress?.({ lines: n, total });
      await new Promise((r) => setTimeout(r, 0));
    }
  }
  onProgress?.({ lines: total, total });
  return scanner.finish();
}

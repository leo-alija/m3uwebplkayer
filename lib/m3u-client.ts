/* Client-side M3U parse with progress: runs in a module worker when
   available, falls back to chunked main-thread parsing (with yields so the
   UI keeps painting) on browsers without worker support. */
import { M3UScanner } from './m3u';
import type { Channel } from './types';

export type ParseProgress = { lines: number; total: number };
export type ParseResult = { channels: Channel[]; epgUrl?: string };

const CHUNK = 8000;
const WORKER_TIMEOUT_MS = 120_000;

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
    const timer = setTimeout(() => { cleanup(); reject(new Error('Parsing timed out')); }, WORKER_TIMEOUT_MS);
    worker.addEventListener('message', (ev: MessageEvent) => {
      const d = ev.data || {};
      if (d.type === 'progress') onProgress?.({ lines: d.lines, total: d.total });
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
  const lines = text.split(/\r?\n/);
  const scanner = new M3UScanner();
  for (let i = 0; i < lines.length; i += CHUNK) {
    const end = Math.min(i + CHUNK, lines.length);
    for (let j = i; j < end; j++) scanner.pushLine(lines[j]);
    onProgress?.({ lines: end, total: lines.length });
    await new Promise((r) => setTimeout(r, 0));
  }
  return scanner.finish();
}

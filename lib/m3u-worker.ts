/* M3U parse worker: keeps 50k+ entry playlists off the main thread.
   Protocol: in { id, text } → out { id, type: 'progress', lines, total }
   | { id, type: 'done', channels, epgUrl } | { id, type: 'error', error }. */
import { M3UScanner } from './m3u';

const ctx = self as unknown as Worker;

ctx.addEventListener('message', (ev: MessageEvent) => {
  const { id, text } = ev.data || {};
  try {
    const lines = String(text ?? '').split(/\r?\n/);
    const scanner = new M3UScanner();
    const CHUNK = 8000;
    for (let i = 0; i < lines.length; i += CHUNK) {
      const end = Math.min(i + CHUNK, lines.length);
      for (let j = i; j < end; j++) scanner.pushLine(lines[j]);
      ctx.postMessage({ id, type: 'progress', lines: end, total: lines.length });
    }
    const { channels, epgUrl } = scanner.finish();
    ctx.postMessage({ id, type: 'done', channels, epgUrl });
  } catch (e: any) {
    ctx.postMessage({ id, type: 'error', error: e?.message || 'parse failed' });
  }
});

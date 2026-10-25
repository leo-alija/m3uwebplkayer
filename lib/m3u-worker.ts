/* M3U parse worker: keeps 50k+ entry playlists off the main thread.
   Protocol: in { id, text } → out { id, type: 'progress', lines, total }
   | { id, type: 'done', channels, epgUrl } | { id, type: 'error', error }. */
import { M3UScanner, countLines, iterateLines } from './m3u';

const ctx = self as unknown as Worker;

ctx.addEventListener('message', (ev: MessageEvent) => {
  const { id, text } = ev.data || {};
  try {
    const total = countLines(text);
    const scanner = new M3UScanner();
    const CHUNK = 8000;
    let n = 0;
    for (const line of iterateLines(text)) {
      scanner.pushLine(line);
      n++;
      if (n % CHUNK === 0) ctx.postMessage({ id, type: 'progress', lines: n, total });
    }
    ctx.postMessage({ id, type: 'progress', lines: n, total });
    const { channels, epgUrl } = scanner.finish();
    ctx.postMessage({ id, type: 'done', channels, epgUrl });
  } catch (e: any) {
    ctx.postMessage({ id, type: 'error', error: e?.message || 'parse failed' });
  }
});

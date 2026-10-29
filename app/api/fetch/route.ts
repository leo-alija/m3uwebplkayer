/* Proxy for playlists (text), HLS playback (hls=1: manifests are rewritten so
   every nested URL is also proxied — see lib/hls-proxy.ts) and direct-file
   downloads (bin). Same public contract as before (?url=, ?bin=1); now with
   SSRF hardening — every hop (including redirects) passes the guard, plus
   size caps and timeouts. */
import { NextRequest, NextResponse } from 'next/server';
import { GUARD_ERROR, isPubliclyResolvable, parseTargetUrl } from './guard';
import { rewriteManifest } from '@/lib/hls-proxy';

const MAX_TEXT_BYTES = 512 * 1024 * 1024;     // playlists: 512 MB (m3u_plus pastes can be far past 64 MB)
const MAX_BIN_BYTES = 10 * 1024 ** 3;         // downloads: 10 GB
const HEADER_TIMEOUT_MS = 15_000;             // to first response headers per hop
const TEXT_IDLE_TIMEOUT_MS = 30_000;          // stalled stream: no bytes for this long (resets per chunk — no total cap, size never triggers it)
const MAX_REDIRECTS = 5;

export const runtime = 'nodejs';

function blocked() {
  return NextResponse.json({ error: GUARD_ERROR }, { status: 400 });
}

/* One validated request hop. Returns the upstream Response, or the next URL
   to follow (redirect), or a ready-made error response. */
async function hop(
  url: URL,
  headers: Record<string, string>,
  signal: AbortSignal,
): Promise<Response | NextResponse | URL> {
  if (!(await isPubliclyResolvable(url.hostname))) return blocked();
  let res: Response;
  try {
    res = await fetch(url, { headers, redirect: 'manual', signal });
  } catch (e: any) {
    throw new Error(e?.message || 'fetch failed');
  }
  if (res.status >= 300 && res.status < 400) {
    const loc = res.headers.get('location');
    try { res.body?.cancel(); } catch {}
    if (!loc) return NextResponse.json({ error: 'upstream redirect without location' }, { status: 502 });
    return new URL(loc, url);
  }
  return res;
}

async function readCapped(res: Response, maxBytes: number, idleMs: number): Promise<string> {
  const reader = res.body?.getReader();
  if (!reader) return '';
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  /* The idle timer resets on every received chunk, so a slow but flowing
     provider (huge m3u_plus over a thin pipe) is never cut off — only a fully
     stalled stream is. There is deliberately no overall timer: playlist size
     alone must never trip it. */
  let idle = setTimeout(() => reader.cancel(new Error('timeout')), idleMs);
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      idle = refreshIdle(idle, () => reader.cancel(new Error('timeout')), idleMs);
      bytes += value.byteLength;
      if (bytes > maxBytes) throw new Error('response too large');
      chunks.push(value);
    }
  } finally {
    clearTimeout(idle);
  }
  return Buffer.concat(chunks.map((c) => Buffer.from(c.buffer, c.byteOffset, c.byteLength))).toString('utf8');
}

function refreshIdle(timer: ReturnType<typeof setTimeout>, cancel: () => void, idleMs: number) {
  clearTimeout(timer);
  return setTimeout(cancel, idleMs);
}

export async function GET(req: NextRequest) {
  const url = req.nextUrl.searchParams.get('url');
  if (!url) return NextResponse.json({ error: 'missing url' }, { status: 400 });
  const bin = req.nextUrl.searchParams.get('bin') === '1';
  const hls = req.nextUrl.searchParams.get('hls') === '1';
  const meta = req.nextUrl.searchParams.get('meta') === '1';

  if (!parseTargetUrl(url)) return blocked();
  let target = new URL(url);

  const headers: Record<string, string> = { 'User-Agent': 'm3uwebplayer/1.0' };
  const range = req.headers.get('range');
  if (bin && range) headers['range'] = range;

  // Abort while connecting / waiting for headers; cleared before body streaming
  // so long binary downloads aren't cut off.
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(new Error('timeout')), HEADER_TIMEOUT_MS);
  try {
    let res = await hop(target, headers, ctrl.signal);
    for (let i = 0; res instanceof URL; i++) {
      if (i >= MAX_REDIRECTS) {
        return NextResponse.json({ error: 'too many redirects' }, { status: 502 });
      }
      target = res;
      res = await hop(target, headers, ctrl.signal);
    }
    if (res instanceof NextResponse) return res; // guard block or upstream error
    if (!res.ok) return NextResponse.json({ error: `upstream ${res.status}` }, { status: 502 });

    /* Diagnostics probe ("Test guide URL"): headers only, body discarded. */
    if (meta) {
      try { res.body?.cancel(); } catch {}
      return NextResponse.json({
        ok: true,
        finalUrl: target.href,
        status: res.status,
        contentType: res.headers.get('content-type') || '',
        contentLength: Number(res.headers.get('content-length')) || 0,
        contentEncoding: res.headers.get('content-encoding') || '',
        acceptRanges: res.headers.get('accept-ranges') || '',
      });
    }

    if (bin) {
      const len = Number(res.headers.get('content-length')) || 0;
      if (len > MAX_BIN_BYTES) return NextResponse.json({ error: 'file too large' }, { status: 413 });
      let received = 0;
      const capped = res.body!.pipeThrough(
        new TransformStream({
          transform(chunk, c) {
            received += chunk.byteLength;
            if (received > MAX_BIN_BYTES) return c.error(new Error('file too large'));
            c.enqueue(chunk);
          },
        }),
      );
      const out = new Headers();
      for (const h of ['content-type', 'content-length', 'accept-ranges', 'content-range']) {
        const v = res.headers.get(h);
        if (v) out.set(h, v);
      }
      if (!out.get('content-type')) out.set('content-type', 'application/octet-stream');
      return new NextResponse(capped, { status: res.status, headers: out });
    }

    clearTimeout(timer);
    const text = await readCapped(res, MAX_TEXT_BYTES, TEXT_IDLE_TIMEOUT_MS);
    /* HLS playback: rewrite the manifest so hls.js and native iOS HLS can play
       entirely through this proxy. Only &hls=1 requests are rewritten —
       playlist imports fetch the same endpoints without it and must get the
       untouched source text. `target` is the final redirect destination, the
       correct base for relative URLs inside the manifest. */
    if (hls && text.includes('#EXTM3U')) {
      return new NextResponse(rewriteManifest(text, target.href, req.nextUrl.origin), {
        headers: { 'Content-Type': 'application/vnd.apple.mpegurl' },
      });
    }
    return new NextResponse(text, { headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || 'fetch failed' }, { status: 502 });
  } finally {
    clearTimeout(timer);
  }
}

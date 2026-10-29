/* HLS playback through the /api/fetch proxy.
   Providers commonly block direct browser access to m3u8/segment URLs
   (CORS on XHR, or 403 without their expected User-Agent/Referer), so the
   player cannot load them straight from the source even though the playlist
   itself imported fine (it came through the proxy).

   The mechanism is server-side rewriting: when a manifest is requested with
   &hls=1, the route rewrites every URL inside it — variant playlists,
   segments, AES-128 keys, subtitle renditions — into proxied URLs. Variant
   playlists get &hls=1 themselves, so every level is rewritten recursively;
   everything else gets &bin=1 for byte-exact passthrough with Range support.
   Both engines benefit: hls.js (desktop/Android/iOS 17.1+) loads the proxied
   master as its source, and native HLS on older iOS plays the same proxied
   URL via video.src — no CORS, no blob-base resolution problems.

   Rewritten URLs are emitted ROOT-RELATIVE (/api/fetch?...) on purpose.
   Every player resolves them against the URL it fetched the manifest from,
   which is always the right host/port/scheme for that device. Stamping the
   server's own idea of the origin instead is what broke iPhone playback:
   Next.js reports localhost in dev even for LAN requests, so a phone opening
   http://<mac-ip>:3000 received manifests full of http://localhost:3000/...
   URLs — desktop (genuinely localhost) worked, the phone fetched its own
   port and got nothing.

   This module is shared by the browser (proxiedStreamUrl) and the route
   (rewriteManifest), so it must not touch window/DOM directly. */

const M3U8_RE = /\.m3u8(\?|$)/i;

export function isHlsTarget(url: URL): boolean {
  return M3U8_RE.test(url.pathname) || M3U8_RE.test(url.search);
}

function isHttpUrl(u: URL): boolean {
  return u.protocol === 'http:' || u.protocol === 'https:';
}

function proxied(target: string, base: URL): string | null {
  const t = target.trim();
  if (!t) return null;
  let abs: URL;
  try {
    abs = new URL(t, base);
  } catch {
    return null;
  }
  if (!isHttpUrl(abs)) return null;
  const flag = isHlsTarget(abs) ? 'hls=1' : 'bin=1';
  return `/api/fetch?url=${encodeURIComponent(abs.href)}&${flag}`;
}

/* Rewrite one manifest level: URI="..." attributes (keys, maps, renditions)
   and bare URL lines (variants, segments, iframes). URLs come out
   root-relative so each device resolves them against the host it actually
   used (see the module comment). */
export function rewriteManifest(text: string, originalUrl: string): string {
  let base: URL;
  try {
    base = new URL(originalUrl);
  } catch {
    return text;
  }
  const rewritten = text.replace(/URI="([^"]*)"/g, (full, u: string) => {
    const p = proxied(u, base);
    return p ? `URI="${p}"` : full;
  });
  return rewritten
    .split(/\r?\n/)
    .map((line) => {
      if (!line || line.startsWith('#')) return line;
      const p = proxied(line, base);
      return p ?? line;
    })
    .join('\n');
}

/* The URL a <video> element or hls.js should load for a channel. Cross-origin
   streams go through the proxy (hls=1 for manifests, bin=1 for direct files —
   the latter also unblocks CORS-blocked mp4 VOD with seek support via Range).
   Same-origin URLs and non-http(s) schemes come back unchanged. */
export function proxiedStreamUrl(url: string, origin?: string): string {
  if (!origin && typeof window !== 'undefined') origin = window.location.origin;
  let abs: URL;
  try {
    abs = new URL(url);
  } catch {
    return url;
  }
  if (!isHttpUrl(abs)) return url;
  if (origin && abs.origin === origin) return url;
  return `${origin || ''}/api/fetch?url=${encodeURIComponent(abs.href)}&${isHlsTarget(abs) ? 'hls=1' : 'bin=1'}`;
}

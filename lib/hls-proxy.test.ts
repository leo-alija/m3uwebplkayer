import { describe, it, expect } from 'vitest';
import { rewriteManifest, proxiedStreamUrl } from './hls-proxy';

describe('rewriteManifest', () => {
  const base = 'http://provider.example:8080/live/user/pass/ch1.m3u8';

  it('rewrites variant lines with hls=1 and segments with bin=1', () => {
    const out = rewriteManifest('#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=900000\nchunk_1.m3u8\n#EXTINF:10,\nseg_001.ts\n', base);
    const lines = out.split('\n');
    expect(lines[2]).toBe(`/api/fetch?url=${encodeURIComponent('http://provider.example:8080/live/user/pass/chunk_1.m3u8')}&hls=1`);
    expect(lines[4]).toBe(`/api/fetch?url=${encodeURIComponent('http://provider.example:8080/live/user/pass/seg_001.ts')}&bin=1`);
  });

  it('rewrites URI="..." attributes (keys, maps) including absolute URLs', () => {
    const out = rewriteManifest('#EXT-X-KEY:METHOD=AES-128,URI="enc.key"\n#EXT-X-MAP:URI="https://cdn.other/init.mp4"\n', base);
    expect(out).toContain(`URI="/api/fetch?url=${encodeURIComponent('http://provider.example:8080/live/user/pass/enc.key')}&bin=1"`);
    expect(out).toContain(`URI="/api/fetch?url=${encodeURIComponent('https://cdn.other/init.mp4')}&bin=1"`);
  });

  it('emits root-relative proxied URLs so every device resolves them against its own host', () => {
    /* Regression: the server used to prefix its own origin, which in dev is
       localhost even for LAN requests — iPhone playback died fetching
       http://localhost:3000 from the phone itself. */
    const out = rewriteManifest('#EXTM3U\nseg_001.ts\nchunk_1.m3u8\n', base);
    expect(out).not.toMatch(/^https?:\/\/(?!provider\.example)/m);
    expect(out).toContain(`/api/fetch?url=${encodeURIComponent('http://provider.example:8080/live/user/pass/seg_001.ts')}&bin=1`);
    expect(out).toContain(`/api/fetch?url=${encodeURIComponent('http://provider.example:8080/live/user/pass/chunk_1.m3u8')}&hls=1`);
  });

  it('leaves comments and query-bearing m3u8 links without bin flag', () => {
    const out = rewriteManifest('#EXTINF:10,\nnext.m3u8?token=abc\n', base);
    expect(out).toContain(`/api/fetch?url=${encodeURIComponent('http://provider.example:8080/live/user/pass/next.m3u8?token=abc')}&hls=1`);
    expect(out).not.toContain('token=abc&bin');
  });

  it('keeps non-http lines and invalid bases untouched', () => {
    expect(rewriteManifest('#EXTINF:10,\n', base)).toBe('#EXTINF:10,\n');
    expect(rewriteManifest('#EXTM3U\nseg.ts\n', 'not a url')).toBe('#EXTM3U\nseg.ts\n');
  });
});

describe('proxiedStreamUrl', () => {
  const origin = 'https://app.example.com';

  it('routes cross-origin manifests through the proxy with hls=1', () => {
    expect(proxiedStreamUrl('http://provider.example:8080/live/u/p/ch.m3u8', origin))
      .toBe(`${origin}/api/fetch?url=${encodeURIComponent('http://provider.example:8080/live/u/p/ch.m3u8')}&hls=1`);
  });

  it('routes cross-origin direct files through the proxy with bin=1 (Range-capable)', () => {
    expect(proxiedStreamUrl('https://cdn.example.net/movie.mp4', origin))
      .toBe(`${origin}/api/fetch?url=${encodeURIComponent('https://cdn.example.net/movie.mp4')}&bin=1`);
  });

  it('passes same-origin and non-http URLs through unchanged', () => {
    expect(proxiedStreamUrl(`${origin}/local.mp4`, origin)).toBe(`${origin}/local.mp4`);
    expect(proxiedStreamUrl('blob:https://app.example.com/abc', origin)).toBe('blob:https://app.example.com/abc');
  });

  it('returns garbage input unchanged', () => {
    expect(proxiedStreamUrl('not a url', origin)).toBe('not a url');
  });
});

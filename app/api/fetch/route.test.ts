import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { NextRequest } from 'next/server';
import { GET } from './route';

vi.mock('node:dns/promises', () => ({ lookup: vi.fn() }));
import { lookup } from 'node:dns/promises';

const mockLookup = lookup as unknown as Mock;
const PUBLIC_ADDR = [{ address: '93.184.216.34', family: 4 }];

function req(url: string, headers: Record<string, string> = {}, bin = false) {
  const q = new URLSearchParams({ url });
  if (bin) q.set('bin', '1');
  return new NextRequest(`http://localhost:3000/api/fetch?${q}`, { headers });
}

function textResponse(body: string, init: ResponseInit = {}) {
  return new Response(body, { status: 200, headers: { 'content-type': 'text/plain' }, ...init });
}

beforeEach(() => {
  mockLookup.mockReset().mockResolvedValue(PUBLIC_ADDR);
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe('GET /api/fetch — request contract', () => {
  it('returns 400 for missing url', async () => {
    const res = await GET(new NextRequest('http://localhost:3000/api/fetch'));
    expect(res.status).toBe(400);
  });

  it('proxies text with same shape as before', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(textResponse('#EXTM3U')));
    const res = await GET(req('https://example.com/list.m3u'));
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('text/plain; charset=utf-8');
    expect(await res.text()).toBe('#EXTM3U');
  });

  it('proxies bin with header passthrough and forwards Range', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(new Uint8Array([1, 2, 3]), {
        status: 206,
        headers: { 'content-type': 'video/mp4', 'content-length': '3', 'accept-ranges': 'bytes' },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);
    const res = await GET(req('https://cdn.example.com/v.mp4', { range: 'bytes=0-2' }, true));
    expect(res.status).toBe(206);
    expect(res.headers.get('content-type')).toBe('video/mp4');
    const call = fetchMock.mock.calls[0] as [URL, RequestInit];
    expect((call[1].headers as Record<string, string>)['range']).toBe('bytes=0-2');
  });
});

describe('GET /api/fetch — SSRF protection', () => {
  it.each([
    'http://127.0.0.1/x',
    'http://localhost/x',
    'http://10.0.0.5/x',
    'http://192.168.1.1/x',
    'http://[::ffff:10.0.0.1]/x',
    'file:///etc/passwd',
  ])('blocks malicious url without calling upstream: %s', async (u) => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const res = await GET(req(u));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'blocked-url' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('blocks URLs whose DNS resolves to a private IP', async () => {
    mockLookup.mockResolvedValue([{ address: '10.0.0.1', family: 4 }]);
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const res = await GET(req('https://rebind.example.com/x'));
    expect(res.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('blocks redirects into private IPs', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response(null, { status: 302, headers: { location: 'http://127.0.0.1/admin' } })),
    );
    const res = await GET(req('https://example.com/redirect'));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'blocked-url' });
  });

  it('follows redirects between public hosts and re-validates each hop', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response(null, { status: 302, headers: { location: 'https://cdn.example.com/a' } }))
      .mockResolvedValueOnce(textResponse('final'));
    vi.stubGlobal('fetch', fetchMock);
    const res = await GET(req('https://example.com/redirect'));
    expect(await res.text()).toBe('final');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('maps upstream failure to 502', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 404 })));
    const res = await GET(req('https://example.com/missing'));
    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({ error: 'upstream 404' });
  });

  it('rejects unresolvable hosts', async () => {
    mockLookup.mockRejectedValue(new Error('ENOTFOUND'));
    vi.stubGlobal('fetch', vi.fn());
    const res = await GET(req('https://nope.example.com/x'));
    expect(res.status).toBe(400);
  });
});

import { NextRequest, NextResponse } from 'next/server';

export async function GET(req: NextRequest) {
  const url = req.nextUrl.searchParams.get('url');
  if (!url) return NextResponse.json({ error: 'missing url' }, { status: 400 });
  const bin = req.nextUrl.searchParams.get('bin') === '1';
  try {
    const res = await fetch(bin ? url : url, {
      headers: bin ? { 'User-Agent': 'm3uwebplayer/1.0' } : { 'User-Agent': 'm3uwebplayer/1.0' },
    });
    if (!res.ok) return NextResponse.json({ error: `upstream ${res.status}` }, { status: 502 });
    if (bin) {
      const headers = new Headers();
      for (const h of ['content-type', 'content-length', 'accept-ranges', 'content-range']) {
        const v = res.headers.get(h);
        if (v) headers.set(h, v);
      }
      if (!headers.get('content-type')) headers.set('content-type', 'application/octet-stream');
      return new NextResponse(res.body, { status: res.status, headers });
    }
    const text = await res.text();
    return new NextResponse(text, { headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || 'fetch failed' }, { status: 502 });
  }
}

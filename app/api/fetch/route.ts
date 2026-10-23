import { NextRequest, NextResponse } from 'next/server';

export async function GET(req: NextRequest) {
  const url = req.nextUrl.searchParams.get('url');
  if (!url) return NextResponse.json({ error: 'missing url' }, { status: 400 });
  try {
    const res = await fetch(url, { headers: { 'User-Agent': 'm3uwebplayer/1.0' } });
    if (!res.ok) return NextResponse.json({ error: `upstream ${res.status}` }, { status: 502 });
    const text = await res.text();
    return new NextResponse(text, { headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || 'fetch failed' }, { status: 502 });
  }
}

import { NextRequest, NextResponse } from 'next/server';

const TMDB_HOST = 'https://api.themoviedb.org/3';

/**
 * Proxies optional TMDb lookups. Uses the build-time TMDB_API_KEY when
 * present; otherwise forwards the user's own key from Settings.
 */
export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const type = sp.get('type') === 'tv' ? 'tv' : 'movie';
  const query = sp.get('query');
  const userKey = sp.get('key') || process.env.TMDB_API_KEY || '';

  if (!userKey || !query) {
    return NextResponse.json({ error: 'missing key or query' }, { status: 400 });
  }

  try {
    const searchRes = await fetch(
      `${TMDB_HOST}/search/${type}?api_key=${encodeURIComponent(userKey)}&query=${encodeURIComponent(query)}`,
      { cache: 'no-store' }
    );
    if (!searchRes.ok) return NextResponse.json({ error: `tmdb ${searchRes.status}` }, { status: 502 });
    const sj = (await searchRes.json()) as { results?: { id: number }[] };
    const first = sj.results?.[0];
    if (!first) return NextResponse.json(null);

    const detailRes = await fetch(
      `${TMDB_HOST}/${type}/${first.id}?api_key=${encodeURIComponent(userKey)}&append_to_response=credits,videos,similar`,
      { cache: 'no-store' }
    );
    if (!detailRes.ok) return NextResponse.json({ error: `tmdb ${detailRes.status}` }, { status: 502 });
    const dj = (await detailRes.json()) as any;
    delete dj.episode_run_time; delete dj.languages; delete dj.production_companies;
    delete dj.production_countries; delete dj.seasons; delete dj.spoken_languages; delete dj.tagline;

    return NextResponse.json(dj, {
      headers: { 'Cache-Control': 'public, max-age=86400, s-maxage=86400' },
    });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || 'tmdb failed' }, { status: 502 });
  }
}

import { NextRequest, NextResponse } from 'next/server';

const TMDB_HOST = 'https://api.themoviedb.org/3';

/**
 * Proxies optional TMDb lookups. Uses the build-time TMDB_API_KEY when
 * present; otherwise forwards the user's own key from Settings.
 *  - ?type=movie|tv&query=…            → metadata for one title
 *  - ?list=trending|popular|top_rated  → shelves for the Flix front page
 */
export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const type = sp.get('type') === 'tv' ? 'tv' : 'movie';
  const query = sp.get('query');
  const list = sp.get('list');
  const userKey = sp.get('key') || process.env.TMDB_API_KEY || '';

  if (!userKey) {
    return NextResponse.json({ error: 'missing key' }, { status: 400 });
  }

  try {
    if (list) {
      if (!['trending', 'popular', 'top_rated'].includes(list)) {
        return NextResponse.json({ error: 'bad list' }, { status: 400 });
      }
      const path = list === 'trending' ? `trending/${type}/week` : `${type}/${list}`;
      const res = await fetch(`${TMDB_HOST}/${path}?api_key=${encodeURIComponent(userKey)}`, { cache: 'no-store' });
      if (!res.ok) return NextResponse.json({ error: `tmdb ${res.status}` }, { status: 502 });
      const j = (await res.json()) as { results?: any[] };
      const results = (j.results || [])
        .filter((r) => (r.title || r.name) && (r.poster_path || r.backdrop_path))
        .slice(0, 20)
        .map((r) => ({
          id: r.id,
          title: r.title || r.name,
          poster_path: r.poster_path,
          backdrop_path: r.backdrop_path,
          vote_average: r.vote_average,
          release_date: r.release_date || r.first_air_date,
          overview: r.overview,
        }));
      return NextResponse.json({ results }, {
        headers: { 'Cache-Control': 'public, max-age=21600, s-maxage=21600' },
      });
    }

    if (!query) {
      return NextResponse.json({ error: 'missing key or query' }, { status: 400 });
    }
    const searchRes = await fetch(
      `${TMDB_HOST}/search/${type}?api_key=${encodeURIComponent(userKey)}&query=${encodeURIComponent(query)}`,
      { cache: 'no-store' }
    );
    if (!searchRes.ok) return NextResponse.json({ error: `tmdb ${searchRes.status}` }, { status: 502 });
    const sj = (await searchRes.json()) as { results?: { id: number }[] };
    const first = sj.results?.[0];
    if (!first) return NextResponse.json(null);

    const detailRes = await fetch(
      `${TMDB_HOST}/${type}/${first.id}?api_key=${encodeURIComponent(userKey)}&append_to_response=credits,videos,similar,watch/providers`,
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

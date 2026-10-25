'use client';

import { useEffect, useState } from 'react';
import { Channel, SeriesFolder } from '@/lib/types';
import { Poster, IconPlayCircle, IconStar, IconChevron, Chip } from './ui';

/* ================= Aurora backdrop ================= */

export function Aurora() {
  return (
    <div className="absolute inset-0 overflow-hidden pointer-events-none" aria-hidden>
      <div className="aurora a" />
      <div className="aurora b" />
      <div className="aurora c" />
    </div>
  );
}

/* ================= Hero ================= */

export type HeroSlide = {
  kind: 'live' | 'movie' | 'series';
  ch?: Channel;
  folder?: SeriesFolder;
  meta?: any;
};

export function Hero({ slides, onPlay, onInfo, isFavSet, onFav }: {
  slides: HeroSlide[]; onPlay: (s: HeroSlide, resume?: number) => void; onInfo: (s: HeroSlide) => void;
  isFavSet: Set<string>; onFav: (id: string) => void;
}) {
  const [idx, setIdx] = useState(0);
  const [key, setKey] = useState(0);

  useEffect(() => {
    if (slides.length <= 1) return;
    const t = setInterval(() => { setKey((k) => k + 1); setIdx((i) => (i + 1) % slides.length); }, 9000);
    return () => clearInterval(t);
  }, [slides.length]);

  if (!slides.length) return null;
  const s = slides[idx % slides.length];
  const workTitle = s.kind === 'series' ? s.folder?.name : s.ch?.name || '';
  const poster = s.kind === 'live'
    ? undefined
    : (s.meta?.backdrop_path
        ? `https://image.tmdb.org/t/p/w780${s.meta.backdrop_path}`
        : s.meta?.poster_path ? `https://image.tmdb.org/t/p/w780${s.meta.poster_path}` : (s.folder?.tmdbPosterUrl || s.folder?.posterUrl || s.ch?.logo));
  const small = s.kind === 'live' ? s.ch?.logo : s.meta?.poster_path ? `https://image.tmdb.org/t/p/w185${s.meta.poster_path}` : s.folder?.posterUrl;
  const year = s.kind === 'series' ? s.meta?.first_air_date?.slice(0, 4) : s.meta?.release_date?.slice(0, 4);
  const eyebrow = s.kind === 'live' ? 'Live TV' : s.kind === 'series' ? 'Series' : 'Film';
  const isFav = s.ch ? isFavSet.has(s.ch.id) : false;

  return (
    <div className="relative overflow-hidden" style={{ paddingBottom: 14 }}>
      <Aurora />
      {/* slide backdrop */}
      <div key={key} className="relative hero-fade">
        <div className="relative h-[46vw] max-h-[340px] min-h-[240px]">
          {poster && (
            <img src={poster} alt="" onError={(e) => (e.currentTarget.style.opacity = '0')}
              className="absolute inset-0 w-full h-full object-cover opacity-80" />
          )}
          {s.kind === 'live' && s.ch?.logo && (
            <div className="absolute inset-0 flex items-center justify-center">
              <img src={s.ch.logo} alt="" className="h-[40%] max-w-[60%] object-contain drop-shadow-2xl" />
            </div>
          )}
          <div className="absolute inset-0 bg-gradient-to-t from-ground via-ground/35 to-transparent" />
          <div className="absolute inset-0 bg-gradient-to-r from-ground/85 via-transparent to-transparent" />
        </div>

        <div className="relative px-4 -mt-14 pb-2">
          <div className="flex items-center gap-2 mb-1.5">
            {small && <img src={small} alt="" className="h-8 rounded-md" />}
            <span className={`text-[10px] font-bold uppercase tracking-[0.14em] px-2 py-1 rounded-md ${s.kind === 'live' ? 'bg-red-500 text-white' : 'bg-white/15 text-white'}`}>
              {eyebrow}
            </span>
            {s.ch?.qualityTag && <span className="text-[10px] font-bold text-white/60 bg-white/10 px-1.5 py-1 rounded-md">{s.ch.qualityTag}</span>}
          </div>
          <h2 className="text-[26px] font-extrabold leading-tight tracking-tight max-w-[85%]">{workTitle}</h2>
          <div className="flex items-center gap-2 mt-1 text-[12px] text-white/60">
            {s.meta?.vote_average > 0 && <span className="text-star font-bold">★ {s.meta.vote_average.toFixed(1)}</span>}
            {year && <span>{year}</span>}
            {s.meta?.genres?.slice(0, 3).map((g: any) => <span key={g.id}>· {g.name}</span>)}
            {!s.meta && s.ch?.groups?.slice(0, 3).join(' · ')}
          </div>
          {s.meta?.overview && (
            <p className="text-[13px] text-white/65 mt-2 leading-relaxed line-clamp-3 max-w-[92%]">{s.meta.overview}</p>
          )}
          <div className="flex items-center gap-2.5 mt-4">
            <button onClick={() => onPlay(s)} className="press flex items-center gap-2 bg-accent text-black font-bold px-5 py-3 rounded-2xl text-[15px] shadow-lg shadow-orange-900/30">
              <IconPlayCircle className="w-5 h-5" /> Play
            </button>
            {s.kind !== 'live' && (
              <button onClick={() => onInfo(s)} className="press flex items-center gap-2 bg-white/15 backdrop-blur text-white font-semibold px-4 py-3 rounded-2xl text-[15px]">
                <span className="text-[16px] leading-none">ⓘ</span> Details
              </button>
            )}
            <button onClick={() => s.ch && onFav(s.ch.id)} className={`press p-3 rounded-2xl bg-white/10 ${isFav ? 'text-accent' : 'text-white'}`} title="Favourite">
              <IconStar filled={isFav} className="w-5 h-5" />
            </button>
          </div>
        </div>
      </div>
      {slides.length > 1 && (
        <div className="flex justify-center gap-1.5 mt-3">
          {slides.map((_, i) => (
            <button key={i} onClick={() => { setKey((k) => k + 1); setIdx(i); }}
              className={`h-1.5 rounded-full transition-all ${i === idx % slides.length ? 'w-5 bg-accent' : 'w-1.5 bg-white/30'}`} aria-label={`Slide ${i + 1}`} />
          ))}
        </div>
      )}
    </div>
  );
}

/* ================= Shelves ================= */

export function Shelf({ title, children, onSeeAll }: { title: string; children: React.ReactNode; onSeeAll?: () => void }) {
  return (
    <section className="mt-6">
      <div className="px-4 pb-2 flex items-center justify-between">
        <div className="text-[17px] font-bold tracking-tight">{title}</div>
        {onSeeAll && (
          <button onClick={onSeeAll} className="press text-[13px] text-link flex items-center gap-0.5">
            See all <IconChevron className="w-3.5 h-3.5" />
          </button>
        )}
      </div>
      <div className="scroll-x shelf pb-1">{children}</div>
    </section>
  );
}

/* Live channel tile (Netflix "TV" card): 16:9 with logo centre */
export function LiveTile({ ch, onClick }: { ch: Channel; onClick: () => void }) {
  return (
    <button onClick={onClick} className="press text-left" style={{ width: 150 }}>
      <div className="relative rounded-xl overflow-hidden bg-gradient-to-br from-raise to-deck flex items-center justify-center" style={{ aspectRatio: '16/10' }}>
        {ch.logo ? (
          <img src={ch.logo} alt="" loading="lazy" onError={(e) => (e.currentTarget.style.display = 'none')}
            className="max-w-[62%] max-h-[62%] object-contain drop-shadow-lg" />
        ) : (
          <span className="text-[13px] font-bold text-white/40 px-3 text-center leading-tight">{ch.name}</span>
        )}
        <div className="absolute inset-0 ring-1 ring-inset ring-white/5 rounded-xl" />
      </div>
      <div className="mt-1.5 text-[12px] font-medium truncate">{ch.name}</div>
      {ch.qualityTag && <div className="text-[10px] text-white/35">{ch.qualityTag}</div>}
    </button>
  );
}

/* Poster card for films/series; `rank` renders the Netflix Top-10 numeral */
export function PosterCard({ poster, title, subtitle, onClick, showProgress, rank }: {
  poster?: string; title: string; subtitle?: string; onClick: () => void; showProgress?: number; rank?: number;
}) {
  return (
    <button onClick={onClick} className="press text-left" style={{ width: rank != null ? 146 : 112 }}>
      <div className={rank != null ? 'flex items-end' : ''}>
        {rank != null && (
          <span
            className="font-extrabold leading-none text-transparent shrink-0 select-none"
            style={{ fontSize: 64, marginRight: -18, marginBottom: 6, WebkitTextStroke: '2px rgb(var(--text-rgb) / 0.5)' }}
            aria-hidden>{rank}</span>
        )}
        <div className="relative rounded-xl overflow-hidden flex-1" style={{ aspectRatio: '2/3' }}>
          <Poster src={poster} label={title} className="absolute inset-0 w-full h-full" />
          {showProgress != null && (
            <div className="absolute bottom-0 inset-x-0 h-1 bg-white/25">
              <div className="h-full bg-accent" style={{ width: `${showProgress}%` }} />
            </div>
          )}
        </div>
      </div>
      <div className="mt-1.5 text-[12px] font-semibold truncate">{title}</div>
      {subtitle && <div className="text-[10px] text-white/35 truncate">{subtitle}</div>}
    </button>
  );
}

/* ================= Skeleton ================= */

export function Skeletons() {
  return (
    <div>
      <div className="px-4 pt-4">
        <div className="shimmer rounded-2xl h-[240px]" />
      </div>
      {[0, 1].map((i) => (
        <section key={i} className="mt-6">
          <div className="px-4 pb-2"><div className="shimmer h-4 w-36 rounded" /></div>
          <div className="scroll-x shelf">
            {Array.from({ length: 5 }).map((_, j) => (<div key={j} className="shimmer rounded-xl" style={{ width: 112, aspectRatio: '2/3' }} />))}
          </div>
        </section>
      ))}
    </div>
  );
}

/* Genre chips row used by Home quick-jump */
export function GenreStrip({ groups, counts, onPick }: { groups: string[]; counts?: Record<string, number>; onPick: (g: string) => void }) {
  return (
    <div className="scroll-x flex gap-2 px-4 py-1">
      {groups.map((g) => <Chip key={g} label={counts ? `${g} ${counts[g] || ''}` : g} onClick={() => onPick(g)} />)}
    </div>
  );
}

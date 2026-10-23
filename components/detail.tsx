'use client';

import { useMemo, useState } from 'react';
import { Channel, SeriesFolder, SeriesEpisode } from '@/lib/types';
import { Sheet, IconStar, IconPlayCircle, IconShare, Chip, Poster } from './ui';
import { TmdbMeta } from '@/lib/tmdb';

type Props = {
  kind: 'movie' | 'series';
  title: string;
  folder?: SeriesFolder;
  channel?: Channel;                         /* for movies */
  meta?: TmdbMeta | null;
  isFav: boolean;
  onFav: () => void;
  onPlayMovie?: () => void;
  onPlayEpisode?: (ep: SeriesEpisode) => void;
  onClose: () => void;
};

export default function DetailSheet(p: Props) {
  const seasons = useMemo(
    () => p.folder ? Array.from(new Set(p.folder.episodes.map((e) => e.seasonNumber))).sort((a, b) => a - b) : [],
    [p.folder]);
  const [season, setSeason] = useState(seasons.includes(1) ? 1 : seasons[0] || 1);
  const episodes = p.folder
    ? p.folder.episodes.filter((e) => e.seasonNumber === season).sort((a, b) => a.episodeNumber - b.episodeNumber)
    : [];

  const backdrop = p.meta?.backdrop_path ? `https://image.tmdb.org/t/p/w780${p.meta.backdrop_path}` : (p.meta?.poster_path ? `https://image.tmdb.org/t/p/w780${p.meta.poster_path}` : undefined);
  const year = p.kind === 'series' ? p.meta?.first_air_date?.slice(0, 4) : p.meta?.release_date?.slice(0, 4);
  const runtime = p.kind === 'movie' ? p.meta?.runtime : undefined;
  const trailer = p.meta?.videos?.results?.find((v) => v.site === 'YouTube' && (v.type === 'Trailer' || v.type === 'Teaser'));
  const cast = p.meta?.credits?.cast?.slice(0, 12) || [];

  function playTrailer() {
    if (trailer) window.open(`https://youtube.com/watch?v=${trailer.key}`, '_blank');
  }

  return (
    <Sheet open onClose={p.onClose} tall>
      <div className="pb-8">
        {/* Backdrop */}
        <div className="relative">
          <div className="relative h-[54vw] max-h-[320px] min-h-[220px] overflow-hidden md:rounded-t-2xl">
            {backdrop ? (
              <img src={backdrop} alt="" className="absolute inset-0 w-full h-full object-cover" />
            ) : (
              <Poster src={p.meta?.poster_path ? `https://image.tmdb.org/t/p/w342${p.meta.poster_path}` : (p.channel?.logo || p.folder?.posterUrl)} className="absolute inset-0 w-full h-full object-cover opacity-60" />
            )}
            <div className="absolute inset-0 bg-gradient-to-t from-[#1c1c1e] via-transparent to-black/25" />
          </div>
          <div className="relative px-4 -mt-12">
            <div className="flex items-end gap-3">
              <div className="font-extrabold text-[24px] leading-tight tracking-tight max-w-[80%]">{p.title}</div>
            </div>
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1 mt-1.5 text-[12px] text-white/60">
              {p.meta?.vote_average ? <span className="text-[#ffd60a] font-bold">★ {p.meta.vote_average.toFixed(1)}</span> : null}
              {year && <span className="font-medium">{year}</span>}
              {runtime && <span>{runtime} min</span>}
              {p.channel?.qualityTag && <span className="bg-white/10 rounded px-1.5 font-semibold">{p.channel.qualityTag}</span>}
              {p.meta?.genres?.slice(0, 3).map((g: any) => <span key={g.id} className="bg-white/10 rounded px-1.5">{g.name}</span>)}
              {!p.meta && p.folder?.episodeCount && <span>{p.folder.episodeCount} episodes · {p.folder.seasonCount} seasons</span>}
            </div>
            {p.meta?.overview && (
              <p className="text-[13px] text-white/70 leading-relaxed mt-3">{p.meta.overview}</p>
            )}
            {/* Actions */}
            <div className="flex items-center gap-2.5 mt-4">
              <button
                onClick={() => (p.kind === 'movie' ? p.onPlayMovie?.() : p.folder?.episodes?.[0] && p.onPlayEpisode?.(p.folder.episodes[0]))}
                className="press flex items-center gap-2 bg-[#ff7a2a] text-black font-bold px-5 py-3 rounded-2xl text-[15px] shadow-lg shadow-orange-900/25 flex-1 justify-center">
                <IconPlayCircle className="w-5 h-5" /> Play{p.kind === 'movie' ? '' : ' first episode'}
              </button>
              <button onClick={p.onFav} className={`press p-3 rounded-2xl bg-white/10 ${p.isFav ? 'text-[#ff7a2a]' : 'text-white'}`} title="Favourite">
                <IconStar filled={p.isFav} className="w-5 h-5" />
              </button>
              {trailer && (
                <button onClick={playTrailer} className="press p-3 rounded-2xl bg-white/10 text-white" title="Watch trailer">
                  <IconShare className="w-5 h-5" />
                </button>
              )}
            </div>
          </div>
        </div>

        {/* Movie: stream variants */}
        {p.kind === 'movie' && p.channel && (
          <div className="px-4 mt-5">
            <div className="text-[13px] font-medium uppercase tracking-wide text-white/45 pb-1.5">Watch now</div>
            <button onClick={p.onPlayMovie} className="press w-full ios-card px-4 py-3.5 flex items-center gap-3 text-left">
              <IconPlayCircle className="w-8 h-8 text-[#ff7a2a]" />
              <div className="min-w-0 flex-1">
                <div className="text-[15px] truncate">{p.channel.qualityTag || 'Stream'}</div>
                <div className="text-[11px] text-white/35 truncate">{p.channel.group}</div>
              </div>
              <span className="text-[12px] text-[#0a84ff]">Play</span>
            </button>
          </div>
        )}

        {/* Series: seasons + episodes */}
        {p.kind === 'series' && p.folder && (
          <div className="px-4 mt-5">
            {seasons.length > 1 && (
              <div className="scroll-x flex gap-2 pb-3">
                {seasons.map((s) => <Chip key={s} label={`Season ${s}`} active={s === season} onClick={() => setSeason(s)} />)}
              </div>
            )}
            <div className="ios-card divide-y divide-white/5">
              {episodes.map((e) => (
                <button key={e.channel.id} onClick={() => p.onPlayEpisode?.(e)} className="press w-full text-left flex items-center gap-3 px-3 py-3">
                  <div className="w-10 shrink-0 text-center rounded-lg py-1.5 text-[13px] font-mono bg-white/6 text-white/60">E{e.episodeNumber}</div>
                  <div className="flex-1 min-w-0">
                    <div className="text-[15px] truncate">{e.episodeTitle}</div>
                    <div className="text-[11px] text-white/35 truncate">{e.channel.qualityTag || e.channel.group}</div>
                  </div>
                  <IconPlayCircle className="w-7 h-7 text-white/30" />
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Cast */}
        {cast.length > 0 && (
          <div className="mt-6">
            <div className="px-4 pb-2 text-[13px] font-medium uppercase tracking-wide text-white/45">Cast</div>
            <div className="scroll-x shelf">
              {cast.map((c: any, i: number) => (
                <div key={i} style={{ width: 84 }} className="text-center">
                  {c.profile_path ? (
                    <img src={`https://image.tmdb.org/t/p/w185${c.profile_path}`} alt="" className="rounded-xl w-[84px] h-[112px] object-cover bg-[#2c2c2e]" />
                  ) : (
                    <div className="rounded-xl w-[84px] h-[112px] object-cover bg-gradient-to-br from-[#3a3a3c] to-[#1c1c1e] flex items-center justify-center text-[18px] text-white/30">{c.name?.slice(0, 1)}</div>
                  )}
                  <div className="mt-1 text-[11px] font-semibold truncate">{c.name}</div>
                  {c.character && <div className="text-[10px] text-white/35 truncate">{c.character}</div>}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </Sheet>
  );
}

'use client';

import { useEffect, useMemo, useState } from 'react';
import { Channel, Playlist, Profile, SeriesFolder, SeriesEpisode } from '@/lib/types';
import { Sheet, Button, Chip, GroupRow, Row, IconChevron, IconClose, IconStar, IconPlayCircle, Poster, IconTrash } from './ui';

/* ================= Import ================= */

export function ImportSheet({ open, onClose, url, setUrl, xtream, setXtream, importing, error, onUrl, onFile, onXtream, hasPlaylist, onChangePlaylist }: {
  open: boolean; onClose: () => void;
  url: string; setUrl: (v: string) => void;
  xtream: { host: string; user: string; pass: string }; setXtream: (v: any) => void;
  importing: boolean; error: string;
  onUrl: () => void; onFile: (f: File) => void; onXtream: () => void;
  hasPlaylist: boolean; onChangePlaylist: () => void;
}) {
  return (
    <Sheet open={open} title="Add playlist" onClose={onClose}>
      <div className="px-4 pb-6 space-y-4">
        <GroupRow title="M3U / M3U8 URL">
          <input value={url} onChange={(e) => setUrl(e.target.value)} inputMode="url" autoCapitalize="none" autoCorrect="off"
            placeholder="http://host/playlist.m3u"
            className="w-full bg-transparent px-4 py-3 text-[15px] outline-none placeholder:text-white/30" />
          <div className="px-3 pb-3 flex gap-2">
            <Button primary onClick={onUrl} disabled={importing || !url.trim()} className="flex-1">{importing ? 'Importing…' : 'Add'}</Button>
          </div>
        </GroupRow>

        <GroupRow title="Xtream Codes login">
          <input value={xtream.host} onChange={(e) => setXtream({ ...xtream, host: e.target.value })} inputMode="url" autoCapitalize="none" autoCorrect="off"
            placeholder="http://host:port" className="w-full bg-transparent px-4 py-3 text-[15px] outline-none placeholder:text-white/30 hairline-b" />
          <input value={xtream.user} onChange={(e) => setXtream({ ...xtream, user: e.target.value })} autoCapitalize="none"
            placeholder="username" className="w-full bg-transparent px-4 py-3 text-[15px] outline-none placeholder:text-white/30 hairline-b" />
          <input value={xtream.pass} onChange={(e) => setXtream({ ...xtream, pass: e.target.value })} type="password" autoCapitalize="none"
            placeholder="password" className="w-full bg-transparent px-4 py-3 text-[15px] outline-none placeholder:text-white/30" />
          <div className="px-3 pb-3 flex gap-2">
            <Button primary onClick={onXtream} disabled={importing || !xtream.host || !xtream.user} className="flex-1">{importing ? 'Importing…' : 'Log in & import'}</Button>
          </div>
        </GroupRow>

        <GroupRow title="Upload file">
          <label className="block cursor-pointer">
            <input type="file" accept=".m3u,.m3u8,.txt,text/plain" className="hidden"
              onChange={(e) => { if (e.target.files?.[0]) onFile(e.target.files[0]); e.target.value = ''; }} />
            <div className="px-4 py-4 text-[16px] text-[#0a84ff] flex items-center justify-between">
              <span>Choose .m3u file</span><IconChevron className="w-4 h-4 text-white/30" />
            </div>
          </label>
        </GroupRow>

        {error && <div className="mx-4 text-red-400 text-[14px]">{error}</div>}
        {hasPlaylist && (
          <div className="px-1">
            <button onClick={onChangePlaylist} className="press w-full text-center text-[15px] text-red-400 py-2.5">Replace current playlist</button>
          </div>
        )}
        <div className="text-center text-[12px] text-white/35 px-6 leading-relaxed">
          Playlists are yours to supply — nothing is bundled, hosted or recommended. Import can take a moment for large playlists.
        </div>
      </div>
    </Sheet>
  );
}

/* ================= Series detail ================= */

export function SeriesSheet({ folder, meta, onClose, onPlay, continueId }: {
  folder: SeriesFolder; meta?: any; onClose: () => void;
  onPlay: (ep: SeriesEpisode) => void; continueId?: string | null;
}) {
  const seasons = useMemo(
    () => Array.from(new Set(folder.episodes.map((e) => e.seasonNumber))).sort((a, b) => a - b), [folder]);
  const [season, setSeason] = useState(seasons.includes(1) ? 1 : seasons[0] || 1);
  const episodes = folder.episodes.filter((e) => e.seasonNumber === season).sort((a, b) => a.episodeNumber - b.episodeNumber);
  const poster = meta?.poster_path ? `https://image.tmdb.org/t/p/w300${meta.poster_path}` : folder.tmdbPosterUrl || folder.posterUrl;

  return (
    <Sheet open onClose={onClose} tall>
      <div className="pb-6">
        <div className="flex gap-4 px-4 pt-2 pb-4">
          <Poster src={poster} className="w-24 h-36 rounded-lg shrink-0" />
          <div className="min-w-0 flex-1">
            <div className="text-[20px] font-bold leading-tight">{folder.name}</div>
            <div className="text-[13px] text-white/50 mt-0.5">{folder.episodeCount} episodes · {seasons.length} season{seasons.length === 1 ? '' : 's'}</div>
            {meta?.vote_average > 0 && <div className="text-[13px] text-[#ffd60a] mt-1">★ {meta.vote_average.toFixed(1)}</div>}
            {meta?.overview && <div className="text-[13px] text-white/60 mt-1.5 line-clamp-4">{meta.overview}</div>}
            {meta?.genres && <div className="text-[12px] text-white/40 mt-1.5">{meta.genres.map((g: any) => g.name).join(', ')}</div>}
          </div>
        </div>
        {seasons.length > 1 && (
          <div className="scroll-x flex gap-2 px-4 pb-3">
            {seasons.map((s) => <Chip key={s} label={`Season ${s}`} active={s === season} onClick={() => setSeason(s)} />)}
          </div>
        )}
        <div className="ios-card mx-4 divide-y divide-white/5">
          {episodes.map((e) => (
            <button key={e.channel.id} onClick={() => onPlay(e)} className="press w-full text-left flex items-center gap-3 px-3 py-2.5">
              <div className={`w-10 shrink-0 text-center rounded-md py-1 text-[13px] font-mono ${e.channel.id === continueId ? 'bg-[#ff7a2a] text-black' : 'bg-white/5 text-white/50'}`}>E{e.episodeNumber}</div>
              <div className="flex-1 min-w-0">
                <div className="text-[15px] truncate">{e.episodeTitle}</div>
                <div className="text-[11px] text-white/35 truncate">{e.channel.qualityTag || e.channel.group}</div>
              </div>
              <IconPlayCircle className="w-7 h-7 text-white/35" />
            </button>
          ))}
        </div>
      </div>
    </Sheet>
  );
}

/* ================= Profiles ================= */

export function ProfilesSheet({ open, onClose, profiles, activeId, onPick, onAdd, onSetPin, onDelete }: {
  open: boolean; onClose: () => void;
  profiles: Profile[]; activeId: string;
  onPick: (p: Profile) => void;
  onAdd: (name: string) => void;
  onSetPin: (id: string, pin: string) => void;
  onDelete: (id: string) => void;
}) {
  const [name, setName] = useState('');
  return (
    <Sheet open={open} title="Profiles" onClose={onClose}>
      <div className="pb-6">
        <GroupRow title="Switch profile">
          {profiles.map((p) => (
            <Row key={p.id}>
              <button onClick={() => onPick(p)} className="press flex-1 flex items-center gap-3 py-1 text-left text-[16px]">
                <div className="w-9 h-9 rounded-full bg-gradient-to-br from-[#ff7a2a] to-[#ff2d55] flex items-center justify-center text-[14px] font-bold text-black">
                  {p.name.slice(0, 1).toUpperCase()}
                </div>
                <span className="flex-1 truncate">{p.name}</span>
                {p.pin && <span className="text-[11px] text-white/40 mr-1">🔒</span>}
                {p.id === activeId && <span className="text-[#ff7a2a] text-[14px] font-bold">✓</span>}
                <IconChevron className="w-4 h-4 text-white/30" />
              </button>
            </Row>
          ))}
        </GroupRow>
        <GroupRow title="Manage">
          <div className="px-4 py-3 flex gap-2">
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="New profile name"
              className="flex-1 bg-white/5 rounded-xl px-3 py-2 text-[15px] outline-none placeholder:text-white/30" />
            <Button primary onClick={() => { onAdd(name.trim()); setName(''); }} disabled={!name.trim()}>Add</Button>
          </div>
          {profiles.filter((p) => p.id !== 'default').map((p) => (
            <Row key={p.id}>
              <span className="flex-1 truncate text-[15px]">{p.name}</span>
              <input placeholder="PIN" inputMode="numeric" maxLength={6}
                onBlur={(e) => onSetPin(p.id, e.target.value.replace(/\D/g, ''))}
                className="bg-white/5 rounded-lg px-2.5 py-1.5 text-[13px] w-20 outline-none placeholder:text-white/30" />
              <button onClick={() => onDelete(p.id)} className="press p-2 text-red-400"><IconTrash className="w-4.5 h-4.5" /></button>
            </Row>
          ))}
          <div className="px-4 py-3 text-[12px] text-white/35">Each profile keeps its own favourites, history and Continue Watching. A PIN locks profile switching.</div>
        </GroupRow>
      </div>
    </Sheet>
  );
}

/* ================= PIN ================= */

export function PinOverlay({ profile, onResolve, onCancel }: { profile: Profile; onResolve: (ok: boolean) => void; onCancel: () => void }) {
  const [pin, setPin] = useState('');
  const target = profile.pin || '';
  useEffect(() => { setPin(''); }, [profile.id]);
  function tap(d: string) {
    const next = (pin + d).slice(0, 6);
    setPin(next);
    if (next === target) setTimeout(() => onResolve(true), 150);
    else if (next.length === target.length) setTimeout(() => setPin(''), 300);
  }
  if (!target) return null;
  return (
    <div className="fixed inset-0 z-50 bg-black/85 flex items-center justify-center p-6 fade-in">
      <div className="ios-card p-6 w-full max-w-xs space-y-4">
        <div className="text-center">
          <div className="text-[17px] font-semibold">Enter Profile PIN</div>
          <div className="text-[13px] text-white/50 mt-1">{profile.name}</div>
        </div>
        <div className="flex justify-center gap-2">
          {Array.from({ length: target.length }).map((_, i) => (
            <div key={i} className={`w-3 h-3 rounded-full ${i < pin.length ? 'bg-[#ff7a2a]' : 'bg-white/25'}`} />
          ))}
        </div>
        <div className="grid grid-cols-3 gap-2">
          {['1', '2', '3', '4', '5', '6', '7', '8', '9', '', '0', '⌫'].map((d, i) => (
            <button key={i} disabled={!d || d === ''} onClick={() => d === '⌫' ? setPin((p) => p.slice(0, -1)) : tap(d)}
              className="press h-12 rounded-xl bg-white/8 text-[20px] font-medium disabled:opacity-0">
              {d}
            </button>
          ))}
        </div>
        <button onClick={onCancel} className="press w-full text-center text-[15px] text-white/60 py-1">Cancel</button>
      </div>
    </div>
  );
}

/* ================= Search ================= */

export function SearchOverlay({ channels, series, onClose, onPlayChannel, onOpenSeries, favorites }: {
  channels: Channel[]; series: SeriesFolder[]; favorites: Set<string>;
  onClose: () => void; onPlayChannel: (c: Channel) => void; onOpenSeries: (f: SeriesFolder) => void;
}) {
  const [q, setQ] = useState('');
  useEffect(() => { setTimeout(() => document.getElementById('search-field')?.focus(), 60); }, []);
  const ql = q.trim().toLowerCase();

  const { live, movies, seriesMatches } = useMemo(() => {
    if (!ql) return { live: [] as Channel[], movies: [] as Channel[], seriesMatches: [] as SeriesFolder[] };
    return {
      live: channels.filter((c) => (c.contentType || 'LIVE') === 'LIVE' && c.name.toLowerCase().includes(ql)).slice(0, 30),
      movies: channels.filter((c) => c.contentType === 'MOVIE' && c.name.toLowerCase().includes(ql)).slice(0, 30),
      seriesMatches: series.filter((f) => f.name.toLowerCase().includes(ql)).slice(0, 15),
    };
  }, [ql, channels, series]);

  const Section = ({ title, children }: any) => children && (
    <div className="mb-5">
      <div className="px-4 pb-1.5 text-[13px] font-medium uppercase tracking-wide text-white/45">{title}</div>
      <div className="ios-card mx-4 divide-y divide-white/5">{children}</div>
    </div>
  );

  const chRow = (c: Channel) => (
    <Row key={c.id} className="py-1">
      <button onClick={() => onPlayChannel(c)} className="press flex items-center gap-3 flex-1 min-w-0 text-left">
        <Poster src={c.logo} className="w-9 h-9 rounded-md shrink-0" />
        <div className="min-w-0 flex-1">
          <div className="text-[15px] truncate">{c.name}</div>
          <div className="text-[11px] text-white/35 truncate">{c.group}{c.qualityTag ? ` · ${c.qualityTag}` : ''}</div>
        </div>
        <IconPlayCircle className="w-7 h-7 text-white/30" />
      </button>
    </Row>
  );

  return (
    <div className="fixed inset-0 z-40 bg-[#0b0b0d] flex flex-col fade-in">
      <div className="ios-blur px-3 pt-[calc(8px+var(--safe-t,0px))] pb-2 flex items-center gap-2 hairline-b">
        <div className="flex-1 flex items-center bg-white/10 rounded-xl px-3">
          <input id="search-field" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search everything"
            className="flex-1 bg-transparent py-2.5 text-[16px] outline-none placeholder:text-white/35" />
          {q && <button onClick={() => setQ('')} className="press p-1 text-white/50"><IconClose className="w-4 h-4" /></button>}
        </div>
        <button onClick={onClose} className="press text-[15px] text-[#0a84ff] px-1">Cancel</button>
      </div>
      <div className="scroll-y flex-1 pt-4 pb-[calc(20px+var(--safe-b,0px))]">
        {!ql && <div className="pt-24 text-center text-white/35 text-[14px]">Search live channels, films and series</div>}
        {ql && live.length + movies.length + seriesMatches.length === 0 && (
          <div className="pt-24 text-center text-white/35 text-[14px]">No results</div>
        )}
        <Section title="Live">{live.map(chRow)}</Section>
        <Section title="Films">{movies.map(chRow)}</Section>
        <Section title="Series">
          {seriesMatches.map((f) => (
            <Row key={f.name} className="py-1">
              <button onClick={() => onOpenSeries(f)} className="press flex items-center gap-3 flex-1 min-w-0 text-left">
                <Poster src={f.tmdbPosterUrl || f.posterUrl} className="w-9 h-14 rounded-md shrink-0" />
                <div className="min-w-0 flex-1">
                  <div className="text-[15px] truncate">{f.name}</div>
                  <div className="text-[11px] text-white/35">{f.episodeCount} episodes</div>
                </div>
                <IconChevron className="w-4 h-4 text-white/25" />
              </button>
            </Row>
          ))}
        </Section>
      </div>
    </div>
  );
}

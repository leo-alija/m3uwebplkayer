'use client';

import { useEffect, useMemo, useState } from 'react';
import { Channel, Playlist, Profile, SeriesFolder, ImportProgress } from '@/lib/types';
import { Sheet, Button, Chip, GroupRow, Row, IconChevron, IconClose, IconStar, IconPlayCircle, Poster, IconTrash } from './ui';

/* ================= Import ================= */

export function ImportSheet({ open, onClose, url, setUrl, xtream, setXtream, importing, error, progress, onUrl, onFile, onXtream }: {
  open: boolean; onClose: () => void;
  url: string; setUrl: (v: string) => void;
  xtream: { host: string; user: string; pass: string }; setXtream: (v: any) => void;
  importing: boolean; error: string; progress: ImportProgress | null;
  onUrl: () => void; onFile: (f: File) => void; onXtream: () => void;
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
            <div className="px-4 py-4 text-[16px] text-link flex items-center justify-between">
              <span>Choose .m3u file</span><IconChevron className="w-4 h-4 text-white/30" />
            </div>
          </label>
        </GroupRow>

        {error && <div className="mx-4 text-red-400 text-[14px]">{error}</div>}
        {importing && <ImportProgressBar progress={progress} />}
        <div className="text-center text-[12px] text-white/35 px-6 leading-relaxed">
          Playlists are yours to supply — nothing is bundled, hosted or recommended. Import can take a moment for large playlists.
        </div>
      </div>
    </Sheet>
  );
}

/* Download → parse → save progress line, reused by the Settings refresh flow */
export function ImportProgressBar({ progress }: { progress: ImportProgress | null }) {
  if (!progress) {
    return <div className="mx-4 text-white/50 text-[13px]">Fetching the playlist. Large lists can take a while…</div>;
  }
  let label = 'Working…';
  let pct: number | null = null;
  if (progress.phase === 'download') {
    label = 'Downloading playlist';
    if (progress.received != null) {
      const mb = (progress.received / 1024 / 1024).toFixed(1);
      label = `Downloading playlist — ${mb} MB`;
      if (progress.contentTotal) pct = Math.min(100, (progress.received / progress.contentTotal) * 100);
    }
  } else if (progress.phase === 'parse') {
    const { lines = 0, total = 0 } = progress;
    label = total ? `Parsing ${Math.min(lines, total).toLocaleString()} of ${total.toLocaleString()} lines` : 'Parsing playlist';
    if (total) pct = Math.min(100, (lines / total) * 100);
  } else if (progress.phase === 'save') {
    label = 'Saving playlist';
    pct = 100;
  }
  return (
    <div className="mx-4 space-y-1.5" aria-live="polite">
      <div className="text-[13px] text-white/60">{label}…</div>
      <div className="h-1.5 rounded-full bg-white/10 overflow-hidden">
        <div className={`h-full rounded-full bg-accent transition-[width] duration-200 ${pct == null ? 'w-1/3 animate-pulse' : ''}`}
          style={pct != null ? { width: `${pct}%` } : undefined} />
      </div>
    </div>
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
                <div className="w-9 h-9 rounded-full bg-gradient-to-br from-accent to-berry flex items-center justify-center text-[14px] font-bold text-black">
                  {p.name.slice(0, 1).toUpperCase()}
                </div>
                <span className="flex-1 truncate">{p.name}</span>
                {p.pin && <span className="text-[11px] text-white/40 mr-1">🔒</span>}
                {p.id === activeId && <span className="text-accent text-[14px] font-bold">✓</span>}
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
            <div key={i} className={`w-3 h-3 rounded-full ${i < pin.length ? 'bg-accent' : 'bg-white/25'}`} />
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

export function SearchOverlay({ channels, series, onClose, onPlayChannel, onOpenSeries, onOpenMovie, favorites }: {
  channels: Channel[]; series: SeriesFolder[]; favorites: Set<string>;
  onClose: () => void; onPlayChannel: (c: Channel) => void; onOpenSeries: (f: SeriesFolder) => void;
  onOpenMovie: (c: Channel) => void;
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
    <div className="fixed inset-0 z-40 bg-ground flex flex-col fade-in">
      <div className="ios-blur px-3 pt-[calc(8px+var(--safe-t,0px))] pb-2 flex items-center gap-2 hairline-b">
        <div className="flex-1 flex items-center bg-white/10 rounded-xl px-3">
          <input id="search-field" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search everything"
            className="flex-1 bg-transparent py-2.5 text-[16px] outline-none placeholder:text-white/35" />
          {q && <button onClick={() => setQ('')} className="press p-1 text-white/50"><IconClose className="w-4 h-4" /></button>}
        </div>
        <button onClick={onClose} className="press text-[15px] text-link px-1">Cancel</button>
      </div>
      <div className="scroll-y flex-1 pt-4 pb-[calc(20px+var(--safe-b,0px))]">
        {!ql && <div className="pt-24 text-center text-white/35 text-[14px]">Search live channels, films and series</div>}
        {ql && live.length + movies.length + seriesMatches.length === 0 && (
          <div className="pt-24 text-center text-white/35 text-[14px]">No results</div>
        )}
        <Section title="Live">{live.map(chRow)}</Section>
        <Section title="Films">{
          movies.map((c) => (
            <Row key={c.id} className="py-1">
              <button onClick={() => onOpenMovie(c)} className="press flex items-center gap-3 flex-1 min-w-0 text-left">
                <Poster src={c.logo} className="w-9 h-14 rounded-md shrink-0" />
                <div className="min-w-0 flex-1">
                  <div className="text-[15px] truncate">{c.name.replace(/\s*[(\[][^)\]]*[)\]]\)?$/, '')}</div>
                  <div className="text-[11px] text-white/35 truncate">{c.qualityTag || c.group}</div>
                </div>
                <IconChevron className="w-4 h-4 text-white/25" />
              </button>
            </Row>
          ))
        }</Section>
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

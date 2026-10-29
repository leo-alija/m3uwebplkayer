'use client';

import { useEffect, useMemo, useState } from 'react';
import { Channel, Playlist, Profile, SeriesFolder, ImportProgress, Program } from '@/lib/types';
import { parseXmltvDate } from '@/lib/epg';
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

export function ProfilesSheet({ open, onClose, profiles, activeId, onPick, onAdd, onSetPin, onDelete, onToggleKids, onRename }: {
  open: boolean; onClose: () => void;
  profiles: Profile[]; activeId: string;
  onPick: (p: Profile) => void;
  onAdd: (name: string, kids: boolean) => void;
  onSetPin: (id: string, pin: string) => void;
  onDelete: (id: string) => void;
  onToggleKids: (id: string) => void;
  onRename: (id: string, name: string) => void;
}) {
  const [name, setName] = useState('');
  const [kids, setKids] = useState(false);
  return (
    <Sheet open={open} title="Who's watching?" onClose={onClose}>
      <div className="pb-6">
        <GroupRow title="Switch profile">
          {profiles.map((p) => (
            <Row key={p.id}>
              <button onClick={() => onPick(p)} className="press flex-1 flex items-center gap-3 py-1 text-left text-[16px]">
                <div className={`w-9 h-9 rounded-full flex items-center justify-center text-[14px] font-bold text-black ${p.guest ? 'bg-white/25' : 'bg-gradient-to-br from-accent to-berry'}`}>
                  {p.guest ? '👤' : p.name.slice(0, 1).toUpperCase()}
                </div>
                <span className="flex-1 truncate">
                  {p.name}
                  {p.kids && <span className="ml-1.5 text-[10px] font-bold bg-green-500/20 text-green-400 rounded px-1.5 py-0.5 align-middle">KIDS</span>}
                </span>
                {p.pin && <span className="text-[11px] text-white/40 mr-1">🔒</span>}
                {p.id === activeId && <span className="text-accent text-[14px] font-bold">✓</span>}
                <IconChevron className="w-4 h-4 text-white/30" />
              </button>
            </Row>
          ))}
        </GroupRow>
        <GroupRow title="Add profile">
          <div className="px-4 py-3 flex gap-2 items-center">
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="New profile name"
              className="flex-1 bg-white/5 rounded-xl px-3 py-2 text-[15px] outline-none placeholder:text-white/30" />
            <button onClick={() => setKids((v) => !v)}
              className={`press px-3 py-2 rounded-xl text-[13px] font-semibold ${kids ? 'bg-green-500 text-black' : 'bg-white/8 text-white/70'}`} title="Kids profile">Kids</button>
            <Button primary onClick={() => { onAdd(name.trim(), kids); setName(''); setKids(false); }} disabled={!name.trim()}>Add</Button>
          </div>
        </GroupRow>
        <GroupRow title="Manage">
          {profiles.filter((p) => !p.guest && p.id !== 'default').map((p) => (
            <Row key={p.id}>
              <input defaultValue={p.name} onBlur={(e) => { const v = e.target.value.trim(); if (v && v !== p.name) onRename(p.id, v); }}
                className="flex-1 min-w-0 bg-transparent text-[15px] outline-none" />
              <input placeholder="4-digit PIN" inputMode="numeric" maxLength={4}
                onBlur={(e) => onSetPin(p.id, e.target.value.replace(/\D/g, ''))}
                className="bg-white/5 rounded-lg px-2.5 py-1.5 text-[13px] w-24 outline-none placeholder:text-white/30" />
              {p.pin && (
                <button onClick={() => onSetPin(p.id, '')} className="press text-[11px] text-link" title="Remove PIN">Clear</button>
              )}
              <button onClick={() => onToggleKids(p.id)} className={`press px-2 py-1 rounded-lg text-[11px] font-bold ${p.kids ? 'bg-green-500 text-black' : 'bg-white/8 text-white/60'}`}
                title="Kids badge">Kids</button>
              <button onClick={() => onDelete(p.id)} className="press p-2 text-red-400"><IconTrash className="w-4.5 h-4.5" /></button>
            </Row>
          ))}
          <div className="px-4 py-3 text-[12px] text-white/35">
            Each profile keeps its own favourites, history and Continue Watching. A 4-digit PIN locks profile switching and is asked on app start. PINs are stored hashed.
          </div>
        </GroupRow>
      </div>
    </Sheet>
  );
}

/* ================= PIN ================= */

export function PinOverlay({ profile, verify, onResolve, onCancel }: { profile: Profile; verify: (pin: string) => boolean; onResolve: (ok: boolean) => void; onCancel: () => void }) {
  const [pin, setPin] = useState('');
  const target = profile.pin || '';
  useEffect(() => { setPin(''); }, [profile.id]);
  function tap(d: string) {
    const next = (pin + d).slice(0, 6);
    setPin(next);
    if (verify(next)) setTimeout(() => onResolve(true), 150);
    else if (next.length >= 4) setTimeout(() => setPin(''), 300);
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

export type SearchScope = 'all' | 'live' | 'titles';

export function SearchOverlay({ channels, series, favorites, initialScope, epgFor, guideOffsetMinutes, onClose, onPlayChannel, onOpenSeries, onOpenMovie }: {
  channels: Channel[]; series: SeriesFolder[]; favorites: Set<string>;
  initialScope?: SearchScope;
  epgFor: (ch: Channel) => Program[] | undefined;
  guideOffsetMinutes: number;
  onClose: () => void; onPlayChannel: (c: Channel) => void; onOpenSeries: (f: SeriesFolder) => void;
  onOpenMovie: (c: Channel) => void;
}) {
  const [q, setQ] = useState('');
  const [scope, setScope] = useState<SearchScope>(initialScope || 'all');
  useEffect(() => { setTimeout(() => document.getElementById('search-field')?.focus(), 60); }, []);
  const ql = q.trim().toLowerCase();
  const active = ql.length >= 2; /* minimum 2 characters */

  const { live, comingUp, movies, seriesMatches } = useMemo(() => {
    if (!active) return { live: [] as Channel[], comingUp: [] as { ch: Channel; prog: Program }[], movies: [] as Channel[], seriesMatches: [] as SeriesFolder[] };
    const cap = 300;
    const nameMatch = (c: Channel) => c.name.toLowerCase().includes(ql);
    const liveChs = channels.filter((c) => (c.contentType || 'LIVE') === 'LIVE' && nameMatch(c)).slice(0, 60);
    /* "Coming up": guide entries matching the query within the next 24h,
       searched only over channels already surfaced to stay bounded */
    const now = Date.now();
    const coming: { ch: Channel; prog: Program }[] = [];
    if (scope !== 'titles') {
      for (const c of channels.filter(nameMatch).slice(0, 40)) {
        const progs = epgFor(c) || [];
        for (const p of progs) {
          const s = parseXmltvDate(p.start).getTime() + guideOffsetMinutes * 60_000;
          if (p.title.toLowerCase().includes(ql) && s > now && s < now + 24 * 3600_000) {
            coming.push({ ch: c, prog: p });
            break;
          }
        }
        if (coming.length >= 30) break;
      }
      /* also scan the guide of live-matching channels for their own titles */
      for (const c of liveChs.slice(0, 20)) {
        if (coming.some((x) => x.ch.id === c.id)) continue;
        const progs = epgFor(c) || [];
        for (const p of progs) {
          const s = parseXmltvDate(p.start).getTime() + guideOffsetMinutes * 60_000;
          if (p.title.toLowerCase().includes(ql) && s > now && s < now + 24 * 3600_000) {
            coming.push({ ch: c, prog: p });
            break;
          }
        }
        if (coming.length >= 60) break;
      }
    }
    const movies = scope === 'live' ? [] : channels.filter((c) => c.contentType === 'MOVIE' && nameMatch(c)).slice(0, cap / 3);
    const seriesMatches = scope === 'live' ? [] : series.filter((f) => f.name.toLowerCase().includes(ql)).slice(0, 40);
    return { live: scope === 'titles' ? [] : liveChs, comingUp: coming, movies, seriesMatches };
  }, [ql, active, channels, series, scope, epgFor, guideOffsetMinutes]);

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
          <div className="text-[11px] text-white/35 truncate">{c.group}{c.qualityTag ? ` · ${c.qualityTag}` : ''}{favorites.has(c.id) ? ' · ♥' : ''}</div>
        </div>
        <IconPlayCircle className="w-7 h-7 text-white/30" />
      </button>
    </Row>
  );

  const scopes: [SearchScope, string][] = [['all', 'Everything'], ['live', 'Live TV'], ['titles', 'Titles']];
  const total = live.length + comingUp.length + movies.length + seriesMatches.length;

  return (
    <div className="fixed inset-0 z-40 bg-ground flex flex-col fade-in">
      <div className="ios-blur px-3 pt-[calc(8px+var(--safe-t,0px))] pb-2 hairline-b">
        <div className="flex items-center gap-2">
          <div className="flex-1 flex items-center bg-white/10 rounded-xl px-3">
            <input id="search-field" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search everything"
              className="flex-1 bg-transparent py-2.5 text-[16px] outline-none placeholder:text-white/35" />
            {q && <button onClick={() => setQ('')} className="press p-1 text-white/50"><IconClose className="w-4 h-4" /></button>}
          </div>
          <button onClick={onClose} className="press text-[15px] text-link px-1">Cancel</button>
        </div>
        <div className="scroll-x flex gap-2 pt-2">
          {scopes.map(([s, label]) => (
            <button key={s} onClick={() => setScope(s)}
              className={`press px-3.5 py-1.5 rounded-full text-[13px] font-semibold whitespace-nowrap ${scope === s ? 'bg-accent text-black' : 'bg-white/10 text-white/80'}`}>
              {label}
            </button>
          ))}
        </div>
      </div>
      <div className="scroll-y flex-1 pt-4 pb-[calc(20px+var(--safe-b,0px))]">
        {!ql && <div className="pt-24 text-center text-white/35 text-[14px]">Search live channels, films and series</div>}
        {ql && !active && <div className="pt-24 text-center text-white/35 text-[14px]">Keep typing — at least 2 characters</div>}
        {active && total === 0 && (
          <div className="pt-24 text-center text-white/35 text-[14px]">No results</div>
        )}
        <Section title="Channels">{live.slice(0, 120).map(chRow)}</Section>
        <Section title="Coming up">{comingUp.slice(0, 40).map(({ ch, prog }) => (
          <Row key={`${ch.id}:${prog.start}`} className="py-1">
            <button onClick={() => onPlayChannel(ch)} className="press flex items-center gap-3 flex-1 min-w-0 text-left">
              <Poster src={ch.logo} className="w-9 h-9 rounded-md shrink-0" />
              <div className="min-w-0 flex-1">
                <div className="text-[14px] truncate">{prog.title}</div>
                <div className="text-[11px] text-white/35 truncate">
                  {new Date(parseXmltvDate(prog.start).getTime() + guideOffsetMinutes * 60_000).toLocaleString([], { weekday: 'short', hour: '2-digit', minute: '2-digit' })} · {ch.name}
                </div>
              </div>
              <IconPlayCircle className="w-6 h-6 text-white/30" />
            </button>
          </Row>
        ))}</Section>
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

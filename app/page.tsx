'use client';
import { useEffect, useRef, useState, useMemo, useCallback } from 'react';
import { parseM3U, buildXtreamM3uUrl } from '@/lib/m3u';
import { parseXMLTV, nowProgram, parseXmltvDate } from '@/lib/epg';
import { load, save, loadPlaylist, savePlaylist, clearPlaylist as clearPlaylistStore } from '@/lib/storage';
import { groupIntoFolders } from '@/lib/series';
import { getTmdb } from '@/lib/tmdb';
import { downloadVideo, canDownload, getDownloadIndex } from '@/lib/downloads';
import { Channel, Playlist, Program, SeriesFolder, SeriesEpisode, Profile } from '@/lib/types';
import Player from '@/components/player';
import Multiview from '@/components/multiview';
import DetailSheet from '@/components/detail';
import { ImportSheet, ProfilesSheet, PinOverlay, SearchOverlay } from '@/components/sheets';
import { SettingsSheet } from '@/components/settings';
import { Hero, Shelf, LiveTile, PosterCard, Aurora, Skeletons, GenreStrip, type HeroSlide } from '@/components/home-flix';
import { GuideGrid } from '@/components/guide-grid';
import { IconHome, IconLive, IconSeries, IconMovie, IconGuide, IconSearch, IconSettings, IconStar, IconPlus, IconChevron, IconPlayCircle, Poster, Chip, IconClose } from '@/components/ui';

type Tab = 'home' | 'live' | 'series' | 'movies' | 'guide';

const DEFAULT_PROFILE: Profile = {
  id: 'default', name: 'Default', favorites: [], recents: [], hiddenGroups: [], renamed: {},
  channelOrder: [], groupOrder: [], continueWatching: [], watchHistory: [],
};

const isIOS = typeof navigator !== 'undefined' && (/iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1));

export default function Home() {
  const [profiles, setProfiles] = useState<Profile[]>([DEFAULT_PROFILE]);
  const [activeProfileId, setActiveProfileId] = useState('default');
  const [playlist, setPlaylist] = useState<Playlist | null>(null);
  const [overrides, setOverrides] = useState<Record<string, string>>({});
  const [tab, setTab] = useState<Tab>('home');
  const [liveGroupPick, setLiveGroupPick] = useState('all');
  const [liveFilter, setLiveFilter] = useState('');
  const [epg, setEpg] = useState<Record<string, Program[]>>({});
  const [visible, setVisible] = useState<Record<string, number>>({ live: 120, series: 90, movies: 60, guide: 80 });

  const [showImport, setShowImport] = useState(false);
  const [importUrl, setImportUrl] = useState('');
  const [importing, setImporting] = useState(false);
  const [importError, setImportError] = useState('');
  const [xtream, setXtream] = useState({ host: '', user: '', pass: '' });

  const [selected, setSelected] = useState<{ channel: Channel; resume: number } | null>(null);
  const [detail, setDetail] = useState<{ kind: 'movie' | 'series'; title: string; folder?: SeriesFolder; channel?: Channel } | null>(null);
  const [gridView, setGridView] = useState(false);
  const [downloads, setDownloads] = useState<Record<string, { pct: number; done?: boolean }>>({});
  const dlAbort = useRef<Record<string, AbortController>>({});

  const [mv, setMv] = useState<Channel[]>([]);
  const [showMv, setShowMv] = useState(false);

  const [showSearch, setShowSearch] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [showProfiles, setShowProfiles] = useState(false);
  const [showPin, setShowPin] = useState<{ profile: Profile; resolve: (ok: boolean) => void } | null>(null);

  const [tmdbKey, setTmdbKey] = useState('');
  const [meta, setMeta] = useState<Record<string, any>>({});
  const [status, setStatus] = useState('');
  const [showInstallHint, setShowInstallHint] = useState(false);
  const [isStandalone, setIsStandalone] = useState(true);
  const statusTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const activeProfile = profiles.find((p) => p.id === activeProfileId) || profiles[0];

  const updateProfile = useCallback((patch: Partial<Profile>) => {
    setProfiles((prev) => prev.map((p) => (p.id === activeProfileId ? { ...p, ...patch } : p)));
  }, [activeProfileId]);

  const flash = useCallback((msg: string) => {
    setStatus(msg);
    if (statusTimer.current) clearTimeout(statusTimer.current);
    statusTimer.current = setTimeout(() => setStatus(''), 3000);
  }, []);

  /* ---------- load / persist ---------- */
  useEffect(() => {
    const ps = load<Profile[]>('profiles', [DEFAULT_PROFILE]);
    setProfiles(ps.length ? ps : [DEFAULT_PROFILE]);
    setActiveProfileId(load('activeProfileId', 'default'));
    setOverrides(load('groupOverrides', {}));
    setTmdbKey(load('tmdbKey', ''));
    const standalone = (window.navigator as any).standalone === true || window.matchMedia('(display-mode: standalone)').matches;
    setIsStandalone(standalone);
    loadPlaylist<Playlist>().then((pl) => {
      if (pl) {
        setPlaylist(pl);
        if (pl.epgUrl) loadEpg(pl.epgUrl);
      } else {
        if (isIOS && !standalone) setShowInstallHint(true);
        setShowImport(true);
      }
    });
    if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});
  }, []);

  useEffect(() => { save('profiles', profiles); }, [profiles]);
  useEffect(() => { save('activeProfileId', activeProfileId); }, [activeProfileId]);
  useEffect(() => { save('groupOverrides', overrides); }, [overrides]);
  useEffect(() => { save('tmdbKey', tmdbKey); }, [tmdbKey]);

  /* ---------- epg ---------- */
  const epgLower = useMemo(() => {
    const m: Record<string, Program[]> = {};
    for (const k of Object.keys(epg)) m[k.toLowerCase()] = epg[k];
    return m;
  }, [epg]);

  const epgFor = useCallback((ch: Channel): Program[] | undefined => {
    if (ch.tvgId && epg[ch.tvgId]) return epg[ch.tvgId];
    if (ch.tvgId && epgLower[ch.tvgId.toLowerCase()]) return epgLower[ch.tvgId.toLowerCase()];
    if (ch.tvgName && epgLower[ch.tvgName.toLowerCase()]) return epgLower[ch.tvgName.toLowerCase()];
    if (epgLower[ch.name.toLowerCase()]) return epgLower[ch.name.toLowerCase()];
    return undefined;
  }, [epg, epgLower]);

  async function loadEpg(url: string) {
    try {
      const text = await fetchText(url);
      setEpg(parseXMLTV(text));
    } catch { /* feed may be down; guide stays empty */ }
  }

  async function fetchText(url: string) {
    const res = await fetch(`/api/fetch?url=${encodeURIComponent(url)}`);
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      throw new Error(j.error || 'fetch failed');
    }
    return await res.text();
  }

  /* ---------- import ---------- */
  const applyOverrides = useCallback((chs: Channel[]) =>
    chs.map((c) => (overrides[c.id]
      ? { ...c, group: overrides[c.id], groups: [overrides[c.id]] }
      : c)), [overrides]);

  function importPlaylistText(text: string, name: string, epgUrl?: string) {
    const { channels, epgUrl: parsedEpg } = parseM3U(text);
    const chs = applyOverrides(channels);
    const pl: Playlist = { name, channels: chs, epgUrl: epgUrl || parsedEpg, importedAt: Date.now() };
    setPlaylist(pl);
    savePlaylist(pl);
    setShowImport(false);
    setTab('home');
    flash(`Loaded ${chs.length.toLocaleString()} items`);
    if (pl.epgUrl) loadEpg(pl.epgUrl);
  }

  async function importFromUrl() {
    setImporting(true); setImportError('');
    try {
      const text = await fetchText(importUrl.trim());
      importPlaylistText(text, importUrl.trim());
    } catch (e: any) { setImportError(e?.message || 'Import failed — check the URL'); }
    finally { setImporting(false); }
  }

  function importFromFile(file: File) {
    setImporting(true); setImportError('');
    const reader = new FileReader();
    reader.onload = () => {
      try { importPlaylistText(String(reader.result || ''), file.name); }
      catch (e: any) { setImportError(e?.message || 'Import failed'); }
      finally { setImporting(false); }
    };
    reader.readAsText(file);
  }

  async function importXtream() {
    setImporting(true); setImportError('');
    try {
      const url = buildXtreamM3uUrl(xtream.host.trim(), xtream.user, xtream.pass);
      const text = await fetchText(url);
      const epgUrl = `${xtream.host.trim().replace(/\/+$/, '')}/xmltv.php?username=${encodeURIComponent(xtream.user)}&password=${encodeURIComponent(xtream.pass)}`;
      importPlaylistText(text, xtream.host.trim(), epgUrl);
    } catch (e: any) { setImportError(e?.message || 'Import failed — check the login'); }
    finally { setImporting(false); }
  }

  /* ---------- backup ---------- */
  async function exportData() {
    const data = { v: 1, profiles, activeProfileId, groupOverrides: overrides, tmdbKey, playlist };
    const blob = new Blob([JSON.stringify(data)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'm3u-webplayer-backup.json';
    a.click();
    URL.revokeObjectURL(a.href);
    flash('Backup downloaded');
  }

  function importData(f: File) {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const d = JSON.parse(String(reader.result));
        if (d.profiles) { setProfiles(d.profiles); save('profiles', d.profiles); }
        if (d.activeProfileId) { setActiveProfileId(d.activeProfileId); save('activeProfileId', d.activeProfileId); }
        if (d.groupOverrides) { setOverrides(d.groupOverrides); save('groupOverrides', d.groupOverrides); }
        if (typeof d.tmdbKey === 'string') { setTmdbKey(d.tmdbKey); save('tmdbKey', d.tmdbKey); }
        if (d.playlist) { setPlaylist(d.playlist); savePlaylist(d.playlist); }
        flash('Backup restored');
      } catch { flash('Invalid backup file'); }
    };
    reader.readAsText(f);
  }

  async function doClearPlaylist() {
    await clearPlaylistStore();
    setPlaylist(null);
    setEpg({});
    flash('Playlist removed');
  }

  /* ---------- profile ---------- */
  function pickProfile(profile: Profile) {
    if (!profile.pin) { setActiveProfileId(profile.id); setShowProfiles(false); return; }
    setShowPin({ profile, resolve: (ok) => { if (ok) { setActiveProfileId(profile.id); setShowProfiles(false); } setShowPin(null); } });
  }

  /* ---------- playback ---------- */
  const resumeMap = useMemo(() => {
    const m: Record<string, { time: number; duration?: number }> = {};
    for (const cw of activeProfile.continueWatching) m[cw.channelId] = { time: cw.time, duration: cw.duration };
    return m;
  }, [activeProfile.continueWatching]);

  const selectChannel = useCallback((ch: Channel, resume?: number) => {
    const r = resume ?? resumeMap[ch.id]?.time ?? 0;
    setSelected({ channel: ch, resume: !ch.contentType || ch.contentType === 'LIVE' ? 0 : r });
    updateProfile({
      recents: [ch.id, ...activeProfile.recents.filter((x) => x !== ch.id)].slice(0, 30),
      watchHistory: [ch.id, ...activeProfile.watchHistory.filter((x) => x !== ch.id)].slice(0, 200),
    });
    const type = ch.contentType === 'MOVIE' ? 'movie' : ch.contentType === 'SERIES' ? 'tv' : null;
    if (type && !meta[`${type}:${ch.name}`]) {
      getTmdb(type as 'movie' | 'tv', ch.name, tmdbKey).then((m) => { if (m) setMeta((prev) => ({ ...prev, [`${type}:${ch.name}`]: m })); });
    }
  }, [activeProfile, updateProfile, resumeMap, tmdbKey, meta]);

  function onProgress(channelId: string, time: number, duration: number) {
    const ch = playlist?.channels.find((c) => c.id === channelId);
    if (!ch || !ch.contentType || ch.contentType === 'LIVE') return;
    const others = activeProfile.continueWatching.filter((c) => c.channelId !== channelId);
    const nearEnd = duration > 0 && time > duration - 30;
    const next = nearEnd
      ? others
      : [{ channelId, time, duration: Number.isFinite(duration) ? duration : 0, updatedAt: Date.now() }, ...others].slice(0, 50);
    updateProfile({ continueWatching: next });
  }

  function toggleFavorite(id: string) {
    const next = activeProfile.favorites.includes(id)
      ? activeProfile.favorites.filter((x) => x !== id)
      : [...activeProfile.favorites, id];
    updateProfile({ favorites: next });
  }

  function addToMv(ch: Channel) {
    setMv((prev) => (prev.find((x) => x.id === ch.id) ? prev : [...prev, ch].slice(0, 6)));
    setSelected(null);
    setShowMv(true);
  }

  /* ---------- detail / metadata ---------- */
  function openDetail(kind: 'movie' | 'series', title: string, target: { folder?: SeriesFolder; channel?: Channel }) {
    setDetail({ kind, title, ...target });
    const key = `${kind === 'series' ? 'tv' : 'movie'}:${title}`;
    if (!meta[key]) {
      getTmdb(kind === 'series' ? 'tv' : 'movie', title, tmdbKey).then((m) => { if (m) setMeta((prev) => ({ ...prev, [key]: m })); });
    }
  }

  function detailPlaySection() {
    if (!detail) return;
    if (detail.kind === 'movie' && detail.channel) {
      const ch = detail.channel;
      setDetail(null);
      selectChannel(ch);
    } else if (detail.kind === 'series' && detail.folder) {
      const first = detail.folder.episodes.find((e) => e.seasonNumber === (detail.folder!.episodes[0]?.seasonNumber ?? 1));
      if (first) { setDetail(null); selectChannel(first.channel); }
    }
  }

  function detailPlayEpisode(ep: SeriesEpisode) {
    setDetail(null);
    selectChannel(ep.channel);
  }

  /* ---------- downloads (offline) ---------- */
  useEffect(() => {
    (async () => {
      const idx = await getDownloadIndex();
      const m: Record<string, { pct: number; done?: boolean }> = {};
      for (const d of idx) m[d.id] = { pct: 100, done: true };
      setDownloads(m);
    })();
  }, []);

  async function startDownload(ch: Channel) {
    if (downloads[ch.id]?.done || dlAbort.current[ch.id]) { flash('Already saved offline'); return; }
    if (!canDownload(ch.url)) { flash('Only direct files (mp4/mkv…) can be saved offline'); return; }
    const ac = new AbortController();
    dlAbort.current[ch.id] = ac;
    setDownloads((m) => ({ ...m, [ch.id]: { pct: 0 } }));
    try {
      await downloadVideo(ch.id, ch.url, ch.name, (pct) => setDownloads((m) => ({ ...m, [ch.id]: { pct } })), ac.signal);
      setDownloads((m) => ({ ...m, [ch.id]: { pct: 100, done: true } }));
      flash('Saved for offline');
    } catch (e: any) {
      setDownloads((m) => { const { [ch.id]: _drop, ...rest } = m; return rest; });
      if (e?.name !== 'AbortError') flash(e?.message || 'Download failed');
    } finally {
      delete dlAbort.current[ch.id];
    }
  }

  /* ---------- derived ---------- */
  const channels = playlist?.channels || [];
  const favorites = activeProfile.favorites;
  const hiddenGroups = activeProfile.hiddenGroups;
  const renamed = activeProfile.renamed;

  const allGroups = useMemo(() => Array.from(new Set(channels.flatMap((c) => c.groups || [c.group || 'Uncategorized']))), [channels]);

  const groupCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const c of channels) for (const g of (c.groups || [c.group || 'Uncategorized'])) counts[g] = (counts[g] || 0) + 1;
    return counts;
  }, [channels]);

  const groups = useMemo(() => {
    const visible = allGroups.filter((g) => !hiddenGroups.includes(g));
    const order = activeProfile.groupOrder;
    return [...visible].sort((a, b) => {
      const ia = order.indexOf(a), ib = order.indexOf(b);
      const ra = ia === -1 ? Infinity : ia, rb = ib === -1 ? Infinity : ib;
      return ra !== rb ? ra - rb : (groupCounts[b] || 0) - (groupCounts[a] || 0);
    });
  }, [allGroups, hiddenGroups, activeProfile.groupOrder, groupCounts]);

  const liveChannels = useMemo(() => channels.filter((c) => !c.contentType || c.contentType === 'LIVE'), [channels]);
  const movieChannels = useMemo(() => channels.filter((c) => c.contentType === 'MOVIE'), [channels]);
  const seriesChannels = useMemo(() => channels.filter((c) => c.contentType === 'SERIES'), [channels]);
  const seriesFolders = useMemo(() => groupIntoFolders(seriesChannels), [seriesChannels]);
  const favoriteChannels = useMemo(() => channels.filter((c) => favorites.includes(c.id)), [channels, favorites]);

  const liveList = useMemo(() => {
    const g = liveGroupPick;
    let list = liveChannels;
    if (g !== 'all') list = list.filter((c) => (c.groups || [c.group || 'Uncategorized']).includes(g));
    if (liveFilter) list = list.filter((c) => c.name.toLowerCase().includes(liveFilter.toLowerCase()));
    return list;
  }, [liveChannels, liveGroupPick, liveFilter]);

  const continueEntries = useMemo(() =>
    [...activeProfile.continueWatching]
      .sort((a: any, b: any) => (b.updatedAt || 0) - (a.updatedAt || 0))
      .map((cw: any) => {
        const ch = channels.find((c) => c.id === cw.channelId);
        return ch ? { ch, time: cw.time, duration: cw.duration, pct: cw.duration ? Math.min(100, (cw.time / cw.duration) * 100) : 0 } : null;
      })
      .filter(Boolean)
      .slice(0, 12) as { ch: Channel; time: number; duration: number; pct: number }[],
  [activeProfile.continueWatching, channels]);

  const recentChannels = useMemo(() =>
    activeProfile.recents.map((id) => channels.find((c) => c.id === id)).filter(Boolean).slice(0, 14) as Channel[],
  [activeProfile.recents, channels]);

  /* ---------- hero slides ---------- */
  const heroSlides = useMemo<HeroSlide[]>(() => {
    const out: HeroSlide[] = [];
    const seen = new Set<string>();
    for (const e of continueEntries.slice(0, 2)) {
      const c = e.ch;
      if (seen.has(c.id)) continue;
      seen.add(c.id);
      out.push({ kind: c.contentType === 'SERIES' ? 'series' : c.contentType === 'MOVIE' ? 'movie' : 'live', ch: c, folder: c.contentType === 'SERIES' ? seriesFolders.find((f) => f.episodes.some((x) => x.channel.id === c.id)) : undefined });
    }
    for (const c of continueEntries.map((e) => e.ch)) seen.add(c.id);
    for (const f of seriesFolders.slice(0, 2)) if (!seen.has(f.name)) { seen.add(f.name); out.push({ kind: 'series', folder: f }); }
    for (const c of movieChannels.filter((m) => m.logo).slice(0, 2)) if (!seen.has(c.id)) { seen.add(c.id); out.push({ kind: 'movie', ch: c }); }
    const qRank = (t: string | null | undefined) => ({ SD: 1, HD: 2, FHD: 3, UHD: 4, '4K': 5 } as Record<string, number>)[t || ''] || 0;
    const topLive = liveChannels.filter((c) => c.logo).sort((a, b) => qRank(b.qualityTag) - qRank(a.qualityTag));
    for (const c of topLive) if (out.length < 5) { seen.add(c.id); out.push({ kind: 'live', ch: c }); }
    return out.slice(0, 5);
  }, [continueEntries, seriesFolders, movieChannels, liveChannels]);

  /* fetch meta for flix-style hero slides */
  const heroKey = heroSlides.map((s) => s.kind === 'live' ? s.ch?.id : (s.folder?.name || s.ch?.name)).join('|');
  useEffect(() => {
    let gone = false;
    (async () => {
      for (const s of heroSlides.slice(0, 3)) {
        if (s.kind === 'live') continue;
        const title = s.kind === 'series' ? s.folder?.name : s.ch?.name;
        if (!title) continue;
        const key = `${s.kind === 'series' ? 'tv' : 'movie'}:${title}`;
        if (meta[key]) continue;
        const m = await getTmdb(s.kind === 'series' ? 'tv' : 'movie', title, tmdbKey);
        if (gone) return;
        if (m) setMeta((prev) => ({ ...prev, [key]: m }));
      }
    })();
    return () => { gone = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [heroKey]);

  /* opened player context */
  const nowNext = useMemo(() => {
    if (!selected) return undefined;
    const progs = epgFor(selected.channel);
    if (!progs?.length) return { now: undefined, upcoming: [] as Program[] };
    const now = nowProgram(progs);
    const nowEnd = now ? parseXmltvDate(now.stop) : new Date(0);
    const upcoming = progs.filter((p) => parseXmltvDate(p.start) >= nowEnd).slice(0, 12);
    return { now, upcoming };
  }, [selected, epgFor]);

  const playerEpisodes = useMemo(() => {
    if (!selected?.channel || selected.channel.contentType !== 'SERIES') return undefined;
    const folder = seriesFolders.find((f) => f.episodes.some((e) => e.channel.id === selected.channel.id));
    return folder?.episodes;
  }, [selected, seriesFolders]);

  const tabTitle: Record<Tab, string> = { home: 'Home', live: 'Live TV', series: 'Series', movies: 'Films', guide: 'Guide' };

  return (
    <div className="min-h-dvh bg-[#0b0b0d]">
      {/* Top mini bar */}
      <header className="fixed top-0 inset-x-0 z-30 ios-blur">
        <div className="max-w-2xl mx-auto px-3 pt-[calc(6px+var(--safe-t,0px))] pb-2 flex items-center gap-1 hairline-b">
          <button onClick={() => setShowProfiles(true)} className="press w-9 h-9 rounded-full bg-gradient-to-br from-[#ff7a2a] to-[#ff2d55] flex items-center justify-center text-[15px] font-bold text-black">
            {activeProfile?.name.slice(0, 1).toUpperCase()}
          </button>
          <div className="flex-1 text-center text-[16px] font-semibold truncate">{tabTitle[tab]}</div>
          <button onClick={() => setShowSearch(true)} className="press p-2 text-white/80" aria-label="Search"><IconSearch className="w-6 h-6" /></button>
          <button onClick={() => setShowSettings(true)} className="press p-2 text-white/80" aria-label="Settings"><IconSettings className="w-6 h-6" /></button>
        </div>
      </header>

      <main className="max-w-2xl mx-auto pt-[calc(50px+var(--safe-t,0px))] pb-[calc(72px+var(--safe-b,0px))]">
        {!playlist && (
          importing ? (
            <Skeletons />
          ) : (
            <div className="px-8 pt-16 text-center space-y-4">
              <Aurora />
              <div className="relative text-6xl">🍿</div>
              <div className="relative text-[22px] font-extrabold tracking-tight">Your own Netflix</div>
              <div className="relative text-[14px] text-white/50 leading-relaxed">Import a playlist — M3U, M3U8 or an Xtream login. Posters, a real programme guide, Continue Watching and multiview arrive on their own.</div>
              <button onClick={() => setShowImport(true)} className="press relative inline-flex items-center gap-2 bg-[#ff7a2a] text-black font-bold px-6 py-3.5 rounded-2xl text-[16px] shadow-lg shadow-orange-900/30">
                <IconPlus className="w-5 h-5" /> Add playlist
              </button>
            </div>
          )
        )}

        {playlist && (
          <div className="relative">
            {tab === 'home' && (
              <>
                <Hero slides={heroSlides} isFavSet={new Set(favorites)}
                  onFav={toggleFavorite}
                  onPlay={(s) => {
                    if (s.kind === 'live' && s.ch) selectChannel(s.ch);
                    else if (s.kind === 'series' && s.folder) openDetail('series', s.folder.name, { folder: s.folder });
                    else if (s.kind === 'movie' && s.ch) selectChannel(s.ch, resumeMap[s.ch.id]?.time);
                  }}
                  onInfo={(s) => {
                    if (s.kind === 'series' && s.folder) openDetail('series', s.folder.name, { folder: s.folder });
                    if (s.kind === 'movie' && s.ch) openDetail('movie', s.ch.name, { channel: s.ch });
                  }} />

                <GenreStrip groups={groups.slice(0, 12)} counts={groupCounts} onPick={(g) => { setLiveGroupPick(g); setTab('live'); }} />

                {continueEntries.length > 0 && (
                  <Shelf title="Continue watching">
                    {continueEntries.map(({ ch, pct, time }) => (
                      <PosterCard key={ch.id} poster={ch.contentType === 'MOVIE' || ch.contentType === 'SERIES' ? ch.logo : undefined}
                        title={ch.name} showProgress={pct}
                        onClick={() => selectChannel(ch, time)} />
                    ))}
                  </Shelf>
                )}

                {favoriteChannels.length > 0 && (
                  <Shelf title="Favourites">
                    {favoriteChannels.slice(0, 20).map((ch) => (
                      ch.contentType === 'MOVIE' || ch.contentType === 'SERIES'
                        ? <PosterCard key={ch.id} poster={ch.logo} title={ch.name} onClick={() => selectChannel(ch)} />
                        : <LiveTile key={ch.id} ch={ch} onClick={() => selectChannel(ch)} />
                    ))}
                  </Shelf>
                )}

                {recentChannels.length > 0 && (
                  <Shelf title="Recently watched">
                    {recentChannels.map((ch) => (
                      ch.contentType === 'MOVIE' || ch.contentType === 'SERIES'
                        ? <PosterCard key={ch.id} poster={ch.logo} title={ch.name} onClick={() => selectChannel(ch)} />
                        : <LiveTile key={ch.id} ch={ch} onClick={() => selectChannel(ch)} />
                    ))}
                  </Shelf>
                )}

                {groups.slice(0, 5).map((g) => {
                  const list = liveChannels.filter((c) => (c.groups || [c.group || 'Uncategorized']).includes(g)).slice(0, 14);
                  if (!list.length) return null;
                  return (
                    <Shelf key={g} title={renamed[g] || g} onSeeAll={() => { setLiveGroupPick(g); setTab('live'); }}>
                      {list.map((ch) => <LiveTile key={ch.id} ch={ch} onClick={() => selectChannel(ch)} />)}
                    </Shelf>
                  );
                })}

                {seriesFolders.length > 0 && (
                  <Shelf title="Series" onSeeAll={() => setTab('series')}>
                    {seriesFolders.slice(0, 14).map((f) => (
                      <PosterCard key={f.name} poster={f.tmdbPosterUrl || f.posterUrl} title={f.name} subtitle={`${f.episodeCount} eps`}
                        onClick={() => openDetail('series', f.name, { folder: f })} />
                    ))}
                  </Shelf>
                )}

                {movieChannels.length > 0 && (
                  <Shelf title="Films" onSeeAll={() => setTab('movies')}>
                    {movieChannels.filter((c) => c.logo).slice(0, 14).map((ch) => (
                      <PosterCard key={ch.id} poster={ch.logo} title={ch.name.replace(/\s*[(\[][^)\]]*[)\]]\)?$/, '')}
                        subtitle={ch.qualityTag || undefined}
                        onClick={() => openDetail('movie', ch.name, { channel: ch })} />
                    ))}
                  </Shelf>
                )}

                <div className="px-4 mt-8 mb-2 text-[11px] text-white/25">
                  {playlist.channels.length.toLocaleString()} items · imported {new Date(playlist.importedAt).toLocaleDateString()}
                </div>
              </>
            )}

            {tab === 'live' && (
              <LiveTab list={liveList} groups={groups} group={liveGroupPick} setGroup={setLiveGroupPick}
                filter={liveFilter} setFilter={setLiveFilter} visibleCount={visible.live}
                loadMore={() => setVisible((v) => ({ ...v, live: v.live + 240 }))}
                epgFor={epgFor} renamed={renamed} favorites={new Set(favorites)} toggleFav={toggleFavorite}
                onPlay={selectChannel} grid={gridView} setGrid={setGridView} />
            )}

            {tab === 'series' && (
              <GridTab items={seriesFolders} kind="series" visibleCount={visible.series}
                loadMore={() => setVisible((v) => ({ ...v, series: v.series + 120 }))}
                onOpen={(f: SeriesFolder) => openDetail('series', f.name, { folder: f })} />
            )}

            {tab === 'movies' && (
              <GridTab items={movieChannels} kind="movie" visibleCount={visible.movies}
                loadMore={() => setVisible((v) => ({ ...v, movies: v.movies + 90 }))}
                onOpen={(ch: Channel) => openDetail('movie', ch.name, { channel: ch })} />
            )}

            {tab === 'guide' && (
              <GuideGrid channels={liveList.slice(0, visible.guide)} epgFor={epgFor}
                onPlay={selectChannel} onCatchup={(ch: Channel) => selectChannel(ch)}
                loadMore={() => setVisible((v) => ({ ...v, guide: v.guide + 120 }))}
                total={liveList.length} />
            )}
          </div>
        )}
      </main>

      {/* Tab bar */}
      <nav className="fixed bottom-0 inset-x-0 z-30 ios-blur hairline-t">
        <div className="flex justify-around max-w-2xl mx-auto" style={{ paddingBottom: 'var(--safe-b, 0px)' }}>
          {([['home', 'Home', IconHome], ['live', 'Live TV', IconLive], ['series', 'Series', IconSeries], ['movies', 'Films', IconMovie], ['guide', 'Guide', IconGuide]] as [Tab, string, any][]).map(([t, title, Icon]) => (
            <button key={t} onClick={() => setTab(t)} className="press flex flex-col items-center justify-center w-16 h-[56px]">
              <Icon className={`w-[22px] h-[22px] ${tab === t ? 'text-[#ff7a2a]' : 'text-white/55'}`} />
              <span className={`text-[10px] mt-0.5 ${tab === t ? 'text-[#ff7a2a] font-semibold' : 'text-white/55'}`}>{title}</span>
            </button>
          ))}
        </div>
      </nav>

      {/* Player */}
      {selected && (
        <Player
          channel={selected.channel}
          resume={selected.resume}
          isFav={favorites.includes(selected.channel.id)}
          nowNext={nowNext}
          episodes={playerEpisodes}
          meta={selected.channel.contentType === 'MOVIE' ? meta[`movie:${selected.channel.name}`] : meta[`tv:${selected.channel.name}`]}
          onClose={() => setSelected(null)}
          onToggleFav={() => toggleFavorite(selected.channel.id)}
          onAddMv={() => addToMv(selected.channel)}
          onProgress={onProgress}
          onPlayEpisode={(ep) => selectChannel(ep.channel)}
        />
      )}

      {showMv && <Multiview items={mv}
        onExpand={(ch) => { setShowMv(false); selectChannel(ch); }}
        onRemove={(id) => setMv((p) => p.filter((x) => x.id !== id))}
        onClear={() => { setShowMv(false); }} />}

      <ImportSheet open={showImport} onClose={() => setShowImport(false)}
        url={importUrl} setUrl={setImportUrl}
        xtream={xtream} setXtream={setXtream}
        importing={importing} error={importError}
        onUrl={importFromUrl} onFile={importFromFile} onXtream={importXtream} />

      {detail && (
        <DetailSheet kind={detail.kind} title={detail.title} folder={detail.folder} channel={detail.channel}
          meta={meta[`${detail.kind === 'series' ? 'tv' : 'movie'}:${detail.title}`] || null}
          isFav={detail.channel ? favorites.includes(detail.channel.id) : false}
          onFav={() => detail.channel && toggleFavorite(detail.channel.id)}
          onPlayMovie={detailPlaySection}
          onPlayEpisode={detailPlayEpisode}
          dl={downloads}
          onDownload={startDownload}
          onClose={() => setDetail(null)} />
      )}

      <SettingsSheet open={showSettings} onClose={() => setShowSettings(false)}
        playlist={playlist} groups={groups} allGroups={allGroups} hiddenCount={hiddenGroups.length}
        tmdbKey={tmdbKey} setTmdbKey={setTmdbKey} status={status}
        hideGroup={(g) => { updateProfile({ hiddenGroups: [...hiddenGroups, g] }); flash(`Hidden “${g}”`); }}
        renameGroup={(g, n) => updateProfile({ renamed: { ...activeProfile.renamed, [g]: n } })}
        reorderGroup={(g, dir) => {
          const order = activeProfile.groupOrder.length ? activeProfile.groupOrder : [...groups];
          const i = order.indexOf(g);
          const j = i + dir;
          if (i >= 0 && j >= 0 && j < order.length) {
            [order[i], order[j]] = [order[j], order[i]];
            updateProfile({ groupOrder: [...order] });
          }
        }}
        unhideAll={() => updateProfile({ hiddenGroups: [] })}
        moveToGroup={(channelId, g) => {
          setOverrides((prev) => ({ ...prev, [channelId]: g }));
          setPlaylist((pl) => (pl ? { ...pl, channels: pl.channels.map((c) => (c.id === channelId ? { ...c, group: g, groups: [g] } : c)) } : pl));
          savePlaylist(playlist!);
          flash('Moved');
        }}
        allChannels={channels}
        onOpenImport={() => { setShowSettings(false); setShowImport(true); }}
        onOpenProfiles={() => setShowProfiles(true)}
        onExportData={exportData} onImportData={importData}
        onClearPlaylist={doClearPlaylist}
        isStandalone={isStandalone} playbackCount={continueEntries.length} mvCount={mv.length} />

      <ProfilesSheet open={showProfiles} onClose={() => setShowProfiles(false)} profiles={profiles} activeId={activeProfileId}
        onPick={pickProfile}
        onAdd={(name) => { if (!name) return; const p = { ...DEFAULT_PROFILE, id: `p_${Date.now()}`, name }; setProfiles((prev) => [...prev, p]); flash(`Profile “${name}” added`); }}
        onSetPin={(pid, pin) => setProfiles((prev) => prev.map((p) => (p.id === pid ? { ...p, pin: pin || undefined } : p)))}
        onDelete={(pid) => setProfiles((prev) => (prev.length > 1 ? prev.filter((p) => p.id !== pid) : prev))} />

      {showPin && <PinOverlay profile={showPin.profile} onResolve={showPin.resolve} onCancel={() => showPin.resolve(false)} />}

      {showSearch && (
        <SearchOverlay channels={channels} series={seriesFolders} favorites={new Set(favorites)}
          onClose={() => setShowSearch(false)} onPlayChannel={(c) => { setShowSearch(false); selectChannel(c); }}
          onOpenSeries={(f) => { setShowSearch(false); openDetail('series', f.name, { folder: f }); }}
          onOpenMovie={(c) => { setShowSearch(false); openDetail('movie', c.name, { channel: c }); }} />
      )}

      {status && (
        <div className="fixed bottom-[calc(66px+var(--safe-b,0px)+12px)] inset-x-0 z-30 flex justify-center pointer-events-none fade-in">
          <div className="bg-white text-black text-[13px] font-semibold px-4 py-2 rounded-full shadow-xl">{status}</div>
        </div>
      )}
    </div>
  );
}

/* ================= Live tab ================= */

function LiveTab({ list, groups, group, setGroup, filter, setFilter, visibleCount, loadMore, epgFor, renamed, favorites, toggleFav, onPlay, grid, setGrid }: any) {
  const now = Date.now();
  return (
    <div>
      <div className="scroll-x flex gap-2 px-4 py-2.5">
        <Chip label="All" active={group === 'all'} onClick={() => setGroup('all')} />
        {groups.map((g: string) => <Chip key={g} label={renamed[g] || g} active={group === g} onClick={() => setGroup(g)} />)}
      </div>
      <div className="px-4 pb-2 flex gap-2 items-center">
        <input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Filter channels"
          className="flex-1 bg-white/8 rounded-xl px-3.5 py-2.5 text-[16px] outline-none placeholder:text-white/30" />
        <button onClick={() => setGrid(!grid)} className="press bg-white/8 rounded-xl px-3 py-2.5 text-[13px] font-semibold text-white/80">{grid ? '▦ List' : '▥ Grid'}</button>
      </div>

      {grid ? (
        <div className="grid grid-cols-3 gap-3 px-4 py-1 md:grid-cols-4">
          {list.slice(0, visibleCount).map((ch: Channel) => <LiveTile key={ch.id} ch={ch} onClick={() => onPlay(ch)} />)}
        </div>
      ) : (
        <div className="ios-card mx-4 divide-y divide-white/5">
          {list.slice(0, visibleCount).map((ch: Channel) => {
            const progs = epgFor(ch);
            const nowP = progs?.find((p2: Program) => {
              const s = parseXmltvDate(p2.start).getTime(), e = parseXmltvDate(p2.stop).getTime();
              return s <= now && now < e;
            });
            return (
              <div key={ch.id} className="flex items-center gap-3 px-3 py-2.5 hairline-b last:border-0">
                <button onClick={() => onPlay(ch)} className="press flex items-center gap-3 flex-1 min-w-0 text-left">
                  <Poster src={ch.logo} className="w-10 h-10 rounded-lg shrink-0" />
                  <div className="flex-1 min-w-0">
                    <div className="text-[15px] truncate flex items-center gap-1.5">
                      <span className="truncate font-medium">{ch.name}</span>
                      {ch.qualityTag && <span className="text-[10px] text-white/40 shrink-0">{ch.qualityTag}</span>}
                    </div>
                    {nowP ? (
                      <div className="text-[11px] text-white/45 truncate mt-0.5">Now: {nowP.title}</div>
                    ) : (
                      <div className="text-[11px] text-white/35 truncate mt-0.5">{(ch.groups || [ch.group]).join(' · ')}</div>
                    )}
                  </div>
                </button>
                <button onClick={() => toggleFav(ch.id)} className={`press p-2 ${favorites.has(ch.id) ? 'text-[#ff7a2a]' : 'text-white/25'}`}>
                  <IconStar filled={favorites.has(ch.id)} className="w-5 h-5" />
                </button>
              </div>
            );
          })}
        </div>
      )}

      {list.length > visibleCount && (
        <div className="py-3 text-center">
          <button onClick={loadMore} className="press text-[14px] text-[#0a84ff]">Show more ({(list.length - visibleCount).toLocaleString()} left)</button>
        </div>
      )}
    </div>
  );
}

/* ================= Films/Series grid tab ================= */

function GridTab({ items, kind, visibleCount, loadMore, onOpen, favSet }: any) {
  return (
    <div>
      <div className="grid grid-cols-3 gap-3 px-4 py-2 md:grid-cols-4">
        {items.slice(0, visibleCount).map((it: any) => (
          kind === 'series' ? (
            <button key={it.name} onClick={() => onOpen(it)} className="press text-left" title={it.name}>
              <div className="rounded-xl overflow-hidden" style={{ aspectRatio: '2/3' }}>
                <Poster src={it.tmdbPosterUrl || it.posterUrl} label={it.name} className="w-full h-full" />
              </div>
              <div className="mt-1.5 text-[12px] font-semibold truncate">{it.name}</div>
              <div className="text-[10px] text-white/35">{it.episodeCount} eps</div>
            </button>
          ) : (
            <button key={it.id} onClick={() => onOpen(it)} className="press text-left" title={it.name}>
              <div className="rounded-xl overflow-hidden" style={{ aspectRatio: '2/3' }}>
                <Poster src={it.logo} label={it.name.replace(/\s*[(\[][^)\]]*[)\]]\)?$/, '')} className="w-full h-full" />
                {it.qualityTag && <div className="absolute bottom-1 left-1 text-[9px] font-bold bg-black/60 px-1 rounded">vod</div>}
              </div>
              <div className="mt-1.5 text-[12px] font-semibold truncate">{it.name.replace(/\s*[(\[][^)\]]*[)\]]\)?$/, '')}</div>
            </button>
          )
        ))}
      </div>
      {items.length > visibleCount && (
        <div className="py-3 text-center">
          <button onClick={loadMore} className="press text-[14px] text-[#0a84ff]">Show more ({(items.length - visibleCount).toLocaleString()} left)</button>
        </div>
      )}
    </div>
  );
}


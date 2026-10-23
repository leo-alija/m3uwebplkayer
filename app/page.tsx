'use client';
import { useEffect, useRef, useState, useMemo, useCallback } from 'react';
import { parseM3U, buildXtreamM3uUrl } from '@/lib/m3u';
import { parseXMLTV, nowProgram, parseXmltvDate } from '@/lib/epg';
import { load, save, loadPlaylist, savePlaylist, clearPlaylist as clearPlaylistStore } from '@/lib/storage';
import { groupIntoFolders } from '@/lib/series';
import { Channel, Playlist, Program, SeriesFolder, SeriesEpisode, Profile } from '@/lib/types';
import Hls from 'hls.js';
import Player from '@/components/player';
import Multiview from '@/components/multiview';
import { ImportSheet, SeriesSheet, ProfilesSheet, PinOverlay, SearchOverlay } from '@/components/sheets';
import { SettingsSheet } from '@/components/settings';
import { IconHome, IconLive, IconSeries, IconMovie, IconGuide, IconSearch, IconSettings, IconStar, IconPlus, IconChevron, IconPlayCircle, Poster, Chip, IconClose } from '@/components/ui';

type Tab = 'home' | 'live' | 'series' | 'movies' | 'guide';

const DEFAULT_PROFILE: Profile = {
  id: 'default', name: 'Default', favorites: [], recents: [], hiddenGroups: [], renamed: {},
  channelOrder: [], groupOrder: [], continueWatching: [], watchHistory: [],
};

function newProfile(name: string): Profile {
  return { ...DEFAULT_PROFILE, id: `p_${Date.now()}`, name };
}

const isIOS = typeof navigator !== 'undefined' && (/iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1));

export default function Home() {
  const [profiles, setProfiles] = useState<Profile[]>([DEFAULT_PROFILE]);
  const [activeProfileId, setActiveProfileId] = useState('default');
  const [playlist, setPlaylist] = useState<Playlist | null>(null);
  const [overrides, setOverrides] = useState<Record<string, string>>({});
  const [tab, setTab] = useState<Tab>('home');
  const [group, setGroup] = useState('all');
  const [liveFilter, setLiveFilter] = useState('');
  const [epg, setEpg] = useState<Record<string, Program[]>>({});
  const [visibleCount, setVisibleCount] = useState(120);

  const [showImport, setShowImport] = useState(false);
  const [importUrl, setImportUrl] = useState('');
  const [importing, setImporting] = useState(false);
  const [importError, setImportError] = useState('');
  const [xtream, setXtream] = useState({ host: '', user: '', pass: '' });

  const [selected, setSelected] = useState<{ channel: Channel; resume: number } | null>(null);
  const [selectedSeries, setSelectedSeries] = useState<SeriesFolder | null>(null);
  const [seriesMetaLoading, setSeriesMetaLoading] = useState(false);

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

  /* ---------- load ---------- */
  useEffect(() => {
    const ps = load<Profile[]>('profiles', [DEFAULT_PROFILE]);
    setProfiles(ps.length ? ps : [DEFAULT_PROFILE]);
    setActiveProfileId(load('activeProfileId', 'default'));
    setOverrides(load('groupOverrides', {}));
    setTmdbKey(load('tmdbKey', ''));
    loadPlaylist<Playlist>().then((pl) => {
      if (pl) setPlaylist(pl);
      else if (isIOS) setShowImport(true), setShowInstallHint(true);
      else if (!pl) setShowInstallHint(isIOS && !(window.navigator as any).standalone);
      if (!pl) setShowInstallHint(isIOS && !(window.navigator as any).standalone);
      if (!pl) setShowImport(true);
    });
    setIsStandalone((window.navigator as any).standalone === true || window.matchMedia('(display-mode: standalone)').matches);
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
    chs.map((c) => (overrides[c.id] ? { ...c, group: overrides[c.id] } : c)), [overrides]);

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
    } catch (e: any) { setImportError(e?.message || 'Import failed'); }
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
    } catch (e: any) { setImportError(e?.message || 'Import failed'); }
    finally { setImporting(false); }
  }

  /* ---------- data ---------- */
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
  function togglePin(profile: Profile) {
    if (!profile.pin) { setActiveProfileId(profile.id); setShowProfiles(false); return; }
    setShowPin({ profile, resolve: (ok) => { if (ok) { setActiveProfileId(profile.id); setShowProfiles(false); } setShowPin(null); } });
  }

  /* ---------- playback ---------- */
  const selectChannel = useCallback((ch: Channel, resume: number = 0) => {
    setSelected({ channel: ch, resume: ch.contentType === 'LIVE' || ch.contentType === undefined ? 0 : resume });
    updateProfile({
      recents: [ch.id, ...activeProfile.recents.filter((x) => x !== ch.id)].slice(0, 30),
      watchHistory: [ch.id, ...activeProfile.watchHistory.filter((x) => x !== ch.id)].slice(0, 200),
    });
    if (ch.contentType === 'MOVIE' && tmdbKey) fetchTmdb(`movie:${ch.name}`, 'movie', ch.name);
    if (ch.contentType === 'SERIES' && tmdbKey) fetchTmdb(`tv:${ch.name}`, 'tv', ch.name);
  }, [activeProfile, updateProfile, tmdbKey]);

  function onProgress(channelId: string, time: number, duration: number) {
    const ch = playlist?.channels.find((c) => c.id === channelId);
    if (!ch || ch.contentType === 'LIVE' || ch.contentType === undefined) return;
    const others = activeProfile.continueWatching.filter((c) => c.channelId !== channelId);
    const nearEnd = duration > 0 && time > duration - 30;
    const next = nearEnd
      ? others
      : [{ channelId, time, duration: Number.isFinite(duration) ? duration : 0, updatedAt: Date.now() }, ...others].slice(0, 50);
    updateProfile({ continueWatching: next as any });
  }

  async function fetchTmdb(key: string, type: 'movie' | 'tv', title: string) {
    if (!tmdbKey || meta[key]) return;
    try {
      const search = await fetch(`https://api.themoviedb.org/3/search/${type}?api_key=${encodeURIComponent(tmdbKey)}&query=${encodeURIComponent(title)}`);
      const sj = await search.json();
      const first = sj.results?.[0];
      if (!first) return;
      const res = await fetch(`https://api.themoviedb.org/3/${type}/${first.id}?api_key=${encodeURIComponent(tmdbKey)}`);
      const dj = await res.json();
      setMeta((prev) => ({ ...prev, [key]: dj }));
    } catch { /* offline or wrong key */ }
  }

  function openSeries(folder: SeriesFolder) {
    setSelectedSeries(folder);
    if (tmdbKey && !meta[`tv:${folder.name}`]) {
      setSeriesMetaLoading(true);
      fetchTmdb(`tv:${folder.name}`, 'tv', folder.name).finally(() => setSeriesMetaLoading(false));
    }
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

  /* ---------- derived ---------- */
  const channels = playlist?.channels || [];
  const favorites = activeProfile.favorites;
  const hiddenGroups = activeProfile.hiddenGroups;
  const renamed = activeProfile.renamed;

  const allGroups = useMemo(() => Array.from(new Set(channels.map((c) => c.group || 'Uncategorized'))), [channels]);

  const groups = useMemo(() => {
    const visible = allGroups.filter((g) => !hiddenGroups.includes(g));
    const order = activeProfile.groupOrder;
    return visible.sort((a, b) => {
      const ia = order.indexOf(a), ib = order.indexOf(b);
      const ra = ia === -1 ? Infinity : ia, rb = ib === -1 ? Infinity : ib;
      return ra !== rb ? ra - rb : a.localeCompare(b);
    });
  }, [allGroups, hiddenGroups, activeProfile.groupOrder]);

  const liveChannels = useMemo(() => channels.filter((c) => (c.contentType || 'LIVE') === 'LIVE'), [channels]);
  const movieChannels = useMemo(() => channels.filter((c) => c.contentType === 'MOVIE'), [channels]);
  const seriesChannels = useMemo(() => channels.filter((c) => c.contentType === 'SERIES'), [channels]);
  const seriesFolders = useMemo(() => groupIntoFolders(seriesChannels), [seriesChannels]);
  const favoriteChannels = useMemo(() => channels.filter((c) => favorites.includes(c.id)), [channels, favorites]);

  const liveList = useMemo(() => {
    let list = liveChannels;
    if (group !== 'all') list = list.filter((c) => (c.group || 'Uncategorized') === group);
    if (liveFilter) list = list.filter((c) => c.name.toLowerCase().includes(liveFilter.toLowerCase()));
    return list;
  }, [liveChannels, group, liveFilter]);

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
    activeProfile.recents.map((id) => channels.find((c) => c.id === id)).filter(Boolean).slice(0, 12) as Channel[],
  [activeProfile.recents, channels]);

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

  /* guide tab "now" for visible channels */
  const guideRows = useMemo(() => {
    return liveList.slice(0, visibleCount).map((ch) => {
      const progs = epgFor(ch);
      const now = progs ? nowProgram(progs) : undefined;
      const next = progs?.find((p) => now ? parseXmltvDate(p.start) >= parseXmltvDate(now.stop) : parseXmltvDate(p.start) > new Date());
      let pct = 0;
      if (now) {
        const s = parseXmltvDate(now.start).getTime(), e = parseXmltvDate(now.stop).getTime();
        pct = Math.min(100, Math.max(0, ((Date.now() - s) / (e - s)) * 100));
      }
      return { ch, now, next, pct };
    });
  }, [liveList, visibleCount, epgFor]);

  const tabTitle: Record<Tab, string> = { home: 'Home', live: 'Live TV', series: 'Series', movies: 'Films', guide: 'Guide' };

  /* ---------- render ---------- */

  const TabBar = (
    <nav className="fixed bottom-0 inset-x-0 z-30 ios-blur hairline-t pb-[var(--safe-b,0px)] md:pb-0">
      <div className="flex justify-around h-[54px] max-w-xl mx-auto">
        {([['home', IconHome], ['live', IconLive], ['series', IconSeries], ['movies', IconMovie], ['guide', IconGuide]] as [Tab, any][]).map(([t, Icon]) => (
          <button key={t} onClick={() => { setTab(t); setVisibleCount(120); }} className="press flex flex-col items-center justify-center w-16">
            <Icon className={`w-6 h-6 ${tab === t ? 'text-[#ff7a2a]' : 'text-white/50'}`} />
            <span className={`text-[10px] mt-0.5 ${tab === t ? 'text-[#ff7a2a] font-semibold' : 'text-white/50'}`}>{tabTitle[t]}</span>
          </button>
        ))}
      </div>
    </nav>
  );

  return (
    <div className="min-h-dvh bg-[#0b0b0d]">
      {/* Top mini bar */}
      <header className="fixed top-0 inset-x-0 z-30 ios-blur">
        <div className="max-w-xl mx-auto px-3 pt-[calc(6px+var(--safe-t,0px))] pb-2 flex items-center gap-1 hairline-b">
          <button onClick={() => setShowProfiles(true)} className="press w-9 h-9 rounded-full bg-gradient-to-br from-[#ff7a2a] to-[#ff2d55] flex items-center justify-center text-[15px] font-bold text-black">
            {activeProfile?.name.slice(0, 1).toUpperCase()}
          </button>
          <div className="flex-1 text-center text-[16px] font-semibold">{tabTitle[tab]}</div>
          <button onClick={() => setShowSearch(true)} className="press p-2 text-white/80"><IconSearch className="w-6 h-6" /></button>
          <button onClick={() => setShowSettings(true)} className="press p-2 text-white/80"><IconSettings className="w-6 h-6" /></button>
        </div>
      </header>

      {/* Main */}
      <main className="max-w-xl mx-auto pt-[calc(52px+var(--safe-t,0px))] pb-[calc(70px+var(--safe-b,0px))]">
        {showInstallHint && (
          <button onClick={() => setShowInstallHint(false)} className="press mx-4 mt-3 flex items-center gap-2 bg-[#ff7a2a]/15 border border-[#ff7a2a]/40 rounded-xl px-3 py-2.5 text-left">
            <div className="flex-1 text-[13px] text-[#ffd9c4] leading-snug">
              <b>Install the app:</b> Safari → Share → <b>Add to Home Screen</b> for the full-screen experience.
            </div>
            <IconClose className="w-4 h-4 text-[#ffd9c4]/70" />
          </button>
        )}

        {!playlist && (
          <div className="px-8 pt-24 text-center space-y-4">
            <div className="text-6xl">📺</div>
            <div className="text-[20px] font-bold">Welcome to M3U Player</div>
            <div className="text-[14px] text-white/50 leading-relaxed">Import your own playlist — M3U, M3U8 or an Xtream login. Posters, a real guide and Continue Watching arrive on their own.</div>
            <button onClick={() => setShowImport(true)} className="press inline-flex items-center gap-2 bg-[#ff7a2a] text-black font-semibold px-5 py-3 rounded-2xl text-[16px]">
              <IconPlus className="w-5 h-5" /> Add playlist
            </button>
          </div>
        )}

        {playlist && (
          <>
            {/* large title */}
            <div className="px-4 pt-3 pb-1 flex items-end justify-between">
              <h1 className="text-[28px] font-extrabold tracking-tight">{tabTitle[tab]}</h1>
              <button onClick={() => setShowImport(true)} className="press text-[13px] text-white/50 flex items-center gap-1">
                <IconPlus className="w-4 h-4" /> Playlist
              </button>
            </div>

            {tab === 'home' && (
              <HomeTab
                playlist={playlist} continueEntries={continueEntries} favorites={favoriteChannels} recent={recentChannels}
                onPlay={selectChannel} onOpenSeries={openSeries} groups={groups} setGroup={setGroup} tab={tab} setTab={setTab}
              />
            )}

            {tab === 'live' && (
              <LiveTab list={liveList} groups={groups} group={group} setGroup={setGroup} filter={liveFilter} setFilter={setLiveFilter}
                visibleCount={visibleCount} loadMore={() => setVisibleCount((v) => v + 200)}
                epgFor={epgFor} renamed={renamed} favorites={new Set(favorites)} toggleFav={toggleFavorite} onPlay={selectChannel} onAddMv={addToMv} />
            )}

            {tab === 'series' && (
              <SeriesTab folders={seriesFolders} visibleCount={visibleCount} loadMore={() => setVisibleCount((v) => v + 100)}
                onOpen={openSeries} continueId={selected?.channel.id} />
            )}

            {tab === 'movies' && (
              <MoviesTab list={movieChannels} visibleCount={visibleCount} loadMore={() => setVisibleCount((v) => v + 60)} onPlay={selectChannel} />
            )}

            {tab === 'guide' && (
              <GuideTab rows={guideRows} onPlay={selectChannel} />
            )}
          </>
        )}
      </main>

      {TabBar}

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

      {showMv && <Multiview items={mv} onExpand={(ch) => { setShowMv(false); selectChannel(ch); }} onRemove={(id) => setMv((p) => p.filter((x) => x.id !== id))} onClear={() => setMv([])} />}

      <ImportSheet open={showImport} onClose={() => setShowImport(false)}
        url={importUrl} setUrl={setImportUrl}
        xtream={xtream} setXtream={setXtream}
        importing={importing} error={importError}
        onUrl={importFromUrl} onFile={importFromFile} onXtream={importXtream}
        hasPlaylist={!!playlist} onChangePlaylist={() => setShowImport(true)} />

      {selectedSeries && (
        <SeriesSheet folder={selectedSeries} meta={meta[`tv:${selectedSeries.name}`]}
          onClose={() => setSelectedSeries(null)} continueId={selected?.channel.id}
          onPlay={(ep) => { setSelectedSeries(null); selectChannel(ep.channel); }} />
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
          setPlaylist((pl) => (pl ? { ...pl, channels: pl.channels.map((c) => (c.id === channelId ? { ...c, group: g } : c)) } : pl));
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
        onPick={togglePin}
        onAdd={(name) => { if (!name) return; const p = newProfile(name); setProfiles((prev) => [...prev, p]); flash(`Profile “${name}” added`); }}
        onSetPin={(pid, pin) => setProfiles((prev) => prev.map((p) => (p.id === pid ? { ...p, pin: pin || undefined } : p)))}
        onDelete={(pid) => setProfiles((prev) => (prev.length > 1 ? prev.filter((p) => p.id !== pid) : prev))} />

      {showPin && <PinOverlay profile={showPin.profile} onResolve={showPin.resolve} onCancel={() => { showPin.resolve(false); }} />}

      {showSearch && (
        <SearchOverlay channels={channels} series={seriesFolders} favorites={new Set(favorites)}
          onClose={() => setShowSearch(false)}
          onPlayChannel={(c) => { setShowSearch(false); selectChannel(c); }}
          onOpenSeries={(f) => { setShowSearch(false); openSeries(f); }} />
      )}

      {/* toast */}
      {status && (
        <div className="fixed bottom-[calc(70px+var(--safe-b,0px)+12px)] inset-x-0 z-30 flex justify-center pointer-events-none fade-in">
          <div className="bg-white text-black text-[13px] font-semibold px-4 py-2 rounded-full shadow-lg">{status}</div>
        </div>
      )}
    </div>
  );
}

/* ================= Tabs ================= */

function ShelfCard({ poster, title, subtitle, rec, onClick, progress }: {
  poster?: string; title: string; subtitle?: string; rec?: boolean; onClick: () => void; progress?: number;
}) {
  return (
    <button onClick={onClick} className="press text-left" style={{ width: rec ? 180 : 110 }} title={title}>
      <div className="relative rounded-lg overflow-hidden" style={{ aspectRatio: rec ? '16/9' : '2/3' }}>
        <Poster src={poster} className="absolute inset-0 w-full h-full" />
        {progress != null && (
          <div className="absolute bottom-0 inset-x-0 h-1 bg-white/25">
            <div className="h-full bg-[#ff7a2a]" style={{ width: `${progress}%` }} />
          </div>
        )}
      </div>
      <div className={`mt-1.5 text-[13px] ${rec ? 'font-semibold' : 'font-medium'} truncate`}>{title}</div>
      {subtitle && <div className="text-[11px] text-white/40 truncate">{subtitle}</div>}
    </button>
  );
}

function HomeTab({ playlist, continueEntries, favorites, recent, onPlay, onOpenSeries, groups, setGroup, tab, setTab }: any) {
  const continueWithMeta = continueEntries.map((e: any) => ({
    ...e,
    poster: e.ch.contentType === 'MOVIE' || e.ch.contentType === 'SERIES' ? e.ch.logo : undefined,
  }));

  return (
    <div>
      {continueEntries.length > 0 && (
        <section className="mt-2">
          <div className="px-4 pb-2 text-[17px] font-bold">Continue Watching</div>
          <div className="scroll-x shelf">
            {continueWithMeta.map(({ ch, pct, time }: any) => (
              <ShelfCard key={ch.id} poster={ch.logo} title={ch.name} rec progress={pct}
                subtitle={pct > 0 ? `${Math.round(pct)}% watched` : undefined}
                onClick={() => onPlay(ch, time)} />
            ))}
          </div>
        </section>
      )}

      {favorites.length > 0 && (
        <section className="mt-6">
          <div className="px-4 pb-2 text-[17px] font-bold">Favourites</div>
          <div className="scroll-x shelf">
            {favorites.slice(0, 20).map((ch: Channel) => (
              <ShelfCard key={ch.id} poster={ch.contentType === 'MOVIE' || ch.contentType === 'SERIES' ? ch.logo : undefined}
                title={ch.name} onClick={() => onPlay(ch, resumeFor(ch))} />
            ))}
          </div>
        </section>
      )}

      {recent.length > 0 && (
        <section className="mt-6">
          <div className="px-4 pb-2 text-[17px] font-bold">Recently watched</div>
          <div className="scroll-x shelf">
            {recent.map((ch: Channel) => (
              <ShelfCard key={ch.id} poster={ch.contentType === 'MOVIE' || ch.contentType === 'SERIES' ? ch.logo : undefined}
                title={ch.name} onClick={() => onPlay(ch, resumeFor(ch))} />
            ))}
          </div>
        </section>
      )}

      <section className="mt-6">
        <div className="px-4 pb-2 flex items-center justify-between">
          <div className="text-[17px] font-bold">Live now</div>
          <button onClick={() => setTab('live')} className="press text-[14px] text-[#0a84ff]">See all</button>
        </div>
        <div className="ios-card mx-4 divide-y divide-white/5">
          {playlist.channels.filter((c: Channel) => (c.contentType || 'LIVE') === 'LIVE').slice(0, 6).map((ch: Channel) => (
            <button key={ch.id} onClick={() => onPlay(ch)} className="press w-full flex items-center gap-3 px-3 py-2.5 text-left">
              <Poster src={ch.logo} className="w-9 h-9 rounded-md" />
              <div className="flex-1 min-w-0">
                <div className="text-[15px] truncate">{ch.name}</div>
                <div className="text-[11px] text-white/35 truncate">{ch.group}</div>
              </div>
              <IconPlayCircle className="w-7 h-7 text-[#ff7a2a]" />
            </button>
          ))}
        </div>
      </section>

      {groups.length > 0 && (
        <section className="mt-6">
          <div className="px-4 pb-2 text-[17px] font-bold">Your groups</div>
          <div className="scroll-x shelf">
            {groups.slice(0, 20).map((g: string) => (
              <Chip key={g} label={g} onClick={() => { setGroup(g); setTab('live'); }} />
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

function resumeFor(ch: Channel) { return 0; }

function LiveTab({ list, groups, group, setGroup, filter, setFilter, visibleCount, loadMore, epgFor, renamed, favorites, toggleFav, onPlay, onAddMv }: any) {
  return (
    <div>
      <div className="scroll-x flex gap-2 px-4 py-2.5">
        <Chip label="All" active={group === 'all'} onClick={() => setGroup('all')} />
        {groups.map((g: string) => <Chip key={g} label={renamed[g] || g} active={group === g} onClick={() => setGroup(g)} />)}
      </div>
      <div className="px-4 pb-2">
        <input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Filter channels"
          className="w-full bg-white/8 rounded-xl px-3.5 py-2.5 text-[16px] outline-none placeholder:text-white/30" />
      </div>
      <div className="ios-card mx-4 divide-y divide-white/5">
        {list.slice(0, visibleCount).map((ch: Channel) => {
          const now = epgFor(ch) ? epgFor(ch).find((p: Program) => nowProgram([p])) : undefined;
          return (
            <div key={ch.id} className="flex items-center gap-3 px-3 py-2 hairline-b last:border-0">
              <button onClick={() => onPlay(ch)} className="press flex items-center gap-3 flex-1 min-w-0 text-left">
                <Poster src={ch.logo} className="w-10 h-10 rounded-lg shrink-0" />
                <div className="flex-1 min-w-0">
                  <div className="text-[15px] truncate flex items-center gap-1.5">
                    <span className="truncate">{ch.name}</span>
                    <span className="text-[9px] font-bold text-red-500 bg-red-500/10 px-1 rounded shrink-0">LIVE</span>
                    {ch.qualityTag && <span className="text-[10px] text-white/40 shrink-0">{ch.qualityTag}</span>}
                  </div>
                  {now ? (
                    <div className="text-[11px] text-white/45 truncate">{now.title}</div>
                  ) : (
                    <div className="text-[11px] text-white/35 truncate">{renamed[ch.group || 'Uncategorized'] || ch.group}</div>
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
      {list.length > visibleCount && (
        <div className="py-3 text-center">
          <button onClick={loadMore} className="press text-[14px] text-[#0a84ff]">Show more ({(list.length - visibleCount).toLocaleString()} left)</button>
        </div>
      )}
    </div>
  );
}

function SeriesTab({ folders, visibleCount, loadMore, onOpen }: any) {
  return (
    <div>
      <div className="grid grid-cols-3 gap-3 px-4 py-2 md:grid-cols-4">
        {folders.slice(0, visibleCount).map((f: SeriesFolder) => (
          <button key={f.name} onClick={() => onOpen(f)} className="press text-left" title={f.name}>
            <div className="relative rounded-xl overflow-hidden" style={{ aspectRatio: '2/3' }}>
              <Poster src={f.tmdbPosterUrl || f.posterUrl} className="absolute inset-0 w-full h-full" />
            </div>
            <div className="mt-1 text-[12px] font-medium truncate">{f.name}</div>
            <div className="text-[10px] text-white/35">{f.episodeCount} ep</div>
          </button>
        ))}
      </div>
      {folders.length > visibleCount && (
        <div className="py-3 text-center">
          <button onClick={loadMore} className="press text-[14px] text-[#0a84ff]">Show more ({(folders.length - visibleCount).toLocaleString()} left)</button>
        </div>
      )}
    </div>
  );
}

function MoviesTab({ list, visibleCount, loadMore, onPlay }: any) {
  return (
    <div>
      <div className="grid grid-cols-3 gap-3 px-4 py-2 md:grid-cols-4">
        {list.slice(0, visibleCount).map((ch: Channel) => (
          <button key={ch.id} onClick={() => onPlay(ch)} className="press text-left" title={ch.name}>
            <div className="relative rounded-xl overflow-hidden" style={{ aspectRatio: '2/3' }}>
              <Poster src={ch.logo} className="absolute inset-0 w-full h-full" />
              {ch.qualityTag && <div className="absolute bottom-1 left-1 text-[9px] font-bold bg-black/60 px-1 rounded">{ch.qualityTag}</div>}
            </div>
            <div className="mt-1 text-[12px] font-medium truncate">{ch.name}</div>
          </button>
        ))}
      </div>
      {list.length > visibleCount && (
        <div className="py-3 text-center">
          <button onClick={loadMore} className="press text-[14px] text-[#0a84ff]">Show more ({(list.length - visibleCount).toLocaleString()} left)</button>
        </div>
      )}
    </div>
  );
}

function GuideTab({ rows, onPlay }: any) {
  return (
    <div className="ios-card mx-4 mt-2 divide-y divide-white/5">
      {rows.map(({ ch, now, next, pct }: any) => (
        <button key={ch.id} onClick={() => onPlay(ch)} className="press w-full flex items-center gap-3 px-3 py-2.5 text-left">
          <Poster src={ch.logo} className="w-10 h-10 rounded-lg shrink-0" />
          <div className="flex-1 min-w-0">
            <div className="text-[15px] truncate">{ch.name}</div>
            {now ? (
              <div className="mt-0.5">
                <div className="text-[12px] truncate text-white/80">
                  <span className="text-[#ff7a2a] font-bold mr-1.5">NOW</span>{now.title}
                </div>
                <div className="mt-1 h-1 bg-white/10 rounded-full overflow-hidden w-full">
                  <div className="h-full bg-[#ff7a2a]" style={{ width: `${pct}%` }} />
                </div>
                {next && <div className="text-[11px] text-white/35 truncate mt-1">Next {fmtClock(next.start)} · {next.title}</div>}
              </div>
            ) : (
              <div className="text-[11px] text-white/35 mt-0.5">No programme data</div>
            )}
          </div>
        </button>
      ))}
      {rows.length === 0 && <div className="p-6 text-center text-white/40 text-[14px]">Load a playlist with a guide.</div>}
    </div>
  );
}

function fmtClock(xmltv: string) {
  if (xmltv.length >= 12) return `${xmltv.slice(8, 10)}:${xmltv.slice(10, 12)}`;
  return xmltv;
}

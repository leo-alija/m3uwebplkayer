'use client';
import { useEffect, useRef, useState, useMemo, useCallback } from 'react';
import { parseM3U, buildXtreamM3uUrl } from '@/lib/m3u';
import { parseXMLTV, nowProgram, parseXmltvDate } from '@/lib/epg';
import { load, save } from '@/lib/storage';
import { groupIntoFolders, parseEpisode } from '@/lib/series';
import { Channel, Playlist, Program, SeriesFolder, Profile } from '@/lib/types';
import Hls from 'hls.js';

type Tab = 'live' | 'movies' | 'series' | 'guide' | 'favorites' | 'multiview' | 'settings';

const DEFAULT_PROFILE: Profile = {
  id: 'default', name: 'Default', favorites: [], recents: [], hiddenGroups: [], renamed: {},
  channelOrder: [], groupOrder: [], continueWatching: [], watchHistory: [],
};

function newProfile(name: string): Profile {
  return { ...DEFAULT_PROFILE, id: `p_${Date.now()}`, name };
}

function MVPlayer({ channel }: { channel: Channel }) {
  const ref = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    const video = ref.current;
    if (!video) return;
    let hls: Hls | null = null;
    const url = channel.url;
    if (url.includes('.m3u8') || url.includes('m3u8')) {
      if (Hls.isSupported()) {
        hls = new Hls({ enableWorker: true });
        hls.loadSource(url);
        hls.attachMedia(video);
      } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
        video.src = url;
      }
    } else {
      video.src = url;
    }
    return () => { if (hls) hls.destroy(); };
  }, [channel.url]);
  return (
    <div className="relative bg-black rounded-lg overflow-hidden">
      <video ref={ref} controls playsInline muted className="w-full h-full" />
      <div className="absolute bottom-1 left-2 text-xs bg-black/60 px-1 rounded">{channel.name}</div>
    </div>
  );
}

export default function Home() {
  const [profiles, setProfiles] = useState<Profile[]>([DEFAULT_PROFILE]);
  const [activeProfileId, setActiveProfileId] = useState('default');
  const [playlist, setPlaylist] = useState<Playlist | null>(null);
  const [overrides, setOverrides] = useState<Record<string, string>>({});
  const [selected, setSelected] = useState<Channel | null>(null);
  const [selectedSeries, setSelectedSeries] = useState<SeriesFolder | null>(null);
  const [tab, setTab] = useState<Tab>('live');
  const [query, setQuery] = useState('');
  const [group, setGroup] = useState('all');
  const [epg, setEpg] = useState<Record<string, Program[]>>({});
  const [importUrl, setImportUrl] = useState('');
  const [importing, setImporting] = useState(false);
  const [importError, setImportError] = useState('');
  const [showImport, setShowImport] = useState(true);
  const [xtream, setXtream] = useState({ host: '', user: '', pass: '' });
  const [status, setStatus] = useState('');
  const [tmdbKey, setTmdbKey] = useState('');
  const [meta, setMeta] = useState<Record<string, any>>({});
  const [mv, setMv] = useState<Channel[]>([]);
  const [showPin, setShowPin] = useState<{ profile: Profile; resolve: (ok: boolean) => void } | null>(null);
  const [pinInput, setPinInput] = useState('');
  const [newProfileName, setNewProfileName] = useState('');
  const videoRef = useRef<HTMLVideoElement>(null);
  const hlsRef = useRef<Hls | null>(null);

  const activeProfile = profiles.find((p) => p.id === activeProfileId) || profiles[0];

  const updateProfile = useCallback((patch: Partial<Profile>) => {
    setProfiles((prev) => prev.map((p) => (p.id === activeProfileId ? { ...p, ...patch } : p)));
  }, [activeProfileId]);

  useEffect(() => {
    const ps = load<Profile[]>('profiles', [DEFAULT_PROFILE]);
    setProfiles(ps.length ? ps : [DEFAULT_PROFILE]);
    setActiveProfileId(load('activeProfileId', 'default'));
    setOverrides(load('groupOverrides', {}));
    setPlaylist(load<Playlist | null>('playlist', null));
    setTmdbKey(load('tmdbKey', ''));
    if (load<Playlist | null>('playlist', null)) setShowImport(false);
    if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});
  }, []);

  useEffect(() => { save('profiles', profiles); }, [profiles]);
  useEffect(() => { save('activeProfileId', activeProfileId); }, [activeProfileId]);
  useEffect(() => { save('groupOverrides', overrides); }, [overrides]);
  useEffect(() => { if (playlist) save('playlist', playlist); }, [playlist]);
  useEffect(() => { save('tmdbKey', tmdbKey); }, [tmdbKey]);

  const favorites = activeProfile.favorites;
  const hiddenGroups = activeProfile.hiddenGroups;
  const renamed = activeProfile.renamed;
  const recents = activeProfile.recents;

  async function fetchText(url: string) {
    const res = await fetch('/api/fetch?url=' + encodeURIComponent(url));
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      throw new Error(j.error || 'fetch failed');
    }
    return await res.text();
  }

  function applyOverrides(chs: Channel[]): Channel[] {
    return chs.map((c) => (overrides[c.id] ? { ...c, group: overrides[c.id] } : c));
  }

  async function importPlaylistText(text: string, name: string, epgUrl?: string) {
    const { channels, epgUrl: parsedEpg } = parseM3U(text);
    const chs = applyOverrides(channels);
    const pl: Playlist = { name, channels: chs, epgUrl: epgUrl || parsedEpg, importedAt: Date.now() };
    setPlaylist(pl);
    setShowImport(false);
    setStatus(`Imported ${chs.length} channels`);
    if (pl.epgUrl) loadEpg(pl.epgUrl);
  }

  async function loadEpg(url: string) {
    try {
      const text = await fetchText(url);
      setEpg(parseXMLTV(text));
    } catch (e: any) { console.warn('epg', e); }
  }

  async function importFromUrl() {
    setImporting(true); setImportError('');
    try {
      const text = await fetchText(importUrl);
      await importPlaylistText(text, importUrl);
    } catch (e: any) { setImportError(e?.message || 'import failed'); }
    finally { setImporting(false); }
  }

  function importFromFile(file: File) {
    const reader = new FileReader();
    reader.onload = async () => {
      try { await importPlaylistText(String(reader.result || ''), file.name); }
      catch (e: any) { setImportError(e?.message || 'import failed'); }
    };
    reader.readAsText(file);
  }

  async function importXtream() {
    setImporting(true); setImportError('');
    try {
      const url = buildXtreamM3uUrl(xtream.host, xtream.user, xtream.pass);
      const text = await fetchText(url);
      await importPlaylistText(text, xtream.host);
    } catch (e: any) { setImportError(e?.message || 'import failed'); }
    finally { setImporting(false); }
  }

  function selectChannel(ch: Channel) {
    setSelected(ch);
    updateProfile({ recents: [ch.id, ...recents.filter((x) => x !== ch.id)].slice(0, 50), watchHistory: [ch.id, ...activeProfile.watchHistory.filter((x) => x !== ch.id)].slice(0, 200) });
    const video = videoRef.current;
    if (!video) return;
    if (hlsRef.current) { hlsRef.current.destroy(); hlsRef.current = null; }
    const url = ch.url;
    if (url.includes('.m3u8') || url.includes('m3u8')) {
      if (Hls.isSupported()) {
        const hls = new Hls({ enableWorker: true });
        hls.loadSource(url);
        hls.attachMedia(video);
        hlsRef.current = hls;
      } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
        video.src = url;
      }
    } else {
      video.src = url;
    }
    const cw = activeProfile.continueWatching.find((c) => c.channelId === ch.id);
    if (cw) {
      video.addEventListener('loadedmetadata', () => { video.currentTime = cw.time; }, { once: true });
    }
    video.play().catch(() => {});
  }

  function toggleFavorite(id: string) {
    const next = favorites.includes(id) ? favorites.filter((x) => x !== id) : [...favorites, id];
    updateProfile({ favorites: next });
  }

  function hideGroup(g: string) {
    updateProfile({ hiddenGroups: [...hiddenGroups, g] });
  }

  function unhideAll() {
    updateProfile({ hiddenGroups: [] });
  }

  function renameGroup(g: string, newName: string) {
    if (!newName.trim()) return;
    updateProfile({ renamed: { ...renamed, [g]: newName.trim() } });
  }

  function setChannelGroup(channelId: string, newGroup: string) {
    if (!playlist) return;
    setOverrides((prev) => ({ ...prev, [channelId]: newGroup }));
    setPlaylist({ ...playlist, channels: playlist.channels.map((c) => (c.id === channelId ? { ...c, group: newGroup } : c)) });
  }

  function addToMultiview(ch: Channel) {
    setMv((prev) => (prev.find((x) => x.id === ch.id) ? prev : [...prev, ch].slice(0, 6)));
    setTab('multiview');
  }

  function removeFromMv(id: string) {
    setMv((prev) => prev.filter((x) => x.id !== id));
  }

  const channels = playlist?.channels || [];
  const groups = useMemo(() => {
    const set = new Set(channels.map((c) => c.group || 'Uncategorized'));
    const list = Array.from(set).filter((g) => !hiddenGroups.includes(g));
    const order = activeProfile.groupOrder;
    return list.sort((a, b) => {
      const ia = order.indexOf(a); const ib = order.indexOf(b);
      const ra = ia === -1 ? Infinity : ia; const rb = ib === -1 ? Infinity : ib;
      if (ra !== rb) return ra - rb;
      return a.localeCompare(b);
    });
  }, [channels, hiddenGroups, activeProfile.groupOrder]);

  const allGroups = useMemo(() => Array.from(new Set(channels.map((c) => c.group || 'Uncategorized'))), [channels]);

  function orderChannels(list: Channel[]): Channel[] {
    const order = activeProfile.channelOrder;
    return [...list].sort((a, b) => {
      const ia = order.indexOf(a.id); const ib = order.indexOf(b.id);
      const ra = ia === -1 ? Infinity : ia; const rb = ib === -1 ? Infinity : ib;
      if (ra !== rb) return ra - rb;
      return 0;
    });
  }

  const filtered = useMemo(() => {
    let list = channels;
    if (hiddenGroups.length) list = list.filter((c) => !hiddenGroups.includes(c.group || 'Uncategorized'));
    if (group !== 'all') list = list.filter((c) => (c.group || 'Uncategorized') === group);
    if (query) list = list.filter((c) => c.name.toLowerCase().includes(query.toLowerCase()));
    if (tab === 'live') list = list.filter((c) => (c.contentType || 'LIVE') === 'LIVE');
    if (tab === 'movies') list = list.filter((c) => c.contentType === 'MOVIE');
    if (tab === 'series') list = list.filter((c) => c.contentType === 'SERIES');
    if (tab === 'favorites') list = list.filter((c) => favorites.includes(c.id));
    return orderChannels(list);
  }, [channels, hiddenGroups, group, query, tab, favorites, activeProfile.channelOrder]);

  const seriesFolders = useMemo(() => {
    if (!playlist) return [];
    const seriesChannels = channels.filter((c) => c.contentType === 'SERIES');
    return groupIntoFolders(seriesChannels);
  }, [channels, playlist]);

  const favoriteChannels = useMemo(() => channels.filter((c) => favorites.includes(c.id)), [channels, favorites]);

  // TMDb metadata
  async function fetchTmdb(title: string, type: 'movie' | 'tv') {
    if (!tmdbKey || meta[title]) return;
    try {
      const search = await fetch(`https://api.themoviedb.org/3/search/${type}?api_key=${encodeURIComponent(tmdbKey)}&query=${encodeURIComponent(title)}`);
      const sj = await search.json();
      const first = sj.results?.[0];
      if (!first) return;
      const details = await fetch(`https://api.themoviedb.org/3/${type}/${first.id}?api_key=${encodeURIComponent(tmdbKey)}&append_to_response=credits,videos`);
      const dj = await details.json();
      setMeta((prev) => ({ ...prev, [title]: dj }));
    } catch (e) { console.warn('tmdb', e); }
  }

  useEffect(() => {
    if (selected && tmdbKey) {
      if (selected.contentType === 'MOVIE') fetchTmdb(selected.name, 'movie');
      if (selected.contentType === 'SERIES') {
        // try series folder name
      }
    }
  }, [selected, tmdbKey]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !selected) return;
    const saveTime = () => {
      if (!selected) return;
      const others = activeProfile.continueWatching.filter((c) => c.channelId !== selected.id);
      updateProfile({ continueWatching: [{ channelId: selected.id, time: video.currentTime }, ...others].slice(0, 50) });
    };
    video.addEventListener('pause', saveTime);
    video.addEventListener('ended', saveTime);
    return () => {
      video.removeEventListener('pause', saveTime);
      video.removeEventListener('ended', saveTime);
    };
  }, [selected]);

  function togglePin(profile: Profile) {
    if (!profile.pin) { setActiveProfileId(profile.id); return; }
    setShowPin({ profile, resolve: (ok) => { if (ok) setActiveProfileId(profile.id); setShowPin(null); setPinInput(''); } });
  }

  function verifyPin() {
    if (!showPin) return;
    if (pinInput === showPin.profile.pin) showPin.resolve(true);
    else showPin.resolve(false);
  }

  function createProfile() {
    if (!newProfileName.trim()) return;
    const p = newProfile(newProfileName.trim());
    setProfiles((prev) => [...prev, p]);
    setNewProfileName('');
    setStatus(`Profile created: ${p.name}`);
  }

  function setProfilePin(pid: string, pin: string) {
    setProfiles((prev) => prev.map((p) => (p.id === pid ? { ...p, pin: pin || undefined } : p)));
  }

  const continueChannels = useMemo(() => {
    if (!playlist) return [];
    const ids = activeProfile.continueWatching.map((c) => c.channelId);
    return ids.map((id) => channels.find((c) => c.id === id)).filter(Boolean) as Channel[];
  }, [activeProfile.continueWatching, channels, playlist]);

  return (
    <div className="min-h-screen flex flex-col">
      <header className="sticky top-0 z-20 bg-black/60 backdrop-blur border-b border-white/10 px-4 py-3 flex items-center justify-between">
        <div className="font-bold text-lg">M3U Web Player</div>
        <div className="flex gap-2 items-center">
          <select value={activeProfileId} onChange={(e) => {
            const prof = profiles.find((p) => p.id === e.target.value);
            if (prof && prof.pin) togglePin(prof); else setActiveProfileId(e.target.value);
          }} className="bg-white/5 rounded-lg px-2 py-1.5 text-sm">
            {profiles.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
          <button onClick={() => setShowImport(true)} className="px-3 py-1.5 rounded-lg bg-white/10 text-sm">Import</button>
        </div>
      </header>

      {showPin && (
        <div className="fixed inset-0 z-40 bg-black/80 flex items-center justify-center p-4">
          <div className="bg-[#14171f] rounded-2xl p-5 w-full max-w-sm space-y-3 border border-white/10">
            <h2 className="text-lg font-bold">Enter PIN for {showPin.profile.name}</h2>
            <input value={pinInput} onChange={(e) => setPinInput(e.target.value)} type="password" className="w-full bg-white/5 rounded-lg px-3 py-2 outline-none" />
            <div className="flex gap-2 justify-end">
              <button onClick={() => { showPin.resolve(false); setShowPin(null); setPinInput(''); }} className="px-3 py-2 rounded-lg bg-white/10">Cancel</button>
              <button onClick={verifyPin} className="px-3 py-2 rounded-lg bg-orange-500 font-semibold">Unlock</button>
            </div>
          </div>
        </div>
      )}

      {showImport && (
        <div className="fixed inset-0 z-30 bg-black/80 flex items-center justify-center p-4">
          <div className="bg-[#14171f] rounded-2xl p-5 w-full max-w-lg space-y-4 border border-white/10 max-h-[90vh] overflow-y-auto">
            <div className="flex justify-between items-center">
              <h2 className="text-xl font-bold">Import playlist</h2>
              <button onClick={() => setShowImport(false)} className="text-white/60">✕</button>
            </div>
            <div className="space-y-2">
              <label className="text-sm text-white/70">M3U URL</label>
              <div className="flex gap-2">
                <input value={importUrl} onChange={(e) => setImportUrl(e.target.value)} placeholder="https://example.com/playlist.m3u" className="flex-1 bg-white/5 rounded-lg px-3 py-2 outline-none" />
                <button onClick={importFromUrl} disabled={importing} className="px-4 py-2 rounded-lg bg-orange-500 font-semibold disabled:opacity-50">{importing ? '...' : 'Load'}</button>
              </div>
            </div>
            <div className="space-y-2">
              <label className="text-sm text-white/70">Or upload M3U file</label>
              <input type="file" accept=".m3u,.m3u8,.txt" onChange={(e) => e.target.files && importFromFile(e.target.files[0])} className="block w-full text-sm" />
            </div>
            <div className="space-y-2 pt-2 border-t border-white/10">
              <label className="text-sm text-white/70">Xtream Codes login</label>
              <input value={xtream.host} onChange={(e) => setXtream({ ...xtream, host: e.target.value })} placeholder="http://host:port" className="w-full bg-white/5 rounded-lg px-3 py-2 outline-none" />
              <div className="flex gap-2">
                <input value={xtream.user} onChange={(e) => setXtream({ ...xtream, user: e.target.value })} placeholder="username" className="flex-1 bg-white/5 rounded-lg px-3 py-2 outline-none" />
                <input value={xtream.pass} onChange={(e) => setXtream({ ...xtream, pass: e.target.value })} placeholder="password" type="password" className="flex-1 bg-white/5 rounded-lg px-3 py-2 outline-none" />
              </div>
              <button onClick={importXtream} disabled={importing} className="w-full px-4 py-2 rounded-lg bg-white/10 font-semibold disabled:opacity-50">Login & import</button>
            </div>
            {importError && <div className="text-red-400 text-sm">{importError}</div>}
          </div>
        </div>
      )}

      <main className="flex-1 flex flex-col md:flex-row">
        <section className="md:w-[42%] lg:w-[38%] border-r border-white/10 flex flex-col">
          <div className="p-3 flex gap-2">
            <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search" className="flex-1 bg-white/5 rounded-lg px-3 py-2 outline-none" />
            <select value={group} onChange={(e) => setGroup(e.target.value)} className="bg-white/5 rounded-lg px-2 py-2 outline-none max-w-[150px]">
              <option value="all">All groups</option>
              {groups.map((g) => <option key={g} value={g}>{renamed[g] || g}</option>)}
            </select>
          </div>
          <div className="flex-1 overflow-y-auto">
            {tab === 'series' ? (
              <div className="p-2 space-y-2">
                {seriesFolders.map((f) => (
                  <button key={f.name} onClick={() => { setSelectedSeries(f); if (tmdbKey) fetchTmdb(f.name, 'tv'); }} className="w-full text-left bg-white/5 rounded-xl p-3 flex gap-3 hover:bg-white/10">
                    {f.posterUrl || f.tmdbPosterUrl ? <img src={f.tmdbPosterUrl || f.posterUrl} alt="" className="w-16 h-24 rounded object-cover bg-white/5" /> : <div className="w-16 h-24 rounded bg-white/10 flex items-center justify-center text-xs text-center p-1">{f.name.slice(0, 12)}</div>}
                    <div className="flex-1 min-w-0">
                      <div className="font-semibold truncate">{f.name}</div>
                      <div className="text-xs text-white/50">{f.episodeCount} episodes · {f.seasonCount} seasons</div>
                      <div className="text-xs text-white/40 truncate">{f.groupTitles.join(', ')}</div>
                    </div>
                  </button>
                ))}
                {seriesFolders.length === 0 && <div className="p-6 text-center text-white/50 text-sm">No series. Import a playlist.</div>}
              </div>
            ) : (
              filtered.map((ch) => (
                <div key={ch.id} className={`w-full text-left px-3 py-2.5 flex items-center gap-3 border-b border-white/5 hover:bg-white/5 ${selected?.id === ch.id ? 'bg-orange-500/15' : ''}`}>
                  <button onClick={() => selectChannel(ch)} className="flex items-center gap-3 flex-1 min-w-0 text-left">
                    {ch.logo ? <img src={ch.logo} alt="" className="w-9 h-9 rounded object-cover bg-white/5" /> : <div className="w-9 h-9 rounded bg-white/10 flex items-center justify-center text-xs">{ch.name.slice(0, 2).toUpperCase()}</div>}
                    <div className="flex-1 min-w-0">
                      <div className="truncate font-medium">{ch.name}</div>
                      <div className="truncate text-xs text-white/50">{renamed[ch.group || 'Uncategorized'] || ch.group || 'Uncategorized'}{ch.qualityTag ? ` · ${ch.qualityTag}` : ''}</div>
                    </div>
                  </button>
                  <button onClick={() => toggleFavorite(ch.id)} className={`text-lg ${favorites.includes(ch.id) ? 'text-orange-400' : 'text-white/20'}`}>★</button>
                  <button onClick={() => addToMultiview(ch)} className="text-xs px-2 py-1 rounded bg-white/10">MV</button>
                </div>
              ))
            )}
            {filtered.length === 0 && tab !== 'series' && <div className="p-6 text-center text-white/50 text-sm">No channels. Import a playlist.</div>}
          </div>
        </section>

        <section className="flex-1 flex flex-col">
          <div className="video-wrap relative aspect-video md:aspect-auto md:flex-1 bg-black">
            <video ref={videoRef} controls playsInline className="w-full h-full" />
            {!selected && <div className="absolute inset-0 flex items-center justify-center text-white/40">Select a channel</div>}
          </div>
          {selected && (
            <div className="p-3 space-y-2 border-t border-white/10">
              <div className="flex items-center justify-between gap-2">
                <div className="font-semibold truncate">{selected.name}</div>
                <div className="flex gap-2">
                  <button onClick={() => { const v = videoRef.current; if (v && (v as any).requestPictureInPicture) (v as any).requestPictureInPicture(); }} className="text-xs px-2 py-1 rounded bg-white/10">PiP</button>
                  <button onClick={() => toggleFavorite(selected.id)} className={`text-xl ${favorites.includes(selected.id) ? 'text-orange-400' : 'text-white/30'}`}>★</button>
                </div>
              </div>
              <div className="text-xs text-white/50 truncate">{selected.url}</div>
              {selected.headers && <div className="text-xs text-white/40">Headers: {Object.keys(selected.headers).join(', ')}</div>}
              {epg[selected.tvgId || ''] && nowProgram(epg[selected.tvgId || '']) && (
                <div className="text-sm text-orange-300">Now: {nowProgram(epg[selected.tvgId || ''])?.title}</div>
              )}
              {meta[selected.name] && (
                <div className="bg-white/5 rounded-lg p-3 text-sm space-y-1">
                  <div className="font-medium">{meta[selected.name].title || meta[selected.name].name}</div>
                  <div className="text-xs text-white/60">{meta[selected.name].overview || meta[selected.name].description}</div>
                  {meta[selected.name].vote_average && <div className="text-xs text-orange-300">Rating: {meta[selected.name].vote_average}</div>}
                </div>
              )}
              {tmdbKey && selected.contentType !== 'LIVE' && !meta[selected.name] && (
                <button onClick={() => fetchTmdb(selected.name, selected.contentType === 'MOVIE' ? 'movie' : 'tv')} className="text-xs px-2 py-1 rounded bg-white/10">Load TMDb metadata</button>
              )}
              <div className="flex gap-2 flex-wrap">
                <button onClick={() => addToMultiview(selected)} className="text-xs px-2 py-1 rounded bg-white/10">Add to Multiview</button>
                <a href={selected.url} download className="text-xs px-2 py-1 rounded bg-white/10">Download</a>
                <select onChange={(e) => {
                  const v = videoRef.current; if (v) v.playbackRate = parseFloat(e.target.value);
                }} className="text-xs bg-white/5 rounded px-2 py-1">
                  <option value="1">1x</option>
                  <option value="1.25">1.25x</option>
                  <option value="1.5">1.5x</option>
                  <option value="2">2x</option>
                </select>
                <select onChange={(e) => {
                  const hls = hlsRef.current; if (hls) hls.currentLevel = parseInt(e.target.value, 10);
                }} className="text-xs bg-white/5 rounded px-2 py-1">
                  <option value="-1">Auto quality</option>
                </select>
              </div>
            </div>
          )}
          {tab === 'guide' && selected && epg[selected.tvgId || ''] && (
            <div className="flex-1 overflow-y-auto p-3 space-y-2">
              {epg[selected.tvgId || ''].slice(0, 60).map((p, i) => (
                <div key={i} className="bg-white/5 rounded-lg p-3">
                  <div className="text-xs text-white/50">{p.start} – {p.stop}</div>
                  <div className="font-medium">{p.title}</div>
                  {p.desc && <div className="text-sm text-white/60 mt-1">{p.desc}</div>}
                </div>
              ))}
            </div>
          )}
          {tab === 'multiview' && (
            <div className="flex-1 p-3">
              <div className="flex items-center justify-between mb-2">
                <div className="font-semibold">Multiview ({mv.length})</div>
                <button onClick={() => setMv([])} className="text-xs px-2 py-1 rounded bg-white/10">Clear</button>
              </div>
              <div className={`grid gap-2 ${mv.length <= 2 ? 'grid-cols-1 md:grid-cols-2' : mv.length <= 4 ? 'grid-cols-2' : 'grid-cols-3'}`}>
                {mv.map((ch) => (
                  <div key={ch.id} className="relative">
                    <MVPlayer channel={ch} />
                    <button onClick={() => removeFromMv(ch.id)} className="absolute top-1 right-1 text-xs px-1.5 py-0.5 rounded bg-black/60">✕</button>
                  </div>
                ))}
              </div>
              {mv.length === 0 && <div className="text-center text-white/50 text-sm mt-6">Add channels with MV button.</div>}
            </div>
          )}
        </section>
      </main>

      <nav className="sticky bottom-0 bg-black/70 backdrop-blur border-t border-white/10 flex justify-around py-2">
        {(['live', 'movies', 'series', 'guide', 'favorites', 'multiview', 'settings'] as Tab[]).map((t) => (
          <button key={t} onClick={() => setTab(t)} className={`px-2 py-1.5 rounded-lg text-xs capitalize ${tab === t ? 'text-orange-400' : 'text-white/60'}`}>{t}</button>
        ))}
      </nav>

      {selectedSeries && (
        <div className="fixed inset-0 z-30 bg-black/80 flex items-center justify-center p-4">
          <div className="bg-[#14171f] rounded-2xl p-5 w-full max-w-2xl space-y-3 border border-white/10 max-h-[90vh] overflow-y-auto">
            <div className="flex justify-between items-center">
              <h2 className="text-xl font-bold">{selectedSeries.name}</h2>
              <button onClick={() => setSelectedSeries(null)} className="text-white/60">✕</button>
            </div>
            {meta[selectedSeries.name] && (
              <div className="bg-white/5 rounded-lg p-3 text-sm space-y-1">
                <div className="text-xs text-white/60">{meta[selectedSeries.name].overview}</div>
                {meta[selectedSeries.name].vote_average && <div className="text-xs text-orange-300">Rating: {meta[selectedSeries.name].vote_average}</div>}
              </div>
            )}
            {Array.from(new Set(selectedSeries.episodes.map((e) => e.seasonNumber))).sort((a,b)=>a-b).map((sn) => (
              <div key={sn} className="space-y-1">
                <div className="font-semibold text-sm text-white/70">Season {sn}</div>
                {selectedSeries.episodes.filter((e) => e.seasonNumber === sn).sort((a,b)=>a.episodeNumber-b.episodeNumber).map((e) => (
                  <button key={e.channel.id} onClick={() => { selectChannel(e.channel); setSelectedSeries(null); }} className="w-full text-left px-3 py-2 rounded-lg hover:bg-white/5 flex items-center gap-3">
                    <div className="text-xs text-white/40 w-8">E{e.episodeNumber}</div>
                    <div className="flex-1 min-w-0">
                      <div className="truncate">{e.episodeTitle}</div>
                      <div className="truncate text-xs text-white/40">{e.channel.name}</div>
                    </div>
                  </button>
                ))}
              </div>
            ))}
          </div>
        </div>
      )}

      {tab === 'settings' && (
        <div className="fixed inset-0 z-30 bg-black/80 flex items-center justify-center p-4">
          <div className="bg-[#14171f] rounded-2xl p-5 w-full max-w-lg space-y-4 border border-white/10 max-h-[90vh] overflow-y-auto">
            <div className="flex justify-between items-center">
              <h2 className="text-xl font-bold">Settings</h2>
              <button onClick={() => setTab('live')} className="text-white/60">✕</button>
            </div>

            <div className="space-y-2">
              <div className="font-semibold">Playlist</div>
              <div className="text-sm text-white/60">{playlist ? `${playlist.name} — ${playlist.channels.length} channels` : 'None'}</div>
              <button onClick={() => { setPlaylist(null); setShowImport(true); setTab('live'); }} className="px-3 py-1.5 rounded-lg bg-white/10 text-sm">Clear playlist</button>
            </div>

            <div className="space-y-2">
              <div className="font-semibold">TMDb API key (optional)</div>
              <input value={tmdbKey} onChange={(e) => setTmdbKey(e.target.value)} placeholder="your v3 api key" className="w-full bg-white/5 rounded-lg px-3 py-2 outline-none" />
              <div className="text-xs text-white/50">Used for posters, ratings, cast, trailers.</div>
            </div>

            <div className="space-y-2">
              <div className="font-semibold">Profiles</div>
              <div className="flex gap-2">
                <input value={newProfileName} onChange={(e) => setNewProfileName(e.target.value)} placeholder="New profile name" className="flex-1 bg-white/5 rounded-lg px-3 py-2 outline-none" />
                <button onClick={createProfile} className="px-3 py-2 rounded-lg bg-white/10 text-sm">Add</button>
              </div>
              {profiles.map((p) => (
                <div key={p.id} className="flex items-center gap-2 bg-white/5 rounded-lg p-2">
                  <span className="flex-1 truncate">{p.name}</span>
                  <input placeholder="set PIN" className="bg-black/30 rounded px-2 py-1 text-xs w-20" onBlur={(e) => setProfilePin(p.id, e.target.value)} />
                  {p.id !== 'default' && <button onClick={() => setProfiles((prev) => prev.filter((x) => x.id !== p.id))} className="text-xs px-2 py-1 rounded bg-white/10">Delete</button>}
                </div>
              ))}
            </div>

            <div className="space-y-2">
              <div className="font-semibold">Groups (hide / rename / order)</div>
              {groups.map((g, idx) => (
                <div key={g} className="flex items-center gap-2">
                  <span className="flex-1 truncate">{renamed[g] || g}</span>
                  <input placeholder="rename" className="bg-white/5 rounded px-2 py-1 text-sm w-28" onBlur={(e) => renameGroup(g, e.target.value)} />
                  <button onClick={() => hideGroup(g)} className="text-xs px-2 py-1 rounded bg-white/10">Hide</button>
                  <button onClick={() => {
                    const order = [...activeProfile.groupOrder];
                    if (order.length === 0) groups.forEach((x) => order.push(x));
                    const i = order.indexOf(g);
                    if (i > 0) { [order[i - 1], order[i]] = [order[i], order[i - 1]]; updateProfile({ groupOrder: order }); }
                  }} className="text-xs px-2 py-1 rounded bg-white/10">↑</button>
                  <button onClick={() => {
                    const order = [...activeProfile.groupOrder];
                    if (order.length === 0) groups.forEach((x) => order.push(x));
                    const i = order.indexOf(g);
                    if (i >= 0 && i < order.length - 1) { [order[i], order[i + 1]] = [order[i + 1], order[i]]; updateProfile({ groupOrder: order }); }
                  }} className="text-xs px-2 py-1 rounded bg-white/10">↓</button>
                </div>
              ))}
              {hiddenGroups.length > 0 && <button onClick={unhideAll} className="text-xs px-2 py-1 rounded bg-white/10">Unhide all ({hiddenGroups.length})</button>}
            </div>

            <div className="space-y-2">
              <div className="font-semibold">Move channel to group</div>
              {selected && (
                <div className="flex gap-2">
                  <span className="flex-1 truncate text-sm">{selected.name}</span>
                  <select onChange={(e) => setChannelGroup(selected.id, e.target.value)} value={selected.group || 'Uncategorized'} className="bg-white/5 rounded px-2 py-1 text-sm">
                    {allGroups.map((g) => <option key={g} value={g}>{g}</option>)}
                    <option value="__new__">+ New group</option>
                  </select>
                </div>
              )}
              {!selected && <div className="text-sm text-white/50">Select a channel first.</div>}
            </div>

            <div className="space-y-2">
              <div className="font-semibold">Continue watching</div>
              {continueChannels.length === 0 && <div className="text-sm text-white/50">Nothing yet.</div>}
              {continueChannels.map((ch) => (
                <button key={ch.id} onClick={() => selectChannel(ch)} className="block w-full text-left text-sm px-2 py-1 rounded hover:bg-white/5">{ch.name}</button>
              ))}
            </div>

            {status && <div className="text-sm text-green-400">{status}</div>}
          </div>
        </div>
      )}
    </div>
  );
}

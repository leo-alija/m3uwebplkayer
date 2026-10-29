'use client';
import { useEffect, useRef, useState, useMemo, useCallback } from 'react';
import { buildXtreamM3uUrl } from '@/lib/m3u';
import { parseM3UWithProgress } from '@/lib/m3u-client';
import { buildCatchupUrl } from '@/lib/catchup';
import { parseXMLTV, nowProgram, parseXmltvDate, progWindow } from '@/lib/epg';
import { fetchEpg } from '@/lib/epg-client';
import { load, save, loadPlaylist, savePlaylist, clearPlaylist as clearPlaylistStore } from '@/lib/storage';
import { idbGet, idbSet, idbDel } from '@/lib/idb';
import { groupIntoFolders } from '@/lib/series';
import { getTmdb, getTmdbList, type TmdbListItem } from '@/lib/tmdb';
import { downloadVideo, canDownload, getDownloadIndex } from '@/lib/downloads';
import { mvCap } from '@/lib/env';
import { buildFolders } from '@/lib/folders';
import { Channel, Playlist, PlaylistEntry, Program, SeriesFolder, SeriesEpisode, Profile, ImportProgress, AppSettings, DEFAULT_PROFILE, GUEST_PROFILE, DEFAULT_SETTINGS } from '@/lib/types';
import Player from '@/components/player';
import Multiview from '@/components/multiview';
import DetailSheet from '@/components/detail';
import LivetvScreen, { sortChannels } from '@/components/livetv';
import FlixScreen, { buildFlixCategories, type FlixItem } from '@/components/flix';
import { ImportSheet, ProfilesSheet, PinOverlay, SearchOverlay, type SearchScope } from '@/components/sheets';
import { SettingsSheet } from '@/components/settings';
import { Hero, Shelf, LiveTile, PosterCard, Aurora, Skeletons, GenreStrip, type HeroSlide } from '@/components/home-flix';
import { GuideGrid } from '@/components/guide-grid';
import { IconHome, IconLive, IconSeries, IconMovie, IconGuide, IconSearch, IconSettings, IconStar, IconPlus, IconChevron, IconPlayCircle, Poster, Chip, IconClose } from '@/components/ui';

type Tab = 'home' | 'live' | 'series' | 'movies' | 'guide';

const isIOS = typeof navigator !== 'undefined' && (/iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1));

/* 4-digit PINs are stored hashed, never in plain text */
function hashPin(pin: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < pin.length; i++) { h ^= pin.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return `h${h.toString(36)}`;
}

const norm = (s: string) => s.toLowerCase().replace(/\s*[(\[][^)\]]*[)\]]\)?/g, '').replace(/[^a-z0-9]+/g, ' ').trim();

export default function Home() {
  const [profiles, setProfiles] = useState<Profile[]>([{ ...DEFAULT_PROFILE }, { ...GUEST_PROFILE }]);
  const [activeProfileId, setActiveProfileId] = useState('default');
  const [playlistIndex, setPlaylistIndex] = useState<PlaylistEntry[]>([]);
  const [activePlaylistId, setActivePlaylistId] = useState('');
  const [playlist, setPlaylist] = useState<Playlist | null>(null);
  const [overrides, setOverrides] = useState<Record<string, string>>({});
  const [tab, setTab] = useState<Tab>('home');
  const [visible, setVisible] = useState<Record<string, number>>({ guide: 80 });

  const [showImport, setShowImport] = useState(false);
  const [importUrl, setImportUrl] = useState('');
  const [importing, setImporting] = useState(false);
  const [importError, setImportError] = useState('');
  const [importProgress, setImportProgress] = useState<ImportProgress | null>(null);
  const [xtream, setXtream] = useState({ host: '', user: '', pass: '' });
  const [canRefresh, setCanRefresh] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const [selected, setSelected] = useState<{ channel: Channel; resume: number; catchup?: boolean } | null>(null);
  const [detail, setDetail] = useState<{ kind: 'movie' | 'series'; title: string; folder?: SeriesFolder; channel?: Channel } | null>(null);
  const [downloads, setDownloads] = useState<Record<string, { pct: number; done?: boolean; failed?: string }>>({});
  const dlAbort = useRef<Record<string, AbortController>>({});

  const [mv, setMv] = useState<Channel[]>([]);
  const [showMv, setShowMv] = useState(false);

  const [showSearch, setShowSearch] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [showProfiles, setShowProfiles] = useState(false);
  const [showPin, setShowPin] = useState<{ profile: Profile; resolve: (ok: boolean) => void } | null>(null);
  const [coldPin, setColdPin] = useState<Profile | null>(null);

  const [tmdbKey, setTmdbKey] = useState('');
  const [meta, setMeta] = useState<Record<string, any>>({});
  const [settings, setSettingsState] = useState<AppSettings>(DEFAULT_SETTINGS);
  const [epg, setEpg] = useState<Record<string, Program[]>>({});
  const [epgInfo, setEpgInfo] = useState<{ programmeCount: number; channelCount: number; lastRefresh: number | null; loading: number }>({ programmeCount: 0, channelCount: 0, lastRefresh: null, loading: 0 });
  const [hasRestoreSnapshot, setHasRestoreSnapshot] = useState(false);
  const [tmdbLists, setTmdbLists] = useState<Record<string, TmdbListItem[] | null>>({});
  const [status, setStatus] = useState('');
  const [swUpdate, setSwUpdate] = useState(false);
  const [showInstallHint, setShowInstallHint] = useState(false);
  const [isStandalone, setIsStandalone] = useState(true);
  const statusTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const launched = useRef(false);

  const activeProfile = profiles.find((p) => p.id === activeProfileId) || profiles[0];

  const updateProfile = useCallback((patch: Partial<Profile>) => {
    setProfiles((prev) => prev.map((p) => (p.id === activeProfileId ? { ...p, ...patch } : p)));
  }, [activeProfileId]);

  const flash = useCallback((msg: string) => {
    setStatus(msg);
    if (statusTimer.current) clearTimeout(statusTimer.current);
    statusTimer.current = setTimeout(() => setStatus(''), 3000);
  }, []);

  const setSettings = useCallback((patch: Partial<AppSettings>) => {
    setSettingsState((s) => ({ ...s, ...patch }));
  }, []);

  const guideOffsetMinutes = settings.guideOffsetHours * 60;

  /* subtitle appearance → CSS custom properties */
  useEffect(() => {
    const root = document.documentElement;
    root.style.setProperty('--sub-size', settings.subSize === 's' ? '13px' : settings.subSize === 'l' ? '19px' : '15px');
    root.style.setProperty('--sub-color', settings.subColor);
    root.style.setProperty('--sub-bg', settings.subBg);
  }, [settings.subSize, settings.subColor, settings.subBg]);

  /* ---------- load / persist ---------- */
  useEffect(() => {
    const storedProfiles = (): Profile[] =>
      load<Profile[]>('profiles', []).filter((p) => p.id !== 'guest').map((p) => ({ ...DEFAULT_PROFILE, ...p }));
    const ps = storedProfiles();
    const merged: Profile[] = [...(ps.length ? ps : [{ ...DEFAULT_PROFILE } as Profile]), { ...GUEST_PROFILE }];
    setProfiles(merged);
    const active = load('activeProfileId', merged[0].id);
    setActiveProfileId(merged.some((p) => p.id === active) ? active : merged[0].id);
    setOverrides(load('groupOverrides', {}));
    setTmdbKey(load('tmdbKey', ''));
    const storedSettings = load<Partial<AppSettings>>('settings', {});
    setSettingsState({ ...DEFAULT_SETTINGS, ...storedSettings });
    idbGet<any>('restoreSnapshot').then((snap) => setHasRestoreSnapshot(!!snap));
    const standalone = (window.navigator as any).standalone === true || window.matchMedia('(display-mode: standalone)').matches;
    setIsStandalone(standalone);

    /* playlist index + active playlist (migrates the legacy single playlist) */
    (async () => {
      let index = load<PlaylistEntry[]>('playlistIndex', []);
      if (!index.length) {
        const legacy = await loadPlaylist<Playlist>();
        if (legacy) {
          const entry: PlaylistEntry = { id: 'default', name: legacy.name || 'My playlist', channelCount: legacy.channels.length, epgUrl: legacy.epgUrl, importedAt: legacy.importedAt };
          await idbSet('pl:default', legacy);
          index = [entry];
          save('playlistIndex', index);
        }
      }
      setPlaylistIndex(index);
      const activePl = load('activePlaylistId', index[0]?.id || '');
      setActivePlaylistId(activePl);
      let pl: Playlist | null = null;
      if (index.length) {
        pl = await idbGet<Playlist>(`pl:${activePl || index[0].id}`);
        if (pl) {
          setPlaylist(pl);
          if (pl.epgUrl) loadEpg(pl.epgUrl);
        } else {
          setShowImport(true);
        }
      } else {
        if (isIOS && !standalone) setShowInstallHint(true);
        setShowImport(true);
      }
      /* resume-last-channel on launch */
      if (storedSettings.resumeLastChannel && !launched.current) {
        launched.current = true;
        const prof = storedProfiles().find((p) => p.id === active);
        const lastId = prof?.recents?.[0];
        if (lastId && pl) {
          const ch = pl.channels.find((c: Channel) => c.id === lastId);
          if (ch && (!ch.contentType || ch.contentType === 'LIVE')) setTimeout(() => selectChannelRef.current?.(ch), 300);
        }
      }
    })();

    /* cold-start PIN */
    const prof = storedProfiles().find((p) => p.id === load('activeProfileId', 'default'));
    if (prof?.pin) setColdPin(prof);

    /* PWA update detection */
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('/sw.js').then((reg) => {
        reg.addEventListener('updatefound', () => {
          const installing = reg.installing;
          installing?.addEventListener('statechange', () => {
            if (installing.state === 'installed' && navigator.serviceWorker.controller) setSwUpdate(true);
          });
        });
      }).catch(() => {});
    }
  }, []);

  useEffect(() => { save('profiles', profiles.filter((p) => !p.guest)); }, [profiles]);
  useEffect(() => { save('activeProfileId', activeProfileId); }, [activeProfileId]);
  useEffect(() => { save('groupOverrides', overrides); }, [overrides]);
  useEffect(() => { save('tmdbKey', tmdbKey); }, [tmdbKey]);
  useEffect(() => { save('settings', settings); }, [settings]);
  useEffect(() => { save('activePlaylistId', activePlaylistId); }, [activePlaylistId]);

  /* ---------- auto-refresh timers ---------- */
  const refreshPlaylist = useRef(() => {});
  refreshPlaylist.current = () => { if (canRefresh) doRefreshPlaylist(); };
  useEffect(() => {
    const mins = { manual: 0, '15m': 15, '30m': 30, '1h': 60, '2h': 120 }[settings.playlistAutoRefresh] || 0;
    if (!mins) return;
    const t = setInterval(() => refreshPlaylist.current(), mins * 60_000);
    return () => clearInterval(t);
  }, [settings.playlistAutoRefresh]);

  const refreshEpg = useRef(() => {});
  refreshEpg.current = () => { const url = playlist?.epgUrl; if (url) loadEpg(url); };
  useEffect(() => {
    const mins = { manual: 0, '1h': 60, '2h': 120, '4h': 240, '6h': 360, '12h': 720 }[settings.epgAutoRefresh] || 0;
    if (!mins) return;
    const t = setInterval(() => refreshEpg.current(), mins * 60_000);
    return () => clearInterval(t);
  }, [settings.epgAutoRefresh, playlist?.epgUrl]);

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
    setEpgInfo((i) => ({ ...i, loading: i.loading + 1 }));
    try {
      const { epg: parsed, programmeCount, channelCount } = await fetchEpg(url, (bytes) => {
        setEpgInfo((i) => ({ ...i })); /* streaming; counts arrive at the end */
      });
      /* commit only on success — the old guide stays intact on failure */
      setEpg(parsed);
      setEpgInfo({ programmeCount, channelCount, lastRefresh: Date.now(), loading: 0 });
      flash(`Guide loaded — ${programmeCount.toLocaleString()} programmes`);
    } catch (e: any) {
      setEpgInfo((i) => ({ ...i, loading: 0 }));
      flash(e?.message || 'Guide failed — keeping the previous one');
    }
  }

  /* ---------- import ---------- */
  const applyOverrides = useCallback((chs: Channel[]) =>
    chs.map((c) => (overrides[c.id]
      ? { ...c, group: overrides[c.id], groups: [overrides[c.id]] }
      : c)), [overrides]);

  async function importPlaylistText(text: string, name: string, epgUrl?: string, asNew = true) {
    setImportProgress({ phase: 'parse', lines: 0, total: 0 });
    const parsed = await parseM3UWithProgress(text, (p) => setImportProgress({ phase: 'parse', ...p }));
    const importedAt = Date.now();
    const chs = applyOverrides(parsed.channels).map((c, i) => ({ ...c, addedAt: importedAt + i }));
    setImportProgress({ phase: 'save' });
    const pl: Playlist = { name, channels: chs, epgUrl: epgUrl || parsed.epgUrl, importedAt };
    const id = asNew ? `pl_${importedAt.toString(36)}` : activePlaylistId || 'default';
    await idbSet(`pl:${id}`, pl);
    const entry: PlaylistEntry = { id, name, channelCount: chs.length, epgUrl: pl.epgUrl, importedAt };
    const index = asNew ? [...playlistIndex.filter((x) => x.id !== id), entry] : playlistIndex.map((x) => (x.id === id ? entry : x));
    setPlaylistIndex(index);
    save('playlistIndex', index);
    setPlaylist(pl);
    setActivePlaylistId(id);
    setShowImport(false);
    setTab('home');
    setImportProgress(null);
    setCanRefresh(!!load('lastImport', null));
    flash(`Loaded ${chs.length.toLocaleString()} items`);
    if (pl.epgUrl) loadEpg(pl.epgUrl);
  }

  async function importFromUrl() {
    setImporting(true); setImportError('');
    try {
      const url = importUrl.trim();
      const text = await fetchText(url, (received, contentTotal) => setImportProgress({ phase: 'download', received, contentTotal }));
      await importPlaylistText(text, url);
      save('lastImport', { kind: 'url', url });
      setCanRefresh(true);
    } catch (e: any) { setImportError(e?.message || 'Import failed — check the URL'); setImportProgress(null); }
    finally { setImporting(false); }
  }

  async function importFromFile(file: File) {
    setImporting(true); setImportError('');
    const reader = new FileReader();
    reader.onload = async () => {
      try {
        await importPlaylistText(String(reader.result || ''), file.name);
        save('lastImport', { kind: 'file', name: file.name });
        setCanRefresh(false);
      }
      catch (e: any) { setImportError(e?.message || 'Import failed'); setImportProgress(null); }
      finally { setImporting(false); }
    };
    reader.readAsText(file);
  }

  async function importXtream() {
    setImporting(true); setImportError('');
    try {
      const host = xtream.host.trim();
      const url = buildXtreamM3uUrl(host, xtream.user, xtream.pass);
      const text = await fetchText(url, (received, contentTotal) => setImportProgress({ phase: 'download', received, contentTotal }));
      const epgUrl = `${host.replace(/\/+$/, '')}/xmltv.php?username=${encodeURIComponent(xtream.user)}&password=${encodeURIComponent(xtream.pass)}`;
      await importPlaylistText(text, host, epgUrl);
      save('lastImport', { kind: 'xtream', host, user: xtream.user, pass: xtream.pass });
      setCanRefresh(true);
    } catch (e: any) { setImportError(e?.message || 'Import failed — check the login'); setImportProgress(null); }
    finally { setImporting(false); }
  }

  async function fetchText(url: string, onBytes?: (received: number, total: number) => void) {
    const res = await fetch(`/api/fetch?url=${encodeURIComponent(url)}`);
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      throw new Error(j.error || 'fetch failed');
    }
    if (!onBytes || !res.body) return await res.text();
    const contentTotal = Number(res.headers.get('content-length')) || 0;
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let received = 0;
    let out = '';
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      received += value.byteLength;
      out += decoder.decode(value, { stream: true });
      onBytes(received, contentTotal);
    }
    return out + decoder.decode();
  }

  /* Re-fetch the last URL/Xtream source into the ACTIVE playlist */
  async function doRefreshPlaylist() {
    const li = load<any>('lastImport', null);
    if (!li || refreshing) return;
    setRefreshing(true);
    try {
      let text: string; let name: string; let epgUrl: string | undefined;
      if (li.kind === 'url') {
        text = await fetchText(li.url, (received, contentTotal) => setImportProgress({ phase: 'download', received, contentTotal }));
        name = li.url;
      } else if (li.kind === 'xtream') {
        const host = String(li.host || '');
        text = await fetchText(buildXtreamM3uUrl(host, li.user, li.pass), (received, contentTotal) => setImportProgress({ phase: 'download', received, contentTotal }));
        name = host;
        epgUrl = `${host.replace(/\/+$/, '')}/xmltv.php?username=${encodeURIComponent(li.user)}&password=${encodeURIComponent(li.pass)}`;
      } else {
        flash('File imports can’t be refreshed — re-upload the file');
        return;
      }
      await importPlaylistText(text, name || playlist?.name || 'playlist', epgUrl || playlist?.epgUrl, false);
      flash('Playlist refreshed');
    } catch (e: any) {
      setImportProgress(null);
      flash(e?.message || 'Refresh failed — check the connection');
    } finally { setRefreshing(false); }
  }

  /* ---------- playlist management ---------- */
  async function switchPlaylist(id: string) {
    setActivePlaylistId(id);
    const pl = await idbGet<Playlist>(`pl:${id}`);
    if (pl) {
      setPlaylist(pl);
      setEpg({});
      setEpgInfo({ programmeCount: 0, channelCount: 0, lastRefresh: null, loading: 0 });
      if (pl.epgUrl) loadEpg(pl.epgUrl);
      flash('Playlist switched');
    }
  }

  async function deletePlaylist(id: string) {
    const entry = playlistIndex.find((x) => x.id === id);
    if (!confirm(`Delete “${entry?.name || id}” (${entry?.channelCount.toLocaleString() || 0} channels)? Favourites and history stay.`)) return;
    await idbDel(`pl:${id}`);
    const index = playlistIndex.filter((x) => x.id !== id);
    setPlaylistIndex(index);
    save('playlistIndex', index);
    if (id === activePlaylistId) {
      if (index.length) await switchPlaylist(index[0].id);
      else { setPlaylist(null); setActivePlaylistId(''); }
    }
    flash('Playlist deleted');
  }

  /* ---------- backup ---------- */
  async function exportData() {
    const allPlaylists: Record<string, Playlist> = {};
    for (const entry of playlistIndex) {
      const pl = await idbGet<Playlist>(`pl:${entry.id}`);
      if (pl) allPlaylists[entry.id] = pl;
    }
    const data = { v: 2, profiles, activeProfileId, groupOverrides: overrides, tmdbKey, settings, playlistIndex, playlists: allPlaylists };
    const blob = new Blob([JSON.stringify(data)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'm3u-webplayer-backup.json';
    a.click();
    URL.revokeObjectURL(a.href);
    flash('Backup downloaded');
  }

  async function restoreData(data: any) {
    /* snapshot first so "Undo last restore" can put everything back */
    const snapshot: any = { v: 2, profiles, activeProfileId, groupOverrides: overrides, tmdbKey, settings, playlistIndex, playlists: {} };
    for (const entry of playlistIndex) {
      const pl = await idbGet<Playlist>(`pl:${entry.id}`);
      if (pl) snapshot.playlists[entry.id] = pl;
    }
    await idbSet('restoreSnapshot', snapshot);
    setHasRestoreSnapshot(true);

    if (Array.isArray(data.profiles)) {
      const restored = (data.profiles as Profile[]).map((p) => ({ ...DEFAULT_PROFILE, ...p }));
      const merged: Profile[] = [...restored.filter((p) => p.id !== 'guest'), { ...GUEST_PROFILE }];
      setProfiles(merged);
      save('profiles', merged.filter((p) => !p.guest));
    }
    if (data.activeProfileId) { setActiveProfileId(data.activeProfileId); save('activeProfileId', data.activeProfileId); }
    if (data.groupOverrides) { setOverrides(data.groupOverrides); save('groupOverrides', data.groupOverrides); }
    if (typeof data.tmdbKey === 'string') { setTmdbKey(data.tmdbKey); save('tmdbKey', data.tmdbKey); }
    if (data.settings) { setSettingsState({ ...DEFAULT_SETTINGS, ...data.settings }); save('settings', data.settings); }
    const idx: PlaylistEntry[] = data.playlistIndex || (data.playlist ? [{ id: 'default', name: data.playlist.name, channelCount: data.playlist.channels.length, epgUrl: data.playlist.epgUrl, importedAt: data.playlist.importedAt }] : []);
    if (idx.length) {
      save('playlistIndex', idx);
      setPlaylistIndex(idx);
      const pls: Record<string, Playlist> = data.playlists || (data.playlist ? { [idx[0].id]: data.playlist } : {});
      for (const [id, pl] of Object.entries(pls)) await idbSet(`pl:${id}`, pl);
      await switchPlaylist(idx[0].id);
    }
    flash('Backup restored — reloading…');
    setTimeout(() => location.reload(), 900);
  }

  async function undoRestore() {
    const snap = await idbGet<any>('restoreSnapshot');
    if (!snap) { flash('Nothing to undo'); return; }
    const idx: PlaylistEntry[] = snap.playlistIndex || [];
    for (const [id, pl] of Object.entries(snap.playlists || {})) await idbSet(`pl:${id}`, pl);
    for (const entry of playlistIndex) if (!idx.some((x) => x.id === entry.id)) await idbDel(`pl:${entry.id}`);
    save('playlistIndex', idx);
    if (Array.isArray(snap.profiles)) save('profiles', snap.profiles.filter((p: Profile) => !p.guest));
    if (snap.activeProfileId) save('activeProfileId', snap.activeProfileId);
    if (snap.groupOverrides) save('groupOverrides', snap.groupOverrides);
    if (snap.tmdbKey != null) save('tmdbKey', snap.tmdbKey);
    if (snap.settings) save('settings', snap.settings);
    await idbDel('restoreSnapshot');
    flash('Restore undone — reloading…');
    setTimeout(() => location.reload(), 900);
  }

  async function clearAllData() {
    if (!confirm('Factory reset: delete playlists, profiles, favourites, history and downloads?')) return;
    save('profiles', []); save('playlistIndex', []); save('groupOverrides', {}); save('settings', {}); save('tmdbKey', '');
    const keys = ['playlist', 'dlIndex', 'restoreSnapshot', 'lastImport', 'tmdbKeys'];
    for (const k of keys) await idbDel(k);
    if (playlistIndex.length) for (const e of playlistIndex) await idbDel(`pl:${e.id}`);
    const downloads = await getDownloadIndex();
    for (const d of downloads) await idbDel(`dl:${d.id}`);
    flash('All data cleared — reloading…');
    setTimeout(() => location.reload(), 900);
  }

  function checkForUpdates() {
    if (!('serviceWorker' in navigator)) { flash('No service worker — you are on the latest'); return; }
    navigator.serviceWorker.getRegistration().then((reg) => {
      if (!reg) { flash('You are on the latest version'); return; }
      reg.update().then(() => {
        setTimeout(() => { if (!swUpdate) flash('You are on the latest version'); }, 2500);
      }).catch(() => flash('Update check failed'));
    });
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

  const selectChannelRef = useRef<(ch: Channel, resume?: number, catchup?: boolean) => void>(() => {});

  const selectChannel = useCallback((ch: Channel, resume?: number, catchup?: boolean) => {
    const r = resume ?? resumeMap[ch.id]?.time ?? 0;
    setSelected({ channel: ch, resume: (!ch.contentType || ch.contentType === 'LIVE') && !catchup ? 0 : r, catchup });
    updateProfile({
      recents: [ch.id, ...activeProfile.recents.filter((x) => x !== ch.id)].slice(0, 30),
      watchHistory: [ch.id, ...activeProfile.watchHistory.filter((x) => x !== ch.id)].slice(0, 200),
      playCounts: { ...(activeProfile.playCounts || {}), [ch.id]: ((activeProfile.playCounts || {})[ch.id] || 0) + 1 },
    });
    const type = ch.contentType === 'MOVIE' ? 'movie' : ch.contentType === 'SERIES' ? 'tv' : null;
    if (type && !meta[`${type}:${ch.name}`]) {
      getTmdb(type as 'movie' | 'tv', ch.name, tmdbKey).then((m) => { if (m) setMeta((prev) => ({ ...prev, [`${type}:${ch.name}`]: m })); });
    }
  }, [activeProfile, updateProfile, resumeMap, tmdbKey, meta]);
  selectChannelRef.current = selectChannel;

  function onProgress(channelId: string, time: number, duration: number) {
    const ch = playlist?.channels.find((c) => c.id === channelId);
    if (!ch || !ch.contentType || ch.contentType === 'LIVE') return;
    const others = activeProfile.continueWatching.filter((c) => c.channelId !== channelId);
    const nearEnd = duration > 0 && time > duration - 30;
    const next = nearEnd
      ? others
      : [{ channelId, time, duration: Number.isFinite(duration) ? duration : 0, updatedAt: Date.now() }, ...others].slice(0, 50);
    const patch: Partial<Profile> = { continueWatching: next };
    /* fully watched tracking at ≥92% */
    if (duration > 0 && time / duration >= 0.92 && !activeProfile.watched.includes(channelId)) {
      patch.watched = [...activeProfile.watched, channelId];
    }
    updateProfile(patch);
  }

  function markWatchedItem(item: FlixItem, watched: boolean) {
    const ids = item.channel ? [item.channel.id] : (item.folder?.episodes.map((e) => e.channel.id) || []);
    if (!ids.length) return;
    const next = watched
      ? Array.from(new Set([...activeProfile.watched, ...ids]))
      : activeProfile.watched.filter((x) => !ids.includes(x));
    updateProfile({ watched: next });
    flash(watched ? 'Marked as watched' : 'Marked unwatched');
  }

  function isWatchedItem(item: FlixItem): boolean {
    if (item.channel) return activeProfile.watched.includes(item.channel.id);
    if (item.folder) {
      const eps = item.folder.episodes;
      return eps.length > 0 && eps.every((e) => activeProfile.watched.includes(e.channel.id));
    }
    return false;
  }

  function toggleFavorite(id: string) {
    const next = activeProfile.favorites.includes(id)
      ? activeProfile.favorites.filter((x) => x !== id)
      : [...activeProfile.favorites, id];
    updateProfile({ favorites: next });
  }

  function toggleWatchlist(id: string) {
    const cur = activeProfile.watchlist || [];
    const has = cur.includes(id);
    updateProfile({ watchlist: has ? cur.filter((x) => x !== id) : [id, ...cur] });
    flash(has ? 'Removed from watchlist' : 'Added to watchlist');
  }

  function addToMv(ch: Channel) {
    setSelected(null);
    setShowMv(true);
    if (mv.find((x) => x.id === ch.id)) return;
    const cap = mvCap();
    if (mv.length >= cap) {
      flash(`Multiview is capped at ${cap} tiles on this device`);
      return;
    }
    setMv((prev) => [...prev, ch]);
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

  function openSimilar(title: string) {
    const t = norm(title);
    if (!t) return;
    const folder = seriesFolders.find((f) => norm(f.name) === t)
      || seriesFolders.find((f) => norm(f.name).includes(t) || t.includes(norm(f.name)));
    if (folder) { setDetail(null); openDetail('series', folder.name, { folder }); return; }
    const movie = movieChannels.find((c) => norm(c.name) === t)
      || movieChannels.find((c) => norm(c.name).includes(t) || t.includes(norm(c.name)));
    if (movie) { setDetail(null); openDetail('movie', movie.name, { channel: movie }); return; }
    flash(`“${title}” is not in your playlist`);
  }

  /* ---------- downloads (offline) ---------- */
  useEffect(() => {
    (async () => {
      const idx = await getDownloadIndex();
      const m: Record<string, { pct: number; done?: boolean; failed?: string }> = {};
      for (const d of idx) m[d.id] = { pct: 100, done: true };
      setDownloads(m);
    })();
  }, []);

  function onWifi(): boolean {
    if (!settings.wifiOnly) return true;
    const conn = (navigator as any).connection;
    if (!conn) return true; /* can't tell — allow */
    if (conn.type && /wifi|ethernet/i.test(conn.type)) return true;
    if (conn.type && /cellular/i.test(conn.type)) return false;
    return true;
  }

  async function startDownload(ch: Channel) {
    if (downloads[ch.id]?.done || dlAbort.current[ch.id]) { flash('Already saved offline'); return; }
    if (!canDownload(ch.url)) { flash('Only direct files (mp4/mkv…) can be saved offline'); return; }
    if (!onWifi()) { flash('Wi-Fi only is on — connect to Wi-Fi to download'); return; }
    const ac = new AbortController();
    dlAbort.current[ch.id] = ac;
    setDownloads((m) => ({ ...m, [ch.id]: { pct: 0 } }));
    try {
      await downloadVideo(ch.id, ch.url, ch.name, (pct) => setDownloads((m) => ({ ...m, [ch.id]: { pct } })), ac.signal);
      setDownloads((m) => ({ ...m, [ch.id]: { pct: 100, done: true } }));
      flash('Saved for offline');
    } catch (e: any) {
      if (e?.name === 'AbortError') {
        setDownloads((m) => { const { [ch.id]: _drop, ...rest } = m; return rest; });
      } else {
        setDownloads((m) => ({ ...m, [ch.id]: { pct: 0, failed: e?.message || 'Download failed' } }));
        flash(e?.message || 'Download failed');
      }
    } finally {
      delete dlAbort.current[ch.id];
    }
  }

  /* ---------- derived ---------- */
  const channels = playlist?.channels || [];
  const favorites = activeProfile.favorites;
  const hiddenGroups = activeProfile.hiddenGroups;

  const allGroups = useMemo(() => Array.from(new Set(channels.flatMap((c) => c.groups || [c.group || 'Uncategorized']))), [channels]);
  const groupCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const c of channels) for (const g of (c.groups || [c.group || 'Uncategorized'])) counts[g] = (counts[g] || 0) + 1;
    return counts;
  }, [channels]);

  const groups = useMemo(() => {
    const vis = allGroups.filter((g) => !hiddenGroups.includes(g));
    const order = activeProfile.groupOrder;
    return [...vis].sort((a, b) => {
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
  const watchlistChannels = useMemo(
    () => (activeProfile.watchlist || []).map((id) => channels.find((c) => c.id === id)).filter(Boolean) as Channel[],
    [activeProfile.watchlist, channels]);
  const watchedChannels = useMemo(
    () => activeProfile.watched.map((id) => channels.find((c) => c.id === id)).filter(Boolean) as Channel[],
    [activeProfile.watched, channels]);

  const topChannels = useMemo(() => {
    const counts = activeProfile.playCounts || {};
    return Object.entries(counts)
      .sort((a, b) => b[1] - a[1])
      .map(([id]) => channels.find((c) => c.id === id))
      .filter(Boolean)
      .slice(0, 10) as Channel[];
  }, [activeProfile.playCounts, channels]);

  /* recently added: last imports first */
  const recentlyAdded = useMemo(() => [...movieChannels].sort((a, b) => (b.addedAt || 0) - (a.addedAt || 0)).slice(0, 14), [movieChannels]);

  const zapList = useMemo(() => [...liveChannels].sort((a, b) =>
    (a.channelNumber ?? 1e9) - (b.channelNumber ?? 1e9) || a.name.localeCompare(b.name)), [liveChannels]);

  const zapChannel = useCallback((dir: 1 | -1) => {
    if (!selected) return;
    const type = selected.channel.contentType;
    if (type && type !== 'LIVE') return;
    const idx = zapList.findIndex((c) => c.id === selected.channel.id);
    if (idx === -1 || zapList.length < 2) return;
    selectChannel(zapList[(idx + dir + zapList.length) % zapList.length]);
  }, [selected, zapList, selectChannel]);

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

  /* ---------- TMDb front-page rails (trending / popular / top rated) ---------- */
  useEffect(() => {
    let gone = false;
    (async () => {
      const kinds: ['trending' | 'popular' | 'top_rated', 'movie' | 'tv'][] = [
        ['trending', 'movie'], ['popular', 'movie'], ['top_rated', 'movie'], ['trending', 'tv'],
      ];
      for (const [kind, type] of kinds) {
        const list = await getTmdbList(kind, type, tmdbKey);
        if (gone) return;
        setTmdbLists((prev) => ({ ...prev, [`${kind}:${type}`]: list }));
      }
    })();
    return () => { gone = true; };
  }, [tmdbKey]);

  /* Match a TMDb shelf against the user's own library (fallback: play counts) */
  const tmdbRail = useCallback((kind: 'trending' | 'popular' | 'top_rated', type: 'movie' | 'tv'): Channel[] => {
    const list = tmdbLists[`${kind}:${type}`];
    if (!list?.length) return [];
    const pool = type === 'movie' ? movieChannels : [...seriesFolders.flatMap((f) => f.episodes.map((e) => ({ ...e.channel, seriesName: f.name, poster: f.tmdbPosterUrl || f.posterUrl })))];
    const byName = new Map<string, any>();
    for (const c of pool) byName.set(norm((c as any).seriesName || c.name), c);
    const out: Channel[] = [];
    const seen = new Set<string>();
    for (const item of list) {
      const key = norm(item.title);
      const hit = byName.get(key);
      if (hit && !seen.has(hit.id)) { seen.add(hit.id); out.push(hit); }
      if (out.length >= 14) break;
    }
    return out;
  }, [tmdbLists, movieChannels, seriesFolders]);

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

  /* live related rail for the player */
  const relatedChannels = useMemo(() => {
    if (!selected) return [];
    const c = selected.channel;
    if (c.contentType === 'MOVIE' || c.contentType === 'SERIES') return [];
    const groups = new Set(c.groups || [c.group || '']);
    return liveChannels
      .filter((x) => x.id !== c.id && (x.groups || [x.group || '']).some((g) => groups.has(g)))
      .sort((a, b) => (a.channelNumber ?? 1e9) - (b.channelNumber ?? 1e9))
      .slice(0, 14);
  }, [selected, liveChannels]);

  const nowNext = useMemo(() => {
    if (!selected) return undefined;
    const progs = epgFor(selected.channel);
    if (!progs?.length) return { now: undefined, upcoming: [] as Program[] };
    const now = nowProgram(progs, guideOffsetMinutes);
    const nowEnd = now ? progWindow(now, guideOffsetMinutes).stop : new Date(0).getTime();
    const upcoming = progs
      .filter((p) => progWindow(p, guideOffsetMinutes).start >= nowEnd)
      .slice(0, 12);
    return { now, upcoming };
  }, [selected, epgFor, guideOffsetMinutes]);

  const playerEpisodes = useMemo(() => {
    if (!selected?.channel || selected.channel.contentType !== 'SERIES') return undefined;
    const folder = seriesFolders.find((f) => f.episodes.some((e) => e.channel.id === selected.channel.id));
    return folder?.episodes;
  }, [selected, seriesFolders]);

  /* flix items */
  const movieItems = useMemo<FlixItem[]>(() => {
    const resume = new Map(continueEntries.map((e) => [e.ch.id, e.pct]));
    return movieChannels.map((ch) => {
      const m = meta[`movie:${ch.name}`];
      return {
        key: ch.id,
        title: ch.name.replace(/\s*[(\[][^)\]]*[)\]]\)?$/, ''),
        poster: ch.logo,
        quality: ch.qualityTag,
        channel: ch,
        rating: m?.vote_average || undefined,
        year: m?.release_date?.slice(0, 4),
        resumePct: resume.get(ch.id),
      };
    });
  }, [movieChannels, meta, continueEntries]);

  const seriesItems = useMemo<FlixItem[]>(() => {
    return seriesFolders.map((f) => {
      const m = meta[`tv:${f.name}`];
      const first = f.episodes[0]?.channel;
      return {
        key: f.name,
        title: f.name,
        poster: f.tmdbPosterUrl || f.posterUrl,
        folder: f,
        rating: m?.vote_average || undefined,
        year: m?.first_air_date?.slice(0, 4),
        resumePct: first ? continueEntries.find((e) => e.ch.id === first.id)?.pct : undefined,
      };
    });
  }, [seriesFolders, meta, continueEntries]);

  const movieCategories = useMemo(
    () => buildFlixCategories(Array.from(new Set(movieChannels.flatMap((c) => c.groups || [c.group || '']))), hiddenGroups),
    [movieChannels, hiddenGroups]);
  const seriesCategories = useMemo(
    () => buildFlixCategories(Array.from(new Set(seriesChannels.flatMap((c) => c.groups || [c.group || '']))), hiddenGroups),
    [seriesChannels, hiddenGroups]);

  const tabTitle: Record<Tab, string> = { home: 'Home', live: 'Live TV', series: 'Series', movies: 'Films', guide: 'Guide' };

  const detailId = detail?.channel?.id || (detail?.folder ? detail.folder.episodes[0]?.channel.id : undefined);

  return (
    <div className="min-h-dvh bg-ground">
      {/* Top mini bar */}
      <header className="fixed top-0 inset-x-0 z-30 ios-blur">
        <div className="max-w-6xl mx-auto px-3 pt-[calc(6px+var(--safe-t,0px))] pb-2 flex items-center gap-1 hairline-b">
          <button onClick={() => setShowProfiles(true)} className="press w-9 h-9 rounded-full bg-gradient-to-br from-accent to-berry flex items-center justify-center text-[15px] font-bold text-black">
            {activeProfile?.guest ? '👤' : activeProfile?.name.slice(0, 1).toUpperCase()}
          </button>
          <div className="flex-1 text-center text-[16px] font-semibold truncate">
            {tabTitle[tab]}
            {activeProfile?.kids && <span className="ml-1.5 text-[10px] font-bold bg-green-500/20 text-green-400 rounded px-1.5 py-0.5 align-middle">KIDS</span>}
          </div>
          <button onClick={() => setShowSearch(true)} className="press p-2 text-white/80" aria-label="Search"><IconSearch className="w-6 h-6" /></button>
          <button onClick={() => setShowSettings(true)} className="press p-2 text-white/80" aria-label="Settings"><IconSettings className="w-6 h-6" /></button>
        </div>
      </header>

      <main className="max-w-6xl mx-auto pt-[calc(50px+var(--safe-t,0px))] pb-[calc(72px+var(--safe-b,0px))]">
        {!playlist && (
          importing ? (
            <Skeletons />
          ) : (
            <div className="px-8 pt-16 text-center space-y-4">
              <Aurora />
              <div className="relative text-6xl">🍿</div>
              <div className="relative text-[22px] font-extrabold tracking-tight">Your own Netflix</div>
              <div className="relative text-[14px] text-white/50 leading-relaxed">Import a playlist — M3U, M3U8 or an Xtream login. Posters, a real programme guide, Continue Watching and multiview arrive on their own.</div>
              <button onClick={() => setShowImport(true)} className="press relative inline-flex items-center gap-2 bg-accent text-black font-bold px-6 py-3.5 rounded-2xl text-[16px] shadow-lg shadow-orange-900/30">
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

                <GenreStrip groups={groups.slice(0, 12)} counts={groupCounts} onPick={(g) => { setTab('live'); }} />

                {continueEntries.length > 0 && (
                  <Shelf title="Continue watching">
                    {continueEntries.map(({ ch, pct, time }) => (
                      <PosterCard key={ch.id} poster={ch.contentType === 'MOVIE' || ch.contentType === 'SERIES' ? ch.logo : undefined}
                        title={ch.name} showProgress={pct}
                        onClick={() => selectChannel(ch, time)} />
                    ))}
                  </Shelf>
                )}

                {(() => {
                  const rail = tmdbRail('trending', 'movie');
                  if (!rail.length) return null;
                  return (
                    <Shelf title="Trending now">
                      {rail.map((ch) => (
                        <PosterCard key={ch.id} poster={ch.logo} title={ch.name.replace(/\s*[(\[][^)\]]*[)\]]\)?$/, '')} onClick={() => openDetail('movie', ch.name, { channel: ch })} />
                      ))}
                    </Shelf>
                  );
                })()}
                {(() => {
                  const rail = tmdbRail('top_rated', 'movie');
                  if (!rail.length) return null;
                  return (
                    <Shelf title="Top rated">
                      {rail.map((ch) => (
                        <PosterCard key={ch.id} poster={ch.logo} title={ch.name.replace(/\s*[(\[][^)\]]*[)\]]\)?$/, '')} onClick={() => openDetail('movie', ch.name, { channel: ch })} />
                      ))}
                    </Shelf>
                  );
                })()}
                {(() => {
                  const rail = tmdbRail('trending', 'tv');
                  if (!rail.length) return null;
                  return (
                    <Shelf title="Trending series">
                      {rail.map((ch: any) => (
                        <PosterCard key={ch.id} poster={ch.poster || ch.logo} title={ch.seriesName || ch.name} onClick={() => {
                          const f = seriesFolders.find((f) => f.episodes.some((x) => x.channel.id === ch.id));
                          if (f) openDetail('series', f.name, { folder: f });
                        }} />
                      ))}
                    </Shelf>
                  );
                })()}

                {topChannels.length >= 3 && (
                  <Shelf title="Top 10 in your library">
                    {topChannels.map((ch, i) => (
                      <PosterCard key={ch.id} rank={i + 1}
                        poster={ch.logo}
                        title={ch.contentType === 'MOVIE' ? ch.name.replace(/\s*[(\[][^)\]]*[)\]]\)?$/, '') : ch.name}
                        subtitle={ch.qualityTag || undefined}
                        onClick={() => {
                          if (!ch.contentType || ch.contentType === 'LIVE') return selectChannel(ch);
                          if (ch.contentType === 'MOVIE') return openDetail('movie', ch.name, { channel: ch });
                          const f = seriesFolders.find((f) => f.episodes.some((x) => x.channel.id === ch.id));
                          if (f) openDetail('series', f.name, { folder: f });
                        }} />
                    ))}
                  </Shelf>
                )}

                {recentlyAdded.length > 0 && (
                  <Shelf title="Recently added">
                    {recentlyAdded.map((ch) => (
                      <PosterCard key={ch.id} poster={ch.logo} title={ch.name.replace(/\s*[(\[][^)\]]*[)\]]\)?$/, '')} onClick={() => openDetail('movie', ch.name, { channel: ch })} />
                    ))}
                  </Shelf>
                )}

                {watchedChannels.length > 0 && (
                  <Shelf title="Watched">
                    {watchedChannels.slice(0, 20).map((ch) => (
                      ch.contentType === 'SERIES'
                        ? <PosterCard key={ch.id} poster={ch.logo} title={ch.name} onClick={() => { const f = seriesFolders.find((f) => f.episodes.some((x) => x.channel.id === ch.id)); if (f) openDetail('series', f.name, { folder: f }); }} />
                        : <PosterCard key={ch.id} poster={ch.logo} title={ch.name.replace(/\s*[(\[][^)\]]*[)\]]\)?$/, '')} onClick={() => selectChannel(ch)} />
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

                {watchlistChannels.length > 0 && (
                  <Shelf title="My List">
                    {watchlistChannels.slice(0, 20).map((ch) => (
                      ch.contentType === 'MOVIE' || ch.contentType === 'SERIES'
                        ? <PosterCard key={ch.id} poster={ch.logo} title={ch.name}
                            onClick={() => {
                              if (ch.contentType === 'MOVIE') return openDetail('movie', ch.name, { channel: ch });
                              const f = seriesFolders.find((f) => f.episodes.some((x) => x.channel.id === ch.id));
                              if (f) openDetail('series', f.name, { folder: f });
                            }} />
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
                    <Shelf key={g} title={activeProfile.renamed[g] || g} onSeeAll={() => setTab('live')}>
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
                  {epgInfo.programmeCount > 0 && ` · guide: ${epgInfo.programmeCount.toLocaleString()} programmes`}
                </div>
              </>
            )}

            {tab === 'live' && (
              <LivetvScreen
                channels={liveChannels}
                profile={activeProfile}
                updateProfile={updateProfile}
                epgFor={epgFor}
                guideOffsetMinutes={guideOffsetMinutes}
                density={settings.liveDensity}
                startFolder={settings.startFolder}
                defaultSort={settings.defaultSort}
                resumeMap={resumeMap}
                onPlay={(ch) => selectChannel(ch)}
                onCatchup={(ch, prog) => {
                  const url = buildCatchupUrl(ch, prog);
                  if (url) selectChannel({ ...ch, url }, 0, true);
                  else selectChannel(ch);
                }}
                flash={flash}
              />
            )}

            {tab === 'series' && (
              <FlixScreen kind="series" items={seriesItems} categories={seriesCategories}
                profile={activeProfile} updateProfile={updateProfile} settings={settings} downloads={downloads}
                onPlayItem={(it) => it.folder && it.folder.episodes[0] && selectChannel(it.folder.episodes[0].channel)}
                onInfo={(it) => it.folder && openDetail('series', it.folder.name, { folder: it.folder })}
                isWatched={isWatchedItem}
                onMarkWatched={markWatchedItem}
                onRemoveContinue={(it) => {
                  const ids = it.folder ? it.folder.episodes.map((e) => e.channel.id) : it.channel ? [it.channel.id] : [];
                  updateProfile({ continueWatching: activeProfile.continueWatching.filter((c) => !ids.includes(c.channelId)) });
                  flash('Removed from Continue Watching');
                }}
                onRenameCategory={(g, n) => updateProfile({ renamed: { ...activeProfile.renamed, [g]: n } })}
                onHideCategory={(g) => { updateProfile({ hiddenGroups: [...hiddenGroups, g] }); flash(`Hidden “${g}”`); }}
                flash={flash}
              />
            )}

            {tab === 'movies' && (
              <FlixScreen kind="movie" items={movieItems} categories={movieCategories}
                profile={activeProfile} updateProfile={updateProfile} settings={settings} downloads={downloads}
                onPlayItem={(it) => it.channel && selectChannel(it.channel, resumeMap[it.channel.id]?.time)}
                onInfo={(it) => it.channel && openDetail('movie', it.channel.name, { channel: it.channel })}
                onDownload={startDownload}
                isWatched={isWatchedItem}
                onMarkWatched={markWatchedItem}
                onRemoveContinue={(it) => {
                  if (!it.channel) return;
                  updateProfile({ continueWatching: activeProfile.continueWatching.filter((c) => c.channelId !== it.channel!.id) });
                  flash('Removed from Continue Watching');
                }}
                onRenameCategory={(g, n) => updateProfile({ renamed: { ...activeProfile.renamed, [g]: n } })}
                onHideCategory={(g) => { updateProfile({ hiddenGroups: [...hiddenGroups, g] }); flash(`Hidden “${g}”`); }}
                flash={flash}
              />
            )}

            {tab === 'guide' && (
              <GuideGrid channels={liveChannels.slice(0, visible.guide)} epgFor={epgFor}
                onPlay={selectChannel}
                onCatchup={(ch: Channel, prog: Program) => {
                  const url = buildCatchupUrl(ch, prog);
                  if (url) selectChannel({ ...ch, url }, 0, true);
                  else selectChannel(ch);
                }}
                loadMore={() => setVisible((v) => ({ ...v, guide: v.guide + 120 }))}
                total={liveChannels.length}
                offsetMinutes={guideOffsetMinutes} />
            )}
          </div>
        )}
      </main>

      {/* Tab bar */}
      <nav className="fixed bottom-0 inset-x-0 z-30 ios-blur hairline-t">
        <div className="flex justify-around max-w-6xl mx-auto" style={{ paddingBottom: 'var(--safe-b, 0px)' }}>
          {([['home', 'Home', IconHome], ['live', 'Live TV', IconLive], ['series', 'Series', IconSeries], ['movies', 'Films', IconMovie], ['guide', 'Guide', IconGuide]] as [Tab, string, any][]).map(([t, title, Icon]) => (
            <button key={t} onClick={() => setTab(t)} className="press flex flex-col items-center justify-center w-16 h-[56px]">
              <Icon className={`w-[22px] h-[22px] ${tab === t ? 'text-accent' : 'text-white/55'}`} />
              <span className={`text-[10px] mt-0.5 ${tab === t ? 'text-accent font-semibold' : 'text-white/55'}`}>{title}</span>
            </button>
          ))}
        </div>
      </nav>

      {/* Player */}
      {selected && (
        <Player
          channel={selected.channel}
          resume={selected.resume}
          catchup={selected.catchup}
          isFav={favorites.includes(selected.channel.id)}
          nowNext={nowNext}
          episodes={playerEpisodes}
          meta={selected.channel.contentType === 'MOVIE' ? meta[`movie:${selected.channel.name}`] : meta[`tv:${selected.channel.name}`]}
          appSettings={settings}
          zapList={zapList}
          onSelectChannel={(ch) => selectChannel(ch)}
          recents={recentChannels}
          favourites={favoriteChannels}
          onClose={() => setSelected(null)}
          onToggleFav={() => toggleFavorite(selected.channel.id)}
          onAddMv={() => addToMv(selected.channel)}
          onProgress={onProgress}
          onPlayEpisode={(ep) => selectChannel(ep.channel)}
          onZap={zapChannel}
          related={relatedChannels}
          onPlayRelated={(ch) => selectChannel(ch)}
        />
      )}

      {showMv && <Multiview items={mv}
        onExpand={(ch) => { setShowMv(false); selectChannel(ch); }}
        onRemove={(id) => setMv((p) => p.filter((x) => x.id !== id))}
        onClear={() => { setShowMv(false); }} />}

      <ImportSheet open={showImport} onClose={() => setShowImport(false)}
        url={importUrl} setUrl={setImportUrl}
        xtream={xtream} setXtream={setXtream}
        importing={importing} error={importError} progress={importProgress}
        onUrl={importFromUrl} onFile={importFromFile} onXtream={importXtream} />

      {detail && (
        <DetailSheet kind={detail.kind} title={detail.title} folder={detail.folder} channel={detail.channel}
          meta={meta[`${detail.kind === 'series' ? 'tv' : 'movie'}:${detail.title}`] || null}
          isFav={detail.channel ? favorites.includes(detail.channel.id) : false}
          onFav={() => detail.channel && toggleFavorite(detail.channel.id)}
          isWatchlist={detailId ? (activeProfile.watchlist || []).includes(detailId) : false}
          onWatchlist={() => detailId && toggleWatchlist(detailId)}
          onPickSimilar={openSimilar}
          onPlayMovie={detailPlaySection}
          onPlayEpisode={detailPlayEpisode}
          dl={downloads}
          onDownload={startDownload}
          onClose={() => setDetail(null)} />
      )}

      <SettingsSheet open={showSettings} onClose={() => setShowSettings(false)}
        playlist={playlist}
        playlists={playlistIndex} activePlaylistId={activePlaylistId}
        onSelectPlaylist={switchPlaylist} onDeletePlaylist={deletePlaylist}
        groups={groups} allGroups={allGroups} hiddenCount={hiddenGroups.length}
        tmdbKey={tmdbKey} setTmdbKey={setTmdbKey} status={status}
        canRefresh={canRefresh} refreshing={refreshing} refreshProgress={importProgress}
        onRefreshPlaylist={doRefreshPlaylist}
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
        onExportData={exportData}
        onRestoreData={restoreData}
        hasRestoreSnapshot={hasRestoreSnapshot}
        onUndoRestore={undoRestore}
        onClearPlaylist={async () => { await clearPlaylistStore(); await idbDel(`pl:${activePlaylistId}`); setPlaylist(null); setPlaylistIndex((ix) => ix.filter((x) => x.id !== activePlaylistId)); save('playlistIndex', playlistIndex.filter((x) => x.id !== activePlaylistId)); flash('Playlist removed'); }}
        isStandalone={isStandalone} playbackCount={continueEntries.length} mvCount={mv.length}
        settings={settings} setSettings={setSettings}
        epgInfo={{ ...epgInfo, url: playlist?.epgUrl || '' }}
        onSetEpgUrl={(url) => { if (playlist) { const pl = { ...playlist, epgUrl: url || undefined }; setPlaylist(pl); idbSet(`pl:${activePlaylistId}`, pl); if (url) loadEpg(url); } }}
        onRefreshEpg={() => { if (playlist?.epgUrl) loadEpg(playlist.epgUrl); else flash('No guide URL set'); }}
        onImportEpgFile={async (file) => {
          const text = await file.text();
          const parsed = parseXMLTV(text);
          setEpg(parsed);
          setEpgInfo({ programmeCount: Object.values(parsed).reduce((n, p) => n + p.length, 0), channelCount: Object.keys(parsed).length, lastRefresh: Date.now(), loading: 0 });
          flash('Guide imported from file');
        }}
        onClearAllData={clearAllData}
        onCheckUpdates={checkForUpdates}
      />

      <ProfilesSheet open={showProfiles} onClose={() => setShowProfiles(false)} profiles={profiles} activeId={activeProfileId}
        onPick={pickProfile}
        onAdd={(name, kids) => { if (!name) return; const p = { ...DEFAULT_PROFILE, id: `p_${Date.now()}`, name, kids }; setProfiles((prev) => [...prev, p]); flash(`Profile “${name}” added`); }}
        onSetPin={(pid, pin) => setProfiles((prev) => prev.map((p) => (p.id === pid ? { ...p, pin: pin ? hashPin(pin) : undefined } : p)))}
        onToggleKids={(pid) => setProfiles((prev) => prev.map((p) => (p.id === pid ? { ...p, kids: !p.kids } : p)))}
        onRename={(pid, name) => setProfiles((prev) => prev.map((p) => (p.id === pid ? { ...p, name } : p)))}
        onDelete={(pid) => setProfiles((prev) => (prev.length > 2 ? prev.filter((p) => p.id !== pid) : prev))} />

      {showPin && <PinOverlay profile={showPin.profile} verify={(pin) => hashPin(pin) === showPin.profile.pin} onResolve={showPin.resolve} onCancel={() => showPin.resolve(false)} />}
      {coldPin && !showPin && (
        <PinOverlay profile={coldPin} verify={(pin) => hashPin(pin) === coldPin.pin}
          onResolve={(ok) => { if (!ok) location.reload(); setColdPin(null); }}
          onCancel={() => location.reload()} />
      )}

      {showSearch && (
        <SearchOverlay channels={channels} series={seriesFolders} favorites={new Set(favorites)}
          epgFor={epgFor} guideOffsetMinutes={guideOffsetMinutes}
          onClose={() => setShowSearch(false)} onPlayChannel={(c) => { setShowSearch(false); selectChannel(c); }}
          onOpenSeries={(f) => { setShowSearch(false); openDetail('series', f.name, { folder: f }); }}
          onOpenMovie={(c) => { setShowSearch(false); openDetail('movie', c.name, { channel: c }); }} />
      )}

      {swUpdate && (
        <div className="fixed top-[calc(12px+var(--safe-t,0px))] inset-x-0 z-50 flex justify-center pointer-events-auto">
          <div className="bg-accent text-black text-[13px] font-semibold px-4 py-2 rounded-full shadow-xl flex items-center gap-3">
            <span>New version available</span>
            <button onClick={() => location.reload()} className="press underline underline-offset-2">Reload</button>
          </div>
        </div>
      )}

      {status && (
        <div className="fixed bottom-[calc(66px+var(--safe-b,0px)+12px)] inset-x-0 z-30 flex justify-center pointer-events-none fade-in">
          <div className="bg-white text-black text-[13px] font-semibold px-4 py-2 rounded-full shadow-xl">{status}</div>
        </div>
      )}
    </div>
  );
}

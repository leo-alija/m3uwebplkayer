'use client';
import { useEffect, useRef, useState } from 'react';
import { parseM3U, buildXtreamM3uUrl } from '@/lib/m3u';
import { parseXMLTV, nowProgram } from '@/lib/epg';
import { load, save } from '@/lib/storage';
import { Channel, Playlist, Program } from '@/lib/types';
import Hls from 'hls.js';

type Tab = 'channels' | 'guide' | 'favorites' | 'settings';

export default function Home() {
  const [playlist, setPlaylist] = useState<Playlist | null>(null);
  const [selected, setSelected] = useState<Channel | null>(null);
  const [favorites, setFavorites] = useState<string[]>([]);
  const [hiddenGroups, setHiddenGroups] = useState<string[]>([]);
  const [renamed, setRenamed] = useState<Record<string, string>>({});
  const [recents, setRecents] = useState<string[]>([]);
  const [query, setQuery] = useState('');
  const [group, setGroup] = useState<string>('all');
  const [tab, setTab] = useState<Tab>('channels');
  const [epg, setEpg] = useState<Record<string, Program[]>>({});
  const [importUrl, setImportUrl] = useState('');
  const [importing, setImporting] = useState(false);
  const [importError, setImportError] = useState('');
  const [showImport, setShowImport] = useState(true);
  const [xtream, setXtream] = useState({ host: '', user: '', pass: '' });
  const [status, setStatus] = useState('');
  const videoRef = useRef<HTMLVideoElement>(null);
  const hlsRef = useRef<Hls | null>(null);

  useEffect(() => {
    setFavorites(load('fav', []));
    setHiddenGroups(load('hiddenGroups', []));
    setRenamed(load('renamed', {}));
    setRecents(load('recents', []));
    const saved = load<Playlist | null>('playlist', null);
    if (saved) { setPlaylist(saved); setShowImport(false); }
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('/sw.js').catch(() => {});
    }
  }, []);

  useEffect(() => { save('fav', favorites); }, [favorites]);
  useEffect(() => { save('hiddenGroups', hiddenGroups); }, [hiddenGroups]);
  useEffect(() => { save('renamed', renamed); }, [renamed]);
  useEffect(() => { save('recents', recents); }, [recents]);
  useEffect(() => { if (playlist) save('playlist', playlist); }, [playlist]);

  async function fetchText(url: string) {
    const res = await fetch('/api/fetch?url=' + encodeURIComponent(url));
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      throw new Error(j.error || 'fetch failed');
    }
    return await res.text();
  }

  async function importPlaylistText(text: string, name: string, epgUrl?: string) {
    const { channels, epgUrl: parsedEpg } = parseM3U(text);
    const pl: Playlist = { name, channels, epgUrl: epgUrl || parsedEpg, importedAt: Date.now() };
    setPlaylist(pl);
    setShowImport(false);
    setStatus(`Imported ${channels.length} channels`);
    if (pl.epgUrl) loadEpg(pl.epgUrl);
  }

  async function loadEpg(url: string) {
    try {
      const text = await fetchText(url);
      setEpg(parseXMLTV(text));
    } catch (e: any) {
      console.warn('epg', e);
    }
  }

  async function importFromUrl() {
    setImporting(true); setImportError('');
    try {
      const text = await fetchText(importUrl);
      await importPlaylistText(text, importUrl, undefined);
    } catch (e: any) {
      setImportError(e?.message || 'import failed');
    } finally { setImporting(false); }
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
    } catch (e: any) {
      setImportError(e?.message || 'import failed');
    } finally { setImporting(false); }
  }

  function selectChannel(ch: Channel) {
    setSelected(ch);
    setRecents((prev) => [ch.id, ...prev.filter((x) => x !== ch.id)].slice(0, 30));
    // load player
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
    video.play().catch(() => {});
  }

  const channels = playlist?.channels || [];
  const groups = Array.from(new Set(channels.map((c) => c.group || 'Ungrouped'))).filter((g) => !hiddenGroups.includes(g));
  const filtered = channels.filter((c) => {
    if (hiddenGroups.includes(c.group || 'Ungrouped')) return false;
    if (group !== 'all' && (c.group || 'Ungrouped') !== group) return false;
    if (query && !c.name.toLowerCase().includes(query.toLowerCase())) return false;
    return true;
  });

  function toggleFavorite(id: string) {
    setFavorites((prev) => prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]);
  }

  const favoriteChannels = channels.filter((c) => favorites.includes(c.id));

  return (
    <div className="min-h-screen flex flex-col">
      <header className="sticky top-0 z-20 bg-black/60 backdrop-blur border-b border-white/10 px-4 py-3 flex items-center justify-between safe-top">
        <div className="font-bold text-lg">M3U Web Player</div>
        <div className="flex gap-2">
          <button onClick={() => setShowImport(true)} className="px-3 py-1.5 rounded-lg bg-white/10 text-sm">Import</button>
          <button onClick={() => setTab('settings')} className="px-3 py-1.5 rounded-lg bg-white/10 text-sm">⚙</button>
        </div>
      </header>

      {showImport && (
        <div className="fixed inset-0 z-30 bg-black/80 flex items-center justify-center p-4">
          <div className="bg-[#14171f] rounded-2xl p-5 w-full max-w-lg space-y-4 border border-white/10">
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
        <section className="md:w-1/2 lg:w-2/5 border-r border-white/10 flex flex-col">
          <div className="p-3 flex gap-2">
            <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search channels" className="flex-1 bg-white/5 rounded-lg px-3 py-2 outline-none" />
            <select value={group} onChange={(e) => setGroup(e.target.value)} className="bg-white/5 rounded-lg px-2 py-2 outline-none max-w-[140px]">
              <option value="all">All groups</option>
              {groups.map((g) => <option key={g} value={g}>{renamed[g] || g}</option>)}
            </select>
          </div>
          <div className="flex-1 overflow-y-auto">
            {(tab === 'favorites' ? favoriteChannels : tab === 'channels' ? filtered : channels.filter((c) => recents.includes(c.id))) .map((ch) => (
              <button key={ch.id} onClick={() => selectChannel(ch)} className={`w-full text-left px-3 py-2.5 flex items-center gap-3 border-b border-white/5 hover:bg-white/5 ${selected?.id === ch.id ? 'bg-orange-500/15' : ''}`}>
                {ch.logo ? <img src={ch.logo} alt="" className="w-9 h-9 rounded object-cover bg-white/5" /> : <div className="w-9 h-9 rounded bg-white/10 flex items-center justify-center text-xs">{ch.name.slice(0,2).toUpperCase()}</div>}
                <div className="flex-1 min-w-0">
                  <div className="truncate font-medium">{ch.name}</div>
                  <div className="truncate text-xs text-white/50">{renamed[ch.group || 'Ungrouped'] || ch.group || 'Ungrouped'}</div>
                </div>
                <button onClick={(e) => { e.stopPropagation(); toggleFavorite(ch.id); }} className={`text-lg ${favorites.includes(ch.id) ? 'text-orange-400' : 'text-white/20'}`}>★</button>
              </button>
            ))}
            {filtered.length === 0 && <div className="p-6 text-center text-white/50 text-sm">No channels. Import a playlist.</div>}
          </div>
        </section>

        <section className="flex-1 flex flex-col">
          <div className="video-wrap relative aspect-video md:aspect-auto md:flex-1 bg-black">
            <video ref={videoRef} controls playsInline className="w-full h-full" />
            {!selected && <div className="absolute inset-0 flex items-center justify-center text-white/40">Select a channel</div>}
          </div>
          {selected && (
            <div className="p-3 space-y-1 border-t border-white/10">
              <div className="flex items-center justify-between gap-2">
                <div className="font-semibold truncate">{selected.name}</div>
                <button onClick={() => toggleFavorite(selected.id)} className={`text-xl ${favorites.includes(selected.id) ? 'text-orange-400' : 'text-white/30'}`}>★</button>
              </div>
              <div className="text-xs text-white/50 truncate">{selected.url}</div>
              {epg[selected.tvgId || ''] && nowProgram(epg[selected.tvgId || '']) && (
                <div className="text-sm text-orange-300">Now: {nowProgram(epg[selected.tvgId || ''])?.title}</div>
              )}
            </div>
          )}
          {tab === 'guide' && selected && epg[selected.tvgId || ''] && (
            <div className="flex-1 overflow-y-auto p-3 space-y-2">
              {epg[selected.tvgId || ''].slice(0, 40).map((p, i) => (
                <div key={i} className="bg-white/5 rounded-lg p-3">
                  <div className="text-xs text-white/50">{p.start} – {p.stop}</div>
                  <div className="font-medium">{p.title}</div>
                  {p.desc && <div className="text-sm text-white/60 mt-1">{p.desc}</div>}
                </div>
              ))}
            </div>
          )}
        </section>
      </main>

      <nav className="sticky bottom-0 bg-black/70 backdrop-blur border-t border-white/10 flex justify-around py-2 safe-bottom">
        {(['channels','guide','favorites','settings'] as Tab[]).map((t) => (
          <button key={t} onClick={() => setTab(t)} className={`px-3 py-1.5 rounded-lg text-sm capitalize ${tab === t ? 'text-orange-400' : 'text-white/60'}`}>{t}</button>
        ))}
      </nav>

      {tab === 'settings' && (
        <div className="fixed inset-0 z-30 bg-black/80 flex items-center justify-center p-4">
          <div className="bg-[#14171f] rounded-2xl p-5 w-full max-w-lg space-y-4 border border-white/10 max-h-[90vh] overflow-y-auto">
            <div className="flex justify-between items-center">
              <h2 className="text-xl font-bold">Settings</h2>
              <button onClick={() => setTab('channels')} className="text-white/60">✕</button>
            </div>
            <div className="space-y-2">
              <div className="font-semibold">Playlist</div>
              <div className="text-sm text-white/60">{playlist ? `${playlist.name} — ${playlist.channels.length} channels` : 'None'}</div>
              <button onClick={() => { setPlaylist(null); setShowImport(true); setTab('channels'); }} className="px-3 py-1.5 rounded-lg bg-white/10 text-sm">Clear playlist</button>
            </div>
            <div className="space-y-2">
              <div className="font-semibold">Groups</div>
              {groups.map((g) => (
                <div key={g} className="flex items-center gap-2">
                  <span className="flex-1 truncate">{renamed[g] || g}</span>
                  <input placeholder="rename" className="bg-white/5 rounded px-2 py-1 text-sm w-28" onBlur={(e) => { if (e.target.value) setRenamed({ ...renamed, [g]: e.target.value }); }} />
                  <button onClick={() => setHiddenGroups([...hiddenGroups, g])} className="text-xs px-2 py-1 rounded bg-white/10">Hide</button>
                </div>
              ))}
              {hiddenGroups.length > 0 && <button onClick={() => setHiddenGroups([])} className="text-xs px-2 py-1 rounded bg-white/10">Unhide all</button>}
            </div>
            <div className="space-y-2">
              <div className="font-semibold">Install</div>
              <div className="text-sm text-white/60">Use Safari → Share → Add to Home Screen for standalone app experience.</div>
            </div>
            {status && <div className="text-sm text-green-400">{status}</div>}
          </div>
        </div>
      )}
    </div>
  );
}

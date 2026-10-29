'use client';

import { useEffect, useRef, useState } from 'react';
import { AppSettings, Channel, ImportProgress, Playlist, PlaylistEntry } from '@/lib/types';
import { Sheet, Button, IconChevron, GroupRow, Row, IconTrash } from './ui';
import { ImportProgressBar } from './sheets';
import { getDownloadIndex, removeDownload, fmtBytes, DownloadInfo, storageStatus } from '@/lib/downloads';
import { testGuideUrl, type GuideDiagnostics } from '@/lib/epg-client';
import { clearTmdbCache } from '@/lib/tmdb';

const AUTO_OPTS = ['manual', '15m', '30m', '1h', '2h'] as const;
const EPG_OPTS = ['manual', '1h', '2h', '4h', '6h', '12h'] as const;

export function SettingsSheet({
  open, onClose, playlist, playlists, activePlaylistId, onSelectPlaylist, onDeletePlaylist,
  groups, allGroups, hiddenCount, tmdbKey, setTmdbKey, status,
  hideGroup, renameGroup, reorderGroup, unhideAll, moveToGroup, allChannels,
  onOpenImport, onOpenProfiles, onExportData, onRestoreData, hasRestoreSnapshot, onUndoRestore,
  onClearPlaylist, isStandalone, playbackCount, mvCount,
  canRefresh, refreshing, refreshProgress, onRefreshPlaylist,
  settings, setSettings,
  epgInfo, onSetEpgUrl, onImportEpgFile, onRefreshEpg,
  onClearAllData, onCheckUpdates,
}: {
  open: boolean; onClose: () => void;
  playlist: Playlist | null;
  playlists: PlaylistEntry[]; activePlaylistId: string;
  onSelectPlaylist: (id: string) => void; onDeletePlaylist: (id: string) => void;
  groups: string[]; allGroups: string[]; hiddenCount: number;
  tmdbKey: string; setTmdbKey: (v: string) => void;
  status: string;
  hideGroup: (g: string) => void;
  renameGroup: (g: string, name: string) => void;
  reorderGroup: (g: string, dir: -1 | 1) => void;
  unhideAll: () => void;
  moveToGroup: (channelId: string, group: string) => void;
  allChannels: Channel[];
  onOpenImport: () => void; onOpenProfiles: () => void;
  onExportData: () => void; onRestoreData: (data: any) => void;
  hasRestoreSnapshot: boolean; onUndoRestore: () => void;
  onClearPlaylist: () => void;
  isStandalone: boolean; playbackCount: number; mvCount: number;
  canRefresh: boolean; refreshing: boolean; refreshProgress: ImportProgress | null;
  onRefreshPlaylist: () => void;
  settings: AppSettings; setSettings: (patch: Partial<AppSettings>) => void;
  epgInfo: { programmeCount: number; channelCount: number; lastRefresh: number | null; url: string };
  onSetEpgUrl: (url: string) => void;
  onImportEpgFile: (file: File) => void;
  onRefreshEpg: () => void;
  onClearAllData: () => void;
  onCheckUpdates: () => void;
}) {
  const [moveId, setMoveId] = useState('');
  const [dl, setDl] = useState<DownloadInfo[]>([]);
  const [storage, setStorage] = useState<{ usage: number; quota: number } | null>(null);
  const [epgUrl, setEpgUrl] = useState(epgInfo.url);
  const [diag, setDiag] = useState<GuideDiagnostics | null>(null);
  const [testing, setTesting] = useState(false);
  const [restorePreview, setRestorePreview] = useState<any | null>(null);
  const [confirmWipe, setConfirmWipe] = useState(false);
  useEffect(() => { if (open) { getDownloadIndex().then(setDl); storageStatus().then(setStorage); setEpgUrl(epgInfo.url); } }, [open, epgInfo.url]);
  const list = groups.length ? groups : [];

  async function inspectRestore(f: File) {
    try {
      const text = await f.text();
      const d = JSON.parse(text);
      setRestorePreview(d);
    } catch { setRestorePreview({ __invalid: true }); }
  }

  function countsOf(d: any) {
    return {
      profiles: Array.isArray(d?.profiles) ? d.profiles.length : 0,
      playlists: Array.isArray(d?.playlists) ? d.playlists.length : d?.playlist ? 1 : 0,
      channels: d?.playlist?.channels?.length || d?.playlistChannels || 0,
      favourites: d?.profiles?.reduce?.((n: number, p: any) => n + (p.favorites?.length || 0), 0) || 0,
      settings: d?.settings ? 'yes' : 'no',
    };
  }

  return (
    <Sheet open={open} title="Settings" onClose={onClose}>
      <div className="pb-10">
        {/* ============ playlists ============ */}
        <GroupRow title="Playlists">
          {playlists.map((pl) => (
            <Row key={pl.id} className="py-2">
              <button onClick={() => onSelectPlaylist(pl.id)} className="press flex-1 flex items-center gap-2 min-w-0 text-left">
                <span className={`w-2 h-2 rounded-full shrink-0 ${pl.id === activePlaylistId ? 'bg-accent' : 'bg-white/20'}`} />
                <span className="flex-1 min-w-0">
                  <span className="block text-[15px] truncate">{pl.name.replace(/^https?:\/\//, '').slice(0, 44)}</span>
                  <span className="block text-[11px] text-white/35">{pl.channelCount.toLocaleString()} items · {new Date(pl.importedAt).toLocaleDateString()}</span>
                </span>
                {pl.id === activePlaylistId && <span className="text-accent text-[12px] font-bold shrink-0">Active</span>}
              </button>
              <button onClick={() => onDeletePlaylist(pl.id)} className="press p-2 text-red-400" title="Delete playlist"><IconTrash className="w-4 h-4" /></button>
            </Row>
          ))}
          <Row className="py-2">
            <button onClick={onOpenImport} className="press flex-1 flex items-center justify-between text-[16px] text-link">
              <span>Add playlist</span><IconChevron className="w-4 h-4" />
            </button>
          </Row>
          {playlist && canRefresh && (
            <Row className="py-2">
              <button onClick={onRefreshPlaylist} disabled={refreshing}
                className="press flex-1 flex items-center justify-between text-[16px] text-link disabled:opacity-40">
                <span>{refreshing ? 'Refreshing…' : 'Refresh active playlist'}</span><IconChevron className="w-4 h-4" />
              </button>
            </Row>
          )}
          <Row className="py-2 flex-wrap">
            <span className="text-[15px] flex-1 min-w-[120px]">Auto-refresh</span>
            <div className="flex gap-1.5 flex-wrap justify-end">
              {AUTO_OPTS.map((o) => (
                <button key={o} onClick={() => setSettings({ playlistAutoRefresh: o })}
                  className={`press px-2.5 py-1 rounded-lg text-[12px] font-semibold ${settings.playlistAutoRefresh === o ? 'bg-accent text-black' : 'bg-white/8 text-white/70'}`}>{o}</button>
              ))}
            </div>
          </Row>
          {playlist && (
            <Row className="py-2">
              <button onClick={onClearPlaylist} className="press flex-1 text-[16px] text-red-400">Remove active playlist</button>
            </Row>
          )}
          {refreshing && <div className="pb-3"><ImportProgressBar progress={refreshProgress} /></div>}
        </GroupRow>

        {/* ============ EPG ============ */}
        <GroupRow title="TV guide (XMLTV)">
          <div className="px-4 py-2 flex gap-2">
            <input value={epgUrl} onChange={(e) => setEpgUrl(e.target.value)} inputMode="url" autoCapitalize="none" autoCorrect="off"
              placeholder="http://host/guide.xml[.gz]"
              className="flex-1 min-w-0 bg-white/5 rounded-xl px-3 py-2 text-[14px] outline-none placeholder:text-white/30" />
            <Button primary onClick={() => onSetEpgUrl(epgUrl.trim())} disabled={!epgUrl.trim()}>Load</Button>
          </div>
          <label className="block cursor-pointer">
            <input type="file" accept=".xml,.gz,.xmltv,text/xml,application/gzip" className="hidden"
              onChange={(e) => { if (e.target.files?.[0]) onImportEpgFile(e.target.files[0]); e.target.value = ''; }} />
            <div className="px-4 py-2.5 text-[15px] text-link flex items-center justify-between">
              <span>Import guide from file</span><IconChevron className="w-4 h-4 text-white/30" />
            </div>
          </label>
          {epgInfo.url && (
            <Row className="py-2">
              <button onClick={onRefreshEpg} className="press flex-1 flex items-center justify-between text-[15px] text-link">
                <span>Refresh guide now</span><IconChevron className="w-4 h-4" />
              </button>
            </Row>
          )}
          <div className="px-4 pb-2 text-[12px] text-white/35 leading-relaxed">
            {epgInfo.programmeCount > 0
              ? `${epgInfo.programmeCount.toLocaleString()} programmes · ${epgInfo.channelCount.toLocaleString()} channels · kept in a −12h…+8 day window${epgInfo.lastRefresh ? ` · updated ${new Date(epgInfo.lastRefresh).toLocaleTimeString()}` : ''}`
              : 'No guide loaded. Only programmes within 12 hours back and 8 days forward are stored.'}
          </div>
          <Row className="py-2 flex-wrap">
            <span className="text-[15px] flex-1 min-w-[120px]">Auto-refresh</span>
            <div className="flex gap-1.5 flex-wrap justify-end">
              {EPG_OPTS.map((o) => (
                <button key={o} onClick={() => setSettings({ epgAutoRefresh: o })}
                  className={`press px-2.5 py-1 rounded-lg text-[12px] font-semibold ${settings.epgAutoRefresh === o ? 'bg-accent text-black' : 'bg-white/8 text-white/70'}`}>{o}</button>
              ))}
            </div>
          </Row>
          <Row className="py-2">
            <span className="text-[15px] flex-1">Time offset</span>
            <div className="flex items-center gap-1.5">
              <button onClick={() => setSettings({ guideOffsetHours: Math.max(-12, settings.guideOffsetHours - 1) })} className="press w-8 h-8 rounded-lg bg-white/8 font-bold">−</button>
              <span className="w-12 text-center text-[14px] font-semibold">{settings.guideOffsetHours > 0 ? `+${settings.guideOffsetHours}` : settings.guideOffsetHours}h</span>
              <button onClick={() => setSettings({ guideOffsetHours: Math.min(12, settings.guideOffsetHours + 1) })} className="press w-8 h-8 rounded-lg bg-white/8 font-bold">+</button>
            </div>
          </Row>
          <div className="px-4 py-2 flex gap-2 items-center">
            <Button onClick={async () => { if (!epgUrl.trim()) return; setTesting(true); setDiag(null); setDiag(await testGuideUrl(epgUrl.trim())); setTesting(false); }} disabled={testing || !epgUrl.trim()}>
              {testing ? 'Testing…' : 'Test guide URL'}
            </Button>
          </div>
          {diag && (
            <div className="mx-4 mb-3 rounded-xl bg-white/5 px-3 py-2.5 text-[12px] leading-relaxed space-y-0.5">
              <div>{diag.reachable ? '✅ Reachable' : '❌ Not reachable'}{diag.httpCode ? ` · HTTP ${diag.httpCode}` : ''} · {diag.ms}ms</div>
              {diag.reachable && (
                <>
                  <div>Content type: <span className="text-white/70">{diag.contentType || '—'}</span></div>
                  {!!diag.sizeBytes && <div>Size: {fmtBytes(diag.sizeBytes)}</div>}
                  <div>{diag.gzipped ? '🗜️ Gzip detected' : 'Not gzipped (still fine)'}</div>
                  {diag.looksHtml && <div className="text-yellow-400">⚠️ This looks like an HTML page, not a guide — check the URL</div>}
                  {!/xml|gzip|octet/.test(diag.contentType || '') && !diag.looksHtml && <div className="text-yellow-400">⚠️ Unusual content type for a guide</div>}
                </>
              )}
              {diag.error && <div className="text-red-400">{diag.error}</div>}
            </div>
          )}
        </GroupRow>

        {/* ============ playback defaults ============ */}
        <GroupRow title="Playback">
          <Row className="py-2 flex-wrap">
            <span className="text-[15px] flex-1 min-w-[150px]">Live channel size</span>
            <div className="flex gap-1.5">
              {(['large', 'small', 'list'] as const).map((d) => (
                <button key={d} onClick={() => setSettings({ liveDensity: d })}
                  className={`press px-2.5 py-1 rounded-lg text-[12px] font-semibold capitalize ${settings.liveDensity === d ? 'bg-accent text-black' : 'bg-white/8 text-white/70'}`}>{d}</button>
              ))}
            </div>
          </Row>
          <Row className="py-2 flex-wrap">
            <span className="text-[15px] flex-1 min-w-[150px]">Default view</span>
            <div className="flex gap-1.5">
              {(['grid', 'tiles', 'list'] as const).map((v) => (
                <button key={v} onClick={() => setSettings({ movieView: v, seriesView: v })}
                  className={`press px-2.5 py-1 rounded-lg text-[12px] font-semibold capitalize ${settings.movieView === v ? 'bg-accent text-black' : 'bg-white/8 text-white/70'}`}>{v}</button>
              ))}
            </div>
          </Row>
          <Toggle label="Hide watched by default" value={settings.hideWatchedDefault} onChange={(v) => setSettings({ hideWatchedDefault: v })} />
          <Toggle label="Resume last channel on launch" value={settings.resumeLastChannel} onChange={(v) => setSettings({ resumeLastChannel: v })} />
          <Toggle label="Auto-play next episode" value={settings.autoPlayNext} onChange={(v) => setSettings({ autoPlayNext: v })} />
          <Row className="py-2 flex-wrap">
            <span className="text-[15px] flex-1 min-w-[150px]">Screensaver when paused</span>
            <div className="flex gap-1.5 flex-wrap justify-end">
              {([0, 5, 10, 15, 30] as const).map((m) => (
                <button key={m} onClick={() => setSettings({ screensaverMinutes: m })}
                  className={`press px-2.5 py-1 rounded-lg text-[12px] font-semibold ${settings.screensaverMinutes === m ? 'bg-accent text-black' : 'bg-white/8 text-white/70'}`}>{m === 0 ? 'Off' : `${m}m`}</button>
              ))}
            </div>
          </Row>
        </GroupRow>

        {/* ============ subtitles ============ */}
        <GroupRow title="Subtitles">
          <Row className="py-2 flex-wrap">
            <span className="text-[15px] flex-1 min-w-[100px]">Size</span>
            <div className="flex gap-1.5">
              {([['s', 'Small'], ['m', 'Medium'], ['l', 'Large']] as const).map(([v, label]) => (
                <button key={v} onClick={() => setSettings({ subSize: v })}
                  className={`press px-3 py-1 rounded-lg text-[12px] font-semibold ${settings.subSize === v ? 'bg-accent text-black' : 'bg-white/8 text-white/70'}`}>{label}</button>
              ))}
            </div>
          </Row>
          <Row className="py-2 flex-wrap">
            <span className="text-[15px] flex-1 min-w-[100px]">Text</span>
            <div className="flex gap-1.5">
              {['#ffffff', '#ffe066', '#7fd4ff', '#ffd60a'].map((c) => (
                <button key={c} onClick={() => setSettings({ subColor: c })}
                  className={`press w-7 h-7 rounded-full border-2 ${settings.subColor === c ? 'border-accent' : 'border-white/20'}`} style={{ background: c }} aria-label={`Text ${c}`} />
              ))}
            </div>
          </Row>
          <Row className="py-2 flex-wrap">
            <span className="text-[15px] flex-1 min-w-[100px]">Backing</span>
            <div className="flex gap-1.5">
              {(['rgba(8,8,10,0.62)', 'rgba(0,0,0,0.9)', 'transparent'] as const).map((c, i) => (
                <button key={c} onClick={() => setSettings({ subBg: c })}
                  className={`press w-7 h-7 rounded-full border-2 ${settings.subBg === c ? 'border-accent' : 'border-white/20'} ${i === 2 ? 'bg-[repeating-conic-gradient(#555_0_25%,#333_0_50%)] bg-[length:8px_8px]' : ''}`}
                  style={i !== 2 ? { background: c } : undefined} aria-label={`Backing ${i}`} />
              ))}
            </div>
          </Row>
        </GroupRow>

        {/* ============ favourites & history ============ */}
        <GroupRow title="Favourites & history">
          <Row className="py-2"><span className="flex-1 text-[16px]">Watching now</span><span className="text-[13px] text-white/40">{playbackCount} in progress</span></Row>
          <Row className="py-2"><span className="flex-1 text-[16px]">Multiview tiles</span><span className="text-[13px] text-white/40">{mvCount}</span></Row>
          <Row className="py-2">
            <button onClick={onOpenProfiles} className="press flex-1 flex items-center justify-between text-[16px] text-link">
              <span>Who&apos;s watching?</span><IconChevron className="w-4 h-4" />
            </button>
          </Row>
        </GroupRow>

        {/* ============ saved offline ============ */}
        <GroupRow title="Saved offline">
          <Row className="py-2">
            <span className="flex-1 text-[16px]">Storage used</span>
            <span className="text-[13px] text-white/40">{storage ? `${fmtBytes(storage.usage)} of ${fmtBytes(storage.quota)}` : '—'}</span>
          </Row>
          {dl.length === 0 ? (
            <div className="px-4 py-3 text-[14px] text-white/40">Nothing saved yet — open a film and tap Download.</div>
          ) : dl.map((d) => (
            <Row key={d.id} className="py-2">
              <div className="flex-1 min-w-0">
                <div className="text-[15px] truncate">{d.name}</div>
                <div className="text-[12px] text-white/35">{fmtBytes(d.bytes)} · {new Date(d.savedAt).toLocaleDateString()}</div>
              </div>
              <button onClick={async () => { await removeDownload(d.id); setDl(await getDownloadIndex()); }}
                className="press p-2 text-red-400" title="Delete"><IconTrash className="w-4 h-4" /></button>
            </Row>
          ))}
          <Toggle label="Download over Wi-Fi only (best effort)" value={settings.wifiOnly} onChange={(v) => setSettings({ wifiOnly: v })} />
        </GroupRow>

        {/* ============ TMDb ============ */}
        <GroupRow title="TMDb metadata (optional)">
          <input value={tmdbKey} onChange={(e) => setTmdbKey(e.target.value)} placeholder="v3 API key" autoCapitalize="none" autoCorrect="off"
            className="w-full bg-transparent px-4 py-3 text-[15px] outline-none placeholder:text-white/30" />
          <div className="px-4 pb-3 text-[12px] text-white/35 leading-relaxed">
            Adds posters, ratings, cast, trailers and Trending/Top-rated shelves. Without a key, everything still plays — shelves are built from your own library.
          </div>
          <Row className="py-2">
            <button onClick={async () => { await clearTmdbCache(); }} className="press flex-1 text-left text-[15px] text-link">Clear metadata cache</button>
          </Row>
        </GroupRow>

        {/* ============ groups ============ */}
        <GroupRow title="Groups">
          {list.map((g) => <GroupItem key={g} g={g} onRename={renameGroup} onHide={hideGroup} onReorder={reorderGroup} />)}
          <div className="px-4 py-2.5 flex gap-2">
            <button onClick={unhideAll} disabled={!hiddenCount} className="press text-[15px] text-link disabled:opacity-40">Unhide all ({hiddenCount})</button>
          </div>
        </GroupRow>

        {allChannels.length > 0 && (
          <GroupRow title="Move item to another group">
            <div className="px-3 py-2 flex gap-2">
              <select value={moveId} onChange={(e) => setMoveId(e.target.value)} className="flex-1 bg-white/5 rounded-xl px-2 py-2 text-[14px] outline-none">
                <option value="">Choose item…</option>
                {allChannels.slice(0, 4000).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>
            {moveId && (
              <div className="px-3 pb-3 flex gap-2">
                <select onChange={(e) => { moveToGroup(moveId, e.target.value); setMoveId(''); }} defaultValue=""
                  className="flex-1 bg-white/5 rounded-xl px-2 py-2 text-[14px] outline-none">
                  <option value="" disabled>Move to…</option>
                  {allGroups.map((g) => <option key={g} value={g}>{g}</option>)}
                </select>
              </div>
            )}
          </GroupRow>
        )}

        {/* ============ backup ============ */}
        <GroupRow title="Backup & restore">
          <Row className="py-2">
            <button onClick={onExportData} className="press flex-1 text-[16px] text-link">Export everything as .json</button>
          </Row>
          <label className="block cursor-pointer">
            <input type="file" accept=".json,application/json" className="hidden"
              onChange={(e) => { if (e.target.files?.[0]) inspectRestore(e.target.files[0]); e.target.value = ''; }} />
            <div className="px-4 py-3 text-[16px] text-link flex items-center justify-between">
              <span>Restore from file</span><IconChevron className="w-4 h-4 text-white/30" />
            </div>
          </label>
          {restorePreview && (
            <div className="mx-4 mb-3 rounded-xl bg-white/5 px-3 py-2.5 text-[13px] space-y-1">
              {restorePreview.__invalid ? (
                <div className="text-red-400">That file is not a valid backup.</div>
              ) : (
                <>
                  <div className="font-semibold">This backup contains:</div>
                  {(() => { const c = countsOf(restorePreview); return (
                    <div className="text-white/60 leading-relaxed">
                      {c.profiles} profile{s(c.profiles)} · {c.playlists} playlist{s(c.playlists)}{c.channels ? ` (${c.channels.toLocaleString()} channels)` : ''} · {c.favourites} favourites · settings: {c.settings}
                    </div>
                  ); })()}
                  <div className="flex gap-2 pt-1">
                    <Button primary onClick={() => { onRestoreData(restorePreview); setRestorePreview(null); }}>Restore</Button>
                    <Button onClick={() => setRestorePreview(null)}>Cancel</Button>
                  </div>
                </>
              )}
            </div>
          )}
          {hasRestoreSnapshot && (
            <Row className="py-2">
              <button onClick={onUndoRestore} className="press flex-1 text-left text-[15px] text-link">Undo last restore</button>
            </Row>
          )}
          <div className="px-4 pb-3 text-[12px] text-white/35">Safari may clear website data if the app is unused for weeks, and can evict downloads when storage runs low — keep a backup.</div>
        </GroupRow>

        {/* ============ diagnostics & data ============ */}
        <GroupRow title="Diagnostics & data">
          <Row className="py-2">
            <button onClick={onCheckUpdates} className="press flex-1 text-left text-[16px] text-link">Check for updates</button>
          </Row>
          <Row className="py-2">
            <button onClick={async () => { await clearTmdbCache(); if ('caches' in window) { const keys = await caches.keys(); await Promise.all(keys.map((k) => caches.delete(k))); } }} className="press flex-1 text-left text-[16px] text-link">Clear cache (images & temp)</button>
          </Row>
          {confirmWipe ? (
            <div className="mx-4 my-2 rounded-xl bg-red-500/10 border border-red-400/30 px-3 py-3 space-y-2">
              <div className="text-[14px] text-red-300 font-semibold">Delete everything? Playlists, profiles, favourites, history and downloads will be wiped.</div>
              <div className="flex gap-2">
                <button onClick={() => { onClearAllData(); setConfirmWipe(false); }} className="press flex-1 py-2 rounded-xl bg-red-500 text-white font-bold text-[14px]">Yes, factory reset</button>
                <button onClick={() => setConfirmWipe(false)} className="press flex-1 py-2 rounded-xl bg-white/10 font-semibold text-[14px]">Cancel</button>
              </div>
            </div>
          ) : (
            <Row className="py-2">
              <button onClick={() => setConfirmWipe(true)} className="press flex-1 text-left text-[16px] text-red-400">Clear all data…</button>
            </Row>
          )}
        </GroupRow>

        {!isStandalone && (
          <GroupRow title="Install on iPhone">
            <div className="px-4 py-3 text-[14px] text-white/70 leading-relaxed space-y-1.5">
              <div className="flex gap-2"><b className="text-white">1.</b><span>Tap <b>Share</b> in Safari</span></div>
              <div className="flex gap-2"><b className="text-white">2.</b><span>Scroll and choose <b>Add to Home Screen</b></span></div>
              <div className="flex gap-2"><b className="text-white">3.</b><span>Open it from your Home Screen — full screen, no browser bars</span></div>
            </div>
          </GroupRow>
        )}

        {status && <div className="px-5 py-2 text-[13px] text-green-400">{status}</div>}

        <GroupRow title="About">
          <div className="px-4 py-3 text-[12px] text-white/35 leading-relaxed">
            A player for your own M3U, M3U8 or Xtream playlist. This app <b>does not provide, host or sell any channels</b> — nothing is included, hosted or recommended.
            What you connect it to, and whether you are entitled to, is your responsibility.
            Streams play directly from your provider; only playlist text and guide data pass through its proxy to satisfy browser CORS rules.
            Metadata via The Movie Database (CC BY).
          </div>
        </GroupRow>
      </div>
    </Sheet>
  );
}

function s(n: number) { return n === 1 ? '' : 's'; }

function Toggle({ label, value, onChange }: { label: string; value: boolean; onChange: (v: boolean) => void }) {
  return (
    <Row className="py-2">
      <span className="flex-1 text-[15px]">{label}</span>
      <button onClick={() => onChange(!value)} role="switch" aria-checked={value}
        className={`press w-[46px] h-[28px] rounded-full relative transition-colors ${value ? 'bg-accent' : 'bg-white/15'}`}>
        <span className={`absolute top-[3px] w-[22px] h-[22px] rounded-full bg-white shadow transition-all ${value ? 'left-[21px]' : 'left-[3px]'}`} />
      </button>
    </Row>
  );
}

function GroupItem({ g, onRename, onHide, onReorder }: { g: string; onRename: (g: string, name: string) => void; onHide: (g: string) => void; onReorder: (g: string, dir: -1 | 1) => void }) {
  const [editing, setEditing] = useState(false);
  const [val, setVal] = useState('');
  return (
    <Row className="py-2">
      {editing ? (
        <div className="flex-1 flex gap-2 items-center">
          <input value={val} onChange={(e) => setVal(e.target.value)} autoFocus
            className="flex-1 bg-black/30 rounded-lg px-2 py-1.5 text-[14px] outline-none" />
          <Button onClick={() => { onRename(g, val); setEditing(false); }} disabled={!val.trim()}>Save</Button>
          <Button onClick={() => setEditing(false)}>Cancel</Button>
        </div>
      ) : (
        <>
          <button onClick={() => { setVal(g); setEditing(true); }} className="press flex-1 text-left truncate text-[15px]">{g}</button>
          <div className="flex items-center gap-1 shrink-0">
            <button onClick={() => onReorder(g, -1)} className="press w-8 h-8 rounded-lg bg-white/8 text-[15px]" title="Move up">↑</button>
            <button onClick={() => onReorder(g, 1)} className="press w-8 h-8 rounded-lg bg-white/8 text-[15px]" title="Move down">↓</button>
            <button onClick={() => onHide(g)} className="press p-2 text-white/40" title="Hide"><IconTrash className="w-4 h-4" /></button>
          </div>
        </>
      )}
    </Row>
  );
}

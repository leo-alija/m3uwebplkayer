'use client';

import { useEffect, useState } from 'react';
import { Channel, Playlist } from '@/lib/types';
import { Sheet, Button, IconChevron, GroupRow, Row, IconTrash } from './ui';
import { getDownloadIndex, removeDownload, fmtBytes, DownloadInfo } from '@/lib/downloads';

export function SettingsSheet({ open, onClose, playlist, groups, allGroups, hiddenCount, tmdbKey, setTmdbKey, status,
  hideGroup, renameGroup, reorderGroup, unhideAll, moveToGroup, allChannels,
  onOpenImport, onOpenProfiles, onExportData, onImportData, onClearPlaylist, isStandalone, playbackCount, mvCount }: {
  open: boolean; onClose: () => void;
  playlist: Playlist | null;
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
  onExportData: () => void; onImportData: (f: File) => void;
  onClearPlaylist: () => void;
  isStandalone: boolean; playbackCount: number; mvCount: number;
}) {
  const [moveId, setMoveId] = useState('');
  const [dl, setDl] = useState<DownloadInfo[]>([]);
  useEffect(() => { if (open) getDownloadIndex().then(setDl); }, [open]);
  const list = groups.length ? groups : [];

  return (
    <Sheet open={open} title="Settings" onClose={onClose}>
      <div className="pb-10">
        <GroupRow title="Playlist">
          <Row className="py-2">
            <div className="flex-1 min-w-0 text-[16px]">{playlist ? playlist.name.replace(/^https?:\/\//, '').slice(0, 40) : 'No playlist'}</div>
            {playlist && <span className="text-[13px] text-white/40">{playlist.channels.length.toLocaleString()} items</span>}
          </Row>
          <Row className="py-2">
            <button onClick={onOpenImport} className="press flex-1 flex items-center justify-between text-[16px] text-[#0a84ff]">
              <span>Add / replace playlist</span><IconChevron className="w-4 h-4" />
            </button>
          </Row>
          {playlist && (
            <Row className="py-2">
              <button onClick={onClearPlaylist} className="press flex-1 text-[16px] text-red-400">Remove playlist</button>
            </Row>
          )}
        </GroupRow>

        <GroupRow title="Favourites & history">
          <Row className="py-2"><span className="flex-1 text-[16px]">Watching now</span><span className="text-[13px] text-white/40">{playbackCount} in progress</span></Row>
          <Row className="py-2"><span className="flex-1 text-[16px]">Multiview tiles</span><span className="text-[13px] text-white/40">{mvCount}</span></Row>
          <Row className="py-2">
            <button onClick={onOpenProfiles} className="press flex-1 flex items-center justify-between text-[16px] text-[#0a84ff]">
              <span>Profiles</span><IconChevron className="w-4 h-4" />
            </button>
          </Row>
        </GroupRow>

        <GroupRow title="Saved offline">
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
        </GroupRow>

        <GroupRow title="TMDb metadata (optional)">
          <input value={tmdbKey} onChange={(e) => setTmdbKey(e.target.value)} placeholder="v3 API key" autoCapitalize="none" autoCorrect="off"
            className="w-full bg-transparent px-4 py-3 text-[15px] outline-none placeholder:text-white/30" />
          <div className="px-4 pb-3 text-[12px] text-white/35 leading-relaxed">
            Adds posters, ratings and blurbs for films and series. Without a key, everything still plays — shelves are built from your own library.
          </div>
        </GroupRow>

        <GroupRow title="Groups">
          {list.map((g) => <GroupItem key={g} g={g} onRename={renameGroup} onHide={hideGroup} onReorder={reorderGroup} />)}
          <div className="px-4 py-2.5 flex gap-2">
            <button onClick={unhideAll} disabled={!hiddenCount} className="press text-[15px] text-[#0a84ff] disabled:opacity-40">Unhide all ({hiddenCount})</button>
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

        <GroupRow title="Backup">
          <Row className="py-2">
            <button onClick={onExportData} className="press flex-1 text-[16px] text-[#0a84ff]">Export as .json file</button>
          </Row>
          <label className="block cursor-pointer">
            <input type="file" accept=".json,application/json" className="hidden"
              onChange={(e) => { if (e.target.files?.[0]) onImportData(e.target.files[0]); e.target.value = ''; }} />
            <div className="px-4 py-3 text-[16px] text-[#0a84ff] flex items-center justify-between">
              <span>Restore from file</span><IconChevron className="w-4 h-4 text-white/30" />
            </div>
          </label>
          <div className="px-4 pb-3 text-[12px] text-white/35">Safari may clear website data if the app is unused for weeks — keep a backup.</div>
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
            A player for your own M3U, M3U8 or Xtream playlist — nothing is included, hosted or recommended.
            What you connect it to, and whether you are entitled to, is your responsibility.
            Streams play directly from your provider, videos never pass through this site except playlist text, which is fetched
            through its proxy to satisfy browser CORS rules. Posters cover Music and metadata via The Movie Database (CC BY).
          </div>
        </GroupRow>
      </div>
    </Sheet>
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

'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { Channel, LiveFolder, Profile, Program, SortDir, SortPref, ChannelDensity } from '@/lib/types';
import { buildFolders, childFolders, channelsInFolder, folderIcon } from '@/lib/folders';
import { nowProgram, parseXmltvDate, progWindow } from '@/lib/epg';
import { Poster, IconStar, IconChevron, IconSearch, IconPlus, IconClose } from './ui';

/* ============ shared sort ============ */

export function sortChannels(list: Channel[], pref: SortPref, profile: Profile): Channel[] {
  const dir = pref.dir === 'desc' ? -1 : 1;
  const num = (id: string) => profile.playCounts[id] || 0;
  const recent = (id: string) => {
    const i = profile.recents.indexOf(id);
    return i === -1 ? -Infinity : profile.recents.length - i;
  };
  const sorted = [...list].sort((a, b) => {
    switch (pref.mode) {
      case 'name': return a.name.localeCompare(b.name) * dir;
      case 'recent': return (recent(b.id) - recent(a.id)) * (pref.dir === 'desc' ? 1 : -1);
      case 'added': return ((b.addedAt || 0) - (a.addedAt || 0)) * (pref.dir === 'desc' ? 1 : -1);
      case 'favourites': {
        const fa = profile.favorites.includes(a.id) ? 0 : 1;
        const fb = profile.favorites.includes(b.id) ? 0 : 1;
        if (fa !== fb) return (fa - fb) * (pref.dir === 'desc' ? -1 : 1);
        return a.name.localeCompare(b.name);
      }
      case 'watched': return (num(b.id) - num(a.id)) * (pref.dir === 'desc' ? 1 : -1);
      case 'custom': {
        const ia = profile.channelOrder.indexOf(a.id), ib = profile.channelOrder.indexOf(b.id);
        const ra = ia === -1 ? Infinity : ia, rb = ib === -1 ? Infinity : ib;
        if (ra !== rb) return (ra - rb) * (pref.dir === 'desc' ? -1 : 1);
        return a.name.localeCompare(b.name);
      }
      default: return a.name.localeCompare(b.name) * dir;
    }
  });
  return sorted;
}

const SORT_LABELS: Record<SortMode2, string> = {
  name: 'Name', recent: 'Recently Played', added: 'Date Added',
  favourites: 'Favourites First', watched: 'Most Watched', custom: 'Custom order',
};
type SortMode2 = SortPref['mode'];

/* ============ Now / Next strip ============ */

export function NowNextStrip({ channels, epgFor, offsetMinutes, onPlay, onCatchup }: {
  channels: Channel[];
  epgFor: (ch: Channel) => Program[] | undefined;
  offsetMinutes: number;
  onPlay: (ch: Channel) => void;
  onCatchup?: (ch: Channel, prog: Program) => void;
}) {
  const [pageOffsetMin, setPageOffsetMin] = useState(0); /* 0 = now; ±2h pages */
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setTick((x) => x + 1), 30_000);
    return () => clearInterval(t);
  }, []);
  useEffect(() => { setPageOffsetMin(0); }, [channels.length]);

  const atMs = Date.now() + pageOffsetMin * 60_000 + tick * 0;
  const rows = useMemo(() => {
    const at = Date.now() + pageOffsetMin * 60_000;
    const out: { ch: Channel; now?: Program; next?: Program }[] = [];
    for (const ch of channels.slice(0, 40)) {
      const progs = epgFor(ch);
      if (!progs?.length) continue;
      const win = progs
        .map((p) => ({ p, w: progWindow(p, offsetMinutes) }))
        .filter(({ w }) => w.stop > at && w.start < at + 2 * 3600_000)
        .sort((a, b) => a.w.start - b.w.start);
      if (!win.length) continue;
      const now = win.find(({ w }) => w.start <= at && at < w.stop)?.p;
      const next = win.find(({ w }) => w.start > at)?.p;
      if (now || next) out.push({ ch, now, next });
    }
    return out;
  }, [channels, epgFor, offsetMinutes, pageOffsetMin, tick]);

  if (!rows.length) return null;
  const fmt = (p?: Program) => {
    if (!p) return '';
    const { start } = progWindow(p, offsetMinutes);
    const d = new Date(start);
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  };
  const pageLabel = pageOffsetMin === 0 ? 'Now' : pageOffsetMin > 0 ? `+${pageOffsetMin / 60}h` : `${pageOffsetMin / 60}h`;

  return (
    <div className="ios-card mx-4 mt-3 overflow-hidden">
      <div className="flex items-center gap-2 px-3 py-2 hairline-b">
        <div className="text-[13px] font-semibold uppercase tracking-wide text-white/45 flex-1">
          Programme guide · <span className="text-accent">{pageLabel}</span>
        </div>
        <button onClick={() => setPageOffsetMin((v) => Math.max(-12 * 60, v - 120))} className="press px-2.5 py-1 rounded-lg bg-white/8 text-[12px] font-semibold">Earlier</button>
        <button onClick={() => setPageOffsetMin((v) => Math.min(8 * 24 * 60, v + 120))} className="press px-2.5 py-1 rounded-lg bg-white/8 text-[12px] font-semibold">Later</button>
        {pageOffsetMin !== 0 && (
          <button onClick={() => setPageOffsetMin(0)} className="press px-2.5 py-1 rounded-lg bg-accent text-black text-[12px] font-bold">Back to now</button>
        )}
      </div>
      <div className="max-h-[300px] overflow-y-auto">
        {rows.map(({ ch, now, next }) => (
          <div key={ch.id} className="px-3 py-2 hairline-b last:border-0 flex items-center gap-3">
            <button onClick={() => onPlay(ch)} className="press flex items-center gap-3 flex-1 min-w-0 text-left">
              <Poster src={ch.logo} className="w-9 h-9 rounded-md shrink-0" />
              <div className="min-w-0 flex-1">
                <div className="text-[13px] truncate font-medium">
                  {now ? <span className="text-accent font-bold mr-1.5">{fmt(now)}</span> : null}
                  <span className="truncate">{now?.title || '—'}</span>
                </div>
                {next && <div className="text-[11px] text-white/40 truncate mt-0.5">{fmt(next)} · {next.title}</div>}
              </div>
            </button>
            {now && onCatchup && pageOffsetMin < 0 && (
              <button onClick={() => onCatchup(ch, now)} className="press shrink-0 text-[11px] font-bold text-link px-2 py-1 rounded-lg bg-white/8" title="Watch from the start">Catch-up</button>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

/* ============ context menu ============ */

export type CtxAction = { label: string; danger?: boolean; hidden?: boolean; onSelect: () => void };

export function useContextMenu() {
  const [menu, setMenu] = useState<{ x: number; y: number; actions: CtxAction[] } | null>(null);
  const open = (e: React.MouseEvent | { clientX: number; clientY: number }, actions: CtxAction[]) => {
    if ('preventDefault' in e) e.preventDefault();
    const x = 'clientX' in e ? e.clientX : 0;
    const y = 'clientY' in e ? e.clientY : 0;
    setMenu({
      x: Math.min(x, (typeof window !== 'undefined' ? window.innerWidth : 400) - 210),
      y: Math.min(y, (typeof window !== 'undefined' ? window.innerHeight : 800) - 40 - actions.length * 42),
      actions,
    });
  };
  const node = menu ? (
    <div className="fixed inset-0 z-[60]" onClick={() => setMenu(null)} onContextMenu={(e) => { e.preventDefault(); setMenu(null); }}>
      <div className="absolute ios-blur rounded-2xl border border-white/15 shadow-2xl py-1.5 min-w-[196px] overflow-hidden"
        style={{ left: menu.x, top: menu.y, maxHeight: '70dvh', overflowY: 'auto' }}>
        {menu.actions.filter((a) => !a.hidden).map((a, i) => (
          <button key={i} onClick={(ev) => { ev.stopPropagation(); setMenu(null); a.onSelect(); }}
            className={`press w-full text-left px-4 py-2.5 text-[14px] ${a.danger ? 'text-red-400' : 'text-white/90'} whitespace-nowrap`}>
            {a.label}
          </button>
        ))}
      </div>
    </div>
  ) : null;
  return { open, node, close: () => setMenu(null) };
}

/* long-press → context menu (iOS has no right-click). A closure factory, not
   a hook, so it can be created inline per item in .map() without breaking the
   rules of hooks. */
export function makeLongPress(onLong: (x: number, y: number) => void, ms = 500) {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let sx = 0, sy = 0;
  return {
    onTouchStart: (e: React.TouchEvent) => {
      const t = e.touches[0];
      sx = t.clientX; sy = t.clientY;
      timer = setTimeout(() => { onLong(sx, sy); timer = null; }, ms);
    },
    onTouchMove: (e: React.TouchEvent) => {
      const t = e.touches[0];
      if (timer && Math.hypot(t.clientX - sx, t.clientY - sy) > 12) { clearTimeout(timer); timer = null; }
    },
    onTouchEnd: () => { if (timer) { clearTimeout(timer); timer = null; } },
  };
}

/* ============ the Live TV screen ============ */

type Props = {
  channels: Channel[];                       /* live channels only */
  profile: Profile;
  updateProfile: (patch: Partial<Profile>) => void;
  epgFor: (ch: Channel) => Program[] | undefined;
  guideOffsetMinutes: number;
  density: ChannelDensity;
  startFolder: string;
  defaultSort: SortPref;
  resumeMap: Record<string, { time: number; duration?: number }>;
  onPlay: (ch: Channel) => void;
  onCatchup: (ch: Channel, prog: Program) => void;
  flash: (msg: string) => void;
};

export default function LivetvScreen(p: Props) {
  const [folderId, setFolderId] = useState<string>('');
  const [subGroup, setSubGroup] = useState<string>('all');
  const [filter, setFilter] = useState('');
  const [manage, setManage] = useState(false);
  const [showHidden, setShowHidden] = useState(false);
  const [newFolder, setNewFolder] = useState('');
  const [namingFolder, setNamingFolder] = useState<string | null>(null);
  const [newName, setNewName] = useState('');
  const [visible, setVisible] = useState(60);
  const [nestTarget, setNestTarget] = useState<string | null>(null);
  const ctx = useContextMenu();
  const scrollRef = useRef<HTMLDivElement>(null);

  const folders = useMemo(() => buildFolders(
    Array.from(new Set(p.channels.flatMap((c) => c.groups || [c.group || 'Uncategorized']))),
    p.profile,
  ), [p.channels, p.profile]);

  useEffect(() => {
    if (!folderId && folders.length) {
      setFolderId(p.startFolder && folders.some((f) => f.id === p.startFolder) ? p.startFolder : folders[0].id);
    }
  }, [folders, folderId, p.startFolder]);

  const folder = folders.find((f) => f.id === folderId) || folders[0];
  const sortPref = p.profile.sortPrefs[folderId] || p.defaultSort;

  const folderChannels = useMemo(
    () => (folder ? channelsInFolder(p.channels, folder, p.profile) : []),
    [p.channels, folder, p.profile]);

  const groupChips = useMemo(() => {
    if (!folder || folder.kind === 'special') return [];
    return folder.groupTitles
      .map((g) => ({ g, n: p.channels.filter((c) => (c.groups || [c.group || '']).includes(g)).length }))
      .sort((a, b) => {
        const ia = p.profile.groupOrder.indexOf(a.g), ib = p.profile.groupOrder.indexOf(b.g);
        return (ia === -1 ? 1e9 : ia) - (ib === -1 ? 1e9 : ib) || a.g.localeCompare(b.g);
      });
  }, [folder, p.channels, p.profile.groupOrder]);

  const list = useMemo(() => {
    let l = folderChannels;
    if (subGroup !== 'all') l = l.filter((c) => (c.groups || [c.group || '']).includes(subGroup));
    if (filter) l = l.filter((c) => c.name.toLowerCase().includes(filter.toLowerCase()));
    return sortChannels(l, sortPref, p.profile);
  }, [folderChannels, subGroup, filter, sortPref, p.profile]);

  useEffect(() => { setVisible(60); }, [folderId, subGroup, filter]);

  /* spotlight: recent + favourites */
  const spotlight = useMemo(() => {
    const recent = p.profile.recents.map((id) => p.channels.find((c) => c.id === id)).filter(Boolean) as Channel[];
    const favs = p.profile.favorites.map((id) => p.channels.find((c) => c.id === id)).filter(Boolean) as Channel[];
    return [...recent.slice(0, 6), ...favs.filter((f) => !recent.includes(f)).slice(0, 6)];
  }, [p.profile.recents, p.profile.favorites, p.channels]);

  /* channel actions */
  function channelActions(c: Channel): CtxAction[] {
    const fav = p.profile.favorites.includes(c.id);
    const orderIdx = p.profile.channelOrder.indexOf(c.id);
    const childIds = new Set(childFolders(folders, folder?.id || '').map((f) => f.id));
    const targets = folders.filter((f) => f.kind !== 'special' && f.id !== folder?.id && !childIds.has(f.id));
    return [
      { label: '▶ Play', onSelect: () => p.onPlay(c) },
      { label: fav ? '♥ Remove favourite' : '♥ Add to favourites', onSelect: () => toggleFav(c.id) },
      { label: 'Remove from Recently Watched', hidden: !p.profile.recents.includes(c.id), onSelect: () => {
          p.updateProfile({ recents: p.profile.recents.filter((x) => x !== c.id) });
          p.flash('Removed from Recently Watched');
        } },
      { label: 'Move up (custom order)', hidden: sortPref.mode !== 'custom', onSelect: () => reorderChannel(c.id, -1) },
      { label: 'Move down (custom order)', hidden: sortPref.mode !== 'custom', onSelect: () => reorderChannel(c.id, 1) },
      { label: 'Reset to playlist position', hidden: orderIdx === -1, onSelect: () => {
          p.updateProfile({ channelOrder: p.profile.channelOrder.filter((x) => x !== c.id) });
          p.flash('Reset to playlist position');
        } },
      ...targets.map((f) => ({
        label: `Move to ${f.name}`,
        onSelect: () => moveChannelToFolder(c, f),
      })),
      { label: 'Hide this channel', danger: true, onSelect: () => {
          p.updateProfile({ hiddenChannels: [...p.profile.hiddenChannels, c.id] });
          p.flash(`Hidden “${c.name}”`);
        } },
    ];
  }

  function toggleFav(id: string) {
    const next = p.profile.favorites.includes(id)
      ? p.profile.favorites.filter((x) => x !== id)
      : [...p.profile.favorites, id];
    p.updateProfile({ favorites: next });
  }

  function moveChannelToFolder(c: Channel, f: LiveFolder) {
    const groups = c.groups || [c.group || 'Uncategorized'];
    /* move every raw group of the channel that currently lives in the open folder */
    const moved = groups.filter((g) => folder?.groupTitles.includes(g));
    const patch: Partial<Profile> = {};
    const moves = { ...p.profile.folderGroupMoves };
    for (const g of moved) moves[g] = f.id;
    patch.folderGroupMoves = moves;
    p.updateProfile(patch);
    p.flash(`Moved to ${f.name}`);
  }

  function reorderChannel(id: string, dir: -1 | 1) {
    const ids = list.map((c) => c.id);
    const i = ids.indexOf(id);
    const j = i + dir;
    if (i === -1 || j < 0 || j >= ids.length) return;
    const other = ids[j];
    /* global custom order: saved order first, then playlist order */
    const allIds = p.channels.map((c) => c.id);
    const order = [
      ...p.profile.channelOrder.filter((x) => allIds.includes(x)),
      ...allIds.filter((x) => !p.profile.channelOrder.includes(x)),
    ];
    const oi = order.indexOf(id), oj = order.indexOf(other);
    if (oi === -1 || oj === -1) return;
    order.splice(oi, 1);
    order.splice(order.indexOf(other) + (dir === 1 ? 1 : 0), 0, id);
    p.updateProfile({ channelOrder: order });
  }

  function setSort(mode: SortMode2, dir?: SortDir) {
    const next = { mode, dir: dir || sortPref.dir };
    p.updateProfile({ sortPrefs: { ...p.profile.sortPrefs, [folderId]: next } });
  }

  function flipDir() {
    setSort(sortPref.mode, sortPref.dir === 'asc' ? 'desc' : 'asc');
  }

  /* folder management */
  function reorderFolder(id: string, dir: -1 | 1) {
    const ids = folders.map((f) => f.id);
    const i = ids.indexOf(id);
    const j = i + dir;
    if (i === -1 || j < 0 || j >= ids.length) return;
    const order = p.profile.folderOrder.length ? [...p.profile.folderOrder] : folders.filter((f) => f.kind !== 'special').map((f) => f.id);
    const oi = order.indexOf(id);
    if (oi !== -1) order.splice(oi, 1);
    const oj = order.indexOf(ids[j]);
    order.splice(oj === -1 ? order.length : oj + (dir === 1 ? 1 : 0), 0, id);
    p.updateProfile({ folderOrder: order });
  }

  function renameFolder(id: string, name: string) {
    p.updateProfile({ folderRenames: { ...p.profile.folderRenames, [id]: name } });
  }

  function hideFolder(f: LiveFolder) {
    p.updateProfile({ hiddenGroups: [...p.profile.hiddenGroups, ...f.groupTitles] });
    p.flash(`Hidden “${f.name}”`);
  }

  function deleteFolder(f: LiveFolder) {
    if (f.kind === 'special') return;
    const moves = { ...p.profile.folderGroupMoves };
    for (const g of f.groupTitles) delete moves[g];
    p.updateProfile({
      customFolders: p.profile.customFolders.filter((x) => x.id !== f.id),
      folderGroupMoves: moves,
      folderOrder: p.profile.folderOrder.filter((x) => x !== f.id),
    });
    if (folderId === f.id) setFolderId('');
    p.flash(`Deleted “${f.name}” — channels returned to their country folders`);
  }

  function createFolder(name: string, parent?: string) {
    const id = `f_${Date.now().toString(36)}`;
    p.updateProfile({ customFolders: [...p.profile.customFolders, { id, name, kind: 'custom', parent, groupTitles: [] }] });
    setFolderId(id);
    p.flash(`Folder “${name}” created`);
  }

  function moveGroupToFolder(group: string, targetId: string) {
    p.updateProfile({ folderGroupMoves: { ...p.profile.folderGroupMoves, [group]: targetId } });
    p.flash('Category moved');
  }

  function reorderGroup(group: string, dir: -1 | 1) {
    if (!folder) return;
    const siblings = groupChips.map((x) => x.g);
    const i = siblings.indexOf(group);
    const j = i + dir;
    if (j < 0 || j >= siblings.length) return;
    const order = p.profile.groupOrder.length ? [...p.profile.groupOrder] : Array.from(new Set(p.channels.flatMap((c) => c.groups || [c.group || ''])));
    const oi = order.indexOf(group);
    if (oi !== -1) order.splice(oi, 1);
    const oj = order.indexOf(siblings[j]);
    order.splice(oj === -1 ? order.length : oj + (dir === 1 ? 1 : 0), 0, group);
    p.updateProfile({ groupOrder: order });
  }

  if (!folder) return <div className="py-24 text-center text-white/40">No live channels</div>;

  const densityCls = p.density === 'list' ? 'list' : p.density === 'small' ? 'small' : 'large';

  return (
    <div className="relative flex">
      {ctx.node}

      {/* ============ sidebar ============ */}
      <aside className={`shrink-0 scroll-y sticky top-0 self-start ${manage ? 'w-[230px]' : 'w-[172px]'} max-h-[calc(100dvh-110px)] pb-4 pl-2 pr-1 hidden md:block`}>
        {manage && (
          <div className="px-1 pb-2 flex gap-1.5">
            <button onClick={() => setManage(false)} className="press flex-1 text-[12px] font-bold bg-accent text-black rounded-lg py-1.5">Done</button>
          </div>
        )}
        {folders.map((f) => {
          const count = f.kind === 'special'
            ? p.profile.favorites.length
            : channelsInFolder(p.channels, f, p.profile).length;
          const children = childFolders(folders, f.id);
          const active = f.id === folderId;
          return (
            <div key={f.id}>
              <div className={`group flex items-center rounded-xl ${active ? 'bg-white/12' : ''}`}>
                <button onClick={() => { setFolderId(f.id); setSubGroup('all'); }}
                  className="press flex-1 min-w-0 flex items-center gap-2 px-2.5 py-2 text-left">
                  <span className="text-[15px] shrink-0">{folderIcon(f)}</span>
                  {namingFolder === f.id ? (
                    <input value={newName} autoFocus onChange={(e) => setNewName(e.target.value)}
                      onBlur={() => { if (newName.trim()) renameFolder(f.id, newName.trim()); setNamingFolder(null); }}
                      onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
                      className="min-w-0 flex-1 bg-black/40 rounded-md px-1.5 py-0.5 text-[13px] outline-none" />
                  ) : (
                    <span className={`truncate text-[13px] ${active ? 'font-bold' : 'text-white/80'}`}>{f.name}</span>
                  )}
                  <span className="text-[10px] text-white/30 ml-auto shrink-0">{count}</span>
                </button>
                {manage && f.kind !== 'special' && (
                  <button onClick={(e) => ctx.open({ clientX: e.clientX, clientY: e.clientY }, [
                    { label: 'Rename', onSelect: () => { setNamingFolder(f.id); setNewName(f.name); } },
                    { label: 'Move up', onSelect: () => reorderFolder(f.id, -1) },
                    { label: 'Move down', onSelect: () => reorderFolder(f.id, 1) },
                    { label: 'Create folder inside', onSelect: () => createFolder('New folder', f.id) },
                    ...childFolders(folders, f.id).length ? [{ label: 'Un-nest subfolder', onSelect: () => {
                      const child = childFolders(folders, f.id)[0];
                      p.updateProfile({ customFolders: p.profile.customFolders.map((x) => x.id === child.id ? { ...x, parent: undefined } : x) });
                    } }] : [],
                    { label: 'Hide folder', onSelect: () => hideFolder(f) },
                    { label: 'Delete folder', danger: true, onSelect: () => deleteFolder(f) },
                  ])} className="press p-1.5 text-white/40" title="Folder options">⋯</button>
                )}
              </div>
              {children.map((c) => (
                <button key={c.id} onClick={() => { setFolderId(c.id); setSubGroup('all'); }}
                  className={`press w-[calc(100%-14px)] ml-[14px] flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-left ${c.id === folderId ? 'bg-white/10' : ''}`}>
                  <IconChevron className="w-3 h-3 text-white/25" />
                  <span className="truncate text-[12px] text-white/70">{c.name}</span>
                </button>
              ))}
            </div>
          );
        })}

        {manage && (
          <div className="px-1 pt-2 space-y-1.5">
            <div className="flex gap-1.5">
              <input value={newFolder} onChange={(e) => setNewFolder(e.target.value)} placeholder="New folder"
                className="min-w-0 flex-1 bg-white/8 rounded-lg px-2 py-1.5 text-[12px] outline-none placeholder:text-white/30" />
              <button onClick={() => { if (newFolder.trim()) { createFolder(newFolder.trim(), nestTarget || undefined); setNewFolder(''); } }}
                className="press w-8 rounded-lg bg-accent text-black font-bold" title="Create">+</button>
            </div>
            <div className="flex items-center gap-1.5 text-[11px] text-white/40">
              <span>Nest inside</span>
              <select value={nestTarget || ''} onChange={(e) => setNestTarget(e.target.value || null)}
                className="bg-white/8 rounded-md px-1 py-0.5 text-[11px] outline-none flex-1 min-w-0">
                <option value="">— top level —</option>
                {folders.filter((f) => f.kind !== 'special').map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
              </select>
            </div>
            <button onClick={() => setShowHidden((v) => !v)} className="press w-full text-left text-[12px] text-link py-1">
              {showHidden ? 'Hide' : 'Show'} hidden categories ({p.profile.hiddenGroups.length})
            </button>
            {showHidden && p.profile.hiddenGroups.map((g) => (
              <div key={g} className="flex items-center gap-1 text-[12px] text-white/50 px-1">
                <span className="flex-1 truncate">{g}</span>
                <button onClick={() => p.updateProfile({ hiddenGroups: p.profile.hiddenGroups.filter((x) => x !== g) })}
                  className="press text-link text-[11px]">Restore</button>
              </div>
            ))}
          </div>
        )}
        {!manage && (
          <button onClick={() => setManage(true)} className="press mt-2 px-2.5 py-1.5 text-[12px] text-white/40 flex items-center gap-1.5">
            <IconPlus className="w-3.5 h-3.5" /> Manage folders
          </button>
        )}
      </aside>

      {/* ============ main pane ============ */}
      <div ref={scrollRef} className="flex-1 min-w-0">
        {/* mobile folder switcher (sidebar is md+) */}
        <div className="scroll-x flex gap-2 px-3 py-2 md:hidden">
          {folders.map((f) => (
            <Chip key={f.id} label={`${folderIcon(f)} ${f.name}`} active={f.id === folderId}
              onClick={() => { setFolderId(f.id); setSubGroup('all'); }} />
          ))}
        </div>

        {/* spotlight */}
        {folder.kind === 'special' || spotlight.length === 0 ? null : (
          <div className="px-3 pt-1">
            <div className="relative rounded-2xl overflow-hidden ios-card p-4 space-y-2">
              <div className="text-[11px] font-bold uppercase tracking-widest text-accent">Pick up where you left off</div>
              <div className="scroll-x flex gap-2">
                {spotlight.map((c) => {
                  const r = p.resumeMap[c.id];
                  const pct = r?.duration ? Math.min(100, (r.time / r.duration) * 100) : undefined;
                  return (
                    <button key={c.id} onClick={() => p.onPlay(c)} onContextMenu={(e) => ctx.open(e, channelActions(c))} {...makeLongPress((x, y) => ctx.open({ clientX: x, clientY: y }, channelActions(c)))}
                      className="press w-[132px] shrink-0 text-left">
                      <div className="relative rounded-xl overflow-hidden bg-raise" style={{ aspectRatio: '16/9' }}>
                        <Poster src={c.logo} label={c.name} className="w-full h-full" />
                        {pct != null && pct > 0 && (
                          <div className="absolute bottom-0 inset-x-0 h-1 bg-white/25"><div className="h-full bg-accent" style={{ width: `${pct}%` }} /></div>
                        )}
                      </div>
                      <div className="mt-1 text-[11px] font-semibold truncate">{c.name}</div>
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        )}

        <NowNextStrip channels={list.slice(0, 40)} epgFor={p.epgFor} offsetMinutes={p.guideOffsetMinutes}
          onPlay={p.onPlay} onCatchup={p.onCatchup} />

        {/* sub-category chips */}
        {groupChips.length > 1 && (
          <div className="scroll-x flex gap-2 px-3 py-2.5">
            <Chip label={`All ${folderChannels.length}`} active={subGroup === 'all'} onClick={() => setSubGroup('all')} />
            {groupChips.map(({ g, n }) => (
              <span key={g} className="relative">
                <Chip label={`${g} ${n}`} active={subGroup === g} onClick={() => setSubGroup(g)} />
                {manage && (
                  <button onClick={(e) => ctx.open({ clientX: e.clientX, clientY: e.clientY }, [
                    ...folders.filter((f) => f.kind !== 'special' && f.id !== folder.id && !childFolders(folders, folder.id).some((x) => x.id === f.id))
                      .map((f) => ({ label: `Move to ${f.name}`, onSelect: () => moveGroupToFolder(g, f.id) })),
                    { label: 'Move up', onSelect: () => reorderGroup(g, -1) },
                    { label: 'Move down', onSelect: () => reorderGroup(g, 1) },
                    { label: 'Hide category', danger: true, onSelect: () => { p.updateProfile({ hiddenGroups: [...p.profile.hiddenGroups, g] }); p.flash(`Hidden “${g}”`); } },
                  ])} className="press absolute -top-1.5 -right-1 w-4 h-4 rounded-full bg-white text-black text-[9px] font-bold leading-4">⋯</button>
                )}
              </span>
            ))}
          </div>
        )}

        {/* toolbar */}
        <div className="px-3 pb-2 flex gap-2 items-center">
          <div className="flex-1 flex items-center bg-white/8 rounded-xl px-3">
            <IconSearch className="w-4 h-4 text-white/35" />
            <input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder={`Search ${folder.name}`}
              className="flex-1 bg-transparent py-2 text-[15px] outline-none placeholder:text-white/30" />
            {filter && <button onClick={() => setFilter('')} className="press p-1 text-white/50"><IconClose className="w-3.5 h-3.5" /></button>}
          </div>
          <select value={`${sortPref.mode}`} onChange={(e) => setSort(e.target.value as SortMode2)}
            className="bg-white/8 text-white rounded-xl px-2 py-2.5 text-[13px] outline-none max-w-[150px] appearance-none" title="Sort">
            {(Object.keys(SORT_LABELS) as SortMode2[]).map((m) => <option key={m} value={m}>{SORT_LABELS[m]}</option>)}
          </select>
          <button onClick={flipDir} className="press bg-white/8 rounded-xl px-3 py-2.5 text-[13px] font-semibold" title="Direction">
            {sortPref.dir === 'asc' ? '↑' : '↓'}
          </button>
        </div>

        {folder.kind === 'special' && folderChannels.length === 0 && (
          <div className="py-16 text-center text-white/40 text-[14px]">
            No favourites yet — long-press or right-click a channel and choose <b>Add to favourites</b>.
          </div>
        )}

        {/* channel grid / list */}
        {p.density === 'list' ? (
          <div className="mx-3 ios-card divide-y divide-white/5">
            {list.slice(0, visible).map((c) => {
              const now = nowProgram(p.epgFor(c) || [], p.guideOffsetMinutes);
              const fav = p.profile.favorites.includes(c.id);
              return (
                <div key={c.id} className="flex items-center gap-3 px-3 py-2.5">
                  <button onClick={() => p.onPlay(c)} onContextMenu={(e) => ctx.open(e, channelActions(c))} {...makeLongPress((x, y) => ctx.open({ clientX: x, clientY: y }, channelActions(c)))}
                    className="press flex items-center gap-3 flex-1 min-w-0 text-left">
                    {c.channelNumber != null && <span className="text-[11px] font-mono text-white/35 w-8 text-right shrink-0">{c.channelNumber}</span>}
                    <Poster src={c.logo} className="w-10 h-10 rounded-lg shrink-0" />
                    <div className="flex-1 min-w-0">
                      <div className="text-[15px] truncate flex items-center gap-1.5">
                        <span className="truncate font-medium">{c.name}</span>
                        {c.qualityTag && <span className="text-[10px] text-white/40 shrink-0">{c.qualityTag}</span>}
                      </div>
                      {now && <div className="text-[11px] text-white/45 truncate mt-0.5">Now: {now.title}</div>}
                    </div>
                  </button>
                  <button onClick={() => toggleFav(c.id)} className={`press p-2 shrink-0 ${fav ? 'text-accent' : 'text-white/25'}`} title="Favourite">
                    <IconStar filled={fav} className="w-5 h-5" />
                  </button>
                </div>
              );
            })}
          </div>
        ) : (
          <div className={`grid gap-3 px-3 pb-2 ${p.density === 'small' ? 'grid-cols-4 md:grid-cols-6' : 'grid-cols-2 md:grid-cols-3 lg:grid-cols-4'}`}>
            {list.slice(0, visible).map((c) => {
              const fav = p.profile.favorites.includes(c.id);
              return (
                <button key={c.id} onClick={() => p.onPlay(c)} onContextMenu={(e) => ctx.open(e, channelActions(c))} {...makeLongPress((x, y) => ctx.open({ clientX: x, clientY: y }, channelActions(c)))}
                  className="press text-left">
                  <div className="relative rounded-xl overflow-hidden bg-gradient-to-br from-raise to-deck flex items-center justify-center"
                    style={{ aspectRatio: '16/9' }}>
                    {c.logo ? (
                      <img src={c.logo} alt="" loading="lazy" onError={(e) => (e.currentTarget.style.visibility = 'hidden')}
                        className="max-w-[62%] max-h-[62%] object-contain drop-shadow-lg" />
                    ) : (
                      <span className="text-[12px] font-bold text-white/40 px-2 text-center leading-tight line-clamp-3">{c.name}</span>
                    )}
                    <div className="absolute inset-0 ring-1 ring-inset ring-white/5 rounded-xl" />
                    {c.channelNumber != null && <div className="absolute top-1 left-1.5 bg-black/60 rounded px-1 text-[9px] font-mono">{c.channelNumber}</div>}
                    {c.qualityTag && <div className="absolute top-1 right-1.5 bg-black/60 rounded px-1 text-[9px] font-bold">{c.qualityTag}</div>}
                    {fav && <IconStar filled className="absolute bottom-1 right-1.5 w-3.5 h-3.5 text-accent drop-shadow" />}
                  </div>
                  <div className="mt-1.5 text-[12px] font-medium truncate">{c.name}</div>
                </button>
              );
            })}
          </div>
        )}

        {list.length > visible && (
          <div className="py-3 text-center">
            <button onClick={() => setVisible((v) => v + 120)} className="press text-[14px] text-link">
              Show more ({(list.length - visible).toLocaleString()} left)
            </button>
          </div>
        )}
        {list.length === 0 && folder.kind !== 'special' && (
          <div className="py-16 text-center text-white/40 text-[14px]">Nothing here{filter ? ' for that search' : ''}.</div>
        )}
        <div className="h-6" />
      </div>
    </div>
  );
}

function Chip({ label, active, onClick }: { label: string; active?: boolean; onClick?: () => void }) {
  return (
    <button onClick={onClick}
      className={`press px-3.5 py-1.5 rounded-full text-[13px] whitespace-nowrap ${active ? 'bg-accent text-black font-semibold' : 'bg-white/10 text-white/85'}`}>
      {label}
    </button>
  );
}

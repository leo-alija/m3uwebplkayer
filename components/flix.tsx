'use client';

import { useEffect, useMemo, useState } from 'react';
import { Channel, Profile, SeriesFolder, SeriesEpisode, SortDir, AppSettings } from '@/lib/types';
import { makeLongPress, useContextMenu, type CtxAction } from './livetv';
import { Poster, IconStar, IconSearch, IconClose, IconChevron } from './ui';

/* ============ Flix (Movies & Series) ============
   Sidebar of parent categories (parsed from group titles split on | - :),
   sorts, view modes (grid/tiles/list), hide-watched, and a right-click /
   long-press context menu per card. */

export type FlixItem = {
  key: string;
  title: string;
  poster?: string;
  quality?: string | null;
  channel?: Channel;      /* movies */
  folder?: SeriesFolder;  /* series */
  rating?: number;
  year?: string;
  resumePct?: number;
};

export type FlixProps = {
  kind: 'movie' | 'series';
  items: FlixItem[];
  categories: { name: string; groups: string[]; count: number }[];
  profile: Profile;
  updateProfile: (patch: Partial<Profile>) => void;
  settings: AppSettings;
  downloads: Record<string, { pct: number; done?: boolean; failed?: string }>;
  onPlayItem: (item: FlixItem) => void;
  onInfo: (item: FlixItem) => void;
  onDownload?: (ch: Channel) => void;
  isWatched: (item: FlixItem) => boolean;
  onMarkWatched: (item: FlixItem, watched: boolean) => void;
  onRemoveContinue: (item: FlixItem) => void;
  onRenameCategory: (group: string, name: string) => void;
  onHideCategory: (group: string) => void;
  flash: (msg: string) => void;
};

type SortKey = 'name' | 'recent' | 'added' | 'rating' | 'year';

export default function FlixScreen(p: FlixProps) {
  const [cat, setCat] = useState('all');
  const [q, setQ] = useState('');
  const [sort, setSort] = useState<SortKey>('name');
  const [dir, setDir] = useState<SortDir>('asc');
  const [hideWatched, setHideWatched] = useState(p.settings.hideWatchedDefault);
  const [visible, setVisible] = useState(60);
  const ctx = useContextMenu();

  useEffect(() => { setCat('all'); setVisible(60); }, [p.kind]);

  const allCategories = useMemo(() => [{ name: 'All', groups: [] as string[], count: p.items.length }, ...p.categories], [p.categories, p.items.length]);

  const inCat = (item: FlixItem) => {
    if (cat === 'all') return true;
    const c = p.categories.find((x) => x.name === cat);
    if (!c) return true;
    const groups = item.channel?.groups || item.folder?.groupTitles || [];
    return groups.some((g) => c.groups.includes(g));
  };

  const list = useMemo(() => {
    const d = dir === 'desc' ? -1 : 1;
    let l = p.items.filter(inCat);
    if (hideWatched) l = l.filter((it) => !p.isWatched(it));
    if (q) l = l.filter((it) => it.title.toLowerCase().includes(q.toLowerCase()));
    return [...l].sort((a, b) => {
      switch (sort) {
        case 'name': return a.title.localeCompare(b.title) * d;
        case 'recent': {
          const ra = a.channel ? (p.profile.recents.indexOf(a.channel.id) + 1 || 1e9) : 1e9;
          const rb = b.channel ? (p.profile.recents.indexOf(b.channel.id) + 1 || 1e9) : 1e9;
          return (rb - ra) * (dir === 'desc' ? -1 : 1) * -1; /* recents first */
        }
        case 'added': return (((a.channel?.addedAt || a.folder?.episodes[0]?.channel.addedAt) || 0) - ((b.channel?.addedAt || b.folder?.episodes[0]?.channel.addedAt) || 0)) * -d;
        case 'rating': return ((a.rating || 0) - (b.rating || 0)) * -d;
        case 'year': return (parseInt(a.year || '0', 10) - parseInt(b.year || '0', 10)) * d;
        default: return a.title.localeCompare(b.title) * d;
      }
    });
  }, [p.items, p.profile.recents, cat, q, sort, dir, hideWatched, p.isWatched, p.categories]);

  useEffect(() => { setVisible(60); }, [cat, q, sort, dir, hideWatched]);

  function itemActions(it: FlixItem): CtxAction[] {
    const ch = it.channel || it.folder?.episodes[0]?.channel;
    const fav = ch ? p.profile.favorites.includes(ch.id) : false;
    const inList = ch ? (p.profile.watchlist || []).includes(ch.id) : false;
    const watched = p.isWatched(it);
    return [
      { label: '▶ Play', onSelect: () => p.onPlayItem(it) },
      { label: 'ⓘ More info', onSelect: () => p.onInfo(it) },
      { label: inList ? '✓ In My List — remove' : '+ My List', hidden: !ch, onSelect: () => {
          if (!ch) return;
          const cur = p.profile.watchlist || [];
          p.updateProfile({ watchlist: inList ? cur.filter((x) => x !== ch.id) : [ch.id, ...cur] });
          p.flash(inList ? 'Removed from My List' : 'Added to My List');
        } },
      { label: fav ? '♥ Remove favourite' : '♥ Favourite', hidden: !ch, onSelect: () => {
          if (!ch) return;
          const next = p.profile.favorites.includes(ch.id)
            ? p.profile.favorites.filter((x) => x !== ch.id)
            : [...p.profile.favorites, ch.id];
          p.updateProfile({ favorites: next });
        } },
      { label: '⬇ Download', hidden: !ch || !p.onDownload || !!p.downloads[ch.id], onSelect: () => ch && p.onDownload?.(ch) },
      { label: watched ? '◌ Mark unwatched' : '✓ Mark watched', onSelect: () => p.onMarkWatched(it, !watched) },
      { label: 'Remove from Continue Watching', hidden: it.resumePct == null, onSelect: () => p.onRemoveContinue(it) },
      ...p.categories.filter((c) => c.name !== 'All').slice(0, 12).map((c) => ({
        label: `Hide category “${c.name}”`,
        hidden: c.name !== parentOf(it),
        onSelect: () => { p.onHideCategory(c.groups[0]); p.flash(`Hidden “${c.name}”`); },
      })),
    ];
  }

  function parentOf(it: FlixItem): string {
    const g = it.channel?.groups?.[0] || it.folder?.groupTitles?.[0] || '';
    return parentName(g);
  }

  const card = (it: FlixItem) => {
    const dl = it.channel ? p.downloads[it.channel.id] : it.folder ? p.downloads[it.folder.episodes[0]?.channel.id] : undefined;
    return (
      <button key={it.key} onClick={() => p.onPlayItem(it)}
        onContextMenu={(e) => ctx.open(e, itemActions(it))}
        {...makeLongPress((x, y) => ctx.open({ clientX: x, clientY: y }, itemActions(it)))}
        className="press text-left">
        <div className="relative rounded-xl overflow-hidden" style={{ aspectRatio: '2/3' }}>
          <Poster src={it.poster} label={it.title} className="absolute inset-0 w-full h-full" />
          {it.quality && <div className="absolute bottom-1 left-1 text-[9px] font-bold bg-black/60 px-1 rounded">{it.quality}</div>}
          {dl?.done && <div className="absolute top-1 right-1 text-[10px] bg-green-500 text-black font-bold rounded px-1">OFFLINE</div>}
          {it.resumePct != null && it.resumePct > 0 && (
            <div className="absolute bottom-0 inset-x-0 h-1 bg-white/25"><div className="h-full bg-accent" style={{ width: `${it.resumePct}%` }} /></div>
          )}
        </div>
        <div className="mt-1.5 text-[12px] font-semibold truncate">{it.title}</div>
        <div className="text-[10px] text-white/35 truncate">
          {[it.year, it.rating ? `★ ${it.rating.toFixed(1)}` : null].filter(Boolean).join(' · ')}
        </div>
      </button>
    );
  };

  const tile = (it: FlixItem) => (
    <button key={it.key} onClick={() => p.onPlayItem(it)}
      onContextMenu={(e) => ctx.open(e, itemActions(it))}
      {...makeLongPress((x, y) => ctx.open({ clientX: x, clientY: y }, itemActions(it)))}
      className="press text-left flex gap-3 items-center w-full">
      <div className="relative w-14 shrink-0 rounded-lg overflow-hidden" style={{ aspectRatio: '2/3' }}>
        <Poster src={it.poster} label={it.title} className="absolute inset-0 w-full h-full" />
        {it.resumePct != null && it.resumePct > 0 && (
          <div className="absolute bottom-0 inset-x-0 h-1 bg-white/25"><div className="h-full bg-accent" style={{ width: `${it.resumePct}%` }} /></div>
        )}
      </div>
      <div className="min-w-0 flex-1">
        <div className="text-[14px] font-semibold truncate">{it.title}</div>
        <div className="text-[11px] text-white/35 truncate">
          {[it.year, it.rating ? `★ ${it.rating.toFixed(1)}` : null, it.folder ? `${it.folder.seasonCount} seasons · ${it.folder.episodeCount}E` : it.quality].filter(Boolean).join(' · ')}
        </div>
      </div>
      <IconChevron className="w-4 h-4 text-white/25" />
    </button>
  );

  return (
    <div className="relative flex">
      {ctx.node}

      {/* sidebar (md+) */}
      <aside className="shrink-0 scroll-y sticky top-0 self-start w-[176px] max-h-[calc(100dvh-110px)] pb-4 pl-2 pr-1 hidden md:block">
        {allCategories.map((c) => (
          <button key={c.name} onClick={() => { setCat(c.name); setVisible(60); }}
            className={`press w-full flex items-center gap-2 px-2.5 py-2 rounded-xl text-left ${cat === c.name ? 'bg-white/12' : ''}`}>
            <span className={`truncate text-[13px] ${cat === c.name ? 'font-bold' : 'text-white/80'}`}>{c.name}</span>
            <span className="text-[10px] text-white/30 ml-auto">{c.count}</span>
          </button>
        ))}
      </aside>

      <div className="flex-1 min-w-0">
        {/* mobile category chips */}
        <div className="scroll-x flex gap-2 px-3 py-2 md:hidden">
          {allCategories.map((c) => (
            <Chip key={c.name} label={c.name} active={cat === c.name} onClick={() => { setCat(c.name); setVisible(60); }} />
          ))}
        </div>

        {/* toolbar */}
        <div className="px-3 pb-2 flex gap-2 items-center">
          <div className="flex-1 flex items-center bg-white/8 rounded-xl px-3">
            <IconSearch className="w-4 h-4 text-white/35" />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={`Search ${p.kind === 'movie' ? 'films' : 'series'}`}
              className="flex-1 bg-transparent py-2 text-[15px] outline-none placeholder:text-white/30" />
            {q && <button onClick={() => setQ('')} className="press p-1 text-white/50"><IconClose className="w-3.5 h-3.5" /></button>}
          </div>
          <select value={sort} onChange={(e) => setSort(e.target.value as SortKey)}
            className="bg-white/8 text-white rounded-xl px-2 py-2.5 text-[13px] outline-none max-w-[140px] appearance-none">
            <option value="name">Name</option>
            <option value="recent">Recently Played</option>
            <option value="added">Date Added</option>
            <option value="rating">Rating</option>
            <option value="year">Year</option>
          </select>
          <button onClick={() => setDir((d) => (d === 'asc' ? 'desc' : 'asc'))}
            className="press bg-white/8 rounded-xl px-3 py-2.5 text-[13px] font-semibold">{dir === 'asc' ? '↑' : '↓'}</button>
          <button onClick={() => setHideWatched((v) => !v)}
            className={`press rounded-xl px-3 py-2.5 text-[13px] font-semibold ${hideWatched ? 'bg-accent text-black' : 'bg-white/8'}`} title="Hide watched">
            ◍
          </button>
        </div>

        {list.length === 0 ? (
          <div className="py-16 text-center text-white/40 text-[14px]">Nothing here{q ? ' for that search' : ''}.</div>
        ) : p.settings[p.kind === 'movie' ? 'movieView' : 'seriesView'] === 'tiles' ? (
          <div className="mx-3 ios-card divide-y divide-white/5">
            {list.slice(0, visible).map(tile)}
          </div>
        ) : (
          <div className="grid grid-cols-3 gap-3 px-3 pb-2 md:grid-cols-4 lg:grid-cols-6">
            {list.slice(0, visible).map(card)}
          </div>
        )}

        {list.length > visible && (
          <div className="py-3 text-center">
            <button onClick={() => setVisible((v) => v + 120)} className="press text-[14px] text-link">
              Show more ({(list.length - visible).toLocaleString()} left)
            </button>
          </div>
        )}
        <div className="h-6" />
      </div>
    </div>
  );
}

/* Splits "Parent | Child", "Parent - Child", "Parent: Child" into the parent
   category name + the raw group title. */
export function parentName(group: string): string {
  const m = group.split(/\s*[|:\-]\s*/);
  return (m[0] || group).trim() || group;
}

export function buildFlixCategories(groups: string[], hidden: string[]): { name: string; groups: string[]; count: number }[] {
  const map = new Map<string, string[]>();
  for (const g of groups) {
    if (hidden.includes(g)) continue;
    const parent = parentName(g);
    if (!map.has(parent)) map.set(parent, []);
    map.get(parent)!.push(g);
  }
  return Array.from(map.entries())
    .map(([name, gs]) => ({ name, groups: gs, count: gs.length }))
    .sort((a, b) => b.groups.length - a.groups.length);
}

function Chip({ label, active, onClick }: { label: string; active?: boolean; onClick?: () => void }) {
  return (
    <button onClick={onClick}
      className={`press px-3.5 py-1.5 rounded-full text-[13px] whitespace-nowrap ${active ? 'bg-accent text-black font-semibold' : 'bg-white/10 text-white/85'}`}>
      {label}
    </button>
  );
}

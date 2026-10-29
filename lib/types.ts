export type Channel = {
  id: string;
  name: string;
  url: string;
  logo?: string;
  group?: string;
  groups?: string[];
  tvgId?: string;
  tvgName?: string;
  channelNumber?: number;
  contentType?: 'LIVE' | 'MOVIE' | 'SERIES';
  headers?: Record<string, string>;
  catchupType?: string | null;
  catchupDays?: number | null;
  catchupSource?: string | null;
  qualityTag?: string | null;
  addedAt?: number; /* import order — powers "Recently added" */
};

export type Program = {
  start: string;
  stop: string;
  title: string;
  desc?: string;
};

export type Playlist = {
  name: string;
  channels: Channel[];
  epgUrl?: string;
  importedAt: number;
};

/* Multiple named playlists live side by side; `playlists` is the idb record,
   `activePlaylistId` points at the one in use. */
export type PlaylistEntry = {
  id: string;
  name: string;
  channelCount: number;
  epgUrl?: string;
  importedAt: number;
};

export type ImportProgress = {
  phase: 'download' | 'parse' | 'save';
  lines?: number; total?: number;           // parse phase
  received?: number; contentTotal?: number; // download phase (bytes)
};

export type SeriesEpisode = {
  channel: Channel;
  seasonNumber: number;
  episodeNumber: number;
  episodeTitle: string;
};

export type SeriesFolder = {
  name: string;
  posterUrl?: string;
  groupTitles: string[];
  episodes: SeriesEpisode[];
  seasonCount: number;
  episodeCount: number;
  tmdbPosterUrl?: string;
  tmdbBackdropUrl?: string;
  tmdbLogoUrl?: string;
};

/* Live TV sidebar folder. Country folders are derived from group titles via
   lib/folders.ts; custom folders are user-created and can nest. */
export type LiveFolder = {
  id: string;
  name: string;
  kind: 'country' | 'custom' | 'special';
  parent?: string;          /* nested inside another folder */
  groupTitles: string[];    /* raw playlist groups folded into this folder */
};

export type SortMode = 'name' | 'recent' | 'added' | 'favourites' | 'watched' | 'custom';
export type SortDir = 'asc' | 'desc';
export type ChannelDensity = 'large' | 'small' | 'list';

export type SortPref = { mode: SortMode; dir: SortDir };

/* Global (not per-profile) app settings — persisted under the `settings` key. */
export type AppSettings = {
  /* EPG */
  guideOffsetHours: number;          /* -12..12, feeds that run early/late */
  epgAutoRefresh: 'manual' | '1h' | '2h' | '4h' | '6h' | '12h';
  /* Playlists */
  playlistAutoRefresh: 'manual' | '15m' | '30m' | '1h' | '2h';
  /* Live TV */
  liveDensity: ChannelDensity;
  startFolder: string;               /* folder id to open on launch ('' = first) */
  defaultSort: SortPref;
  /* Flix */
  movieView: 'grid' | 'tiles' | 'list';
  seriesView: 'grid' | 'tiles' | 'list';
  hideWatchedDefault: boolean;
  /* Playback */
  resumeLastChannel: boolean;
  autoPlayNext: boolean;
  screensaverMinutes: 0 | 5 | 10 | 15 | 30; /* 0 = off */
  /* Subtitles */
  subSize: 's' | 'm' | 'l';
  subColor: string;                  /* css colour */
  subBg: string;                     /* css colour or 'transparent' */
  /* Downloads */
  wifiOnly: boolean;
  /* Search */
  searchScope: 'all' | 'live' | 'titles';
};

export const DEFAULT_SETTINGS: AppSettings = {
  guideOffsetHours: 0,
  epgAutoRefresh: 'manual',
  playlistAutoRefresh: 'manual',
  liveDensity: 'large',
  startFolder: '',
  defaultSort: { mode: 'name', dir: 'asc' },
  movieView: 'grid',
  seriesView: 'grid',
  hideWatchedDefault: false,
  resumeLastChannel: false,
  autoPlayNext: true,
  screensaverMinutes: 10,
  subSize: 'm',
  subColor: '#ffffff',
  subBg: 'rgba(8, 8, 10, 0.62)',
  wifiOnly: false,
  searchScope: 'all',
};

export type Profile = {
  id: string;
  name: string;
  pin?: string;
  kids?: boolean;                    /* badge only */
  guest?: boolean;
  favorites: string[];
  recents: string[];
  hiddenGroups: string[];
  hiddenChannels: string[];
  renamed: Record<string, string>;
  channelOrder: string[];
  groupOrder: string[];
  folderOrder: string[];
  folderRenames: Record<string, string>;
  customFolders: LiveFolder[];       /* user-created (kind 'custom') */
  folderGroupMoves: Record<string, string>; /* group title → folder id */
  sortPrefs: Record<string, SortPref>;      /* per folder id */
  continueWatching: { channelId: string; time: number; duration?: number; updatedAt?: number }[];
  watchHistory: string[];
  watchlist: string[];
  playCounts: Record<string, number>;
  watched: string[];                 /* explicitly or fully watched titles */
  audioOffsets: Record<string, number>; /* ms, per channel (reserved) */
};

export const DEFAULT_PROFILE: Profile = {
  id: 'default', name: 'Default', favorites: [], recents: [], hiddenGroups: [], hiddenChannels: [],
  renamed: {}, channelOrder: [], groupOrder: [], folderOrder: [], folderRenames: {}, customFolders: [],
  folderGroupMoves: {}, sortPrefs: {},
  continueWatching: [], watchHistory: [], watchlist: [], playCounts: {}, watched: [], audioOffsets: {},
};

export const GUEST_PROFILE: Profile = {
  ...DEFAULT_PROFILE,
  id: 'guest', name: 'Guest', guest: true, kids: true,
};

export type DownloadState = 'queued' | 'downloading' | 'failed' | 'done';

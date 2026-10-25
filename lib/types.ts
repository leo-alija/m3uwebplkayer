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

export type Profile = {
  id: string;
  name: string;
  pin?: string;
  favorites: string[];
  recents: string[];
  hiddenGroups: string[];
  renamed: Record<string, string>;
  channelOrder: string[];
  groupOrder: string[];
  continueWatching: { channelId: string; time: number; duration?: number; updatedAt?: number }[];
  watchHistory: string[];
  watchlist: string[];
  playCounts: Record<string, number>;
};

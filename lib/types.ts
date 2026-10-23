export type Channel = {
  id: string;
  name: string;
  url: string;
  logo?: string;
  group?: string;
  tvgId?: string;
  tvgName?: string;
  catchup?: string;
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

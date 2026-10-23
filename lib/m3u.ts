import { Channel } from './types';

export function parseM3U(text: string): { channels: Channel[]; epgUrl?: string } {
  const lines = text.split(/\r?\n/);
  const channels: Channel[] = [];
  let epgUrl: string | undefined;
  const first = lines.find((l) => l.trim().startsWith('#EXTM3U'));
  if (first) {
    const m = first.match(/x-tvg-url="([^"]+)"/i) || first.match(/url-tvg="([^"]+)"/i);
    if (m) epgUrl = m[1];
  }
  let current: Partial<Channel> | null = null;
  let idx = 0;
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    if (line.startsWith('#EXTINF')) {
      current = { id: '', name: '' };
      const attrs = line.match(/([\w-]+)="([^"]*)"/g) || [];
      for (const a of attrs) {
        const m2 = a.match(/([\w-]+)="([^"]*)"/);
        if (!m2) continue;
        const key = m2[1].toLowerCase();
        const val = m2[2];
        if (key === 'tvg-id') current.tvgId = val;
        if (key === 'tvg-name') current.tvgName = val;
        if (key === 'tvg-logo') current.logo = val;
        if (key === 'group-title') current.group = val;
      }
      const comma = line.lastIndexOf(',');
      const title = comma >= 0 ? line.slice(comma + 1).trim() : '';
      if (title) current.name = title;
      if (!current.name && current.tvgName) current.name = current.tvgName;
      continue;
    }
    if (line.startsWith('#')) continue;
    if (current) {
      current.url = line;
      current.id = `${idx}-${current.name || 'ch'}`;
      channels.push(current as Channel);
      current = null;
      idx++;
    }
  }
  return { channels, epgUrl };
}

export function buildXtreamM3uUrl(host: string, user: string, pass: string, output = 'ts') {
  const h = host.replace(/\/+$/, '');
  return `${h}/get.php?username=${encodeURIComponent(user)}&password=${encodeURIComponent(pass)}&type=m3u_plus&output=${output}`;
}

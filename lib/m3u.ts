import { Channel } from './types';

const VIDEO_EXTENSIONS = ['.mp4', '.mkv', '.avi', '.m4v', '.mov', '.webm'];
const EPISODE_PATTERN = /\bs\d{1,2}\s?e\d{1,3}\b|\b\d{1,2}x\d{1,3}\b/i;

const ATTR_RE = /([A-Za-z0-9-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s",]+))/g;

function parseAttributes(line: string): Record<string, string> {
  const out: Record<string, string> = {};
  let m;
  const re = new RegExp(ATTR_RE.source, 'g');
  while ((m = re.exec(line))) {
    const val = m[2] !== undefined && m[2] !== '' ? m[2] : (m[3] !== undefined && m[3] !== '' ? m[3] : (m[4] || ''));
    out[m[1].toLowerCase()] = val;
  }
  return out;
}

function parseDisplayName(line: string): string | null {
  let inDQ = false;
  let inSQ = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') { if (!inSQ) inDQ = !inDQ; }
    else if (ch === "'") {
      const opens = i > 0 && line[i - 1] === '=';
      if (opens && !inDQ && !inSQ) inSQ = true;
      else if (inSQ) inSQ = false;
    } else if (ch === ',') {
      if (!inDQ && !inSQ) {
        const v = line.substring(i + 1).trim();
        return v === '' ? null : v;
      }
    }
  }
  return null;
}

function stripBom(text: string): string {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

function parseJsonHeaders(raw: string): Record<string, string> {
  const body = raw.trim().replace(/^\{/, '').replace(/\}$/, '');
  if (!body.trim()) return {};
  const out: Record<string, string> = {};
  const re = /"([^"]+)"\s*:\s*"([^"]*)"/g;
  let m;
  while ((m = re.exec(body))) {
    if (m[1].trim() && m[2].trim()) out[m[1].trim()] = m[2].trim();
  }
  return out;
}

function normaliseCatchupType(value: string): string | null {
  const v = value.trim().toLowerCase();
  if (['default', 'append', 'shift', 'flussonic', 'xc'].includes(v)) return v;
  if (['fs', 'flussonic-hls', 'flussonic-ts'].includes(v)) return 'flussonic';
  if (v === 'timeshift') return 'shift';
  return null;
}

function detectContentType(url: string): Channel['contentType'] {
  const lower = url.toLowerCase();
  if (lower.includes('/series/') || lower.includes('/episode/')) return 'SERIES';
  if (lower.includes('/movie/') || lower.includes('/movies/') || lower.includes('/vod/')) return 'MOVIE';
  const path = lower.split('?')[0];
  const hasVideoExt = VIDEO_EXTENSIONS.some((e) => path.endsWith(e));
  if (!hasVideoExt) return 'LIVE';
  return EPISODE_PATTERN.test(path) ? 'SERIES' : 'MOVIE';
}

function languageRank(group: string, name: string): number {
  const g = group.toLowerCase();
  if (g.startsWith('u.k') || g.startsWith('uk ') || g.startsWith('uk-')) return 0;
  if (g.startsWith('u.s') || g.startsWith('us ') || g.startsWith('usa')) return 1;
  if (g.startsWith('canada') || g.startsWith('australia')) return 2;
  if (g.includes('english') || name.toLowerCase().includes('[en]')) return 3;
  if (g.startsWith('4k')) return 4;
  return 5;
}

function extractQualityTag(name: string): string | null {
  const m = name.match(/\b(4K|UHD|FHD|HD|SD|8K)\b/i);
  return m ? m[1].toUpperCase() : null;
}

type Pending = {
  name: string;
  logo?: string;
  group: string;
  url: string;
  tvgId?: string;
  explicitNumber?: number;
  headers: Record<string, string>;
  contentType: Channel['contentType'];
  catchupType?: string | null;
  catchupDays?: number | null;
  catchupSource?: string | null;
  rank: number;
};

export function parseM3U(text: string): { channels: Channel[]; epgUrl?: string } {
  text = stripBom(text);
  const lines = text.split(/\r?\n/);
  const entries: Pending[] = [];
  let epgUrl: string | undefined;
  let headerCatchup: Record<string, string> = {};

  let attributes: Record<string, string> = {};
  let displayName: string | null = null;
  let extGroup: string | null = null;
  let headers: Record<string, string> = {};
  let expectingUrl = false;

  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    if (line.toLowerCase().startsWith('#extm3u')) {
      const h = parseAttributes(line);
      epgUrl = h['x-tvg-url'] || h['tvg-url'] || h['url-tvg'];
      headerCatchup = h;
      continue;
    }
    if (line.toLowerCase().startsWith('#extinf:')) {
      attributes = parseAttributes(line);
      displayName = parseDisplayName(line);
      headers = {};
      expectingUrl = true;
      continue;
    }
    if (line.toLowerCase().startsWith('#extgrp:')) {
      extGroup = line.substring(line.indexOf(':') + 1).trim() || null;
      continue;
    }
    if (line.toLowerCase().startsWith('#extvlcopt:')) {
      const option = line.substring(line.indexOf(':') + 1);
      const key = option.substring(0, option.indexOf('=') >= 0 ? option.indexOf('=') : option.length).trim().toLowerCase();
      const value = option.includes('=') ? option.substring(option.indexOf('=') + 1).trim() : '';
      if (value) {
        if (key === 'http-user-agent') headers['User-Agent'] = value;
        if (key === 'http-referrer' || key === 'http-referer') headers['Referer'] = value;
        if (key === 'http-origin') headers['Origin'] = value;
      }
      continue;
    }
    if (line.toLowerCase().startsWith('#exthttp:')) {
      Object.assign(headers, parseJsonHeaders(line.substring(line.indexOf(':') + 1)));
      continue;
    }
    if (line.startsWith('#')) continue;

    if (expectingUrl) {
      const name = (attributes['tvg-name'] && attributes['tvg-name'].trim()) || displayName || `Channel ${entries.length + 1}`;
      const group = (attributes['group-title'] && attributes['group-title'].trim()) || extGroup || 'Uncategorized';
      const catchupType = normaliseCatchupType((attributes['catchup'] || headerCatchup['catchup'] || '').trim().toLowerCase()) ;
      const catchupDaysRaw = attributes['catchup-days'] || attributes['tvg-rec'] || headerCatchup['catchup-days'];
      const catchupDays = catchupDaysRaw ? parseInt(catchupDaysRaw, 10) : null;
      const catchupSource = (attributes['catchup-source'] || headerCatchup['catchup-source'] || '').trim() || null;

      entries.push({
        name,
        logo: attributes['tvg-logo']?.trim() || undefined,
        group,
        url: line,
        tvgId: attributes['tvg-id']?.trim() || undefined,
        explicitNumber: (() => {
          const v = (attributes['tvg-chno'] || attributes['channel-number'] || '').trim();
          const n = v ? parseInt(v, 10) : NaN;
          return Number.isFinite(n) && n > 0 ? n : undefined;
        })(),
        headers: { ...headers },
        contentType: detectContentType(line),
        catchupType,
        catchupDays: Number.isFinite(catchupDays as any) ? catchupDays : null,
        catchupSource,
        rank: languageRank(group, name),
      });
      attributes = {};
      displayName = null;
      extGroup = null;
      headers = {};
      expectingUrl = false;
    }
  }

  if (entries.length === 0) return { channels: [], epgUrl };

  const ordered = [...entries].sort((a, b) => a.rank - b.rank);
  const highestExplicit = Math.max(0, ...entries.map((e) => e.explicitNumber || 0));
  let nextImplicit = highestExplicit + 1;

  const channels: Channel[] = ordered.map((e, index) => ({
    id: `ch_${index + 1}`,
    name: e.name,
    url: e.url,
    logo: e.logo,
    group: e.group,
    tvgId: e.tvgId,
    tvgName: attributes['tvg-name'] || undefined,
    channelNumber: e.explicitNumber != null ? e.explicitNumber : nextImplicit++,
    contentType: e.contentType,
    headers: Object.keys(e.headers).length ? e.headers : undefined,
    catchupType: e.catchupType,
    catchupDays: e.catchupDays,
    catchupSource: e.catchupSource,
    qualityTag: extractQualityTag(e.name),
  }));

  return { channels, epgUrl };
}

export function buildXtreamM3uUrl(host: string, user: string, pass: string, output = 'ts') {
  const h = host.replace(/\/+$/, '');
  return `${h}/get.php?username=${encodeURIComponent(user)}&password=${encodeURIComponent(pass)}&type=m3u_plus&output=${output}`;
}

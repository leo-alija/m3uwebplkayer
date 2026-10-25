import type { Channel } from './types';

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
  groups: string[];
  url: string;
  tvgId?: string;
  tvgName?: string;
  explicitNumber?: number;
  headers: Record<string, string>;
  contentType: Channel['contentType'];
  catchupType?: string | null;
  catchupDays?: number | null;
  catchupSource?: string | null;
  rank: number;
};

/* Incremental M3U parse. The worker (and the main-thread fallback) feed lines
   in chunks to report import progress without stalling the UI; parseM3U is the
   one-shot wrapper with identical output. */
export class M3UScanner {
  private entries: Pending[] = [];
  private epgUrl: string | undefined;
  private headerCatchup: Record<string, string> = {};
  private attributes: Record<string, string> = {};
  private displayName: string | null = null;
  private extGroup: string | null = null;
  private headers: Record<string, string> = {};
  private expectingUrl = false;
  private firstLine = true;

  pushLine(raw: string) {
    if (this.firstLine) {
      raw = stripBom(raw);
      this.firstLine = false;
    }
    const line = raw.trim();
    if (!line) return;
    if (line.toLowerCase().startsWith('#extm3u')) {
      const h = parseAttributes(line);
      this.epgUrl = h['x-tvg-url'] || h['tvg-url'] || h['url-tvg'];
      this.headerCatchup = h;
      return;
    }
    if (line.toLowerCase().startsWith('#extinf:')) {
      this.attributes = parseAttributes(line);
      this.displayName = parseDisplayName(line);
      this.headers = {};
      this.expectingUrl = true;
      return;
    }
    if (line.toLowerCase().startsWith('#extgrp:')) {
      this.extGroup = line.substring(line.indexOf(':') + 1).trim() || null;
      return;
    }
    if (line.toLowerCase().startsWith('#extvlcopt:')) {
      const option = line.substring(line.indexOf(':') + 1);
      const key = option.substring(0, option.indexOf('=') >= 0 ? option.indexOf('=') : option.length).trim().toLowerCase();
      const value = option.includes('=') ? option.substring(option.indexOf('=') + 1).trim() : '';
      if (value) {
        if (key === 'http-user-agent') this.headers['User-Agent'] = value;
        if (key === 'http-referrer' || key === 'http-referer') this.headers['Referer'] = value;
        if (key === 'http-origin') this.headers['Origin'] = value;
      }
      return;
    }
    if (line.toLowerCase().startsWith('#exthttp:')) {
      Object.assign(this.headers, parseJsonHeaders(line.substring(line.indexOf(':') + 1)));
      return;
    }
    if (line.startsWith('#')) return;

    if (!this.expectingUrl) return;
    const attributes = this.attributes;
    const displayName = this.displayName;
    const extGroup = this.extGroup;
    const headers = this.headers;
    const name = (attributes['tvg-name'] && attributes['tvg-name'].trim()) || displayName || `Channel ${this.entries.length + 1}`;
    const rawGroup = (attributes['group-title'] && attributes['group-title'].trim()) || extGroup || 'Uncategorized';
    const groups = rawGroup.split(/[;|]+/).map((g) => g.trim()).filter(Boolean).length
      ? rawGroup.split(/[;|]+/).map((g) => g.trim()).filter(Boolean)
      : ['Uncategorized'];
    const group = groups[0];
    const catchupType = normaliseCatchupType((attributes['catchup'] || this.headerCatchup['catchup'] || '').trim().toLowerCase()) ;
    const catchupDaysRaw = attributes['catchup-days'] || attributes['tvg-rec'] || this.headerCatchup['catchup-days'];
    const catchupDays = catchupDaysRaw ? parseInt(catchupDaysRaw, 10) : null;
    const catchupSource = (attributes['catchup-source'] || this.headerCatchup['catchup-source'] || '').trim() || null;

    this.entries.push({
      name,
      logo: attributes['tvg-logo']?.trim() || undefined,
      group,
      groups,
      url: line,
      tvgId: attributes['tvg-id']?.trim() || undefined,
      tvgName: attributes['tvg-name']?.trim() || undefined,
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
    this.attributes = {};
    this.displayName = null;
    this.extGroup = null;
    this.headers = {};
    this.expectingUrl = false;
  }

  finish(): { channels: Channel[]; epgUrl?: string } {
    const entries = this.entries;
    if (entries.length === 0) return { channels: [], epgUrl: this.epgUrl };

    const ordered = [...entries].sort((a, b) => a.rank - b.rank);
    // Math.max(...arr) overflows the call stack on large playlists (URL imports can be 100k+ entries)
    let highestExplicit = 0;
    for (const e of entries) {
      if (e.explicitNumber != null && e.explicitNumber > highestExplicit) highestExplicit = e.explicitNumber;
    }
    let nextImplicit = highestExplicit + 1;

    const channels: Channel[] = ordered.map((e, index) => ({
      id: `ch_${index + 1}`,
      name: e.name,
      url: e.url,
      logo: e.logo,
      group: e.group,
      groups: e.groups,
      tvgId: e.tvgId,
      tvgName: e.tvgName,
      channelNumber: e.explicitNumber != null ? e.explicitNumber : nextImplicit++,
      contentType: e.contentType,
      headers: Object.keys(e.headers).length ? e.headers : undefined,
      catchupType: e.catchupType,
      catchupDays: e.catchupDays,
      catchupSource: e.catchupSource,
      qualityTag: extractQualityTag(e.name),
    }));

    return { channels, epgUrl: this.epgUrl };
  }
}

export function parseM3U(text: string): { channels: Channel[]; epgUrl?: string } {
  const scanner = new M3UScanner();
  for (const raw of text.split(/\r?\n/)) scanner.pushLine(raw);
  return scanner.finish();
}

export function buildXtreamM3uUrl(host: string, user: string, pass: string, output = 'ts') {
  const h = host.replace(/\/+$/, '');
  return `${h}/get.php?username=${encodeURIComponent(user)}&password=${encodeURIComponent(pass)}&type=m3u_plus&output=${output}`;
}

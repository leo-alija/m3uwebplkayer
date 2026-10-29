import type { Program } from './types';

/* Guide retention window: programmes older than 12h or further than 8 days
   out are dropped at parse time so a million-programme feed can't exhaust
   memory on a phone. */
export const PAST_HOURS = 12;
export const FUTURE_DAYS = 8;

function decodeEntities(s: string): string {
  return s
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCharCode(parseInt(n, 16)))
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'").replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&');
}

export function parseXmltvDateMs(s: string): number {
  const clean = s.trim().split(/\s+/)[0];
  const m = clean.match(/^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})?/);
  if (!m) {
    const d = new Date(s).getTime();
    return Number.isFinite(d) ? d : NaN;
  }
  const [, y, mo, d, h, mi, se] = m;
  let ms = Date.UTC(+y, +mo - 1, +d, +h, +mi, +(se || 0));
  const tz = s.match(/([+-])(\d{2}):?(\d{2})$/);
  if (tz) {
    const sign = tz[1] === '+' ? 1 : -1;
    ms -= sign * ((+tz[2] * 60 + +tz[3]) * 60_000);
  }
  return ms;
}

/* Applies the user's guide offset (feeds that start programmes an hour
   early/late). offsetMinutes shifts the effective clock: +60 makes a feed
   that is one hour late line up. */
export function progWindow(prog: Program, offsetMinutes = 0): { start: number; stop: number } {
  return {
    start: parseXmltvDateMs(prog.start) + offsetMinutes * 60_000,
    stop: parseXmltvDateMs(prog.stop) + offsetMinutes * 60_000,
  };
}

function inWindow(startMs: number, stopMs: number, now: number): boolean {
  return stopMs > now - PAST_HOURS * 3_600_000 && startMs < now + FUTURE_DAYS * 86_400_000;
}

/* Incremental XMLTV scanner: feed it text chunks (streamed download), it
   yields parsed programmes batch by batch. Only complete <programme> blocks
   are consumed; a trailing partial block stays buffered for the next push. */
export class XmltvScanner {
  private buf = '';
  private done = false;

  constructor(private windowNow: number = Date.now()) {}

  /* Returns the programmes completed by this chunk (already windowed). */
  push(chunk: string): Program[] {
    if (this.done) return [];
    this.buf += chunk;
    /* cut at the last complete programme; keep the tail for the next push */
    const end = this.buf.toLowerCase().lastIndexOf('</programme>');
    if (end === -1) return [];
    const consumable = this.buf.slice(0, end + '</programme>'.length);
    this.buf = this.buf.slice(end + '</programme>'.length);
    const out: Program[] = [];
    const re = /<programme\b([^>]*)>([\s\S]*?)<\/programme>/gi;
    let m;
    while ((m = re.exec(consumable))) {
      const p = parseProgrammeBlock(m[1], m[2], this.windowNow);
      if (p) out.push(p);
    }
    return out;
  }

  /* Flush after the stream ends (handles a feed with no closing tag noise). */
  finish(): Program[] {
    if (this.done) return [];
    this.done = true;
    const tail = this.buf;
    this.buf = '';
    const out: Program[] = [];
    const re = /<programme\b([^>]*)>([\s\S]*?)<\/programme>/gi;
    let m;
    while ((m = re.exec(tail))) {
      const p = parseProgrammeBlock(m[1], m[2], this.windowNow);
      if (p) out.push(p);
    }
    return out;
  }
}

function parseProgrammeBlock(head: string, body: string, now: number): (Program & { channel?: string }) | null {
  const chA = head.match(/channel="([^"]*)"/i);
  const stA = head.match(/start="([^"]*)"/i);
  const spA = head.match(/stop="([^"]*)"/i);
  if (!chA || !stA || !spA) return null;
  const startMs = parseXmltvDateMs(stA[1]);
  const stopMs = parseXmltvDateMs(spA[1]);
  if (!Number.isFinite(startMs) || !Number.isFinite(stopMs)) return null;
  if (!inWindow(startMs, stopMs, now)) return null;
  const titleM = body.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  const descM = body.match(/<desc[^>]*>([\s\S]*?)<\/desc>/i);
  return {
    channel: decodeEntities(chA[1].trim()),
    start: stA[1],
    stop: spA[1],
    title: titleM ? decodeEntities(titleM[1].replace(/<[^>]+>/g, '')).trim() : 'Untitled',
    desc: descM ? decodeEntities(descM[1].replace(/<[^>]+>/g, '')).trim() : undefined,
  };
}

export type XmltvResult = { epg: Record<string, Program[]>; programmeCount: number; channelCount: number };

function commit(out: Record<string, Program[]>, progs: (Program & { channel?: string })[]): number {
  let programmeCount = 0;
  for (const p of progs) {
    if (!p.channel) continue;
    programmeCount++;
    if (!out[p.channel]) out[p.channel] = [];
    out[p.channel].push({ start: p.start, stop: p.stop, title: p.title, desc: p.desc });
  }
  return programmeCount;
}

/* One-shot parse of a full XMLTV document (small guides, tests). */
export function parseXMLTV(text: string, now: number = Date.now()): Record<string, Program[]> {
  const scanner = new XmltvScanner(now);
  const out: Record<string, Program[]> = {};
  const CHUNK = 1 << 20;
  for (let i = 0; i < text.length; i += CHUNK) {
    commit(out, scanner.push(text.slice(i, i + CHUNK)));
  }
  commit(out, scanner.finish());
  return out;
}

/* Streamed parse: consumes a ReadableStream of the (possibly gzipped,
   auto-decompressed) guide in batches and only resolves once everything is
   parsed — the caller keeps the previous guide until this succeeds. */
export async function parseXMLTVStream(
  body: ReadableStream<Uint8Array>,
  onProgress?: (receivedBytes: number) => void,
  now: number = Date.now(),
): Promise<XmltvResult> {
  const scanner = new XmltvScanner(now);
  const out: Record<string, Program[]> = {};
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let received = 0;
  let programmeCount = 0;
  const channelSet = new Set<string>();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    received += value.byteLength;
    onProgress?.(received);
    const text = decoder.decode(value, { stream: true });
    const progs = scanner.push(text) as (Program & { channel?: string })[];
    for (const p of progs) if (p.channel) channelSet.add(p.channel);
    programmeCount += commit(out, progs);
  }
  const tail = scanner.finish() as (Program & { channel?: string })[];
  for (const p of tail) if (p.channel) channelSet.add(p.channel);
  programmeCount += commit(out, tail);
  return { epg: out, programmeCount, channelCount: channelSet.size };
}

export function nowProgram(prog: Program[], offsetMinutes = 0): Program | undefined {
  const now = Date.now();
  return prog.find((p) => {
    const { start, stop } = progWindow(p, offsetMinutes);
    return start <= now && now < stop;
  });
}

/* Programmes overlapping the 2-hour page starting at `atMs` (Earlier/Later paging). */
export function programmesAt(prog: Program[], atMs: number, offsetMinutes = 0): Program[] {
  return prog
    .filter((p) => {
      const { start, stop } = progWindow(p, offsetMinutes);
      return stop > atMs && start < atMs + 2 * 3600_000;
    })
    .sort((a, b) => parseXmltvDateMs(a.start) - parseXmltvDateMs(b.start));
}

/* "YYYYMMDDHHMMSS [+-]ZZZZ" → Date (offset-aware) */
export function parseXmltvDate(s: string): Date {
  return new Date(parseXmltvDateMs(s));
}

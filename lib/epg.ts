import type { Program } from './types';

function decodeEntities(s: string): string {
  return s
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCharCode(parseInt(n, 16)))
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'").replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&');
}

export function parseXMLTV(text: string): Record<string, Program[]> {
  const out: Record<string, Program[]> = {};
  const re = /<programme\b([^>]*)>([\s\S]*?)<\/programme>/gi;
  let m;
  while ((m = re.exec(text))) {
    const head = m[1];
    const body = m[2];
    const chA = head.match(/channel="([^"]*)"/i);
    const stA = head.match(/start="([^"]*)"/i);
    const spA = head.match(/stop="([^"]*)"/i);
    if (!chA || !stA || !spA) continue;
    const ch = decodeEntities(chA[1].trim());
    const start = stA[1];
    const stop = spA[1];
    const titleM = body.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
    const descM = body.match(/<desc[^>]*>([\s\S]*?)<\/desc>/i);
    const prog: Program = {
      start,
      stop,
      title: titleM ? decodeEntities(titleM[1].replace(/<[^>]+>/g, '')).trim() : 'Untitled',
      desc: descM ? decodeEntities(descM[1].replace(/<[^>]+>/g, '')).trim() : undefined,
    };
    if (!out[ch]) out[ch] = [];
    out[ch].push(prog);
  }
  return out;
}

export function nowProgram(prog: Program[]): Program | undefined {
  const now = Date.now();
  return prog.find((p) => {
    const s = parseXmltvDate(p.start).getTime();
    const e = parseXmltvDate(p.stop).getTime();
    return s <= now && now < e;
  });
}

/* "YYYYMMDDHHMMSS [+-]ZZZZ" */
export function parseXmltvDate(s: string): Date {
  const clean = s.trim().split(/\s+/)[0];
  const m = clean.match(/^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})?/);
  if (!m) return new Date(s);
  const [, y, mo, d, h, mi, se] = m;
  const dt = new Date(Date.UTC(+y, +mo - 1, +d, +h, +mi, +(se || 0)));
  const tz = s.match(/([+-])(\d{2}):?(\d{2})$/);
  if (tz) {
    const sign = tz[1] === '+' ? 1 : -1;
    const hh = +tz[2];
    const mm = +tz[3];
    dt.setMinutes(dt.getMinutes() - sign * (hh * 60 + mm));
  }
  return dt;
}

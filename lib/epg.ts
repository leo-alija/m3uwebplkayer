import { Program } from './types';

export function parseXMLTV(text: string): Record<string, Program[]> {
  const out: Record<string, Program[]> = {};
  const re = /<programme[^>]*channel="([^"]+)"[^>]*start="([^"]+)"[^>]*stop="([^"]+)"[^>]*>([\s\S]*?)<\/programme>/gi;
  let m;
  while ((m = re.exec(text))) {
    const ch = m[1];
    const start = m[2];
    const stop = m[3];
    const body = m[4];
    const titleM = body.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
    const descM = body.match(/<desc[^>]*>([\s\S]*?)<\/desc>/i);
    const prog: Program = {
      start,
      stop,
      title: titleM ? titleM[1].replace(/<[^>]+>/g, '').trim() : 'Untitled',
      desc: descM ? descM[1].replace(/<[^>]+>/g, '').trim() : undefined,
    };
    if (!out[ch]) out[ch] = [];
    out[ch].push(prog);
  }
  return out;
}

export function nowProgram(prog: Program[]): Program | undefined {
  const now = new Date();
  return prog.find((p) => {
    const s = parseXmltvDate(p.start);
    const e = parseXmltvDate(p.stop);
    return s <= now && now < e;
  });
}

export function parseXmltvDate(s: string): Date {
  // format YYYYMMDDHHMMSS +0000
  const m = s.match(/^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})/);
  if (!m) return new Date(s);
  const [_, y, mo, d, h, mi, se] = m;
  const dt = new Date(Date.UTC(+y, +mo - 1, +d, +h, +mi, +se));
  const tz = s.match(/([+-]\d{4})$/);
  if (tz) {
    const sign = tz[1][0] === '+' ? 1 : -1;
    const hh = +tz[1].slice(1, 3);
    const mm = +tz[1].slice(3, 5);
    dt.setMinutes(dt.getMinutes() - sign * (hh * 60 + mm));
  }
  return dt;
}

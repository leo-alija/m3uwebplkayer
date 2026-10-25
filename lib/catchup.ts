import { Channel, Program } from './types';
import { parseXmltvDate } from './epg';

/*
 * Catch-up playback URLs, following the pvr.iptvsimple (Kodi) conventions that
 * provider `catchup` / `catchup-source` tags target. Supported modes are the
 * ones lib/m3u.ts normalises to: default | append | shift | flussonic | xc.
 *
 * Templates may use (epoch seconds unless noted):
 *   ${start} {utc}          programme start
 *   ${end} {utcend}         start + duration (duration capped at now)
 *   ${now} ${timestamp} {lutc}  current time
 *   ${duration} {duration:N}    programme seconds (N: divided into units, e.g. 60 → minutes)
 *   ${offset} {offset:N}        now - start seconds (N: units)
 *   {Y} {m} {d} {H} {M} {S}     start clock in the EPG timezone of the programme
 *   {utc:fmt} {utcend:fmt} {lutc:fmt} ${start:fmt} ${end:fmt} ${now:fmt} ${timestamp:fmt}
 *     strftime-lite: letters Y m d H M S are substituted, e.g. {utc:Y-m-d}
 *   {catchup-id}            left as-is (XMLTV programmes carry no id here)
 */

type Clock = { Y: string; m: string; d: string; H: string; M: string; S: string };

const DAY_MS = 86_400_000;
const pad = (n: number) => String(n).padStart(2, '0');

export function isCatchupCapable(ch: Channel): boolean {
  return !!(ch.catchupType || ch.catchupSource);
}

function epgTzOffsetMinutes(raw: string): number {
  const tz = raw.match(/([+-])(\d{2}):?(\d{2})$/);
  if (!tz) return 0;
  const sign = tz[1] === '+' ? 1 : -1;
  return sign * (+tz[2] * 60 + +tz[3]);
}

function clockAt(epochSecs: number, tzMin: number): Clock {
  const d = new Date((epochSecs + tzMin * 60) * 1000);
  return {
    Y: String(d.getUTCFullYear()),
    m: pad(d.getUTCMonth() + 1),
    d: pad(d.getUTCDate()),
    H: pad(d.getUTCHours()),
    M: pad(d.getUTCMinutes()),
    S: pad(d.getUTCSeconds()),
  };
}

function fmtClock(clock: Clock, fmt: string): string {
  return fmt.replace(/[YmdHMS]/g, (c) => (clock as Record<string, string>)[c] ?? c);
}

type Ctx = {
  start: number;
  end: number;
  now: number;
  duration: number;
  offset: number;
  startClock: Clock;
  endClock: Clock;
  nowClock: Clock;
};

function substitute(tpl: string, ctx: Ctx): string {
  return tpl.replace(/\$\{(\w+)(?::([^}]*))?\}|\{(\w+)(?::([^}]*))?\}/g, (whole, dName, dFmt, bName, bArg) => {
    const name = dName || bName;
    const arg = dName ? dFmt : bArg;
    const units = arg && /^\d+$/.test(arg) ? +arg : null;
    switch (name) {
      case 'start':
      case 'utc':
        return arg && !units ? fmtClock(ctx.startClock, arg) : String(ctx.start);
      case 'end':
      case 'utcend':
        return arg && !units ? fmtClock(ctx.endClock, arg) : String(ctx.end);
      case 'now':
      case 'timestamp':
      case 'lutc':
        return arg && !units ? fmtClock(ctx.nowClock, arg) : String(ctx.now);
      case 'duration':
        return String(units ? Math.floor(ctx.duration / units) : ctx.duration);
      case 'offset':
        return String(units ? Math.floor(ctx.offset / units) : ctx.offset);
      case 'Y':
      case 'm':
      case 'd':
      case 'H':
      case 'M':
      case 'S':
        return (ctx.startClock as unknown as Record<string, string>)[name];
      default:
        return whole;
    }
  });
}

function appendQuery(url: string, qs: string): string {
  return `${url}${url.includes('?') ? '&' : '?'}${qs}`;
}

/* Flussonic archive URLs: {utc}-{utcend}-style segment paths (see Kodi examples). */
function flussonicTemplate(url: string): string | null {
  const m = url.match(/^(https?:\/\/[^/]+)\/(.+)\/([^/?]*)(mpegts|\.m3u8)(\?.+=.+)?$/);
  if (m) {
    const [, host, path, list, stream, q = ''] = m;
    if (stream === 'mpegts' || /\.ts$/.test(list)) return `${host}/${path}/timeshift_abs-\${start}.ts${q}`;
    return list === 'index'
      ? `${host}/${path}/timeshift_rel-{offset:1}.m3u8${q}`
      : `${host}/${path}/${list}-timeshift_rel-{offset:1}.m3u8${q}`;
  }
  const g = url.match(/^(https?:\/\/[^/]+)\/(.+)\/([^/?]+)(\?.+=.+)?$/);
  if (!g) return null;
  const [, host, path, last, q = ''] = g;
  if (/(?:mpegts|\.ts)(?:$|\?)/.test(last + q)) return `${host}/${path}/timeshift_abs-\${start}.ts${q}`;
  return `${host}/${path}/timeshift_rel-{offset:1}.m3u8${q}`;
}

/* Xtream Codes timeshift: creds + stream id parsed out of the live stream URL. */
function xtreamCodesTemplate(url: string): string | null {
  const m = url.match(/^(https?:\/\/[^/]+)\/(?:live\/)?([^/]+)\/([^/]+)\/([^/.]+?)(\.m3u[8]?)?$/);
  if (!m) return null;
  const [, host, user, pass, id, ext] = m;
  return `${host}/timeshift/${user}/${pass}/{duration:60}/{Y}-{m}-{d}:{H}-{M}/${id}${ext || '.ts'}`;
}

/**
 * Builds the catch-up playback URL for a past programme, or null when the
 * channel has no usable catch-up config or the programme is outside the
 * catch-up window. `now` is injectable for tests.
 */
export function buildCatchupUrl(ch: Channel, prog: Program, now: number = Date.now()): string | null {
  const startMs = parseXmltvDate(prog.start).getTime();
  if (!Number.isFinite(startMs) || startMs > now) return null;
  if (ch.catchupDays != null && ch.catchupDays >= 0 && startMs < now - ch.catchupDays * DAY_MS) return null;

  const source = ch.catchupSource?.trim() || null;
  const type = ch.catchupType || (source ? 'default' : null);
  if (!type) return null;

  const start = Math.floor(startMs / 1000);
  const stopMs = parseXmltvDate(prog.stop).getTime();
  const stopSecs = Number.isFinite(stopMs) ? Math.floor(stopMs / 1000) : start + 3600;
  const duration = Math.max(1, Math.min(stopSecs, Math.floor(now / 1000)) - start);
  const offset = Math.max(0, Math.floor(now / 1000) - start);
  const tzMin = epgTzOffsetMinutes(prog.start);
  const ctx: Ctx = {
    start,
    end: start + duration,
    now: Math.floor(now / 1000),
    duration,
    offset,
    startClock: clockAt(start, tzMin),
    endClock: clockAt(start + duration, tzMin),
    nowClock: clockAt(Math.floor(now / 1000), tzMin),
  };

  let template: string | null;
  switch (type) {
    case 'default':
      template = source ?? appendQuery(ch.url, 'utc={utc}&lutc={lutc}');
      break;
    case 'append':
      template = source ? ch.url + source : appendQuery(ch.url, 'utc={utc}&lutc={lutc}');
      break;
    case 'shift':
      template = appendQuery(ch.url, 'utc={utc}&lutc={lutc}');
      break;
    case 'flussonic':
      template = flussonicTemplate(ch.url);
      break;
    case 'xc':
      template = xtreamCodesTemplate(ch.url);
      break;
    default:
      return null;
  }
  if (!template) return null;
  return substitute(template, ctx);
}

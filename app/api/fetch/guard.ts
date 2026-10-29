/* SSRF guard for the /api/fetch proxy: scheme allow-list, private/reserved
   IP block (literal and DNS-resolved), used by route.ts before every hop. */
import { lookup as dnsLookup } from 'node:dns/promises';

export type LookupFn = (hostname: string) => Promise<{ address: string; family: number }[]>;

export const GUARD_ERROR = 'blocked-url';

function ipv4ToInt(ip: string): number | null {
  const parts = ip.split('.');
  if (parts.length !== 4) return null;
  let n = 0;
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return null;
    const v = Number(part);
    if (v > 255) return null;
    n = (n << 8) | v;
  }
  return n >>> 0;
}

function inRanges(ip: string, ranges: [string, string][]): boolean {
  const n = ipv4ToInt(ip);
  if (n === null) return false;
  return ranges.some(([a, b]) => n >= ipv4ToInt(a)! && n <= ipv4ToInt(b)!);
}

const BLOCKED_V4: [string, string][] = [
  ['0.0.0.0', '0.255.255.255'],       // "this network"
  ['10.0.0.0', '10.255.255.255'],     // private
  ['100.64.0.0', '100.127.255.255'],  // CGNAT
  ['127.0.0.0', '127.255.255.255'],   // loopback
  ['169.254.0.0', '169.254.255.255'], // link-local
  ['172.16.0.0', '172.31.255.255'],   // private
  ['192.0.0.0', '192.0.0.255'],       // IETF protocol assignments
  ['192.168.0.0', '192.168.255.255'], // private
  ['198.18.0.0', '198.19.255.255'],   // benchmarking
  ['224.0.0.0', '239.255.255.255'],   // multicast
  ['240.0.0.0', '255.255.255.255'],   // reserved + broadcast
];

/* Extract a mapped IPv4 from forms like ::ffff:10.0.0.1 or ::ffff:a00:1. */
function mappedIPv4(host: string): string | null {
  const m = /^::ffff:(.+)$/i.exec(host);
  if (!m) return null;
  const tail = m[1];
  if (tail.includes('.')) return tail;
  const hex = tail.split(':');
  if (hex.length !== 2) return null;
  const hi = parseInt(hex[0], 16);
  const lo = parseInt(hex[1], 16);
  if (Number.isNaN(hi) || Number.isNaN(lo)) return null;
  return [(hi >> 8) & 255, hi & 255, (lo >> 8) & 255, lo & 255].join('.');
}

const BLOCKED_HOSTNAMES = /^(localhost|.*\.localhost|.*\.local|.*\.internal)$/i;

/* Escape hatch for self-hosted panels: Xtream boxes on the LAN
   (192.168.x.x, *.local, localhost tunnels) are legitimate targets when the
   app is self-hosted next to them. Setting ALLOW_PRIVATE_TARGETS=1 opts out
   of the private-IP block — opt-in per deployment, never the default. */
function relaxed(): boolean {
  return process.env.ALLOW_PRIVATE_TARGETS === '1';
}

/* True when a hostname is an IP literal (v4/v6) in a blocked range, or a
   localhost-style name. Domain names pass — DNS is checked separately. */
export function isBlockedHost(host: string): boolean {
  const h = host.replace(/^\[|\]$/g, '').toLowerCase();
  if (BLOCKED_HOSTNAMES.test(h)) return true;
  if (h.includes(':')) {
    const v4 = mappedIPv4(h);
    if (v4) return inRanges(v4, BLOCKED_V4);
    if (h === '::1' || h === '::') return true; // loopback / unspecified
    return /^(f[cd]|fe[89ab])/.test(h);          // fc00::/7 unique-local, fe80::/10 link-local
  }
  if (ipv4ToInt(h) !== null) return inRanges(h, BLOCKED_V4);
  return false;
}

export function parseTargetUrl(raw: string): URL | null {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return null;
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
  if (!u.hostname) return null;
  if (!relaxed() && isBlockedHost(u.hostname)) return null;
  return u;
}

export function isIpLiteral(host: string): boolean {
  const h = host.replace(/^\[|\]$/g, '');
  return h.includes(':') || ipv4ToInt(h) !== null;
}

export async function isPubliclyResolvable(
  hostname: string,
  lookup: LookupFn = (h) => dnsLookup(h, { all: true, verbatim: true }) as any,
): Promise<boolean> {
  if (relaxed()) return true; // self-hosted LAN mode: skip the private-IP checks
  if (isIpLiteral(hostname)) return !isBlockedHost(hostname); // no DNS for literals
  let addrs;
  try {
    addrs = await lookup(hostname);
  } catch {
    return false; // unresolvable → block
  }
  return addrs.length > 0 && addrs.every((a) => !isBlockedHost(a.address));
}

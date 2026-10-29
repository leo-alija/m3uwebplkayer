'use client';

import { parseXMLTVStream, type XmltvResult } from './epg';

/* Loads and parses an XMLTV guide through the app proxy. The body is parsed
   in batches as it streams; the caller only commits the result on success so
   a failed download leaves the previous guide untouched. */
export async function fetchEpg(
  url: string,
  onProgress?: (receivedBytes: number, phase: 'download' | 'parse') => void,
): Promise<XmltvResult> {
  const res = await fetch(`/api/fetch?url=${encodeURIComponent(url)}`);
  if (!res.ok) {
    const j = await res.json().catch(() => ({}));
    throw new Error(j.error || `Guide download failed (${res.status})`);
  }
  if (!res.body) {
    const text = await res.text();
    onProgress?.(text.length, 'parse');
    const { parseXMLTV } = await import('./epg');
    const epg = parseXMLTV(text);
    const programmeCount = Object.values(epg).reduce((n, p) => n + p.length, 0);
    return { epg, programmeCount, channelCount: Object.keys(epg).length };
  }
  return parseXMLTVStream(res.body, (bytes) => onProgress?.(bytes, 'download'));
}

export type GuideDiagnostics = {
  reachable: boolean;
  httpCode?: number;
  contentType?: string;
  sizeBytes?: number;
  gzipped?: boolean;
  looksHtml?: boolean;
  finalUrl?: string;
  error?: string;
  ms: number;
};

/* "Test guide URL": reachability, HTTP code, content type, size, gzip
   detection and an HTML-page warning — via the proxy's meta probe. */
export async function testGuideUrl(url: string): Promise<GuideDiagnostics> {
  const t0 = Date.now();
  try {
    const res = await fetch(`/api/fetch?meta=1&url=${encodeURIComponent(url)}`);
    const ms = Date.now() - t0;
    if (!res.ok) {
      const j = await res.json().catch(() => ({} as any));
      return { reachable: false, httpCode: res.status, error: j.error || `proxy ${res.status}`, ms };
    }
    const j = await res.json();
    const ct = String(j.contentType || '');
    return {
      reachable: true,
      httpCode: j.status,
      contentType: ct,
      sizeBytes: j.contentLength || 0,
      gzipped: /gzip/i.test(String(j.contentEncoding || '')) || /\.gz$/i.test(j.finalUrl || url),
      looksHtml: /text\/html/i.test(ct),
      finalUrl: j.finalUrl,
      ms,
    };
  } catch (e: any) {
    return { reachable: false, error: e?.message || 'network error', ms: Date.now() - t0 };
  }
}

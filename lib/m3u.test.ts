import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { M3UScanner, parseM3U } from './m3u';
import { parseM3UWithProgress } from './m3u-client';

const FIXTURE = readFileSync(new URL('./fixtures/popular-kids-iptv.m3u', import.meta.url), 'utf8');

const SAMPLE = [
  '#EXTM3U x-tvg-url="http://epg.example/xmltv.xml"',
  '#EXTINF:-1 tvg-id="bbc.one" tvg-name="BBC One" tvg-logo="http://l/bbc.png" group-title="UK | News",BBC One',
  '#EXTVLCOPT:http-user-agent=TestUA/1.0',
  'http://stream.example/bbc.m3u8',
  '',
  '#EXTGRP:US',
  '#EXTINF:-1,ABC News',
  'http://stream.example/abc.m3u8',
  '#EXTINF:-1 group-title="Movies",Some Film (2020)',
  'http://cdn.example/movie/some-film-2020.mp4',
].join('\r\n');

describe('M3UScanner vs parseM3U', () => {
  it('scanner fed line-by-line matches one-shot parseM3U', () => {
    const oneShot = parseM3U(SAMPLE);
    const scanner = new M3UScanner();
    for (const line of SAMPLE.split(/\r?\n/)) scanner.pushLine(line);
    expect(scanner.finish()).toEqual(oneShot);
  });

  it('scanner fed in odd-sized chunks matches too', () => {
    const oneShot = parseM3U(SAMPLE);
    const lines = SAMPLE.split(/\r?\n/);
    const scanner = new M3UScanner();
    for (let i = 0; i < lines.length; i += 3) {
      for (let j = i; j < Math.min(i + 3, lines.length); j++) scanner.pushLine(lines[j]);
    }
    expect(scanner.finish()).toEqual(oneShot);
  });

  it('parsed content is intact: epg url, groups, headers, content type', () => {
    const { channels, epgUrl } = parseM3U(SAMPLE);
    expect(epgUrl).toBe('http://epg.example/xmltv.xml');
    expect(channels).toHaveLength(3);
    expect(channels[0].name).toBe('BBC One');
    expect(channels[0].groups).toEqual(['UK', 'News']);
    expect(channels[0].headers).toEqual({ 'User-Agent': 'TestUA/1.0' });
    expect(channels[1].group).toBe('US'); // #EXTGRP fallback
    expect(channels[2].contentType).toBe('MOVIE');
  });

  it('BOM + CRLF are stripped before scanning', () => {
    const bom = '\ufeff' + SAMPLE;
    expect(parseM3U(bom)).toEqual(parseM3U(SAMPLE));
  });
});

describe('real-world fixture: popular-kids-iptv.m3u', () => {
  const parsed = parseM3U(FIXTURE);

  it('parses every entry with a name and an http(s) URL', () => {
    expect(parsed.channels.length).toBeGreaterThan(300);
    expect(FIXTURE.match(/#EXTINF/g)?.length).toBe(parsed.channels.length);
    for (const c of parsed.channels) {
      expect(c.name.trim()).not.toBe('');
      expect(c.url).toMatch(/^https?:\/\//);
    }
  });

  it('assigns unique ids and keeps group/logo/tvg metadata', () => {
    expect(new Set(parsed.channels.map((c) => c.id)).size).toBe(parsed.channels.length);
    expect(parsed.channels.some((c) => c.groups?.includes('Kids'))).toBe(true);
    expect(parsed.channels.every((c) => c.tvgId)).toBe(true);
    expect(parsed.channels.filter((c) => c.logo).length).toBe(parsed.channels.length - 1); /* one logo-less entry */
    expect(parsed.epgUrl).toBeUndefined(); /* fixture header carries no x-tvg-url */
  });

  it('survives BOM + CRLF mangling unchanged', () => {
    const mangled = '\ufeff' + FIXTURE.replace(/\n/g, '\r\n');
    expect(parseM3U(mangled)).toEqual(parsed);
  });
});

describe('malformed playlists', () => {
  it('handles empty and non-M3U text', () => {
    expect(parseM3U('')).toEqual({ channels: [] });
    expect(parseM3U('not an m3u at all\njust text')).toEqual({ channels: [] });
  });

  it('ignores bare URLs that never follow an EXTINF', () => {
    expect(parseM3U('#EXTM3U\nhttp://stream.example/live.m3u8').channels).toHaveLength(0);
  });

  it('does not leak attributes from an EXTINF whose URL never arrives', () => {
    const { channels } = parseM3U(
      [
        '#EXTM3U',
        '#EXTINF:-1 tvg-id="one" group-title="Ghost",No URL Follows',
        '#EXTINF:-1 group-title="Real",Second',
        'http://stream.example/2.m3u8',
      ].join('\n'),
    );
    expect(channels).toHaveLength(1);
    expect(channels[0].name).toBe('Second');
    expect(channels[0].group).toBe('Real');
    expect(channels[0].tvgId).toBeUndefined();
  });

  it('keeps text after the first unquoted comma as the display name', () => {
    const { channels } = parseM3U('#EXTM3U\n#EXTINF:-1 tvg-id="x" group-title="G",Hello, World\nhttp://s.example/x.m3u8');
    expect(channels[0].name).toBe('Hello, World');
  });

  it('does not throw on unterminated quotes or stray option lines', () => {
    const text = [
      '#EXTM3U',
      '#EXTVLCOPT:http-user-agent=',
      '#EXTINF:-1 tvg-name="Broken Group",Unbalanced',
      'http://s.example/1.m3u8',
    ].join('\n');
    const { channels } = parseM3U(text);
    expect(channels).toHaveLength(1);
    /* the parser prefers tvg-name over the display name */
    expect(channels[0].name).toBe('Broken Group');
    expect(channels[0].headers).toBeUndefined(); /* empty option value is ignored */
  });
});

describe('parseM3UWithProgress (main-thread fallback in node)', () => {
  it('resolves to the same result as parseM3U and reports progress', async () => {
    const expected = parseM3U(SAMPLE);
    const events: { lines: number; total: number }[] = [];
    const result = await parseM3UWithProgress(SAMPLE, (p) => events.push(p));
    expect(result).toEqual(expected);
    expect(events.length).toBeGreaterThan(0);
    expect(events[events.length - 1].total).toBe(SAMPLE.split(/\r?\n/).length);
    expect(events[events.length - 1].lines).toBe(events[events.length - 1].total);
  });

  it('handles a 50k-entry playlist end to end', async () => {
    const lines = ['#EXTM3U'];
    for (let i = 1; i <= 50_000; i++) {
      lines.push(`#EXTINF:-1 tvg-id="c${i}" group-title="Group ${i % 20}",Channel ${i}`);
      lines.push(`http://stream.example/${i}.m3u8`);
    }
    const text = lines.join('\n');
    let last = { lines: 0, total: 0 };
    const result = await parseM3UWithProgress(text, (p) => { last = p; });
    expect(result.channels).toHaveLength(50_000);
    expect(last.lines).toBe(last.total);
    expect(result.channels[0].name).toBe('Channel 1');
  });
});

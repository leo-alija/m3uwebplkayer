import { describe, expect, it } from 'vitest';
import { buildCatchupUrl, isCatchupCapable } from './catchup';
import { Channel, Program } from './types';

/* 2026-01-15T12:00:00Z */
const NOW = 1768478400_000;
const prog: Program = { start: '20260115100000 +0000', stop: '20260115110000 +0000', title: 'News' };
/* start 1768471200, stop 1768474800, duration 3600, offset 7200 */

const ch = (over: Partial<Channel> = {}): Channel => ({
  id: 'ch_1',
  name: 'One',
  url: 'http://prov.tv/live/user/pw/1477.m3u8',
  contentType: 'LIVE',
  ...over,
});

describe('buildCatchupUrl', () => {
  it('substitutes ${start}/${end}/${duration}/${offset} in a default template', () => {
    const url = buildCatchupUrl(
      ch({ catchupType: 'default', catchupSource: 'http://prov.tv/arch/${start}-${end}.ts?d=${duration}&o=${offset}' }),
      prog,
      NOW,
    );
    expect(url).toBe('http://prov.tv/arch/1768471200-1768474800.ts?d=3600&o=7200');
  });

  it('substitutes {utc}/{utcend}/{lutc}/{now}/{timestamp} with epoch seconds', () => {
    const url = buildCatchupUrl(
      ch({ catchupType: 'default', catchupSource: 'http://p.tv/a?utc={utc}&utcend={utcend}&lutc={lutc}&now=${now}&ts=${timestamp}' }),
      prog,
      NOW,
    );
    expect(url).toBe('http://p.tv/a?utc=1768471200&utcend=1768474800&lutc=1768478400&now=1768478400&ts=1768478400');
  });

  it('renders date components in the EPG timezone of the programme', () => {
    const p2: Program = { start: '20260115120000 +0200', stop: '20260115130000 +0200', title: 'News' };
    const url = buildCatchupUrl(
      ch({ catchupType: 'default', catchupSource: 'http://p.tv/{Y}-{m}-{d}/{H}-{M}/{S}.ts' }),
      p2,
      NOW,
    );
    /* 12:00 +0200 → 10:00 local clock, which is UTC 08:00 — inside the window vs NOW-2h */
    expect(url).toBe('http://p.tv/2026-01-15/12-00/00.ts');
  });

  it('supports strftime-lite {utc:…}/{utcend:…} formats', () => {
    const url = buildCatchupUrl(
      ch({ catchupType: 'default', catchupSource: 'http://p.tv/{utc:Y-m-d}/{utcend:H-M}.ts' }),
      prog,
      NOW,
    );
    expect(url).toBe('http://p.tv/2026-01-15/11-00.ts');
  });

  it('supports {duration:N} and {offset:N} unit division', () => {
    const url = buildCatchupUrl(
      ch({ catchupType: 'default', catchupSource: 'http://p.tv/{duration:60}/{offset:1}' }),
      prog,
      NOW,
    );
    expect(url).toBe('http://p.tv/60/7200');
  });

  it('falls back to ?utc={utc}&lutc={lutc} for default without source', () => {
    const url = buildCatchupUrl(ch({ catchupType: 'default', catchupSource: null }), prog, NOW);
    expect(url).toBe('http://prov.tv/live/user/pw/1477.m3u8?utc=1768471200&lutc=1768478400');
  });

  it('treats unknown type with a source as default template', () => {
    const url = buildCatchupUrl(ch({ catchupType: null, catchupSource: 'http://arch.tv/${start}.ts' }), prog, NOW);
    expect(url).toBe('http://arch.tv/1768471200.ts');
  });

  it('append concatenates the source onto the stream URL', () => {
    const url = buildCatchupUrl(ch({ catchupType: 'append', catchupSource: '&lutc=${timestamp}' }), prog, NOW);
    expect(url).toBe('http://prov.tv/live/user/pw/1477.m3u8&lutc=1768478400');
  });

  it('append without source uses the ?utc/lutc query', () => {
    const url = buildCatchupUrl(ch({ catchupType: 'append', catchupSource: null }), prog, NOW);
    expect(url).toBe('http://prov.tv/live/user/pw/1477.m3u8?utc=1768471200&lutc=1768478400');
  });

  it('shift picks ? or & depending on existing query', () => {
    expect(buildCatchupUrl(ch({ catchupType: 'shift' }), prog, NOW))
      .toBe('http://prov.tv/live/user/pw/1477.m3u8?utc=1768471200&lutc=1768478400');
    expect(buildCatchupUrl(ch({ catchupType: 'shift', url: 'http://prov.tv/live?u=1' }), prog, NOW))
      .toBe('http://prov.tv/live?u=1&utc=1768471200&lutc=1768478400');
  });

  it('flussonic mpegts stream → timeshift_abs-${start}.ts', () => {
    const url = buildCatchupUrl(
      ch({ catchupType: 'flussonic', url: 'http://ch01.spr24.net/151/mpegts?token=tok' }),
      prog,
      NOW,
    );
    expect(url).toBe('http://ch01.spr24.net/151/timeshift_abs-1768471200.ts?token=tok');
  });

  it('flussonic index.m3u8 → timeshift_rel-{offset:1}.m3u8', () => {
    const url = buildCatchupUrl(
      ch({ catchupType: 'flussonic', url: 'http://list.tv:8888/325/index.m3u8?token=sec' }),
      prog,
      NOW,
    );
    expect(url).toBe('http://list.tv:8888/325/timeshift_rel-7200.m3u8?token=sec');
  });

  it('flussonic named playlist → <name>-timeshift_rel-{offset:1}.m3u8', () => {
    const url = buildCatchupUrl(
      ch({ catchupType: 'flussonic', url: 'http://list.tv:8888/325/mono.m3u8' }),
      prog,
      NOW,
    );
    expect(url).toBe('http://list.tv:8888/325/mono-timeshift_rel-7200.m3u8');
  });

  it('xc builds the timeshift endpoint from stream credentials', () => {
    const url = buildCatchupUrl(ch({ catchupType: 'xc' }), prog, NOW);
    expect(url).toBe(
      'http://prov.tv/timeshift/user/pw/60/2026-01-15:10-00/1477.m3u8',
    );
  });

  it('xc falls back to .ts extension for extension-less streams', () => {
    const url = buildCatchupUrl(ch({ catchupType: 'xc', url: 'http://list.tv:8080/u@x.com/pw/1477' }), prog, NOW);
    expect(url).toBe('http://list.tv:8080/timeshift/u@x.com/pw/60/2026-01-15:10-00/1477.ts');
  });

  it('returns null for a programme older than the catchup window', () => {
    const old: Program = { start: '20260101100000 +0000', stop: '20260101110000 +0000', title: 'Old' };
    expect(buildCatchupUrl(ch({ catchupType: 'default', catchupSource: 'x/${start}', catchupDays: 3 }), old, NOW)).toBeNull();
    /* no catchupDays → window unbounded */
    expect(buildCatchupUrl(ch({ catchupType: 'default', catchupSource: 'http://a/${start}' }), old, NOW))
      .toBe('http://a/1767261600');
  });

  it('returns null for future programmes and non-catchup channels', () => {
    const future: Program = { start: '20260115200000 +0000', stop: '20260115210000 +0000', title: 'Later' };
    expect(buildCatchupUrl(ch({ catchupType: 'default', catchupSource: 'http://a/${start}' }), future, NOW)).toBeNull();
    expect(buildCatchupUrl(ch(), prog, NOW)).toBeNull();
    expect(buildCatchupUrl(ch({ catchupType: 'flussonic', url: 'not a url' }), prog, NOW)).toBeNull();
  });

  it('caps duration of a currently-airing programme at now', () => {
    /* airing: started 30 min ago, ends in 30 min */
    const airing: Program = { start: '20260115113000 +0000', stop: '20260115123000 +0000', title: 'Live now' };
    const url = buildCatchupUrl(ch({ catchupType: 'default', catchupSource: 'http://a/${start}/${duration}' }), airing, NOW);
    expect(url).toBe('http://a/1768476600/1800');
  });

  it('isCatchupCapable mirrors the parser fields', () => {
    expect(isCatchupCapable(ch({ catchupType: 'default' }))).toBe(true);
    expect(isCatchupCapable(ch({ catchupSource: 'http://a/${start}' }))).toBe(true);
    expect(isCatchupCapable(ch())).toBe(false);
  });
});

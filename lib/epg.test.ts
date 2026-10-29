import { describe, expect, it } from 'vitest';
import { parseXMLTV, parseXmltvDate, nowProgram, XmltvScanner, parseXmltvDateMs, progWindow, PAST_HOURS, FUTURE_DAYS } from './epg';
import { Program } from './types';

const xmltv = (t: number) => new Date(t).toISOString().replace(/[-:T]/g, '').slice(0, 14) + ' +0000';
const NOW = Date.now();
const at = (offsetMin: number) => xmltv(NOW + offsetMin * 60_000);

const progXml = (ch: string, fromMin: number, toMin: number, body: string) =>
  `<programme start="${at(fromMin)}" stop="${at(toMin)}" channel="${ch}">${body}</programme>`;

const XML = `<?xml version="1.0" encoding="UTF-8"?>
<tv generator-info-name="test">
  <channel id="bbc.one"><display-name>BBC One</display-name></channel>
  ${progXml('bbc.one', -60, 0, '<title>BBC News &amp; Weather</title><desc>Top &lt;b&gt;stories&lt;/b&gt; caf&#233;</desc>')}
  ${progXml('bbc.one', 0, 60, '<title>Afternoon Live</title>')}
  ${progXml('ch.2', 0, 60, '<title>Offside: The Story</title>')}
  <programme start="${at(60)}" channel="ch.2"><title>Missing stop attribute</title></programme>
  ${progXml('ch.2', 60, 120, '<desc>No title here</desc>')}
</tv>`;

describe('parseXMLTV', () => {
  it('groups programmes per channel in document order', () => {
    const out = parseXMLTV(XML);
    expect(Object.keys(out).sort()).toEqual(['bbc.one', 'ch.2']);
    expect(out['bbc.one']).toHaveLength(2);
    expect(out['bbc.one'][0].title).toBe('BBC News & Weather');
    expect(out['bbc.one'][1].title).toBe('Afternoon Live');
  });

  it('decodes numeric and named entities and leaves inner markup after decoding', () => {
    const out = parseXMLTV(XML);
    expect(out['bbc.one'][0].desc).toBe('Top <b>stories</b> café');
  });

  it('skips programmes without start/stop and titles without body default to Untitled', () => {
    const out = parseXMLTV(XML);
    /* the "Missing stop attribute" entry is dropped, the desc-only one stays */
    expect(out['ch.2']).toHaveLength(2);
    expect(out['ch.2'][0].title).toBe('Offside: The Story');
    expect(out['ch.2'][1].title).toBe('Untitled');
  });
});

describe('guide window', () => {
  it('drops programmes older than 12h or further than 8 days out', () => {
    const xml = `<?xml version="1.0"?><tv>
      ${progXml('a', -(PAST_HOURS + 3) * 60, -(PAST_HOURS + 2) * 60, '<title>Too old</title>')}
      ${progXml('a', -30, 30, '<title>On air</title>')}
      ${progXml('a', (FUTURE_DAYS + 2) * 24 * 60, (FUTURE_DAYS + 2) * 24 * 60 + 60, '<title>Too far out</title>')}
    </tv>`;
    const out = parseXMLTV(xml);
    expect(out['a']).toHaveLength(1);
    expect(out['a'][0].title).toBe('On air');
  });

  it('keeps edge-of-window programmes (12h back, 8d forward)', () => {
    const xml = `<?xml version="1.0"?><tv>
      ${progXml('a', -(PAST_HOURS * 60) + 5, -(PAST_HOURS * 60) + 65, '<title>Edge past</title>')}
      ${progXml('a', (FUTURE_DAYS * 24 * 60) - 65, (FUTURE_DAYS * 24 * 60) - 5, '<title>Edge future</title>')}
    </tv>`;
    const out = parseXMLTV(xml);
    expect(out['a']).toHaveLength(2);
  });
});

describe('XmltvScanner (streamed batches)', () => {
  it('produces the same result as one-shot parsing across arbitrary chunk boundaries', () => {
    const whole = parseXMLTV(XML);
    const scanner = new XmltvScanner(NOW);
    const out: Record<string, Program[]> = {};
    const push = (progs: any[]) => {
      for (const p of progs) {
        if (!p.channel) continue;
        (out[p.channel] ||= []).push({ start: p.start, stop: p.stop, title: p.title, desc: p.desc });
      }
    };
    for (let i = 0; i < XML.length; i += 37) push(scanner.push(XML.slice(i, i + 37)));
    push(scanner.finish());
    expect(out).toEqual(whole);
  });

  it('ignores pushes after finish()', () => {
    const scanner = new XmltvScanner(NOW);
    scanner.push(XML);
    scanner.finish();
    expect(scanner.push(XML)).toEqual([]);
  });
});

describe('guide offset', () => {
  const prog = (fromMin: number, toMin: number, title: string): Program => ({
    start: xmltv(NOW + fromMin * 60_000),
    stop: xmltv(NOW + toMin * 60_000),
    title,
  });

  it('shifts the effective on-air window', () => {
    /* a feed one hour late: its "on air now" programme carries stamps that
       ended an hour ago; the user compensates with guideOffsetHours = +1 */
    const progs = [prog(-125, -55, 'Late now')];
    expect(nowProgram(progs)).toBeUndefined();
    expect(nowProgram(progs, 60)?.title).toBe('Late now');
  });

  it('progWindow applies the offset in minutes', () => {
    const p: Program = { start: at(0), stop: at(60), title: 'X' };
    const w0 = progWindow(p, 0);
    const w60 = progWindow(p, 60);
    expect(w60.start - w0.start).toBe(60 * 60_000);
    expect(parseXmltvDateMs(p.start)).toBe(w0.start);
  });
});

describe('parseXmltvDate', () => {
  it('treats a plain stamp as UTC', () => {
    expect(parseXmltvDate('20260115100000').toISOString()).toBe('2026-01-15T10:00:00.000Z');
  });

  it('applies numeric timezone offsets', () => {
    expect(parseXmltvDate('20260115100000 +0200').toISOString()).toBe('2026-01-15T08:00:00.000Z');
    expect(parseXmltvDate('20260115100000 -0500').toISOString()).toBe('2026-01-15T15:00:00.000Z');
    expect(parseXmltvDate('20260115100000+05:30').toISOString()).toBe('2026-01-15T04:30:00.000Z');
  });

  it('makes seconds optional and ignores extra text after the offset', () => {
    expect(parseXmltvDate('202601151000').toISOString()).toBe('2026-01-15T10:00:00.000Z');
    expect(parseXmltvDate('20260115100000 +0000 extra').toISOString()).toBe('2026-01-15T10:00:00.000Z');
  });
});

describe('nowProgram', () => {
  const prog = (fromMin: number, toMin: number, title: string): Program => ({
    start: xmltv(Date.now() + fromMin * 60_000),
    stop: xmltv(Date.now() + toMin * 60_000),
    title,
  });

  it('returns the programme currently on air', () => {
    const progs = [prog(-120, -60, 'Past'), prog(-1, 1, 'Now'), prog(60, 120, 'Future')];
    expect(nowProgram(progs)?.title).toBe('Now');
  });

  it('returns undefined when nothing is on air', () => {
    expect(nowProgram([prog(60, 120, 'Future')])).toBeUndefined();
  });
});

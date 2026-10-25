import { describe, expect, it } from 'vitest';
import { parseXMLTV, parseXmltvDate, nowProgram } from './epg';
import { Program } from './types';

const XML = `<?xml version="1.0" encoding="UTF-8"?>
<tv generator-info-name="test">
  <channel id="bbc.one"><display-name>BBC One</display-name></channel>
  <programme start="20260115100000 +0000" stop="20260115110000 +0000" channel="bbc.one">
    <title>BBC News &amp; Weather</title>
    <desc>Top &lt;b&gt;stories&lt;/b&gt; caf&#233;</desc>
  </programme>
  <programme start="20260115110000 +0000" stop="20260115120000 +0000" channel="bbc.one">
    <title>Afternoon Live</title>
  </programme>
  <programme start="20260115110000 +0000" stop="20260115120000 +0000" channel="ch.2">
    <title>Offside: The Story</title>
  </programme>
  <programme start="20260115120000 +0000" channel="ch.2">
    <title>Missing stop attribute</title>
  </programme>
  <programme start="20260115120000 +0000" stop="20260115130000 +0000" channel="ch.2">
    <desc>No title here</desc>
  </programme>
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
  const xmltv = (t: number) => new Date(t).toISOString().replace(/[-:T]/g, '').slice(0, 14) + ' +0000';
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

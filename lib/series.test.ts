import { describe, expect, it } from 'vitest';
import { parseEpisode, groupingKey, pickSeriesArt, groupIntoFolders } from './series';
import { Channel } from './types';

const ch = (name: string, over: Partial<Channel> = {}): Channel => ({
  id: `ch_${name}`,
  name,
  url: `http://s.example/${encodeURIComponent(name)}.m3u8`,
  group: 'Series',
  contentType: 'SERIES',
  ...over,
});

describe('parseEpisode', () => {
  it('parses SxxExx with a trailing episode title', () => {
    const { series, episode } = parseEpisode(ch('Show Name S02E05 Episode Title'));
    expect(series).toBe('Show Name');
    expect(episode.seasonNumber).toBe(2);
    expect(episode.episodeNumber).toBe(5);
    expect(episode.episodeTitle).toBe('Episode Title');
  });

  it('parses the 1x03 cross form', () => {
    const { series, episode } = parseEpisode(ch('Friends 1x03 The One Where It Ends'));
    expect(series).toBe('Friends');
    expect(episode.seasonNumber).toBe(1);
    expect(episode.episodeNumber).toBe(3);
    expect(episode.episodeTitle).toBe('The One Where It Ends');
  });

  it('parses the word form Season N Episode M', () => {
    const { series, episode } = parseEpisode(ch('The Office Season 2 Episode 5 Casino Night'));
    expect(series).toBe('The Office');
    expect(episode.seasonNumber).toBe(2);
    expect(episode.episodeNumber).toBe(5);
    expect(episode.episodeTitle).toBe('Casino Night');
  });

  it('parses episode-only names, picking the season from the prefix when present', () => {
    expect(parseEpisode(ch('Cartoon Episode 12')).episode).toMatchObject({ seasonNumber: 1, episodeNumber: 12 });
    expect(parseEpisode(ch('Cartoon S3 Episode 4')).episode).toMatchObject({ seasonNumber: 3, episodeNumber: 4 });
  });

  it('strips release junk and bracketed groups from episode titles', () => {
    const { episode } = parseEpisode(ch('Breaking Bad S05E14 720p WEB-DL x264 [GROUP]'));
    expect(episode.seasonNumber).toBe(5);
    expect(episode.episodeNumber).toBe(14);
    expect(episode.episodeTitle).toBe('Episode 14');
  });

  it('falls back to the full name as the series with episode 1', () => {
    const { series, episode } = parseEpisode(ch('Just A Movie'));
    expect(series).toBe('Just A Movie');
    expect(episode.seasonNumber).toBe(1);
    expect(episode.episodeNumber).toBe(1);
  });
});

describe('groupingKey', () => {
  it('is case and whitespace insensitive', () => {
    expect(groupingKey('  Dark   Night ')).toBe(groupingKey('dark night'));
    expect(groupingKey('Dark')).not.toBe(groupingKey('Night'));
  });
});

describe('pickSeriesArt', () => {
  it('prefers a poster/cover URL over any other logo', () => {
    const eps = [
      { channel: ch('A', { logo: 'http://l/common.png' }) },
      { channel: ch('B', { logo: 'http://l/poster.jpg' }) },
    ];
    expect(pickSeriesArt(eps as any)).toBe('http://l/poster.jpg');
  });

  it('falls back to the majority logo', () => {
    const eps = [
      { channel: ch('A', { logo: 'http://l/majority.png' }) },
      { channel: ch('B', { logo: 'http://l/majority.png' }) },
      { channel: ch('C', { logo: 'http://l/other.png' }) },
    ];
    expect(pickSeriesArt(eps as any)).toBe('http://l/majority.png');
  });

  it('returns undefined when no logo reaches a majority; a tie picks the first seen', () => {
    const threeWay = [
      { channel: ch('A', { logo: 'http://l/a.png' }) },
      { channel: ch('B', { logo: 'http://l/b.png' }) },
      { channel: ch('C', { logo: 'http://l/c.png' }) },
    ];
    expect(pickSeriesArt(threeWay as any)).toBeUndefined();
    const tie = [
      { channel: ch('A', { logo: 'http://l/a.png' }) },
      { channel: ch('B', { logo: 'http://l/b.png' }) },
    ];
    expect(pickSeriesArt(tie as any)).toBe('http://l/a.png');
    expect(pickSeriesArt([{ channel: ch('A', { logo: 'http://l/a.png' }) }] as any)).toBe('http://l/a.png');
    expect(pickSeriesArt([{ channel: ch('A') }] as any)).toBeUndefined();
  });
});

describe('groupIntoFolders', () => {
  it('groups episodes case-insensitively and keeps the first-seen display name', () => {
    const folders = groupIntoFolders([ch('Dark S01E01'), ch('dark S01E02'), ch('Other S01E01')]);
    expect(folders.map((f) => f.name)).toEqual(['Dark', 'Other']);
    const dark = folders[0];
    expect(dark.episodeCount).toBe(2);
    expect(dark.seasonCount).toBe(1);
    expect(dark.episodes.map((e) => e.episodeNumber)).toEqual([1, 2]);
  });

  it('counts distinct seasons and collects the group titles', () => {
    const folders = groupIntoFolders([
      ch('Show S01E01', { group: 'Drama' }),
      ch('Show S02E01', { group: 'Drama' }),
      ch('Show S03E01', { group: 'Sci-Fi' }),
    ]);
    const show = folders.find((f) => f.name === 'Show')!;
    expect(show.seasonCount).toBe(3);
    expect(show.groupTitles.sort()).toEqual(['Drama', 'Sci-Fi']);
  });
});

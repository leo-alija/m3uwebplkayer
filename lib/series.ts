import { Channel, SeriesEpisode, SeriesFolder } from './types';

const seasonEpisodePattern = /S\s*(\d{1,3})\s*[-._ ]?\s*E\s*(\d{1,4})/i;
const crossPattern = /\b(\d{1,3})\s*x\s*(\d{1,4})\b/i;
const seasonWordPattern = /\bSeason\s*(\d{1,3})\s*[-._,: ]*\s*(?:Episode|Ep\.?)\s*(\d{1,4})\b/i;
const episodeOnlyPattern = /\b(?:Episode\s*|Ep\.?\s*|E)(\d{1,4})\b/i;
const seasonOnlyPattern = /\b(?:Season\s*|S)(\d{1,3})\b/i;
const seasonPattern = /S(\d+)\s/i;
const whitespaceRun = /\s+/g;
const bracketedJunk = /[\[({][^\])}]*[\])}]/g;
const junkToken = /\b(\d{3,4}[pi]|4K|UHD|FHD|HD|SD|HDR\d*|x264|x265|H\.?26[45]|HEVC|AVC|DIVX|XVID|WEB[-.]?DL|WEB[-.]?RIP|WEBRIP|BLU[-.]?RAY|BDRIP|BRRIP|HDTV|DVDRIP|REMUX|AAC\d*|AC3|EAC3|DD[P+]?\d?(\.\d)?|DTS(-HD)?|TRUEHD|ATMOS|MP3|MULTI|DUAL|SUBBED|SUBS|DUBBED|VOSTFR|AMZN|DSNP|HMAX|PCOK|PROPER|REPACK|INTERNAL|VIP)\b/gi;
const separatorRun = /[\s._\-–|]+/g;
const seriesArtHint = /poster|cover|boxart|box_art/i;

function cleanEpisodeTitle(raw: string): string {
  if (raw.length < 2) return '';
  let title = raw;
  title = title.replace(bracketedJunk, ' ');
  title = title.replace(junkToken, ' ');
  title = title.replace(separatorRun, ' ').trim();
  title = title.trim().replace(/^[-–|.,_ ]+|[-–|.,_ ]+$/g, '');
  if (title.length < 2 || /^\d+$/.test(title)) return '';
  return title;
}

function cleanSeriesName(raw: string): string {
  let name = raw;
  const sMatch = name.match(seasonPattern);
  if (sMatch && typeof sMatch.index === "number") {
    name = name.substring(0, sMatch.index!).trim();
  }
  name = name.replace(/[-– |:,\s]+$/g, '').trim();
  return name.trim();
}

export function parseEpisode(channel: Channel): { series: string; episode: SeriesEpisode } {
  const name = channel.name;
  let seriesName = name;
  let seasonNum = 1;
  let episodeNum = 1;
  let episodeTitle = '';

  const seMatch = name.match(seasonEpisodePattern) || name.match(seasonWordPattern) || name.match(crossPattern);
  const epMatch = seMatch ? null : name.match(episodeOnlyPattern);

  if (seMatch) {
    seasonNum = parseInt(seMatch![1], 10) || 1;
    episodeNum = parseInt(seMatch![2], 10) || 1;
    seriesName = cleanSeriesName(name.substring(0, seMatch!.index!).trim());
    const after = name.substring(seMatch!.index! + seMatch![0].length).trim();
    episodeTitle = cleanEpisodeTitle(after);
  } else if (epMatch) {
    const beforeEpisode = name.substring(0, epMatch!.index!);
    const sMatch = beforeEpisode.match(seasonOnlyPattern);
    seasonNum = sMatch ? (parseInt(sMatch[1], 10) || 1) : 1;
    episodeNum = parseInt(epMatch![1], 10) || 1;
    const cut = sMatch ? sMatch.index! : beforeEpisode.length;
    seriesName = cleanSeriesName(beforeEpisode.substring(0, cut).trim());
    episodeTitle = cleanEpisodeTitle(name.substring(epMatch!.index! + epMatch![0].length).trim());
  } else {
    const sMatch = name.match(seasonPattern);
    if (sMatch) {
      seasonNum = parseInt(sMatch![1], 10) || 1;
      seriesName = cleanSeriesName(name.substring(0, sMatch!.index!).trim());
      episodeTitle = cleanEpisodeTitle(name.substring(sMatch!.index! + sMatch![0].length).trim());
    } else {
      seriesName = name;
    }
  }
  if (!seriesName.trim()) seriesName = name;

  return {
    series: seriesName,
    episode: {
      channel,
      seasonNumber: seasonNum,
      episodeNumber: episodeNum,
      episodeTitle: episodeTitle || `Episode ${episodeNum}`,
    },
  };
}

export function groupingKey(name: string): string {
  return name.toLowerCase().replace(/\s+/g, ' ').trim();
}

export function pickSeriesArt(episodes: SeriesEpisode[]): string | undefined {
  for (const ep of episodes) {
    const url = ep.channel.logo;
    if (url && seriesArtHint.test(url)) return url;
  }
  const counts: Record<string, number> = {};
  for (const ep of episodes) {
    const url = ep.channel.logo;
    if (!url) continue;
    counts[url] = (counts[url] || 0) + 1;
  }
  const keys = Object.keys(counts);
  if (keys.length === 0) return undefined;
  if (episodes.length === 1) return episodes[0].channel.logo;
  let maxUrl = keys[0];
  let maxCount = counts[keys[0]];
  for (const k of keys) {
    if (counts[k] > maxCount) { maxCount = counts[k]; maxUrl = k; }
  }
  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  if (maxCount * 2 >= total) return maxUrl;
  return undefined;
}

export function groupIntoFolders(channels: Channel[]): SeriesFolder[] {
  const grouped: Record<string, SeriesEpisode[]> = {};
  const displayNames: Record<string, string> = {};
  for (const ch of channels) {
    const { series, episode } = parseEpisode(ch);
    const key = groupingKey(series);
    if (!displayNames[key]) displayNames[key] = series;
    if (!grouped[key]) grouped[key] = [];
    grouped[key].push(episode);
  }
  const folders: SeriesFolder[] = Object.keys(grouped).map((key) => {
    const episodes = grouped[key];
    const seasons = new Set(episodes.map((e) => e.seasonNumber));
    const groupTitles = Array.from(new Set(episodes.map((e) => e.channel.group || 'Uncategorized')));
    return {
      name: displayNames[key],
      posterUrl: pickSeriesArt(episodes),
      groupTitles,
      episodes,
      seasonCount: seasons.size,
      episodeCount: episodes.length,
    };
  });
  folders.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
  return folders;
}

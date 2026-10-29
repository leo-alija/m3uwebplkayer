import type { Channel, LiveFolder, Profile } from './types';

/* Sidebar folders for Live TV. Raw group titles are normalised into known
   country/region folders (UK, US, Arabic, …); anything unrecognised becomes
   its own folder. User folders (kind 'custom') can nest inside any folder. */

type FolderRule = { id: string; name: string; match: RegExp };

/* Order matters: first match wins, so specific regions come before generic
   language matches. */
const COUNTRY_RULES: FolderRule[] = [
  { id: 'uk', name: 'UK', match: /\b(u\.?k\.?|united\s*kingdom|britain| british)\b|^[uk]{2}([ |:/-]|$)/i },
  { id: 'us', name: 'US', match: /\b(u\.?s\.?a?\.?|united\s*states|usa|america)\b|^[us]{2}([ |:/-]|$)/i },
  { id: 'canada', name: 'Canada', match: /\b(canada|canadian)\b/i },
  { id: 'australia', name: 'Australia', match: /\b(australia|aussie|nz|new\s*zealand)\b/i },
  { id: 'arabic', name: 'Arabic', match: /\b(arabic|arab|ksa|saudi|uae|egypt|maroc|morocco|algeria|tunisia|libya|sudan|iraq|syria|lebanon|jordan|palestine|kuwait|qatar|bahrain|oman|yemen|maghreb)\b|^ar([ :|/-]|$)/i },
  { id: 'france', name: 'France', match: /\b(france|french|canal\+?|francais)\b/i },
  { id: 'germany', name: 'Germany', match: /\b(germany|deutschland|german|ard|zdf)\b/i },
  { id: 'spain', name: 'Spain', match: /\b(spain|spanish|espana|espanol|la\s*liga)\b/i },
  { id: 'italy', name: 'Italy', match: /\b(italy|italian|italia|rai\b)\b/i },
  { id: 'netherlands', name: 'NL', match: /\b(netherlands|holland|dutch|nederlands|npo)\b/i },
  { id: 'portugal', name: 'Portugal', match: /\b(portugal|portuguese|portuguesa)\b/i },
  { id: 'poland', name: 'Poland', match: /\b(poland|polish|polska|polsat)\b/i },
  { id: 'turkey', name: 'Turkey', match: /\b(turkey|turkish|turkiye|trt)\b/i },
  { id: 'india', name: 'India', match: /\b(india|indian|hindi|bollywood|star\s*plus|zee|colors)\b/i },
  { id: 'pakistan', name: 'Pakistan', match: /\b(pakistan|pakistani|urdu|ptv|geo\b|ary)\b/i },
  { id: 'scandinavia', name: 'Nordic', match: /\b(sweden|norway|denmark|finland|nordic|svensk|norsk|suomi|viasat|tv\d\s*(sport|play))\b/i },
  { id: 'romania', name: 'Romania', match: /\b(romania|romanian|romanes|pro\s*tv|digi)\b/i },
  { id: 'bulgaria', name: 'Bulgaria', match: /\b(bulgaria|bulgarian|bnt|nova\b)\b/i },
  { id: 'albania', name: 'Albania', match: /\b(albania|albanian|shqip|klan|top\s*channel|digit\s*alb)\b|^al([ :|/-]|$)/i },
  { id: 'exyu', name: 'Ex-YU', match: /\b(ex-?yu|serbia|croatia|slovenia|bosnia|macedonia|montenegro|srpski|hrvatski)\b/i },
  { id: 'greece', name: 'Greece', match: /\b(greece|greek|ellada|erte)\b/i },
  { id: 'russia', name: 'Russia', match: /\b(russia|russian|rossiya|rossija)\b/i },
  { id: 'africa', name: 'Africa', match: /\b(africa|nigeria|kenya|ghana|south\s*africa|ethiopia)\b/i },
  { id: 'latin', name: 'Latin America', match: /\b(latin|latino|mexico|argentina|colombia|chile|peru|venezuela)\b/i },
  { id: 'brazil', name: 'Brazil', match: /\b(brazil|brasil|brazilian|globo)\b/i },
  { id: 'sports', name: 'Sports', match: /\b(sport|bein|dazn|espn|sky\s*sports|premier\s*league|ufc|nba|nfl|mlb|nhl|f1|formula)\b/i },
  { id: 'movies', name: 'Movies', match: /\b(movie|cinema|film|cine)\b/i },
  { id: 'kids', name: 'Kids', match: /\b(kids?|child|cartoon|nick|disney|boomerang|baby)\b/i },
  { id: 'music', name: 'Music', match: /\b(music|mtv|vevo|radio)\b/i },
  { id: 'news', name: 'News', match: /\b(news|cnn|bbc\s*news|sky\s*news|al\s*jazeera|msnbc|fox\s*news)\b/i },
  { id: 'documentary', name: 'Documentary', match: /\b(docu|discovery|nat\s*geo|history|animal\s*planet|bbc\s*(earth|america))\b/i },
  { id: 'entertainment', name: 'Entertainment', match: /\b(entertain|general|main|mixed|various)\b/i },
  { id: 'religion', name: 'Religion', match: /\b(religio|islam|quran|christian|church|gospel|hindu|buddh)\b/i },
];

export function normaliseFolderId(groupTitle: string): string {
  const t = groupTitle.trim();
  for (const r of COUNTRY_RULES) if (r.match.test(t)) return r.id;
  return `g_${slug(t)}`;
}

export function normaliseFolderName(groupTitle: string): string {
  const id = normaliseFolderId(groupTitle);
  const rule = COUNTRY_RULES.find((r) => r.id === id);
  if (rule) return rule.name;
  return titleCase(groupTitle.trim()) || 'Other';
}

export function slug(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'other';
}

function titleCase(s: string): string {
  return s.replace(/\w\S*/g, (w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase());
}

export const FAV_FOLDER_ID = 'favorites';

/* Builds the sidebar tree: country folders (one per normalised bucket, in
   folder order or first-seen order), the Favourites pseudo-folder, and the
   user's custom folders (which may nest via parent). */
export function buildFolders(groups: string[], profile: Profile): LiveFolder[] {
  const buckets = new Map<string, LiveFolder>();
  for (const g of groups) {
    if (profile.hiddenGroups.includes(g)) continue;
    /* a group the user explicitly moved wins over auto-normalisation */
    const moved = profile.folderGroupMoves[g];
    const id = moved || normaliseFolderId(g);
    const name = profile.folderRenames[id] || (moved ? movedName(profile, moved) : normaliseFolderName(g));
    if (!buckets.has(id)) {
      buckets.set(id, { id, name, kind: moved ? 'custom' : 'country', groupTitles: [] });
    }
    buckets.get(id)!.groupTitles.push(g);
  }
  for (const f of profile.customFolders) {
    if (!buckets.has(f.id)) {
      buckets.set(f.id, { ...f, name: profile.folderRenames[f.id] || f.name, groupTitles: [] });
    }
  }

  const fav: LiveFolder = {
    id: FAV_FOLDER_ID, name: profile.folderRenames[FAV_FOLDER_ID] || 'Favourites', kind: 'special', groupTitles: [],
  };

  const all = [fav, ...buckets.values()];
  /* specials (Favourites) always first, then user order, then first-seen */
  const order = profile.folderOrder;
  all.sort((a, b) => {
    if (a.kind === 'special') return -1;
    if (b.kind === 'special') return 1;
    const ia = order.indexOf(a.id), ib = order.indexOf(b.id);
    if (ia !== -1 && ib !== -1) return ia - ib;
    if (ia !== -1) return -1;
    if (ib !== -1) return 1;
    return 0;
  });

  /* nest: folders with a parent are pulled out of the top level; the parent
     keeps them as logical children resolved by the UI via `parent` */
  const topLevel = all.filter((f) => !f.parent);
  for (const f of all) if (f.parent && !topLevel.includes(f)) {
    const p = topLevel.find((t) => t.id === f.parent);
    if (!p) topLevel.push(f); /* orphaned parent → surface it */
  }
  return topLevel;
}

function movedName(profile: Profile, folderId: string): string {
  const custom = profile.customFolders.find((f) => f.id === folderId);
  return profile.folderRenames[folderId] || custom?.name || folderId;
}

/* Sub-folders of a folder (custom folders nested inside it). */
export function childFolders(folders: LiveFolder[], parentId: string): LiveFolder[] {
  return folders.filter((f) => f.parent === parentId);
}

export function channelsInFolder(channels: Channel[], folder: LiveFolder, profile: Profile): Channel[] {
  const set = new Set(folder.groupTitles);
  return channels.filter((c) => {
    if (profile.hiddenChannels.includes(c.id)) return false;
    if (folder.kind === 'special') return profile.favorites.includes(c.id);
    return (c.groups || [c.group || 'Uncategorized']).some((g) => set.has(g));
  });
}

/* Group titles that live under a folder (for sub-category chips). */
export function groupsOfFolder(folder: LiveFolder): string[] {
  return folder.groupTitles;
}

export function folderIcon(folder: LiveFolder): string {
  if (folder.kind === 'special') return '★';
  switch (folder.id) {
    case 'uk': return '🇬🇧';
    case 'us': return '🇺🇸';
    case 'canada': return '🇨🇦';
    case 'australia': return '🇦🇺';
    case 'arabic': return '🕌';
    case 'france': return '🇫🇷';
    case 'germany': return '🇩🇪';
    case 'spain': return '🇪🇸';
    case 'italy': return '🇮🇹';
    case 'netherlands': return '🇳🇱';
    case 'portugal': return '🇵🇹';
    case 'poland': return '🇵🇱';
    case 'turkey': return '🇹🇷';
    case 'india': return '🇮🇳';
    case 'pakistan': return '🇵🇰';
    case 'scandinavia': return '🇸🇪';
    case 'romania': return '🇷🇴';
    case 'bulgaria': return '🇧🇬';
    case 'albania': return '🇦🇱';
    case 'exyu': return '🇷🇸';
    case 'greece': return '🇬🇷';
    case 'russia': return '🇷🇺';
    case 'africa': return '🌍';
    case 'latin': return '🌎';
    case 'brazil': return '🇧🇷';
    default: return '📁';
  }
}

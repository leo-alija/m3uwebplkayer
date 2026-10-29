import { describe, expect, it } from 'vitest';
import { normaliseFolderId, normaliseFolderName, buildFolders, channelsInFolder, FAV_FOLDER_ID } from './folders';
import { Channel, DEFAULT_PROFILE } from './types';

const ch = (name: string, group: string): Channel => ({
  id: `c_${name}`, name, url: `http://x/${name}`, group, groups: [group], contentType: 'LIVE',
});

describe('country normalisation', () => {
  it('buckets known country groups', () => {
    expect(normaliseFolderId('UK | Entertainment')).toBe('uk');
    expect(normaliseFolderId('US SPORTS')).toBe('us');
    expect(normaliseFolderId('AR: MBC Drama')).toBe('arabic');
    expect(normaliseFolderId('Albania TV')).toBe('albania');
    expect(normaliseFolderId('beIN Sports 1')).toBe('sports');
  });

  it('falls back to a slug folder for unknown groups', () => {
    expect(normaliseFolderId('Mystery Box')).toBe('g_mystery-box');
    expect(normaliseFolderName('Mystery Box')).toBe('Mystery Box');
  });

  it('names normalised folders cleanly', () => {
    expect(normaliseFolderName('UK | Entertainment')).toBe('UK');
    expect(normaliseFolderName('AR: MBC')).toBe('Arabic');
  });
});

describe('buildFolders', () => {
  it('creates the favourites pseudo-folder plus one folder per bucket', () => {
    const profile = { ...DEFAULT_PROFILE };
    const folders = buildFolders(['UK | Drama', 'UK | Sport', 'US | News'], profile);
    expect(folders.map((f) => f.id)).toEqual([FAV_FOLDER_ID, 'uk', 'us']);
    expect(folders.find((f) => f.id === 'uk')!.groupTitles).toEqual(['UK | Drama', 'UK | Sport']);
  });

  it('honours user renames, order and hidden groups', () => {
    const profile = {
      ...DEFAULT_PROFILE,
      folderRenames: { uk: 'United Kingdom' },
      folderOrder: ['us', 'uk'],
      hiddenGroups: ['US | News'],
    };
    const folders = buildFolders(['UK | Drama', 'US | News'], profile);
    expect(folders.filter((f) => f.kind !== 'special').map((f) => f.id)).toEqual(['uk']);
    expect(folders[0].kind).toBe('special');
    expect(folders.find((f) => f.id === 'uk')!.name).toBe('United Kingdom');
  });

  it('moves a group to a custom folder via folderGroupMoves', () => {
    const profile = {
      ...DEFAULT_PROFILE,
      customFolders: [{ id: 'f_mine', name: 'My Mix', kind: 'custom' as const, groupTitles: [] }],
      folderGroupMoves: { 'UK | Drama': 'f_mine' },
    };
    const folders = buildFolders(['UK | Drama', 'UK | Sport'], profile);
    const mine = folders.find((f) => f.id === 'f_mine')!;
    expect(mine.groupTitles).toEqual(['UK | Drama']);
    const uk = folders.find((f) => f.id === 'uk')!;
    expect(uk.groupTitles).toEqual(['UK | Sport']);
  });
});

describe('channelsInFolder', () => {
  it('favourites folder selects favourites only', () => {
    const profile = { ...DEFAULT_PROFILE, favorites: ['c_A2'] };
    const fav = buildFolders([], profile)[0];
    const out = channelsInFolder([ch('A1', 'UK'), ch('A2', 'US')], fav, profile);
    expect(out.map((c) => c.name)).toEqual(['A2']);
  });

  it('respects hidden channels', () => {
    const profile = { ...DEFAULT_PROFILE, hiddenChannels: ['c_A1'] };
    const folders = buildFolders(['UK'], profile);
    const out = channelsInFolder([ch('A1', 'UK'), ch('A2', 'UK')], folders[1], profile);
    expect(out.map((c) => c.name)).toEqual(['A2']);
  });
});

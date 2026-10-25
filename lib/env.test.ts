import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { iosVersion, supportsMms, mmsEnabled, preferHlsJs, mvCap } from './env';

const IPHONE_16 = 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_7_10 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.6 Mobile/15E148 Safari/604.1';
const IPHONE_18 = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';
const IPADOS = 'Mozilla/5.0 (iPad; CPU OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';

describe('iosVersion', () => {
  it('reads the Safari version on iPhone UAs', () => {
    expect(iosVersion(IPHONE_16)).toBe(16.6);
    expect(iosVersion(IPHONE_18)).toBe(18);
  });
  it('reads iPad UAs', () => {
    expect(iosVersion(IPADOS)).toBe(17.5);
  });
  it('returns 0 for non-iOS and unparseable UAs', () => {
    expect(iosVersion('Mozilla/5.0 (Macintosh) Safari/605.1.15')).toBe(0);
    expect(iosVersion('iPad missing version token')).toBe(0);
  });
});

describe('supportsMms', () => {
  it('is true only when ManagedMediaSource exists', () => {
    expect(supportsMms({})).toBe(false);
    expect(supportsMms({ ManagedMediaSource: function () {} })).toBe(true);
  });
});

describe('mmsEnabled', () => {
  beforeEach(() => vi.stubGlobal('localStorage', { getItem: (k: string) => (k === 'mmsHls' ? 'off' : null) }));
  afterEach(() => vi.unstubAllGlobals());
  it('defaults on and honours the off flag', () => {
    expect(mmsEnabled()).toBe(false);
    expect(mmsEnabled({ getItem: () => null })).toBe(true);
    expect(mmsEnabled(undefined as any)).toBe(false); /* reads stubbed localStorage */
  });
});

describe('preferHlsJs', () => {
  it('prefers hls.js everywhere except iOS', () => {
    expect(preferHlsJs(false, 0, false, true)).toBe(true);
    expect(preferHlsJs(false, 0, true, true)).toBe(true);
  });
  it('falls back to native HLS below iOS 17.1 or when opted out', () => {
    expect(preferHlsJs(true, 16.6, false, true)).toBe(false);
    expect(preferHlsJs(true, 16.6, true, false)).toBe(false);
  });
  it('uses hls.js on iOS 17.1+ and MMS-capable iPadOS', () => {
    expect(preferHlsJs(true, 17.2, true, true)).toBe(true);
    expect(preferHlsJs(true, 0, true, true)).toBe(true);
  });
});

describe('mvCap', () => {
  it('caps phones at 2 tiles, other devices at 6', () => {
    expect(mvCap(true)).toBe(2);
    expect(mvCap(false)).toBe(6);
  });
});

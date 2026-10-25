import { describe, it, expect } from 'vitest';
import { quotaVerdict, QUOTA_LIMIT } from './downloads';

describe('quotaVerdict', () => {
  it('allows when plenty of space is left', () => {
    expect(quotaVerdict(100_000_000, 1_000_000_000)).toEqual({ ok: true });
  });
  it('allows when the browser reports no quota', () => {
    expect(quotaVerdict(500, 0)).toEqual({ ok: true });
  });
  it('blocks at the 90% line and explains why', () => {
    const v = quotaVerdict(QUOTA_LIMIT * 1_000_000_000, 1_000_000_000);
    expect(v.ok).toBe(false);
    expect(v.reason).toMatch(/Storage nearly full/);
  });
  it('blocks just over the line', () => {
    expect(quotaVerdict(950_000_000, 1_000_000_000).ok).toBe(false);
  });
});

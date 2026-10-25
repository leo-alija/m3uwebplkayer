import { describe, expect, it } from 'vitest';
import { PX_PER_MIN, WINDOW_MIN, floorSlot, layoutPrograms } from './guide-grid';
import type { Program } from '../lib/types';

const WIN_START = Date.UTC(2026, 0, 1, 12, 0, 0);
const WIN_END = WIN_START + WINDOW_MIN * 60_000;
const NOW = WIN_START + 2 * 60 * 60_000; /* 2h into the window */

function prog(startMs: number, endMs: number, title = 'P'): Program {
  const d = (ms: number) => {
    const t = new Date(ms);
    const p = (n: number) => String(n).padStart(2, '0');
    return `${t.getUTCFullYear()}${p(t.getUTCMonth() + 1)}${p(t.getUTCDate())}${p(t.getUTCHours())}${p(t.getUTCMinutes())}${p(t.getUTCSeconds())}Z`;
  };
  return { start: d(startMs), stop: d(endMs), title };
}

describe('floorSlot', () => {
  it('floors to the current 30-minute slot', () => {
    expect(floorSlot(WIN_START + 17 * 60_000)).toBe(WIN_START);
    expect(floorSlot(WIN_START + 30 * 60_000)).toBe(WIN_START + 30 * 60_000);
  });
});

describe('layoutPrograms', () => {
  it('returns empty for missing or empty programme lists', () => {
    expect(layoutPrograms(undefined, WIN_START, WIN_END, NOW)).toEqual([]);
    expect(layoutPrograms([], WIN_START, WIN_END, NOW)).toEqual([]);
  });

  it('excludes programmes entirely outside the window', () => {
    const before = prog(WIN_START - 3 * 60 * 60_000, WIN_START - 60_000);
    const after = prog(WIN_END + 60_000, WIN_END + 2 * 60 * 60_000);
    expect(layoutPrograms([before, after], WIN_START, WIN_END, NOW)).toEqual([]);
  });

  it('clamps a programme that starts before the window', () => {
    const [laid] = layoutPrograms([prog(WIN_START - 60 * 60_000, WIN_START + 30 * 60_000)], WIN_START, WIN_END, NOW);
    expect(laid.leftPx).toBe(0);
    expect(laid.widthPx).toBe(30 * PX_PER_MIN);
    expect(laid.past).toBe(true); /* ended 1.5h before NOW, even though clamped into view */
  });

  it('clamps a programme that ends after the window', () => {
    const [laid] = layoutPrograms([prog(WIN_END - 15 * 60_000, WIN_END + 60_000)], WIN_START, WIN_END, NOW);
    expect(laid.leftPx).toBe((WINDOW_MIN - 15) * PX_PER_MIN);
    expect(laid.widthPx).toBe(15 * PX_PER_MIN);
  });

  it('flags the airing programme as now and finished ones as past', () => {
    const past = prog(WIN_START, WIN_START + 60_000);
    const airing = prog(NOW - 30 * 60_000, NOW + 30 * 60_000);
    const future = prog(NOW + 60_000, NOW + 2 * 60 * 60_000);
    const laid = layoutPrograms([past, airing, future], WIN_START, WIN_END, NOW);
    expect(laid.map((l) => [l.past, l.now])).toEqual([[true, false], [false, true], [false, false]]);
  });

  it('keeps programmes ordered as given and positions them by minute offset', () => {
    const a = prog(WIN_START, WIN_START + 30 * 60_000);
    const b = prog(WIN_START + 30 * 60_000, WIN_START + 90 * 60_000);
    const laid = layoutPrograms([a, b], WIN_START, WIN_END, NOW);
    expect(laid[0].leftPx).toBe(0);
    expect(laid[1].leftPx).toBe(30 * PX_PER_MIN);
    expect(laid[1].widthPx).toBe(60 * PX_PER_MIN);
  });
});

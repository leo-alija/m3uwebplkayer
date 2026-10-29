import { useEffect, useState } from 'react';
import { parseXmltvDate } from '../lib/epg';
import { Channel, Program } from '../lib/types';
import { Poster } from './ui';

export const PX_PER_MIN = 6;
export const WINDOW_MIN = 720; /* bounded ±12h virtualized window */
export const SLOT_MIN = 30;
export const CHANNEL_W = 104;
const ROW_H = 56;

export function floorSlot(ms: number): number {
  return Math.floor(ms / (SLOT_MIN * 60_000)) * SLOT_MIN * 60_000;
}

export type LaidProgram = {
  program: Program;
  startMs: number;
  endMs: number;
  leftPx: number;
  widthPx: number;
  past: boolean;
  now: boolean;
};

/* Clamp a channel's programmes onto the visible window, in pixel space.
   offsetMinutes shifts programme windows (guide time offset setting). */
export function layoutPrograms(
  programs: Program[] | undefined,
  windowStartMs: number,
  windowEndMs: number,
  nowMs: number,
  offsetMinutes = 0,
): LaidProgram[] {
  if (!programs) return [];
  const shift = offsetMinutes * 60_000;
  const out: LaidProgram[] = [];
  for (const program of programs) {
    const startMs = Math.max(parseXmltvDate(program.start).getTime() + shift, windowStartMs);
    const endMs = Math.min(parseXmltvDate(program.stop).getTime() + shift, windowEndMs);
    if (endMs <= startMs) continue;
    out.push({
      program,
      startMs,
      endMs,
      leftPx: ((startMs - windowStartMs) / 60_000) * PX_PER_MIN,
      widthPx: ((endMs - startMs) / 60_000) * PX_PER_MIN,
      past: endMs <= nowMs,
      now: startMs <= nowMs && nowMs < endMs,
    });
  }
  return out;
}

function clock(ms: number) {
  const d = new Date(ms);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

export function GuideGrid({ channels, epgFor, onPlay, onCatchup, total, loadMore, offsetMinutes = 0 }: {
  channels: Channel[];
  epgFor: (ch: Channel) => Program[] | undefined;
  onPlay: (ch: Channel) => void;
  onCatchup: (ch: Channel, prog: Program) => void;
  total: number;
  loadMore: () => void;
  offsetMinutes?: number;
}) {
  const [windowStartMs, setWindowStartMs] = useState(() => floorSlot(Date.now()));
  const [nowMs, setNowMs] = useState(() => Date.now());

  useEffect(() => {
    const t = setInterval(() => {
      const n = Date.now();
      setNowMs(n);
      setWindowStartMs(floorSlot(n));
    }, 30_000);
    return () => clearInterval(t);
  }, []);

  const windowEndMs = windowStartMs + WINDOW_MIN * 60_000;
  const gridW = WINDOW_MIN * PX_PER_MIN;
  const nowLeftPx = CHANNEL_W + ((nowMs - windowStartMs) / 60_000) * PX_PER_MIN;
  const hours: number[] = [];
  for (let m = 0; m < WINDOW_MIN; m += 60) hours.push(m);

  return (
    <div>
      <div className="ios-card mx-4 overflow-hidden">
        <div className="overflow-x-auto">
          <div className="relative" style={{ width: CHANNEL_W + gridW }}>
            {/* hour header */}
            <div className="relative flex bg-pit">
              <div className="sticky left-0 z-20 shrink-0 bg-pit" style={{ width: CHANNEL_W }}>
                <div className="px-3 py-2 text-[11px] font-semibold uppercase tracking-wide text-white/40">Guide</div>
              </div>
              <div className="relative" style={{ width: gridW }}>
                {hours.map((m) => (
                  <div key={m} className="absolute top-0 py-2 pl-1.5 text-[11px] text-white/40"
                    style={{ left: m * PX_PER_MIN }}>
                    {clock(windowStartMs + m * 60_000)}
                  </div>
                ))}
              </div>
            </div>

            {/* channel rows */}
            {channels.map((ch) => {
              const laid = layoutPrograms(epgFor(ch), windowStartMs, windowEndMs, nowMs, offsetMinutes);
              return (
                <div key={ch.id} className="hairline-b relative flex" style={{ height: ROW_H }}>
                  <button onClick={() => onPlay(ch)}
                    className="press sticky left-0 z-10 flex shrink-0 items-center gap-2 bg-ground px-3 text-left"
                    style={{ width: CHANNEL_W }}>
                    <Poster src={ch.logo} label={ch.name} className="h-9 w-9 shrink-0 rounded-lg" />
                    <div className="min-w-0 text-[13px] font-medium leading-tight">{ch.name}</div>
                  </button>
                  <div className="relative" style={{ width: gridW }}>
                    {laid.length === 0 && (
                      <button onClick={() => onPlay(ch)}
                        className="press absolute inset-0 flex items-center px-2 text-[12px] text-white/35">
                        No programme data — tap to play
                      </button>
                    )}
                    {laid.map((lp) => (
                      <button key={`${lp.program.start}-${lp.program.title}`}
                        onClick={() => (lp.past ? onCatchup(ch, lp.program) : onPlay(ch))}
                        className={`press absolute overflow-hidden whitespace-nowrap rounded-md px-1.5 py-1 text-left text-[12px] leading-tight ${
                          lp.now
                            ? 'z-[5] border border-accent/50 bg-accent/15 text-white'
                            : lp.past
                              ? 'bg-white/5 text-white/40'
                              : 'bg-white/10 text-white/85'
                        }`}
                        style={{ left: lp.leftPx, width: lp.widthPx, top: 4, bottom: 4 }}>
                        <span className="mr-1 text-[10px] text-white/45">{clock(lp.startMs)}</span>
                        {lp.program.title}
                        {lp.past && lp.widthPx > 90 && (
                          <span className="ml-1 text-[10px] text-accent">↺ {clock(lp.startMs)}</span>
                        )}
                      </button>
                    ))}
                  </div>
                </div>
              );
            })}

            {channels.length === 0 && (
              <div className="p-6 text-center text-white/40 text-[14px]">No guide in this playlist.</div>
            )}

            {/* now-line */}
            {nowMs >= windowStartMs && nowMs < windowEndMs && (
              <div className="pointer-events-none absolute bottom-0 top-0 z-[6]" style={{ left: nowLeftPx }}>
                <div className="h-full w-px bg-berry" />
                <div className="absolute -top-0 left-1 rounded-full bg-berry px-1.5 py-0.5 text-[10px] font-bold text-white">
                  {clock(nowMs)}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
      {total > channels.length && (
        <div className="py-3 text-center">
          <button onClick={loadMore} className="press text-[14px] text-link">
            Show more ({(total - channels.length).toLocaleString()} left)
          </button>
        </div>
      )}
    </div>
  );
}

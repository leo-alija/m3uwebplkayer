# AlgoPlay for Web (iOS)

Installable browser IPTV player: bring your own M3U/Xtream playlist, watch on iPhone as a home-screen PWA. Next.js 14 App Router, React 18, TypeScript, Tailwind, hls.js. Companion to the Android app in `../m3u-playlist-la`.

## Run

```bash
npm ci
npm run dev            # dev server
npm run build && npm start
```

Import a playlist (URL, upload, or Xtream login), pick a profile, play. Offline downloads and full data backup sit in Settings.

## Docs

- `PLAN.md` — the improvement plan: phased Flix makeover, phase 0 (hygiene + security) first. One phase per session, tick checkboxes as you go.
- `../popular-kids-iptv.m3u` — parser test fixture.

## Work plan (stages for Claude)

Repo unchanged since the "build plan" commit — PLAN.md phases 0–5 are all still unchecked. Run in this order; one stage per session; commit `STAGE n: summary`; build + typecheck + tests green before every commit.

| Stage | Task | Done means |
|---|---|---|
| 0 ✅ | Hygiene: dynamic hls.js import (`components/player.tsx` → dynamic), remove unused zustand, pin eslint + config exact versions, `.nvmrc`, `.env.example`, README (this file) fresh | fresh `npm ci && npm run build && npm run typecheck` clean |
| 1 ✅ | Bug: `tvgName` stale-attr in `lib/m3u.ts:207` — restore entry-attr read; regression test lands with Stage 5 suite | EPG-by-name works; unit test proves |
| 2 ✅ | Security: `/api/fetch` SSRF hardening (`app/api/fetch/route.ts:4–10`): scheme/host allow-list, private-IP + IPv4-mapped-IPv6 + localhost block, size cap (bin vs text), strict timeout; public request contract unchanged (same shape, Range passthrough); tests beside route | malicious-URL test suite green |
| 3 ✅ | AirPlay: un-hide webkit controls (`globals.css:75`) or programmatic `x-webkit-airplay` route | AirPlay button surfaces on iOS |
| 4 ✅ | EPG timeline grid `components/guide-grid.tsx` (rows → real grid), tap → player, now-line, mini catch-up entry | grid renders + navigates |
| 5 ✅ | Catch-up engine `lib/catchup.ts`: URL builder per provider mode (parser already reads catchup tags), playback route, "catch-up from EPG" entry point | playback starts from the EPG entry |
| 6 | Netflix set: watchlist shelf, Top 10 shelf, More Like This, design tokens (phase out 50+ hardcoded hexes to CSS vars) | shelves live, plugin-free tokens |
| 7 | iOS stack: hls.js via ManagedMediaSource (17.1+, keep native fallback < 17.1), Media Session lock-screen, multiview device tile caps, offline-download quota guard (eviction reminder), PWA update toast | feature flag + device matrix notes |
| 8 | Perf/scale: worker M3U parse + import progress UI (50k entries no longer stall main thread); Xtream category refresh UX; logo fallback for logo-less channels | import progress w/ 50k fixture |
| 9 | Tests: Vitest on m3u/series/epg/catchup, fixture `../popular-kids-iptv.m3u` + BOM/CRLF/malformed cases | suite green in CI |
| 10 | Owner manual QA (not automatable): Safari script from Stage 1 output — import URL/file/Xtream, keypad zapping, catch-up, MMS quality menu, multiview caps, lock-screen controls | checklist signed off |

## Environment

Optional: `TMDB_API_KEY` for posters/hero metadata (see `lib/tmdb.ts`). No other secrets should ever be committed.

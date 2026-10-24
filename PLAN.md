# AlgoPlay for Web (iOS) — Flix Makeover

Repo: `m3uwebplkayer` (Next.js 14, App Router)
Reference implementation: `../m3u-playlist-la` (Android app — read only the files named, never index the whole repo)

## How to run this plan

- One phase per session. Do not start the next phase until the current gate passes.
- Read this file, tick checkboxes, one commit per item (`phase-item: summary`).
- After each item: `npm run build` + `npm run typecheck` (and `npm test` once it exists). Show real output, not claims.
- Diffs only. No file dumps, no recaps, no explanations unless asked. Ask before adding dependencies.
- Touch only the files named in the item. No unrelated refactors.
- Reference code: before writing code for a phase that ports Android behavior, output a port map (`source file → target file → what to port`) and wait for approval.

## Phase 0 — Baseline & Hygiene

Gate: fresh `npm ci` + `npm run build` + `npm run typecheck` clean; lint deps pinned.

- [ ] 0.1 Environment & verification: resolve Node via nvm (add `.nvmrc` with the working version), `npm ci`, `npm run build`, `npm run typecheck`. Record any baseline failures in this file. Pin eslint: the `lint` script exists but eslint is not in devDependencies — add `eslint` + `eslint-config-next` with exact versions (no `^`) and commit the lockfile.
- [ ] 0.2 Fix `tvgName` stale-variable bug in `lib/m3u.ts:207`: the entry reads a stale `attributes` object instead of the current item's attributes, so the EPG matching path is dead. Restore it. Regression test lands in 1.2.
- [ ] 0.3 Consolidate `isIOS` into `lib/env.ts`: remove the duplicate in `app/page.tsx:25`; clarify the `components/player.tsx:25` alias (`const isIOS = NATIVE_HLS`).
- [ ] 0.4 Drop unused `zustand` dependency; prune dead imports in `app/page.tsx` and the duplicate `IconDownload` in `components/detail.tsx`.
- [ ] 0.5 Docs: `README.md` (iOS PWA install steps, `TMDB_API_KEY` guidance) and `.env.example`. Keys only in env files, never committed.

## Phase 1 — Test Suite (Vitest)

Gate: `npm test` green, listed units covered.

- [ ] 1.1 Add Vitest (`test` script, node environment) with no other dependency changes.
- [ ] 1.2 `lib/m3u.ts` tests: attributes, headers, catchup tags, channel numbering, content typing, `tvgName` regression (0.2).
- [ ] 1.3 `lib/series.ts` series-grouping tests.
- [ ] 1.4 `lib/epg.ts` EPG parser tests.
- (Catch-up builder tests belong to 4.2 where the builder lands.)

## Phase 2 — Design, Theme & Navigation

Gate: no new hardcoded hex colors in changed files; keyboard/remote-only walkthrough passes.

- [ ] 2.1 Design token system: replace 50+ hardcoded hex colors with the AlgoPlay Design System — Indigo `#6366F1` accent, `SurfaceGround → Elevated` elevation ladder, fluid typography scale, consistent radii. Tokens as CSS variables + Tailwind theme.
- [ ] 2.2 Desktop/TV responsive layout: pinned left navigation rail, full-bleed hero banner, wide media rows with TMDb backdrop hover-preview cards, "Top 10" shelf, genre rails. Mobile keeps the fluid bottom tabs.
- [ ] 2.3 Key/remote navigation: FocusVisible + roving `tabIndex` arrow-key navigation, porting the Android D-pad pattern (map it from the reference repo first).
- [ ] 2.4 Detail page & overlays: desktop modal over dimmed backdrop; seamless next-episode playback flow; "More Like This" recommendations.

## Phase 3 — Performance & Safety

Gate: hls.js in its own chunk; `/api/fetch` rejects private IPs and unlisted domains; TMDb key rotated.

- [ ] 3.1 Code-split `hls.js` with `next/dynamic`.
- [ ] 3.2 Loading skeletons; worker-based M3U parser for large playlists; virtualized guide rendering; `app/loading.tsx` + `app/error.tsx` boundaries.
- [ ] 3.3 Secure `/api/fetch`: IP blocklist (private/link-local/loopback), domain allowlist, request size limits. Propose the design before coding. Move TMDb key to env, rotate it, revoke the old one.

## Phase 4 — Player & Audio/Video Parity

Gate: device matrix checked (iPhone Safari, iPad, desktop); catch-up tests green.

- [ ] 4.1 Media Session API (`lib/media-session.ts`): lock-screen/Control Center controls, high-res artwork, seek, position tracking, next-track integration for automatic episode progression.
- [ ] 4.2 Catch-up engine (`lib/catchup.ts`): modes `default`, `append`, `shift`, `flussonic`, `xc`; templating (`${start}`, `${end}`, `${offset}`, `${timestamp}`) vs relative epoch. Guide integration: tap programme → "Watch from {time}" within the window. Player UI: CATCH-UP badge + "Back to LIVE". Add builder tests.
- [ ] 4.3 Channel-number entry & rapid zapping: numpad overlay for touch + desktop keyboard digit listening, with typed-digit pill feedback.
- [ ] 4.4 iOS 17.1+ enhanced HLS: use hls.js when `Hls.isSupported()` or `ManagedMediaSource` is present (hls.js 1.5.x), smooth fallback to native video; quality and audio/subtitle track selection on iPhone.
- [ ] 4.5 Opt-in playback proxy: Settings toggle + `?viaProxy`; `/api/fetch` forwards custom User-Agent and Referer, passes HTTP Range (multiview-compatible).
- [ ] 4.6 Multiview decode limits: mobile/iPhone ≤ 2 tiles, iPad/desktop ≤ 6 tiles.
- [ ] 4.7 On-screen controls: quick ±15s skip/replay beside the LIVE badge.

## Phase 5 — Library & EPG Parity

Gate: persistence survives reload and playlist re-import; PWA update flow tested.

- [ ] 5.1 Series progress & watched state: IndexedDB store keyed by series; episode toggles, progress bars, auto-resume ("Continue S2E5"), feeds Up-Next shelf.
- [ ] 5.2 Custom group management: long-press channel overflow sheet to move/organize channels into custom groups, persisted in local overrides, resilient to re-imports.
- [ ] 5.3 EPG timeline grid (`components/guide-grid.tsx`): channels × time scrollable grid, sticky channel header column, interactive NOW marker, tap programme to play/watch catch-up, bounded ±12h virtualized window.
- [ ] 5.4 PWA & data preservation: Service Worker update toast ("New version — Reload"), periodic backup-reminder nudge (iOS Safari storage eviction), support link in Settings.

## Port map (fill before Phase 2/4 coding)

| Reference source (`../m3u-playlist-la`) | Web target | What to port |
|---|---|---|
| D-pad / focus handling | `components/*`, focus hook | focus order, enter/back semantics |
| Catch-up URL builder | `lib/catchup.ts` | modes + templating rules |
| Media session/notification playback | `lib/media-session.ts` | controls, artwork, next track |
| Series grouping | `lib/series.ts` | grouping + numbering rules |
| EPG parsing | `lib/epg.ts` | XMLTV fields, timezone handling |

## Manual test matrix

- iPhone Safari (PWA installed + browser), iOS 17.1+ and older.
- iPad Safari, landscape/portrait.
- Desktop Chrome/Safari/Firefox + keyboard-only navigation.
- Playlist sizes: small, 5k channels, 50k channels (worker + guide virtualization).
- Live HLS, catch-up stream, restricted stream via proxy, multiview at tile cap.

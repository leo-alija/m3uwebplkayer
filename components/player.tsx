'use client';

import { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import type HlsJs from 'hls.js';
import { AppSettings, Channel, Program, SeriesEpisode } from '@/lib/types';
import { load, save } from '@/lib/storage';
import { isIOS, iosVersion, supportsMms, mmsEnabled, preferHlsJs } from '@/lib/env';
import { attachMediaSession } from '@/lib/media-session';
import { canDownload, isDownloaded, getDownloadBlob } from '@/lib/downloads';
import { proxiedStreamUrl } from '@/lib/hls-proxy';
import { IconClose, IconStar, IconPip, IconAirplay, IconPlus, IconPlayCircle, IconPauseCircle, IconChevron, IconCC, IconFullscreen, IconFullscreenExit, IconSettings, Poster } from './ui';

type Props = {
  channel: Channel;
  resume?: number;
  isFav: boolean;
  catchup?: boolean;
  nowNext?: { now?: Program; upcoming: Program[] };
  episodes?: SeriesEpisode[];
  meta?: any;
  appSettings?: AppSettings;
  /* zap to the previous/next channel of the live list (live TV only) */
  onZap?: (dir: 1 | -1) => void;
  /* the full ordered live list — powers the switcher, digits and "Last" */
  zapList?: Channel[];
  /* direct channel selection from the switcher / digits / "Last" */
  onSelectChannel?: (ch: Channel) => void;
  /* switcher shortcuts */
  recents?: Channel[];
  favourites?: Channel[];
  /* same-category channels for the "more channels" rail (live only) */
  related?: Channel[];
  onPlayRelated?: (ch: Channel) => void;
  onClose: () => void;
  onToggleFav: () => void;
  onAddMv: () => void;
  onProgress: (channelId: string, time: number, duration: number) => void;
  onPlayEpisode: (ep: SeriesEpisode) => void;
};

/* hls.js vs native HLS engine choice: on iOS < 17.1 there is no
   ManagedMediaSource, so the video element's native HLS is the only option;
   everywhere else (incl. iOS 17.1+ and desktop Safari) hls.js takes over so
   the quality/audio/subtitle menus work. */
function wantHlsJs() {
  return preferHlsJs(isIOS, iosVersion(), supportsMms(), mmsEnabled());
}

function fmtTime(s: number) {
  if (!Number.isFinite(s) || s < 0) return '0:00';
  const h = Math.floor(s / 3600); const m = Math.floor((s % 3600) / 60); const sec = Math.floor(s % 60);
  return (h ? `${h}:${String(m).padStart(2, '0')}` : `${m}`) + `:${String(sec).padStart(2, '0')}`;
}

/* settings-sheet building blocks */
function Pill({ active, onClick, children }: { active?: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button onClick={onClick} className={`press px-4 py-2 rounded-full text-[14px] font-semibold whitespace-nowrap ${active ? 'bg-white text-black' : 'bg-white/12 text-white/85'}`}>
      {children}
    </button>
  );
}

function SettingsSection({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-2">
      <div className="text-[12px] font-semibold uppercase tracking-wider text-white/45 px-1">{label}</div>
      <div className="flex flex-wrap gap-2">{children}</div>
    </div>
  );
}

/* Apple TV-style glass control button: 44px target, frosted disc */
function GlassBtn({ onClick, label, title, active, className = '', children, ...rest }: {
  onClick?: (e: React.MouseEvent) => void; label: string; title?: string; active?: boolean; className?: string; children: React.ReactNode;
  onPointerDown?: (e: React.PointerEvent) => void; onPointerUp?: (e: React.PointerEvent) => void;
  onPointerLeave?: (e: React.PointerEvent) => void; onPointerCancel?: (e: React.PointerEvent) => void;
}) {
  return (
    <button onClick={onClick} aria-label={label} title={title} {...rest}
      className={`press w-11 h-11 shrink-0 rounded-full bg-white/10 border border-white/10 backdrop-blur-md flex items-center justify-center text-white active:bg-white/25 ${active ? 'text-accent' : ''} ${className}`}>
      {children}
    </button>
  );
}

const escHtml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/* IPTV sources blip constantly. hls.js' default playlist retry budget (1-2
   attempts) is far too small for it — one failed playlist fetch away from a
   fatal error. These policies retry much harder before the fatal path (which
   runs the recovery ladder) ever fires. */
function loadPolicy(errorRetries: number, maxLoadTimeMs = 20_000, maxTimeToFirstByteMs = 10_000) {
  return {
    default: {
      maxTimeToFirstByteMs,
      maxLoadTimeMs,
      timeoutRetry: { maxNumRetry: 4, retryDelayMs: 1000, maxRetryDelayMs: 8000 },
      errorRetry: { maxNumRetry: errorRetries, retryDelayMs: 1000, maxRetryDelayMs: 8000 },
    },
  };
}

export default function Player(p: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const contRef = useRef<HTMLDivElement>(null);
  const hlsRef = useRef<HlsJs | null>(null);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastSave = useRef(0);
  const tapTime = useRef(0);
  const tapSide = useRef('');
  const subOverlayRef = useRef<HTMLDivElement>(null);
  const swipeStart = useRef<number | null>(null);
  const swipeDy = useRef(0);
  const scrubbingRef = useRef(false);
  const visited = useRef<string[]>([]);
  const freezeRef = useRef({ lastTime: -1, stuckSince: 0, stableSince: 0 });
  /* recovery ladder budget — attempts back off and refill after steady
     playback; hardFails counts consecutive full reloads without settling */
  const recovery = useRef({ count: 0, lastAttempt: 0, hardFails: 0 });
  const digitTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const holdTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const holdStepRef = useRef(10);
  const pausedSince = useRef(0);
  const [controls, setControls] = useState(true);
  const [airplay, setAirplay] = useState(false);
  const [pipOk, setPipOk] = useState(false);
  const [fs, setFs] = useState(false);
  const [settings, setSettings] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [buffering, setBuffering] = useState(true);
  const [blocked, setBlocked] = useState(false);
  const [muted, setMuted] = useState(false);
  const [volume, setVolume] = useState(1);
  const [error, setError] = useState('');
  const [time, setTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [buffered, setBuffered] = useState(0);
  const [levels, setLevels] = useState<{ i: number; label: string }[]>([]);
  const [curLevel, setCurLevel] = useState(-1);
  const [audioTracks, setAudioTracks] = useState<{ i: number; label: string }[]>([]);
  const [audioTrack, setAudioTrack] = useState(-1);
  const [subTracks, setSubTracks] = useState<{ i: number; label: string }[]>([]);
  const [subTrack, setSubTrack] = useState(-1);
  const [rate, setRate] = useState(1);
  const [flash, setFlash] = useState<'back' | 'fwd' | null>(null);
  const [behindLive, setBehindLive] = useState(false);
  const [dragY, setDragY] = useState(0);
  const [nextCountdown, setNextCountdown] = useState<null | { ep: SeriesEpisode; left: number | null }>(null);
  const [offlineUrl, setOfflineUrl] = useState<string | null>(null);
  const [offlineResolved, setOfflineResolved] = useState(false);
  const [aspect, setAspect] = useState<'fit' | 'fill' | 'zoom' | 'stretch'>('fit');
  const [inPip, setInPip] = useState(false);
  const [nativeControls, setNativeControls] = useState(false);
  const [scrubbing, setScrubbing] = useState(false);
  const [resumePrompt, setResumePrompt] = useState<number | null>(null);
  const [switcher, setSwitcher] = useState(false);
  const [switcherGroup, setSwitcherGroup] = useState('all');
  const [switcherQ, setSwitcherQ] = useState('');
  const [digits, setDigits] = useState('');
  const [recovering, setRecovering] = useState<string | null>(null);
  /* bumped to force a full source teardown + re-attach (hard recovery,
     Retry button) without changing the channel */
  const [nonce, setNonce] = useState(0);
  const [screensaver, setScreensaver] = useState(false);
  const [holdStep, setHoldStep] = useState(10);
  const [clockStr, setClockStr] = useState('');
  const [copied, setCopied] = useState(false);

  const live = p.channel.contentType !== 'MOVIE' && p.channel.contentType !== 'SERIES' && !p.catchup;
  const showSeek = !live && duration > 0;

  /* resolve offline copy (if this item was downloaded) */
  useEffect(() => {
    let url: string | null = null;
    let cancelled = false;
    setOfflineUrl(null);
    setOfflineResolved(false);
    (async () => {
      try {
        if (canDownload(p.channel.url) && await isDownloaded(p.channel.id)) {
          const blob = await getDownloadBlob(p.channel.id);
          if (blob && !cancelled) {
            url = URL.createObjectURL(blob);
            setOfflineUrl(url);
          }
        }
      } finally {
        if (!cancelled) setOfflineResolved(true);
      }
    })();
    return () => { cancelled = true; if (url) URL.revokeObjectURL(url); };
  }, [p.channel.id, p.channel.url]);

  /* next episode for series */
  const nextEp = useMemo(() => {
    if (!p.episodes || p.episodes.length < 2) return null;
    const i = p.episodes.findIndex((e) => e.channel.id === p.channel.id);
    if (i === -1 || i >= p.episodes.length - 1) return null;
    const rest = p.episodes.slice(i + 1).sort((a, b) => a.seasonNumber - b.seasonNumber || a.episodeNumber - b.episodeNumber);
    return rest[0];
  }, [p.episodes, p.channel.id]);

  /* controls never auto-hide while paused (Netflix behaviour) */
  const showControls = useCallback((sticky = false) => {
    setControls(true);
    if (hideTimer.current) clearTimeout(hideTimer.current);
    if (!sticky && !videoRef.current?.paused) {
      hideTimer.current = setTimeout(function tick() {
        /* mid-scrub the timer re-arms instead of hiding the bar */
        if (scrubbingRef.current) { hideTimer.current = setTimeout(tick, 4200); return; }
        setControls(false);
      }, 4200);
    }
  }, []);

  useEffect(() => { showControls(); return () => { if (hideTimer.current) clearTimeout(hideTimer.current); }; }, []);
  useEffect(() => { setAirplay('WebKitPlaybackTargetAvailabilityEvent' in window); }, []);
  useEffect(() => {
    const probe = document.createElement('video');
    setPipOk('requestPictureInPicture' in HTMLVideoElement.prototype || 'webkitSetPresentationMode' in probe);
  }, []);
  useEffect(() => { setAspect(load('aspectMode', 'fit')); }, []);

  /* picture modes (Fit/Fill/Zoom/Stretch) applied straight to the video box */
  const aspectStyle: React.CSSProperties | undefined =
    aspect === 'fill' ? { objectFit: 'cover' }
    : aspect === 'zoom' ? { objectFit: 'cover', transform: 'scale(1.25)' }
    : aspect === 'stretch' ? { objectFit: 'fill' }
    : undefined;
  function setAspectMode(a: 'fit' | 'fill' | 'zoom' | 'stretch') { setAspect(a); save('aspectMode', a); }

  /* fullscreen state follows the browser so the button (and Escape) stay in sync */
  useEffect(() => {
    const d = document as any;
    const onChange = () => setFs(!!(d.fullscreenElement || d.webkitFullscreenElement));
    document.addEventListener('fullscreenchange', onChange);
    document.addEventListener('webkitfullscreenchange', onChange);
    return () => {
      document.removeEventListener('fullscreenchange', onChange);
      document.removeEventListener('webkitfullscreenchange', onChange);
    };
  }, []);

  /* ---------- picture-in-picture (the iPhone "small window") ----------
     iOS binds the floating window's play/pause/seek transport to the
     element's NATIVE controls; with controls={false} they are dead buttons
     and the stream can't be paused from the small window. While the video
     lives in PiP we therefore hand control to Safari's native transport and
     park our own overlay; when it returns inline we take the wheel again. */
  useEffect(() => {
    const v = videoRef.current as any;
    if (!v) return;
    const isWebkit = typeof v.webkitSetPresentationMode === 'function';
    const sync = () => {
      const pip = v.webkitPresentationMode === 'picture-in-picture';
      setInPip(pip);
      if (isWebkit) setNativeControls(pip);
      if (!pip) showControls(true);
    };
    const enter = () => { setInPip(true); if (isWebkit) setNativeControls(true); };
    const leave = () => { setInPip(false); if (isWebkit) setNativeControls(false); showControls(true); };
    v.addEventListener('webkitpresentationmodechanged', sync);
    v.addEventListener('enterpictureinpicture', enter);
    v.addEventListener('leavepictureinpicture', leave);
    return () => {
      v.removeEventListener('webkitpresentationmodechanged', sync);
      v.removeEventListener('enterpictureinpicture', enter);
      v.removeEventListener('leavepictureinpicture', leave);
    };
  }, [showControls]);

  /* "Last" channel history: every channel change is remembered (dedup) */
  useEffect(() => {
    setResumePrompt(null);
    visited.current = [p.channel.id, ...visited.current.filter((x) => x !== p.channel.id)].slice(0, 6);
  }, [p.channel.id]);

  /* frozen-picture watchdog: the element claims to be playing but the clock
     is stuck (starved buffer, dead CDN, decoder hiccup) → graduated recovery
     (see beginRecovery). Steady playback refills the recovery budget, so one
     bad patch never poisons the whole session. Skipped while the user is
     scrubbing, paused or mid-stall during the initial load (hls.js fatal
     errors cover the never-started case; this watches the mid-play freezes). */
  useEffect(() => {
    const t = setInterval(() => {
      const v = videoRef.current;
      if (!v || v.paused || v.ended || scrubbingRef.current) {
        freezeRef.current.stuckSince = 0;
        return;
      }
      const now = Date.now();
      const advancing = Number.isFinite(v.currentTime)
        && Math.abs(v.currentTime - freezeRef.current.lastTime) >= 0.2;
      freezeRef.current.lastTime = v.currentTime;
      if (advancing) {
        freezeRef.current.stuckSince = 0;
        if (!freezeRef.current.stableSince) freezeRef.current.stableSince = now;
        else if (recovery.current.count && now - freezeRef.current.stableSince > 20_000) {
          recovery.current = { count: 0, lastAttempt: 0, hardFails: 0 };
        }
        return;
      }
      freezeRef.current.stableSince = 0;
      /* only a stall AFTER data has flowed counts — the first load is
         guarded by hls.js/network timeouts instead */
      if (!v.buffered.length && !v.currentTime) return;
      if (!freezeRef.current.stuckSince) freezeRef.current.stuckSince = now;
      else if (now - freezeRef.current.stuckSince > (live ? 5000 : 9000)) {
        freezeRef.current.stuckSince = now;
        beginRecovery(live ? 'Live stream stalled' : 'Playback stalled');
      }
    }, 1500);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [live]);

  /* screensaver: paused/frozen too long → drifting clock overlay */
  useEffect(() => {
    const mins = p.appSettings?.screensaverMinutes ?? 10;
    if (!mins) return;
    if (playing || inPip || error || blocked) { pausedSince.current = 0; setScreensaver(false); return; }
    pausedSince.current = Date.now();
    const t = setInterval(() => {
      if (pausedSince.current && Date.now() - pausedSince.current > mins * 60_000) setScreensaver(true);
    }, 5000);
    return () => clearInterval(t);
  }, [playing, inPip, error, blocked, p.appSettings?.screensaverMinutes]);

  /* channel digits: type a number, committed 1.5s after the last digit */
  function pushDigit(d: string) {
    if (!p.zapList) return;
    if (digitTimer.current) clearTimeout(digitTimer.current);
    setDigits((cur) => {
      const next = (cur + d).slice(0, 4);
      digitTimer.current = setTimeout(() => commitDigits(next), 1500);
      return next;
    });
    showControls(true);
  }
  function commitDigits(num: string) {
    setDigits('');
    if (!num || !p.zapList) return;
    const n = parseInt(num, 10);
    const exact = p.zapList.find((c) => c.channelNumber === n);
    const prefix = p.zapList.find((c) => String(c.channelNumber || '').startsWith(num));
    const target = exact || prefix;
    if (target && p.onSelectChannel) p.onSelectChannel(target);
    showControls(true);
  }

  /* screensaver clock */
  useEffect(() => {
    if (!screensaver) return;
    const tick = () => setClockStr(new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }));
    tick();
    const t = setInterval(tick, 10_000);
    return () => clearInterval(t);
  }, [screensaver]);

  /* channel switcher: snapshot of the zap list taken when it opens, so the
     list can't reorder under the cursor while it's up */
  const switcherData = useMemo(() => {
    if (!switcher || !p.zapList) return null;
    const groups = new Map<string, Channel[]>();
    for (const c of p.zapList) {
      for (const g of (c.groups || [c.group || 'Uncategorized'])) {
        if (!groups.has(g)) groups.set(g, []);
        groups.get(g)!.push(c);
      }
    }
    return Array.from(groups.entries())
      .map(([g, chs]) => ({ g, chs: chs.filter((c, i, arr) => arr.findIndex((x) => x.id === c.id) === i) }))
      .sort((a, b) => b.chs.length - a.chs.length);
  }, [switcher, p.zapList]);

  const switcherChannels = useMemo(() => {
    if (!switcherData) return [];
    let l = switcherGroup === 'all' ? p.zapList || [] : switcherData.find((x) => x.g === switcherGroup)?.chs || [];
    if (switcherGroup === '__recent') l = p.recents || [];
    if (switcherGroup === '__fav') l = p.favourites || [];
    if (switcherQ) l = l.filter((c) => c.name.toLowerCase().includes(switcherQ.toLowerCase()));
    return l.slice(0, 300);
  }, [switcherData, switcherGroup, switcherQ, p.zapList, p.recents, p.favourites]);

  /* ---------- source attach ---------- */
  useEffect(() => {
    const video = videoRef.current;
    if (!video || !p.channel || !offlineResolved) return;
    setPlaying(false); setBuffering(true); setError(''); setRecovering(null); setTime(0); setDuration(0); setBuffered(0);
    setLevels([]); setCurLevel(-1); setAudioTracks([]); setAudioTrack(-1); setSubTracks([]); setSubTrack(-1); setRate(1); setNextCountdown(null);
    if (hlsRef.current) { hlsRef.current.destroy(); hlsRef.current = null; }
    /* Cross-origin stream URLs point at the provider, which usually blocks
       direct browser requests (CORS / header checks) — proxiedStreamUrl runs
       them through /api/fetch with server-side manifest rewriting, for both
       the hls.js engine and native HLS on older iOS. Offline copies and
       same-origin URLs load as-is. */
    const url = offlineUrl || proxiedStreamUrl(p.channel.url);
    const isHlsUrl = /m3u8/.test(p.channel.url);
    let cancelled = false;

    (async () => {
      const Hls = (await import('hls.js')).default;
      if (cancelled) return;
      let mediaRetries = 0;
      if (isHlsUrl && wantHlsJs() && Hls.isSupported()) {
        /* switching engines on a reused <video> needs the old src dropped */
        if (video.src) { video.removeAttribute('src'); video.load(); }
        const hls = new Hls({
          enableWorker: true,
          lowLatencyMode: true,
          backBufferLength: 90,
          manifestLoadPolicy: loadPolicy(3, 20_000, Infinity),
          playlistLoadPolicy: loadPolicy(6),
          fragLoadPolicy: loadPolicy(8, 120_000),
        });
        hlsRef.current = hls;
        hls.loadSource(url);
        hls.attachMedia(video);
        hls.on(Hls.Events.MANIFEST_PARSED, (_e, data) => {
          /* a freshly parsed manifest is real progress — refill the soft
             budget; hardFails only clears after steady playback (watchdog) */
          recovery.current.count = 0;
          setLevels(data.levels.map((l, i) => ({ i, label: l.height ? `${l.height}p` : `${Math.round((l.bitrate || 0) / 1000)}k` })));
        });
        hls.on(Hls.Events.LEVEL_SWITCHED, (_e, data) => setCurLevel(hls.autoLevelEnabled ? -1 : data.level));
        hls.on(Hls.Events.AUDIO_TRACKS_UPDATED, () => {
          const names = new Set<string>();
          setAudioTracks(hls.audioTracks.map((a, i) => {
            let label = a.name || a.lang || `Track ${i + 1}`;
            let n = 2; let base = label;
            while (names.has(label)) label = `${base} ${n++}`;
            names.add(label);
            return { i, label };
          }));
          /* globally remembered audio language reapplied to every stream */
          const pref = load('audioLang', '');
          if (pref) {
            const idx = hls.audioTracks.findIndex((a) => (a.lang || a.name || '') === pref);
            if (idx >= 0) { hls.audioTrack = idx; setAudioTrack(idx); }
          }
        });
        hls.on(Hls.Events.SUBTITLE_TRACKS_UPDATED, () => {
          const names = new Set<string>();
          setSubTracks(hls.subtitleTracks.map((s, i) => {
            let label = s.name || s.lang || `Subs ${i + 1}`;
            let n = 2; let base = label;
            while (names.has(label)) label = `${base} ${n++}`;
            names.add(label);
            return { i, label };
          }));
          const pref = load('subLang', '');
          if (pref) {
            const idx = hls.subtitleTracks.findIndex((s) => (s.lang || s.name || '') === pref);
            if (idx >= 0) { hls.subtitleTrack = idx; setSubTrack(idx); }
          }
          enforceTrackModes();
          renderSubtitles();
        });
        hls.on(Hls.Events.SUBTITLE_TRACK_SWITCH, () => {
          enforceTrackModes();
          renderSubtitles();
        });
        hls.on(Hls.Events.ERROR, (_e, data) => {
          if (!data.fatal) return;
          switch (data.type) {
            case Hls.ErrorTypes.NETWORK_ERROR:
              /* hls.js already burned its own retry budget — run the shared
                 recovery ladder (soft startLoad first, full reload later) */
              beginRecovery('Network error');
              break;
            case Hls.ErrorTypes.MEDIA_ERROR:
              {
                /* first media error → hls.js' own buffer reset; repeat offenders
                   go straight to a full reload, which rebuilds the decoder */
                if (mediaRetries++ === 0) {
                  try { hls.recoverMediaError(); } catch { beginRecovery('Decoder error', true); }
                } else {
                  beginRecovery('Decoder error', true);
                }
              }
              break;
            default:
              beginRecovery('Stream error', true);
          }
        });
      } else {
        video.src = url; /* native HLS on iOS, or plain mp4 */
      }

      /* >10s of saved position asks first (Netflix-style); tiny leftovers
         (<10s) just resume silently */
      if (p.resume && p.resume > 10) {
        setResumePrompt(p.resume);
      } else if (p.resume && p.resume > 5) {
        const seekResume = () => { try { video.currentTime = p.resume!; } catch {} };
        /* metadata may already be in by the time we get here */
        if (video.readyState >= 1) seekResume();
        else video.addEventListener('loadedmetadata', seekResume, { once: true });
      }
      video.play().then(() => setBuffering(false)).catch(() => {
        /* autoplay blocked — surface a persistent tap-to-play instead of a dead black frame */
        if (!cancelled) {
          setBuffering(false);
          setBlocked(true);
          showControls(true);
        }
      });
    })();

    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [p.channel.id, offlineResolved, offlineUrl, nonce]);

  /* cleanup */
  useEffect(() => () => {
    if (hideTimer.current) clearTimeout(hideTimer.current);
    hlsRef.current?.destroy();
  }, []);

  /* ---------- subtitles: custom Apple TV–style renderer ----------
     hls.js leaves the selected text track mode='showing', and streams that
     flag a track as DEFAULT end up with TWO tracks showing at once (double
     captions). Native rendering also draws cues inside the scaled <video>,
     so Fill/Zoom picture modes crop them away. Instead: force every track
     to 'hidden' (cues still load), and paint the active cue of the selected
     track into our own overlay, bottom-centred in the video area. */
  function enforceTrackModes() {
    const v = videoRef.current;
    if (!v) return;
    for (const t of Array.from(v.textTracks)) {
      if (t.mode === 'showing') t.mode = 'hidden';
    }
  }
  function renderSubtitles() {
    const el = subOverlayRef.current;
    const v = videoRef.current;
    const h = hlsRef.current;
    if (!el) return;
    let html = '';
    if (h && v && h.subtitleTrack > -1) {
      enforceTrackModes();
      const st = h.subtitleTracks[h.subtitleTrack];
      const kind = st && st.type === 'SUBTITLES' ? 'subtitles' : 'captions';
      const tracks = Array.from(v.textTracks);
      const track = (st && (
        tracks.find((t) => t.kind === kind && t.label === st.name && (!st.lang || t.language === st.lang))
        || tracks.find((t) => t.kind === kind && t.label === st.name)
        || tracks.find((t) => t.kind === kind && st.lang && t.language === st.lang)
      )) || null;
      if (track && track.cues && Number.isFinite(v.currentTime)) {
        html = Array.from(track.cues)
          .filter((c) => c.startTime <= v.currentTime && v.currentTime < c.endTime)
          .map((c) => `<div class="sub-cue-line">${escHtml(String((c as VTTCue).text)).replace(/\n/g, '<br/>')}</div>`)
          .join('');
      }
    }
    if ((el as any).__html !== html) { el.innerHTML = html; (el as any).__html = html; }
  }

  /* Media Session — lock screen / control centre info + remote handlers */
  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    const detach = attachMediaSession(
      { title: p.channel.name, artist: live ? 'Live TV' : p.channel.group || undefined, album: offlineUrl ? 'Offline' : undefined, artworkUrl: '/icon-512.png' },
      {
        play: () => requestPlay(),
        pause: () => v.pause(),
        seekBack: () => { if (!live) v.currentTime = Math.max(0, v.currentTime - 10); },
        seekForward: () => { if (!live) v.currentTime += 10; },
        seekTo: (t) => { if (!live) v.currentTime = t; },
        stop: () => p.onClose(),
      },
    );
    return detach;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [p.channel.id, p.channel.name, p.channel.group, live, offlineUrl, p.onClose]);

  /* wake lock — re-acquire after the screen comes back */
  useEffect(() => {
    let wl: any = null;
    const acquire = () => {
      (navigator as any).wakeLock?.request('screen')
        .then((l: any) => (wl = l))
        .catch(() => {});
    };
    if ('wakeLock' in navigator) acquire();
    const onVis = () => {
      if (document.visibilityState === 'hidden') { wl?.release?.().catch?.(() => {}); wl = null; }
      else if (!wl) acquire();
    };
    document.addEventListener('visibilitychange', onVis);
    return () => {
      document.removeEventListener('visibilitychange', onVis);
      wl?.release?.().catch?.(() => {});
    };
  }, []);

  /* ---------- video events ---------- */
  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    const onTime = () => {
      /* self-heal the play/pause buttons if an event was missed (iOS
         native fullscreen, AirPlay, stalled loads) */
      setPlaying(!v.paused);
      setTime(v.currentTime);
      if (Number.isFinite(v.duration)) setDuration(v.duration);
      try { if (v.buffered.length) setBuffered(v.buffered.end(v.buffered.length - 1)); } catch {}
      if (live) {
        const edge = liveEdge();
        setBehindLive(Number.isFinite(edge) ? edge - v.currentTime > 15 : false);
      }
      if (!live && Date.now() - lastSave.current > 8000) {
        lastSave.current = Date.now();
        p.onProgress(p.channel.id, v.currentTime, v.duration);
      }
      /* Up Next card ~30s before the episode ends */
      if (!live && nextEp && Number.isFinite(v.duration) && v.duration > 0) {
        const remaining = v.duration - v.currentTime;
        if (remaining <= 30 && remaining > 3) {
          setNextCountdown((nc) => nc || { ep: nextEp, left: p.appSettings?.autoPlayNext === false ? null : 15 });
        }
      }
      renderSubtitles();
    };
    const handlers: [string, () => void][] = [
      ['timeupdate', onTime], ['loadedmetadata', onTime], ['progress', onTime],
      ['play', () => { setPlaying(true); showControls(); }],
      ['pause', () => { setPlaying(false); showControls(true); if (!live) p.onProgress(p.channel.id, v.currentTime, v.duration); }],
      ['waiting', () => setBuffering(true)], ['playing', () => { setBuffering(false); setPlaying(true); setBlocked(false); setRecovering(null); showControls(); }],
      ['volumechange', () => { setMuted(v.muted); setVolume(v.volume); }],
      ['error', () => {
        /* native-HLS failures surface here (hls.js intercepts its own). Live
           channels get the recovery ladder before the visible error; VOD
           usually means a genuinely broken file. */
        if (live) beginRecovery('Stream error', true);
        else { setError('This stream could not be played.'); setBuffering(false); }
      }],
    ];
    handlers.forEach(([evt, fn]) => v.addEventListener(evt, fn));
    const onEnded = () => {
      /* history closing book */
      p.onProgress(p.channel.id, 0, v.duration);
      if (nextEp && !live) {
        setNextCountdown((nc) => nc || { ep: nextEp, left: p.appSettings?.autoPlayNext === false ? null : 15 });
      }
    };
    v.addEventListener('ended', onEnded);
    return () => {
      handlers.forEach(([evt, fn]) => v.removeEventListener(evt, fn));
      v.removeEventListener('ended', onEnded);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [p.channel.id, nextEp, live, p.appSettings?.autoPlayNext]);

  /* countdown ticker (null left = wait for the user) */
  useEffect(() => {
    if (!nextCountdown || nextCountdown.left == null) return;
    const t = setInterval(() => {
      setNextCountdown((nc) => {
        if (!nc || nc.left == null) return nc;
        if (nc.left <= 1) {
          p.onPlayEpisode(nc.ep);
          return null;
        }
        return { ...nc, left: nc.left - 1 };
      });
    }, 1000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nextCountdown?.ep]);

  useEffect(() => {
    /* after channel change, save position is not needed; recovery budget starts fresh */
    setTime(0); setDuration(0);
    recovery.current = { count: 0, lastAttempt: 0, hardFails: 0 };
  }, [p.channel.id]);

  /* ---------- gestures ---------- */
  function onVideoTap(e: React.MouseEvent) {
    const now = Date.now();
    const x = e.clientX - window.innerWidth / 2;
    const side = x < -40 ? 'back' : x > 40 ? 'fwd' : 'mid';
    if (now - tapTime.current < 300 && tapSide.current === side) {
      tapTime.current = 0;
      if (side === 'mid') {
        toggleFullscreen(); /* double-tap the picture like YouTube */
      } else {
        /* double tap → seek ±10 */
        const v = videoRef.current;
        if (v && !live) {
          v.currentTime = Math.max(0, Math.min(v.duration || 1e9, v.currentTime + (side === 'back' ? -10 : 10)));
          setFlash(side === 'back' ? 'back' : 'fwd');
          setTimeout(() => setFlash(null), 400);
        }
      }
      return;
    }
    tapTime.current = now;
    tapSide.current = side;
    setTimeout(() => {
      if (tapTime.current !== now) return;
      if (settings) { setSettings(false); return; }
      if (controls) setControls(false);
      else showControls();
    }, 260);
  }

  /* swipe down on the picture to dismiss (iOS sheet gesture) */
  function onTouchStart(e: React.TouchEvent) {
    swipeStart.current = e.touches[0].clientY;
    swipeDy.current = 0;
  }
  function onTouchMove(e: React.TouchEvent) {
    if (swipeStart.current === null || fs) return;
    const dy = Math.max(0, e.touches[0].clientY - swipeStart.current);
    swipeDy.current = dy;
    setDragY(dy);
  }
  function onTouchEnd() {
    /* read the live offset from a ref — state may still be batched */
    const dy = swipeDy.current;
    swipeDy.current = 0;
    swipeStart.current = null;
    setDragY(0);
    if (!fs && dy > 90) p.onClose();
  }

  /* ---------- keyboard ---------- */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const v = videoRef.current;
      if (!v) return;
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      if (/^[0-9]$/.test(e.key)) {
        if (live) { e.preventDefault(); pushDigit(e.key); }
        else if (!live && duration > 0) { e.preventDefault(); seekTo(duration * (parseInt(e.key, 10) * 10) / 100); }
        return;
      }
      if (e.key === 'Backspace') {
        /* "Last": hop back through the last five channels */
        const prevId = visited.current[1];
        const prev = prevId && p.zapList?.find((c) => c.id === prevId);
        if (prev && p.onSelectChannel) { e.preventDefault(); p.onSelectChannel(prev); }
        return;
      }
      if (e.key === ' ' || e.key === 'k') { e.preventDefault(); v.paused ? requestPlay() : v.pause(); showControls(); }
      else if (e.key === 'ArrowRight') { if (!live) { v.currentTime += 10; setFlash('fwd'); setTimeout(() => setFlash(null), 400); showControls(); } }
      else if (e.key === 'ArrowLeft') {
        if (live && p.zapList && p.onSelectChannel) { e.preventDefault(); setSwitcher(true); showControls(true); }
        else if (!live) { v.currentTime -= 10; setFlash('back'); setTimeout(() => setFlash(null), 400); showControls(); }
      }
      else if (e.key === 'ArrowDown') {
        /* live TV: up/down zap channels like a set-top box; otherwise volume */
        if (live && p.onZap) { e.preventDefault(); p.onZap(-1); }
        else v.volume = Math.max(0, v.volume - 0.1);
      }
      else if (e.key === 'ArrowUp') {
        if (live && p.onZap) { e.preventDefault(); p.onZap(1); }
        else v.volume = Math.min(1, v.volume + 0.1);
      }
      else if (e.key === 'm' || e.key === 'M') { v.muted = !v.muted; setMuted(v.muted); showControls(); }
      else if (e.key === 'c' || e.key === 'C') { toggleCC(); showControls(); }
      else if (e.key === 'Escape') {
        if (switcher) { setSwitcher(false); return; }
        if (screensaver) { setScreensaver(false); pausedSince.current = Date.now(); return; }
        /* first Escape leaves fullscreen; only close the player when inline */
        const d = document as any;
        if (!d.fullscreenElement && !d.webkitFullscreenElement) { if (settings) setSettings(false); else p.onClose(); }
      }
      else if (e.key === 'f' || e.key === 'F') toggleFullscreen();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [live, p.onClose, p.onZap, settings, switcher, screensaver, duration, p.zapList, p.onSelectChannel]);

  /* ---------- actions ---------- */
  /* iOS quirk: play() can reject (interruption, aborted load) without a
     follow-up pause event, leaving every pause button stuck on the wrong
     icon. Optimistically flip the state and revert if the promise fails. */
  function requestPlay() {
    const v = videoRef.current;
    if (!v) return;
    setPlaying(true);
    v.play().catch(() => { if (videoRef.current === v) setPlaying(false); });
  }
  function togglePlay(e?: React.MouseEvent | React.TouchEvent) {
    if (e) e.stopPropagation();
    const v = videoRef.current;
    if (!v) return;
    if (v.paused) requestPlay();
    else { setPlaying(false); v.pause(); }
    showControls();
  }
  function toggleMute() {
    const v = videoRef.current;
    if (v) { v.muted = !v.muted; setMuted(v.muted); showControls(); }
  }
  function togglePip(e?: React.MouseEvent) {
    e?.stopPropagation();
    const v = videoRef.current as any;
    try {
      if (v.webkitSetPresentationMode) {
        v.webkitSetPresentationMode(v.webkitPresentationMode === 'picture-in-picture' ? 'inline' : 'picture-in-picture');
      } else if ((document as any).pictureInPictureElement) {
        (document as any).exitPictureInPicture();
      } else if (v.requestPictureInPicture) {
        v.requestPictureInPicture();
      }
    } catch {}
  }
  function toggleAirPlay(e?: React.MouseEvent) {
    e?.stopPropagation();
    const v = videoRef.current as any;
    try { v?.webkitShowPlaybackTargetPicker?.(); } catch {}
  }
  function seekTo(t: number) { const v = videoRef.current; if (v) { v.currentTime = t; setTime(t); showControls(true); } }
  function skip(d: number) { const v = videoRef.current; if (!v || live) return; v.currentTime = Math.max(0, Math.min(v.duration || 1e9, v.currentTime + d)); showControls(true); }

  /* hold-to-accelerate seek: keep a ±10 button held and the step climbs
     10s → 30s → 60s; the seek applies once on release */
  function holdStart() {
    if (holdTimer.current) clearInterval(holdTimer.current);
    holdStepRef.current = 10;
    setHoldStep(10);
    holdTimer.current = setInterval(() => {
      holdStepRef.current = holdStepRef.current >= 60 ? 60 : holdStepRef.current === 10 ? 30 : 60;
      setHoldStep(holdStepRef.current);
    }, 700);
  }
  function holdEnd(dir: 1 | -1) {
    if (holdTimer.current) { clearInterval(holdTimer.current); holdTimer.current = null; }
    if (!live) skip(dir * holdStepRef.current);
    holdStepRef.current = 10;
    setHoldStep(10);
  }
  function holdCancel() {
    if (holdTimer.current) { clearInterval(holdTimer.current); holdTimer.current = null; }
    holdStepRef.current = 10;
    setHoldStep(10);
  }
  /* ---------- live edge ---------- */
  /* hls.js knows its sync position; native HLS falls back to the end of the
     sliding window */
  function liveEdge(): number {
    const v = videoRef.current;
    if (!v) return NaN;
    const h = hlsRef.current;
    const edge = h && h.liveSyncPosition != null && Number.isFinite(h.liveSyncPosition) ? h.liveSyncPosition
      : Number.isFinite(v.duration) && v.duration > 0 ? v.duration - 0.5 : NaN;
    return edge as number;
  }

  function goLive() {
    const v = videoRef.current;
    const edge = liveEdge();
    if (v && Number.isFinite(edge)) {
      v.currentTime = edge;
      requestPlay();
    }
    showControls(true);
  }

  /* ---------- stream recovery (anti-freeze) ----------
     IPTV sources drop out constantly: CDNs blip, playlists stall, decoders
     choke. Recovery is graduated and budgeted:
       soft — restart hls.js loading in place (or reload the native src) and
              snap back to the live edge; keeps the decoder and the buffer
       hard — full teardown: re-run the attach effect with a fresh hls.js
              instance / src (nonce bump)
     Attempts back off 0,1,2,4,8s. Three soft attempts, then hard reloads;
     four hard reloads without settling → visible error with Retry. The
     budget refills after ~20s of steady playback or a fresh manifest parse. */
  function softRecover() {
    const v = videoRef.current;
    if (!v) return;
    const h = hlsRef.current;
    if (h) {
      /* restart playlist/fragment loading in place */
      try { h.stopLoad(); h.startLoad(); } catch {}
    } else {
      try { v.load(); } catch {}
    }
    /* a stall usually means the buffer fell behind the provider's sliding
       window — resume at the live edge, not on segments about to expire */
    const edge = liveEdge();
    if (live && Number.isFinite(edge) && edge - v.currentTime > 2) {
      try { v.currentTime = edge; } catch {}
    }
    requestPlay();
  }

  function beginRecovery(reason: string, forceHard = false) {
    const now = Date.now();
    const rec = recovery.current;
    const wait = rec.count === 0 ? 0 : Math.min(8000, 1000 * 2 ** (rec.count - 1));
    if (now - rec.lastAttempt < wait) return;
    if (rec.hardFails >= 4) {
      /* reconnecting isn't sticking — surface it instead of looping forever */
      setRecovering(null);
      setBuffering(false);
      setError(live ? 'This channel keeps dropping out. Tap retry to reconnect.' : 'This stream could not be played.');
      return;
    }
    rec.count += 1;
    rec.lastAttempt = now;
    const hard = forceHard || rec.count > 3;
    if (hard) rec.hardFails += 1;
    setRecovering(`${reason} — reconnecting (attempt ${rec.count})`);
    if (hard) setNonce((n) => n + 1);
    else softRecover();
  }
  function setRate2(r: number) { const v = videoRef.current; if (v) { v.playbackRate = r; setRate(r); } }
  function setLevel(i: number) { setCurLevel(i); if (hlsRef.current) hlsRef.current.currentLevel = i; }
  function setAudio(i: number) {
    setAudioTrack(i);
    if (hlsRef.current) {
      hlsRef.current.audioTrack = i;
      const t = hlsRef.current.audioTracks[i];
      if (t) save('audioLang', t.lang || t.name || '');
    }
  }
  function setSub(i: number) {
    setSubTrack(i);
    save('subLang', (hlsRef.current?.subtitleTracks?.[i] && (hlsRef.current.subtitleTracks[i].lang || hlsRef.current.subtitleTracks[i].name)) || '');
    if (hlsRef.current) { hlsRef.current.subtitleTrack = i; }
    enforceTrackModes();
    renderSubtitles();
  }
  /* CC button: flip between the last chosen track and off */
  function toggleCC() {
    if (!subTracks.length) return;
    setSub(subTrack >= 0 ? -1 : (lastSub.current >= 0 ? lastSub.current : 0));
  }
  function toggleFullscreen() {
    const d = document as any;
    const el = contRef.current as any;
    const v = videoRef.current as any;
    setSettings(false);
    showControls(true);
    try {
      if (d.fullscreenElement || d.webkitFullscreenElement) {
        (d.exitFullscreen?.() ?? d.webkitExitFullscreen?.())?.catch?.(() => {});
        (screen.orientation as any)?.unlock?.();
      } else {
        /* landscape lock where supported (Android/Chrome); iOS ignores it and
           relies on the user rotating, native video fullscreen auto-rotates */
        (screen.orientation as any)?.lock?.('landscape')?.catch?.(() => {});
        let req = el?.requestFullscreen?.();
        if (!req && el?.webkitRequestFullscreen) { el.webkitRequestFullscreen(); req = null; }
        if (req?.catch) req.catch(() => {});
        if (!el?.requestFullscreen && !el?.webkitRequestFullscreen) v?.webkitEnterFullscreen?.();
      }
    } catch {}
  }

  const lastSub = useRef(-1);
  const liked = p.isFav;

  return (
    <div ref={contRef} className="player-overlay flex flex-col md:flex-row player-root">
      {/* VIDEO AREA */}
      <div className="relative bg-black shrink-0 player-video-area"
        style={{ paddingBottom: 'env(safe-area-inset-top)', transform: dragY ? `translateY(${Math.min(dragY, 160)}px)` : undefined, transition: dragY ? 'none' : 'transform 0.25s ease' }}>
        <video
          ref={videoRef}
          playsInline autoPlay controls={nativeControls}
          x-webkit-airplay="allow"
          onClick={onVideoTap}
          onTouchStart={onTouchStart}
          onTouchMove={onTouchMove}
          onTouchEnd={onTouchEnd}
          style={aspectStyle}
          className="w-full h-full bg-black player-video"
        />

        {/* custom subtitle overlay (Apple TV–style cues, never cropped);
            slides above the control bar while controls are visible */}
        <div ref={subOverlayRef} aria-live="off"
          className="pointer-events-none absolute inset-x-0 bottom-0 z-[5] flex flex-col items-center gap-1 px-6 transition-transform duration-200"
          style={{
            paddingBottom: 'calc(16px + var(--safe-b, 0px))',
            transform: controls ? 'translateY(-56px)' : undefined,
          }} />

        {buffering && !error && !inPip && (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <div className="w-11 h-11 border-2 border-white/15 border-t-white/90 rounded-full animate-spin" />
          </div>
        )}
        {inPip && !error && (
          <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-3 bg-black/85 text-center">
            <IconPip className="w-10 h-10 text-white/50" />
            <div className="text-[14px] font-semibold text-white/80">Playing in Picture-in-Picture</div>
            <div className="text-[12px] text-white/40">Pause, seek and volume live on the small window</div>
            <button onClick={togglePip} className="press px-5 py-2.5 rounded-xl bg-accent text-black text-[15px] font-bold">Bring back here</button>
          </div>
        )}
        {flash && (
          <div className={`absolute top-1/2 -translate-y-1/2 ${flash === 'back' ? 'left-10' : 'right-10'} pointer-events-none fade-in`}>
            <div className="bg-black/55 backdrop-blur rounded-full px-4 py-2 text-white text-[13px] font-semibold">
              {flash === 'back' ? '« 10s' : '10s »'}
            </div>
          </div>
        )}
        {blocked && !error && (
          <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-2 bg-black/45"
            onClick={() => { setBlocked(false); requestPlay(); showControls(true); }}>
            <IconPlayCircle className="w-16 h-16 text-white drop-shadow-2xl" />
            <span className="text-[13px] font-semibold text-white/85">Tap to play</span>
          </div>
        )}
        {error && (
          <div className="absolute inset-0 z-20 flex flex-col items-center justify-center gap-3 px-8 text-center bg-black/75">
            <button onClick={p.onClose} aria-label="Close player" className="press absolute top-[max(12px,var(--safe-t,0px))] left-3 p-2 text-white"><IconClose className="w-6 h-6" /></button>
            <div className="text-white/90 text-[15px]">{error}</div>
            <button onClick={(e) => {
              e.stopPropagation();
              /* full clean reconnect — fresh hls.js instance / src via the
                 attach effect, never a bare video.load() */
              setError(''); setBuffering(true); setRecovering(null);
              recovery.current = { count: 0, lastAttempt: 0, hardFails: 0 };
              setNonce((n) => n + 1);
              showControls(true);
            }}
              className="press px-5 py-2.5 rounded-xl bg-accent text-black text-[15px] font-bold">Retry</button>
            <a href={p.channel.url} target="_blank" rel="noreferrer" className="press text-white/50 text-xs underline">Open stream URL</a>
          </div>
        )}

        {/* RESUME dialog */}
        {resumePrompt != null && !error && (
          <div className="absolute inset-0 z-20 flex items-center justify-center bg-black/70 px-6">
            <div className="ios-card p-5 w-full max-w-xs space-y-3">
              <div className="text-[16px] font-bold">Resume?</div>
              <div className="text-[13px] text-white/55">You were {fmtTime(resumePrompt)} into this title.</div>
              <div className="flex gap-2">
                <button onClick={() => { const v = videoRef.current; if (v) { v.currentTime = resumePrompt; requestPlay(); } setResumePrompt(null); showControls(true); }}
                  className="press flex-1 py-2.5 rounded-xl bg-accent text-black font-bold text-[14px]">Resume {fmtTime(resumePrompt)}</button>
                <button onClick={() => { const v = videoRef.current; if (v) { v.currentTime = 0; requestPlay(); } setResumePrompt(null); showControls(true); }}
                  className="press flex-1 py-2.5 rounded-xl bg-white/10 font-semibold text-[14px]">Start over</button>
              </div>
            </div>
          </div>
        )}

        {/* reconnecting banner — shown while the recovery ladder works;
            clears the moment playback resumes ('playing' event) */}
        {recovering && !error && (
          <div className="absolute top-[calc(12px+var(--safe-t,0px))] inset-x-0 flex justify-center z-20 pointer-events-none">
            <div className="bg-red-500/90 text-white text-[13px] font-semibold px-4 py-2 rounded-full shadow-xl flex items-center gap-2">
              <span className="w-3 h-3 shrink-0 border-2 border-white/40 border-t-white rounded-full animate-spin" />
              {recovering}
            </div>
          </div>
        )}

        {/* channel number entry OSD */}
        {digits && (
          <div className="absolute top-[22%] inset-x-0 flex justify-center pointer-events-none z-20">
            <div className="bg-black/70 backdrop-blur rounded-2xl px-7 py-3 text-[36px] font-bold font-mono tracking-[0.2em]">{digits}</div>
          </div>
        )}

        {/* screensaver: drifting clock when parked */}
        {screensaver && (
          <div className="absolute inset-0 z-40 bg-black/95 flex items-center justify-center fade-in"
            onClick={() => { setScreensaver(false); pausedSince.current = Date.now(); }}>
            <div className="text-center select-none drift-slow">
              <div className="text-[64px] font-extrabold tracking-tight tabular-nums">{clockStr}</div>
              <div className="text-[13px] text-white/40 mt-1">{p.channel.name}</div>
              <div className="text-[11px] text-white/25 mt-6">Tap anywhere to come back</div>
            </div>
          </div>
        )}

        {/* NEXT EPISODE / Up Next card */}
        {nextCountdown && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/75 z-10">
            <div className="ios-card p-5 w-72 space-y-3 text-center">
              <div className="text-[13px] uppercase tracking-widest text-white/60">
                {nextCountdown.left != null ? `Up next in ${nextCountdown.left}` : 'Up next'}
              </div>
              <div className="text-[16px] font-bold leading-snug">{nextCountdown.ep.episodeTitle}</div>
              <div className="text-[12px] text-white/50">Season {nextCountdown.ep.seasonNumber} · Episode {nextCountdown.ep.episodeNumber}</div>
              <div className="flex gap-2">
                <button onClick={() => { setNextCountdown(null); p.onPlayEpisode(nextCountdown.ep); }} className="press flex-1 py-2.5 rounded-xl bg-accent text-black font-bold">Play now</button>
                <button onClick={() => setNextCountdown(null)} className="press flex-1 py-2.5 rounded-xl bg-white/10 font-semibold">Cancel</button>
              </div>
              {nextCountdown.left == null && (
                <button onClick={() => setNextCountdown({ ...nextCountdown, left: 10 })}
                  className="press w-full py-2 rounded-xl bg-white/5 text-[13px] text-white/70">Remind me at the end</button>
              )}
            </div>
          </div>
        )}

        {/* top bar */}
        <div className={`absolute top-0 inset-x-0 transition-opacity duration-200 ${controls && !error && !inPip ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}>
          <div className="bg-gradient-to-b from-black/80 to-transparent px-3 pt-[max(10px,var(--safe-t,0px))] pb-8 flex items-start gap-2">
            <button onClick={p.onClose} aria-label="Close player" className="press w-10 h-10 shrink-0 rounded-full bg-black/45 backdrop-blur-md border border-white/15 flex items-center justify-center text-white">
              <IconChevron className="w-5 h-5 rotate-90" />
            </button>
            <div className="flex-1 min-w-0 mt-1">
              <div className="truncate text-[15px] font-bold leading-tight">
                {p.channel.channelNumber != null && <span className="font-mono text-white/60 mr-1.5">{p.channel.channelNumber}</span>}
                {p.channel.name}
              </div>
              <div className="text-[11px] text-white/65 mt-0.5">
                {live && <span className="text-red-400 font-bold mr-1">● LIVE</span>}
                {offlineUrl && <span className="text-green-400 font-bold mr-1">OFFLINE</span>}
                {p.channel.qualityTag && <span className="mr-1">{p.channel.qualityTag}</span>}
                {p.channel.groups?.slice(0, 2).join(' · ') || p.channel.group}
              </div>
              {live && p.nowNext?.now && (
                <div className="text-[11px] mt-0.5 truncate">
                  <span className="text-white/85 font-semibold">{p.nowNext.now.title}</span>
                  {p.nowNext.upcoming[0] && <span className="text-white/40"> · next: {p.nowNext.upcoming[0].title}</span>}
                </div>
              )}
            </div>
            <button onClick={(e) => { e.stopPropagation(); p.onToggleFav(); }} aria-label="Favourite" title="Favourite" className="press w-10 h-10 shrink-0 rounded-full bg-black/45 backdrop-blur-md border border-white/15 flex items-center justify-center text-white">
              <IconStar filled={liked} className={`w-[22px] h-[22px] ${liked ? 'text-accent' : ''}`} />
            </button>
          </div>
        </div>

        {/* live TV: channel up / down on the right edge */}
        {live && p.onZap && (
          <div className={`absolute right-2 top-1/2 -translate-y-1/2 flex flex-col gap-1.5 transition-opacity duration-200 ${controls && !error && !inPip ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}>
            <button onClick={(e) => { e.stopPropagation(); p.onZap!(-1); }} aria-label="Previous channel" className="press p-2.5 rounded-full bg-black/50 backdrop-blur text-white border border-white/10" title="Previous channel">
              <IconChevron className="w-5 h-5 -rotate-90" />
            </button>
            <button onClick={(e) => { e.stopPropagation(); p.onZap!(1); }} aria-label="Next channel" className="press p-2.5 rounded-full bg-black/50 backdrop-blur text-white border border-white/10" title="Next channel">
              <IconChevron className="w-5 h-5 rotate-90" />
            </button>
          </div>
        )}

        {/* center big play — Apple TV style glass circle; the whole overlay
            only takes pointer events while visible, so a hidden button can
            never steal taps meant for the picture */}
        {!error && (
          <div className={`absolute inset-0 flex items-center justify-center transition-opacity ${controls && !inPip ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}>
            <button onClick={togglePlay} aria-label={playing ? 'Pause' : 'Play'}
              className="press w-[84px] h-[84px] rounded-full bg-black/40 backdrop-blur-xl border border-white/20 flex items-center justify-center text-white shadow-2xl">
              {playing ? <IconPauseCircle className="w-12 h-12" /> : <IconPlayCircle className="w-12 h-12" />}
            </button>
          </div>
        )}

        {/* bottom bar — Netflix iOS glass transport */}
        <div className={`absolute bottom-0 inset-x-0 transition-opacity duration-200 ${controls && !error && !inPip ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}>
          <div className="bg-gradient-to-t from-black/90 via-black/60 to-transparent px-3 pb-[max(8px,var(--safe-b,0px))] pt-10">
            {showSeek ? (
              <div className="mb-1.5 flex items-center gap-2.5 text-[11px] text-white/85 font-mono">
                <span className="w-10 text-right">{fmtTime(time)}</span>
                <div className="relative flex-1 h-8 flex items-center seek-zone" role="presentation">
                  <div className="seek-track absolute inset-x-0 rounded-full bg-white/20 overflow-hidden" style={{ height: scrubbing ? 7 : undefined }}>
                    <div className="absolute inset-y-0 bg-white/30 rounded-full" style={{ width: `${buffered / duration * 100}%` }} />
                    <div className="absolute inset-y-0 bg-accent rounded-full" style={{ width: `${time / duration * 100}%` }} />
                  </div>
                  <input type="range" min={0} max={duration} step={0.5} value={time} onChange={(e) => seekTo(parseFloat(e.target.value))}
                    onPointerDown={() => { scrubbingRef.current = true; setScrubbing(true); showControls(true); }}
                    onPointerUp={() => { scrubbingRef.current = false; setScrubbing(false); showControls(true); }}
                    onPointerCancel={() => { scrubbingRef.current = false; setScrubbing(false); }}
                    className="absolute inset-0 w-full opacity-0 cursor-pointer" aria-label="Seek" />
                  <div className={`absolute w-4 h-4 rounded-full bg-accent shadow-lg ring-2 ring-white/80 translate-x-[calc(-50%+var(--t))] pointer-events-none transition-transform ${scrubbing ? 'scale-125' : ''}`}
                    style={{ left: `${time / duration * 100}%`, ['--t' as any]: 0 }} />
                  {scrubbing && (
                    <div className="absolute -top-7 -translate-x-1/2 bg-white text-black text-[12px] font-bold px-2.5 py-1 rounded-lg pointer-events-none shadow-xl"
                      style={{ left: `${Math.min(94, Math.max(6, time / duration * 100))}%` }}>
                      {fmtTime(time)}
                    </div>
                  )}
                </div>
                <span>{fmtTime(duration)}</span>
              </div>
            ) : live ? (
              <div className="mb-2 flex items-center gap-2 px-1">
                {behindLive ? (
                  <button onClick={(e) => { e.stopPropagation(); goLive(); }}
                    className="press flex items-center gap-1.5 bg-accent text-black text-[11px] font-bold px-2.5 py-1 rounded-full" title="Jump to the live edge">
                    ▸ Go to live
                  </button>
                ) : (
                  <>
                    <div className="h-1 flex-1 rounded-full bg-white/15 overflow-hidden">
                      <div className="h-full bg-red-500/90 rounded-full" style={{ width: '100%' }} />
                    </div>
                    <span className="text-[10px] text-red-300 font-bold tracking-wider">LIVE</span>
                  </>
                )}
              </div>
            ) : null}
            <div className="flex items-center gap-1 text-white">
              <GlassBtn label="Back 10 seconds" title="Hold to accelerate" className={live ? 'hidden' : ''}
                onPointerDown={holdStart} onPointerUp={(e) => { e.stopPropagation(); holdEnd(-1); }} onPointerLeave={holdCancel} onPointerCancel={holdCancel}>
                <span className="relative">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="w-[22px] h-[22px]"><path d="M11 8 6 12l5 4V8zM13 12l5-4v8l-5-4z" strokeLinejoin="round" strokeLinecap="round" /></svg>
                  {holdStep > 10 && <span className="absolute -bottom-2 left-1/2 -translate-x-1/2 text-[9px] font-bold bg-accent text-black rounded px-1 leading-3 whitespace-nowrap">{holdStep}s</span>}
                </span>
              </GlassBtn>
              <GlassBtn label={playing ? 'Pause' : 'Play'} title="Play/Pause" onClick={togglePlay} className="w-12 h-12">
                {playing ? <IconPauseCircle className="w-7 h-7" /> : <IconPlayCircle className="w-7 h-7" />}
              </GlassBtn>
              <GlassBtn label="Forward 10 seconds" title="Hold to accelerate" className={live ? 'hidden' : ''}
                onPointerDown={holdStart} onPointerUp={(e) => { e.stopPropagation(); holdEnd(1); }} onPointerLeave={holdCancel} onPointerCancel={holdCancel}>
                <span className="relative">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="w-[22px] h-[22px]"><path d="M13 8l5 4-5 4V8zM11 12l-5-4v8l5-4z" strokeLinejoin="round" strokeLinecap="round" /></svg>
                  {holdStep > 10 && <span className="absolute -bottom-2 left-1/2 -translate-x-1/2 text-[9px] font-bold bg-accent text-black rounded px-1 leading-3 whitespace-nowrap">{holdStep}s</span>}
                </span>
              </GlassBtn>
              {/* iOS: volume is hardware-controlled — no on-screen mute/slider;
                  desktop keeps them (narrow screens hide them too) */}
              {!isIOS && (
                <>
                  <GlassBtn label="Mute" title="Mute" active={muted} onClick={(e) => { e.stopPropagation(); toggleMute(); }} className="hidden sm:flex">
                    {muted ? (
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="w-5 h-5"><path d="M4 9v6h4l5 4V5L8 9H4z" strokeLinejoin="round" /><path d="m16 9 5 5M21 9l-5 5" strokeLinecap="round" /></svg>
                    ) : (
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="w-5 h-5"><path d="M4 9v6h4l5 4V5L8 9H4z" strokeLinejoin="round" /><path d="M16.5 8.5a5 5 0 0 1 0 7M19 6a8.5 8.5 0 0 1 0 12" strokeLinecap="round" /></svg>
                    )}
                  </GlassBtn>
                  <input type="range" min={0} max={1} step={0.05} value={volume} aria-label="Volume"
                    onClick={(e) => e.stopPropagation()}
                    onChange={(e) => {
                      const v = videoRef.current;
                      if (v) {
                        v.volume = parseFloat(e.target.value);
                        if (v.volume > 0 && v.muted) { v.muted = false; setMuted(false); }
                      }
                    }}
                    className="press w-16 accent-accent hidden sm:block" />
                </>
              )}
              <div className="flex-1" />
              {subTracks.length > 0 && (
                <GlassBtn label="Subtitles" title="Subtitles (C)" active={subTrack >= 0} onClick={(e) => { e.stopPropagation(); toggleCC(); }}>
                  <IconCC className="w-[22px] h-[22px]" />
                </GlassBtn>
              )}
              <GlassBtn label="Playback settings" title="Playback settings" active={settings} onClick={(e) => { e.stopPropagation(); setSettings((s) => !s); showControls(true); }}>
                <IconSettings className="w-[22px] h-[22px]" />
              </GlassBtn>
              {pipOk && (
                <GlassBtn label="Picture in picture" title="Picture in picture" active={inPip} onClick={togglePip}>
                  <IconPip className="w-[22px] h-[22px]" />
                </GlassBtn>
              )}
              <GlassBtn label="Fullscreen" title="Fullscreen (F)" onClick={(e) => { e.stopPropagation(); toggleFullscreen(); }}>
                {fs ? <IconFullscreenExit className="w-[22px] h-[22px]" /> : <IconFullscreen className="w-[22px] h-[22px]" />}
              </GlassBtn>
            </div>
          </div>
        </div>
      </div>

      {/* INFO AREA (portrait) */}
      <div className="scroll-y flex-1 min-h-0 player-info bg-ground p-4 pb-[calc(28px+var(--safe-b,0px))] space-y-4">
        <div className="ios-card p-4 space-y-1.5">
          <div className="font-bold text-[17px] leading-snug">{p.channel.name}</div>
          <div className="text-[13px] text-white/55 flex flex-wrap gap-x-2 gap-y-1">
            {p.channel.groups?.map((g) => <span key={g} className="bg-white/8 rounded-full px-2 py-0.5 text-[11px]">{g}</span>)}
            {p.channel.qualityTag && <span className="bg-white/8 rounded-full px-2 py-0.5 text-[11px]">{p.channel.qualityTag}</span>}
          </div>
          {p.meta && (
            <div className="pt-1.5 space-y-1">
              {p.meta.vote_average > 0 && <div className="text-[13px] text-star">★ {p.meta.vote_average.toFixed(1)}</div>}
              {p.meta.overview && <div className="text-[13px] text-white/60 leading-relaxed line-clamp-4">{p.meta.overview}</div>}
            </div>
          )}
        </div>

        {live && (p.nowNext?.now || (p.nowNext?.upcoming.length ?? 0) > 0) && (
          <div className="space-y-2">
            <div className="text-[13px] font-medium uppercase tracking-wide text-white/45 px-1">Programme guide</div>
            {p.nowNext?.now && (
              <div className="ios-card p-4 border-l-4 border-accent">
                <div className="text-[11px] text-accent font-bold mb-0.5">NOW</div>
                <div className="font-semibold text-[15px]">{p.nowNext.now.title}</div>
                {p.nowNext.now.desc && <div className="text-[13px] text-white/55 mt-1 line-clamp-3">{p.nowNext.now.desc}</div>}
              </div>
            )}
            {p.nowNext?.upcoming.slice(0, 12).map((pr, i) => (
              <div key={i} className="ios-card px-4 py-2.5 flex items-baseline gap-3">
                <div className="text-[12px] text-white/45 font-mono shrink-0 w-12">{pr.start.slice(8, 10)}:{pr.start.slice(10, 12)}</div>
                <div className="text-[14px] truncate">{pr.title}</div>
              </div>
            ))}
          </div>
        )}

        {p.episodes && p.episodes.length > 1 && (
          <div className="space-y-2">
            <div className="text-[13px] font-medium uppercase tracking-wide text-white/45 px-1">Episodes</div>
            {Array.from(new Set(p.episodes.map((e) => e.seasonNumber))).sort((a, b) => a - b).map((sn) => (
              <div key={sn} className="space-y-2">
                <div className="px-1 text-[13px] font-semibold text-white/60">Season {sn}</div>
                {p.episodes!.filter((e) => e.seasonNumber === sn)
                  .sort((a, b) => a.episodeNumber - b.episodeNumber)
                  .map((e) => (
                    <button key={e.channel.id} onClick={() => p.onPlayEpisode(e)}
                      className={`press w-full text-left ios-card px-4 py-3 flex items-center gap-3 ${e.channel.id === p.channel.id ? 'bg-accent/15' : ''}`}>
                      <div className={`text-[12px] w-9 shrink-0 font-mono ${e.channel.id === p.channel.id ? 'text-accent' : 'text-white/40'}`}>E{e.episodeNumber}</div>
                      <div className="min-w-0">
                        <div className="text-[14px] truncate">{e.episodeTitle}</div>
                        {e.episodeTitle !== e.channel.name && <div className="text-[11px] text-white/35 truncate">{e.channel.name}</div>}
                      </div>
                    </button>
                  ))}
              </div>
            ))}
          </div>
        )}

        {live && p.related && p.related.length > 0 && (
          <div className="space-y-2">
            <div className="text-[13px] font-medium uppercase tracking-wide text-white/45 px-1">
              More in {p.channel.groups?.[0] || p.channel.group || 'this category'}
            </div>
            <div className="scroll-x shelf -mx-4 px-4" style={{ paddingBottom: 'var(--safe-b, 0px)' }}>
              {p.related.map((ch) => (
                <button key={ch.id} onClick={() => p.onPlayRelated?.(ch)}
                  className={`press w-[124px] shrink-0 text-left rounded-xl overflow-hidden ${ch.id === p.channel.id ? 'ring-2 ring-accent' : ''}`}>
                  <div className="relative rounded-xl overflow-hidden bg-card" style={{ aspectRatio: '16 / 9' }}>
                    <Poster src={ch.logo} label={ch.name} className="w-full h-full" />
                    <div className="absolute top-1 right-1 bg-black/60 rounded-md px-1 text-[9px] font-bold">{ch.qualityTag || 'LIVE'}</div>
                  </div>
                  <div className="mt-1 text-[11px] font-semibold truncate">{ch.name}</div>
                </button>
              ))}
            </div>
          </div>
        )}

        {p.channel.headers && (
          <div className="ios-card p-4 text-[12px] text-white/45">
            This entry requests custom HTTP headers ({Object.keys(p.channel.headers).join(', ')}). Browsers cannot send these to the stream; if playback fails, try another variant.
          </div>
        )}
      </div>

      {/* PLAYBACK SETTINGS — iOS bottom sheet */}
      {settings && !error && !inPip && (
        <div onClick={(e) => e.stopPropagation()} className="absolute inset-x-0 bottom-0 z-40 sheet-in">
          <div className="mx-auto w-full max-w-md rounded-t-3xl ios-blur border-t border-white/10 shadow-2xl overflow-hidden"
            style={{ paddingBottom: 'calc(10px + var(--safe-b, 0px))' }}>
            <button onClick={() => setSettings(false)} aria-label="Close settings" className="press block w-full pt-3 pb-2">
              <span className="block w-11 h-1.5 rounded-full bg-white/25 mx-auto" />
            </button>
            <div className="scroll-y max-h-[56dvh] px-4 pb-1 space-y-5">
              <div className="text-[13px] font-bold uppercase tracking-widest text-white/50 px-1">Playback settings</div>
              {!live && (
                <SettingsSection label="Speed">
                  {[0.5, 0.75, 1, 1.25, 1.5, 2].map((r) => (
                    <Pill key={r} active={rate === r} onClick={() => setRate2(r)}>{r === 1 ? 'Normal' : `${r}×`}</Pill>
                  ))}
                </SettingsSection>
              )}
              {levels.length > 1 && (
                <SettingsSection label="Quality">
                  <Pill active={curLevel === -1} onClick={() => setLevel(-1)}>Auto</Pill>
                  {levels.map((l) => <Pill key={l.i} active={curLevel === l.i} onClick={() => setLevel(l.i)}>{l.label}</Pill>)}
                </SettingsSection>
              )}
              <SettingsSection label="Picture">
                <Pill active={aspect === 'fit'} onClick={() => setAspectMode('fit')}>Fit</Pill>
                <Pill active={aspect === 'fill'} onClick={() => setAspectMode('fill')}>Fill</Pill>
                <Pill active={aspect === 'zoom'} onClick={() => setAspectMode('zoom')}>Zoom</Pill>
                <Pill active={aspect === 'stretch'} onClick={() => setAspectMode('stretch')}>Stretch</Pill>
              </SettingsSection>
              {audioTracks.length > 1 && (
                <SettingsSection label="Audio">
                  {audioTracks.map((a) => <Pill key={a.i} active={audioTrack === a.i} onClick={() => setAudio(a.i)}>{a.label}</Pill>)}
                </SettingsSection>
              )}
              <SettingsSection label="Subtitles">
                {subTracks.length ? (
                  <>
                    <Pill active={subTrack === -1} onClick={() => setSub(-1)}>Off</Pill>
                    {subTracks.map((s) => <Pill key={s.i} active={subTrack === s.i} onClick={() => setSub(s.i)}>{s.label}</Pill>)}
                  </>
                ) : (
                  <div className="text-[13px] text-white/45 px-1">No subtitle tracks in this stream</div>
                )}
              </SettingsSection>
              <SettingsSection label="Actions">
                <Pill onClick={() => { try { navigator.clipboard?.writeText(p.channel.url); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch {} }}>
                  {copied ? 'Copied ✓' : 'Copy stream link'}
                </Pill>
                <Pill onClick={() => { try { window.open(p.channel.url, '_blank'); } catch {} }}>Open externally</Pill>
                {airplay && (
                  <Pill onClick={toggleAirPlay}>
                    <span className="inline-flex items-center gap-1.5"><IconAirplay className="w-4 h-4" /> AirPlay</span>
                  </Pill>
                )}
                <Pill onClick={() => { setSettings(false); p.onAddMv(); }}>
                  <span className="inline-flex items-center gap-1.5"><IconPlus className="w-4 h-4" /> Multiview</span>
                </Pill>
              </SettingsSection>
            </div>
          </div>
        </div>
      )}

      {/* CHANNEL SWITCHER — ← key / left edge; two panes, snapshot-frozen */}
      {switcher && switcherData && (
        <div className="absolute inset-0 z-40 flex items-stretch" onClick={() => setSwitcher(false)}>
          <div className="absolute inset-y-0 left-0 w-full md:w-[520px] ios-blur border-r border-white/10 flex flex-col shadow-2xl"
            onClick={(e) => e.stopPropagation()}>
            <div className="px-4 pt-[calc(12px+var(--safe-t,0px))] pb-2 flex items-center gap-2 hairline-b">
              <div className="text-[16px] font-bold flex-1">Channels</div>
              <button onClick={() => setSwitcher(false)} className="press p-2 text-white/70" aria-label="Close switcher"><IconClose className="w-5 h-5" /></button>
            </div>
            <div className="px-3 py-2">
              <input value={switcherQ} onChange={(e) => setSwitcherQ(e.target.value)} placeholder="Search channels" autoFocus
                className="w-full bg-white/10 rounded-xl px-3 py-2 text-[15px] outline-none placeholder:text-white/30" />
            </div>
            <div className="scroll-x flex gap-2 px-3 pb-2">
              {p.channel.groups?.[0] && (
                <Pill active={switcherGroup === p.channel.groups[0]} onClick={() => setSwitcherGroup(p.channel.groups![0])}>Playing group</Pill>
              )}
              <Pill active={switcherGroup === '__fav'} onClick={() => setSwitcherGroup('__fav')}>♥ Favourites</Pill>
              <Pill active={switcherGroup === '__recent'} onClick={() => setSwitcherGroup('__recent')}>Recently played</Pill>
            </div>
            <div className="flex-1 min-h-0 flex">
              {/* groups pane */}
              <div className="scroll-y w-[168px] shrink-0 border-r border-white/10 py-1">
                {switcherData.map(({ g, chs }) => (
                  <button key={g} onClick={() => setSwitcherGroup(g)}
                    className={`press w-full text-left px-3 py-2 text-[12px] truncate flex justify-between gap-1 ${switcherGroup === g ? 'bg-white/12 font-semibold' : 'text-white/70'}`}>
                    <span className="truncate">{g}</span>
                    <span className="text-white/30 shrink-0">{chs.length}</span>
                  </button>
                ))}
              </div>
              {/* channels pane */}
              <div className="scroll-y flex-1 py-1">
                {switcherChannels.map((c) => (
                  <button key={c.id} onClick={() => { setSwitcher(false); p.onSelectChannel?.(c); }}
                    className={`press w-full text-left px-3 py-2 flex items-center gap-2.5 ${c.id === p.channel.id ? 'bg-white/10' : ''}`}>
                    <span className="text-[10px] font-mono text-white/35 w-8 text-right shrink-0">{c.channelNumber ?? ''}</span>
                    <Poster src={c.logo} className="w-8 h-8 rounded-md shrink-0" />
                    <span className="min-w-0 flex-1">
                      <span className="block text-[13px] truncate">{c.name}</span>
                      {c.qualityTag && <span className="block text-[10px] text-white/35">{c.qualityTag}</span>}
                    </span>
                  </button>
                ))}
                {switcherChannels.length === 0 && <div className="px-3 py-6 text-[13px] text-white/40">No channels</div>}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

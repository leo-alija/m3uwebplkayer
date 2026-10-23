'use client';

import { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import Hls from 'hls.js';
import { Channel, Program, SeriesEpisode } from '@/lib/types';
import { load, save } from '@/lib/storage';
import { NATIVE_HLS } from '@/lib/env';
import { IconClose, IconStar, IconPip, IconPlus, IconPlayCircle, IconPauseCircle, IconSpeed } from './ui';

type Props = {
  channel: Channel;
  resume?: number;
  isFav: boolean;
  nowNext?: { now?: Program; upcoming: Program[] };
  episodes?: SeriesEpisode[];
  meta?: any;
  onClose: () => void;
  onToggleFav: () => void;
  onAddMv: () => void;
  onProgress: (channelId: string, time: number, duration: number) => void;
  onPlayEpisode: (ep: SeriesEpisode) => void;
};

const isIOS = NATIVE_HLS;

function fmtTime(s: number) {
  if (!Number.isFinite(s) || s < 0) return '0:00';
  const h = Math.floor(s / 3600); const m = Math.floor((s % 3600) / 60); const sec = Math.floor(s % 60);
  return (h ? `${h}:${String(m).padStart(2, '0')}` : `${m}`) + `:${String(sec).padStart(2, '0')}`;
}

export default function Player(p: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const contRef = useRef<HTMLDivElement>(null);
  const hlsRef = useRef<Hls | null>(null);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastSave = useRef(0);
  const tapTime = useRef(0);
  const tapSide = useRef('');
  const [controls, setControls] = useState(true);
  const [playing, setPlaying] = useState(false);
  const [buffering, setBuffering] = useState(true);
  const [muted, setMuted] = useState(false);
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
  const [nextCountdown, setNextCountdown] = useState<null | { ep: SeriesEpisode; left: number }>(null);

  const live = p.channel.contentType !== 'MOVIE' && p.channel.contentType !== 'SERIES';
  const showSeek = !live && duration > 0;

  /* next episode for series */
  const nextEp = useMemo(() => {
    if (!p.episodes || p.episodes.length < 2) return null;
    const i = p.episodes.findIndex((e) => e.channel.id === p.channel.id);
    if (i === -1 || i >= p.episodes.length - 1) return null;
    const rest = p.episodes.slice(i + 1).sort((a, b) => a.seasonNumber - b.seasonNumber || a.episodeNumber - b.episodeNumber);
    return rest[0];
  }, [p.episodes, p.channel.id]);

  const showControls = useCallback((sticky = false) => {
    setControls(true);
    if (hideTimer.current) clearTimeout(hideTimer.current);
    if (!sticky) hideTimer.current = setTimeout(() => setControls(false), 4200);
  }, []);

  useEffect(() => { showControls(); return () => { if (hideTimer.current) clearTimeout(hideTimer.current); }; }, []);

  /* ---------- source attach ---------- */
  useEffect(() => {
    const video = videoRef.current;
    if (!video || !p.channel) return;
    setPlaying(false); setBuffering(true); setError(''); setTime(0); setDuration(0); setBuffered(0);
    setLevels([]); setCurLevel(-1); setAudioTracks([]); setAudioTrack(-1); setSubTracks([]); setSubTrack(-1); setRate(1); setNextCountdown(null);
    if (hlsRef.current) { hlsRef.current.destroy(); hlsRef.current = null; }
    const url = p.channel.url;
    const isHlsUrl = /m3u8/.test(url);

    if (isHlsUrl && !isIOS && Hls.isSupported()) {
      const hls = new Hls({ enableWorker: true, lowLatencyMode: true, backBufferLength: 90 });
      hlsRef.current = hls;
      hls.loadSource(url);
      hls.attachMedia(video);
      hls.on(Hls.Events.MANIFEST_PARSED, (_e, data) => {
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
      });
      hls.on(Hls.Events.SUBTITLE_TRACKS_UPDATED, () => {
        setSubTracks(hls.subtitleTracks.map((s, i) => ({ i, label: s.name || s.lang || `Subs ${i + 1}` })));
        const pref = load('subLang', '');
        if (pref) {
          const idx = hls.subtitleTracks.findIndex((s) => (s.lang || s.name || '') === pref);
          if (idx >= 0) { hls.subtitleDisplay = true; hls.subtitleTrack = idx; setSubTrack(idx); }
        }
      });
      hls.on(Hls.Events.ERROR, (_e, data) => {
        if (data.fatal) {
          switch (data.type) {
            case Hls.ErrorTypes.NETWORK_ERROR:
              hls.startLoad();
              break;
            case Hls.ErrorTypes.MEDIA_ERROR:
              hls.recoverMediaError();
              break;
            default:
              setError('This stream could not be played.');
              setBuffering(false);
          }
        }
      });
    } else {
      video.src = url; /* native HLS on iOS, or plain mp4 */
    }

    if (p.resume && p.resume > 5) {
      video.addEventListener('loadedmetadata', () => { try { video.currentTime = p.resume!; } catch {} }, { once: true });
    }
    let cancelled = false;
    video.play().then(() => setBuffering(false)).catch(() => {
      /* autoplay blocked — user taps play */
      if (!cancelled) setBuffering(false);
    });
    return () => { cancelled = true; };
  }, [p.channel.id]);

  /* cleanup */
  useEffect(() => () => {
    if (hideTimer.current) clearTimeout(hideTimer.current);
    hlsRef.current?.destroy();
  }, []);

  /* wake lock */
  useEffect(() => {
    let wl: any = null;
    if ('wakeLock' in navigator) {
      (navigator as any).wakeLock?.request('screen').then((l: any) => (wl = l)).catch(() => {});
    }
    return () => wl?.release?.().catch?.(() => {});
  }, []);

  /* ---------- video events ---------- */
  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    const onTime = () => {
      setTime(v.currentTime);
      if (Number.isFinite(v.duration)) setDuration(v.duration);
      try { if (v.buffered.length) setBuffered(v.buffered.end(v.buffered.length - 1)); } catch {}
      if (!live && Date.now() - lastSave.current > 8000) {
        lastSave.current = Date.now();
        p.onProgress(p.channel.id, v.currentTime, v.duration);
      }
    };
    const handlers: [string, () => void][] = [
      ['timeupdate', onTime], ['loadedmetadata', onTime], ['progress', onTime],
      ['play', () => setPlaying(true)], ['pause', () => { setPlaying(false); if (!live) p.onProgress(p.channel.id, v.currentTime, v.duration); }],
      ['waiting', () => setBuffering(true)], ['playing', () => { setBuffering(false); setPlaying(true); }],
      ['volumechange', () => setMuted(v.muted)],
      ['error', () => { setError('This stream could not be played.'); setBuffering(false); }],
    ];
    handlers.forEach(([evt, fn]) => v.addEventListener(evt, fn));
    const onEnded = () => {
      /* history closing book */
      p.onProgress(p.channel.id, 0, v.duration);
      if (nextEp && !live) {
        setNextCountdown({ ep: nextEp, left: 8 });
      }
    };
    v.addEventListener('ended', onEnded);
    return () => {
      handlers.forEach(([evt, fn]) => v.removeEventListener(evt, fn));
      v.removeEventListener('ended', onEnded);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [p.channel.id, nextEp, live]);

  /* countdown ticker */
  useEffect(() => {
    if (!nextCountdown) return;
    const t = setInterval(() => {
      setNextCountdown((nc) => {
        if (!nc) return null;
        if (nc.left <= 1) {
          p.onPlayEpisode(nc.ep);
          return null;
        }
        return { ...nc, left: nc.left - 1 };
      });
    }, 1000);
    return () => clearInterval(t);
  }, [nextCountdown?.ep]);

  useEffect(() => {
    /* after channel change, save position is not needed */
    setTime(0); setDuration(0);
  }, [p.channel.id]);

  /* ---------- gestures ---------- */
  function onVideoTap(e: React.MouseEvent) {
    const now = Date.now();
    const x = e.clientX - window.innerWidth / 2;
    const side = x < -40 ? 'back' : x > 40 ? 'fwd' : 'mid';
    if (now - tapTime.current < 300 && tapSide.current === side && side !== 'mid') {
      /* double tap → seek ±10 */
      const v = videoRef.current;
      if (v && !live) {
        v.currentTime = Math.max(0, Math.min(v.duration || 1e9, v.currentTime + (side === 'back' ? -10 : 10)));
        setFlash(side === 'back' ? 'back' : 'fwd');
        setTimeout(() => setFlash(null), 400);
      }
      tapTime.current = 0;
      return;
    }
    tapTime.current = now;
    tapSide.current = side;
    setTimeout(() => { if (tapTime.current === now) { setControls((c) => (c ? false : true)); if (!controls === true) showControls(); } }, 260);
  }

  /* ---------- keyboard ---------- */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const v = videoRef.current;
      if (!v) return;
      if (e.key === ' ' || e.key === 'k') { e.preventDefault(); v.paused ? v.play().catch(() => {}) : v.pause(); showControls(); }
      else if (e.key === 'ArrowRight') { if (!live) { v.currentTime += 10; setFlash('fwd'); setTimeout(() => setFlash(null), 400); showControls(); } }
      else if (e.key === 'ArrowLeft') { if (!live) { v.currentTime -= 10; setFlash('back'); setTimeout(() => setFlash(null), 400); showControls(); } }
      else if (e.key === 'm' || e.key === 'M') { v.muted = !v.muted; showControls(); }
      else if (e.key === 'ArrowDown') v.volume = Math.max(0, v.volume - 0.1);
      else if (e.key === 'ArrowUp') v.volume = Math.min(1, v.volume + 0.1);
      else if (e.key === 'Escape') p.onClose();
      else if (e.key === 'f' || e.key === 'F') contRef.current?.requestFullscreen?.().catch(() => {});
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [live, p.onClose]);

  /* ---------- actions ---------- */
  function togglePlay(e?: React.MouseEvent | React.TouchEvent) {
    if (e) e.stopPropagation();
    const v = videoRef.current;
    if (!v) return;
    v.paused ? v.play().catch(() => {}) : v.pause();
    showControls();
  }
  function toggleMute() {
    const v = videoRef.current;
    if (v) { v.muted = !v.muted; showControls(); }
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
  function seekTo(t: number) { const v = videoRef.current; if (v) { v.currentTime = t; setTime(t); showControls(true); } }
  function skip(d: number) { const v = videoRef.current; if (!v || live) return; v.currentTime = Math.max(0, Math.min(v.duration || 1e9, v.currentTime + d)); showControls(true); }
  function setRate2(r: number) { const v = videoRef.current; if (v) { v.playbackRate = r; setRate(r); } }
  function setLevel(i: number) { setCurLevel(i); if (hlsRef.current) hlsRef.current.currentLevel = i; }
  function setAudio(i: number) { setAudioTrack(i); if (hlsRef.current) hlsRef.current.audioTrack = i; }
  function setSub(i: number) {
    setSubTrack(i);
    save('subLang', (hlsRef.current?.subtitleTracks?.[i] && (hlsRef.current.subtitleTracks[i].lang || hlsRef.current.subtitleTracks[i].name)) || '');
    if (hlsRef.current) { hlsRef.current.subtitleDisplay = i >= 0; hlsRef.current.subtitleTrack = i; }
  }

  const liked = p.isFav;

  return (
    <div ref={contRef} className="player-overlay flex flex-col md:flex-row player-root">
      {/* VIDEO AREA */}
      <div className="relative bg-black shrink-0 player-video-area" style={{ paddingBottom: 'env(safe-area-inset-top)' }}>
        <video
          ref={videoRef}
          playsInline autoPlay controls={false}
          onClick={onVideoTap}
          className="w-full h-full bg-black player-video"
        />

        {buffering && !error && (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <div className="w-10 h-10 border-2 border-white/20 border-t-white/90 rounded-full animate-spin" />
          </div>
        )}
        {flash && (
          <div className={`absolute top-1/2 -translate-y-1/2 ${flash === 'back' ? 'left-10' : 'right-10'} pointer-events-none fade-in`}>
            <div className="bg-black/55 backdrop-blur rounded-full px-4 py-2 text-white text-[13px] font-semibold">
              {flash === 'back' ? '« 10s' : '10s »'}
            </div>
          </div>
        )}
        {error && (
          <div className="absolute inset-0 z-20 flex flex-col items-center justify-center gap-3 px-8 text-center bg-black/75">
            <button onClick={p.onClose} className="press absolute top-[max(12px,var(--safe-t,0px))] left-3 p-2 text-white"><IconClose className="w-6 h-6" /></button>
            <div className="text-white/90 text-[15px]">{error}</div>
            <button onClick={(e) => { e.stopPropagation(); const v = videoRef.current; if (v) { v.load(); v.play().catch(() => {}); } setError(''); setBuffering(true); showControls(true); }}
              className="press px-5 py-2.5 rounded-xl bg-[#ff7a2a] text-black text-[15px] font-bold">Retry</button>
            <a href={p.channel.url} target="_blank" rel="noreferrer" className="press text-white/50 text-xs underline">Open stream URL</a>
          </div>
        )}

        {/* NEXT EPISODE countdown */}
        {nextCountdown && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/75 z-10">
            <div className="ios-card p-5 w-72 space-y-3 text-center">
              <div className="text-[13px] uppercase tracking-widest text-white/60">Next episode in {nextCountdown.left}</div>
              <div className="text-[16px] font-bold leading-snug">{nextCountdown.ep.episodeTitle}</div>
              <div className="text-[12px] text-white/50">Season {nextCountdown.ep.seasonNumber} · Episode {nextCountdown.ep.episodeNumber}</div>
              <div className="flex gap-2">
                <button onClick={() => { setNextCountdown(null); p.onPlayEpisode(nextCountdown.ep); }} className="press flex-1 py-2.5 rounded-xl bg-[#ff7a2a] text-black font-bold">Play now</button>
                <button onClick={() => setNextCountdown(null)} className="press flex-1 py-2.5 rounded-xl bg-white/10 font-semibold">Cancel</button>
              </div>
            </div>
          </div>
        )}

        {/* top bar */}
        <div className={`absolute top-0 inset-x-0 transition-opacity duration-200 ${controls && !error ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}>
          <div className="bg-gradient-to-b from-black/80 to-transparent px-3 pt-[max(10px,var(--safe-t,0px))] pb-8 flex items-start gap-2">
            <button onClick={p.onClose} className="press p-2 -m-1 text-white"><IconClose className="w-6 h-6" /></button>
            <div className="flex-1 min-w-0 mt-0.5">
              <div className="truncate text-[15px] font-bold leading-tight">{p.channel.name}</div>
              <div className="text-[11px] text-white/65 mt-0.5">
                {live && <span className="text-red-400 font-bold mr-1">● LIVE</span>}
                {p.channel.qualityTag && <span className="mr-1">{p.channel.qualityTag}</span>}
                {p.channel.groups?.slice(0, 2).join(' · ') || p.channel.group}
              </div>
            </div>
            <button onClick={togglePip} className="press p-2 text-white" title="Picture in picture"><IconPip className="w-6 h-6" /></button>
            <button onClick={(e) => { e.stopPropagation(); contRef.current?.requestFullscreen?.().catch(() => {}); }} className="press p-2 text-white hidden" title="Fullscreen">
              <span className="text-[15px]">⛶</span>
            </button>
          </div>
        </div>

        {/* center big play */}
        {!error && (
          <div className={`absolute inset-0 flex items-center justify-center transition-opacity pointer-events-none ${controls ? 'opacity-100' : 'opacity-0'}`}>
            <button onClick={togglePlay} className="press pointer-events-auto text-white drop-shadow-2xl">
              {playing ? <IconPauseCircle className="w-16 h-16 opacity-90" /> : <IconPlayCircle className="w-16 h-16" />}
            </button>
          </div>
        )}

        {/* bottom bar */}
        <div className={`absolute bottom-0 inset-x-0 transition-opacity duration-200 ${controls && !error ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}>
          <div className="bg-gradient-to-t from-black/90 via-black/60 to-transparent px-3 pb-[max(8px,var(--safe-b,0px))] pt-10">
            {showSeek ? (
              <div className="mb-1.5 flex items-center gap-2.5 text-[11px] text-white/85 font-mono">
                <span className="w-10 text-right">{fmtTime(time)}</span>
                <div className="relative flex-1 h-5 flex items-center" role="presentation">
                  <div className="absolute inset-x-0 h-1 rounded-full bg-white/20 overflow-hidden">
                    <div className="absolute inset-y-0 bg-white/35 rounded-full" style={{ width: `${buffered / duration * 100}%` }} />
                    <div className="absolute inset-y-0 bg-[#ff7a2a] rounded-full" style={{ width: `${time / duration * 100}%` }} />
                  </div>
                  <input type="range" min={0} max={duration} step={0.5} value={time} onChange={(e) => seekTo(parseFloat(e.target.value))}
                    className="absolute inset-0 w-full opacity-0 cursor-pointer" aria-label="Seek" />
                  <div className="absolute w-3.5 h-3.5 rounded-full bg-white shadow translate-x-[calc(-50%+var(--t))] pointer-events-none"
                    style={{ left: `${time / duration * 100}%`, ['--t' as any]: 0 }} />
                </div>
                <span>{fmtTime(duration)}</span>
              </div>
            ) : live ? (
              <div className="mb-1.5 flex items-center gap-2 px-1">
                <div className="h-1 flex-1 rounded-full bg-white/15 overflow-hidden">
                  <div className="h-full bg-red-500/90 rounded-full" style={{ width: '100%' }} />
                </div>
                <span className="text-[10px] text-red-300 font-bold tracking-wider">LIVE</span>
              </div>
            ) : null}
            <div className="flex items-center text-white">
              <button onClick={(e) => { e.stopPropagation(); skip(-10); }} className={`press p-2.5 ${live ? 'hidden' : ''}`} title="Back 10s">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="w-6 h-6"><path d="M11 8 6 12l5 4V8zM13 12l5-4v8l-5-4z" strokeLinejoin="round" strokeLinecap="round" /></svg>
              </button>
              <button onClick={togglePlay} className="press p-2.5" title="Play/Pause">
                {playing ? <IconPauseCircle className="w-7 h-7" /> : <IconPlayCircle className="w-7 h-7" />}
              </button>
              <button onClick={(e) => { e.stopPropagation(); skip(10); }} className={`press p-2.5 ${live ? 'hidden' : ''}`} title="Forward 10s">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="w-6 h-6"><path d="M13 8l5 4-5 4V8zM11 12l-5-4v8l5-4z" strokeLinejoin="round" strokeLinecap="round" /></svg>
              </button>
              <button onClick={(e) => { e.stopPropagation(); toggleMute(); }} className="press p-2.5" title="Mute">
                {muted || !videoRef.current?.volume ? (
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="w-6 h-6"><path d="M4 9v6h4l5 4V5L8 9H4z" strokeLinejoin="round" /><path d="m16 9 5 5M21 9l-5 5" strokeLinecap="round" /></svg>
                ) : (
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className={`w-6 h-6 ${muted ? 'opacity-40' : ''}`}><path d="M4 9v6h4l5 4V5L8 9H4z" strokeLinejoin="round" /><path d="M16.5 8.5a5 5 0 0 1 0 7M19 6a8.5 8.5 0 0 1 0 12" strokeLinecap="round" /></svg>
                )}
              </button>
              <button onClick={(e) => { e.stopPropagation(); p.onToggleFav(); }} className="press p-2.5" title="Favourite">
                <IconStar filled={liked} className={`w-6 h-6 ${liked ? 'text-[#ff7a2a]' : ''}`} />
              </button>
              <button onClick={(e) => { e.stopPropagation(); p.onAddMv(); }} className="press p-2.5" title="Add to multiview"><IconPlus className="w-6 h-6" /></button>
              <div className="flex-1" />
              {!live && (
                <div className="flex items-center gap-1">
                  <select value={rate} onChange={(e) => setRate2(parseFloat(e.target.value))} onClick={(e) => e.stopPropagation()}
                    className="press bg-white/10 rounded-lg px-2 py-1.5 text-[12px] font-semibold outline-none backdrop-blur" title="Speed">
                    {[0.5, 0.75, 1, 1.25, 1.5, 2].map((r) => <option key={r} value={r}>{r === 1 ? 'Normal' : `${r}×`}</option>)}
                  </select>
                  {levels.length > 1 && (
                    <select value={curLevel} onChange={(e) => setLevel(parseInt(e.target.value, 10))} onClick={(e) => e.stopPropagation()}
                      className="press bg-white/10 rounded-lg px-2 py-1.5 text-[12px] font-semibold outline-none backdrop-blur" title="Quality">
                      <option value={-1}>Auto</option>
                      {levels.map((l) => <option key={l.i} value={l.i}>{l.label}</option>)}
                    </select>
                  )}
                  {audioTracks.length > 1 && (
                    <select value={audioTrack} onChange={(e) => setAudio(parseInt(e.target.value, 10))} onClick={(e) => e.stopPropagation()}
                      className="press bg-white/10 rounded-lg px-2 py-1.5 text-[12px] font-semibold outline-none backdrop-blur" title="Audio">
                      {audioTracks.map((a) => <option key={a.i} value={a.i}>{a.label}</option>)}
                    </select>
                  )}
                  {subTracks.length > 0 && (
                    <select value={subTrack} onChange={(e) => setSub(parseInt(e.target.value, 10))} onClick={(e) => e.stopPropagation()}
                      className="press bg-white/10 rounded-lg px-2 py-1.5 text-[12px] font-semibold outline-none backdrop-blur" title="Subtitles">
                      <option value={-1}>Off</option>
                      {subTracks.map((s) => <option key={s.i} value={s.i}>{s.label}</option>)}
                    </select>
                  )}
                </div>
              )}
              <span className="hidden"><IconSpeed className="w-5 h-5" /></span>
            </div>
          </div>
        </div>
      </div>

      {/* INFO AREA (portrait) */}
      <div className="scroll-y flex-1 min-h-0 player-info bg-[#0b0b0d] p-4 pb-[calc(28px+var(--safe-b,0px))] space-y-4">
        <div className="ios-card p-4 space-y-1.5">
          <div className="font-bold text-[17px] leading-snug">{p.channel.name}</div>
          <div className="text-[13px] text-white/55 flex flex-wrap gap-x-2 gap-y-1">
            {p.channel.groups?.map((g) => <span key={g} className="bg-white/8 rounded-full px-2 py-0.5 text-[11px]">{g}</span>)}
            {p.channel.qualityTag && <span className="bg-white/8 rounded-full px-2 py-0.5 text-[11px]">{p.channel.qualityTag}</span>}
          </div>
          {p.meta && (
            <div className="pt-1.5 space-y-1">
              {p.meta.vote_average > 0 && <div className="text-[13px] text-[#ffd60a]">★ {p.meta.vote_average.toFixed(1)}</div>}
              {p.meta.overview && <div className="text-[13px] text-white/60 leading-relaxed line-clamp-4">{p.meta.overview}</div>}
            </div>
          )}
        </div>

        {live && (p.nowNext?.now || (p.nowNext?.upcoming.length ?? 0) > 0) && (
          <div className="space-y-2">
            <div className="text-[13px] font-medium uppercase tracking-wide text-white/45 px-1">Programme guide</div>
            {p.nowNext?.now && (
              <div className="ios-card p-4 border-l-4 border-[#ff7a2a]">
                <div className="text-[11px] text-[#ff7a2a] font-bold mb-0.5">NOW</div>
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
                      className={`press w-full text-left ios-card px-4 py-3 flex items-center gap-3 ${e.channel.id === p.channel.id ? 'bg-[#ff7a2a]/15' : ''}`}>
                      <div className={`text-[12px] w-9 shrink-0 font-mono ${e.channel.id === p.channel.id ? 'text-[#ff7a2a]' : 'text-white/40'}`}>E{e.episodeNumber}</div>
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

        {p.channel.headers && (
          <div className="ios-card p-4 text-[12px] text-white/45">
            This entry requests custom HTTP headers ({Object.keys(p.channel.headers).join(', ')}). Browsers cannot send these to the stream; if playback fails, try another variant.
          </div>
        )}
      </div>
    </div>
  );
}

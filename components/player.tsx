'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import Hls from 'hls.js';
import { Channel, Program, SeriesEpisode } from '@/lib/types';
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

const isIOS = typeof navigator !== 'undefined' && (/iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1));

function fmtTime(s: number) {
  if (!Number.isFinite(s)) return '0:00';
  const h = Math.floor(s / 3600); const m = Math.floor((s % 3600) / 60); const sec = Math.floor(s % 60);
  return (h ? `${h}:${String(m).padStart(2, '0')}` : `${m}`) + `:${String(sec).padStart(2, '0')}`;
}

export default function Player(p: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const hlsRef = useRef<Hls | null>(null);
  const [controls, setControls] = useState(true);
  const [playing, setPlaying] = useState(false);
  const [buffering, setBuffering] = useState(true);
  const [error, setError] = useState('');
  const [time, setTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [levels, setLevels] = useState<{ i: number; label: string }[]>([]);
  const [curLevel, setCurLevel] = useState(-1);
  const [rate, setRate] = useState(1);
  const [controlsTimer, setControlsTimer] = useState<ReturnType<typeof setTimeout> | null>(null);
  const lastSave = useRef(0);

  /* attach source */
  useEffect(() => {
    const video = videoRef.current;
    if (!video || !p.channel) return;
    setPlaying(false); setBuffering(true); setError(''); setTime(0); setDuration(0); setLevels([]); setCurLevel(-1); setRate(1);
    if (hlsRef.current) { hlsRef.current.destroy(); hlsRef.current = null; }
    const url = p.channel.url;
    const isHlsUrl = /\.m3u8($|\?)|m3u8/.test(url) || p.channel.contentType === undefined;

    if (isHlsUrl) {
      if (isIOS || !Hls.isSupported()) {
        video.src = url;
      } else {
        const hls = new Hls({ enableWorker: true, lowLatencyMode: true });
        hlsRef.current = hls;
        hls.loadSource(url);
        hls.attachMedia(video);
        hls.on(Hls.Events.MANIFEST_PARSED, (_e, data) => {
          setLevels(data.levels.map((l, i) => ({ i, label: l.height ? `${l.height}p` : `${Math.round((l.bitrate || 0) / 1000)}k` })));
        });
        hls.on(Hls.Events.LEVEL_SWITCHED, (_e, data) => setCurLevel(hls.autoLevelEnabled ? -1 : data.level));
        hls.on(Hls.Events.ERROR, (_e, data) => {
          if (data.fatal) { setError('This stream could not be played.'); setBuffering(false); }
        });
      }
    } else {
      video.src = url;
    }

    let wakelock: any = null;
    if ('wakeLock' in navigator) {
      (navigator as any).wakeLock?.request('screen').then((wl: any) => (wakelock = wl)).catch(() => {});
    }
    if (p.resume && p.resume > 5) {
      video.addEventListener('loadedmetadata', () => { try { video.currentTime = p.resume!; } catch {} }, { once: true });
    }
    video.play().catch(() => {
      /* autoplay blocked: user taps play */
      setBuffering(false);
    });
    return () => {
      if (wakelock) wakelock.release?.().catch?.(() => {});
    };
  }, [p.channel.id]);

  /* cleanup hls unmount */
  useEffect(() => () => { hlsRef.current?.destroy(); }, []);

  /* render progress save */
  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    const onTime = () => {
      setTime(v.currentTime);
      if (Number.isFinite(v.duration)) setDuration(v.duration);
      if (p.channel.contentType !== 'LIVE' && Date.now() - lastSave.current > 8000) {
        lastSave.current = Date.now();
        p.onProgress(p.channel.id, v.currentTime, v.duration);
      }
    };
    const onPause = () => { p.onProgress(p.channel.id, v.currentTime, v.duration); };
    v.addEventListener('timeupdate', onTime);
    v.addEventListener('loadedmetadata', onTime);
    v.addEventListener('pause', onPause);
    v.addEventListener('play', () => setPlaying(true));
    v.addEventListener('pause', () => setPlaying(false));
    v.addEventListener('waiting', () => setBuffering(true));
    v.addEventListener('playing', () => { setBuffering(false); setPlaying(true); });
    v.addEventListener('error', () => { setError('This stream could not be played.'); setBuffering(false); });
    return () => {
      v.removeEventListener('timeupdate', onTime);
      v.removeEventListener('loadedmetadata', onTime);
      v.removeEventListener('pause', onPause);
    };
  }, [p.channel.id]);

  const toggleControls = useCallback(() => {
    setControls((c) => {
      const next = !c;
      if (next) {
        if (controlsTimer) clearTimeout(controlsTimer);
        setControlsTimer(setTimeout(() => setControls(false), 4000));
      }
      return next;
    });
  }, [controlsTimer]);

  useEffect(() => {
    if (controls) {
      if (controlsTimer) clearTimeout(controlsTimer);
      setControlsTimer(setTimeout(() => setControls(false), 4000));
    }
    return () => { if (controlsTimer) clearTimeout(controlsTimer); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [p.channel.id]);

  function togglePlay(e: React.MouseEvent) {
    e.stopPropagation();
    const v = videoRef.current;
    if (!v) return;
    if (v.paused) { v.play().catch(() => { if (isIOS) (v as any).webkitSetPresentationMode?.('inline'); }); }
    else v.pause();
  }

  function togglePip(e: React.MouseEvent) {
    e.stopPropagation();
    const v = videoRef.current as any;
    if (!v) return;
    try {
      if (isIOS && v.webkitSetPresentationMode) {
        v.webkitSetPresentationMode(v.webkitPresentationMode === 'picture-in-picture' ? 'inline' : 'picture-in-picture');
      } else if ((document as any).pictureInPictureElement) {
        (document as any).exitPictureInPicture();
      } else if (v.requestPictureInPicture) {
        v.requestPictureInPicture();
      }
    } catch {}
  }

  function seekTo(t: number) { const v = videoRef.current; if (v) { v.currentTime = t; setTime(t); } }

  function setRate2(r: number) { const v = videoRef.current; if (v) { v.playbackRate = r; setRate(r); } }
  function setLevel(i: number) { setCurLevel(i); if (hlsRef.current) hlsRef.current.currentLevel = i; }

  const live = p.channel.contentType !== 'MOVIE' && p.channel.contentType !== 'SERIES';
  const showSeek = !live && duration > 0;

  return (
    <div ref={wrapRef} className="player-overlay flex flex-col md:flex-row player-root">
      {/* VIDEO AREA: portrait 16:9 top, landscape fullscreen */}
      <div className="relative bg-black shrink-0 player-video-area md:flex-1 md:h-dvh" style={{ paddingBottom: 'env(safe-area-inset-top)' }}>
        <video
          ref={videoRef}
          playsInline
          autoPlay
          onClick={toggleControls}
          x5-playsinline="true"
          webkit-playsinline="true"
          className="w-full h-full bg-black player-video"
        />
        {buffering && !error && (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <div className="w-9 h-9 border-2 border-white/25 border-t-white rounded-full animate-spin" />
          </div>
        )}
        {error && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 px-8 text-center bg-black/70">
            <div className="text-white/90 text-[15px]">{error}</div>
            <button onClick={(e) => { e.stopPropagation(); const v = videoRef.current; if (v) { v.load(); v.play().catch(() => {}); } setError(''); setBuffering(true); }}
              className="press px-4 py-2 rounded-xl bg-white/10 text-[15px] font-semibold">Retry</button>
            <a href={p.channel.url} target="_blank" rel="noreferrer" className="press text-white/50 text-xs underline">Open stream URL</a>
          </div>
        )}

        {/* overlay top bar */}
        <div className={`absolute top-0 inset-x-0 transition-opacity ${controls ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}>
          <div className="bg-gradient-to-b from-black/70 to-transparent px-3 pt-[max(10px,var(--safe-t,0px))] pb-6 flex items-start gap-2">
            <button onClick={p.onClose} className="press p-2 -m-1 text-white"><IconClose className="w-6 h-6" /></button>
            <div className="flex-1 min-w-0 mt-0.5">
              <div className="truncate text-[15px] font-semibold leading-tight">{p.channel.name}</div>
              <div className="text-[11px] text-white/60">
                {live ? 'LIVE · ' : ''}{p.channel.qualityTag ? p.channel.qualityTag + ' · ' : ''}{p.channel.group}
              </div>
            </div>
            <button onClick={togglePip} className="press p-2 text-white"><IconPip className="w-6 h-6" /></button>
          </div>
        </div>

        {/* overlay center play + bottom controls */}
        <div className={`absolute inset-0 transition-opacity ${controls ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none'}`}>
          <div className="absolute inset-0 flex items-center justify-center">
            <button onClick={togglePlay} className="press text-white drop-shadow-lg">
              {playing ? <IconPauseCircle className="w-16 h-16 opacity-80" /> : <IconPlayCircle className="w-16 h-16 opacity-90" />}
            </button>
          </div>
          <div className="absolute bottom-0 inset-x-0 bg-gradient-to-t from-black/70 to-transparent px-4 pb-[max(10px,var(--safe-b,0px))] pt-8">
            {showSeek && (
              <div className="mb-2 flex items-center gap-2 text-[11px] text-white/80 font-mono">
                <span>{fmtTime(time)}</span>
                <input type="range" min={0} max={duration} step={1} value={time} onChange={(e) => seekTo(parseFloat(e.target.value))}
                  className="flex-1 h-1 accent-[#ff7a2a] bg-white/25 rounded-full appearance-none" style={{ WebkitAppearance: 'none' }} />
                <span>{fmtTime(duration)}</span>
              </div>
            )}
            {live && (
              <div className="mb-2 h-1 rounded-full bg-white/15 overflow-hidden">
                <div className="h-full bg-red-500 rounded-full" style={{ width: '100%', animation: 'pulse 2s infinite' }} />
              </div>
            )}
            <div className="flex items-center gap-1 text-white">
              <button onClick={(e) => { e.stopPropagation(); p.onToggleFav(); }} className="press p-2.5">
                <IconStar filled={p.isFav} className={`w-6 h-6 ${p.isFav ? 'text-[#ff7a2a]' : ''}`} />
              </button>
              <button onClick={(e) => { e.stopPropagation(); p.onAddMv(); }} className="press p-2.5" title="Add to multiview"><IconPlus className="w-6 h-6" /></button>
              {!live && (
                <div className="p-2.5"><IconSpeed className="w-6 h-6 white text-white" /></div>
              )}
              <div className="flex-1" />
              {!live && (
                <select value={rate} onChange={(e) => setRate2(parseFloat(e.target.value))} onClick={(e) => e.stopPropagation()}
                  className="press bg-black/50 rounded-lg px-2 py-1.5 text-[13px]" title="Playback speed">
                  {[0.5, 1, 1.25, 1.5, 2].map((r) => <option key={r} value={r}>{r}×</option>)}
                </select>
              )}
              {levels.length > 1 && (
                <select value={curLevel} onChange={(e) => setLevel(parseInt(e.target.value, 10))} onClick={(e) => e.stopPropagation()}
                  className="press bg-black/50 rounded-lg px-2 py-1.5 text-[13px] ml-1" title="Quality">
                  <option value={-1}>Auto</option>
                  {levels.map((l) => <option key={l.i} value={l.i}>{l.label}</option>)}
                </select>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* INFO AREA below video (portrait only) */}
      <div className="scroll-y flex-1 min-h-0 player-info bg-[#0b0b0d] p-4 pb-[calc(24px+var(--safe-b,0px))] space-y-4">
        <div className="ios-card p-4 space-y-1.5">
          <div className="font-bold text-[17px]">{p.channel.name}</div>
          <div className="text-[13px] text-white/55 flex flex-wrap gap-x-2 gap-y-1">
            {p.channel.group && <span>{p.channel.group}</span>}
            {p.channel.qualityTag && <span>· {p.channel.qualityTag}</span>}
            {live && <span>· Live TV</span>}
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
                <div className="text-[12px] text-white/45 font-mono shrink-0 w-24">{pr.start.slice(8, 10)}:{pr.start.slice(10, 12)}</div>
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
                      className={`press w-full text-left ios-card px-4 py-3 flex items-center gap-3 ${e.channel.id === p.channel.id ? 'bg-[#ff7a2a]/15 border-l-2 border-[#ff7a2a]' : ''}`}>
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
            This entry requests custom HTTP headers ({Object.keys(p.channel.headers).join(', ')}). Browsers cannot send these to the stream; if playback fails, try a stream variant without them.
          </div>
        )}
      </div>
    </div>
  );
}

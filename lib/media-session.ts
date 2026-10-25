/* Lock-screen / control-center playback info (Stage 7). Media Session API is
   widely supported on iOS 15+, Safari 15, Chrome; everything here no-ops when
   the API is missing so the player stays identical elsewhere. */

export type MediaSessionInfo = {
  title: string;
  artist?: string;
  album?: string;
  artworkUrl?: string;
};

export type MediaSessionHandlers = {
  play: () => void;
  pause: () => void;
  seekBack?: () => void;
  seekForward?: () => void;
  seekTo?: (t: number) => void;
  stop?: () => void;
};

export function mediaMetadataFor(info: MediaSessionInfo): MediaMetadata | null {
  if (typeof window === 'undefined' || !('mediaSession' in navigator) || typeof MediaMetadata === 'undefined') return null;
  return new MediaMetadata({
    title: info.title,
    artist: info.artist,
    album: info.album,
    artwork: info.artworkUrl ? [{ src: info.artworkUrl, sizes: '512x512', type: 'image/png' }] : [],
  });
}

/* Wire handlers + metadata once per playback session; returns a detach fn. */
export function attachMediaSession(meta: MediaSessionInfo, h: MediaSessionHandlers): () => void {
  if (typeof navigator === 'undefined' || !('mediaSession' in navigator)) return () => {};
  const ms = navigator.mediaSession;
  try {
    ms.metadata = mediaMetadataFor(meta);
  } catch {}
  const set = (action: MediaSessionAction, fn: MediaSessionActionHandler | undefined) => {
    try {
      if (fn) ms.setActionHandler(action, fn);
      else ms.setActionHandler(action, null as unknown as MediaSessionActionHandler);
    } catch { /* unsupported action on this browser */ }
  };
  set('play', () => h.play());
  set('pause', () => h.pause());
  set('seekbackward', h.seekBack ? () => h.seekBack!() : undefined);
  set('seekforward', h.seekForward ? () => h.seekForward!() : undefined);
  set('seekto', h.seekTo ? (d: any) => h.seekTo!(d.seekTime || 0) : undefined);
  set('stop', h.stop ? () => h.stop!() : undefined);
  return () => {
    try { ms.metadata = null; } catch {}
    for (const a of ['play', 'pause', 'seekbackward', 'seekforward', 'seekto', 'stop'] as MediaSessionAction[]) {
      try { ms.setActionHandler(a, null as unknown as MediaSessionActionHandler); } catch {}
    }
  };
}

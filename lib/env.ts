export const isIOS =
  typeof navigator !== 'undefined' &&
  (/iPad|iPhone|iPod/.test(navigator.userAgent) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1));

export const NATIVE_HLS =
  typeof document !== 'undefined' &&
  !!document.createElement('video').canPlayType('application/vnd.apple.mpegurl');

/* iOS version from the UA ("Version/17.2 Safari") — 0 when not iOS or unknown.
   iPadOS 13+ reports as desktop Safari; those get the maxTouchPoints check above
   and default to MMS when available. */
export function iosVersion(ua: string = typeof navigator !== 'undefined' ? navigator.userAgent : ''): number {
  if (!/iPad|iPhone|iPod/.test(ua)) return 0;
  const m = ua.match(/Version\/(\d+)(?:\.(\d+))?/);
  return m ? Number(m[1]) + Number(m[2] || 0) / 10 : 0;
}

/* ManagedMediaSource (iOS 17.1+) lets hls.js drive playback where only native
   HLS worked before. Below 17.1 we stay on native HLS; everywhere else hls.js
   + MSE is used as before. */
export function supportsMms(win: { ManagedMediaSource?: unknown } = (typeof window !== 'undefined' ? window : ({} as any))): boolean {
  return typeof win.ManagedMediaSource === 'function';
}

/* Feature flag: localStorage `mmsHls` = 'off' opts out of MMS playback
   (uses native HLS on iOS instead). Default on. */
export function mmsEnabled(store?: { getItem(k: string): string | null }): boolean {
  try {
    const s = store || (typeof localStorage !== 'undefined' ? localStorage : undefined);
    return s?.getItem('mmsHls') !== 'off';
  } catch {
    return true;
  }
}

/* Should hls.js own this stream? True unless the device is iOS < 17.1, where
   native HLS is still the better engine. Non-iOS (incl. desktop Safari) always
   prefers hls.js so quality/audio track menus keep working. */
export function preferHlsJs(ios: boolean, ver: number, mms: boolean, flag: boolean): boolean {
  if (!ios) return true;
  if (!mms || !flag) return false; /* iOS < 17.1 or opt-out → native */
  return ver === 0 || ver >= 17.1; /* iPadOS UA has no Version/x.y → trust MMS presence */
}

/* Multiview tile caps: phones throttle at 2, everything else allows 6. */
export function mvCap(smallScreen: boolean = typeof window !== 'undefined' && Math.min(window.innerWidth, window.innerHeight) < 500): number {
  return smallScreen ? 2 : 6;
}

export const isIOS =
  typeof navigator !== 'undefined' &&
  (/iPad|iPhone|iPod/.test(navigator.userAgent) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1));

export const NATIVE_HLS =
  typeof document !== 'undefined' &&
  !!document.createElement('video').canPlayType('application/vnd.apple.mpegurl');

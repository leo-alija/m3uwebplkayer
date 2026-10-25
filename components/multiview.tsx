'use client';

import { useEffect, useRef, useState } from 'react';
import type HlsJs from 'hls.js';
import { Channel } from '@/lib/types';
import { IconClose } from './ui';
import { isIOS, iosVersion, supportsMms, mmsEnabled, preferHlsJs } from '@/lib/env';

function MVTile({ ch, onExpand, onRemove, solo, onSolo, twoCol }: { ch: Channel; onExpand: () => void; onRemove: () => void; solo: boolean; onSolo: () => void; twoCol: boolean }) {
  const ref = useRef<HTMLVideoElement>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const video = ref.current;
    if (!video) return;
    let hls: HlsJs | null = null;
    let cancelled = false;
    const url = ch.url;
    (async () => {
      /* same engine choice as the player: native HLS below iOS 17.1, hls.js (via
         MMS there) elsewhere — with a native fallback if hls.js can't attach */
      if (/m3u8/.test(url) && preferHlsJs(isIOS, iosVersion(), supportsMms(), mmsEnabled())) {
        const Hls = (await import('hls.js')).default;
        if (cancelled) return;
        if (Hls.isSupported()) {
          if (video.src) { video.removeAttribute('src'); video.load(); }
          hls = new Hls({ enableWorker: true });
          hls.loadSource(url);
          hls.attachMedia(video);
          hls.on(Hls.Events.ERROR, (_e, d) => { if (d.fatal) setFailed(true); });
        } else {
          video.src = url;
        }
      } else {
        video.src = url;
      }
      video.play().catch(() => {});
    })();
    return () => { cancelled = true; if (hls) hls.destroy(); };
  }, [ch.url]);

  return (
    <div className="relative bg-black rounded-xl overflow-hidden" style={{ aspectRatio: '16 / 9' }}>
      <video ref={ref} playsInline muted={!solo} autoPlay loop
        className={`w-full h-full object-cover ${failed ? 'invisible' : ''}`} />
      {failed && (
        <div className="absolute inset-0 flex flex-col items-center justify-center text-white/40 text-[11px] gap-2">
          <span>Stream unavailable</span>
        </div>
      )}
      <div className="absolute top-1 left-1.5 right-1 flex items-center gap-1">
        <div className={`min-w-0 flex-1 truncate text-[10px] px-1.5 py-0.5 rounded-md ${solo ? 'bg-accent text-black font-bold' : 'bg-black/60'}`}>
          {solo ? '♪ ' : ''}{ch.name}
        </div>
      </div>
      <div className="absolute bottom-1 right-1 flex gap-1">
        <button onClick={onSolo} className="press w-7 h-7 rounded-full bg-black/70 text-[10px] font-bold" title="Solo audio">{solo ? '♪' : '🔇'}</button>
        <button onClick={onExpand} className="press w-7 h-7 rounded-full bg-accent text-black font-bold" title="Watch full screen">⤢</button>
        <button onClick={onRemove} className="press w-7 h-7 rounded-full bg-black/70 text-[11px]" title="Remove">✕</button>
      </div>
    </div>
  );
}

export default function Multiview({ items, onExpand, onRemove, onClear }: { items: Channel[]; onExpand: (ch: Channel) => void; onRemove: (id: string) => void; onClear: () => void }) {
  const [soloId, setSoloId] = useState<string | null>(null);

  return (
    <div className="fixed inset-0 z-40 bg-black flex flex-col">
      <div className="ios-blur hairline-b px-4 pt-[calc(10px+var(--safe-t,0px))] pb-3 flex items-center justify-between">
        <div className="text-[17px] font-bold">Multiview</div>
        <div className="flex items-center gap-3">
          <button onClick={onClear} className="press text-[14px] text-white/70">Clear</button>
          <button onClick={onClear} className="press p-1 text-white" aria-label="Close"><IconClose className="w-6 h-6" /></button>
        </div>
      </div>
      <div className="scroll-y flex-1 p-3 grid gap-2 content-start"
        style={{ gridTemplateColumns: `repeat(auto-fill, minmax(${items.length > 2 ? 180 : 240}px, 1fr))`, paddingBottom: 'calc(16px + var(--safe-b, 0px))' }}>
        {items.map((ch) => (
          <MVTile key={ch.id} ch={ch} twoCol={items.length > 2}
            solo={soloId === ch.id}
            onSolo={() => setSoloId((s) => (s === ch.id ? null : ch.id))}
            onExpand={() => onExpand(ch)}
            onRemove={() => onRemove(ch.id)} />
        ))}
        {items.length === 0 && (
          <div className="col-span-full py-24 text-center text-white/45 text-[14px] space-y-1">
            <div className="text-[42px] mb-2">◻️</div>
            Add channels from the player
            <div className="text-[12px] text-white/30">Tap ＋ while watching</div>
          </div>
        )}
      </div>
      {items.length > 0 && (
        <div className="px-4 pb-[calc(8px+var(--safe-b,0px))] pt-1">
          <div className="text-center text-[11px] text-white/30">Tap ♪ for solo audio · ⤢ for full screen</div>
        </div>
      )}
    </div>
  );
}

'use client';

import { ReactNode, useEffect, useRef, useState } from 'react';

/* ---------- Icons (SF-Symbols inspired, stroke based) ---------- */

type IProps = { className?: string };
const base = 'shrink-0';

export const IconHome = ({ className }: IProps) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className={`${base} ${className || ''}`}>
    <path d="M3 10.5 12 3l9 7.5" /><path d="M5 9.5V21h5v-6h4v6h5V9.5" />
  </svg>
);
export const IconLive = ({ className }: IProps) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className={`${base} ${className || ''}`}>
    <circle cx="12" cy="12" r="2.2" /><path d="M7.5 16.5a6.4 6.4 0 0 1 0-9M16.5 7.5a6.4 6.4 0 0 1 0 9M4.6 19.4a10.5 10.5 0 0 1 0-14.8M19.4 4.6a10.5 10.5 0 0 1 0 14.8" />
  </svg>
);
export const IconSeries = ({ className }: IProps) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className={`${base} ${className || ''}`}>
    <rect x="3" y="7" width="18" height="13" rx="2.5" /><path d="M8 3l4 4 4-4" />
  </svg>
);
export const IconMovie = ({ className }: IProps) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className={`${base} ${className || ''}`}>
    <rect x="3" y="4" width="18" height="16" rx="2.5" /><path d="M7 4v16M17 4v16M3 9h4M3 15h4M17 9h4M17 15h4" />
  </svg>
);
export const IconGuide = ({ className }: IProps) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className={`${base} ${className || ''}`}>
    <rect x="3" y="4" width="18" height="16" rx="2.5" /><path d="M8 4v16M3 9h5M11 9h7M11 13h7M11 17h7" />
  </svg>
);
export const IconSearch = ({ className }: IProps) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className={`${base} ${className || ''}`}>
    <circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" />
  </svg>
);
export const IconSettings = ({ className }: IProps) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" className={`${base} ${className || ''}`}>
    <circle cx="12" cy="12" r="3" />
    <path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3M5.2 5.2l2.1 2.1M16.7 16.7l2.1 2.1M18.8 5.2l-2.1 2.1M7.3 16.7l-2.1 2.1" />
  </svg>
);
export const IconClose = ({ className }: IProps) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className={`${base} ${className || ''}`}>
    <path d="M6 6l12 12M18 6L6 18" />
  </svg>
);
export const IconChevron = ({ className }: IProps) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" className={`${base} ${className || ''}`}>
    <path d="m9 5 7 7-7 7" />
  </svg>
);
export const IconStar = ({ filled, className }: IProps & { filled?: boolean }) => (
  <svg viewBox="0 0 24 24" fill={filled ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" className={`${base} ${className || ''}`}>
    <path d="M12 2.8l2.9 5.9 6.5.9-4.7 4.6 1.1 6.5L12 17.7l-5.8 3 1.1-6.5L2.6 9.6l6.5-.9z" />
  </svg>
);
export const IconPip = ({ className }: IProps) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" className={`${base} ${className || ''}`}>
    <rect x="2.5" y="4.5" width="19" height="15" rx="2.5" /><rect x="12" y="11" width="8" height="7" rx="1.5" fill="currentColor" stroke="none" />
  </svg>
);
export const IconAirplay = ({ className }: IProps) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" className={`${base} ${className || ''}`}>
    <path d="M5 16.5H4.5a2 2 0 0 1-2-2v-9a2 2 0 0 1 2-2h15a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H19" />
    <path d="m12 14.5 5.5 7h-11l5.5-7z" fill="currentColor" stroke="none" />
  </svg>
);
export const IconGrid = ({ className }: IProps) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" className={`${base} ${className || ''}`}>
    <rect x="3" y="3" width="8" height="8" rx="1.5" /><rect x="13" y="3" width="8" height="8" rx="1.5" /><rect x="3" y="13" width="8" height="8" rx="1.5" /><rect x="13" y="13" width="8" height="8" rx="1.5" />
  </svg>
);
export const IconPlus = ({ className }: IProps) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className={`${base} ${className || ''}`}>
    <path d="M12 5v14M5 12h14" />
  </svg>
);
export const IconShare = ({ className }: IProps) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className={`${base} ${className || ''}`}>
    <path d="M12 3v12M12 3 8 7M12 3l4 4" /><path d="M5 11v8.5A1.5 1.5 0 0 0 6.5 21h11a1.5 1.5 0 0 0 1.5-1.5V11" />
  </svg>
);
export const IconDownload = ({ className }: IProps) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className={`${base} ${className || ''}`}>
    <path d="M12 3v12M12 15l-4-4M12 15l4-4" /><path d="M5 19h14" />
  </svg>
);
export const IconTrash = ({ className }: IProps) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" className={`${base} ${className || ''}`}>
    <path d="M4 7h16M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2M6 7l1 13a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1l1-13" /><path d="M10 11v6M14 11v6" />
  </svg>
);
export const IconPlayCircle = ({ className }: IProps) => (
  <svg viewBox="0 0 24 24" fill="currentColor" className={`${base} ${className || ''}`}>
    <path d="M12 2a10 10 0 1 1 0 20 10 10 0 0 1 0-20zM10 7.8v8.4l7-4.2-7-4.2z" />
  </svg>
);
export const IconPauseCircle = ({ className }: IProps) => (
  <svg viewBox="0 0 24 24" fill="currentColor" className={`${base} ${className || ''}`}>
    <path d="M12 2a10 10 0 1 1 0 20 10 10 0 0 1 0-20zM9.5 7.5h1.8v9H9.5zM12.7 7.5h1.8v9h-1.8z" />
  </svg>
);
export const IconSpeed = ({ className }: IProps) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" className={`${base} ${className || ''}`}>
    <path d="M12 5a9 9 0 0 1 9 9M3 14a9 9 0 0 1 9-9" /><path d="M12 14l4.5-4.5" /><circle cx="12" cy="14" r="1.6" fill="currentColor" />
  </svg>
);
export const IconBackChevron = ({ className }: IProps) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" className={`${base} ${className || ''}`}>
    <path d="M15 4.5 7.5 12 15 19.5" />
  </svg>
);

/* ---------- Sheet (iOS bottom sheet) ---------- */

export function Sheet({ open, title, onClose, children, tall }: { open: boolean; title?: string; onClose: () => void; children: ReactNode; tall?: boolean }) {
  const drag = useRef({ y: 0, dy: 0, active: false });
  const bodyRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
    };
  }, [open, onClose]);

  if (!open) return null;

  const setSheetY = (px: number) => {
    if (bodyRef.current) bodyRef.current.style.transform = px > 0 ? `translateY(${px}px)` : '';
  };

  return (
    <div className="fixed inset-0 z-40">
      <div className="absolute inset-0 bg-black/60 fade-in" onClick={onClose} />
      <div className="absolute inset-x-0 bottom-0 md:inset-y-0 md:right-auto md:left-1/2 md:-translate-x-1/2 md:bottom-6 md:top-6 md:w-[560px] sheet-in">
        <div ref={bodyRef}
          className="bg-card rounded-t-2xl md:rounded-2xl border-t md:border border-white/10 flex flex-col transition-transform will-change-transform"
          style={{ maxHeight: tall ? '100dvh' : '92dvh', paddingBottom: 'var(--safe-b, 0px)' }}>
          <div
            className="w-full pt-3 pb-1.5 flex justify-center touch-none cursor-grab active:cursor-grabbing"
            onTouchStart={(e) => { drag.current = { y: e.touches[0].clientY, dy: 0, active: true }; }}
            onTouchMove={(e) => {
              if (!drag.current.active) return;
              drag.current.dy = e.touches[0].clientY - drag.current.y;
              setSheetY(drag.current.dy);
            }}
            onTouchEnd={() => {
              drag.current.active = false;
              if (drag.current.dy > 110) onClose(); else setSheetY(0);
            }}
            role="presentation">
            <button onClick={onClose} className="press" aria-label="Close">
              <div className="w-10 h-1.5 rounded-full bg-white/30" />
            </button>
          </div>
          {title && <div className="px-5 pb-2 pt-1 flex items-center justify-between">
            <div className="text-[20px] font-bold">{title}</div>
            <button onClick={onClose} className="press text-white/60"><IconClose className="w-5 h-5" /></button>
          </div>}
          <div className="scroll-y flex-1 overscroll-contain">{children}</div>
        </div>
      </div>
    </div>
  );
}

/* ---------- Small building blocks ---------- */

export function GroupRow({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="px-4 py-3">
      <div className="px-1 pb-1.5 text-[13px] font-medium uppercase tracking-wide text-white/45">{title}</div>
      <div className="ios-card divide-y divide-white/5">{children}</div>
    </div>
  );
}

export function Row({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={`px-4 min-h-[44px] flex items-center gap-3 ${className || ''}`}>{children}</div>;
}

export function Button({ onClick, children, className, primary, disabled }: { onClick?: () => void; children: ReactNode; className?: string; primary?: boolean; disabled?: boolean }) {
  return (
    <button onClick={onClick} disabled={disabled}
      className={`press px-4 py-2 rounded-xl text-[15px] font-semibold disabled:opacity-40 ${primary ? 'bg-accent text-black' : 'bg-white/10 text-white'} ${className || ''}`}>
      {children}
    </button>
  );
}

export function Chip({ label, active, onClick }: { label: string; active?: boolean; onClick?: () => void }) {
  return (
    <button onClick={onClick}
      className={`press px-3.5 py-1.5 rounded-full text-[14px] whitespace-nowrap ${active ? 'bg-accent text-black font-semibold' : 'bg-white/10 text-white/85'}`}>
      {label}
    </button>
  );
}

function hashString(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h;
}

function initialsOf(label: string): string {
  const words = label.trim().split(/[\s\-–—_.]+/).filter(Boolean);
  if (!words.length) return '';
  const first = words[0].replace(/[^A-Za-z0-9]/g, '');
  const second = words.length > 1 ? words[words.length - 1].replace(/[^A-Za-z0-9]/g, '') : '';
  return ((first[0] || '') + (second[0] || '')).toUpperCase() || label[0].toUpperCase();
}

export function Poster({ src, label, className }: { src?: string; label?: string; className?: string }) {
  const [failed, setFailed] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const has = !!src && !failed;
  /* Logo-less channels get a deterministic initials tile: same name → same
     colour, so shelves stay recognisable across reloads. SVG text scales with
     the tile, from 40px list rows to full posters. */
  const hue = label ? hashString(label) % 360 : 0;
  return (
    <div className={`relative overflow-hidden ${className || ''}`}>
      {!has && (
        <svg viewBox="0 0 100 100" preserveAspectRatio="xMidYMid slice" className="absolute inset-0 w-full h-full" aria-hidden>
          <defs>
            <linearGradient id={`pf-${hue}`} x1="0" y1="0" x2="1" y2="1">
              <stop offset="0%" stopColor={`hsl(${hue} 32% 26%)`} />
              <stop offset="100%" stopColor={`hsl(${(hue + 40) % 360} 32% 13%)`} />
            </linearGradient>
          </defs>
          <rect width="100" height="100" fill={`url(#pf-${hue})`} />
          {label && initialsOf(label) && (
            <text x="50" y="52" textAnchor="middle" dominantBaseline="central"
              fill="rgba(255,255,255,0.75)" fontWeight="800" fontFamily="inherit" fontSize="40">
              {initialsOf(label)}
            </text>
          )}
        </svg>
      )}
      {has && (
        <img src={src} alt="" loading="lazy" draggable={false}
          onError={() => setFailed(true)} onLoad={() => setLoaded(true)}
          className={`bg-gradient-to-br from-haze to-card object-cover w-full h-full transition-opacity duration-300 ${loaded ? 'opacity-100' : 'opacity-0'}`} />
      )}
    </div>
  );
}

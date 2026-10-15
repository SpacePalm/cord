// SF Symbol → lucide-react map + custom SF-like glyphs where lucide can't match:
// back/disclosure chevrons, solid ".fill" circles/squares with knocked-out glyphs, filled mic/speaker/
// camera/video/person.
import { useId, type CSSProperties, type ReactElement } from 'react';
import * as L from 'lucide-react';

/** Every SF Symbol the iOS app references. */
export const SF_SYMBOLS = [
  'arrow.clockwise', 'arrow.up.circle.fill', 'arrow.up.left.and.arrow.down.right',
  'arrowshape.turn.up.left', 'arrowshape.turn.up.left.fill', 'arrowshape.turn.up.right',
  'airpodspro', 'at', 'bell', 'bell.slash', 'bookmark', 'bookmark.fill', 'camera.fill', 'chart.bar',
  'checkmark', 'checkmark.circle', 'checkmark.circle.fill', 'checkmark.square.fill',
  'chevron.down', 'chevron.left', 'chevron.right', 'chevron.up.chevron.down', 'circle', 'circle.circle',
  'clock', 'curlybraces', 'desktopcomputer', 'doc', 'doc.fill', 'doc.on.doc', 'ellipsis', 'ellipsis.circle',
  'eraser', 'exclamationmark.triangle', 'eye', 'eye.slash', 'face.smiling', 'gearshape', 'globe',
  'hand.raised', 'hand.raised.slash', 'headphones', 'headphones.slash', 'internaldrive', 'iphone',
  'largecircle.fill.circle', 'line.3.horizontal.decrease.circle', 'link', 'lock', 'lock.shield',
  'magnifyingglass', 'message', 'mic', 'mic.fill', 'mic.slash.fill', 'minus.circle.fill',
  'minus.square.fill', 'number', 'paintbrush', 'paintpalette', 'paperclip', 'pause.circle.fill',
  'pencil', 'person', 'person.2', 'person.badge.plus', 'person.badge.shield.checkmark',
  'person.crop.circle', 'person.crop.circle.fill', 'person.fill.xmark', 'phone.down.fill',
  'phone.fill', 'photo', 'pin', 'pin.fill', 'pin.slash', 'play.circle.fill', 'plus', 'plus.circle.fill',
  'plus.square', 'rectangle.on.rectangle', 'rectangle.portrait.and.arrow.right', 'rotate.right',
  'server.rack', 'shield', 'shield.lefthalf.filled', 'slash.circle', 'slider.horizontal.3',
  'speaker.slash.fill', 'speaker.wave.2.fill', 'square', 'square.and.arrow.down',
  'square.and.arrow.up', 'text.bubble.fill', 'trash', 'video.fill', 'video.slash.fill', 'waveform',
  'wifi.slash', 'xmark', 'xmark.circle.fill',
  // additions: other common symbols
  'chevron.up', 'ellipsis.vertical', 'minus', 'play.fill', 'pause.fill', 'stop.fill', 'xmark.square',
  'arrow.down', 'arrow.up', 'person.fill', 'heart', 'heart.fill', 'star', 'star.fill', 'info.circle',
  'questionmark.circle', 'keyboard', 'arrow.uturn.backward', 'bubble.left', 'square.and.pencil',
  'list.bullet', 'checklist', 'photo.on.rectangle', 'film', 'music.note', 'speaker.wave.1.fill',
  'speaker.wave.3.fill', 'video', 'phone', 'mic.slash', 'calendar', 'tag', 'flag', 'bolt', 'trash.fill',
  // .fill variants used by swipe actions (SwiftUI renders swipe-action Labels with symbolVariant .fill)
  'eraser.fill', 'paintpalette.fill',
] as const;

export type SFSymbol = (typeof SF_SYMBOLS)[number];

/** Props every glyph renderer receives (lucide-compatible subset). */
interface GlyphProps {
  size: number;
  color: string;
  strokeWidth: number;
  className?: string;
  style?: CSSProperties;
}
type Glyph = (p: GlyphProps) => ReactElement;

type LucideIcon = typeof L.Search;

/* ── helpers ─────────────────────────────────────────────────────────────── */

function svgProps(p: GlyphProps, viewBox = '0 0 24 24') {
  return {
    width: p.size,
    height: p.size,
    viewBox,
    fill: 'none',
    stroke: p.color,
    strokeWidth: p.strokeWidth,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    className: p.className,
    style: p.style,
    'aria-hidden': true,
    focusable: false as const,
  };
}

/** Plain lucide glyph. */
const lu = (C: LucideIcon): Glyph =>
  function LucideGlyph(p) {
    return <C size={p.size} color={p.color} strokeWidth={p.strokeWidth} className={p.className} style={p.style} aria-hidden />;
  };

/** Lucide glyph filled with currentColor (for closed shapes: bookmark, pin, phone…). */
const luFill = (C: LucideIcon, extra?: CSSProperties): Glyph =>
  function LucideFilledGlyph(p) {
    return (
      <C
        size={p.size}
        color={p.color}
        fill={p.color}
        strokeWidth={p.strokeWidth}
        className={p.className}
        style={extra ? { ...extra, ...p.style } : p.style}
        aria-hidden
      />
    );
  };

/** SVG-safe unique id for masks. */
function useMaskId(): string {
  return 'iosm' + useId().replace(/[^a-zA-Z0-9_-]/g, '');
}

/**
 * Solid shape (circle / rounded square) with the inner glyph knocked out (transparent), like SF ".fill"
 * symbols. `inner` is drawn in black inside the mask (stroked and/or filled).
 */
function KnockoutShape({ p, shape, inner }: { p: GlyphProps; shape: 'circle' | 'square'; inner: ReactElement }) {
  const id = useMaskId();
  return (
    <svg width={p.size} height={p.size} viewBox="0 0 24 24" className={p.className} style={p.style} aria-hidden focusable={false}>
      <defs>
        <mask id={id} maskUnits="userSpaceOnUse" x="0" y="0" width="24" height="24">
          <rect x="0" y="0" width="24" height="24" fill="#fff" />
          <g fill="none" stroke="#000" strokeWidth={2.1} strokeLinecap="round" strokeLinejoin="round">
            {inner}
          </g>
        </mask>
      </defs>
      {shape === 'circle' ? (
        <circle cx="12" cy="12" r="10.5" fill={p.color} mask={`url(#${id})`} />
      ) : (
        <rect x="2" y="2" width="20" height="20" rx="5.5" fill={p.color} mask={`url(#${id})`} />
      )}
    </svg>
  );
}

const knock = (shape: 'circle' | 'square', inner: ReactElement): Glyph =>
  function KnockoutGlyph(p) {
    return <KnockoutShape p={p} shape={shape} inner={inner} />;
  };

/* ── custom glyphs ───────────────────────────────────────────────────────── */

/** SF `chevron.left` (back button): 11×19 glyph at a 24 box, heavier stroke. */
const ChevronLeftSF: Glyph = (p) => (
  <svg {...svgProps({ ...p, strokeWidth: p.strokeWidth })}>
    <path d="M15.6 2.6 6.4 12l9.2 9.4" />
  </svg>
);

/** SF `chevron.right` (mirrored back chevron). */
const ChevronRightSF: Glyph = (p) => (
  <svg {...svgProps(p)}>
    <path d="M8.4 2.6 17.6 12l-9.2 9.4" />
  </svg>
);

/** `largecircle.fill.circle`: ring + solid dot (radio ON). */
const LargeCircleFillCircle: Glyph = (p) => (
  <svg {...svgProps(p)}>
    <circle cx="12" cy="12" r="10" strokeWidth={Math.max(1.6, p.strokeWidth)} />
    <circle cx="12" cy="12" r="6" fill={p.color} stroke="none" />
  </svg>
);

/** `circle` (radio OFF) — thin ring matching largecircle.fill.circle. */
const CircleRing: Glyph = (p) => (
  <svg {...svgProps(p)}>
    <circle cx="12" cy="12" r="10" strokeWidth={Math.max(1.6, p.strokeWidth)} />
  </svg>
);

/** `circle.circle` (Status) — ring + inner ring. */
const CircleCircle: Glyph = (p) => (
  <svg {...svgProps(p)}>
    <circle cx="12" cy="12" r="10" />
    <circle cx="12" cy="12" r="5.6" />
  </svg>
);

/** `mic.fill`: solid capsule + stroked stand. */
const MicFill: Glyph = (p) => (
  <svg {...svgProps(p)}>
    <rect x="8.4" y="1.6" width="7.2" height="13.2" rx="3.6" fill={p.color} stroke="none" />
    <path d="M18.6 10.6v.9a6.6 6.6 0 0 1-13.2 0v-.9" />
    <path d="M12 18.4v3.4" />
  </svg>
);

/** `mic.slash.fill`: solid mic with a diagonal slash knocked out. */
const MicSlashFill: Glyph = (p) => {
  return <MicSlashFillInner p={p} />;
};
function MicSlashFillInner({ p }: { p: GlyphProps }) {
  const id = useMaskId();
  return (
    <svg {...svgProps(p)}>
      <defs>
        <mask id={id} maskUnits="userSpaceOnUse" x="0" y="0" width="24" height="24">
          <rect width="24" height="24" fill="#fff" />
          <path d="M3.2 3.2l17.6 17.6" stroke="#000" strokeWidth={p.strokeWidth + 3} />
        </mask>
      </defs>
      <g mask={`url(#${id})`}>
        <rect x="8.4" y="1.6" width="7.2" height="13.2" rx="3.6" fill={p.color} stroke="none" />
        <path d="M18.6 10.6v.9a6.6 6.6 0 0 1-13.2 0v-.9" />
        <path d="M12 18.4v3.4" />
      </g>
      <path d="M3.6 3.6l16.8 16.8" />
    </svg>
  );
}

/**
 * `speaker.wave.2.fill`: solid speaker + two stroked waves. SF draws it wider than the 24 box
 * (ink 23.3×18.3 for a Label icon) → the outer wave reaches the box edge.
 */
const SpeakerWave2Fill: Glyph = (p) => (
  <svg {...svgProps({ ...p, strokeWidth: p.strokeWidth * 1.1 })}>
    <path
      d="M1.2 8.4h3.6l5.3-4.6a.9.9 0 0 1 1.5.68v15.04a.9.9 0 0 1-1.5.68l-5.3-4.6H1.2a.9.9 0 0 1-.9-.9V9.3a.9.9 0 0 1 .9-.9z"
      fill={p.color}
      stroke="none"
    />
    <path d="M15.2 8.3a6 6 0 0 1 0 7.4" />
    <path d="M19.2 4.1a11 11 0 0 1 0 15.8" />
  </svg>
);

/** `speaker.wave.1.fill` / `speaker.wave.3.fill` variants. */
const SpeakerWave1Fill: Glyph = (p) => (
  <svg {...svgProps(p)}>
    <path
      d="M11 4.7a.7.7 0 0 0-1.2-.5L6.4 7.6a1.4 1.4 0 0 1-1 .4H3a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1h2.4a1.4 1.4 0 0 1 1 .4l3.4 3.4a.7.7 0 0 0 1.2-.5z"
      fill={p.color}
    />
    <path d="M15.4 9.2a4.6 4.6 0 0 1 0 5.6" />
  </svg>
);
const SpeakerWave3Fill: Glyph = (p) => (
  <svg {...svgProps(p)}>
    <path
      d="M10 4.7a.7.7 0 0 0-1.2-.5L5.4 7.6a1.4 1.4 0 0 1-1 .4H2.6a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1h1.8a1.4 1.4 0 0 1 1 .4l3.4 3.4a.7.7 0 0 0 1.2-.5z"
      fill={p.color}
    />
    <path d="M13.6 9.6a3.6 3.6 0 0 1 0 4.8" />
    <path d="M16.6 7a7.4 7.4 0 0 1 0 10" />
    <path d="M19.6 4.4a11.4 11.4 0 0 1 0 15.2" />
  </svg>
);

/** `speaker.slash.fill`. */
const SpeakerSlashFill: Glyph = (p) => (
  <svg {...svgProps(p)}>
    <path
      d="M11 4.7a.7.7 0 0 0-1.2-.5L6.4 7.6a1.4 1.4 0 0 1-1 .4H3a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1h2.4a1.4 1.4 0 0 1 1 .4l3.4 3.4a.7.7 0 0 0 1.2-.5z"
      fill={p.color}
    />
    <path d="M15.5 9.5l5 5M20.5 9.5l-5 5" />
  </svg>
);

/** `camera.fill`: solid body, lens knocked out. */
function CameraFillInner({ p }: { p: GlyphProps }) {
  const id = useMaskId();
  return (
    <svg {...svgProps(p)}>
      <defs>
        <mask id={id} maskUnits="userSpaceOnUse" x="0" y="0" width="24" height="24">
          <rect width="24" height="24" fill="#fff" />
          <circle cx="12" cy="13" r="3.4" fill="#000" stroke="#fff" strokeWidth="0" />
        </mask>
      </defs>
      <path
        d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3l-2.5-3z"
        fill={p.color}
        mask={`url(#${id})`}
      />
    </svg>
  );
}
const CameraFill: Glyph = (p) => <CameraFillInner p={p} />;

/** `video.fill`: solid body + solid side triangle. */
const VideoFill: Glyph = (p) => (
  <svg {...svgProps(p)}>
    <rect x="1.8" y="6" width="14.2" height="12" rx="2.6" fill={p.color} />
    <path d="M17.4 10.4l4.2-2.8a.5.5 0 0 1 .8.4v8a.5.5 0 0 1-.8.4l-4.2-2.8z" fill={p.color} />
  </svg>
);

/** `video.slash.fill`. */
function VideoSlashFillInner({ p }: { p: GlyphProps }) {
  const id = useMaskId();
  return (
    <svg {...svgProps(p)}>
      <defs>
        <mask id={id} maskUnits="userSpaceOnUse" x="0" y="0" width="24" height="24">
          <rect width="24" height="24" fill="#fff" />
          <path d="M2.4 2.4l19.2 19.2" stroke="#000" strokeWidth={p.strokeWidth + 3} />
        </mask>
      </defs>
      <g mask={`url(#${id})`}>
        <rect x="1.8" y="6" width="14.2" height="12" rx="2.6" fill={p.color} />
        <path d="M17.4 10.4l4.2-2.8a.5.5 0 0 1 .8.4v8a.5.5 0 0 1-.8.4l-4.2-2.8z" fill={p.color} />
      </g>
      <path d="M2.8 2.8l18.4 18.4" />
    </svg>
  );
}
const VideoSlashFill: Glyph = (p) => <VideoSlashFillInner p={p} />;

/** `person.crop.circle.fill`: solid circle with the head + shoulders knocked out. */
function PersonCropCircleFillInner({ p }: { p: GlyphProps }) {
  const id = useMaskId();
  return (
    <svg width={p.size} height={p.size} viewBox="0 0 24 24" className={p.className} style={p.style} aria-hidden focusable={false}>
      <defs>
        <mask id={id} maskUnits="userSpaceOnUse" x="0" y="0" width="24" height="24">
          <rect width="24" height="24" fill="#fff" />
          <circle cx="12" cy="9.6" r="3.9" fill="#000" />
          <path d="M5.2 19.2c1.4-2.6 3.9-4.1 6.8-4.1s5.4 1.5 6.8 4.1c-1.8 1.7-4.2 2.8-6.8 2.8s-5-1.1-6.8-2.8z" fill="#000" />
        </mask>
      </defs>
      <circle cx="12" cy="12" r="10.5" fill={p.color} mask={`url(#${id})`} />
    </svg>
  );
}
const PersonCropCircleFill: Glyph = (p) => <PersonCropCircleFillInner p={p} />;

/** `phone.down.fill`: solid handset rotated to horizontal. */
const PhoneDownFill = luFill(L.Phone, { transform: 'rotate(135deg)' });

/** `person.crop.circle`: ring + solid head and shoulders clipped to the circle (SF look). */
function PersonCropCircleInner({ p }: { p: GlyphProps }) {
  const id = useMaskId();
  return (
    <svg {...svgProps(p)}>
      <defs>
        <clipPath id={id}>
          <circle cx="12" cy="12" r="9.6" />
        </clipPath>
      </defs>
      <circle cx="12" cy="12" r="10" />
      <g clipPath={`url(#${id})`} fill={p.color} stroke="none">
        <circle cx="12" cy="9.7" r="3.7" />
        <path d="M4.6 19.4c1.5-2.7 4.2-4.3 7.4-4.3s5.9 1.6 7.4 4.3V23H4.6z" />
      </g>
    </svg>
  );
}
const PersonCropCircle: Glyph = (p) => <PersonCropCircleInner p={p} />;

/** `shield.lefthalf.filled`: shield outline with the left half solid. */
const ShieldLeftHalfFilled: Glyph = (p) => (
  <svg {...svgProps(p)}>
    <path d="M12 2.6 4.4 5.4v6.1c0 4.7 3.2 8.6 7.6 9.9 4.4-1.3 7.6-5.2 7.6-9.9V5.4z" />
    <path d="M12 2.6 4.4 5.4v6.1c0 4.7 3.2 8.6 7.6 9.9z" fill={p.color} />
  </svg>
);

/**
 * `desktopcomputer`: solid bezel with a thick chin, translucent screen, solid stand. SF draws it 25×21 — wider
 * than the 24 box (the svg overflows; .ios-icon has overflow: visible).
 */
function DesktopComputerInner({ p }: { p: GlyphProps }) {
  const id = useMaskId();
  return (
    <svg width={p.size} height={p.size} viewBox="0 0 24 24" className={p.className} style={p.style} aria-hidden focusable={false}>
      <defs>
        <mask id={id} maskUnits="userSpaceOnUse" x="-2" y="-2" width="28" height="28">
          <rect x="-2" y="-2" width="28" height="28" fill="#fff" />
          <rect x="1.3" y="3.3" width="21.4" height="10.9" rx="0.8" fill="#000" />
        </mask>
      </defs>
      <rect x="-0.5" y="1.5" width="25" height="16" rx="2.4" fill={p.color} mask={`url(#${id})`} />
      <rect x="1.3" y="3.3" width="21.4" height="10.9" rx="0.8" fill={p.color} opacity="0.28" />
      <path d="M10 17.4h4l.45 3.1h-4.9z" fill={p.color} />
      <rect x="7.6" y="20.3" width="8.8" height="2.2" rx="1.1" fill={p.color} />
    </svg>
  );
}
const DesktopComputer: Glyph = (p) => <DesktopComputerInner p={p} />;

/** `lock`: narrow SF padlock (14.3×20.7; lucide's is ~20 wide). */
const LockSF: Glyph = (p) => (
  <svg {...svgProps(p)}>
    <rect x="5.6" y="12.1" width="12.8" height="9.4" rx="2.4" />
    <path d="M8.3 12.1V6.3a3.7 3.7 0 0 1 7.4 0v5.8" />
  </svg>
);

/** `internaldrive`: drive box with a slanted top and a slot grille (24.7×17.7). */
const InternalDrive: Glyph = (p) => (
  <svg {...svgProps(p)}>
    <path d="M5.6 4.2h12.8a2 2 0 0 1 1.75 1.03L23.4 11v7a2.4 2.4 0 0 1-2.4 2.4H3A2.4 2.4 0 0 1 .6 18v-7l3.25-5.77A2 2 0 0 1 5.6 4.2z" />
    <path d="M.6 11h22.8" />
    <path d="M8.6 15.1v2.2M10.3 15.1v2.2M12 15.1v2.2M13.7 15.1v2.2M15.4 15.1v2.2" strokeWidth={p.strokeWidth * 0.7} />
  </svg>
);

/** `server.rack`: three stacked rack units with status dots (25×19.3). */
const ServerRack: Glyph = (p) => (
  <svg {...svgProps(p)}>
    <rect x="0.4" y="3.2" width="23.2" height="17.6" rx="2.6" />
    <path d="M.4 9.07h23.2M.4 14.93h23.2" />
    <g fill={p.color} stroke="none">
      <circle cx="19.6" cy="6.13" r="1" />
      <circle cx="19.6" cy="12" r="1" />
      <circle cx="19.6" cy="17.87" r="1" />
    </g>
  </svg>
);

/** `bookmark` / `bookmark.fill`: SF proportions (13.7×22.3; lucide's is shorter and wider). */
const BookmarkSF: Glyph = (p) => (
  <svg {...svgProps(p)}>
    <path d="M7.6 1.7h8.8A1.6 1.6 0 0 1 18 3.3v18a.7.7 0 0 1-1.15.54L12 17.9l-4.85 3.94A.7.7 0 0 1 6 21.3v-18a1.6 1.6 0 0 1 1.6-1.6z" />
  </svg>
);
const BookmarkFillSF: Glyph = (p) => (
  <svg {...svgProps(p)}>
    <path
      d="M6.85.85h10.3a1.7 1.7 0 0 1 1.7 1.7V22.1a.75.75 0 0 1-1.22.58L12 18.2l-5.63 4.48a.75.75 0 0 1-1.22-.58V2.55A1.7 1.7 0 0 1 6.85.85z"
      fill={p.color}
      stroke="none"
    />
  </svg>
);

/** Stop / play / pause solids. */
const PlayFill: Glyph = (p) => (
  <svg {...svgProps(p)}>
    <path d="M7 4.4v15.2a1 1 0 0 0 1.5.86l12.4-7.6a1 1 0 0 0 0-1.72L8.5 3.54A1 1 0 0 0 7 4.4z" fill={p.color} />
  </svg>
);
const PauseFill: Glyph = (p) => (
  <svg {...svgProps(p)}>
    <rect x="5.5" y="3.5" width="4.4" height="17" rx="1.2" fill={p.color} />
    <rect x="14.1" y="3.5" width="4.4" height="17" rx="1.2" fill={p.color} />
  </svg>
);
const StopFill: Glyph = (p) => (
  <svg {...svgProps(p)}>
    <rect x="4.5" y="4.5" width="15" height="15" rx="3" fill={p.color} />
  </svg>
);

/** `checkmark` — a touch heavier than lucide (SF checkmark is bold-ish at body size). */
const Checkmark: Glyph = (p) => (
  <svg {...svgProps(p)}>
    <path d="M4.5 12.6l4.8 4.9L19.5 6.5" />
  </svg>
);

/* swipe-action .fill glyphs (iOS 26: eraser.fill 17.5×17.5, paintpalette.fill 21.4×17.9, pencil 14.4×14,
   trash.fill 17×20.1 at a 21px icon) */

/** SF `pencil` is a thin diagonal ≈0.68em; lucide's spans the whole box → drawn at 75% (stroke compensated). */
const PencilSF: Glyph = (p) => (
  <L.Pencil
    size={p.size}
    color={p.color}
    strokeWidth={(p.strokeWidth * 4) / 3}
    viewBox="-5.2 -5.3 32 32"
    className={p.className}
    style={p.style}
    aria-hidden
  />
);

/** SF `trash.fill`: lid bar + handle outline, solid tapered can with three knocked-out ribs. */
function TrashFillSF(p: GlyphProps) {
  const id = useMaskId();
  return (
    <svg {...svgProps({ ...p, strokeWidth: 1.8 })}>
      <defs>
        <mask id={id} maskUnits="userSpaceOnUse" x="0" y="0" width="24" height="24">
          <path d="M5 6.1h14l-.92 16.1a1.8 1.8 0 0 1-1.8 1.7H7.72a1.8 1.8 0 0 1-1.8-1.7z" fill="#fff" stroke="none" />
          <path d="M9.2 9v12M12 9v12M14.8 9v12" stroke="#000" strokeWidth={1.35} strokeLinecap="round" />
        </mask>
      </defs>
      <path d="M2.6 4h18.8M9.1 4V2.2a1.1 1.1 0 0 1 1.1-1.1h3.6a1.1 1.1 0 0 1 1.1 1.1V4" />
      <rect x="0" y="0" width="24" height="24" fill={p.color} stroke="none" mask={`url(#${id})`} />
    </svg>
  );
}

/** SF `eraser.fill`: a solid rounded block tilted 45°, the lower-left sleeve split off by a thin gap. */
function EraserFillSF(p: GlyphProps) {
  const id = useMaskId();
  return (
    <svg {...svgProps(p)}>
      <defs>
        <mask id={id} maskUnits="userSpaceOnUse" x="0" y="0" width="24" height="24">
          <g transform="rotate(-45 12 12)">
            <rect x="1.5" y="7.25" width="21" height="9.5" rx="2" fill="#fff" stroke="none" />
            <path d="M8.4 6v12" stroke="#000" strokeWidth={1.3} />
          </g>
        </mask>
      </defs>
      <rect x="0" y="0" width="24" height="24" fill={p.color} stroke="none" mask={`url(#${id})`} />
    </svg>
  );
}

/** SF `paintpalette.fill`: wide solid palette with a side notch, four paint dots and a thumb hole knocked out. */
function PaintpaletteFillSF(p: GlyphProps) {
  const id = useMaskId();
  return (
    <svg {...svgProps(p)}>
      <defs>
        <mask id={id} maskUnits="userSpaceOnUse" x="0" y="0" width="24" height="24">
          <ellipse cx="12" cy="12" rx="12" ry="10.4" fill="#fff" stroke="none" />
          <g fill="#000" stroke="none">
            <path d="M24 10.4 19.6 12.3 24 14.6z" />
            <circle cx="5.1" cy="11.6" r="1.4" />
            <circle cx="8.8" cy="7.7" r="1.4" />
            <circle cx="13.6" cy="6.4" r="1.35" />
            <circle cx="18" cy="7.9" r="1.25" />
            <circle cx="12.7" cy="15.5" r="2.4" />
          </g>
        </mask>
      </defs>
      <rect x="0" y="0" width="24" height="24" fill={p.color} stroke="none" mask={`url(#${id})`} />
    </svg>
  );
}

/* knocked-out solids */
const XmarkCircleFill = knock('circle', <path d="M8.2 8.2l7.6 7.6M15.8 8.2l-7.6 7.6" />);
const PlusCircleFill = knock('circle', <path d="M12 6.8v10.4M6.8 12h10.4" />);
const MinusCircleFill = knock('circle', <path d="M6.8 12h10.4" />);
const CheckmarkCircleFill = knock('circle', <path d="M7.2 12.3l3.3 3.3 6.3-7" />);
const ArrowUpCircleFill = knock('circle', <path d="M12 17.4V7M7.4 11.4 12 6.8l4.6 4.6" />);
const PlayCircleFill = knock(
  'circle',
  <path d="M9.8 7.9v8.2a.6.6 0 0 0 .9.5l6.2-4.1a.6.6 0 0 0 0-1l-6.2-4.1a.6.6 0 0 0-.9.5z" fill="#000" strokeWidth={0.8} />,
);
const PauseCircleFill = knock('circle', <path d="M9.6 8.2v7.6M14.4 8.2v7.6" />);
const CheckmarkSquareFill = knock('square', <path d="M7.2 12.3l3.3 3.3 6.3-7" />);
const MinusSquareFill = knock('square', <path d="M7 12h10" />);

/* ── the map ─────────────────────────────────────────────────────────────── */

const MAP: Record<SFSymbol, Glyph> = {
  'arrow.clockwise': lu(L.RotateCw),
  'arrow.up.circle.fill': ArrowUpCircleFill,
  'arrow.up.left.and.arrow.down.right': lu(L.Maximize2),
  'arrowshape.turn.up.left': lu(L.Reply),
  'arrowshape.turn.up.left.fill': lu(L.Reply),
  'arrowshape.turn.up.right': lu(L.Forward),
  airpodspro: lu(L.Headphones),
  at: lu(L.AtSign),
  bell: lu(L.Bell),
  'bell.slash': lu(L.BellOff),
  bookmark: BookmarkSF,
  'bookmark.fill': BookmarkFillSF,
  'camera.fill': CameraFill,
  'chart.bar': lu(L.ChartColumn),
  checkmark: Checkmark,
  'checkmark.circle': lu(L.CircleCheck),
  'checkmark.circle.fill': CheckmarkCircleFill,
  'checkmark.square.fill': CheckmarkSquareFill,
  'chevron.down': lu(L.ChevronDown),
  'chevron.left': ChevronLeftSF,
  'chevron.right': ChevronRightSF,
  'chevron.up.chevron.down': lu(L.ChevronsUpDown),
  circle: CircleRing,
  'circle.circle': CircleCircle,
  clock: lu(L.Clock),
  curlybraces: lu(L.Braces),
  desktopcomputer: DesktopComputer,
  doc: lu(L.File),
  'doc.fill': lu(L.FileText),
  'doc.on.doc': lu(L.Copy),
  ellipsis: lu(L.Ellipsis),
  'ellipsis.circle': lu(L.CircleEllipsis),
  eraser: lu(L.Eraser),
  'exclamationmark.triangle': lu(L.TriangleAlert),
  eye: lu(L.Eye),
  'eye.slash': lu(L.EyeOff),
  'face.smiling': lu(L.Smile),
  gearshape: lu(L.Settings),
  globe: lu(L.Globe),
  'hand.raised': lu(L.Hand),
  'hand.raised.slash': lu(L.Ban),
  headphones: lu(L.Headphones),
  'headphones.slash': lu(L.HeadphoneOff),
  internaldrive: InternalDrive,
  iphone: lu(L.Smartphone),
  'largecircle.fill.circle': LargeCircleFillCircle,
  'line.3.horizontal.decrease.circle': lu(L.ListFilter),
  link: lu(L.Link),
  lock: LockSF,
  'lock.shield': lu(L.ShieldAlert),
  magnifyingglass: lu(L.Search),
  message: lu(L.MessageCircle),
  mic: lu(L.Mic),
  'mic.fill': MicFill,
  'mic.slash.fill': MicSlashFill,
  'minus.circle.fill': MinusCircleFill,
  'minus.square.fill': MinusSquareFill,
  number: lu(L.Hash),
  paintbrush: lu(L.Paintbrush),
  paintpalette: lu(L.Palette),
  paperclip: lu(L.Paperclip),
  'pause.circle.fill': PauseCircleFill,
  pencil: PencilSF,
  person: lu(L.User),
  'person.2': lu(L.Users),
  'person.badge.plus': lu(L.UserPlus),
  'person.badge.shield.checkmark': lu(L.ShieldCheck),
  'person.crop.circle': PersonCropCircle,
  'person.crop.circle.fill': PersonCropCircleFill,
  'person.fill.xmark': luFill(L.UserX), // a .fill symbol: solid person, stroked xmark
  'phone.down.fill': PhoneDownFill,
  'phone.fill': luFill(L.Phone),
  photo: lu(L.Image),
  pin: lu(L.Pin),
  'pin.fill': luFill(L.Pin),
  'pin.slash': lu(L.PinOff),
  'play.circle.fill': PlayCircleFill,
  plus: lu(L.Plus),
  'plus.circle.fill': PlusCircleFill,
  'plus.square': lu(L.SquarePlus),
  'rectangle.on.rectangle': lu(L.ScreenShare),
  'rectangle.portrait.and.arrow.right': lu(L.LogOut),
  'rotate.right': lu(L.RotateCw),
  'server.rack': ServerRack,
  shield: lu(L.Shield),
  'shield.lefthalf.filled': ShieldLeftHalfFilled,
  'slash.circle': lu(L.Ban),
  'slider.horizontal.3': lu(L.SlidersHorizontal),
  'speaker.slash.fill': SpeakerSlashFill,
  'speaker.wave.2.fill': SpeakerWave2Fill,
  square: lu(L.Square),
  'square.and.arrow.down': lu(L.Download),
  'square.and.arrow.up': lu(L.Share),
  'text.bubble.fill': lu(L.MessageSquareText),
  trash: lu(L.Trash2),
  'video.fill': VideoFill,
  'video.slash.fill': VideoSlashFill,
  waveform: lu(L.AudioLines),
  'wifi.slash': lu(L.WifiOff),
  xmark: lu(L.X),
  'xmark.circle.fill': XmarkCircleFill,
  // additions
  'chevron.up': lu(L.ChevronUp),
  'ellipsis.vertical': lu(L.EllipsisVertical),
  minus: lu(L.Minus),
  'play.fill': PlayFill,
  'pause.fill': PauseFill,
  'stop.fill': StopFill,
  'xmark.square': lu(L.SquareX),
  'arrow.down': lu(L.ArrowDown),
  'arrow.up': lu(L.ArrowUp),
  'person.fill': luFill(L.User),
  heart: lu(L.Heart),
  'heart.fill': luFill(L.Heart),
  star: lu(L.Star),
  'star.fill': luFill(L.Star),
  'info.circle': lu(L.Info),
  'questionmark.circle': lu(L.CircleHelp),
  keyboard: lu(L.Keyboard),
  'arrow.uturn.backward': lu(L.Undo2),
  'bubble.left': lu(L.MessageSquare),
  'square.and.pencil': lu(L.SquarePen),
  'list.bullet': lu(L.List),
  checklist: lu(L.ListChecks),
  'photo.on.rectangle': lu(L.Images),
  film: lu(L.Film),
  'music.note': lu(L.Music),
  'speaker.wave.1.fill': SpeakerWave1Fill,
  'speaker.wave.3.fill': SpeakerWave3Fill,
  video: lu(L.Video),
  phone: lu(L.Phone),
  'mic.slash': lu(L.MicOff),
  calendar: lu(L.Calendar),
  tag: lu(L.Tag),
  flag: lu(L.Flag),
  bolt: lu(L.Zap),
  'trash.fill': TrashFillSF,
  'eraser.fill': EraserFillSF,
  'paintpalette.fill': PaintpaletteFillSF,
};

/** True when `name` is a known SF Symbol (useful for props typed `SFSymbol | ReactNode`). */
export function isSFSymbol(name: unknown): name is SFSymbol {
  return typeof name === 'string' && Object.prototype.hasOwnProperty.call(MAP, name);
}

export interface IconProps {
  name: SFSymbol;
  /** Box size in px (lucide box; glyph ≈ 80% of it). List/nav 24, menus 20, captions 14–16. */
  size?: number;
  /** Default currentColor. */
  color?: string;
  /** Lucide units (24-grid). Default: 1.75; 2 for boxes ≤16px; 2.25 for chevrons. */
  strokeWidth?: number;
  className?: string;
  style?: CSSProperties;
}

function defaultStroke(name: SFSymbol, size: number): number {
  if (name === 'chevron.left' || name === 'chevron.right') return 2.4;
  if (name === 'chevron.down' || name === 'chevron.up' || name === 'chevron.up.chevron.down') return 2.25;
  if (name === 'checkmark') return 2.4;
  return size <= 16 ? 2 : 1.75;
}

/**
 * SwiftUI `.symbolVariant(.fill)` (applied automatically to swipe-action Labels): `name.fill` when that glyph
 * exists, otherwise the name itself.
 */
export function fillVariant(name: SFSymbol): SFSymbol {
  if (name.endsWith('.fill')) return name;
  const f = `${name}.fill` as SFSymbol;
  return f in MAP ? f : name;
}

export function Icon({ name, size = 24, color, strokeWidth, className, style }: IconProps) {
  const G = MAP[name] ?? MAP['circle'];
  const cls = className ? `ios-icon ${className}` : 'ios-icon';
  // Colour goes through CSS `color` + currentColor: CSS variables (var(--accent)) are not reliable inside SVG
  // presentation attributes.
  const st = color ? { ...style, color } : style;
  return <G size={size} color="currentColor" strokeWidth={strokeWidth ?? defaultStroke(name, size)} className={cls} style={st} />;
}

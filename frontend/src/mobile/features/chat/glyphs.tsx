// Composer glyphs drawn to match the iOS 26 SF Symbols (the shared Icon map
// uses lucide stand-ins whose shapes differ noticeably here).
import { useId } from 'react';

interface GlyphProps {
  size?: number;
  color?: string;
  className?: string;
}

/** `face.smiling` at .subheadline — iOS renders a solid disc with knocked-out eyes and smile (15×15). */
export function FaceSmilingGlyph({ size = 15, color = 'currentColor', className }: GlyphProps) {
  const id = useId().replace(/:/g, '');
  return (
    <svg width={size} height={size} viewBox="0 0 20 20" className={className} aria-hidden focusable={false}>
      <defs>
        <mask id={`m${id}`} maskUnits="userSpaceOnUse" x="0" y="0" width="20" height="20">
          <rect width="20" height="20" fill="#fff" />
          <ellipse cx="7.2" cy="7.9" rx="1.25" ry="1.6" fill="#000" />
          <ellipse cx="12.8" cy="7.9" rx="1.25" ry="1.6" fill="#000" />
          <path d="M6.1 11.9c.9 1.5 2.3 2.3 3.9 2.3s3-.8 3.9-2.3" fill="none" stroke="#000" strokeWidth="1.6" strokeLinecap="round" />
        </mask>
      </defs>
      <circle cx="10" cy="10" r="10" fill={color} mask={`url(#m${id})`} />
    </svg>
  );
}

/** `chart.bar`: three outlined bars of rising height, bottom-aligned (≈18.6×13.3). */
export function ChartBarGlyph({ size = 19, color = 'currentColor', className }: GlyphProps) {
  const h = (size * 13.6) / 18.6;
  return (
    <svg width={size} height={h} viewBox="0 0 18.6 13.6" className={className} aria-hidden focusable={false} fill="none" stroke={color} strokeWidth={1.25}>
      <rect x="0.62" y="4.6" width="4.3" height="8.38" rx="1.15" />
      <rect x="7.15" y="2.3" width="4.3" height="10.68" rx="1.15" />
      <rect x="13.68" y="0.62" width="4.3" height="12.36" rx="1.15" />
    </svg>
  );
}

/** `mic.fill` (title: ≈20×29; body: ≈14×20): solid capsule + U-shaped stand + stem + base. */
export function MicFillGlyph({ height = 29, color = 'currentColor', className }: { height?: number; color?: string; className?: string }) {
  const w = (height * 20) / 29;
  return (
    <svg width={w} height={height} viewBox="0 0 20 29" className={className} aria-hidden focusable={false}>
      <rect x="5.6" y="0.4" width="8.8" height="17.6" rx="4.4" fill={color} />
      <path d="M1.4 12.6v1.2a8.6 8.6 0 0 0 17.2 0v-1.2" fill="none" stroke={color} strokeWidth="1.9" strokeLinecap="round" />
      <path d="M10 22.6v4.2M5.2 27.6h9.6" fill="none" stroke={color} strokeWidth="1.9" strokeLinecap="round" />
    </svg>
  );
}

/** SF `trash` (no inner lines). */
export function TrashGlyph({ size = 20, color = 'currentColor', className }: GlyphProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" className={className} aria-hidden focusable={false} fill="none" stroke={color} strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round">
      <path d="M3.5 6h17" />
      <path d="M8.6 6V4.4c0-.9.7-1.6 1.6-1.6h3.6c.9 0 1.6.7 1.6 1.6V6" />
      <path d="M5.6 6l.95 13.3c.08 1.1 1 1.9 2.05 1.9h6.8c1.05 0 1.97-.8 2.05-1.9L18.4 6" />
    </svg>
  );
}

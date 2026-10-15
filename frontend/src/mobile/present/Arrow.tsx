// Glass popover arrow (tail).
export const ARROW_W = 26;
export const ARROW_H = 12;

const DOWN = `path('M0 0 H${ARROW_W} L15.6 10.4 Q13 13 10.4 10.4 Z')`;
const UP = `path('M0 ${ARROW_H} H${ARROW_W} L15.6 1.6 Q13 -1 10.4 1.6 Z')`;

/** `side` = which edge of the panel the arrow sits on; `x` = centre within the panel. */
export function PopoverArrow({ side, x }: { side: 'top' | 'bottom'; x: number }) {
  return (
    <div
      className="ios-popover-arrow"
      aria-hidden
      style={{
        left: x - ARROW_W / 2,
        [side === 'bottom' ? 'top' : 'bottom']: '100%',
        clipPath: side === 'bottom' ? DOWN : UP,
        WebkitClipPath: side === 'bottom' ? DOWN : UP,
      }}
    />
  );
}

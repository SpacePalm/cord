// iOS 26 Liquid Glass bar controls.
//  · BarButton      — single icon item → 44×44 glass circle (inside a BarGroup → a 46px slot)
//  · BarGroup       — adjacent items merged into one glass capsule (46n + 9.5(n−1) wide)
//  · BarTextButton  — text item → 44px glass capsule, padding 16, 17pt; prominent = semibold
//                     (`.confirmationAction`)
// All three work as MenuButton triggers (MenuButton wraps them).
import { createContext, forwardRef, useContext, type MouseEvent, type ReactNode } from 'react';
import { Icon, isSFSymbol, type SFSymbol } from '../ui/Icon';
import './nav.css';

export interface BarButtonProps {
  /** SF Symbol name, or a custom node (e.g. an Avatar). */
  icon: SFSymbol | ReactNode;
  onPress?: (e: MouseEvent<HTMLButtonElement>) => void;
  /** Glyph colour; default = tint (var(--accent)). Root search & chat icons use var(--text-secondary). */
  color?: string;
  /** 8×8 accent dot at the glyph's top-trailing corner (AdvancedSearch filters active). */
  dot?: boolean;
  ariaLabel: string;
  disabled?: boolean;
  /** Glyph box size (default 28 → SF nav glyphs ≈ 20–23pt). */
  iconSize?: number;
}

const GroupContext = createContext(false);

/** True inside a BarGroup (items render as slots of the shared capsule). */
export function useInBarGroup(): boolean {
  return useContext(GroupContext);
}

export const BarButton = forwardRef<HTMLButtonElement, BarButtonProps>(function BarButton(
  { icon, onPress, color, dot, ariaLabel, disabled, iconSize = 28 },
  ref,
) {
  const inGroup = useContext(GroupContext);
  const glyph: ReactNode = isSFSymbol(icon) ? <Icon name={icon} size={iconSize} /> : (icon as ReactNode);
  return (
    <button
      ref={ref}
      type="button"
      className={`ios-barbtn${inGroup ? ' is-slot' : ' ios-barglass'}`}
      aria-label={ariaLabel}
      disabled={disabled}
      onClick={onPress}
      style={color ? { color } : undefined}
    >
      <span className="ios-barbtn-glyph">
        {glyph}
        {dot && <span className="ios-barbtn-dot" aria-hidden />}
      </span>
    </button>
  );
});

/** Several adjacent bar buttons merged into one glass capsule. */
export function BarGroup({ children }: { children: ReactNode }) {
  return (
    <span className="ios-bargroup ios-barglass" role="group">
      <GroupContext.Provider value={true}>{children}</GroupContext.Provider>
    </span>
  );
}

export interface BarTextButtonProps {
  children: ReactNode;
  onPress?: () => void;
  /** `.confirmationAction` → semibold. */
  prominent?: boolean;
  disabled?: boolean;
  color?: string;
}

export const BarTextButton = forwardRef<HTMLButtonElement, BarTextButtonProps>(function BarTextButton(
  { children, onPress, prominent, disabled, color },
  ref,
) {
  const inGroup = useContext(GroupContext);
  return (
    <button
      ref={ref}
      type="button"
      className={`ios-bartext${prominent ? ' is-prominent' : ''}${inGroup ? ' is-slot' : ' ios-barglass'}`}
      disabled={disabled}
      onClick={onPress ? () => onPress() : undefined}
      style={color ? { color } : undefined}
    >
      {children}
    </button>
  );
});

/** The iOS 26 back button: chevron-only glass circle, label colour (not tint). */
export function BackButton({ onPress, ariaLabel }: { onPress: () => void; ariaLabel: string }) {
  return (
    <BarButton
      icon={<Icon name="chevron.left" size={22} />}
      color="var(--ios-label)"
      ariaLabel={ariaLabel}
      onPress={() => onPress()}
    />
  );
}

// Menu trigger: any child (BarButton, plus.circle.fill icon, avatar, "Aa" text…); a plain tap opens
// the iOS 26 glass Menu anchored to it.
import { isValidElement, type KeyboardEvent, type MouseEvent, type ReactNode } from 'react';
import { present, type MenuItem } from './PresentationProvider';
import { BarButton, BarTextButton } from '../nav/BarButton';
import '../nav/nav.css';

export interface MenuButtonProps {
  /** Items, or a function evaluated at open time (for live state like mute). */
  items: MenuItem[] | (() => MenuItem[]);
  /** The trigger: any node (BarButton, plus.circle.fill icon, avatar, "Aa" text…). A plain tap opens. */
  children: ReactNode;
  ariaLabel?: string;
  disabled?: boolean;
}

function isButtonLike(node: ReactNode): boolean {
  return isValidElement(node) && (node.type === BarButton || node.type === BarTextButton || node.type === 'button');
}

export function MenuButton({ items, children, ariaLabel, disabled }: MenuButtonProps) {
  const nativeButton = isButtonLike(children);
  const open = (el: HTMLElement) => {
    if (disabled) return;
    const list = typeof items === 'function' ? items() : items;
    if (!list.length) return;
    present.showMenu(el, list);
  };
  return (
    <span
      className="ios-menu-trigger"
      role={nativeButton ? undefined : 'button'}
      tabIndex={nativeButton || disabled ? undefined : 0}
      aria-label={nativeButton ? undefined : ariaLabel}
      aria-haspopup="menu"
      aria-disabled={disabled || undefined}
      onClick={(e: MouseEvent<HTMLSpanElement>) => {
        e.stopPropagation();
        open(e.currentTarget);
      }}
      onKeyDown={(e: KeyboardEvent<HTMLSpanElement>) => {
        if (nativeButton) return;
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          open(e.currentTarget);
        }
      }}
    >
      {children}
    </span>
  );
}

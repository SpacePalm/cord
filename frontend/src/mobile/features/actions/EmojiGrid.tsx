// Composer emoji popover (MessageListView.swift:1228-1242 `EmojiGridPicker`).
import { present } from '../../present/PresentationProvider';
import { COMPOSER_EMOJIS } from './shared';
import './actions.css';

/** LazyVGrid 5 × fixed 42 (column gap 8), row spacing 6, padding 12; emoji = .title2 plain buttons. */
export function EmojiGridPicker({ emojis = COMPOSER_EMOJIS, onPick }: { emojis?: string[]; onPick: (emoji: string) => void }) {
  return (
    <div className="m-act-emoji-grid" role="group">
      {emojis.map((e) => (
        <button
          key={e}
          type="button"
          className="m-act-emoji-cell"
          aria-label={e}
          // keep the composer focused: the keyboard stays up while picking
          onPointerDown={(ev) => ev.preventDefault()}
          onMouseDown={(ev) => ev.preventDefault()}
          onClick={() => onPick(e)}
        >
          {e}
        </button>
      ))}
    </div>
  );
}

/**
 * Composer smiley → anchored popover with a 5-column emoji grid; picking appends and stays open.
 * `onPick` is captured when the popover opens — append with a functional state update / ref.
 */
export function openEmojiGrid(anchor: HTMLElement, onPick: (emoji: string) => void): void {
  present.showPopover(anchor, () => <EmojiGridPicker onPick={onPick} />);
}

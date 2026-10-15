// Telegram-style long-press menu (MessageListView.swift:1258-1407 `MessageContextMenuView`).
// Layers (all position:fixed, rendered in place — mount it INSIDE the chat Screen tree, not in a portal):
//  · blur above the content area (0 … bounds.top) at z 9 → under the floating nav bar (z 10), which stays
//    visible and tappable, exactly like iOS (`.ultraThinMaterial.ignoresSafeArea()` under the bar);
//  · blur over the content area + composer (bounds.top … screen bottom) at z 11;
//  · the card (z 12): reactions capsule / 40-emoji grid, MessagePreview, action list.
// Geometry = iOS: card width min(280, W−40), centred on the pressed row, clamped so its top stays ≥70px below
// bounds.top and its bottom ≥40px above bounds.bottom; measured before the first paint (no settle jump).
// Deviation from iOS: a preview taller than the free space is capped with a bottom fade instead of
// letting the card overflow under the nav bar.
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type MouseEvent } from 'react';
import type { Message } from '../../../types';
import { Icon, type SFSymbol } from '../../ui/Icon';
import { useMT } from '../../i18n';
import { MessagePreview } from '../message/MessageRow';
import { ALL_REACTION_EMOJIS, QUICK_EMOJIS } from './shared';
import './actions.css';

export interface MessageContextMenuProps {
  msg: Message;
  /** Viewport rect of the pressed row. */
  rowRect: DOMRect;
  /** Viewport rect of the chat content area (below the nav bar, above the composer). */
  bounds: DOMRect;
  isMine: boolean;
  /** Server owner / admin / global admin may delete others' messages. */
  canDeleteOthers: boolean;
  /** Optimistic (sending/failed) row: "Выделить" hidden. */
  isPending: boolean;
  onReact: (emoji: string) => void;
  onReply: () => void;
  onCopy: () => void;
  onTogglePin: () => void;
  onForward: () => void;
  onSelect: () => void;
  onEdit: () => void;
  onDelete: () => void;
  /** Called after the close animation finished. */
  onClose: () => void;
  /**
   * Optional: the message left the feed (WS delete / chat cleared) → the overlay disappears instantly, without
   * the close animation (iOS L443). Without it the menu watches the pressed row (`[data-mid]`) itself.
   */
  gone?: boolean;
}

const CLOSE_MS = 150; // .easeOut(duration: 0.15)
const REMOVE_MS = 120; // onDismiss after 0.12s
const GRID_H = 200;
const SPRING_POS = 'transform 300ms cubic-bezier(0.2, 0.9, 0.25, 1)'; // spring(0.3, 0.85)

function reduced(): boolean {
  return typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true;
}

interface ActionDef {
  key: string;
  label: string;
  icon: SFSymbol;
  destructive?: boolean;
  run: () => void;
}

/** Telegram-style overlay: blurred backdrop, reactions capsule, message preview, action list. */
export function MessageContextMenu(props: MessageContextMenuProps) {
  const t = useMT();
  // Snapshot semantics (iOS captures the MessageItem at long-press time): preview + gating do not live-update.
  const [snap] = useState(() => ({
    msg: props.msg,
    isMine: props.isMine,
    canDeleteOthers: props.canDeleteOthers,
    isPending: props.isPending,
  }));
  const live = useRef(props);
  live.current = props;

  const { rowRect, bounds } = props;
  const W = bounds.width;
  const H = bounds.height;
  const cardW = Math.max(0, Math.min(280, W - 40));

  const cardRef = useRef<HTMLDivElement>(null);
  const posRef = useRef<HTMLDivElement>(null);
  const topBlurRef = useRef<HTMLDivElement>(null);
  const mainBlurRef = useRef<HTMLDivElement>(null);
  const reactRef = useRef<HTMLDivElement>(null);
  const previewRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const gridRef = useRef<HTMLDivElement>(null);

  const [cardH, setCardH] = useState<number | null>(null);
  const [previewMax, setPreviewMax] = useState<number | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [animatePos, setAnimatePos] = useState(false);
  const closing = useRef(false);
  const armed = useRef(false); // a press started on the overlay itself (ignore the long-press release click)

  // ── measure before the first paint: preview cap + card height ──
  const measure = useCallback(
    (isExpanded: boolean) => {
      const preview = previewRef.current;
      const list = listRef.current;
      const react = reactRef.current;
      if (!preview || !list) return;
      const reactH = isExpanded ? GRID_H : react?.offsetHeight ?? 46;
      const natural = preview.scrollHeight;
      const avail = Math.floor(H - 110 - (reactH + list.offsetHeight + 20));
      const cap = natural > avail ? Math.max(avail, 96) : null;
      setPreviewMax((prev) => (prev === cap ? prev : cap));
      const previewH = cap != null ? Math.min(natural, cap) : natural;
      setCardH(reactH + 10 + previewH + 10 + list.offsetHeight);
    },
    [H],
  );

  useLayoutEffect(() => {
    measure(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // later size changes (images in the preview finished loading, theme) → re-measure (position animates)
  const expandedRef = useRef(false);
  const measureRef = useRef(measure);
  measureRef.current = measure;
  useEffect(() => {
    const card = cardRef.current;
    const inner = previewRef.current?.firstElementChild;
    if (!card || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => {
      if (!closing.current) measureRef.current(expandedRef.current);
    });
    ro.observe(card);
    if (inner) ro.observe(inner);
    return () => ro.disconnect();
  }, []);

  const visible = cardH != null;

  // ── appear (spring 0.3/0.82: backdrop fade, card fade + scale 0.9→1 anchored at the top) ──
  useLayoutEffect(() => {
    if (!visible) return;
    const card = cardRef.current;
    const blurs = [topBlurRef.current, mainBlurRef.current];
    if (reduced()) {
      card?.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 200, easing: 'ease-out' });
    } else {
      card?.animate([{ transform: 'scale(0.9)' }, { transform: 'scale(1)' }], {
        duration: 340,
        easing: 'cubic-bezier(0.22, 1.1, 0.36, 1)',
      });
      card?.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 260, easing: 'ease-out' });
    }
    blurs.forEach((b) => b?.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 300, easing: 'ease-out' }));
    // position changes after the first frame animate (spring 0.3/0.85)
    const raf = requestAnimationFrame(() => setAnimatePos(true));
    return () => cancelAnimationFrame(raf);
  }, [visible]);

  const close = useCallback(() => {
    if (closing.current) return;
    closing.current = true;
    const card = cardRef.current;
    const opts: KeyframeAnimationOptions = { duration: CLOSE_MS, easing: 'ease-out', fill: 'forwards' };
    card?.animate([{ opacity: 1, transform: 'scale(1)' }, { opacity: 0, transform: reduced() ? 'scale(1)' : 'scale(0.9)' }], opts);
    [topBlurRef.current, mainBlurRef.current].forEach((b) => b?.animate([{ opacity: 1 }, { opacity: 0 }], opts));
    window.setTimeout(() => live.current.onClose(), REMOVE_MS);
  }, []);

  // Escape closes (web addition)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        close();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [close]);

  // The pressed message left the feed while the menu is open → remove instantly, no close animation (iOS: the
  // overlay renders only while `anchors[menuItem.id]` exists). Explicit `gone` prop, else watch the row itself
  // (only when it was found at open time, so a different row markup can never close the menu by mistake).
  const vanish = useCallback(() => {
    if (closing.current) return;
    closing.current = true;
    live.current.onClose();
  }, []);
  useEffect(() => {
    if (props.gone) vanish();
  }, [props.gone, vanish]);
  useEffect(() => {
    const sel = `[data-mid="${typeof CSS !== 'undefined' && CSS.escape ? CSS.escape(snap.msg.id) : snap.msg.id}"]`;
    if (!document.querySelector(sel)) return;
    const iv = window.setInterval(() => {
      if (!closing.current && !document.querySelector(sel)) vanish();
    }, 250);
    return () => window.clearInterval(iv);
  }, [snap.msg.id, vanish]);

  /** Runs the handler first, then the close animation (iOS `run(); close()`). */
  const act = (run: () => void) => (e: MouseEvent) => {
    // e.detail === 0 → keyboard activation
    if (closing.current || (!armed.current && e.detail !== 0)) return;
    try {
      run();
    } finally {
      close();
    }
  };

  const onBackdropClick = (e: MouseEvent) => {
    if (!armed.current && e.detail !== 0) return;
    close();
  };

  const expand = (e: MouseEvent) => {
    if (closing.current || (!armed.current && e.detail !== 0) || expanded) return;
    expandedRef.current = true;
    setExpanded(true);
    measure(true);
  };

  // grid "snappy" grow from the capsule
  useLayoutEffect(() => {
    if (!expanded) return;
    const g = gridRef.current;
    if (!g || reduced()) return;
    g.animate(
      [
        { width: '262px', height: '46px', borderRadius: '23px', opacity: 0.5 },
        { width: `${cardW}px`, height: `${GRID_H}px`, borderRadius: '20px', opacity: 1 },
      ],
      { duration: 250, easing: 'cubic-bezier(0.2, 0.8, 0.2, 1)' },
    );
  }, [expanded, cardW]);

  // ── geometry (MessageListView.swift:1398-1406) ──
  const h = cardH ?? 0;
  const half = cardW / 2;
  const srcMidX = rowRect.left + rowRect.width / 2 - bounds.left;
  const srcMidY = rowRect.top + rowRect.height / 2 - bounds.top;
  const cx = Math.min(Math.max(srcMidX, half + 12), W - half - 12);
  const cy = Math.min(Math.max(srcMidY, h / 2 + 70), H - h / 2 - 40);
  const left = Math.round(bounds.left + cx - half);
  const top = Math.round(bounds.top + cy - h / 2);

  const m = snap.msg;
  const content = m.content;
  const actions: ActionDef[] = [
    { key: 'reply', label: t('chat.reply'), icon: 'arrowshape.turn.up.left', run: () => live.current.onReply() },
  ];
  if (content != null && content !== '') actions.push({ key: 'copy', label: t('chat.copy'), icon: 'doc.on.doc', run: () => live.current.onCopy() });
  actions.push({
    key: 'pin',
    label: t(m.is_pinned ? 'chat.unpin' : 'chat.pin'),
    icon: m.is_pinned ? 'pin.slash' : 'pin',
    run: () => live.current.onTogglePin(),
  });
  actions.push({ key: 'forward', label: t('chat.forward'), icon: 'arrowshape.turn.up.right', run: () => live.current.onForward() });
  if (!snap.isPending) actions.push({ key: 'select', label: t('chat.select'), icon: 'checkmark.circle', run: () => live.current.onSelect() });
  if (snap.isMine && content != null) actions.push({ key: 'edit', label: t('chat.edit'), icon: 'pencil', run: () => live.current.onEdit() });
  if (snap.isMine || snap.canDeleteOthers)
    actions.push({ key: 'delete', label: t('chat.delete'), icon: 'trash', destructive: true, run: () => live.current.onDelete() });

  const arm = () => {
    armed.current = true;
  };
  /** The keyboard, if open, stays open while the menu is up (iOS): never move focus off the composer. */
  const keepFocus = (e: MouseEvent) => e.preventDefault();

  const posStyle: CSSProperties = {
    width: cardW,
    transform: `translate3d(${left}px, ${top}px, 0)`,
    transition: animatePos ? SPRING_POS : 'none',
    visibility: visible ? 'visible' : 'hidden',
  };

  return (
    <>
      <div
        ref={topBlurRef}
        className="m-act-ctx-blur is-top"
        style={{ height: Math.max(0, bounds.top), visibility: visible ? 'visible' : 'hidden' }}
        onPointerDown={arm}
        onMouseDown={keepFocus}
        onClick={onBackdropClick}
        aria-hidden
      />
      <div
        ref={mainBlurRef}
        className="m-act-ctx-blur is-main"
        style={{ top: Math.max(0, bounds.top), visibility: visible ? 'visible' : 'hidden' }}
        onPointerDown={arm}
        onMouseDown={keepFocus}
        onClick={onBackdropClick}
        aria-hidden
      />
      <div ref={posRef} className="m-act-ctx-pos" style={posStyle} onPointerDown={arm} role="menu">
        <div
          ref={cardRef}
          className="m-act-ctx-card"
          onMouseDown={keepFocus}
          onContextMenu={(e) => e.preventDefault()}
        >
          {expanded ? (
            <div ref={gridRef} className="m-act-react-grid" style={{ width: cardW }}>
              <div className="m-act-react-grid-inner">
                {ALL_REACTION_EMOJIS.map((e) => (
                  <button key={e} type="button" className="m-act-react-cell" onClick={act(() => live.current.onReact(e))}>
                    {e}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <div ref={reactRef} className="m-act-react-bar">
              {QUICK_EMOJIS.map((e) => (
                <button key={e} type="button" className="m-act-react-btn" onClick={act(() => live.current.onReact(e))}>
                  {e}
                </button>
              ))}
              <button type="button" className="m-act-react-more" aria-label={t('common.more')} onClick={expand}>
                <Icon name="chevron.down" size={24} strokeWidth={2.6} />
              </button>
            </div>
          )}

          <div
            ref={previewRef}
            className={'m-act-ctx-preview' + (previewMax != null ? ' is-capped' : '')}
            style={previewMax != null ? { maxHeight: previewMax } : undefined}
            aria-hidden
          >
            <MessagePreview msg={m} />
          </div>

          <div ref={listRef} className="m-act-ctx-list">
            {actions.map((a, i) => (
              <div key={a.key} className="m-act-ctx-item">
                {i > 0 && <div className="m-act-ctx-sep" />}
                <button
                  type="button"
                  role="menuitem"
                  className={'m-act-ctx-action' + (a.destructive ? ' is-destructive' : '')}
                  onClick={act(a.run)}
                >
                  <span className="m-act-ctx-label">{a.label}</span>
                  <span className="m-act-ctx-icon">
                    <Icon name={a.icon} size={22} />
                  </span>
                </button>
              </div>
            ))}
          </div>
        </div>
      </div>
    </>
  );
}

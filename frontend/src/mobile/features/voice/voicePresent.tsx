// Layers presented from the voice room (member sheet, devices sheet, screen-share cover). They are
// tracked so that collapsing / ending the call closes them together with the room sheet.
import type { ReactNode } from 'react';
import { present, type SheetCtx, type SheetOptions } from '../../present/PresentationProvider';

const children = new Set<SheetCtx>();

export function presentVoiceSheet(render: (ctx: SheetCtx) => ReactNode, opts: SheetOptions = {}): SheetCtx {
  let me: SheetCtx | null = null;
  me = present.presentSheet(render, {
    ...opts,
    onDismiss: () => {
      if (me) children.delete(me);
      opts.onDismiss?.();
    },
  });
  children.add(me);
  return me;
}

export function presentVoiceFullScreen(render: (ctx: SheetCtx) => ReactNode): SheetCtx {
  let me: SheetCtx | null = null;
  me = present.presentFullScreen(render, {
    onDismiss: () => {
      if (me) children.delete(me);
    },
  });
  children.add(me);
  return me;
}

/** Close every layer presented from the room (top-most first). */
export function dismissVoiceChildren(): Promise<void> {
  const list = [...children].reverse();
  children.clear();
  return Promise.all(list.map((c) => c.dismiss())).then(() => undefined);
}

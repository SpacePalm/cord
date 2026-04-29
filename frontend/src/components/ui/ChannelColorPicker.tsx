// Пикер цвета канала: пресеты + произвольный hex + «без цвета».
//
// Используется в:
//  • форме создания канала (GroupSettingsModal → ChannelsTab)
//  • редактировании уже созданного канала (там же)
//
// Контракт:
//  value === null → «без цвета»
//  value === '#rrggbb' → выбранный цвет (hex, в нижнем регистре)
//  onChange отдаёт null или валидный hex
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Slash } from 'lucide-react';

export const CHANNEL_COLOR_PRESETS = [
  '#ef4444', '#f97316', '#eab308', '#22c55e',
  '#14b8a6', '#3b82f6', '#a855f7', '#ec4899',
] as const;

const HEX_RE = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

interface Props {
  value: string | null | undefined;
  onChange: (color: string | null) => void;
  /** Размер «дотика»-триггера (опционально). По умолчанию 14. */
  size?: number;
  /** title для триггера. */
  title?: string;
}

/**
 * Маленький круглый триггер с текущим цветом. По клику открывает поповер.
 * Ничего не рендерит сам внутри поповера до открытия — экономит DOM.
 */
export function ChannelColorPicker({ value, onChange, size = 14, title }: Props) {
  const [open, setOpen] = useState(false);
  const btnRef = useRef<HTMLButtonElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const [hexInput, setHexInput] = useState(value && HEX_RE.test(value) ? value : '');

  useEffect(() => {
    if (!open || !btnRef.current) return;
    const rect = btnRef.current.getBoundingClientRect();
    // Поповер вниз-вправо. Если не помещается — клампим к окну.
    const w = 200, h = 130;
    const top = Math.min(rect.bottom + 6, window.innerHeight - h - 4);
    const left = Math.min(Math.max(4, rect.left - 4), window.innerWidth - w - 4);
    setPos({ top, left });
  }, [open]);

  // Синкаем поле hex при внешнем изменении value (например смене канала).
  useEffect(() => {
    setHexInput(value && HEX_RE.test(value) ? value : '');
  }, [value]);

  const swatchStyle: React.CSSProperties = value
    ? { background: value }
    : {}; // пустой — рендерим перечёркнутый кружок

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        onClick={(e) => { e.stopPropagation(); setOpen((v) => !v); }}
        title={title ?? 'Color'}
        className="shrink-0 inline-flex items-center justify-center rounded-full border border-[var(--border-color)] hover:scale-110 transition-transform"
        style={{ width: size + 4, height: size + 4, ...swatchStyle }}
      >
        {!value && <Slash size={size - 2} className="text-[var(--text-muted)]" strokeWidth={2.5} />}
      </button>

      {open && pos && createPortal(
        <>
          <div className="fixed inset-0 z-[60]" onMouseDown={() => setOpen(false)} />
          <div
            className="fixed z-[61] w-[200px] bg-[var(--bg-secondary)] border border-[var(--border-color)] rounded-lg shadow-xl p-2 flex flex-col gap-2"
            style={{ top: pos.top, left: pos.left }}
            onMouseDown={(e) => e.stopPropagation()}
          >
            <div className="grid grid-cols-8 gap-1">
              {/* «Без цвета» */}
              <button
                type="button"
                onClick={() => { onChange(null); setOpen(false); }}
                title="No color"
                className={`relative w-5 h-5 rounded-full border flex items-center justify-center transition-transform hover:scale-110 ${
                  !value ? 'border-[var(--accent)] ring-1 ring-[var(--accent)]' : 'border-[var(--border-color)]'
                }`}
              >
                <Slash size={11} className="text-[var(--text-muted)]" strokeWidth={2.5} />
              </button>
              {CHANNEL_COLOR_PRESETS.map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => { onChange(c); setOpen(false); }}
                  title={c}
                  className={`w-5 h-5 rounded-full border transition-transform hover:scale-110 ${
                    value?.toLowerCase() === c ? 'border-[var(--accent)] ring-1 ring-[var(--accent)]' : 'border-transparent'
                  }`}
                  style={{ background: c }}
                />
              ))}
            </div>

            <div className="border-t border-[var(--border-color)] pt-2 flex items-center gap-1.5">
              <input
                type="color"
                value={hexInput || '#3b82f6'}
                onChange={(e) => { setHexInput(e.target.value); onChange(e.target.value); }}
                className="w-7 h-7 rounded border-0 cursor-pointer bg-transparent [&::-webkit-color-swatch-wrapper]:p-0 [&::-webkit-color-swatch]:rounded shrink-0"
              />
              <input
                type="text"
                value={hexInput}
                onChange={(e) => setHexInput(e.target.value)}
                onBlur={() => {
                  if (HEX_RE.test(hexInput)) onChange(hexInput.toLowerCase());
                  else setHexInput(value && HEX_RE.test(value) ? value : '');
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') (e.currentTarget as HTMLInputElement).blur();
                  if (e.key === 'Escape') { setHexInput(value && HEX_RE.test(value) ? value : ''); setOpen(false); }
                }}
                placeholder="#3b82f6"
                maxLength={9}
                className="flex-1 min-w-0 px-1.5 py-1 rounded bg-[var(--bg-input)] text-xs text-[var(--text-primary)] border border-[var(--border-color)] focus:outline-none focus:border-[var(--accent)]"
              />
            </div>
          </div>
        </>,
        document.body,
      )}
    </>
  );
}

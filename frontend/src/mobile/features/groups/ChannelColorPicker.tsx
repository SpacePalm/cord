// iOS ChannelColorPicker (ChannelManageViews.swift:6-43): "COLOR" caption, 5-column grid
// ("none" + 8 presets, 30px circles, 2px inner --text-primary ring when selected) and the system
// ColorPicker row "Свой цвет" (rainbow well over an invisible <input type="color">).
// `value`: null = no colour, otherwise "#rrggbb".
import { CHANNEL_COLOR_PRESETS } from '../../../components/ui/ChannelColorPicker';
import { Icon } from '../../ui';
import { useMT } from '../../i18n';
import './groups.css';

export interface ChannelColorPickerProps {
  value: string | null;
  onChange: (color: string | null) => void;
}

/** "#abc" → "#aabbcc"; anything unparsable → null. */
function toHex6(color: string | null): string | null {
  if (!color) return null;
  const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(color.trim());
  if (!m) return null;
  const h = m[1].length === 3 ? m[1].split('').map((c) => c + c).join('') : m[1];
  return `#${h.toLowerCase()}`;
}

export function ChannelColorPicker({ value, onChange }: ChannelColorPickerProps) {
  const t = useMT();
  const current = value ? value.toLowerCase() : null;
  const well = toHex6(value);
  return (
    <div className="m-grp-colors">
      <div className="m-grp-colors-label">{t('channels.color')}</div>
      <div className="m-grp-colors-grid">
        <button
          type="button"
          className={'m-grp-swatch' + (value == null ? ' is-selected' : '')}
          style={{ background: 'var(--bg-input)' }}
          aria-pressed={value == null}
          aria-label="—"
          onClick={() => onChange(null)}
        >
          <Icon name="slash.circle" size={14} strokeWidth={2} />
        </button>
        {CHANNEL_COLOR_PRESETS.map((hex) => (
          <button
            key={hex}
            type="button"
            className={'m-grp-swatch' + (current === hex ? ' is-selected' : '')}
            style={{ background: hex }}
            aria-pressed={current === hex}
            aria-label={hex}
            onClick={() => onChange(hex)}
          />
        ))}
      </div>
      <label className="m-grp-custom-color">
        <span className="m-grp-custom-color-label">{t('channels.colorCustom')}</span>
        <span className="m-grp-well">
          <span className="m-grp-well-swatch" style={{ background: value ?? 'var(--bg-input)' }} />
          <input
            type="color"
            value={well ?? '#000000'}
            aria-label={t('channels.colorCustom')}
            onChange={(e) => onChange(e.target.value.toLowerCase())}
          />
        </span>
      </label>
    </div>
  );
}

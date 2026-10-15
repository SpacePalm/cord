// Shared pieces of the iOS settings screens (SettingsView.swift SettingsSaveButton, the ScrollView form
// container `VStack(alignment: .leading, spacing: 16).padding(20)` and the footnote status message).
import type { ReactNode } from 'react';
import { ApiError } from '../../../api/client';
import { useAuthStore } from '../../../store/authStore';
import type { User } from '../../../types';
import { CordButton } from '../../ui';
import './settings.css';

/** iOS `APIError.userMessage(default:)`: the server's text detail, else the fallback. */
export function apiMessage(err: unknown, fallback: string): string {
  if (err instanceof ApiError) {
    const d = err.detail;
    if (typeof d === 'string' && d.trim()) return d;
    return fallback;
  }
  return fallback;
}

/** Profile / Status / Password: API error → server text or `fallback`; anything else → "Ошибка: %@". */
export function formErrorMessage(err: unknown, fallback: string, prefix: (msg: string) => string): string {
  if (err instanceof ApiError) return apiMessage(err, fallback);
  const msg = err instanceof Error ? err.message : String(err ?? '');
  return prefix(msg);
}

/** `SettingsSaveButton`: primary CordButton, white spinner while busy, disabled when busy || !enabled. */
export function SettingsSaveButton({
  title,
  busy,
  enabled,
  onPress,
}: {
  title: string;
  busy: boolean;
  enabled: boolean;
  onPress: () => void;
}) {
  return (
    <CordButton busy={busy} disabled={!enabled} onPress={onPress}>
      {title}
    </CordButton>
  );
}

/** ScrollView form body: VStack(alignment: .leading, spacing: 16).padding(20). */
export function SettingsForm({ children }: { children: ReactNode }) {
  return <div className="m-set-form">{children}</div>;
}

/** Footnote under the save button: --danger on error, else --text-secondary. */
export function FormMessage({ text, error }: { text: string | null; error?: boolean }) {
  if (!text) return null;
  return (
    <div className="m-set-msg ios-selectable" style={{ color: error ? 'var(--danger)' : 'var(--text-secondary)' }} role={error ? 'alert' : 'status'}>
      {text}
    </div>
  );
}

/** CordField has no onSubmit on iOS: Return just resigns the first responder. */
export function blurActive(): void {
  const el = document.activeElement;
  if (el instanceof HTMLElement) el.blur();
}

/**
 * iOS `env.applyUpdatedUser`: store the server's user, keeping this session's avatar cache-buster when the
 * avatar itself did not change (profile / status / password responses return the bare path).
 */
export function applyUpdatedUser(updated: User): void {
  const cur = useAuthStore.getState().user;
  const keep = !!cur?.image_path && !!updated.image_path && cur.image_path.split('?')[0] === updated.image_path;
  useAuthStore.getState().setUser(keep && cur ? { ...updated, image_path: cur.image_path } : updated);
}

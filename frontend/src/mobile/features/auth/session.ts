// Logged-out helpers for the mobile auth pages.
import { useEffect, type CSSProperties } from 'react';
import type { QueryClient } from '@tanstack/react-query';
import type { AuthTokens } from '../../../types';
import { useAuthStore } from '../../../store/authStore';
import { PRESET_THEMES, useThemeStore, type Theme } from '../../../store/themeStore';
import { applyServerPreferences, startPreferencesAutoSync } from '../../../utils/preferencesSync';

function paletteVars(t: Theme): Record<string, string> {
  const c = t.colors;
  return {
    '--bg-primary': c.bgPrimary,
    '--bg-secondary': c.bgSecondary,
    '--bg-tertiary': c.bgTertiary,
    '--bg-input': c.bgInput,
    '--text-primary': c.textPrimary,
    '--text-secondary': c.textSecondary,
    '--text-muted': c.textMuted,
    '--accent': c.accent,
    '--accent-hover': c.accentHover,
    '--accent-text': c.accentText,
    '--border-color': c.borderColor,
    '--danger': c.dangerColor,
    '--radius': `${t.shape?.borderRadius ?? 8}px`,
  };
}

/**
 * iOS renders Login/Register with the DEFAULT dark palette while logged out (gap G12), never with the
 * last account's theme. Scoped CSS variables of PRESET_THEMES[0] for the logged-out roots.
 */
export function darkPresetVars(): CSSProperties {
  return paletteVars(PRESET_THEMES[0]) as CSSProperties;
}

function setRootVars(vars: Record<string, string>): void {
  const st = document.documentElement.style;
  for (const [k, v] of Object.entries(vars)) st.setProperty(k, v);
}

/**
 * G12 at document level: while a logged-out page is mounted, <html> carries the default dark preset
 * too (body background / overscroll / <meta theme-color> read it — the scoped wrapper only covers the
 * page itself). On unmount the store's current theme is put back — after a sign-in that is the new
 * account's theme (finishLogin → loadFromServer), otherwise the persisted one. The persisted theme is
 * never modified. Passive effect: runs after ThemeInit's initTheme() of the same commit (logout).
 */
export function useLoggedOutPalette(): void {
  useEffect(() => {
    setRootVars(paletteVars(PRESET_THEMES[0]));
    return () => {
      setRootVars(paletteVars(useThemeStore.getState().current));
    };
  }, []);
}

/**
 * Successful sign-in — same steps as the desktop LoginPage (setAuth, theme from the login response,
 * server preferences, preference auto-sync) plus the iOS store reset (G14: no lists of a previous
 * account survive) and the iOS palette rule (no theme_json → default dark preset).
 */
export function finishLogin(qc: QueryClient, data: AuthTokens): void {
  qc.clear();
  useAuthStore.getState().setAuth(data.user, data.access_token, data.refresh_token);
  useThemeStore.getState().loadFromServer(data.user.theme_json || JSON.stringify(PRESET_THEMES[0]));
  applyServerPreferences(data.user.preferences_json ?? null);
  startPreferencesAutoSync();
}

/** `?next=` target (invite links) — same-origin paths only. */
export function safeNext(raw: string | null): string | null {
  if (!raw) return null;
  if (!raw.startsWith('/') || raw.startsWith('//') || raw.startsWith('/\\')) return null;
  return raw;
}

/** Swift `.trimmingCharacters(in: .whitespaces)` — spaces/tabs, not newlines. */
export function trimWhitespaces(s: string): string {
  return s.replace(/^[^\S\r\n]+|[^\S\r\n]+$/g, '');
}

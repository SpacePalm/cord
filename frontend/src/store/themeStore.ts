import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export interface ThemeColors {
  bgPrimary: string;
  bgSecondary: string;
  bgTertiary: string;
  bgInput: string;
  textPrimary: string;
  textSecondary: string;
  textMuted: string;
  accent: string;
  accentHover: string;
  accentText: string;
  borderColor: string;
  dangerColor: string;
}

export const FONT_OPTIONS = [
  { value: 'system', label: 'System', stack: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif' },
  // Sans-serif
  { value: 'inter', label: 'Inter', stack: '"Inter", sans-serif' },
  { value: 'roboto', label: 'Roboto', stack: '"Roboto", sans-serif' },
  { value: 'open-sans', label: 'Open Sans', stack: '"Open Sans", sans-serif' },
  { value: 'nunito', label: 'Nunito', stack: '"Nunito", sans-serif' },
  { value: 'ubuntu', label: 'Ubuntu', stack: '"Ubuntu", sans-serif' },
  { value: 'poppins', label: 'Poppins', stack: '"Poppins", sans-serif' },
  { value: 'montserrat', label: 'Montserrat', stack: '"Montserrat", sans-serif' },
  { value: 'lato', label: 'Lato', stack: '"Lato", sans-serif' },
  { value: 'raleway', label: 'Raleway', stack: '"Raleway", sans-serif' },
  { value: 'manrope', label: 'Manrope', stack: '"Manrope", sans-serif' },
  { value: 'rubik', label: 'Rubik', stack: '"Rubik", sans-serif' },
  { value: 'noto-sans', label: 'Noto Sans', stack: '"Noto Sans", sans-serif' },
  { value: 'plus-jakarta', label: 'Plus Jakarta Sans', stack: '"Plus Jakarta Sans", sans-serif' },
  { value: 'geist', label: 'Geist', stack: '"Geist", sans-serif' },
  // Monospace
  { value: 'jetbrains-mono', label: 'JetBrains Mono', stack: '"JetBrains Mono", monospace' },
  { value: 'fira-code', label: 'Fira Code', stack: '"Fira Code", monospace' },
  { value: 'source-code-pro', label: 'Source Code Pro', stack: '"Source Code Pro", monospace' },
  { value: 'ibm-plex-mono', label: 'IBM Plex Mono', stack: '"IBM Plex Mono", monospace' },
  // Serif
  { value: 'merriweather', label: 'Merriweather', stack: '"Merriweather", serif' },
  { value: 'playfair', label: 'Playfair Display', stack: '"Playfair Display", serif' },
  { value: 'lora', label: 'Lora', stack: '"Lora", serif' },
] as const;

export type FontValue = typeof FONT_OPTIONS[number]['value'];

export interface ThemeShape {
  borderRadius: number; // px, 0–20
  fontSize: number;     // px, 12–18
  fontFamily: FontValue;
}

export interface Theme {
  name: string;
  colors: ThemeColors;
  shape: ThemeShape;
}

const defaultShape: ThemeShape = { borderRadius: 8, fontSize: 14, fontFamily: 'system' };

import { PRESET_THEMES } from './themePresets';
export { PRESET_THEMES };

const darkTheme = PRESET_THEMES[0];

function loadGoogleFont(fontFamily: FontValue) {
  if (fontFamily === 'system') return;
  const font = FONT_OPTIONS.find((f) => f.value === fontFamily);
  if (!font) return;
  const id = `gfont-${fontFamily}`;
  if (document.getElementById(id)) return;
  const link = document.createElement('link');
  link.id = id;
  link.rel = 'stylesheet';
  link.href = `https://fonts.googleapis.com/css2?family=${font.label.replace(/ /g, '+')}:wght@300;400;500;600;700&display=swap`;
  document.head.appendChild(link);
}

function applyTheme(theme: Theme) {
  const root = document.documentElement;
  const { colors, shape } = theme;
  root.style.setProperty('--bg-primary', colors.bgPrimary);
  root.style.setProperty('--bg-secondary', colors.bgSecondary);
  root.style.setProperty('--bg-tertiary', colors.bgTertiary);
  root.style.setProperty('--bg-input', colors.bgInput);
  root.style.setProperty('--text-primary', colors.textPrimary);
  root.style.setProperty('--text-secondary', colors.textSecondary);
  root.style.setProperty('--text-muted', colors.textMuted);
  root.style.setProperty('--accent', colors.accent);
  root.style.setProperty('--accent-hover', colors.accentHover);
  root.style.setProperty('--accent-text', colors.accentText);
  root.style.setProperty('--border-color', colors.borderColor);
  root.style.setProperty('--danger', colors.dangerColor);
  root.style.setProperty('--radius', shape.borderRadius + 'px');
  root.style.fontSize = shape.fontSize + 'px';
  const font = FONT_OPTIONS.find((f) => f.value === shape.fontFamily);
  if (font) {
    loadGoogleFont(shape.fontFamily);
    root.style.setProperty('--font-family', font.stack);
  }
}

let syncTimer: ReturnType<typeof setTimeout> | null = null;

function syncToServer(theme: Theme, customThemes?: Theme[]) {
  if (syncTimer) clearTimeout(syncTimer);
  syncTimer = setTimeout(() => {
    const payload = customThemes !== undefined
      ? { ...theme, customThemes }
      : { ...theme, customThemes: useThemeStore.getState().customThemes };
    import('../api/auth').then(({ authApi }) => {
      authApi.saveTheme(payload).catch(() => {});
    });
  }, 1500);
}

interface ThemeState {
  current: Theme;
  customThemes: Theme[];
  setTheme: (theme: Theme) => void;
  setColor: (key: keyof ThemeColors, value: string) => void;
  setShape: <K extends keyof ThemeShape>(key: K, value: ThemeShape[K]) => void;
  resetToPreset: (name: string) => void;
  saveCustomTheme: (name: string) => void;
  deleteCustomTheme: (name: string) => void;
  initTheme: () => void;
  loadFromServer: (themeJson: string | null) => void;
}

export const useThemeStore = create<ThemeState>()(
  persist(
    (set, get) => ({
      current: darkTheme,
      customThemes: [],

      setTheme: (theme) => {
        applyTheme(theme);
        set({ current: theme });
        syncToServer(theme);
      },

      setColor: (key, value) => {
        const current = get().current;
        const updated = {
          ...current,
          name: 'custom',
          colors: { ...current.colors, [key]: value },
        };
        applyTheme(updated);
        set({ current: updated });
        syncToServer(updated);
      },

      setShape: (key, value) => {
        const current = get().current;
        const updated = {
          ...current,
          name: 'custom',
          shape: { ...current.shape, [key]: value },
        };
        applyTheme(updated);
        set({ current: updated });
        syncToServer(updated);
      },

      resetToPreset: (name) => {
        const all = [...PRESET_THEMES, ...get().customThemes];
        const preset = all.find((t) => t.name === name);
        if (preset) {
          applyTheme(preset);
          set({ current: preset });
          syncToServer(preset);
        }
      },

      saveCustomTheme: (name: string) => {
        const current = get().current;
        const theme: Theme = { ...current, name };
        const customs = get().customThemes.filter((t: Theme) => t.name !== name);
        customs.push(theme);
        set({ customThemes: customs, current: theme });
        syncToServer(theme);
      },

      deleteCustomTheme: (name: string) => {
        const customs = get().customThemes.filter((t: Theme) => t.name !== name);
        set({ customThemes: customs });
        syncToServer(get().current, customs);
      },

      initTheme: () => {
        const current = get().current;
        // Migration: add shape if missing (legacy localStorage data)
        if (!(current as Theme & { shape?: ThemeShape }).shape) {
          current.shape = defaultShape;
        }
        if (!current.shape.fontFamily) {
          current.shape.fontFamily = 'system';
        }
        if (!current.colors.accentText) {
          current.colors.accentText = '#ffffff';
        }
        applyTheme(current);
      },

      loadFromServer: (themeJson: string | null) => {
        if (!themeJson) return;
        try {
          const data = JSON.parse(themeJson) as Theme & { customThemes?: Theme[] };
          if (!data.colors || !data.name) return;
          if (!data.shape) data.shape = defaultShape;
          if (!data.shape.fontFamily) data.shape.fontFamily = 'system';
          const serverCustoms = Array.isArray(data.customThemes) ? data.customThemes : [];
          const { customThemes: _, ...theme } = data as Theme & { customThemes?: Theme[] };
          applyTheme(theme);
          set({ current: theme, customThemes: serverCustoms });
        } catch { /* invalid JSON */ }
      },
    }),
    {
      name: 'cord-theme',
      partialize: (state) => ({ current: state.current, customThemes: state.customThemes }),
    }
  )
);

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

export interface ThemeShape {
  borderRadius: number; // px, 0–20
  fontSize: number;     // px, 12–18
}

export interface Theme {
  name: string;
  colors: ThemeColors;
  shape: ThemeShape;
}

const defaultShape: ThemeShape = { borderRadius: 8, fontSize: 14 };

const darkTheme: Theme = {
  name: 'dark',
  colors: {
    bgPrimary: '#111113',
    bgSecondary: '#19191d',
    bgTertiary: '#212126',
    bgInput: '#2a2a30',
    textPrimary: '#e8e8ec',
    textSecondary: '#a0a0a8',
    textMuted: '#606068',
    accent: '#16a34a',
    accentHover: '#15803d',
    accentText: '#ffffff',
    borderColor: '#2a2a30',
    dangerColor: '#f43f5e',
  },
  shape: defaultShape,
};

const lightTheme: Theme = {
  name: 'light',
  colors: {
    bgPrimary: '#dde4d8',
    bgSecondary: '#e8ede4',
    bgTertiary: '#f4f7f2',
    bgInput: '#dce2d8',
    textPrimary: '#0a0f08',
    textSecondary: '#3a4038',
    textMuted: '#707870',
    accent: '#15803d',
    accentHover: '#166534',
    accentText: '#ffffff',
    borderColor: '#c0c8bc',
    dangerColor: '#e11d48',
  },
  shape: defaultShape,
};

const midnightTheme: Theme = {
  name: 'midnight',
  colors: {
    bgPrimary: '#0d0d14',
    bgSecondary: '#13132a',
    bgTertiary: '#1a1a3e',
    bgInput: '#252550',
    textPrimary: '#e8e8f0',
    textSecondary: '#a0a0c0',
    textMuted: '#6060a0',
    accent: '#7c5cfc',
    accentHover: '#6644dd',
    accentText: '#ffffff',
    borderColor: '#0d0d14',
    dangerColor: '#ff4060',
  },
  shape: defaultShape,
};

const forestTheme: Theme = {
  name: 'forest',
  colors: {
    bgPrimary: '#1a2318',
    bgSecondary: '#222d20',
    bgTertiary: '#2a3828',
    bgInput: '#344432',
    textPrimary: '#e0eed8',
    textSecondary: '#a8c0a0',
    textMuted: '#708868',
    accent: '#4caf50',
    accentHover: '#388e3c',
    accentText: '#000000',
    borderColor: '#1a2318',
    dangerColor: '#e53935',
  },
  shape: defaultShape,
};

export const PRESET_THEMES: Theme[] = [darkTheme, lightTheme, midnightTheme, forestTheme];

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
}

interface ThemeState {
  current: Theme;
  setTheme: (theme: Theme) => void;
  setColor: (key: keyof ThemeColors, value: string) => void;
  setShape: (key: keyof ThemeShape, value: number) => void;
  resetToPreset: (name: string) => void;
  initTheme: () => void;
}

export const useThemeStore = create<ThemeState>()(
  persist(
    (set, get) => ({
      current: darkTheme,

      setTheme: (theme) => {
        applyTheme(theme);
        set({ current: theme });
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
      },

      resetToPreset: (name) => {
        const preset = PRESET_THEMES.find((t) => t.name === name);
        if (preset) {
          applyTheme(preset);
          set({ current: preset });
        }
      },

      initTheme: () => {
        const current = get().current;
        // Migration: add shape if missing (legacy localStorage data)
        if (!(current as Theme & { shape?: ThemeShape }).shape) {
          current.shape = defaultShape;
        }
        if (!current.colors.accentText) {
          current.colors.accentText = '#ffffff';
        }
        applyTheme(current);
      },
    }),
    {
      name: 'cord-theme',
      partialize: (state) => ({ current: state.current }),
    }
  )
);

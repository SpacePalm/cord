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

export const PRESET_THEMES: Theme[] = [
  darkTheme, lightTheme, midnightTheme, forestTheme,
  // --- Community themes ---
  { name: 'Ocean Depths', colors: { bgPrimary: '#0a1628', bgSecondary: '#0f1f3d', bgTertiary: '#162a4a', bgInput: '#1c3558', textPrimary: '#d4e4f7', textSecondary: '#8bacc8', textMuted: '#4a7a9b', accent: '#0ea5e9', accentHover: '#0284c7', accentText: '#ffffff', borderColor: '#1a3050', dangerColor: '#f43f5e' }, shape: { ...defaultShape, borderRadius: 12, fontFamily: 'inter' } },
  { name: 'Dracula', colors: { bgPrimary: '#282a36', bgSecondary: '#2d2f3d', bgTertiary: '#343746', bgInput: '#3c3f52', textPrimary: '#f8f8f2', textSecondary: '#c0c0d0', textMuted: '#6272a4', accent: '#bd93f9', accentHover: '#a370f7', accentText: '#000000', borderColor: '#44475a', dangerColor: '#ff5555' }, shape: { ...defaultShape, fontFamily: 'fira-code' } },
  { name: 'Rosé Pine', colors: { bgPrimary: '#191724', bgSecondary: '#1f1d2e', bgTertiary: '#26233a', bgInput: '#2a2740', textPrimary: '#e0def4', textSecondary: '#908caa', textMuted: '#6e6a86', accent: '#c4a7e7', accentHover: '#b090d0', accentText: '#191724', borderColor: '#2a273f', dangerColor: '#eb6f92' }, shape: { ...defaultShape, borderRadius: 10, fontFamily: 'inter' } },
  { name: 'Sunset Ember', colors: { bgPrimary: '#1a1210', bgSecondary: '#231a16', bgTertiary: '#2d221c', bgInput: '#3a2c24', textPrimary: '#f5e6d8', textSecondary: '#c8a88e', textMuted: '#8a6e58', accent: '#f97316', accentHover: '#ea580c', accentText: '#000000', borderColor: '#3a2c24', dangerColor: '#ef4444' }, shape: { ...defaultShape, borderRadius: 6, fontSize: 15, fontFamily: 'plus-jakarta' } },
  { name: 'Nord Aurora', colors: { bgPrimary: '#2e3440', bgSecondary: '#3b4252', bgTertiary: '#434c5e', bgInput: '#4c566a', textPrimary: '#eceff4', textSecondary: '#d8dee9', textMuted: '#7b88a1', accent: '#88c0d0', accentHover: '#81a1c1', accentText: '#2e3440', borderColor: '#434c5e', dangerColor: '#bf616a' }, shape: { ...defaultShape, fontFamily: 'source-code-pro' } },
  { name: 'Cyberpunk', colors: { bgPrimary: '#0a0a0f', bgSecondary: '#12121c', bgTertiary: '#1a1a2e', bgInput: '#22223a', textPrimary: '#eaf0ff', textSecondary: '#a0b0d0', textMuted: '#505878', accent: '#f72585', accentHover: '#e01070', accentText: '#ffffff', borderColor: '#2a2a44', dangerColor: '#ff2a2a' }, shape: { borderRadius: 2, fontSize: 13, fontFamily: 'jetbrains-mono' } },
  { name: 'Sakura', colors: { bgPrimary: '#fdf2f4', bgSecondary: '#fce7ec', bgTertiary: '#fff0f3', bgInput: '#f8d7de', textPrimary: '#1a0510', textSecondary: '#5c2040', textMuted: '#b07090', accent: '#e11d68', accentHover: '#be185d', accentText: '#ffffff', borderColor: '#f0c0d0', dangerColor: '#dc2626' }, shape: { ...defaultShape, borderRadius: 16, fontFamily: 'lora' } },
  { name: 'Monokai Pro', colors: { bgPrimary: '#2d2a2e', bgSecondary: '#353236', bgTertiary: '#403e42', bgInput: '#4a474d', textPrimary: '#fcfcfa', textSecondary: '#c1c0c0', textMuted: '#727072', accent: '#a9dc76', accentHover: '#8cc256', accentText: '#2d2a2e', borderColor: '#4a474d', dangerColor: '#ff6188' }, shape: { ...defaultShape, borderRadius: 6, fontFamily: 'fira-code' } },
  { name: 'Solarized Dark', colors: { bgPrimary: '#002b36', bgSecondary: '#073642', bgTertiary: '#0a4050', bgInput: '#0e4f60', textPrimary: '#fdf6e3', textSecondary: '#93a1a1', textMuted: '#586e75', accent: '#b58900', accentHover: '#9a7500', accentText: '#002b36', borderColor: '#0a4050', dangerColor: '#dc322f' }, shape: { ...defaultShape, fontFamily: 'ibm-plex-mono' } },
  { name: 'Cotton Candy', colors: { bgPrimary: '#f0eaff', bgSecondary: '#e8e0f8', bgTertiary: '#f4efff', bgInput: '#ddd4f0', textPrimary: '#1a1028', textSecondary: '#4a3868', textMuted: '#9080b0', accent: '#8b5cf6', accentHover: '#7c3aed', accentText: '#ffffff', borderColor: '#d0c4e8', dangerColor: '#e11d48' }, shape: { ...defaultShape, borderRadius: 20, fontFamily: 'nunito' } },
  { name: 'Gruvbox Dark', colors: { bgPrimary: '#1d2021', bgSecondary: '#282828', bgTertiary: '#3c3836', bgInput: '#504945', textPrimary: '#ebdbb2', textSecondary: '#d5c4a1', textMuted: '#928374', accent: '#fe8019', accentHover: '#d65d0e', accentText: '#1d2021', borderColor: '#3c3836', dangerColor: '#cc241d' }, shape: defaultShape },
  { name: 'Gruvbox Light', colors: { bgPrimary: '#fbf1c7', bgSecondary: '#f2e5bc', bgTertiary: '#f9f5d7', bgInput: '#ebdbb2', textPrimary: '#282828', textSecondary: '#504945', textMuted: '#928374', accent: '#d65d0e', accentHover: '#af3a03', accentText: '#fbf1c7', borderColor: '#d5c4a1', dangerColor: '#cc241d' }, shape: defaultShape },
  { name: 'Tokyo Night', colors: { bgPrimary: '#1a1b26', bgSecondary: '#1f2335', bgTertiary: '#24283b', bgInput: '#292e42', textPrimary: '#c0caf5', textSecondary: '#a9b1d6', textMuted: '#565f89', accent: '#7aa2f7', accentHover: '#5d8af0', accentText: '#1a1b26', borderColor: '#292e42', dangerColor: '#f7768e' }, shape: { ...defaultShape, fontFamily: 'inter' } },
  { name: 'Catppuccin Mocha', colors: { bgPrimary: '#1e1e2e', bgSecondary: '#252536', bgTertiary: '#313244', bgInput: '#45475a', textPrimary: '#cdd6f4', textSecondary: '#bac2de', textMuted: '#6c7086', accent: '#cba6f7', accentHover: '#b490e0', accentText: '#1e1e2e', borderColor: '#313244', dangerColor: '#f38ba8' }, shape: { ...defaultShape, borderRadius: 10 } },
  { name: 'Catppuccin Latte', colors: { bgPrimary: '#eff1f5', bgSecondary: '#e6e9ef', bgTertiary: '#f2f4f8', bgInput: '#dce0e8', textPrimary: '#4c4f69', textSecondary: '#5c5f77', textMuted: '#9ca0b0', accent: '#8839ef', accentHover: '#7028d4', accentText: '#ffffff', borderColor: '#ccd0da', dangerColor: '#d20f39' }, shape: { ...defaultShape, borderRadius: 10 } },
  { name: 'One Dark', colors: { bgPrimary: '#21252b', bgSecondary: '#282c34', bgTertiary: '#2c313a', bgInput: '#3a3f4b', textPrimary: '#abb2bf', textSecondary: '#9da5b4', textMuted: '#636d83', accent: '#61afef', accentHover: '#4d99d8', accentText: '#21252b', borderColor: '#3e4452', dangerColor: '#e06c75' }, shape: defaultShape },
  { name: 'GitHub Dark', colors: { bgPrimary: '#0d1117', bgSecondary: '#161b22', bgTertiary: '#1c2128', bgInput: '#21262d', textPrimary: '#e6edf3', textSecondary: '#c9d1d9', textMuted: '#6e7681', accent: '#58a6ff', accentHover: '#4090e0', accentText: '#0d1117', borderColor: '#30363d', dangerColor: '#f85149' }, shape: defaultShape },
  { name: 'Material Dark', colors: { bgPrimary: '#212121', bgSecondary: '#292929', bgTertiary: '#333333', bgInput: '#3d3d3d', textPrimary: '#eeffff', textSecondary: '#b0bec5', textMuted: '#607d8b', accent: '#82aaff', accentHover: '#6690e6', accentText: '#212121', borderColor: '#3d3d3d', dangerColor: '#ff5370' }, shape: { ...defaultShape, fontFamily: 'roboto' } },
  { name: 'Ayu Dark', colors: { bgPrimary: '#0b0e14', bgSecondary: '#0d1017', bgTertiary: '#131721', bgInput: '#1c202b', textPrimary: '#bfbdb6', textSecondary: '#9a9a9a', textMuted: '#565b66', accent: '#e6b450', accentHover: '#d0a040', accentText: '#0b0e14', borderColor: '#1c202b', dangerColor: '#d95757' }, shape: defaultShape },
  { name: 'Ayu Light', colors: { bgPrimary: '#fcfcfc', bgSecondary: '#f3f3f3', bgTertiary: '#fafafa', bgInput: '#e8e8e8', textPrimary: '#575f66', textSecondary: '#787878', textMuted: '#abb0b6', accent: '#ff9940', accentHover: '#e68530', accentText: '#ffffff', borderColor: '#dcdcdc', dangerColor: '#f07171' }, shape: defaultShape },
  { name: 'Everforest', colors: { bgPrimary: '#272e33', bgSecondary: '#2e383c', bgTertiary: '#374145', bgInput: '#414b50', textPrimary: '#d3c6aa', textSecondary: '#a7c080', textMuted: '#7a8478', accent: '#a7c080', accentHover: '#8da868', accentText: '#272e33', borderColor: '#374145', dangerColor: '#e67e80' }, shape: { ...defaultShape, fontFamily: 'inter' } },
  { name: 'Kanagawa', colors: { bgPrimary: '#1f1f28', bgSecondary: '#252530', bgTertiary: '#2a2a37', bgInput: '#363646', textPrimary: '#dcd7ba', textSecondary: '#c8c093', textMuted: '#727169', accent: '#7e9cd8', accentHover: '#6688c0', accentText: '#1f1f28', borderColor: '#363646', dangerColor: '#c34043' }, shape: defaultShape },
  { name: 'Palenight', colors: { bgPrimary: '#292d3e', bgSecondary: '#2f3347', bgTertiary: '#34394f', bgInput: '#3c4158', textPrimary: '#a6accd', textSecondary: '#959dbe', textMuted: '#676e95', accent: '#c792ea', accentHover: '#b07cd0', accentText: '#292d3e', borderColor: '#3c4158', dangerColor: '#ff5370' }, shape: { ...defaultShape, fontFamily: 'inter' } },
  { name: 'Horizon', colors: { bgPrimary: '#1c1e26', bgSecondary: '#232530', bgTertiary: '#2e303e', bgInput: '#3a3c4e', textPrimary: '#d5d8da', textSecondary: '#bbbbbb', textMuted: '#6c6f93', accent: '#e95678', accentHover: '#d04060', accentText: '#ffffff', borderColor: '#2e303e', dangerColor: '#e95678' }, shape: defaultShape },
  { name: 'Vesper', colors: { bgPrimary: '#101010', bgSecondary: '#181818', bgTertiary: '#1e1e1e', bgInput: '#262626', textPrimary: '#d4d4d4', textSecondary: '#a3a3a3', textMuted: '#525252', accent: '#fbbf24', accentHover: '#d9a620', accentText: '#101010', borderColor: '#262626', dangerColor: '#ef4444' }, shape: { borderRadius: 4, fontSize: 13, fontFamily: 'jetbrains-mono' } },
  { name: 'Poimandres', colors: { bgPrimary: '#1b1e28', bgSecondary: '#212430', bgTertiary: '#282c38', bgInput: '#303440', textPrimary: '#e4f0fb', textSecondary: '#a6accd', textMuted: '#506477', accent: '#add7ff', accentHover: '#90c0e8', accentText: '#1b1e28', borderColor: '#303440', dangerColor: '#d0679d' }, shape: { ...defaultShape, fontFamily: 'inter' } },
  { name: 'Warm Night', colors: { bgPrimary: '#1a1614', bgSecondary: '#22201e', bgTertiary: '#2c2826', bgInput: '#383432', textPrimary: '#e8dfd4', textSecondary: '#bfb5a8', textMuted: '#807870', accent: '#e8a86c', accentHover: '#d09060', accentText: '#1a1614', borderColor: '#383432', dangerColor: '#e05858' }, shape: { ...defaultShape, borderRadius: 10 } },
  { name: 'Ice', colors: { bgPrimary: '#e8eef4', bgSecondary: '#dce4ec', bgTertiary: '#eef2f6', bgInput: '#d0dae4', textPrimary: '#1a2030', textSecondary: '#3a4860', textMuted: '#8090a8', accent: '#3b82f6', accentHover: '#2563eb', accentText: '#ffffff', borderColor: '#c0ccd8', dangerColor: '#ef4444' }, shape: defaultShape },
  { name: 'Lavender Mist', colors: { bgPrimary: '#f5f0fa', bgSecondary: '#ede6f5', bgTertiary: '#f8f4fc', bgInput: '#e2d8f0', textPrimary: '#2a1848', textSecondary: '#4a3868', textMuted: '#9888b0', accent: '#7c3aed', accentHover: '#6d28d9', accentText: '#ffffff', borderColor: '#d8cce8', dangerColor: '#dc2626' }, shape: { ...defaultShape, borderRadius: 14, fontFamily: 'nunito' } },
  { name: 'Sepia', colors: { bgPrimary: '#f4ecd8', bgSecondary: '#ede4cc', bgTertiary: '#f8f0dc', bgInput: '#e0d4b8', textPrimary: '#3c3020', textSecondary: '#5c5040', textMuted: '#a09070', accent: '#b07830', accentHover: '#986828', accentText: '#f4ecd8', borderColor: '#d4c8a8', dangerColor: '#c04040' }, shape: { ...defaultShape, fontFamily: 'merriweather' } },
  { name: 'Neon', colors: { bgPrimary: '#050510', bgSecondary: '#0a0a1a', bgTertiary: '#101028', bgInput: '#18183a', textPrimary: '#f0f0ff', textSecondary: '#b0b0d0', textMuted: '#5050a0', accent: '#00ff88', accentHover: '#00dd70', accentText: '#050510', borderColor: '#202048', dangerColor: '#ff3060' }, shape: { borderRadius: 0, fontSize: 13, fontFamily: 'jetbrains-mono' } },
];

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

function syncToServer(theme: Theme) {
  if (syncTimer) clearTimeout(syncTimer);
  syncTimer = setTimeout(() => {
    import('../api/auth').then(({ authApi }) => {
      authApi.saveTheme(theme).catch(() => {});
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
          const theme = JSON.parse(themeJson) as Theme;
          if (!theme.colors || !theme.name) return;
          if (!theme.shape) theme.shape = defaultShape;
          if (!theme.shape.fontFamily) theme.shape.fontFamily = 'system';
          applyTheme(theme);
          set({ current: theme });
        } catch { /* invalid JSON */ }
      },
    }),
    {
      name: 'cord-theme',
      partialize: (state) => ({ current: state.current, customThemes: state.customThemes }),
    }
  )
);

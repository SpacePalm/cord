[← Back to README](../README.md)

# Customization

- [Theming](#theming)
- [Internationalization](#internationalization)
- [Adding a Language](#adding-a-language)

---

## Theming

### Built-in Presets

**120+ built-in themes**, defined in `frontend/src/store/themePresets.ts`. Groups (non-exhaustive):

- **Defaults** — Dark, Light, Midnight, Forest
- **Editor-inspired** — Dracula, Monokai Pro, One Dark, Solarized Dark, GitHub Dark, Material Dark, Ayu Dark, Tokyo Night, Catppuccin Mocha / Latte, Gruvbox Dark / Light, Nord Aurora, Kanagawa, Everforest, Palenight, Horizon, Poimandres, Vesper, ...
- **Nature & ambient** — Forest, Ocean Depths, Sakura, Rose Pine, Sunset Ember
- **Mood** — Cyberpunk, Cotton Candy, Lavender, Mint Fresh, ...

To list all presets:

```bash
grep -oE "name: '[A-Za-zé ]+'" frontend/src/store/themePresets.ts | awk -F"'" '{print $2}'
```

### Customizable Properties

**Colors (11):** Primary/secondary/tertiary backgrounds, input background, primary/secondary/muted text, accent, accent hover, accent text, borders, danger.

**Shape:** Border radius (0–20 px), font size (12–18 px), font family (22 options).

**Fonts (22 total):** System default plus 21 Google Fonts — Inter, Roboto, Open Sans, Nunito, Ubuntu, Poppins, Montserrat, Lato, Raleway, Manrope, Rubik, Noto Sans, Plus Jakarta Sans, Geist (sans), JetBrains Mono, Fira Code, Source Code Pro, IBM Plex Mono (mono), Merriweather, Playfair Display, Lora (serif). Each Google Font is loaded lazily via a `<link>` tag the first time it's selected.

### Live Preview

The Appearance settings tab has a miniature UI preview that re-renders on every color/shape change — confirm your theme without leaving the modal.

### Export/Import

- **Export:** downloads a `.json` file with all theme settings.
- **Import:** load a `.json` theme file — validated before applying.

### Persistence

Themes persist in `localStorage` (`cord-theme`), and also sync to the backend through the `/api/auth/theme` endpoint so the same theme follows the user across devices.

---

## Internationalization

### Supported Languages

| Code | Language |
|------|----------|
| `en` | English (default) |
| `ru` | Russian |

Language preference is stored in `localStorage` (`cord-lang`) and synchronised cross-device via `preferences_json` (so picking Russian on your laptop also flips your phone the next time you log in).

Date/time formatting uses the active language's `locale` (e.g. `en-US`, `ru-RU`) via the `Intl` API.

---

## Adding a Language

1. Create `frontend/src/i18n/xx.ts` copying the structure from `en.ts` (~520 keys).
2. Translate all keys — keep the same keys, just replace the values.
3. Register in `frontend/src/i18n/index.ts`:

   ```typescript
   import { xx } from './xx';
   export const LANGUAGES = {
     ...
     xx: { label: 'Language Name', translations: xx, locale: 'xx-XX' },
   };
   ```
4. The `locale` field is used for date/time formatting (must be a valid BCP-47 tag).

### Verifying completeness

Quick check that your new file has the same key set as `en.ts`:

```bash
grep -oE "'[a-zA-Z][a-zA-Z0-9.]+':" frontend/src/i18n/en.ts | sort -u > /tmp/en.txt
grep -oE "'[a-zA-Z][a-zA-Z0-9.]+':" frontend/src/i18n/xx.ts | sort -u > /tmp/xx.txt
diff /tmp/en.txt /tmp/xx.txt
```

Missing keys fall back to `en` at runtime, but consistency is preferable.

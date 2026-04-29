// Сохранённые поиски пользователя — лежат в preferences_json (синк между девайсами).
// applyServerPreferences выставляет items при логине, любые изменения автоматически
// уходят на сервер (см. utils/preferencesSync.ts).

import { create } from 'zustand';

// Filter snapshot — упрощённый, чтобы не таскать вычисляемые поля.
// Структура должна совпадать с FilterState из AdvancedSearchPanel.
export interface SavedSearch {
  id: string;
  name: string;
  filters: Record<string, unknown>; // FilterState — но не тянем зависимость на компонент
}

interface SavedSearchesState {
  items: SavedSearch[];
  add: (s: SavedSearch) => void;
  remove: (id: string) => void;
  setAll: (items: SavedSearch[]) => void;
}

export const useSavedSearchesStore = create<SavedSearchesState>((set) => ({
  items: [],
  add: (s) => set((st) => ({ items: [s, ...st.items].slice(0, 30) })),
  remove: (id) => set((st) => ({ items: st.items.filter((x) => x.id !== id) })),
  setAll: (items) => set({ items }),
}));

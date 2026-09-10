import { create } from 'zustand';
import {
  DEFAULT_UI_MODE,
  UI_MODE_STORAGE_KEY,
  resolveUiMode,
  type TUiMode,
} from '@/lib/ui-mode';

interface IUiModeState {
  mode: TUiMode;
  hydrated: boolean;
  hydrate: () => void;
  setMode: (mode: TUiMode) => void;
}

const useUiMode = create<IUiModeState>((set, get) => ({
  mode: DEFAULT_UI_MODE,
  hydrated: false,

  hydrate: () => {
    if (get().hydrated) return;

    let mode = DEFAULT_UI_MODE;
    try {
      mode = resolveUiMode(window.localStorage.getItem(UI_MODE_STORAGE_KEY));
    } catch {
      // Keep the default when browser storage is unavailable.
    }
    set({ mode, hydrated: true });
  },

  setMode: (mode) => {
    set({ mode, hydrated: true });
    try {
      window.localStorage.setItem(UI_MODE_STORAGE_KEY, mode);
    } catch {
      // The mode still applies for this page when browser storage is unavailable.
    }
  },
}));

export default useUiMode;

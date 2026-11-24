import { useCallback, useSyncExternalStore } from 'react';

export type Theme = 'light' | 'dark';

const KEY = 'theme';
const listeners = new Set<() => void>();
const media = typeof matchMedia === 'function' ? matchMedia('(prefers-color-scheme: dark)') : null;

function stored(): Theme | null {
  try {
    const value = localStorage.getItem(KEY);
    return value === 'light' || value === 'dark' ? value : null;
  } catch {
    return null;
  }
}

function resolve(): Theme {
  return stored() ?? (media?.matches ? 'dark' : 'light');
}

function apply(): void {
  document.documentElement.classList.toggle('dark', resolve() === 'dark');
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  media?.addEventListener('change', listener);
  return (): void => {
    listeners.delete(listener);
    media?.removeEventListener('change', listener);
  };
}

// Follow the system setting for as long as the visitor hasn't picked a theme.
media?.addEventListener('change', apply);

/** Light/dark theme: a `dark` class on <html>, persisted in localStorage, defaulting to the system. */
export function useTheme(): {
  theme: Theme;
  setTheme: (next: Theme) => void;
  toggle: () => void;
} {
  const theme = useSyncExternalStore(subscribe, resolve, () => 'light' as Theme);
  const setTheme = useCallback((next: Theme) => {
    try {
      localStorage.setItem(KEY, next);
    } catch {
      // Private mode: the choice just doesn't persist.
    }
    apply();
    listeners.forEach((listener) => listener());
  }, []);
  return { theme, setTheme, toggle: () => setTheme(theme === 'dark' ? 'light' : 'dark') };
}

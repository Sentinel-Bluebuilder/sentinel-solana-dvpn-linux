// ─── State that survives leaving a screen (UI-021) ───
// Screens are remounted on every navigation; a search, a filter or an open tab kept with
// useState was lost each time. useKept is useState whose value lives for the app run, by key.
import { useCallback, useState } from 'react';

const kept = new Map<string, unknown>();

export function useKept<T>(key: string, initial: T): [T, (v: T | ((prev: T) => T)) => void] {
  const [value, setValue] = useState<T>(() => (kept.has(key) ? (kept.get(key) as T) : initial));
  const set = useCallback((v: T | ((prev: T) => T)): void => {
    setValue((prev) => {
      const next = typeof v === 'function' ? (v as (p: T) => T)(prev) : v;
      kept.set(key, next);
      return next;
    });
  }, [key]);
  return [value, set];
}

/** Sign out, or a test: forget everything kept. */
export function clearKept(): void {
  kept.clear();
}

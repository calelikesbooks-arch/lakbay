import { useSyncExternalStore } from 'react';
import { storage } from './storage';

/**
 * A tiny saved-on-this-device store.
 * - Reads/writes JSON in localStorage (safely; see storage.ts)
 * - Every component using it re-renders when it changes
 * - Stays in sync across browser tabs
 */
export interface LocalStore<T> {
  get: () => T;
  set: (next: T | ((previous: T) => T)) => void;
  subscribe: (listener: () => void) => () => void;
}

export function createLocalStore<T>(key: string, fallback: T, isValid: (value: unknown) => value is T): LocalStore<T> {
  const listeners = new Set<() => void>();
  let cache: T | undefined;

  function read(): T {
    const raw = storage.get(key);
    if (raw === null) return fallback;
    try {
      const parsed: unknown = JSON.parse(raw);
      return isValid(parsed) ? parsed : fallback;
    } catch {
      return fallback;
    }
  }

  function get(): T {
    if (cache === undefined) cache = read();
    return cache;
  }

  function set(next: T | ((previous: T) => T)) {
    const value = typeof next === 'function' ? (next as (previous: T) => T)(get()) : next;
    cache = value;
    storage.set(key, JSON.stringify(value));
    listeners.forEach((listener) => listener());
  }

  function subscribe(listener: () => void) {
    listeners.add(listener);
    const onStorage = (event: StorageEvent) => {
      if (event.key === key) {
        cache = undefined;
        listener();
      }
    };
    window.addEventListener('storage', onStorage);
    return () => {
      listeners.delete(listener);
      window.removeEventListener('storage', onStorage);
    };
  }

  return { get, set, subscribe };
}

/** React hook: read a store's current value and re-render on changes. */
export function useLocalStore<T>(store: LocalStore<T>): T {
  return useSyncExternalStore(store.subscribe, store.get, store.get);
}

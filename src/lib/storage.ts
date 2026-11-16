/**
 * Safe wrappers around localStorage.
 * localStorage can throw (private browsing, storage disabled, full quota),
 * so every call is wrapped in try/catch and fails quietly.
 */
export const storage = {
  get(key: string): string | null {
    try {
      return window.localStorage.getItem(key);
    } catch {
      return null;
    }
  },
  set(key: string, value: string): void {
    try {
      window.localStorage.setItem(key, value);
    } catch {
      /* ignore: the setting just won't be remembered */
    }
  },
};

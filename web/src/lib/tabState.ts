/**
 * Tab-scoped persistence, one implementation for every board that needs it.
 *
 * The console's sidebar navigates to a bare path (`/channels`, `/models`) with no
 * query string, so URL-only filters and selections are lost on every page switch.
 * Each board therefore remembers its tab state here, under its own namespace.
 * Filters and explicit deep links stay in the URL; transient row selection can
 * survive sidebar navigation without reopening an inspector after refresh.
 *
 * Both boards had written their own copy of this, identical apart from the key
 * prefix — which is exactly the kind of copy that drifts (one of them grew a
 * try/catch, the other did not).
 */
export function readScopedTabState<T>(scope: string, key: string, fallback: T): T {
  try {
    const raw = sessionStorage.getItem(`${scope}.${key}`);
    return raw != null ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

export function writeScopedTabState<T>(scope: string, key: string, value: T): void {
  try {
    sessionStorage.setItem(`${scope}.${key}`, JSON.stringify(value));
  } catch {
    // Storage unavailable; state stays in memory for this render.
  }
}

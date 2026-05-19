/**
 * Lightweight typed wrapper around localStorage for Phase 1.7 persistence.
 *
 * Keys are prefixed with `ls-cc.` (ls-command-center) so we can wipe
 * everything cleanly without touching unrelated storage.
 *
 * Design notes:
 * - SSR-safe: every access checks `typeof window`. On the server we return
 *   the provided fallback so Next.js can still render the initial HTML.
 * - JSON-serialized values. No schema migrations yet — if the shape
 *   changes in a later phase we either bump the key or write a migration.
 * - Silent on errors (quota exceeded, private mode) so a failure to
 *   persist never breaks the UI. Data will just reset on next load.
 */

const PREFIX = 'ls-cc.';

export const STORAGE_KEYS = {
  leadOverrides: `${PREFIX}leadOverrides`,
  closers: `${PREFIX}closers`, // { active: string[], deactivated: string[] }
  csms: `${PREFIX}csms`,       // { active: string[], deactivated: string[] }
  expenses: `${PREFIX}expenses`,
  commissionRates: `${PREFIX}commissionRates`, // Record<closerName, rate 0-1>
  commissionTeam: `${PREFIX}commissionTeam`, // TeamMember[] from commission-config.ts
  csmActionLogs: `${PREFIX}csmActionLogs`, // CSM upsell/renewal/offboarding action logs
} as const;

export function loadJSON<T>(key: string, fallback: T): T {
  if (typeof window === 'undefined') return fallback;
  try {
    const raw = window.localStorage.getItem(key);
    if (raw === null) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

export function saveJSON(key: string, value: unknown): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // quota exceeded, private mode, etc — noop
  }
}

export function removeKey(key: string): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.removeItem(key);
  } catch {
    // noop
  }
}

/**
 * Wipe every key this app owns. Used by the Reset button.
 * Safe to call anytime; noop on server.
 */
export function resetAllStorage(): void {
  if (typeof window === 'undefined') return;
  try {
    const keys: string[] = [];
    for (let i = 0; i < window.localStorage.length; i++) {
      const k = window.localStorage.key(i);
      if (k && k.startsWith(PREFIX)) keys.push(k);
    }
    for (const k of keys) window.localStorage.removeItem(k);
  } catch {
    // noop
  }
}

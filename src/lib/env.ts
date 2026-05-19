/**
 * Env-var whitespace guard.
 *
 * Permanent fix for the `\n`-baked-into-Vercel-env-var class of bug that
 * silently broke GHL (2026-04-20) and Slack (2026-04-18 → 2026-04-23).
 *
 * ROOT CAUSE: `echo "$VAR" | vercel env add` pipes a trailing newline into
 * the value. When the value is later used in an HTTP header or URL param,
 * the server rejects it (401, 403, channel_not_found) but our code logged
 * the error without throwing → silent zero-parsed runs for days.
 *
 * USE: `cleanEnv('SLACK_BOT_TOKEN')` instead of `process.env.SLACK_BOT_TOKEN`.
 * Trims leading/trailing whitespace and strips wrapping single/double quotes.
 * Returns undefined if the var is missing or empty after cleaning (so the
 * caller's `!token` check still works).
 */
export function cleanEnv(name: string): string | undefined {
  const raw = process.env[name];
  if (raw === undefined) return undefined;
  // Trim all whitespace (including \n, \r, tabs) from both ends.
  let cleaned = raw.trim();
  // Strip matching wrapping quotes if both ends have the same quote char.
  if (cleaned.length >= 2) {
    const first = cleaned[0];
    const last = cleaned[cleaned.length - 1];
    if ((first === '"' || first === "'") && first === last) {
      cleaned = cleaned.slice(1, -1).trim();
    }
  }
  return cleaned.length > 0 ? cleaned : undefined;
}

/**
 * Like cleanEnv but throws if missing. Use in sync workers where a missing
 * value should hard-fail the cron (triggers the existing runSync alert path).
 */
export function requireEnv(name: string): string {
  const v = cleanEnv(name);
  if (!v) throw new Error(`${name} not set (or whitespace-only after cleanup)`);
  return v;
}

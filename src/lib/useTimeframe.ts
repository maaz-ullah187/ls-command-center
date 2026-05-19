'use client';

import { useCallback, useMemo } from 'react';
import { useRouter, useSearchParams, usePathname } from 'next/navigation';
import {
  PRESET_DEFS,
  DEFAULT_PRESET,
  resolveFromParams,
  type TimeframePreset,
  type TimeframeValue,
} from './timeframe';

// Re-export server-safe types for callers that import from this file
export type { TimeframePreset, TimeframeValue };
export { PRESET_DEFS, DEFAULT_PRESET, timeframeFromSearchParams } from './timeframe';

/**
 * URL-backed timeframe state. All Phase 0+ views read/write from `?preset=…` or `?from=…&to=…`.
 * `preset=custom` is implied when from/to are present without a preset.
 */
export function useTimeframe(): TimeframeValue & {
  setPreset: (p: Exclude<TimeframePreset, 'custom'>) => void;
  setCustom: (from: string, to: string) => void;
} {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();

  const value = useMemo(
    () => resolveFromParams(params.get('preset'), params.get('from'), params.get('to')),
    [params]
  );

  const updateParams = useCallback(
    (next: Record<string, string | null>) => {
      const sp = new URLSearchParams(params.toString());
      for (const [k, v] of Object.entries(next)) {
        if (v === null) sp.delete(k);
        else sp.set(k, v);
      }
      router.replace(`${pathname}?${sp.toString()}`, { scroll: false });
    },
    [router, pathname, params]
  );

  const setPreset = useCallback(
    (p: Exclude<TimeframePreset, 'custom'>) => {
      updateParams({ preset: p, from: null, to: null });
    },
    [updateParams]
  );

  const setCustom = useCallback(
    (from: string, to: string) => {
      updateParams({ preset: null, from, to });
    },
    [updateParams]
  );

  return { ...value, setPreset, setCustom };
}

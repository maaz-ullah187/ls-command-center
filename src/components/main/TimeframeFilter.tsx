'use client';

import TimeframeSelector, { type DateRange } from '@/components/TimeframeSelector';
import { useTimeframe, PRESET_DEFS } from '@/lib/useTimeframe';

/**
 * Bridges the existing dual-month calendar `<TimeframeSelector>` (same
 * component used elsewhere in the dashboard) with the URL-backed
 * `useTimeframe` hook so the entire dashboard shares ONE canonical date
 * range UI. Default = This Month.
 */
export default function TimeframeFilter() {
  const tf = useTimeframe();

  const value: DateRange = { start: tf.from, end: tf.to, label: tf.label };

  const onChange = (r: DateRange) => {
    // If the new range exactly matches a preset, write the preset to URL
    // (cleaner shareable link). Otherwise write custom from/to.
    const presetMatch = (Object.keys(PRESET_DEFS) as Array<keyof typeof PRESET_DEFS>).find((k) => {
      const p = PRESET_DEFS[k]();
      return p.from === r.start && p.to === r.end;
    });
    if (presetMatch) tf.setPreset(presetMatch);
    else tf.setCustom(r.start, r.end);
  };

  return <TimeframeSelector value={value} onChange={onChange} />;
}

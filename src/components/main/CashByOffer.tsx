'use client';

import { useEffect, useRef, useState } from 'react';
import { useTimeframe } from '@/lib/useTimeframe';
import CardShell from './CardShell';
import Donut, { type DonutSlice } from './Donut';

interface CashBreakdownResp {
  bySource?: { key: string; amount: number; count: number }[];
  byOffer?: { key: string; amount: number; count: number }[];
}

interface CashByOfferProps {
  /** Pre-fetched cash-breakdown payload from /api/main/dashboard-data. */
  initialData?: CashBreakdownResp;
}

export default function CashByOffer({ initialData }: CashByOfferProps = {}) {
  const { from, to } = useTimeframe();
  const seedSlices = (initialData?.byOffer ?? []).map((r) => ({ label: r.key, value: r.amount }));
  const [data, setData] = useState<DonutSlice[]>(initialData ? seedSlices : []);
  const [loading, setLoading] = useState(!initialData);
  const seedConsumedRef = useRef(!initialData);

  useEffect(() => {
    if (!seedConsumedRef.current) {
      seedConsumedRef.current = true;
      return;
    }
    setLoading(true);
    fetch(`/api/main/cash-breakdown?from=${from}&to=${to}`)
      .then((r) => r.json())
      .then((d: CashBreakdownResp) => {
        const slices = (d.byOffer ?? []).map((r) => ({ label: r.key, value: r.amount }));
        setData(slices);
      })
      .catch(() => setData([]))
      .finally(() => setLoading(false));
  }, [from, to]);

  return (
    <CardShell
      title="Cash by Offer"
      subtitle="New cash collected, segmented by program"
      cardId="main:cash-by-offer"
    >
      {loading ? <div className="text-gray-500 text-xs py-8 text-center">Loading…</div> : <Donut data={data} />}
    </CardShell>
  );
}

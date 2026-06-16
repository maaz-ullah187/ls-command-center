import { NextRequest } from 'next/server';
import MainDashboardClient from './MainDashboardClient';
import { buildDashboardData } from './api/main/dashboard-data/route';
import { getLeads } from '@/lib/dataSources';
import { resolveFromParams } from '@/lib/timeframe';

type SearchParamsInput =
  | Record<string, string | string[] | undefined>
  | Promise<Record<string, string | string[] | undefined>>;

function firstParam(value: string | string[] | undefined): string | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}

export default async function MainDashboard({
  searchParams,
}: {
  searchParams?: SearchParamsInput;
}) {
  const params = searchParams ? await searchParams : {};
  const tf = resolveFromParams(
    firstParam(params.preset),
    firstParam(params.from),
    firstParam(params.to),
  );

  const qs = new URLSearchParams({ from: tf.from, to: tf.to });
  const req = new NextRequest(`https://local.ls-command-center/api/main/dashboard-data?${qs.toString()}`);

  const [initialAgg, initialLeads] = await Promise.all([
    buildDashboardData(req).catch(() => null),
    getLeads().catch(() => []),
  ]);

  return <MainDashboardClient initialAgg={initialAgg} initialLeads={initialLeads} />;
}

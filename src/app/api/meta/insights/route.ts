import { NextResponse } from 'next/server';
import { fetchMetaInsights } from '@/lib/mappers/meta';

// Thin wrapper around the Meta mapper so we can poke at the data directly
// from the browser or curl without having to go through the full dashboard
// render path. Useful for debugging and for one-off verification against
// Meta Ads Manager.
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const datePreset = searchParams.get('date_preset') || 'last_30d';

  const token = process.env.META_ACCESS_TOKEN;
  const accountId = process.env.META_AD_ACCOUNT_ID;

  if (!token || !accountId) {
    return NextResponse.json(
      { error: 'Meta credentials not configured (META_ACCESS_TOKEN / META_AD_ACCOUNT_ID)' },
      { status: 500 }
    );
  }

  try {
    const ads = await fetchMetaInsights(token, accountId, datePreset);
    const totalSpend = ads.reduce((sum, a) => sum + a.spend, 0);
    const totalImpressions = ads.reduce((sum, a) => sum + a.impressions, 0);
    const totalClicks = ads.reduce((sum, a) => sum + a.clicks, 0);
    return NextResponse.json({
      count: ads.length,
      datePreset,
      totals: {
        spend: totalSpend,
        impressions: totalImpressions,
        clicks: totalClicks,
        cpc: totalClicks > 0 ? totalSpend / totalClicks : 0,
      },
      ads,
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

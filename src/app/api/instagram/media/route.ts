import { NextResponse } from 'next/server';

const IG_BASE = 'https://graph.instagram.com/v18.0';

export async function GET() {
  try {
    const accessToken = process.env.INSTAGRAM_ACCESS_TOKEN;
    const accountId = process.env.INSTAGRAM_BUSINESS_ACCOUNT_ID;

    if (!accessToken || !accountId) {
      return NextResponse.json({ error: 'Instagram API not configured' }, { status: 500 });
    }

    // Fetch recent media with engagement metrics
    const fields = 'id,caption,media_type,media_url,thumbnail_url,timestamp,like_count,comments_count';
    const mediaRes = await fetch(
      `${IG_BASE}/${accountId}/media?fields=${fields}&limit=50&access_token=${accessToken}`,
      { next: { revalidate: 1800 } }
    );

    if (!mediaRes.ok) throw new Error(`Instagram API error: ${mediaRes.status}`);
    const mediaData = await mediaRes.json();

    // Fetch account-level insights
    const insightsRes = await fetch(
      `${IG_BASE}/${accountId}?fields=id,username,name,followers_count,follows_count,media_count&access_token=${accessToken}`,
      { next: { revalidate: 1800 } }
    );

    if (!insightsRes.ok) throw new Error(`Instagram insights API error: ${insightsRes.status}`);
    const insightsData = await insightsRes.json();

    // Try to get insights for each media item (reach, impressions, saved)
    const mediaWithInsights = await Promise.all(
      (mediaData.data || []).map(async (item: any) => {
        try {
          const insightRes = await fetch(
            `${IG_BASE}/${item.id}/insights?metric=reach,impressions,saved&access_token=${accessToken}`,
            { next: { revalidate: 1800 } }
          );
          if (insightRes.ok) {
            const insightData = await insightRes.json();
            const insights: Record<string, number> = {};
            for (const metric of insightData.data || []) {
              insights[metric.name] = metric.values?.[0]?.value || 0;
            }
            return { ...item, insights };
          }
        } catch {
          // Insights may not be available for all media types
        }
        return item;
      })
    );

    return NextResponse.json({
      media: mediaWithInsights,
      account: insightsData,
    });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

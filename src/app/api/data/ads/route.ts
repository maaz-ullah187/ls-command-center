import { NextResponse } from 'next/server';
import { getAds } from '@/lib/dataSources';

export const maxDuration = 60;
export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function GET() {
  try {
    const ads = await getAds();
    return NextResponse.json(ads);
  } catch {
    return NextResponse.json([]);
  }
}

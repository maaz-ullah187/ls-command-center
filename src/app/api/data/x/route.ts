import { NextResponse } from 'next/server';
import { getContent } from '@/lib/dataSources';

export async function GET() {
  try {
    const posts = await getContent('x');
    return NextResponse.json(posts);
  } catch {
    return NextResponse.json([]);
  }
}

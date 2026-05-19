import { NextResponse } from 'next/server';
import { fetchVideoComments } from '@/lib/mappers/youtube';
import Anthropic from '@anthropic-ai/sdk';

export const maxDuration = 60;

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const videoId = searchParams.get('videoId');
  const videoTitle = searchParams.get('title') ?? 'Unknown';

  if (!videoId) {
    return NextResponse.json({ error: 'videoId required' }, { status: 400 });
  }

  const ytKey = process.env.YOUTUBE_API_KEY;
  if (!ytKey) {
    return NextResponse.json({ error: 'YouTube API not configured' }, { status: 500 });
  }

  // Fetch comments
  const comments = await fetchVideoComments(ytKey, videoId, 50);
  if (comments.length === 0) {
    return NextResponse.json({
      videoId,
      commentCount: 0,
      summary: 'No comments available for this video (comments may be disabled).',
      themes: [],
      sentiment: 'neutral',
    });
  }

  // If no Anthropic key, return raw comments without AI analysis
  const anthropicKey = process.env.ANTHROPIC_API_KEY;
  if (!anthropicKey) {
    return NextResponse.json({
      videoId,
      commentCount: comments.length,
      summary: `${comments.length} comments fetched but AI analysis unavailable (no ANTHROPIC_API_KEY).`,
      themes: [],
      sentiment: 'unknown',
      comments: comments.slice(0, 10),
    });
  }

  // Run through Claude Sonnet for analysis
  const client = new Anthropic({ apiKey: anthropicKey });

  const commentText = comments
    .slice(0, 40) // Cap at 40 for token efficiency
    .map((c, i) => `[${i + 1}] (${c.likes} likes) ${c.text}`)
    .join('\n\n');

  try {
    const response = await client.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 1024,
      system: `You analyze YouTube comments for a B2B AI agency channel. Return ONLY valid JSON — no markdown.

Response format:
{
  "summary": "<2-3 sentence summary of what commenters think about this video>",
  "whatWorked": ["<specific thing viewers liked>", ...],
  "whatDidntWork": ["<specific criticism or suggestion>", ...],
  "contentIdeas": ["<content idea inspired by comments>", ...],
  "sentiment": "positive" | "mixed" | "negative",
  "topQuote": "<the single most insightful/representative comment, under 100 chars>"
}

Focus on actionable insights for the creator. Be specific — "people liked the case study format" is better than "positive reception".`,
      messages: [{
        role: 'user',
        content: `Analyze these ${comments.length} comments on the video "${videoTitle}":\n\n${commentText}`,
      }],
    });

    const textBlock = response.content.find(b => b.type === 'text');
    if (!textBlock || textBlock.type !== 'text') {
      throw new Error('No text in Claude response');
    }

    const cleaned = textBlock.text.replace(/^```(?:json)?\s*\n?/i, '').replace(/\n?```\s*$/i, '').trim();
    const analysis = JSON.parse(cleaned);

    return NextResponse.json({
      videoId,
      commentCount: comments.length,
      ...analysis,
    });
  } catch (e) {
    console.error('[youtube/comments] Claude analysis failed:', e);
    return NextResponse.json({
      videoId,
      commentCount: comments.length,
      summary: `${comments.length} comments fetched but AI analysis failed.`,
      themes: [],
      sentiment: 'unknown',
      comments: comments.slice(0, 5),
    });
  }
}

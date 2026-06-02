// GoHighLevel → dashboard Lead type mapper.
// Simplified: t01_leads is now a clean "who came in the door" table.
// All call/booking/closer/cash/scoring data lives in other tables.

import 'server-only';
import type { Lead, Channel, Offer } from '../types';

// Base URL for GHL calls.
// When META_PROXY_URL is set (residential IP Flask proxy), route GHL calls
// through it: Vercel → Tailscale → the operator's Mac → GHL. This bypasses GHL's
// edge block on Vercel's serverless IPs (HTTP 403 "token does not have access
// to this location"). The proxy holds the GHL token server-side so no creds
// cross the Vercel↔proxy boundary — only the X-API-Key auth header.
const V2_DIRECT = 'https://services.leadconnectorhq.com';
const VERSION = '2021-07-28';

/**
 * Return the base URL + whether we're routing through the proxy.
 *
 * Gated behind GHL_USE_PROXY='1' specifically — the Meta proxy env vars
 * (META_PROXY_URL / META_PROXY_API_KEY) point to a Tailscale IP that
 * Vercel serverless CANNOT reach, so we must NOT opportunistically
 * use them. If/when GHL's edge starts blocking Vercel IPs again, flip
 * GHL_USE_PROXY=1 on Vercel, expose the proxy publicly (cloudflared
 * tunnel) and it takes over.
 */
function ghlBase(): { base: string; viaProxy: boolean; extraHeaders: Record<string, string> } {
  const useProxy = process.env.GHL_USE_PROXY === '1';
  const proxy = process.env.META_PROXY_URL;
  const proxyKey = process.env.META_PROXY_API_KEY;
  if (useProxy && proxy && proxyKey) {
    return {
      base: `${proxy.replace(/\/$/, '')}/api/ghl`,
      viaProxy: true,
      extraHeaders: { 'X-API-Key': proxyKey },
    };
  }
  return { base: V2_DIRECT, viaProxy: false, extraHeaders: {} };
}

const V2 = V2_DIRECT; // back-compat export used by a few other spots in this file

// Custom field IDs from the ProgB sub-account.
const CF = {
  // Ad attribution — names
  campaignName: 'AF6HaG0AwhntpHERFXeK',
  adSetName:    'uCnzXPF62jVOyGw9KuQW',
  adName:       'MWBSroI1Mab5H0UDRRiM',

  // Ad attribution — Meta IDs (for deterministic campaign/adset/ad joins)
  campaignId:   'KhK0Q8zBzEqihThQQerG',
  adSetId:      'd4MZZmnQ1OrQOfTDcGfm',
  adId:         'yZiphOJEIpTr4dqTBNEP',

  // Program C qualification fields
  businessType_AI: 'LmdGPTOSiJxr2yETkhUM',
  monthlyRev_AI:   'CRGtkaUI3YV9JWlNyiVf',
  timeDrain_AI:    'MjPMOtxqu4VFXRZa0mch',
  qualBlock1:      process.env.GHL_QUAL_FIELD_ID ?? '',
  qualBlock2:      'TtpSjabReEf9DQk9kTvL',

  // ProgB-specific fields
  setterNotes:     'Pw41fGAJyBKFur4raBut',
  businessType_LS: 'biVDaYuHfmwqTG0Th0zJ',
  goal:            'WeXBFPANY12B51c0vpOO',
  program:         'A9lZfSbF7448rnN1JDI8',
  offerVariant:    'MZQJJctYh7useNZEAEAT',
  sourceField:     'EBh8fMmYcAzXGoJfMdFW',

  // Legacy discrete fields (still checked as fallback)
  businessType: 'ZwQ3fPfqxGGEzfNOF54O',
  coreBusiness: 'rAPjR8dYMNJrFhuhdA8w',
  monthlyRev:   'MbLtyTmGvM8DKvbzeNnP',
} as const;

interface GHLCustomFieldValue {
  id: string;
  value?: string | number | boolean | string[];
}

interface GHLContact {
  id: string;
  firstName?: string;
  lastName?: string;
  contactName?: string;
  email?: string;
  phone?: string;
  source?: string;
  tags?: string[];
  assignedTo?: string;
  dateAdded?: string;
  customFields?: GHLCustomFieldValue[];
}

interface GHLContactsResponse {
  contacts?: GHLContact[];
  meta?: { total?: number; nextPageUrl?: string; startAfterId?: string; startAfter?: number };
}

// Pull the first value for a given field id. Returns '' if missing.
function cf(contact: GHLContact, fieldId: string): string {
  const row = contact.customFields?.find(f => f.id === fieldId);
  if (!row || row.value == null) return '';
  return typeof row.value === 'string' ? row.value : String(row.value);
}

// Determine offer from tags, custom fields, and campaign name.
function offerFromContact(contact: GHLContact, campaignName: string): Offer | null {
  const cn = campaignName.toLowerCase();

  // 0. Campaign-name Program C override — takes precedence over tags
  //    and CF. Campaigns named "SS | ProgB | Program C Offer" run the AI
  //    Installation offer even though they carry the ProgB brand in the slug.
  //    the operator 2026-04-19: "we don't run ProgB ads" — so any paid lead whose
  //    campaign clearly sells Program C IS an Program C lead.
  if (cn.includes('program c') || cn.includes('ai implementation') || cn.includes('programc')) {
    return 'Program C';
  }

  // 1. Tags. Add your business-specific tag patterns/abbreviations here.
  const lower = (contact.tags ?? []).map(t => t.toLowerCase());
  if (lower.some(t => t.includes('programc') || t.includes('program c'))) return 'Program C';
  if (lower.some(t => t.includes('program b'))) return 'ProgB';
  if (lower.some(t => t.includes('program a'))) return 'ProgA';

  // 2. Custom field: program. Add lowercase fragments matching your offer names.
  const prog = cf(contact, CF.program).toLowerCase();
  if (prog.includes('program b')) return 'ProgB';
  if (prog.includes('program a')) return 'ProgA';
  if (prog.includes('program c') || prog.includes('ai')) return 'Program C';

  // 3. Custom field: offer variant. Same fragment list as above.
  const variant = cf(contact, CF.offerVariant).toLowerCase();
  if (variant.includes('program b')) return 'ProgB';
  if (variant.includes('program a')) return 'ProgA';
  if (variant.includes('program c') || variant.includes('ai')) return 'Program C';

  // 4. Campaign name fallback.
  if (cn.includes('program b')) return 'ProgB';
  if (cn.includes('program a')) return 'ProgA';

  return null;
}

/**
 * Public wrapper around the raw source derivation. Applies three hard rules
 * on top of whatever the heuristic inside produces:
 *
 *   1. `Facebook Ads` requires campaign + adset + ad evidence OR a populated
 *      campaign_id. Without any of those, we don't have proof of a paid ad
 *      touch — demote to `Unknown`.
 *   2. Program B is an organic-only offer. We do not run paid ads for
 *      it. If the raw classifier says `Facebook Ads` but offer is `ProgB`,
 *      that's impossible — demote to `Unknown`.
 *   3. Campaign-id fallback (the operator 2026-04-23): if the classifier fell all
 *      the way through to `Unknown` but the contact has a campaign_id set,
 *      that's a Facebook Ads lead whose campaign/adset/ad names didn't land
 *      on the contact. Promote to `Facebook Ads` so attribution isn't lost.
 *
 * Place final-authority rules here so every caller gets them consistently.
 */
function sourceFromContact(
  contact: GHLContact,
  campaignName: string,
  adSetName?: string,
  adName?: string,
  campaignId?: string,
): Channel {
  const raw = rawSourceFromContact(contact, campaignName, adSetName, adName, campaignId);
  const offer = offerFromContact(contact, campaignName);
  // Only a numeric Meta campaign ID (10+ digits) counts as ad evidence.
  // GHL `workflow_*` IDs are internal automation markers, not Facebook.
  const cid = (campaignId ?? '').trim();
  const hasMetaCampaignId = /^\d{10,}$/.test(cid);

  if (raw === 'Facebook Ads') {
    // Trust the raw classifier: if GHL explicitly says Facebook Ads
    // (via attributionSource, tags, custom fields, etc.), don't second-guess
    // it just because campaign/adset/ad names didn't land on the contact.
    // ProgB carve-out still applies — we don't run ProgB ads.
    if (offer === 'ProgB') return 'Unknown';
    return raw;
  }

  // Rule 3: Unknown + has Meta numeric campaign_id → Facebook Ads (unless ProgB offer)
  if (raw === 'Unknown' && hasMetaCampaignId && offer !== 'ProgB') {
    return 'Facebook Ads';
  }

  return raw;
}

// Detects Instagram bio-link attribution markers in campaign/adset/ad fields.
// the operator 2026-04-23: leads showing source=YouTube with "ig_bio" / "link_in_bio" / "bio"
// in their campaign metadata are actually Instagram traffic from the IG bio link.
// These override any other source derivation.
//
// Guardrail: if any field explicitly mentions "youtube" (e.g., campaign_name =
// 'youtube_channel_bio'), this is literal YouTube bio traffic, NOT Instagram.
// Don't flip those.
function hasInstagramBioMarker(campaignName: string, adSetName?: string, adName?: string): boolean {
  const fields = [campaignName, adSetName ?? '', adName ?? ''].map(s => (s ?? '').toLowerCase().trim());

  // Explicit YouTube mention anywhere → never flip to Instagram on bio markers
  if (fields.some(f => f.includes('youtube') || f.includes('yt_'))) return false;

  const IG_BIO_MARKERS = ['ig_bio', 'ig-bio', 'igbio', 'link_in_bio', 'link-in-bio', 'linkinbio'];
  if (fields.some(f => IG_BIO_MARKERS.some(m => f.includes(m)))) return true;
  // Bare "bio" in a field — tight match only (full-string)
  if (fields.some(f => f === 'bio')) return true;
  return false;
}

// Tests if a string looks like a YouTube video slug campaign name.
// Examples: "freecourse-googledoc", "theo-interview", "csm-exit-call", "hugointerview"
// Rules: all lowercase alphanumeric + dashes/underscores, no pipes, no brackets, no spaces.
function isYouTubeSlugCampaign(campaignName: string): boolean {
  const trimmed = (campaignName ?? '').trim();
  if (!trimmed) return false;
  // Already cleaned up — don't re-transform
  if (trimmed.toLowerCase() === 'video') return false;
  // Short generic tags like "yt" / "YT" / "youtube" are not slugs
  if (/^(yt|youtube)$/i.test(trimmed)) return false;
  return /^[a-z0-9\-_]+$/.test(trimmed) && !trimmed.includes('|') && !trimmed.includes('[');
}

// Converts a lowercase-slug campaign name into a human-readable video title.
// "freecourse-googledoc" → "Freecourse Googledoc"
// "theo-interview"       → "Theo Interview"
// "csm_exit_call"        → "Csm Exit Call"
// (Can't split compounds like "freecourse" → "Free Course" without a dictionary —
// the operator can override individual rows via the overrides table if he wants a
// specific description like "Free Course - Google Doc".)
function titleCaseFromSlug(slug: string): string {
  return (slug ?? '')
    .split(/[-_]+/)
    .filter(Boolean)
    .map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(' ');
}

/**
 * Canonicalize campaign/adset/ad fields for YouTube-sourced leads.
 * the operator 2026-04-23: standardize YouTube attribution so every YT lead reads:
 *   source       = 'YouTube'
 *   campaignName = 'video'
 *   adSetName    = human-readable video title (derived from the slug)
 *   adName       = the raw slug (e.g., "freecourse-googledoc")
 *
 * Only fires when the source is YouTube AND the current campaign looks like a
 * slug. Already-canonical rows (campaign_name='video') are left alone.
 */
function reformatYouTubeAttribution(
  channel: Channel,
  campaignName: string,
  adSetName: string,
  adName: string,
): { campaignName: string; adSetName: string; adName: string } {
  if (channel !== 'YouTube') return { campaignName, adSetName, adName };
  if (!isYouTubeSlugCampaign(campaignName)) return { campaignName, adSetName, adName };

  const slug = campaignName.trim();
  const title = titleCaseFromSlug(slug);
  return {
    campaignName: 'video',
    adSetName: title,
    adName: slug,
  };
}

// Derive traffic source from campaign name patterns, tags, custom fields, contact.source.
function rawSourceFromContact(contact: GHLContact, campaignName: string, adSetName?: string, adName?: string, campaignId?: string): Channel {
  const tagsLower = (contact.tags ?? []).map(t => t.toLowerCase());
  const cn = campaignName.toLowerCase();

  // IG bio override — runs FIRST so it beats every other signal (including
  // custom field "YouTube" that gets stamped on leads which actually came in
  // via the link-in-bio on Instagram).
  if (hasInstagramBioMarker(campaignName, adSetName, adName)) return 'Instagram';

  // Custom field source (EBh8fMmYcAzXGoJfMdFW) — explicit attribution set by team
  const cfSource = cf(contact, CF.sourceField).toLowerCase();
  if (cfSource) {
    if (cfSource.includes('youtube')) return 'YouTube';
    if (cfSource.includes('instagram') || cfSource.includes('ig')) return 'Instagram';
    if (cfSource.includes('linkedin')) return 'LinkedIn';
    if (cfSource.includes('facebook') || cfSource.includes('fb') || cfSource.includes('paid')) return 'Facebook Ads';
    if (cfSource.includes('referral')) return 'Referral';
    if (cfSource.startsWith('x ') || cfSource === 'x' || cfSource.includes('twitter')) return 'X';
  }

  // Meta paid naming convention
  if (/^(ss|sr)\s*\|/.test(cn) || cn.includes('program c offer')) return 'Facebook Ads';
  if (cn.includes('linkedin')) return 'LinkedIn';
  if (cn.includes('youtube')) return 'YouTube';
  if (cn.includes('instagram') || cn.includes('ig ')) return 'Instagram';
  if (cn.startsWith('x ') || cn === 'x' || cn.includes('twitter')) return 'X';
  if (cn.includes('webinar')) return 'Facebook Ads';
  if (cn.includes('referral')) return 'Referral';

  // Known YouTube campaign-name hints
  const YT_CAMPAIGN_HINTS = [
    'freecourse', 'free-course', 'free_course',
    'theointerview', 'theo-interview', 'theo_interview',
    'hugointerview', 'hugo-interview', 'hugo_interview',
    'csmexitcall', 'csm-exit-call', 'csm_exit_call',
  ];
  if (YT_CAMPAIGN_HINTS.some(h => cn.includes(h))) return 'YouTube';

  // Tag-based fallbacks
  if (tagsLower.some(t => t.includes('referral'))) return 'Referral';
  if (tagsLower.some(t => t.includes('youtube'))) return 'YouTube';
  if (tagsLower.some(t => t.includes('linkedin'))) return 'LinkedIn';
  if (tagsLower.some(t => t.includes('instagram'))) return 'Instagram';
  if (tagsLower.some(t => t.startsWith('paid'))) return 'Facebook Ads';

  // Contact-level source field
  const src = (contact.source ?? '').toLowerCase();
  if (src.startsWith('fb') || src.includes('facebook')) return 'Facebook Ads';
  if (/^(ss|sr)\s*\|/.test(src)) return 'Facebook Ads';
  if (src.includes('youtube')) return 'YouTube';
  if (src.includes('linkedin')) return 'LinkedIn';
  if (src.includes('instagram')) return 'Instagram';
  if (src.includes('organic')) return 'YouTube';

  // Scan tags for paid patterns
  const allTags = (contact.tags ?? []).join(' ').toLowerCase();
  if (allTags.includes('typeform') && allTags.includes('paid')) return 'Facebook Ads';
  if (allTags.includes('vsl')) return 'Facebook Ads';
  if (src.includes('calendly') && allTags.includes('typeform')) return 'Facebook Ads';

  // "organic" tag → default to YouTube
  if (tagsLower.some(t => t.includes('organic'))) {
    if (tagsLower.some(t => t.includes('instagram'))) return 'Instagram';
    return 'YouTube';
  }

  // Ad attribution data.
  //
  // Guardrails added 2026-04-23:
  //   - Facebook-style ad_set_name (contains "|") → Facebook Ads, even if campaign
  //     name looks like a YT slug. Fixes ~48 rows where FB numeric campaign IDs
  //     (e.g., "120241687821900373") were misclassified as YouTube.
  //   - Purely numeric campaign_name with ≥10 digits = Facebook campaign ID,
  //     never a YouTube slug.
  //   - YouTube slug must contain at least one letter.
  if (campaignName && campaignName.trim() !== '') {
    const trimmed = campaignName.trim();
    const adSetHasPipe = (adSetName ?? '').includes('|');
    const adNameHasPipe = (adName ?? '').includes('|');
    const isNumericFbId = /^[0-9]{10,}$/.test(trimmed);
    const looksLikeYtSlug =
      /^[a-z0-9\-_]+$/.test(trimmed) &&
      /[a-z]/.test(trimmed) &&  // must have at least one letter
      !trimmed.includes('|') &&
      !trimmed.includes('[');

    if (looksLikeYtSlug && !adSetHasPipe && !adNameHasPipe && !isNumericFbId) {
      return 'YouTube';
    }
    return 'Facebook Ads';
  }
  if ((adSetName && adSetName.trim() !== '') || (adName && adName.trim() !== '')) return 'Facebook Ads';

  // Source field Meta patterns. Add lowercase fragments that appear in your
  // Meta campaign / ad-set / ad names so paid leads classify correctly.
  const META_PATTERNS: string[] = ['program a', 'program b', 'program c'];
  if (META_PATTERNS.some(p => src.includes(p))) return 'Facebook Ads';

  // Webinar tag — LAST RESORT only.
  // the operator 2026-04-28: "everything takes priority over webinar tag. Webinar
  // is the last resort if they have a webinar tag and you can't find any
  // other source for them." Run AFTER all ad-attribution and source detection
  // so real Facebook ad evidence (campaign/adset/ad name OR Meta campaign_id)
  // wins. Word-boundary match (`\bwebinar\b`) avoids historical noise tags
  // like "ex-webinar-attendee" or "webinarseries-2024" matching loosely.
  // Skip this branch entirely if a numeric Meta campaign_id is set — the
  // wrapper's Rule 3 will promote that to Facebook Ads.
  const cidStr = (campaignId ?? '').trim();
  const hasMetaCampaignId = /^\d{10,}$/.test(cidStr);
  if (!hasMetaCampaignId) {
    if (tagsLower.some(t => /\bwebinar\b/i.test(t))) return 'Webinar';
  }

  return 'Unknown';
}

/**
 * Lightweight junk check for callers that only have name/email/phone
 * (e.g. Calendly bookings, cleanup sweeps). Wraps the richer isJunkLead.
 */
export function isJunkPerson(input: { name?: string | null; email?: string | null; phone?: string | null }): boolean {
  return isJunkLead({
    id: '',
    firstName: undefined,
    lastName: undefined,
    contactName: (input.name ?? '').trim() || undefined,
    email: input.email ?? undefined,
    phone: input.phone ?? undefined,
  } as GHLContact);
}

/**
 * Parse the native `source` field for attribution when the custom fields
 * are empty. GHL often writes the full attribution into `source` in the
 * shape: `{channel} / {Campaign} | {AdSet} | {AdName}` when a lead opts in
 * via a funnel that doesn't populate the individual custom fields.
 *
 * Example: "fb / SR | AI Implementation Audit | STATICS V2"
 *   → campaign: "SR", adSet: "AI Implementation Audit", ad: "STATICS V2"
 *
 * Returns { campaignName, adSetName, adName } — any of which may be null
 * if the source doesn't match the expected pattern.
 */
export function parseAttributionFromSource(source: string | undefined): {
  campaignName: string | null;
  adSetName: string | null;
  adName: string | null;
} {
  const empty = { campaignName: null, adSetName: null, adName: null };
  if (!source) return empty;

  // Strict pattern match: only parse sources that look like the real Meta
  // naming convention "{channel} / {Campaign} | {AdSet} | {AdName}". Sources
  // like "Opt-in Form (VSL)" or "New Client Form" are NOT ad attribution and
  // must not be smashed into campaign_name — that would let them trigger the
  // downstream "campaignName non-empty → Facebook Ads" rule.
  if (!source.includes(' / ') || !source.includes(' | ')) return empty;

  const afterSlash = source.split(' / ').slice(1).join(' / ');
  const parts = afterSlash.split(' | ').map(p => p.trim()).filter(Boolean);
  if (parts.length < 2) return empty; // need at least campaign + adset for this to be real

  return {
    campaignName: parts[0] || null,
    adSetName:    parts[1] || null,
    adName:       parts[2] || null,
  };
}

// Detect fake/junk leads. Exported so booking sync + cleanup sweep share
// a single source of truth for junk patterns.
export function isJunkLead(contact: GHLContact): boolean {
  const name = (
    contact.contactName ||
    [contact.firstName, contact.lastName].filter(Boolean).join(' ')
  ).trim();
  const email = (contact.email || '').trim().toLowerCase();
  const phone = (contact.phone || '').trim();
  const nameLower = name.toLowerCase();

  const hasRealName = /[a-z]/i.test(name);
  const hasEmail = email.includes('@');
  const hasPhone = phone.replace(/[^\d]/g, '').length >= 7;

  // Must have at least email or phone — no contact info = invalid lead
  if (!hasEmail && !hasPhone) return true;

  if (!hasRealName && !hasEmail && !hasPhone) return true;

  const namePhoneOnly = name.length > 0 && /^[\d\s\-+().]+$/.test(name);
  if (namePhoneOnly && !hasEmail) return true;

  const JUNK_NAMES = new Set([
    'joe biden', 'donald trump', 'barack obama', 'elon musk', 'mickey mouse',
    'john doe', 'jane doe', 'jone doe', 'test test', 'asdf asdf', 'fgsd asdfa', 'fgsd asdf',
    'aaa aaa', 'bbb bbb', 'test user', 'fake name', 'anon anon', 'abc abc',
    'john smith', 'jane smith', 'jonny sins', 'john pork', 'the operator is gay',
    'yes yes', 'lol lol', 'lol me', 'dsgd', 'hjhlkj', 'vuiv vkhv',
    'ejiqo qh2uo', 'asdfgd sdgsa', 'astqwetasdf astdastd', 'yourcompany',
  ]);
  if (JUNK_NAMES.has(nameLower)) return true;

  const GIBBERISH_TOKENS = new Set([
    'asdf', 'test', 'qwerty', 'fgsd', 'fake', 'abcd', 'zzz', 'xxx', 'aaa',
    'yes', 'no', 'hi', 'ok', 'lol', 'dsgd', 'hjhlkj',
  ]);
  if (GIBBERISH_TOKENS.has(nameLower)) return true;

  // Single-word names that are gibberish (no vowels, or very short random chars)
  const tokens = nameLower.split(/\s+/).filter(Boolean);
  if (tokens.length === 1 && nameLower.length >= 3 && nameLower.length <= 8 && !/[aeiou]/i.test(nameLower)) return true;

  const COMMON_TEST_WORDS = new Set([
    'yes', 'no', 'test', 'asdf', 'ok', 'hi', 'hey', 'hello', 'lol',
    'abc', 'aaa', 'bbb', 'xxx', 'zzz', 'na', 'none', 'fake',
  ]);
  if (tokens.length === 2 && tokens[0] === tokens[1] && COMMON_TEST_WORDS.has(tokens[0])) return true;

  // Names containing "test" anywhere (e.g. "kevin test", "name testnew", "first-test last")
  if (tokens.some(t => t === 'test' || t.startsWith('test') || t.endsWith('test'))) return true;

  // Names with parenthesized test keywords (e.g. "name (implementation-audit)", "name (program-c)")
  if (/\(.*\)/.test(nameLower)) return true;

  // "paid vsl" prefix (e.g. "paid vsl colford")
  if (nameLower.startsWith('paid vsl')) return true;

  const nameCharsOnly = name.replace(/\s/g, '');
  if (nameCharsOnly.length > 0 && nameCharsOnly.length <= 2) return true;

  if (tokens.length >= 2) {
    const looksMashy = (t: string) =>
      t.length >= 3 && t.length <= 7 && (
        /\d/.test(t) || !/[aeiou]/i.test(t) || /(.)\1{2,}/.test(t)
      );
    if (tokens.every(looksMashy)) return true;
  }

  if (hasEmail) {
    if (email.startsWith('test@') || email.startsWith('fake@') || email.startsWith('dummy@')) return true;
    // Catch Gmail-style "+alias" test addresses where the alias contains a test
    // keyword anywhere (e.g. "acolford2000+dummytest-postsupabase@gmail.com",
    // "real.user+test@gmail.com", "name+fake_lead@example.com").
    // the operator 2026-04-28: prior version only matched the literal substring "+test"
    // which let "+dummytest" / "+faketest" through.
    const localFull = email.split('@')[0] ?? '';
    const plusIdx = localFull.indexOf('+');
    if (plusIdx >= 0) {
      const alias = localFull.slice(plusIdx + 1);
      const TEST_ALIAS_KEYWORDS = ['test', 'dummy', 'fake', 'spam', 'junk'];
      if (TEST_ALIAS_KEYWORDS.some(kw => alias.includes(kw))) return true;
    }
    const [local, domain] = email.split('@');
    const JUNK_DOMAINS = [
      'google.com', 'test.com', 'example.com', 'example.org', 'fake.com',
      'demo.com', 'placeholder.com', 'none.com', 'noemail.com',
      'mailinator.com', 'yopmail.com', 'trashmail.', 'tempmail.', 'sharklasers.',
      'guerrillamail.', '10minutemail.', 'spam4.me', 'spamgt.com', 'spam.',
      'nada.email', 'maildrop.cc', 'dispostable.com', 'getnada.com',
      'tester.io',
    ];
    for (const jd of JUNK_DOMAINS) {
      if (domain.endsWith(jd) || domain.includes(jd)) return true;
    }
    // Broken/invalid TLDs (e.g. ".combat" instead of ".com")
    const tld = domain.split('.').pop() || '';
    const VALID_TLDS = new Set([
      'com', 'net', 'org', 'io', 'co', 'us', 'ca', 'uk', 'au', 'de', 'fr', 'es',
      'it', 'nl', 'be', 'ch', 'at', 'in', 'jp', 'kr', 'cn', 'ru', 'br', 'mx',
      'za', 'nz', 'se', 'no', 'dk', 'fi', 'ie', 'pt', 'pl', 'cz', 'hu', 'ro',
      'bg', 'hr', 'sk', 'si', 'lt', 'lv', 'ee', 'is', 'gr', 'tr', 'il', 'ae',
      'sg', 'hk', 'tw', 'ph', 'my', 'th', 'id', 'vn', 'pk', 'ng', 'ke', 'eg',
      'ar', 'cl', 'pe', 'ec', 'uy', 'info', 'biz', 'edu', 'gov', 'mil', 'int',
      'pro', 'name', 'coop', 'museum', 'travel', 'tel', 'mobi', 'asia', 'cat',
      'jobs', 'app', 'dev', 'me', 'tv', 'cc', 'xyz', 'club', 'online', 'site',
      'store', 'tech', 'space', 'life', 'world', 'today', 'email', 'agency',
      'design', 'ai', 'gg', 'ly',
    ]);
    if (tld.length > 3 && !VALID_TLDS.has(tld)) return true;
    // Single-char domains (e.g. "g.com", "x.com" is valid but "g.com" is sus)
    const domainName = domain.split('.').slice(0, -1).join('.');
    if (domainName.length === 1 && domainName !== 'x') return true;
    const JUNK_LOCAL_PARTS = new Set([
      'test', 'asdf', 'fgsd', 'qwerty', 'admin', 'noemail', 'none', 'na',
      'anon', 'anonymous', 'fake', 'nobody', 'nothing', 'null', 'undefined',
      'really', 'demo', 'example', 'user', 'lol', 'vsl', 'name',
    ]);
    if (JUNK_LOCAL_PARTS.has(local)) return true;
    if (local.length >= 3 && /^(.)\1+$/.test(local)) return true;
    const mashyLocal = local.length <= 5 && /\d/.test(local) && /[a-z]/.test(local);
    if (mashyLocal && !hasRealName) return true;
    if (local.length < 3 && name.replace(/\s/g, '').length < 4) return true;
  }

  if (!hasEmail && !hasPhone) return true;

  if (hasEmail && tokens.length >= 1) {
    const hasShortToken = tokens.some(t => t.length <= 2);
    const local = email.split('@')[0];
    const GENERIC_LOCALS = new Set([
      'mail', 'email', 'chris', 'info', 'hello', 'hi', 'contact', 'support',
      'sales', 'me', 'you', 'them', 'us',
    ]);
    const localIsGeneric = GENERIC_LOCALS.has(local);
    const localIsMashy = /[a-z]/.test(local) && /\d/.test(local) &&
      local.replace(/\d/g, '').length <= 3;
    if (hasShortToken && (localIsGeneric || localIsMashy)) return true;
  }

  if (tokens.length >= 2 && tokens.every(t => t.length <= 2)) return true;

  // Block all @example.com emails (team/test accounts)
  if (hasEmail && email.endsWith('@example.com')) return true;

  // Specific known junk emails
  const JUNK_EMAILS = new Set([
    'abc@gmail.com',
    'asdfg@gmail.com',
    'lol@lol.com',
    'lol@me.com',
    'name@name.com',
    'vsl@gmail.com',
  ]);
  if (hasEmail && JUNK_EMAILS.has(email)) return true;

  return false;
}

// Deduplication: group by email then by exact name match.
function deduplicateContacts(contacts: GHLContact[]): GHLContact[] {
  const richness = (c: GHLContact): number => {
    let score = 0;
    if (c.email) score += 1;
    if (c.phone) score += 1;
    if (c.firstName) score += 1;
    if (c.lastName) score += 1;
    if (c.assignedTo) score += 1;
    if (c.tags && c.tags.length > 0) score += c.tags.length;
    if (c.customFields) score += c.customFields.filter(f => f.value != null && f.value !== '').length;
    return score;
  };

  const pickBetter = (a: GHLContact, b: GHLContact): GHLContact => {
    const ra = richness(a);
    const rb = richness(b);
    if (ra !== rb) return ra >= rb ? a : b;
    const da = a.dateAdded ?? '';
    const db = b.dateAdded ?? '';
    return da >= db ? a : b;
  };

  const byEmail = new Map<string, GHLContact>();
  const noEmail: GHLContact[] = [];
  for (const c of contacts) {
    const email = (c.email ?? '').trim().toLowerCase();
    if (!email || !email.includes('@')) {
      noEmail.push(c);
      continue;
    }
    const existing = byEmail.get(email);
    if (existing) {
      byEmail.set(email, pickBetter(existing, c));
    } else {
      byEmail.set(email, c);
    }
  }

  const afterEmail = [...byEmail.values(), ...noEmail];
  const byName = new Map<string, GHLContact>();
  const result: GHLContact[] = [];
  const seen = new Set<string>();

  for (const c of afterEmail) {
    const name = (
      c.contactName ||
      [c.firstName, c.lastName].filter(Boolean).join(' ')
    ).trim().toLowerCase();
    const tokens = name.split(/\s+/).filter(Boolean);
    if (name.length >= 3 && tokens.length >= 2) {
      const existing = byName.get(name);
      if (existing) {
        byName.set(name, pickBetter(existing, c));
        continue;
      }
      byName.set(name, c);
    } else {
      if (!seen.has(c.id)) {
        result.push(c);
        seen.add(c.id);
      }
    }
  }

  for (const c of byName.values()) {
    if (!seen.has(c.id)) {
      result.push(c);
      seen.add(c.id);
    }
  }

  const deduped = contacts.length - result.length;
  if (deduped > 0) {
    console.log(`[ghl] deduplication removed ${deduped} duplicate contacts (${contacts.length} -> ${result.length})`);
  }
  return result;
}

// March 1 cutoff — sync contacts from March 2026 onward so pre-April closes
// (Anthony Campos, Kenny Hawksworth, Richard Jackson, etc.) are attributable
// to the ads that generated them. Lifted from 2026-04-01 on 2026-04-20.
const DATE_CUTOFF = '2026-03-01';

// Parse qualification / context from GHL custom fields into readable text.
// Covers both Program C leads (qualBlock1/2) and ProgB leads (setter notes).
function parseQualificationText(contact: GHLContact): string | null {
  const parts: string[] = [];

  // --- Program C qualification blocks ---
  const block1 = cf(contact, CF.qualBlock1);
  const block2 = cf(contact, CF.qualBlock2);
  const btAI = cf(contact, CF.businessType_AI);
  const mrAI = cf(contact, CF.monthlyRev_AI);
  const tdAI = cf(contact, CF.timeDrain_AI);

  if (btAI) parts.push(`Business Type: ${btAI}`);
  if (mrAI) parts.push(`Monthly Revenue: ${mrAI}`);
  if (tdAI) parts.push(`Time Drain: ${tdAI}`);

  // Parse concatenated qual blocks (Program C typeform data)
  const lines = [block1, block2].join('\n').split('\n').filter(Boolean);
  for (const line of lines) {
    const dashIdx = line.indexOf(' - ');
    if (dashIdx === -1) continue;
    const label = line.slice(0, dashIdx).trim();
    const value = line.slice(dashIdx + 3).trim();
    if (!value) continue;
    const labelLower = label.toLowerCase();
    if (labelLower.includes('business type') && btAI) continue;
    if (labelLower.includes('monthly revenue') && mrAI) continue;
    if (labelLower.includes('time drain') && tdAI) continue;
    parts.push(`${label}: ${value}`);
  }

  // --- ProgB-specific fields ---
  const btLS = cf(contact, CF.businessType_LS);
  const goal = cf(contact, CF.goal);

  // Only add ProgB fields if we don't already have AI fields
  if (!btAI && btLS) parts.push(`Business Type: ${btLS}`);
  if (goal) parts.push(`Goal: ${goal}`);

  // --- Legacy discrete fields (fallback) ---
  const bt = cf(contact, CF.businessType);
  const cr = cf(contact, CF.coreBusiness);
  const mr = cf(contact, CF.monthlyRev);
  if (!btAI && !btLS && bt) parts.push(`Business Type: ${bt}`);
  if (mr && !mrAI) parts.push(`Monthly Revenue: ${mr}`);
  if (cr) parts.push(`Core Business: ${cr}`);

  // --- Setter notes (rich context about the lead) ---
  const setterNotes = cf(contact, CF.setterNotes);
  if (setterNotes) {
    parts.push(`\nSetter Notes: ${setterNotes}`);
  }

  return parts.length > 0 ? parts.join('\n') : null;
}

// Paginate contacts. GHL v2 returns up to 100 per page.
// maxPages bumped to 200 so the full ~12K contact list is reachable.
async function fetchContacts(token: string, locationId: string, maxPages = 200): Promise<GHLContact[]> {
  const all: GHLContact[] = [];
  let startAfterId: string | undefined;
  let startAfter: number | undefined;

  const { base, viaProxy, extraHeaders } = ghlBase();
  for (let page = 0; page < maxPages; page++) {
    const url = new URL(`${base}/contacts/`);
    url.searchParams.set('locationId', locationId);
    url.searchParams.set('limit', '100');
    if (startAfterId) url.searchParams.set('startAfterId', startAfterId);
    if (startAfter != null) url.searchParams.set('startAfter', String(startAfter));

    // When going via proxy, the proxy supplies the GHL Authorization + Version
    // headers. We pass X-API-Key to authenticate to the proxy itself.
    const fetchHeaders: Record<string, string> = viaProxy
      ? { Accept: 'application/json', ...extraHeaders }
      : {
          Authorization: `Bearer ${token}`,
          Version: VERSION,
          Accept: 'application/json',
          'User-Agent': 'LS-Command-Center/1.0 (+your-dashboard.vercel.app)',
        };
    let res = await fetch(url.toString(), { headers: fetchHeaders, next: { revalidate: 300 } });
    if (res.status === 429) {
      console.warn(`[ghl] rate limited on page ${page}, waiting 2s...`);
      await new Promise(r => setTimeout(r, 2000));
      res = await fetch(url.toString(), { headers: fetchHeaders, next: { revalidate: 300 } });
    }
    if (!res.ok) {
      // Capture the actual error body — helps distinguish token scope / IP
      // block / rate limit / malformed-request causes of 403/401/400.
      const body = await res.text().catch(() => '(no body)');
      console.error(
        `[ghl] contacts HTTP ${res.status} on page ${page} (fetched ${all.length} so far). ` +
        `Body: ${body.slice(0, 300)}`,
      );
      // Re-throw on auth errors so runSync's Slack alerter fires (otherwise
      // the sync silently returns 0 rows forever).
      if (res.status === 401 || res.status === 403) {
        throw new Error(`GHL contacts ${res.status}: ${body.slice(0, 300)}`);
      }
      break;
    }
    const json = (await res.json()) as GHLContactsResponse;
    const contacts = json.contacts ?? [];
    if (contacts.length === 0) break;
    all.push(...contacts);

    startAfterId = json.meta?.startAfterId;
    startAfter = json.meta?.startAfter;
    if (!startAfterId) break;

    if (page > 0 && page % 5 === 0) {
      await new Promise(r => setTimeout(r, 1000));
    }
  }
  return all;
}

// ---------------------------------------------------------------------------
// Live GHL contact search — used by bookings sync to resolve contacts that
// aren't yet in t01_leads (e.g. created between bulk syncs, or email-drifted
// between Calendly and GHL). Hits POST /contacts/search (v2).
// ---------------------------------------------------------------------------

interface GHLSearchFilter {
  field: string;
  operator: 'eq' | 'contains' | 'starts_with' | 'ends_with';
  value: string;
}

/** Single search call against GHL v2 /contacts/search. Returns matching contacts. */
async function searchContactsRaw(
  token: string,
  locationId: string,
  filters: GHLSearchFilter[],
  limit = 10,
): Promise<GHLContact[]> {
  try {
    const { base, viaProxy, extraHeaders } = ghlBase();
    const headers: Record<string, string> = viaProxy
      ? { Accept: 'application/json', 'Content-Type': 'application/json', ...extraHeaders }
      : {
          Authorization: `Bearer ${token}`,
          Version: VERSION,
          Accept: 'application/json',
          'Content-Type': 'application/json',
        };
    const res = await fetch(`${base}/contacts/search`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ locationId, pageLimit: limit, filters }),
    });
    if (!res.ok) {
      console.warn(`[ghl] searchContactsRaw HTTP ${res.status}`);
      return [];
    }
    const json = await res.json();
    return (json.contacts ?? []) as GHLContact[];
  } catch (e) {
    console.warn('[ghl] searchContactsRaw threw:', e);
    return [];
  }
}

/** Digits-only phone for searching (GHL stores +E.164 but matches on digits). */
function phoneDigits(phone: string): string {
  return phone.replace(/[^\d]/g, '');
}

/**
 * Tiered live search in GHL: phone → email → name.
 * Returns the first matching raw GHL contact, or null.
 * Use this when the local t01_leads index misses — before creating a stub.
 */
export async function tieredSearchGHLContact(
  token: string,
  locationId: string,
  lookup: { phone?: string | null; email?: string | null; name?: string | null },
): Promise<GHLContact | null> {
  // Tier 1: phone (most reliable across email drift / name variants)
  if (lookup.phone) {
    const digits = phoneDigits(lookup.phone);
    if (digits.length >= 7) {
      // Search by trailing 10 digits to normalize across country-code variants.
      const tail = digits.slice(-10);
      const res = await searchContactsRaw(token, locationId, [
        { field: 'phone', operator: 'contains', value: tail },
      ]);
      if (res.length > 0) {
        // Prefer exact digits match, then any result.
        const exact = res.find(c => phoneDigits(c.phone ?? '').endsWith(tail));
        return exact ?? res[0];
      }
    }
  }

  // Tier 2: email (exact)
  if (lookup.email) {
    const em = lookup.email.toLowerCase().trim();
    if (em.includes('@')) {
      const res = await searchContactsRaw(token, locationId, [
        { field: 'email', operator: 'eq', value: em },
      ]);
      if (res.length > 0) return res[0];
    }
  }

  // Tier 3: name (contactName contains). Only if we have a plausible name.
  if (lookup.name) {
    const nm = lookup.name.trim();
    if (nm.length >= 3) {
      const res = await searchContactsRaw(token, locationId, [
        { field: 'contactName', operator: 'contains', value: nm },
      ]);
      if (res.length > 0) return res[0];
    }
  }

  return null;
}

/**
 * Map a raw GHL contact into a row suitable for upserting into Supabase t01_leads.
 * Returns null if the contact fails the junk filter.
 */
export function mapGHLContactToLeadRow(contact: GHLContact, locationId: string) {
  if (isJunkLead(contact)) return null;

  let campaignName = cf(contact, CF.campaignName);
  let adSetName = cf(contact, CF.adSetName);
  let adName = cf(contact, CF.adName);
  const campaignIdRaw = cf(contact, CF.campaignId) || '';

  // Fallback: parse native `source` field when custom fields are empty.
  // Many leads that opted in via Typeform/funnel paths have the full
  // attribution encoded in `source` (e.g. "fb / SR | AI Impl | STATICS V2").
  if (!campaignName || !adSetName || !adName) {
    const parsed = parseAttributionFromSource(contact.source);
    if (!campaignName) campaignName = parsed.campaignName ?? '';
    if (!adSetName)    adSetName    = parsed.adSetName ?? '';
    if (!adName)       adName       = parsed.adName ?? '';
  }

  const channel = sourceFromContact(contact, campaignName, adSetName, adName, campaignIdRaw);
  const offer = offerFromContact(contact, campaignName);
  const appAnswers = parseQualificationText(contact);

  if (channel === 'Instagram' || channel === 'LinkedIn') {
    campaignName = 'Booked with DM Setter';
    adSetName = 'Booked with DM Setter';
    adName = 'Booked with DM Setter';
  }

  // Canonicalize YouTube attribution: slug → (campaign=video, adset=title, ad=slug)
  const reformatted = reformatYouTubeAttribution(channel, campaignName, adSetName, adName);
  campaignName = reformatted.campaignName;
  adSetName = reformatted.adSetName;
  adName = reformatted.adName;

  const fullName =
    contact.contactName ||
    [contact.firstName, contact.lastName].filter(Boolean).join(' ').trim() ||
    contact.email ||
    'Unknown';

  const dateAdded = (contact.dateAdded ?? '').slice(0, 10) || new Date().toISOString().slice(0, 10);

  const campaignId = campaignIdRaw || null;
  const adSetId    = cf(contact, CF.adSetId)    || null;
  const adId       = cf(contact, CF.adId)       || null;

  return {
    id: contact.id,
    date: dateAdded,
    name: fullName,
    email: (contact.email ?? '').toLowerCase().trim(),
    phone: contact.phone ?? null,
    source: channel,
    campaign_name: campaignName || null,
    ad_set_name: adSetName || null,
    ad_name: adName || null,
    campaign_id: campaignId,
    ad_set_id: adSetId,
    ad_id: adId,
    contact_link: `https://app.gohighlevel.com/v2/location/${locationId}/contacts/detail/${contact.id}`,
    offer: offer || null,
    app_answers: appAnswers || null,
    updated_at: new Date().toISOString(),
  };
}

export async function fetchGHLLeads(
  token: string,
  locationId: string,
): Promise<Lead[]> {
  try {
    const contacts = await fetchContacts(token, locationId);

    const realContacts = contacts.filter(c => !isJunkLead(c));
    const dropped = contacts.length - realContacts.length;
    if (dropped > 0) {
      console.log(`[ghl] filtered ${dropped} junk leads out of ${contacts.length}`);
    }

    const dedupedContacts = deduplicateContacts(realContacts);

    const mapped: Lead[] = [];
    for (const c of dedupedContacts) {
      // Skip contacts before April 1 cutoff
      const dateAdded = (c.dateAdded ?? '').slice(0, 10);
      if (dateAdded < DATE_CUTOFF) continue;

      let campaignName = cf(c, CF.campaignName);
      let adSetName    = cf(c, CF.adSetName);
      let adName       = cf(c, CF.adName);
      const campaignIdRaw = cf(c, CF.campaignId) || '';

      // Fallback: parse native `source` field when custom fields are empty.
      // e.g. "fb / SR | AI Implementation Audit | STATICS V2" → campaign/adset/ad
      if (!campaignName || !adSetName || !adName) {
        const parsed = parseAttributionFromSource(c.source);
        if (!campaignName) campaignName = parsed.campaignName ?? '';
        if (!adSetName)    adSetName    = parsed.adSetName ?? '';
        if (!adName)       adName       = parsed.adName ?? '';
      }

      const channel      = sourceFromContact(c, campaignName, adSetName, adName, campaignIdRaw);
      const offer        = offerFromContact(c, campaignName);
      const appAnswers   = parseQualificationText(c);

      // Rule 3: Instagram/LinkedIn leads always come via DM setter
      if (channel === 'Instagram' || channel === 'LinkedIn') {
        campaignName = 'Booked with DM Setter';
        adSetName = 'Booked with DM Setter';
        adName = 'Booked with DM Setter';
      }

      const fullName = c.contactName
        || [c.firstName, c.lastName].filter(Boolean).join(' ').trim()
        || c.email
        || 'Unknown';

      const campaignId = campaignIdRaw || undefined;
      const adSetId    = cf(c, CF.adSetId)    || undefined;
      const adId       = cf(c, CF.adId)       || undefined;

      mapped.push({
        id: c.id,
        date: dateAdded,
        name: fullName,
        email: c.email ?? '',
        phone: c.phone ?? '',
        appAnswers,
        campaignName,
        adSetName,
        adName,
        campaignId,
        adSetId,
        adId,
        source: channel,
        contactLink: `https://app.gohighlevel.com/v2/location/${locationId}/contacts/detail/${c.id}`,
        offer,
      });
    }

    console.log(`[ghl] mapped ${mapped.length} leads (${dedupedContacts.length} deduped, ${contacts.length} total)`);
    return mapped;
  } catch (e) {
    console.error('[ghl] fetchGHLLeads threw:', e);
    // Re-throw auth errors so runSync's error alerter fires and the operator gets
    // Slack-notified with the exact reason. Swallow only truly transient
    // non-auth errors (network blips) to avoid spamming on fleeting issues.
    const msg = (e as { message?: string })?.message ?? String(e);
    if (/\b(401|403|unauthorized|forbidden|invalid.*token|auth)/i.test(msg)) {
      throw e;
    }
    return [];
  }
}

// ---------------------------------------------------------------------------
// GHL Conversations API (Pillar 6.5) — kept for AI chat
// ---------------------------------------------------------------------------

export interface GHLMessage {
  direction: 'inbound' | 'outbound';
  body: string;
  timestamp: string;
  type: string;
  from?: string;
  to?: string;
}

interface GHLRawMessage {
  id?: string;
  direction?: string;
  body?: string;
  dateAdded?: string;
  messageType?: string;
  from?: string;
  to?: string;
  source?: string;
}

interface GHLConversationSearchResult {
  conversations?: Array<{ id: string; contactId?: string }>;
}

interface GHLMessagesResult {
  messages?: {
    messages?: GHLRawMessage[];
    lastMessageId?: string;
    nextPage?: boolean;
  };
}

export async function fetchGHLConversations(
  token: string,
  locationId: string,
  contactId: string,
  maxMessages = 50,
): Promise<GHLMessage[]> {
  const searchUrl = `${V2}/conversations/search?contactId=${encodeURIComponent(contactId)}&locationId=${encodeURIComponent(locationId)}&limit=5`;
  const searchRes = await fetch(searchUrl, {
    headers: { Authorization: `Bearer ${token}`, Version: VERSION },
    next: { revalidate: 300 },
  });
  if (!searchRes.ok) {
    console.error(`[ghl] conversations search HTTP ${searchRes.status}`);
    return [];
  }
  const searchData = (await searchRes.json()) as GHLConversationSearchResult;
  const convos = searchData.conversations ?? [];
  if (convos.length === 0) return [];

  const allMessages: GHLMessage[] = [];
  for (const convo of convos) {
    const msgUrl = `${V2}/conversations/${convo.id}/messages?limit=${Math.min(maxMessages, 50)}`;
    const msgRes = await fetch(msgUrl, {
      headers: { Authorization: `Bearer ${token}`, Version: VERSION },
      next: { revalidate: 300 },
    });
    if (!msgRes.ok) continue;
    const msgData = (await msgRes.json()) as GHLMessagesResult;
    const rawMsgs = msgData.messages?.messages ?? [];
    for (const m of rawMsgs) {
      if (!m.body) continue;
      allMessages.push({
        direction: m.direction === 'inbound' ? 'inbound' : 'outbound',
        body: m.body,
        timestamp: m.dateAdded ?? '',
        type: m.messageType ?? 'unknown',
        from: m.from,
        to: m.to,
      });
    }
  }

  allMessages.sort((a, b) => a.timestamp.localeCompare(b.timestamp));
  return allMessages;
}

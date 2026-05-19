import type { Lead } from "@/lib/types";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ManyChatLead {
  id: string;
  name: string;
  igUsername: string;
  profilePic: string;
  email: string;
  stage: string;
  optinKeyword: string;
  setter: string;
  subscribedAt: string;
  lastInteraction: string;
  lastMessage: string;
  chatLink: string;
  triggerSource: string;
  adsType: string;
  // GHL cross-reference
  ghlLeadId: string;
  demoBooked: boolean;
  demoDate: string;
  showStatus: string;
  callOutcome: string;
  closer: string;
  cashCollected: number;
  contractedRevenue: number;
  qualityScore: number;
}

export interface ManyChatTag {
  id: number;
  name: string;
}

export interface KeywordPerformance {
  keyword: string;
  leads: number;
  capped: boolean; // true if API returned exactly 100 (actual count may be higher)
  booked: number;
  showed: number;
  won: number;
  cash: number;
  dealRev: number;
  lastLeadDate: string; // most recent subscriber date
}

export interface LeadStatusEntry {
  status: string;
  count: number;
}

export interface ManyChatSummary {
  leads: ManyChatLead[];
  keywords: KeywordPerformance[];
  stages: LeadStatusEntry[];
  overview: {
    totalLeads: number;
    booked: number;
    showed: number;
    won: number;
    cash: number;
    dealRev: number;
    bookRate: number;
    showRate: number;
    closeRate: number;
    cashPerCall: number;
  };
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const BASE_URL = "https://api.manychat.com/fb";

// Custom field IDs from ManyChat
const FIELD_OPTIN_KEYWORD = 13812336;
// const FIELD_STATUS = 13812299;
// const FIELD_SETTER = 13812516;
// const FIELD_ASSET_DATE = 13812298;
// const FIELD_IG_CHAT_LINK = 13812337;

// Only keywords that have confirmed subscribers in ManyChat.
// Verified 2026-04-11. Add new keywords here when new CTA triggers are created.
const KEYWORDS = [
  "SCALE", "COURSE", "JOURNEY", "HERMES", "AUDIT", "SYSTEM",
  "SECURE", "AI", "SLACK", "AUTO", "FUNNEL", "BIZ",
  "PROFIT", "1M", "CLAUDE", "CLAWD", "HIRE", "AGENCY",
];

const TAG_STAGE_PRIORITY: [string, string][] = [
  ["💰 DM CLOSE", "DM Close"],
  ["🟢 Call Booked", "Call Booked"],
  ["🔵 BOOKING LINK SENT", "Booking Link Sent"],
  ["🟣 ProgB Booking Link", "Booking Link Sent"],
  ["🟠 ProgA Booking Link", "Booking Link Sent"],
  ["📩 Opt-In Link Sent", "Opt-In Link Sent"],
  ["🟪 Call Pitched", "Call Pitched"],
  ["🌚 NEEDS FOLLOW UP", "Needs Follow Up"],
  ["1️⃣ Follow Up", "Follow Up"],
  ["🔥 New Lead", "New Lead"],
  ["👻 Ghosted", "Ghosted"],
  ["🪙 Low ticket", "Low Ticket"],
  ["🗑️ Unrelated", "Unrelated"],
  ["❌ Bad Leads", "Bad Leads"],
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function headers(apiKey: string): HeadersInit {
  return {
    Authorization: `Bearer ${apiKey}`,
    Accept: "application/json",
  };
}

function getCustomField(
  customFields: { name: string; value: unknown }[] | undefined,
  fieldName: string,
): string {
  if (!customFields) return "";
  const field = customFields.find(
    (f) => f.name.toLowerCase() === fieldName.toLowerCase(),
  );
  return field?.value != null ? String(field.value) : "";
}

function deriveStage(tags: { name: string }[]): string {
  const tagNames = new Set(tags.map((t) => t.name));
  for (const [tagName, stage] of TAG_STAGE_PRIORITY) {
    if (tagNames.has(tagName)) return stage;
  }
  return "New Lead";
}

async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ---------------------------------------------------------------------------
// API: Fetch subscribers by keyword (OptinKeyword custom field)
// ---------------------------------------------------------------------------

interface RawSubscriber {
  id: string | number;
  name: string;
  ig_username: string;
  profile_pic: string;
  email: string | null;
  subscribed: string;
  last_interaction: string | null;
  ig_last_interaction: string | null;
  last_input_text: string | null;
  custom_fields: { name: string; value: unknown }[];
  tags: { name: string }[];
}

async function fetchSubscribersByKeyword(
  apiKey: string,
  keyword: string,
): Promise<RawSubscriber[]> {
  const url = `${BASE_URL}/subscriber/findByCustomField?field_id=${FIELD_OPTIN_KEYWORD}&field_value=${encodeURIComponent(keyword)}`;
  const res = await fetch(url, { headers: headers(apiKey) });
  if (!res.ok) {
    console.error(`[ManyChat] findByCustomField failed for ${keyword}: ${res.status}`);
    return [];
  }
  const json = await res.json();
  return (json.data ?? []) as RawSubscriber[];
}

// ---------------------------------------------------------------------------
// Main: Fetch all ManyChat DM leads + cross-reference with GHL
// ---------------------------------------------------------------------------

export async function fetchAllManyChatLeads(
  apiKey: string,
  ghlLeads: Lead[],
): Promise<ManyChatSummary> {
  // 1. Fetch subscribers for each keyword (rate-limit friendly: 4 at a time)
  const allSubscribers = new Map<string, RawSubscriber>();

  for (let i = 0; i < KEYWORDS.length; i += 4) {
    const batch = KEYWORDS.slice(i, i + 4);
    const results = await Promise.all(
      batch.map((kw) => fetchSubscribersByKeyword(apiKey, kw)),
    );
    for (const subs of results) {
      for (const sub of subs) {
        allSubscribers.set(String(sub.id), sub);
      }
    }
    if (i + 4 < KEYWORDS.length) {
      await sleep(300); // rate limit courtesy
    }
  }

  console.log(`[ManyChat] Fetched ${allSubscribers.size} unique subscribers across ${KEYWORDS.length} keywords`);

  // 2. Build GHL lookup maps for cross-referencing
  const ghlByEmail = new Map<string, Lead>();
  const ghlByName = new Map<string, Lead>();
  const ghlByFirstName = new Map<string, Lead[]>();
  for (const lead of ghlLeads) {
    if (lead.email) ghlByEmail.set(lead.email.toLowerCase(), lead);
    if (lead.name) {
      const normalized = lead.name.toLowerCase().trim();
      ghlByName.set(normalized, lead);
      // Also index by first name for fuzzy matching
      const firstName = normalized.split(/\s+/)[0];
      if (firstName.length > 2) {
        const existing = ghlByFirstName.get(firstName) ?? [];
        existing.push(lead);
        ghlByFirstName.set(firstName, existing);
      }
    }
  }

  // 3. Convert to ManyChatLead with GHL enrichment
  const leads: ManyChatLead[] = [];

  for (const sub of allSubscribers.values()) {
    const cf = sub.custom_fields;
    const keyword = getCustomField(cf, "OptinKeyword").toUpperCase();
    const setter = getCustomField(cf, "Setter");
    const chatLink = getCustomField(cf, "IgChatLink");
    const triggerSource = getCustomField(cf, "trigger source");
    const adsType = getCustomField(cf, "ads type");

    // Cross-reference with GHL: email first, then full name, then first name
    const email = sub.email?.toLowerCase() ?? "";
    const nameNorm = (sub.name ?? "").toLowerCase().trim();
    const firstName = nameNorm.split(/\s+/)[0];
    let ghlLead = (email && ghlByEmail.get(email)) || ghlByName.get(nameNorm) || null;
    // Fuzzy: match by first name if unique (only 1 GHL lead with that first name)
    if (!ghlLead && firstName.length > 2) {
      const candidates = ghlByFirstName.get(firstName);
      if (candidates?.length === 1) ghlLead = candidates[0];
    }

    leads.push({
      id: String(sub.id),
      name: sub.name ?? "",
      igUsername: sub.ig_username ?? "",
      profilePic: sub.profile_pic ?? "",
      email: sub.email ?? "",
      stage: deriveStage(sub.tags ?? []),
      optinKeyword: keyword,
      setter: setter || "James", // Default setter
      subscribedAt: sub.subscribed ?? "",
      lastInteraction: sub.ig_last_interaction ?? sub.last_interaction ?? "",
      lastMessage: sub.last_input_text ?? "",
      chatLink,
      triggerSource,
      adsType,
      // GHL cross-reference
      ghlLeadId: ghlLead?.id ?? "",
      demoBooked: ghlLead?.demoBooked ?? false,
      demoDate: ghlLead?.demoDate ?? "",
      showStatus: ghlLead?.showStatus ?? "",
      callOutcome: ghlLead?.callOutcome ?? "",
      closer: ghlLead?.assignedCloser ?? "",
      cashCollected: Number(ghlLead?.cashCollected) || 0,
      contractedRevenue: Number(ghlLead?.contractedRevenue) || 0,
      qualityScore: Number(ghlLead?.qualityScore) || 0,
    });
  }

  // 4. Build analytics
  const keywords = buildKeywordPerformance(leads);
  const stages = buildLeadStatusBreakdown(leads);
  const overview = buildOverview(leads);

  return { leads, keywords, stages, overview };
}

// ---------------------------------------------------------------------------
// Legacy: enrichLeadsWithManyChat (kept for backward compat)
// ---------------------------------------------------------------------------

export async function enrichLeadsWithManyChat(
  leads: Lead[],
  apiKey: string,
): Promise<ManyChatLead[]> {
  const result = await fetchAllManyChatLeads(apiKey, leads);
  return result.leads;
}

// ---------------------------------------------------------------------------
// Analytics builders
// ---------------------------------------------------------------------------

export function buildKeywordPerformance(
  mcLeads: ManyChatLead[],
): KeywordPerformance[] {
  const map = new Map<string, KeywordPerformance>();

  for (const lead of mcLeads) {
    const keyword = lead.optinKeyword || "(none)";
    let entry = map.get(keyword);
    if (!entry) {
      entry = { keyword, leads: 0, capped: false, booked: 0, showed: 0, won: 0, cash: 0, dealRev: 0, lastLeadDate: "" };
      map.set(keyword, entry);
    }
    entry.leads += 1;
    if (lead.demoBooked) entry.booked += 1;
    if (lead.showStatus?.toLowerCase() === "showed") entry.showed += 1;
    if (lead.callOutcome?.toLowerCase() === "won" || lead.cashCollected > 1) entry.won += 1;
    entry.cash += lead.cashCollected;
    entry.dealRev += lead.contractedRevenue;
    // Track most recent subscriber date
    if (lead.subscribedAt && lead.subscribedAt > entry.lastLeadDate) {
      entry.lastLeadDate = lead.subscribedAt;
    }
  }

  // Mark keywords that hit the 100-cap
  for (const entry of map.values()) {
    if (entry.leads >= 100) entry.capped = true;
  }

  return Array.from(map.values()).sort((a, b) => b.leads - a.leads);
}

export function buildLeadStatusBreakdown(
  mcLeads: ManyChatLead[],
): LeadStatusEntry[] {
  const map = new Map<string, number>();

  for (const lead of mcLeads) {
    const status = lead.stage || "Unknown";
    map.set(status, (map.get(status) ?? 0) + 1);
  }

  return Array.from(map.entries())
    .map(([status, count]) => ({ status, count }))
    .sort((a, b) => b.count - a.count);
}

function buildOverview(mcLeads: ManyChatLead[]) {
  let booked = 0, showed = 0, won = 0, cash = 0, dealRev = 0;
  for (const lead of mcLeads) {
    if (lead.demoBooked) booked++;
    if (lead.showStatus?.toLowerCase() === "showed") showed++;
    if (lead.callOutcome?.toLowerCase() === "won" || lead.cashCollected > 1) won++;
    cash += lead.cashCollected;
    dealRev += lead.contractedRevenue;
  }
  const totalLeads = mcLeads.length;
  return {
    totalLeads,
    booked,
    showed,
    won,
    cash,
    dealRev,
    bookRate: totalLeads > 0 ? (booked / totalLeads) * 100 : 0,
    showRate: booked > 0 ? (showed / booked) * 100 : 0,
    closeRate: showed > 0 ? (won / showed) * 100 : 0,
    cashPerCall: showed > 0 ? cash / showed : 0,
  };
}

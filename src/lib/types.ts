export type Channel = 'YouTube' | 'Instagram' | 'LinkedIn' | 'X' | 'Facebook Ads' | 'Referral' | 'Unknown' | 'Webinar' | 'Organic';
export type Program = 'Program A' | 'Program B' | 'Program C';
export type Offer = 'ProgB' | 'ProgA' | 'Program C';

// Legacy types — still used by other tables (t03_bookings, t06_deals_closed, etc.)
export type LeadStage = 'New Lead' | 'Long Term Nurture' | 'Qualified' | 'Closed Won' | 'Closed Lost' | 'Refunded';
export type ShowStatus = 'Showed' | 'No Show' | 'Cancelled' | 'Rescheduled';
export type CallOutcome = 'Closed Won' | 'Follow Up Booked' | 'Not Qualified' | 'No Decision' | 'Closed Lost';

export interface Lead {
  id: string;
  date: string;
  name: string;
  email: string;
  phone: string;
  appAnswers: string | null;
  campaignName: string;
  adSetName: string;
  adName: string;
  campaignId?: string;
  adSetId?: string;
  adId?: string;
  source: Channel;
  contactLink: string | null;
  offer: Offer | null;

  // --- DEPRECATED: removed from t01_leads, kept for UI backward compat ---
  // These fields now live in other tables (t03_bookings, t06_deals_closed, etc.)
  // They will always be undefined from the leads sync. Remove as UI components
  // are updated table-by-table.
  program?: Program;
  adAccountName?: string;
  stage?: LeadStage;
  demoBooked?: boolean;
  demoDate?: string | null;
  showStatus?: ShowStatus | null;
  callOutcome?: CallOutcome | null;
  assignedCloser?: string;
  qualityScore?: number;
  qualityScoreSummary?: string | null;
  qualityRedFlags?: string[];
  qualityGreenFlags?: string[];
  cashCollected?: number;
  contractedRevenue?: number;
  callRecordingUrl?: string | null;
  ghlContactId?: string;
  ghlContactUrl?: string;
  grainRecordingId?: string | null;
  campaignHint?: string;
  meetingUrl?: string | null;
  callType?: string | null;
  assignedSetter?: string | null;
  followUpType?: string | null;
  followUpDate?: string | null;
  outcomeLoggedAt?: string | null;
  qualification?: {
    businessType?: string;
    monthlyRevenue?: string;
    coreBusiness?: string;
    biggestStruggle?: string;
    currentIncome?: string;
    investmentCapacity?: string;
    teamSize?: string;
    monthlyPayroll?: string;
    triedAiBefore?: string;
    biggestBottlenecks?: string;
    speedToImplement?: string;
  };
  calendlyEventName?: string | null;
  calendlyEventUrl?: string | null;
  calendlyStatus?: 'active' | 'canceled' | null;
  grainRecordingUrl?: string | null;
  grainCallSummary?: string | null;
  grainCallType?: 'sales' | 'setter' | 'fulfillment' | 'internal' | 'unknown' | null;
  grainDurationMin?: number | null;
  grainTranscriptUrl?: string | null;
  grainIntelligenceNotes?: string | null;
  grainOwnerEmail?: string | null;
  slackNewClientDate?: string;
  paymentFailed?: boolean;
  paymentFailedReason?: string;
  paymentFailedAmount?: number;
  paymentFailedDate?: string;
  sheetVerified?: boolean;
}

export interface Ad {
  id: string;
  date?: string;              // YYYY-MM-DD when time_increment=1
  adAccountName: string;
  campaignName: string;
  adSetName: string;
  adName: string;
  campaignId?: string;
  adSetId?: string;
  adId?: string;
  channel: Channel;
  spend: number;
  impressions: number;
  clicks: number;
  leads: number;
  scheduledCalls: number;
  qualifiedCalls: number;
  purchases: number;
  revenue: number;
  active: boolean;
  thumbnailUrl?: string;
  // Meta-reported CPL fields (distinct from GHL-sourced `leads`)
  costPerLead?: number;
  metaLeads?: number;
  costPerResult?: number;
  actions?: Array<{ action_type: string; value: string }>;
  actionValues?: Array<{ action_type: string; value: string }>;
}

export interface Closer {
  id: string;
  name: string;
  totalCalls: number;
  closedDeals: number;
  revenue: number;
  organicCalls: number;
  organicClosed: number;
  organicRevenue: number;
  paidCalls: number;
  paidClosed: number;
  paidRevenue: number;
}

export interface DailyMetrics {
  date: string;
  spend: number;
  leads: number;
  callsBooked: number;
  callsShown: number;
  callsClosed: number;
  revenue: number;
}

export interface KPITarget {
  label: string;
  key: string;
  target: number;
  format: 'currency' | 'percentage' | 'multiplier' | 'number';
  direction: 'lower' | 'higher'; // lower = below target is good (costs), higher = above target is good (rates)
  alertThreshold: number; // % deviation from target that triggers alert
}

export type DrillDownType = 'cpc' | 'cpqc' | 'roas' | 'closeRate' | 'showRate' | 'revenue' | 'leads' | 'spend' | null;

export interface ContentPost {
  id: string;
  channel: Channel;
  type: 'reel' | 'carousel' | 'static' | 'video' | 'short' | 'post' | 'article';
  title: string;
  date: string;
  // Engagement metrics
  views: number;
  reach: number;
  follows: number;
  engagementRate: number;
  likes: number;
  comments: number;
  shares: number;
  saves: number;
  // DM trigger (for Instagram, LinkedIn, X)
  dmTrigger: string | null; // e.g. "DM 'SCALE'"
  dmReplies: number;
  // Downstream funnel impact
  leads: number;
  booked: number;
  showed: number;
  closed: number;
  cashCollected: number;
  contractedRevenue: number;
}

export interface YouTubeVideo {
  id: string;
  title: string;
  date: string;
  views: number;
  likes: number;
  comments: number;
  subscribers: number; // gained from this video
  watchTimeHours: number;
  avgViewDuration: string; // e.g. "4:32"
  ctr: number; // click-through rate %
  deepLinkClicks?: number; // from Trakyo deep link tracking
  description?: string; // video description (for deeplink extraction)
  // Downstream funnel
  leads: number;
  booked: number;
  showed: number;
  closed: number;
  cashCollected: number;
  contractedRevenue: number;
  source: 'video' | 'bio'; // whether lead came from video link or channel bio
  // Display fields (populated from YouTube API or placeholder)
  thumbnailUrl?: string;
  duration?: string; // e.g. "17:49"
  visibility?: 'public' | 'unlisted' | 'private';
  isLive?: boolean;
}

// Back-end business types
export interface Client {
  id: string;
  name: string;
  email: string;
  program: Program;
  startDate: string;
  contractValue: number;
  monthlyValue: number;
  assignedCSM: string;
  status: 'active' | 'churned' | 'paused';
  // AR tracking
  projectedAR: number;
  arCollected: number;
  // Upsell tracking
  wasUpsold: boolean;
  upsellDate: string | null;
  upsellCash: number;
  upsellContractedRev: number;
  // Mastermind
  mastermindClosed: boolean;
  mastermindCash: number;
  // Referrals
  referralsMade: number;
  referralCashCollected: number;
  // Refund
  wasRefunded: boolean;
  refundAmount: number;
  refundDate: string | null;
  offboardedDate: string | null;
}

export interface CSMStats {
  name: string;
  totalClients: number;
  activeClients: number;
  pitchesMade: number;
  upsellsClosed: number;
  upsellCash: number;
  renewalRate: number;
  offboarded: number;
  refunds: number;
  refundAmount: number;
  arProjected: number;
  arCollected: number;
  collectionsRate: number;
  mastermindTickets: number;
  mastermindCash: number;
  referrals: number;
  referralCash: number;
}

export interface Expense {
  id: string;
  date: string;
  category: 'overhead' | 'labor' | 'marketing' | 'sales_labor' | 'fulfillment' | 'ops' | 'ai_team' | 'csm_team' | 'program_coaches';
  description: string;
  amount: number;
  recurring: boolean;
}

export interface PnLSummary {
  totalNewCash: number;
  totalRevenue: number;
  overheadExpenses: number;
  laborExpenses: number;
  marketingExpenses: number;
  totalExpenses: number;
  totalProfit: number;
  profitMargin: number;
}

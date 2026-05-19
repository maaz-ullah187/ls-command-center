import { Lead, Ad, Channel, Program, DailyMetrics, ContentPost, YouTubeVideo, Client, CSMStats, Expense, PnLSummary } from './types';

// Seeded PRNG for consistent SSR/client hydration
let _seed = 42;
function seededRandom(): number {
  _seed = (_seed * 16807 + 0) % 2147483647;
  return (_seed - 1) / 2147483646;
}
function randomBetween(min: number, max: number): number {
  return Math.floor(seededRandom() * (max - min + 1)) + min;
}
function randomFloat(min: number, max: number): number {
  return seededRandom() * (max - min) + min;
}
function pickRandom<T>(arr: T[]): T {
  return arr[Math.floor(seededRandom() * arr.length)];
}

// Placeholder team roster — used only by the mock-data fallback. Once your
// Supabase tables have real data, dataSources.ts skips this. Keep these
// names aligned with src/lib/commission-config.ts so the Closers card
// initializes with the same identities.
export const CLOSERS = ['Closer One', 'Closer Two', 'Closer Three'];
export const SETTERS = ['Setter One'];
const CALL_TYPES_LS = ['Qualification Call — ProgB', 'Strategy Call — ProgB', 'Sales Call — ProgB'];
const CALL_TYPES_LL = ['AI Integration Intro Call', 'Call-AI ROI Audit', 'Strategy Call — ProgA'];
const FOLLOW_UP_TYPES = ['Qualification Call', 'Sales Call', 'Technical Review', 'Contract Review'];
const PROGRAMS: Program[] = ['Program A', 'Program B', 'Program C'];

// Paid structure: Ad Account > Campaign > Ad Set > Ad
export const PAID_STRUCTURE = [
  {
    adAccount: 'Program B LLC - Agency Ad Account',
    campaigns: [
      {
        campaign: 'YOUR_COMPANY Cbo All Ads',
        adSets: [
          { adSet: 'Acquisition | ProgB | 19th July 2025', ads: ['DCT | Acquisition | 19th July', 'DCT | Systems & Ops For Agencies | 16.08.25', 'Raw Miro Hook1 | 30th July'] },
          { adSet: 'Tracking | ProgB | 19th July 2025', ads: ['DCT | Tracking | 19th July', 'Whiteboard | Tracking Systems'] },
        ],
      },
      {
        campaign: 'YOUR_COMPANY | CBO | 12.11 | Call Funnel',
        adSets: [
          { adSet: 'Retarget | Website Visitors 30d', ads: ['CBO - AD 3', 'Direct to camera - ad 6 - retarget audience'] },
          { adSet: 'Lookalike | Purchasers 1%', ads: ['10,000 ai websites for contractors - podcast', 'Sniper ads - whiteboard 3'] },
        ],
      },
    ],
  },
  {
    adAccount: 'Program B LLC - Agency Ad Account',
    campaigns: [
      {
        campaign: 'YOUR_COMPANY-ABO-12.16.2025',
        adSets: [
          { adSet: 'the operator | DiverseB2BA', ads: ['Sniper ads - whiteboard 1', '12. sniper ads - red sweater white hat - hook 5 body 5'] },
          { adSet: 'Interest Targeting | Acquisition', ads: ['Matei 7 - help contractors get', 'Agency Growth Hook - Direct'] },
        ],
      },
    ],
  },
];

const ORGANIC_SOURCES: { channel: Channel; campaigns: string[] }[] = [
  { channel: 'YouTube', campaigns: ['youtube_channel_bio', 'youtube', 'systemsto2myear'] },
  { channel: 'Instagram', campaigns: ['instagram Organic', 'ig_dm', 'Main_bio_link'] },
  { channel: 'LinkedIn', campaigns: ['linkedin_organic', 'linkedin_dm'] },
  { channel: 'X', campaigns: ['x_organic', 'x_dm'] },
  { channel: 'Webinar', campaigns: ['webinar_registration', 'webinar_replay'] },
];

const REFERRAL_SOURCES = ['referral_client_john', 'referral_client_sarah', 'referral_client_mike', 'referral_partner_agency', 'referral_client_david'];
const UNKNOWN_SOURCES = ['direct', 'unknown', 'untagged', 'no_utm'];

const FIRST_NAMES = ['Alejo', 'Ameerah', 'Mostafa', 'Jobe', 'Esteban', 'Sam', 'Mirko', 'Stephen', 'Reda', 'Filipe', 'Nityam', 'Mario', 'Buster', 'Aissa', 'Marc', 'Greg', 'Travis', 'Steve', 'Bonnie', 'Kenneth', 'Joe', 'Val', 'Mike', 'Michael', 'Allan', 'Preston', 'Andres', 'Maciej', 'Io', 'Zaak', 'Darko', 'Robert', 'Ola', 'Matteo', 'Alan', 'Chris', 'Ryan', 'Jake', 'Tom', 'Lucas'];
const LAST_NAMES = ['Kreder', 'Mahdani', 'Dabour', 'Bellingham', 'Obregon', 'Paaske', 'Mascia', 'Ellul', 'Haris', 'Palma', 'Nagar', 'Popeftimov', 'Bonchev', 'Bizgane', 'Forstner', 'Danz', 'Dickey', 'Morrison', 'Sumrill', 'Ricketts', 'Shupe', 'Veamatahau', 'Cummings', 'Wheeler', 'Lopez', 'Carter', 'Bohorquez', 'Fidor', 'Vitalie', 'Spiteri', 'Bubalo', 'Mihai', 'Olajide', 'Milone', 'Baker', 'Wong', 'Park', 'Harris', 'Nelson', 'Cruz'];

function generateDate(daysAgo: number): string {
  const ref = new Date('2026-04-06T12:00:00Z');
  ref.setDate(ref.getDate() - daysAgo);
  return ref.toISOString().split('T')[0];
}

function generateLeads(count: number): Lead[] {
  const leads: Lead[] = [];
  for (let i = 0; i < count; i++) {
    const isPaid = seededRandom() > 0.35;
    const sourceRoll = seededRandom();
    const daysAgo = randomBetween(0, 59);
    const demoBooked = seededRandom() > 0.15;
    const showed = demoBooked && seededRandom() > 0.28;
    // Referrals close at a higher rate
    const isReferral = !isPaid && sourceRoll < 0.12;
    const closeThreshold = isReferral ? 0.40 : 0.65;
    const closed = showed && seededRandom() > closeThreshold;
    const program = pickRandom(PROGRAMS);
    const firstName = pickRandom(FIRST_NAMES);
    const lastName = pickRandom(LAST_NAMES);
    const closer = pickRandom(CLOSERS);

    let source: Channel, campaignName: string, adSetName: string, adName: string, adAccountName = '';
    if (isPaid) {
      source = 'Facebook Ads';
      const acct = pickRandom(PAID_STRUCTURE);
      const camp = pickRandom(acct.campaigns);
      const adSet = pickRandom(camp.adSets);
      adAccountName = acct.adAccount;
      campaignName = camp.campaign;
      adSetName = adSet.adSet;
      adName = pickRandom(adSet.ads);
    } else if (sourceRoll < 0.12) {
      // ~12% of non-paid leads are Referral (good close rate)
      source = 'Referral';
      campaignName = pickRandom(REFERRAL_SOURCES);
      adSetName = '';
      adName = '';
    } else if (sourceRoll < 0.18) {
      // ~6% of non-paid leads are Unknown
      source = 'Unknown';
      campaignName = pickRandom(UNKNOWN_SOURCES);
      adSetName = '';
      adName = '';
    } else {
      const org = pickRandom(ORGANIC_SOURCES);
      source = org.channel;
      campaignName = pickRandom(org.campaigns);
      adSetName = '';
      adName = '';
    }

    const cashCollected = closed ? pickRandom([297, 1141, 1341, 1391, 1541, 2997, 4997]) : 0;
    const contractedRevenue = closed ? Math.round(cashCollected * randomFloat(1.5, 3.0)) : 0;

    // Closer workspace fields
    const callTypePool = program === 'Program B' ? CALL_TYPES_LS : CALL_TYPES_LL;
    const callType = demoBooked ? pickRandom(callTypePool) : null;
    const setter = demoBooked && source !== 'Referral' ? pickRandom(SETTERS) : null;
    const zoomId = randomBetween(1000000000, 9999999999);
    const zoomPwd = Math.floor(seededRandom() * 1e12).toString(36).substring(0, 8);
    const meetingUrl = demoBooked ? `https://us06web.zoom.us/j/${zoomId}?pwd=${zoomPwd}` : null;
    // Set outcomeLoggedAt if there is any status or outcome
    const hasAnyOutcome = (showed && closed) || (demoBooked && !showed);
    const outcomeLoggedAt = hasAnyOutcome
      ? new Date(Date.now() - randomBetween(60, 172800) * 1000).toISOString()
      : null;
    const hasFollowUp = showed && !closed && seededRandom() > 0.7;
    const followUpType = hasFollowUp ? pickRandom(FOLLOW_UP_TYPES) : null;
    const followUpDate = hasFollowUp
      ? generateDate(-randomBetween(1, 14)) // future date
      : null;

    leads.push({
      id: `lead-${i + 1}`,
      date: generateDate(daysAgo),
      name: `${firstName} ${lastName}`,
      email: `${firstName.toLowerCase()}.${lastName.toLowerCase()}@gmail.com`,
      phone: `+1${randomBetween(200, 999)}${randomBetween(1000000, 9999999)}`,
      source,
      program,
      campaignName,
      adSetName,
      adName,
      adAccountName,
      stage: closed ? 'Closed Won' : showed ? (seededRandom() > 0.5 ? 'Qualified' : 'Closed Lost') : demoBooked ? 'New Lead' : 'Long Term Nurture',
      demoBooked,
      demoDate: demoBooked ? generateDate(daysAgo - randomBetween(1, 5)) : null,
      showStatus: !demoBooked ? null : showed ? 'Showed' : (seededRandom() > 0.5 ? 'No Show' : 'Cancelled'),
      callOutcome: !showed ? null : closed ? 'Closed Won' : pickRandom(['Follow Up Booked', 'Not Qualified', 'No Decision', 'Closed Lost']),
      assignedCloser: demoBooked ? closer : '',
      qualityScore: randomBetween(1, 10),
      cashCollected,
      contractedRevenue,
      callRecordingUrl: showed ? `https://fathom.video/share/${i.toString(36)}${daysAgo.toString(36)}` : null,
      ghlContactId: `ghl_${(i + 1).toString(36)}${randomBetween(1000, 9999)}`,
      grainRecordingId: closed ? `grain_rec_${(i + 1).toString(36)}${randomBetween(100, 999)}` : null,
      meetingUrl,
      callType,
      assignedSetter: setter,
      followUpType,
      followUpDate,
      outcomeLoggedAt,
    });
  }
  return leads;
}

function generateAds(leads: Lead[]): Ad[] {
  const adMap = new Map<string, Ad>();
  const paidLeads = leads.filter(l => l.source === 'Facebook Ads');

  for (const acct of PAID_STRUCTURE) {
    for (const camp of acct.campaigns) {
      for (const adSet of camp.adSets) {
        for (const ad of adSet.ads) {
          const adLeads = paidLeads.filter(l => l.adName === ad);
          const scheduled = adLeads.filter(l => l.demoBooked).length;
          const qualified = adLeads.filter(l => l.showStatus === 'Showed').length;
          const purchases = adLeads.filter(l => l.callOutcome === 'Closed Won').length;
          const revenue = adLeads.filter(l => l.callOutcome === 'Closed Won').reduce((sum, l) => sum + l.cashCollected, 0);
          const spend = Math.max(adLeads.length, 1) * randomFloat(50, 110);

          adMap.set(ad, {
            id: `ad-${ad.replace(/\s/g, '-').toLowerCase().slice(0, 20)}`,
            adAccountName: acct.adAccount,
            campaignName: camp.campaign,
            adSetName: adSet.adSet,
            adName: ad,
            channel: 'Facebook Ads',
            spend: Math.round(spend * 100) / 100,
            impressions: Math.max(adLeads.length, 1) * randomBetween(80, 200),
            clicks: Math.max(adLeads.length, 1) * randomBetween(3, 8),
            leads: adLeads.length,
            scheduledCalls: scheduled,
            qualifiedCalls: qualified,
            purchases,
            revenue,
            active: seededRandom() > 0.15,
          });
        }
      }
    }
  }
  return Array.from(adMap.values());
}

function generateDailyMetrics(leads: Lead[], ads: Ad[]): DailyMetrics[] {
  const metrics: DailyMetrics[] = [];
  const totalSpend = ads.reduce((s, a) => s + a.spend, 0);

  for (let i = 59; i >= 0; i--) {
    const date = generateDate(i);
    const dayLeads = leads.filter(l => l.date === date);
    const daySpend = (totalSpend / 60) * randomFloat(0.6, 1.4);
    metrics.push({
      date,
      spend: Math.round(daySpend * 100) / 100,
      leads: dayLeads.length,
      callsBooked: dayLeads.filter(l => l.demoBooked).length,
      callsShown: dayLeads.filter(l => l.showStatus === 'Showed').length,
      callsClosed: dayLeads.filter(l => l.callOutcome === 'Closed Won').length,
      revenue: dayLeads.filter(l => l.callOutcome === 'Closed Won').reduce((sum, l) => sum + l.cashCollected, 0),
    });
  }
  return metrics;
}

// Reset seed and generate (deterministic)
_seed = 42;
export const mockLeads = generateLeads(250);
export const mockAds = generateAds(mockLeads);
export const mockDailyMetrics = generateDailyMetrics(mockLeads, mockAds);

// YouTube video titles (realistic)
const YT_TITLES = [
  'How I Built a $2M Agency in 18 Months',
  'The Systems That Run My Business (Full Breakdown)',
  'Why Most Agency Owners Stay Broke',
  'I Tracked Every Lead For 90 Days - Heres What Happened',
  'The Offer That Changed Everything',
  'Stop Running Ads Until You Watch This',
  'How To Close High Ticket Clients (Live Call)',
  'My Exact Funnel That Books 40 Calls/Month',
  'The Truth About Scaling Past $50k/mo',
  'Agency Owner Daily Routine (Behind The Scenes)',
  'How To Build Systems That Scale',
  'Client Acquisition Masterclass (Free Training)',
  'Why Your Ads Dont Work (And How To Fix Them)',
  'I Gave My Team Full Access To My Numbers',
  'The $100k/mo Agency Blueprint',
];

const IG_CAPTIONS = [
  'The jump from 50k to 100k a month isnt about finding a new secret. Its about execution.',
  'Stop overthinking your offer. Start testing it.',
  'Most agency owners dont have a lead gen problem. They have a systems problem.',
  'Heres why your sales calls arent converting...',
  'I used to work 80 hours a week. Now I work 25. Heres what changed.',
  'The real reason youre stuck at $30k/mo',
  'Your team cant scale what you havent systemized',
  'DM me SCALE if you want the free training',
  'This one change added $40k/mo to our revenue',
  'Agency owners: stop doing fulfillment yourself',
  'The fastest path from $10k to $50k months',
  'Watch this before you hire your next closer',
];

const LI_TITLES = [
  'I analyzed 500 B2B agency funnels. Here are the patterns that separate 6-fig from 7-fig agencies.',
  'Most agencies are over-spending on ads and under-investing in systems.',
  'Unpopular opinion: You dont need more leads. You need better conversion systems.',
  'After helping 200+ agencies scale, here is what I know for sure...',
  'The single biggest mistake agency owners make when scaling past $50k/mo',
  'Why I stopped cold outreach and focused on inbound',
  'Your close rate is a systems problem, not a sales problem',
  'The hidden cost of not tracking your numbers properly',
];

const X_TITLES = [
  'Hot take: Most agency owners would 2x their revenue by fixing their tracking alone.',
  'If youre not tracking cost per qualified call, youre flying blind.',
  'Spent $50k on ads last month. Heres exactly what we got back.',
  'The difference between a $20k/mo and $200k/mo agency is systems.',
  'Stop blaming your ads. Your funnel is the problem.',
  'Just had a $12k cash collected day. Thread on what were doing differently.',
  'Agency scaling tip: track everything, fix what matters.',
  'Your sales team is only as good as the leads you send them.',
];

const DM_TRIGGERS = ['SCALE', 'SYSTEMS', 'FUNNEL', 'TRAINING', 'GROW', 'BLUEPRINT'];

function generateYouTubeVideos(): YouTubeVideo[] {
  const videos: YouTubeVideo[] = [];
  const ytLeads = mockLeads.filter(l => l.source === 'YouTube');

  for (let i = 0; i < YT_TITLES.length; i++) {
    const daysAgo = randomBetween(2, 55);
    const views = randomBetween(800, 45000);
    const videoLeads = ytLeads.filter((_, idx) => idx % YT_TITLES.length === i);
    const booked = videoLeads.filter(l => l.demoBooked).length;
    const showed = videoLeads.filter(l => l.showStatus === 'Showed').length;
    const closed = videoLeads.filter(l => l.callOutcome === 'Closed Won').length;
    const cash = videoLeads.filter(l => l.callOutcome === 'Closed Won').reduce((s, l) => s + l.cashCollected, 0);
    const contracted = videoLeads.filter(l => l.callOutcome === 'Closed Won').reduce((s, l) => s + l.contractedRevenue, 0);

    videos.push({
      id: `yt-${i + 1}`,
      title: YT_TITLES[i],
      date: generateDate(daysAgo),
      views,
      likes: Math.round(views * randomFloat(0.03, 0.08)),
      comments: Math.round(views * randomFloat(0.005, 0.02)),
      subscribers: randomBetween(5, 120),
      watchTimeHours: Math.round(views * randomFloat(0.02, 0.06)),
      avgViewDuration: `${randomBetween(2, 8)}:${randomBetween(10, 59)}`,
      ctr: parseFloat(randomFloat(3, 12).toFixed(1)),
      leads: videoLeads.length,
      booked,
      showed,
      closed,
      cashCollected: cash,
      contractedRevenue: contracted,
      source: 'video',
      duration: `${randomBetween(3, 72)}:${randomBetween(0, 59).toString().padStart(2, '0')}`,
      visibility: 'public',
      isLive: i === 5,
    });
  }

  // Add bio aggregate entry
  const bioLeads = ytLeads.filter(l => l.campaignName === 'youtube_channel_bio');
  videos.push({
    id: 'yt-bio',
    title: 'Channel Bio Link',
    date: generateDate(0),
    views: 0,
    likes: 0,
    comments: 0,
    subscribers: 0,
    watchTimeHours: 0,
    avgViewDuration: '-',
    ctr: 0,
    leads: bioLeads.length,
    booked: bioLeads.filter(l => l.demoBooked).length,
    showed: bioLeads.filter(l => l.showStatus === 'Showed').length,
    closed: bioLeads.filter(l => l.callOutcome === 'Closed Won').length,
    cashCollected: bioLeads.filter(l => l.callOutcome === 'Closed Won').reduce((s, l) => s + l.cashCollected, 0),
    contractedRevenue: bioLeads.filter(l => l.callOutcome === 'Closed Won').reduce((s, l) => s + l.contractedRevenue, 0),
    source: 'bio',
  });

  return videos.sort((a, b) => b.cashCollected - a.cashCollected);
}

function generateContentPosts(channel: Channel, titles: string[], types: ContentPost['type'][]): ContentPost[] {
  const posts: ContentPost[] = [];
  const channelLeads = mockLeads.filter(l => l.source === channel);

  for (let i = 0; i < titles.length; i++) {
    const daysAgo = randomBetween(1, 50);
    const views = randomBetween(500, 50000);
    const reach = Math.round(views * randomFloat(1.0, 1.5));
    const postLeads = channelLeads.filter((_, idx) => idx % titles.length === i);
    const booked = postLeads.filter(l => l.demoBooked).length;
    const showed = postLeads.filter(l => l.showStatus === 'Showed').length;
    const closed = postLeads.filter(l => l.callOutcome === 'Closed Won').length;
    const cash = postLeads.filter(l => l.callOutcome === 'Closed Won').reduce((s, l) => s + l.cashCollected, 0);
    const contracted = postLeads.filter(l => l.callOutcome === 'Closed Won').reduce((s, l) => s + l.contractedRevenue, 0);
    const hasDM = seededRandom() > 0.4;

    posts.push({
      id: `${channel.toLowerCase()}-post-${i + 1}`,
      channel,
      type: pickRandom(types),
      title: titles[i],
      date: generateDate(daysAgo),
      views,
      reach,
      follows: randomBetween(0, 150),
      engagementRate: parseFloat(randomFloat(1.5, 9.0).toFixed(2)),
      likes: Math.round(views * randomFloat(0.02, 0.08)),
      comments: Math.round(views * randomFloat(0.003, 0.015)),
      shares: Math.round(views * randomFloat(0.005, 0.02)),
      saves: Math.round(views * randomFloat(0.005, 0.025)),
      dmTrigger: hasDM ? `DM "${pickRandom(DM_TRIGGERS)}"` : null,
      dmReplies: hasDM ? randomBetween(5, 120) : 0,
      leads: postLeads.length,
      booked,
      showed,
      closed,
      cashCollected: cash,
      contractedRevenue: contracted,
    });
  }

  return posts.sort((a, b) => b.date.localeCompare(a.date));
}

export const mockYouTubeVideos = generateYouTubeVideos();
export const mockInstagramPosts = generateContentPosts('Instagram', IG_CAPTIONS, ['reel', 'carousel', 'static']);
export const mockLinkedInPosts = generateContentPosts('LinkedIn', LI_TITLES, ['post', 'article']);
export const mockXPosts = generateContentPosts('X', X_TITLES, ['post', 'short']);

// CSM names
export const CSM_NAMES = ['Sarah Chen', 'Marcus Williams', 'Elena Rodriguez', 'David Kim'];

function generateClients(): Client[] {
  const clients: Client[] = [];
  const closedLeads = mockLeads.filter(l => l.callOutcome === 'Closed Won');

  for (let i = 0; i < closedLeads.length; i++) {
    const lead = closedLeads[i];
    const monthlyValue = lead.contractedRevenue > 0 ? Math.round(lead.contractedRevenue / randomBetween(3, 12)) : 0;
    const monthsActive = randomBetween(1, 8);
    const projectedAR = monthlyValue * monthsActive;
    const collectionRate = randomFloat(0.6, 1.1);
    const arCollected = Math.round(projectedAR * Math.min(collectionRate, 1));
    const wasUpsold = seededRandom() > 0.7;
    const wasRefunded = seededRandom() > 0.9;
    const churned = wasRefunded || seededRandom() > 0.85;

    clients.push({
      id: `client-${i + 1}`,
      name: lead.name,
      email: lead.email,
      program: lead.program,
      startDate: lead.date,
      contractValue: lead.contractedRevenue,
      monthlyValue,
      assignedCSM: pickRandom(CSM_NAMES),
      status: churned ? 'churned' : (seededRandom() > 0.95 ? 'paused' : 'active'),
      projectedAR: projectedAR,
      arCollected: arCollected,
      wasUpsold,
      upsellDate: wasUpsold ? generateDate(randomBetween(0, 30)) : null,
      upsellCash: wasUpsold ? pickRandom([997, 1997, 2997, 4997, 7500]) : 0,
      upsellContractedRev: wasUpsold ? pickRandom([2997, 5994, 8991, 14985, 22500]) : 0,
      mastermindClosed: seededRandom() > 0.85,
      mastermindCash: seededRandom() > 0.85 ? pickRandom([2000, 5000, 10000]) : 0,
      referralsMade: randomBetween(0, 3),
      referralCashCollected: seededRandom() > 0.75 ? pickRandom([500, 800, 1000, 3000]) : 0,
      wasRefunded,
      refundAmount: wasRefunded ? pickRandom([997, 1997, 2997]) : 0,
      refundDate: wasRefunded ? generateDate(randomBetween(0, 20)) : null,
      offboardedDate: churned ? generateDate(randomBetween(0, 25)) : null,
    });
  }
  return clients;
}

function generateExpenses(): Expense[] {
  const expenses: Expense[] = [];

  const categoryItems: { category: Expense['category']; items: { desc: string; amount: number }[] }[] = [
    {
      category: 'marketing',
      items: [
        { desc: 'Paid Ads (Call Funnel + Webinar)', amount: 100000 },
        { desc: 'Referral Fees', amount: 5000 },
        { desc: 'External Media Buyer (15% Net)', amount: 1800 },
        { desc: 'Fractional CFO (CleverProfits)', amount: 1800 },
      ],
    },
    {
      category: 'sales_labor',
      items: [
        { desc: 'Team Member (6.25% cash)', amount: 15000 },
        { desc: 'Closing team (3x)', amount: 30000 },
        { desc: 'Setting Team (2x)', amount: 6000 },
        { desc: 'DM setting team (2x)', amount: 4000 },
      ],
    },
    {
      category: 'fulfillment',
      items: [
        { desc: 'Birdhouse LI + X Agency', amount: 7500 },
        { desc: 'IG + YT Content Agency (Watmedia)', amount: 10000 },
        { desc: 'Content Studio', amount: 2000 },
      ],
    },
    {
      category: 'ops',
      items: [
        { desc: 'Founder Two - AI Specialist (ReplyRocket)', amount: 8000 },
        { desc: 'Kevin - Ops Support', amount: 1000 },
      ],
    },
    {
      category: 'ai_team',
      items: [
        { desc: 'Dev 1', amount: 1500 },
        { desc: 'Dev 2', amount: 1500 },
      ],
    },
    {
      category: 'csm_team',
      items: [
        { desc: 'ProgB AM - Alex', amount: 4000 },
        { desc: 'External CSM Agency', amount: 7500 },
        { desc: 'Client Success Commissions', amount: 600 },
      ],
    },
    {
      category: 'overhead',
      items: [
        { desc: 'VPS (Hostinger)', amount: 73.99 },
        { desc: 'Whatsapp billing SMS', amount: 250 },
        { desc: 'Bitly', amount: 35 },
        { desc: 'Hyros', amount: 299 },
        { desc: 'Appointwise', amount: 297 },
        { desc: 'OpenAI', amount: 145.08 },
        { desc: 'Manus AI', amount: 40 },
        { desc: 'Delphi Studio', amount: 498 },
        { desc: 'Riverside', amount: 29.22 },
        { desc: 'Grain', amount: 507 },
        { desc: 'AI Tools (3x Claude)', amount: 600 },
        { desc: 'Meta Verified Badge', amount: 21.19 },
        { desc: 'Elective', amount: 199 },
        { desc: 'Accounting (Business)', amount: 500 },
      ],
    },
    {
      category: 'program_coaches',
      items: [
        { desc: 'Coach 1 - Paid Ads ($300/call)', amount: 1200 },
        { desc: 'Coach 2 - Call Center ($100/call)', amount: 400 },
        { desc: 'Coach 3 - Sales Leadership ($500/call)', amount: 2000 },
        { desc: 'Coach 4 - Program A ($100/call)', amount: 2000 },
        { desc: 'Coach 5 - Sales Program A ($100/call)', amount: 400 },
        { desc: 'Coach 6 - Accountability calls', amount: 400 },
        { desc: 'Coach 7 - Service Delivery Calls', amount: 1400 },
      ],
    },
  ];

  let idx = 0;
  for (const group of categoryItems) {
    for (const item of group.items) {
      expenses.push({
        id: `exp-${++idx}`,
        date: generateDate(0),
        category: group.category,
        description: item.desc,
        amount: item.amount,
        recurring: true,
      });
    }
  }
  return expenses;
}

export const mockClients = generateClients();
export const mockExpenses = generateExpenses();

export function getCSMStats(clients: Client[]): CSMStats[] {
  const csmMap = new Map<string, CSMStats>();

  for (const csm of CSM_NAMES) {
    csmMap.set(csm, {
      name: csm,
      totalClients: 0,
      activeClients: 0,
      pitchesMade: 0,
      upsellsClosed: 0,
      upsellCash: 0,
      renewalRate: 0,
      offboarded: 0,
      refunds: 0,
      refundAmount: 0,
      arProjected: 0,
      arCollected: 0,
      collectionsRate: 0,
      mastermindTickets: 0,
      mastermindCash: 0,
      referrals: 0,
      referralCash: 0,
    });
  }

  for (const client of clients) {
    const stats = csmMap.get(client.assignedCSM);
    if (!stats) continue;

    stats.totalClients++;
    if (client.status === 'active') stats.activeClients++;
    if (client.offboardedDate) stats.offboarded++;
    if (client.wasRefunded) { stats.refunds++; stats.refundAmount += client.refundAmount; }
    if (client.wasUpsold || client.mastermindClosed) stats.pitchesMade++;
    if (client.wasUpsold) { stats.upsellsClosed++; stats.upsellCash += client.upsellCash; }
    if (client.mastermindClosed) { stats.mastermindTickets++; stats.mastermindCash += client.mastermindCash; }
    stats.referrals += client.referralsMade;
    stats.referralCash += client.referralCashCollected;
    stats.arProjected += client.projectedAR;
    stats.arCollected += client.arCollected;
  }

  for (const stats of csmMap.values()) {
    stats.renewalRate = stats.totalClients > 0 ? ((stats.totalClients - stats.offboarded) / stats.totalClients) * 100 : 0;
    stats.collectionsRate = stats.arProjected > 0 ? (stats.arCollected / stats.arProjected) * 100 : 0;
  }

  return Array.from(csmMap.values());
}

export function getPnLSummary(clients: Client[], expenses: Expense[], frontEndCash: number): PnLSummary {
  const backEndCash = clients.reduce((s, c) => s + c.upsellCash + c.mastermindCash + c.referralCashCollected, 0);
  const totalNewCash = frontEndCash + backEndCash;
  const arCollected = clients.reduce((s, c) => s + c.arCollected, 0);
  const totalRevenue = totalNewCash + arCollected;
  const refunds = clients.reduce((s, c) => s + c.refundAmount, 0);

  const overhead = expenses.filter(e => e.category === 'overhead').reduce((s, e) => s + e.amount, 0);
  const laborCategories: Expense['category'][] = ['labor', 'sales_labor', 'fulfillment', 'ops', 'ai_team', 'csm_team', 'program_coaches'];
  const labor = expenses.filter(e => laborCategories.includes(e.category)).reduce((s, e) => s + e.amount, 0);
  const marketing = expenses.filter(e => e.category === 'marketing').reduce((s, e) => s + e.amount, 0);
  const totalExpenses = overhead + labor + marketing + refunds;
  const totalProfit = totalRevenue - totalExpenses;

  return {
    totalNewCash,
    totalRevenue,
    overheadExpenses: overhead,
    laborExpenses: labor,
    marketingExpenses: marketing,
    totalExpenses,
    totalProfit,
    profitMargin: totalRevenue > 0 ? (totalProfit / totalRevenue) * 100 : 0,
  };
}

export function getCloserStats(leads: Lead[]) {
  const closerMap = new Map<string, {
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
  }>();

  for (const closer of CLOSERS) {
    closerMap.set(closer, {
      name: closer,
      totalCalls: 0, closedDeals: 0, revenue: 0,
      organicCalls: 0, organicClosed: 0, organicRevenue: 0,
      paidCalls: 0, paidClosed: 0, paidRevenue: 0,
    });
  }

  for (const lead of leads) {
    if (!lead.assignedCloser || lead.showStatus !== 'Showed') continue;
    const stats = closerMap.get(lead.assignedCloser);
    if (!stats) continue;

    stats.totalCalls++;
    const isPaid = lead.source === 'Facebook Ads';
    if (isPaid) stats.paidCalls++;
    else stats.organicCalls++;

    if (lead.callOutcome === 'Closed Won') {
      stats.closedDeals++;
      stats.revenue += lead.cashCollected;
      if (isPaid) { stats.paidClosed++; stats.paidRevenue += lead.cashCollected; }
      else { stats.organicClosed++; stats.organicRevenue += lead.cashCollected; }
    }
  }

  return Array.from(closerMap.values()).filter(c => c.totalCalls > 0);
}

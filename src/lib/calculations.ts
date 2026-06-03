import { Lead, Ad, DailyMetrics, Channel } from './types';

export interface AggregatedMetrics {
  totalSpend: number;
  totalRevenue: number;
  totalLeads: number;
  callsBooked: number;
  callsShown: number;
  callsClosed: number;
  callsCancelled: number;
  callsRescheduled: number;
  cancellationRate: number;
  cpc: number;
  cpl: number;
  costPerSchedule: number;
  cpqc: number;
  costPerPurchase: number;
  roas: number;
  closeRate: number;
  showRate: number;
  dollarPerCall: number;
}

export function aggregateMetrics(
  leads: Lead[],
  ads: Ad[],
  dailyMetrics: DailyMetrics[],
  /**
   * Optional newCash for ROAS computation. When provided, ROAS is calculated
   * as `newCash / totalSpend` instead of the previous Closed-Won-revenue
   * heuristic. Source should be the dashboard's revenue-buckets newCash so
   * ROAS reconciles with the headline new-cash number.
   */
  newCash?: number,
): AggregatedMetrics {
  const totalSpend = ads.reduce((s, a) => s + a.spend, 0);
  const totalClicks = ads.reduce((s, a) => s + a.clicks, 0);
  const totalLeads = leads.length;
  // CPL should be derived from Meta-reported leads (the ad-platform metric),
  // not the CRM lead count which may not yet be synced for the active date range.
  // Fall back to CRM leads if Meta reports none (e.g. organic-only filter).
  const adReportedLeads = ads.reduce(
    (s, a) => s + (a.metaLeads ?? a.leads ?? 0),
    0
  );
  const cplDenominator = adReportedLeads > 0 ? adReportedLeads : totalLeads;
  const today = new Date().toISOString().slice(0, 10);
  const callsBooked = leads.filter(l => l.demoBooked).length;
  const callsShown = leads.filter(l => l.showStatus === 'Showed').length;
  // Count as closed: callOutcome === 'Closed Won' OR stage === 'Closed Won' OR cashCollected > 0
  // Whop enrichment sets stage but not callOutcome, so we need both checks
  // Exclude $0/$1 test transactions from sales counts (e.g. Timothy Sebolt $1)
  const isClosedWon = (l: Lead) => l.callOutcome === 'Closed Won' || l.stage === 'Closed Won' || l.cashCollected > 1;
  const callsClosed = leads.filter(isClosedWon).length;
  const callsCancelled = leads.filter(l => l.showStatus === 'Cancelled').length;
  const callsRescheduled = leads.filter(l => l.showStatus === 'Rescheduled').length;
  const totalRevenue = leads.filter(isClosedWon).reduce((s, l) => s + l.cashCollected, 0);

  // ROAS should only count revenue from Paid-source leads.
  // When the channel filter is already "Facebook Ads", all leads are paid so paidRevenue == totalRevenue.
  // When the channel filter is "All", we must isolate Paid-source leads' revenue.
  const paidRevenue = leads.filter(l => l.source === 'Facebook Ads' && isClosedWon(l)).reduce((s, l) => s + l.cashCollected, 0);

  // Show rate: exclude cancelled, rescheduled, and future calls from denominator
  // Only past/today calls that weren't cancelled or rescheduled should count
  const pastBookedCalls = leads.filter(l =>
    l.demoBooked &&
    l.showStatus !== 'Cancelled' &&
    l.showStatus !== 'Rescheduled' &&
    (l.demoDate ? l.demoDate <= today : true) // no date = assume past
  ).length;

  return {
    totalSpend,
    totalRevenue,
    totalLeads,
    callsBooked,
    callsShown,
    callsClosed,
    callsCancelled,
    callsRescheduled,
    cancellationRate: callsBooked > 0 ? ((callsCancelled + callsRescheduled) / callsBooked) * 100 : 0,
    cpc: totalClicks > 0 ? totalSpend / totalClicks : 0,
    cpl: cplDenominator > 0 ? totalSpend / cplDenominator : 0,
    costPerSchedule: callsBooked > 0 ? totalSpend / callsBooked : 0,
    cpqc: callsShown > 0 ? totalSpend / callsShown : 0,
    costPerPurchase: callsClosed > 0 ? totalSpend / callsClosed : 0,
    // ROAS = newCash / totalSpend when newCash is passed in (sourced from
    // revenue-buckets so it reconciles with the headline number). Falls back
    // to the legacy Closed-Won-paidRevenue calc when newCash is not provided,
    // so older callers don't regress.
    roas: totalSpend > 0
      ? (newCash !== undefined ? newCash / totalSpend : paidRevenue / totalSpend)
      : 0,
    closeRate: callsShown > 0 ? (callsClosed / callsShown) * 100 : 0,
    showRate: pastBookedCalls > 0 ? (callsShown / pastBookedCalls) * 100 : 0,
    dollarPerCall: callsShown > 0 ? totalRevenue / callsShown : 0,
  };
}

export function filterLeadsByChannel(leads: Lead[], channel: Channel | 'All'): Lead[] {
  if (channel === 'All') return leads;
  if (channel === 'Organic') return leads.filter(l => l.source !== 'Facebook Ads');
  return leads.filter(l => l.source === channel);
}

export function filterAdsByChannel(ads: Ad[], channel: Channel | 'All'): Ad[] {
  if (channel === 'All') return ads;
  return ads.filter(a => a.channel === channel);
}

export function filterByDateRange(leads: Lead[], start: string, end: string): Lead[] {
  return leads.filter(l => l.date >= start && l.date <= end);
}

export function filterByProgram(leads: Lead[], program: string): Lead[] {
  if (program === 'All') return leads;
  return leads.filter(l => l.program === program);
}

export function getPercentChange(current: number, previous: number): number {
  if (previous === 0) return current > 0 ? 100 : 0;
  return ((current - previous) / previous) * 100;
}

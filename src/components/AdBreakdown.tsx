'use client';

import { Ad, Lead } from '@/lib/types';
import { isWithinKPI } from '@/lib/kpi-config';
import { ChevronDown, ChevronRight, Eye } from 'lucide-react';
import { useState } from 'react';

interface AdBreakdownProps {
  ads: Ad[];
  leads: Lead[];
  onViewLeads: (adName: string) => void;
}

interface CampaignGroup {
  campaign: string;
  adSets: {
    adSet: string;
    ads: Ad[];
  }[];
  totals: {
    spend: number;
    leads: number;
    scheduled: number;
    qualified: number;
    purchases: number;
    revenue: number;
  };
}

export default function AdBreakdown({ ads, leads, onViewLeads }: AdBreakdownProps) {
  const [expandedCampaigns, setExpandedCampaigns] = useState<Set<string>>(new Set());
  const [expandedAdSets, setExpandedAdSets] = useState<Set<string>>(new Set());
  const [sortKey, setSortKey] = useState<string>('spend');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');

  // Group ads by campaign > adSet
  const campaignGroups: CampaignGroup[] = [];
  const campaignMap = new Map<string, Map<string, Ad[]>>();

  for (const ad of ads) {
    if (!campaignMap.has(ad.campaignName)) campaignMap.set(ad.campaignName, new Map());
    const adSetMap = campaignMap.get(ad.campaignName)!;
    if (!adSetMap.has(ad.adSetName)) adSetMap.set(ad.adSetName, []);
    adSetMap.get(ad.adSetName)!.push(ad);
  }

  for (const [campaign, adSetMap] of campaignMap) {
    const adSets = Array.from(adSetMap.entries()).map(([adSet, ads]) => ({ adSet, ads }));
    const allAds = adSets.flatMap(as => as.ads);
    campaignGroups.push({
      campaign,
      adSets,
      totals: {
        spend: allAds.reduce((s, a) => s + a.spend, 0),
        leads: allAds.reduce((s, a) => s + a.leads, 0),
        scheduled: allAds.reduce((s, a) => s + a.scheduledCalls, 0),
        qualified: allAds.reduce((s, a) => s + a.qualifiedCalls, 0),
        purchases: allAds.reduce((s, a) => s + a.purchases, 0),
        revenue: allAds.reduce((s, a) => s + a.revenue, 0),
      },
    });
  }

  const toggleCampaign = (name: string) => {
    setExpandedCampaigns(prev => {
      const next = new Set(prev);
      next.has(name) ? next.delete(name) : next.add(name);
      return next;
    });
  };

  const toggleAdSet = (name: string) => {
    setExpandedAdSets(prev => {
      const next = new Set(prev);
      next.has(name) ? next.delete(name) : next.add(name);
      return next;
    });
  };

  const cpl = (spend: number, leads: number) => leads > 0 ? spend / leads : 0;
  const cps = (spend: number, scheduled: number) => scheduled > 0 ? spend / scheduled : 0;
  const cpp = (spend: number, purchases: number) => purchases > 0 ? spend / purchases : 0;
  const roas = (revenue: number, spend: number) => spend > 0 ? revenue / spend : 0;

  const cell = (val: number, format: 'currency' | 'multiplier' | 'number', kpiKey?: string) => {
    const bad = kpiKey ? !isWithinKPI(kpiKey, val) : false;
    let formatted: string;
    if (format === 'currency') formatted = `$${val.toFixed(2)}`;
    else if (format === 'multiplier') formatted = `${val.toFixed(2)}x`;
    else formatted = val.toString();
    return <span className={bad ? 'text-red-600 font-semibold' : ''}>{formatted}</span>;
  };

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-gray-200 text-xs text-gray-500 uppercase">
            <th className="text-left py-3 px-2 w-8"></th>
            <th className="text-left py-3 px-2">Campaign / Ad Set / Ad</th>
            <th className="text-right py-3 px-2">Spend</th>
            <th className="text-right py-3 px-2">Leads</th>
            <th className="text-right py-3 px-2">CPL</th>
            <th className="text-right py-3 px-2">Scheduled</th>
            <th className="text-right py-3 px-2">CPS</th>
            <th className="text-right py-3 px-2">Purchases</th>
            <th className="text-right py-3 px-2">CPP</th>
            <th className="text-right py-3 px-2">Revenue</th>
            <th className="text-right py-3 px-2">ROAS</th>
            <th className="text-center py-3 px-2">Leads</th>
          </tr>
        </thead>
        <tbody>
          {campaignGroups.map(cg => (
            <>
              <tr
                key={cg.campaign}
                className="border-b border-gray-100 bg-gray-50 hover:bg-gray-100 cursor-pointer"
                onClick={() => toggleCampaign(cg.campaign)}
              >
                <td className="py-2.5 px-2">
                  {expandedCampaigns.has(cg.campaign) ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                </td>
                <td className="py-2.5 px-2 font-medium text-gray-900 truncate max-w-[300px]">{cg.campaign}</td>
                <td className="text-right py-2.5 px-2 font-medium">${cg.totals.spend.toFixed(2)}</td>
                <td className="text-right py-2.5 px-2">{cg.totals.leads}</td>
                <td className="text-right py-2.5 px-2">{cell(cpl(cg.totals.spend, cg.totals.leads), 'currency', 'cpl')}</td>
                <td className="text-right py-2.5 px-2">{cg.totals.scheduled}</td>
                <td className="text-right py-2.5 px-2">{cell(cps(cg.totals.spend, cg.totals.scheduled), 'currency', 'costPerSchedule')}</td>
                <td className="text-right py-2.5 px-2">{cg.totals.purchases}</td>
                <td className="text-right py-2.5 px-2">{cell(cpp(cg.totals.spend, cg.totals.purchases), 'currency', 'costPerPurchase')}</td>
                <td className="text-right py-2.5 px-2 font-medium">${cg.totals.revenue.toLocaleString()}</td>
                <td className="text-right py-2.5 px-2">{cell(roas(cg.totals.revenue, cg.totals.spend), 'multiplier', 'roas')}</td>
                <td className="text-center py-2.5 px-2"></td>
              </tr>
              {expandedCampaigns.has(cg.campaign) && cg.adSets.map(as => (
                <>
                  <tr
                    key={`${cg.campaign}-${as.adSet}`}
                    className="border-b border-gray-50 hover:bg-blue-50/50 cursor-pointer"
                    onClick={() => toggleAdSet(`${cg.campaign}-${as.adSet}`)}
                  >
                    <td className="py-2 px-2 pl-6">
                      {expandedAdSets.has(`${cg.campaign}-${as.adSet}`) ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                    </td>
                    <td className="py-2 px-2 text-gray-700 truncate max-w-[280px] pl-4">{as.adSet}</td>
                    <td className="text-right py-2 px-2">${as.ads.reduce((s, a) => s + a.spend, 0).toFixed(2)}</td>
                    <td className="text-right py-2 px-2">{as.ads.reduce((s, a) => s + a.leads, 0)}</td>
                    <td className="text-right py-2 px-2">{cell(cpl(as.ads.reduce((s, a) => s + a.spend, 0), as.ads.reduce((s, a) => s + a.leads, 0)), 'currency', 'cpl')}</td>
                    <td className="text-right py-2 px-2">{as.ads.reduce((s, a) => s + a.scheduledCalls, 0)}</td>
                    <td className="text-right py-2 px-2">{cell(cps(as.ads.reduce((s, a) => s + a.spend, 0), as.ads.reduce((s, a) => s + a.scheduledCalls, 0)), 'currency', 'costPerSchedule')}</td>
                    <td className="text-right py-2 px-2">{as.ads.reduce((s, a) => s + a.purchases, 0)}</td>
                    <td className="text-right py-2 px-2">{cell(cpp(as.ads.reduce((s, a) => s + a.spend, 0), as.ads.reduce((s, a) => s + a.purchases, 0)), 'currency', 'costPerPurchase')}</td>
                    <td className="text-right py-2 px-2">${as.ads.reduce((s, a) => s + a.revenue, 0).toLocaleString()}</td>
                    <td className="text-right py-2 px-2">{cell(roas(as.ads.reduce((s, a) => s + a.revenue, 0), as.ads.reduce((s, a) => s + a.spend, 0)), 'multiplier', 'roas')}</td>
                    <td className="text-center py-2 px-2"></td>
                  </tr>
                  {expandedAdSets.has(`${cg.campaign}-${as.adSet}`) && as.ads.map(ad => (
                    <tr
                      key={ad.id}
                      className={`border-b border-gray-50 hover:bg-blue-50/30 ${!ad.active ? 'opacity-50' : ''}`}
                    >
                      <td className="py-2 px-2 pl-10"></td>
                      <td className="py-2 px-2 text-gray-600 truncate max-w-[260px] pl-8 flex items-center gap-2">
                        <span className={`w-2 h-2 rounded-full ${ad.active ? 'bg-emerald-400' : 'bg-gray-300'}`} />
                        {ad.adName}
                      </td>
                      <td className="text-right py-2 px-2">${ad.spend.toFixed(2)}</td>
                      <td className="text-right py-2 px-2">{ad.leads}</td>
                      <td className="text-right py-2 px-2">{cell(cpl(ad.spend, ad.leads), 'currency', 'cpl')}</td>
                      <td className="text-right py-2 px-2">{ad.scheduledCalls}</td>
                      <td className="text-right py-2 px-2">{cell(cps(ad.spend, ad.scheduledCalls), 'currency', 'costPerSchedule')}</td>
                      <td className="text-right py-2 px-2">{ad.purchases}</td>
                      <td className="text-right py-2 px-2">{cell(cpp(ad.spend, ad.purchases), 'currency', 'costPerPurchase')}</td>
                      <td className="text-right py-2 px-2">${ad.revenue.toLocaleString()}</td>
                      <td className="text-right py-2 px-2">{cell(roas(ad.revenue, ad.spend), 'multiplier', 'roas')}</td>
                      <td className="text-center py-2 px-2">
                        <button
                          onClick={(e) => { e.stopPropagation(); onViewLeads(ad.adName); }}
                          className="p-1 hover:bg-gray-200 rounded text-gray-500 hover:text-gray-700"
                          title="View leads from this ad"
                        >
                          <Eye size={14} />
                        </button>
                      </td>
                    </tr>
                  ))}
                </>
              ))}
            </>
          ))}
        </tbody>
      </table>
    </div>
  );
}

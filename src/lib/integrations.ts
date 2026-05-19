// Client-side data fetching module for all API integrations

export async function fetchGHLContacts(params?: { startDate?: string; endDate?: string; limit?: string }) {
  const searchParams = new URLSearchParams();
  if (params?.startDate) searchParams.set('startDate', params.startDate);
  if (params?.endDate) searchParams.set('endDate', params.endDate);
  if (params?.limit) searchParams.set('limit', params.limit);
  const res = await fetch(`/api/ghl/contacts?${searchParams}`);
  if (!res.ok) throw new Error('Failed to fetch contacts');
  return res.json();
}

export async function fetchGHLOpportunities(params?: { pipelineId?: string; stageId?: string; startDate?: string; endDate?: string }) {
  const searchParams = new URLSearchParams();
  if (params?.pipelineId) searchParams.set('pipelineId', params.pipelineId);
  if (params?.stageId) searchParams.set('stageId', params.stageId);
  if (params?.startDate) searchParams.set('startDate', params.startDate);
  if (params?.endDate) searchParams.set('endDate', params.endDate);
  const res = await fetch(`/api/ghl/opportunities?${searchParams}`);
  if (!res.ok) throw new Error('Failed to fetch opportunities');
  return res.json();
}

export async function fetchGHLCalendars(params?: { startDate?: string; endDate?: string }) {
  const searchParams = new URLSearchParams();
  if (params?.startDate) searchParams.set('startDate', params.startDate);
  if (params?.endDate) searchParams.set('endDate', params.endDate);
  const res = await fetch(`/api/ghl/calendars?${searchParams}`);
  if (!res.ok) throw new Error('Failed to fetch calendar appointments');
  return res.json();
}

export async function fetchYouTubeVideos() {
  const res = await fetch('/api/youtube/videos');
  if (!res.ok) throw new Error('Failed to fetch YouTube videos');
  return res.json();
}

export async function fetchInstagramMedia() {
  const res = await fetch('/api/instagram/media');
  if (!res.ok) throw new Error('Failed to fetch Instagram media');
  return res.json();
}

export async function fetchCalendlyEvents(params?: { startDate?: string; endDate?: string; status?: string }) {
  const searchParams = new URLSearchParams();
  if (params?.startDate) searchParams.set('startDate', params.startDate);
  if (params?.endDate) searchParams.set('endDate', params.endDate);
  if (params?.status) searchParams.set('status', params.status);
  const res = await fetch(`/api/calendly/events?${searchParams}`);
  if (!res.ok) throw new Error('Failed to fetch Calendly events');
  return res.json();
}

export async function fetchTypeformResponses(formId: string, params?: { since?: string; until?: string; pageSize?: string }) {
  const searchParams = new URLSearchParams({ formId });
  if (params?.since) searchParams.set('since', params.since);
  if (params?.until) searchParams.set('until', params.until);
  if (params?.pageSize) searchParams.set('pageSize', params.pageSize);
  const res = await fetch(`/api/typeform/responses?${searchParams}`);
  if (!res.ok) throw new Error('Failed to fetch Typeform responses');
  return res.json();
}

export async function fetchStripePayments(params?: { startDate?: string; endDate?: string; limit?: string }) {
  const searchParams = new URLSearchParams();
  if (params?.startDate) searchParams.set('startDate', params.startDate);
  if (params?.endDate) searchParams.set('endDate', params.endDate);
  if (params?.limit) searchParams.set('limit', params.limit);
  const res = await fetch(`/api/stripe/payments?${searchParams}`);
  if (!res.ok) throw new Error('Failed to fetch Stripe payments');
  return res.json();
}

export async function fetchGrainRecordings(params?: { limit?: string; cursor?: string }) {
  const searchParams = new URLSearchParams();
  if (params?.limit) searchParams.set('limit', params.limit);
  if (params?.cursor) searchParams.set('cursor', params.cursor);
  const res = await fetch(`/api/grain/recordings?${searchParams}`);
  if (!res.ok) throw new Error('Failed to fetch Grain recordings');
  return res.json();
}

// Integration status checker
export async function checkIntegrationStatus(): Promise<Record<string, boolean>> {
  const res = await fetch('/api/integrations/status');
  if (!res.ok) return {};
  return res.json();
}

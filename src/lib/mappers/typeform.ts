// Typeform response mapper — Pillar 3
//
// Fetches responses from your application forms and returns a
// Map<email, TypeformEnrichment> that getLeads() merges onto GHL leads.

export interface TypeformEnrichment {
  /** Which form they filled out */
  formName: string;
  formId: string;
  /** When they submitted */
  submittedAt: string;
  /** Application answers — the qualification fields the operator wants visible */
  answers: Record<string, string>;
  /** Hidden fields from the form (ad_id, campaign_id, fbclid, etc) */
  hiddenFields: Record<string, string>;
  /** Whether they booked via the embedded Calendly on the Typeform */
  bookedViaTypeform: boolean;
}

// Forms to pull responses from. Add your form IDs here as offers expand.
// Find form IDs in the Typeform URL: typeform.com/to/<formId>
const FORMS: { id: string; name: string; program: string }[] = [
  // { id: 'YOUR_FORM_ID', name: 'Program A Application', program: 'Program A' },
  // { id: 'YOUR_FORM_ID', name: 'Program B Application', program: 'Program B' },
  // { id: 'YOUR_FORM_ID', name: 'Program C Application', program: 'Program C' },
];

interface TypeformAnswer {
  type: string;
  field: { id: string; type: string; ref?: string };
  choice?: { label: string };
  choices?: { labels: string[] };
  text?: string;
  email?: string;
  phone_number?: string;
  number?: number;
  boolean?: boolean;
  date?: string;
}

interface TypeformResponse {
  response_id: string;
  submitted_at: string;
  answers: TypeformAnswer[];
  hidden?: Record<string, string>;
}

function extractEmail(resp: TypeformResponse): string | null {
  // First check answers for contact_info or email type
  for (const a of resp.answers) {
    if (a.type === 'email' && a.email) return a.email.toLowerCase().trim();
    // contact_info type may have email nested
    if (a.field.type === 'contact_info' && a.email) return a.email.toLowerCase().trim();
  }
  // Fallback: hidden fields
  if (resp.hidden?.email) return resp.hidden.email.toLowerCase().trim();
  return null;
}

function extractAnswerValue(a: TypeformAnswer): string {
  if (a.type === 'choice' && a.choice) return a.choice.label;
  if (a.type === 'choices' && a.choices) return a.choices.labels.join(', ');
  if (a.type === 'text' && a.text) return a.text;
  if (a.type === 'email' && a.email) return a.email;
  if (a.type === 'phone_number' && a.phone_number) return a.phone_number;
  if (a.type === 'number' && a.number !== undefined) return String(a.number);
  if (a.type === 'boolean' && a.boolean !== undefined) return a.boolean ? 'Yes' : 'No';
  if (a.type === 'date' && a.date) return a.date;
  return '';
}

// Human-readable field name map (field_id → nice label).
// Build this from your own forms by inspecting the Typeform editor.
const FIELD_LABELS: Record<string, string> = {
  // 'TypeformFieldId': 'Nice Label',
};

async function fetchFormResponses(
  token: string,
  formId: string,
  formName: string,
  pageSize = 100
): Promise<Map<string, TypeformEnrichment>> {
  const map = new Map<string, TypeformEnrichment>();
  let url = `https://api.typeform.com/forms/${formId}/responses?page_size=${pageSize}&sort=submitted_at,desc`;

  // Paginate up to 3 pages (300 responses per form)
  for (let page = 0; page < 3; page++) {
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` },
      next: { revalidate: 300 }, // 5 min cache
    });
    if (!res.ok) {
      console.error(`[Typeform] ${formName} (${formId}): ${res.status} ${res.statusText}`);
      break;
    }
    const data = await res.json();
    const items: TypeformResponse[] = data.items ?? [];

    for (const resp of items) {
      const email = extractEmail(resp);
      if (!email) continue;
      // Don't overwrite if we already have a more recent entry
      if (map.has(email)) continue;

      const answers: Record<string, string> = {};
      let bookedViaTypeform = false;

      for (const a of resp.answers) {
        const fid = a.field.id;
        // Calendly embed fields indicate they booked through the Typeform
        if (a.field.type === 'calendly') {
          bookedViaTypeform = true;
          continue;
        }
        const label = FIELD_LABELS[fid] || fid;
        const val = extractAnswerValue(a);
        if (val) answers[label] = val;
      }

      map.set(email, {
        formName,
        formId,
        submittedAt: resp.submitted_at,
        answers,
        hiddenFields: resp.hidden ?? {},
        bookedViaTypeform,
      });
    }

    // Check for next page
    const after = data.items?.[data.items.length - 1]?.token;
    if (!after || items.length < pageSize) break;
    url = `https://api.typeform.com/forms/${formId}/responses?page_size=${pageSize}&sort=submitted_at,desc&after=${after}`;
  }

  return map;
}

/**
 * Fetch all Typeform responses across all configured forms.
 * Returns Map<email, TypeformEnrichment> for merging into GHL leads.
 */
export async function fetchAllTypeformResponses(
  token: string
): Promise<Map<string, TypeformEnrichment>> {
  const merged = new Map<string, TypeformEnrichment>();

  // Fetch all forms in parallel
  const results = await Promise.allSettled(
    FORMS.map(f => fetchFormResponses(token, f.id, f.name))
  );

  for (const result of results) {
    if (result.status === 'fulfilled') {
      for (const [email, enrichment] of result.value) {
        // Keep the most recent submission if the same email submitted multiple forms
        if (!merged.has(email) || enrichment.submittedAt > merged.get(email)!.submittedAt) {
          merged.set(email, enrichment);
        }
      }
    }
  }

  return merged;
}

// Tiered lead matching: email → phone → normalized name.
// Used by bookings, deals, and no_shows syncs to link rows back to t01_leads.

import 'server-only';

interface LeadRow {
  id: string;
  email: string;
  phone: string | null;
  name: string;
}

export interface LeadIndex {
  byEmail: Map<string, string>;   // lowercase email → lead id
  byPhone: Map<string, string>;   // digits-only phone → lead id
  byName: Map<string, string>;    // lowercase trimmed name → lead id
}

/** Normalize phone to digits only (strip +, spaces, dashes, parens). */
function normalizePhone(phone: string): string {
  return phone.replace(/[^\d]/g, '');
}

/** Build lookup indexes from t01_leads for fast matching. */
export async function buildLeadIndex(
  sb: { from: (table: string) => any }
): Promise<LeadIndex> {
  const { data: leads } = await sb
    .from('t01_leads')
    .select('id, email, phone, name') as { data: LeadRow[] | null };

  const byEmail = new Map<string, string>();
  const byPhone = new Map<string, string>();
  const byName = new Map<string, string>();

  if (leads) {
    for (const lead of leads) {
      // Email: primary key — most reliable
      const email = (lead.email || '').toLowerCase().trim();
      if (email && !byEmail.has(email)) {
        byEmail.set(email, lead.id);
      }

      // Phone: secondary — digits only, at least 7 digits
      if (lead.phone) {
        const digits = normalizePhone(lead.phone);
        if (digits.length >= 7 && !byPhone.has(digits)) {
          byPhone.set(digits, lead.id);
        }
      }

      // Name: fallback — lowercase, trimmed, only if 3+ chars
      const name = (lead.name || '').toLowerCase().trim();
      if (name.length >= 3 && !byName.has(name)) {
        byName.set(name, lead.id);
      }
    }
  }

  return { byEmail, byPhone, byName };
}

/** Match a person to a lead using tiered strategy: email → phone → name. */
export function matchLead(
  index: LeadIndex,
  email?: string | null,
  phone?: string | null,
  name?: string | null,
): string | null {
  // Tier 1: email match
  if (email) {
    const id = index.byEmail.get(email.toLowerCase().trim());
    if (id) return id;
  }

  // Tier 2: phone match
  if (phone) {
    const digits = normalizePhone(phone);
    if (digits.length >= 7) {
      const id = index.byPhone.get(digits);
      if (id) return id;
    }
  }

  // Tier 3: normalized name match
  if (name) {
    const normalized = name.toLowerCase().trim();
    if (normalized.length >= 3) {
      const id = index.byName.get(normalized);
      if (id) return id;
    }
  }

  return null;
}

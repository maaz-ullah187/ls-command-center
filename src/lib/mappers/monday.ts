/**
 * Monday.com mapper — fetches client data from 3 boards (Program A,
 * Program C, Program B) via GraphQL API.
 *
 * Each board ID comes from env vars (MONDAY_BOARD_PROGRAM_A / _B / _C)
 * and maps to a CSM. Boards with no env var configured are skipped.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface MondayClient {
  id: string;
  name: string;
  status: string; // Active, Due for Renewal, Paused, Cancelled, Off-boarded
  agencyName: string;
  email: string;
  phone: string;
  renewalDate: string;
  startDate: string;
  program: string; // Program A, Program B, Program C
  boardName: string;
  csm: string;
}

// ---------------------------------------------------------------------------
// Board config
// ---------------------------------------------------------------------------

interface BoardConfig {
  id: string;
  name: string;
  csm: string;
  program: string;
}

// Board IDs come from env vars. Add additional boards as needed.
const BOARDS: BoardConfig[] = [
  { id: process.env.MONDAY_BOARD_PROGRAM_A ?? '', name: 'Program A', csm: 'CSM One', program: 'Program A' },
  { id: process.env.MONDAY_BOARD_PROGRAM_C ?? '', name: 'Program C', csm: 'Founder Two', program: 'Program C' },
  { id: process.env.MONDAY_BOARD_PROGRAM_B ?? '', name: 'Program B', csm: 'CSM Two', program: 'Program B' },
].filter(b => b.id);

// Known column IDs from the Program B board.
// Monday.com uses the same column structure across boards that share a template.
// We try these IDs first, then fall back to column title matching.
const KNOWN_COLUMN_IDS: Record<string, string[]> = {
  status: ['color_mky8ayzw', 'status'],
  agencyName: ['text_mky8ws2x', 'agency_name', 'agency'],
  renewalDate: ['date_mky83dec', 'renewal_date'],
  program: ['color_mky8qb0j', 'program'],
  email: ['text_mky83wzh', 'email'],
  phone: ['text_mky863tp', 'phone'],
  startDate: ['date_mky8hppq', 'start_date'],
  defconStatus: ['defcon_status'],
  checkInStatus: ['check_in_status'],
};

// Column title keywords → field name mapping (fallback when IDs don't match)
const TITLE_TO_FIELD: Record<string, string> = {
  status: 'status',
  'agency name': 'agencyName',
  agency: 'agencyName',
  'renewal date': 'renewalDate',
  renewal: 'renewalDate',
  program: 'program',
  email: 'email',
  phone: 'phone',
  'start date': 'startDate',
  started: 'startDate',
  defcon: 'defconStatus',
  'check in': 'checkInStatus',
  'check-in': 'checkInStatus',
};

// ---------------------------------------------------------------------------
// GraphQL helpers
// ---------------------------------------------------------------------------

const MONDAY_API_URL = 'https://api.monday.com/v2';

async function mondayQuery(apiKey: string, query: string): Promise<unknown> {
  const res = await fetch(MONDAY_API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: apiKey,
    },
    body: JSON.stringify({ query }),
    next: { revalidate: 600 }, // 10 min cache at fetch level
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Monday.com API error ${res.status}: ${text}`);
  }

  const json = await res.json();
  if (json.errors && json.errors.length > 0) {
    throw new Error(`Monday.com GraphQL error: ${json.errors[0].message}`);
  }
  return json.data;
}

// ---------------------------------------------------------------------------
// Column value extraction
// ---------------------------------------------------------------------------

interface MondayColumnValue {
  id: string;
  text: string;
  value: string | null;
  type: string;
  column?: { title: string };
}

function buildColumnMap(
  columnValues: MondayColumnValue[]
): Record<string, string> {
  const map: Record<string, string> = {};

  for (const col of columnValues) {
    const colId = col.id;
    const colTitle = col.column?.title?.toLowerCase() ?? '';
    const text = col.text ?? '';

    // Try known column IDs first
    for (const [field, ids] of Object.entries(KNOWN_COLUMN_IDS)) {
      if (ids.includes(colId)) {
        map[field] = text;
      }
    }

    // Fall back to title matching
    for (const [keyword, field] of Object.entries(TITLE_TO_FIELD)) {
      if (colTitle.includes(keyword) && !map[field]) {
        map[field] = text;
      }
    }
  }

  return map;
}

// ---------------------------------------------------------------------------
// Status normalization
// ---------------------------------------------------------------------------

function normalizeStatus(raw: string): string {
  const lower = raw.toLowerCase().trim();
  if (lower.includes('active') && !lower.includes('de')) return 'Active';
  if (lower.includes('due') || lower.includes('renewal')) return 'Due for Renewal';
  if (lower.includes('pause')) return 'Paused';
  if (lower.includes('cancel')) return 'Cancelled';
  if (lower.includes('off-board') || lower.includes('offboard')) return 'Off-boarded';
  if (lower === '') return 'Active'; // default if empty
  return raw; // preserve original if unrecognized
}

// ---------------------------------------------------------------------------
// Main fetch function
// ---------------------------------------------------------------------------

export async function fetchMondayClients(apiKey: string): Promise<MondayClient[]> {
  // Build a single query that fetches all 3 boards in parallel
  const boardQueries = BOARDS.map(
    (b, i) => `
    board${i}: boards(ids: ${b.id}) {
      name
      items_page(limit: 500) {
        items {
          id
          name
          column_values {
            id
            text
            value
            type
            column {
              title
            }
          }
        }
      }
    }`
  ).join('\n');

  const query = `query { ${boardQueries} }`;

  const data = await mondayQuery(apiKey, query) as Record<string, Array<{
    name: string;
    items_page: {
      items: Array<{
        id: string;
        name: string;
        column_values: MondayColumnValue[];
      }>;
    };
  }>>;

  const clients: MondayClient[] = [];

  for (let i = 0; i < BOARDS.length; i++) {
    const boardConfig = BOARDS[i];
    const boardData = data[`board${i}`];
    if (!boardData || boardData.length === 0) continue;

    const board = boardData[0];
    const items = board.items_page?.items ?? [];

    for (const item of items) {
      const cols = buildColumnMap(item.column_values);

      clients.push({
        id: item.id,
        name: item.name,
        status: normalizeStatus(cols.status || ''),
        agencyName: cols.agencyName || '',
        email: cols.email || '',
        phone: cols.phone || '',
        renewalDate: cols.renewalDate || '',
        startDate: cols.startDate || '',
        program: cols.program || boardConfig.program,
        boardName: boardConfig.name,
        csm: boardConfig.csm,
      });
    }
  }

  return clients;
}

// ---------------------------------------------------------------------------
// Derived helpers (used by BackEndTab)
// ---------------------------------------------------------------------------

export interface MondayCSMSummary {
  name: string;
  offer: string;
  boardId: string;
  activeClients: number;
  dueForRenewal: MondayClient[];
  paused: number;
  cancelled: number;
  offboarded: number;
  totalClients: number;
}

export function getMondayCSMSummaries(clients: MondayClient[]): MondayCSMSummary[] {
  return BOARDS.map(board => {
    const boardClients = clients.filter(c => c.csm === board.csm);
    return {
      name: board.csm,
      offer: board.name,
      boardId: board.id,
      activeClients: boardClients.filter(c => c.status === 'Active').length,
      dueForRenewal: boardClients.filter(c => c.status === 'Due for Renewal'),
      paused: boardClients.filter(c => c.status === 'Paused').length,
      cancelled: boardClients.filter(c => c.status === 'Cancelled').length,
      offboarded: boardClients.filter(c => c.status === 'Off-boarded').length,
      totalClients: boardClients.length,
    };
  });
}

export function getAverageClientDuration(clients: MondayClient[]): string {
  const withStart = clients.filter(c => c.startDate);
  if (withStart.length === 0) return 'N/A';

  const now = Date.now();
  let totalDays = 0;
  for (const c of withStart) {
    const start = new Date(c.startDate).getTime();
    if (!isNaN(start)) {
      totalDays += (now - start) / (1000 * 60 * 60 * 24);
    }
  }
  const avgDays = totalDays / withStart.length;
  const avgMonths = avgDays / 30;
  return avgMonths >= 1 ? `${avgMonths.toFixed(1)} months` : `${Math.round(avgDays)} days`;
}

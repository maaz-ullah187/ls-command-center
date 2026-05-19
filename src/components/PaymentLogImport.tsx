'use client';

import { useState, useRef, useCallback } from 'react';
import { Upload, FileSpreadsheet, Check, AlertTriangle, X, Loader2 } from 'lucide-react';

/**
 * CSV column mapping from the operator's Google Sheet payment log.
 * Expected columns (order may vary):
 *   Status | Date Paid | Client Name | Agency Name | Client Email |
 *   Client Phone | Payment Type | Program | Date Collected | New Cash
 */

const EXPECTED_HEADERS = [
  'status', 'date paid', 'client name', 'agency name', 'client email',
  'client phone', 'payment type', 'program', 'date collected', 'new cash',
];

// Map normalized header → JSON key
const HEADER_MAP: Record<string, string> = {
  'status': 'status',
  'date paid': 'datePaid',
  'client name': 'clientName',
  'agency name': 'agencyName',
  'client email': 'clientEmail',
  'client phone': 'clientPhone',
  'payment type': 'paymentType',
  'program': 'program',
  'date collected': 'dateCollected',
  'new cash': 'newCash',
};

function normalizeHeader(h: string): string {
  return h.trim().toLowerCase().replace(/[_\-]+/g, ' ').replace(/\s+/g, ' ');
}

function parseCSV(text: string): Record<string, string>[] {
  const lines = text.split(/\r?\n/).filter(l => l.trim() !== '');
  if (lines.length < 2) return [];

  // Parse header row
  const rawHeaders = lines[0].split(',').map(h => h.replace(/^"(.*)"$/, '$1'));
  const headerKeys = rawHeaders.map(h => {
    const norm = normalizeHeader(h);
    return HEADER_MAP[norm] ?? null;
  });

  const rows: Record<string, string>[] = [];

  for (let i = 1; i < lines.length; i++) {
    // Simple CSV parse (handles quoted commas)
    const values: string[] = [];
    let current = '';
    let inQuotes = false;
    for (const ch of lines[i]) {
      if (ch === '"') {
        inQuotes = !inQuotes;
      } else if (ch === ',' && !inQuotes) {
        values.push(current.trim());
        current = '';
      } else {
        current += ch;
      }
    }
    values.push(current.trim());

    const row: Record<string, string> = {};
    let hasData = false;
    for (let j = 0; j < headerKeys.length; j++) {
      const key = headerKeys[j];
      if (key && values[j]) {
        row[key] = values[j];
        if (key === 'clientName' && values[j].trim()) hasData = true;
      }
    }
    if (hasData) rows.push(row);
  }

  return rows;
}

interface ImportResult {
  success: boolean;
  totalRows: number;
  validRows: number;
  upserted: number;
  errors?: string[];
}

export default function PaymentLogImport() {
  const [dragOver, setDragOver] = useState(false);
  const [pasteMode, setPasteMode] = useState(false);
  const [pasteText, setPasteText] = useState('');
  const [parsedRows, setParsedRows] = useState<Record<string, string>[]>([]);
  const [importing, setImporting] = useState(false);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const handleParse = useCallback((csvText: string) => {
    setError(null);
    setResult(null);
    const rows = parseCSV(csvText);
    if (rows.length === 0) {
      setError('No valid rows found. Make sure the CSV has a header row with "Client Name" column.');
      return;
    }
    setParsedRows(rows);
  }, []);

  const handleFile = useCallback((file: File) => {
    if (!file.name.endsWith('.csv') && !file.type.includes('csv') && !file.type.includes('text')) {
      setError('Please upload a .csv file');
      return;
    }
    const reader = new FileReader();
    reader.onload = (e) => {
      const text = e.target?.result as string;
      handleParse(text);
    };
    reader.readAsText(file);
  }, [handleParse]);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files?.[0];
    if (file) handleFile(file);
  }, [handleFile]);

  const handleImport = async () => {
    if (parsedRows.length === 0) return;
    setImporting(true);
    setError(null);
    setResult(null);

    try {
      const res = await fetch('/api/data/payment-log', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rows: parsedRows }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || 'Import failed');
      } else {
        setResult(data);
        setParsedRows([]);
        setPasteText('');
      }
    } catch (err: any) {
      setError(err?.message || 'Network error');
    } finally {
      setImporting(false);
    }
  };

  const reset = () => {
    setParsedRows([]);
    setPasteText('');
    setResult(null);
    setError(null);
    setPasteMode(false);
  };

  return (
    <div className="bg-[#1a1d23] rounded-xl border border-gray-700 p-5">
      <div className="flex items-center gap-3 mb-4">
        <div className="w-10 h-10 rounded-lg flex items-center justify-center bg-green-600 text-white shrink-0">
          <FileSpreadsheet size={18} />
        </div>
        <div>
          <h3 className="text-sm font-semibold text-white">Import Payment Log (CSV)</h3>
          <p className="text-xs text-gray-500">
            Upload or paste CSV data from the Payment Tracking Google Sheet
          </p>
        </div>
      </div>

      {/* Success result */}
      {result && (
        <div className="mb-4 bg-emerald-950/40 border border-emerald-700/50 rounded-lg p-4">
          <div className="flex items-center gap-2 mb-1">
            <Check size={16} className="text-emerald-400" />
            <span className="text-sm font-medium text-emerald-300">Import successful</span>
          </div>
          <p className="text-xs text-emerald-400/80">
            {result.upserted} of {result.totalRows} rows imported ({result.validRows} valid).
            {result.errors && result.errors.length > 0 && (
              <span className="text-amber-400"> {result.errors.length} batch error(s).</span>
            )}
          </p>
          <button onClick={reset} className="mt-2 text-xs text-emerald-400 hover:text-emerald-300 underline">
            Import more
          </button>
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="mb-4 bg-red-950/40 border border-red-700/50 rounded-lg p-4">
          <div className="flex items-center gap-2">
            <AlertTriangle size={16} className="text-red-400" />
            <span className="text-sm text-red-300">{error}</span>
          </div>
        </div>
      )}

      {/* Preview */}
      {parsedRows.length > 0 && !result && (
        <div className="mb-4">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs text-gray-400">
              {parsedRows.length} row{parsedRows.length !== 1 ? 's' : ''} parsed - preview:
            </span>
            <div className="flex gap-2">
              <button
                onClick={reset}
                className="px-3 py-1.5 rounded-lg text-xs font-medium text-gray-400 bg-gray-800 hover:bg-gray-700 border border-gray-700"
              >
                Cancel
              </button>
              <button
                onClick={handleImport}
                disabled={importing}
                className="flex items-center gap-1.5 px-4 py-1.5 rounded-lg text-xs font-semibold text-white bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                {importing ? <Loader2 size={13} className="animate-spin" /> : <Upload size={13} />}
                {importing ? 'Importing...' : `Import ${parsedRows.length} rows`}
              </button>
            </div>
          </div>
          <div className="overflow-x-auto max-h-48 rounded-lg border border-gray-700">
            <table className="w-full text-[11px] text-gray-300">
              <thead className="bg-gray-800/60 sticky top-0">
                <tr>
                  <th className="text-left py-1.5 px-2 text-gray-500">#</th>
                  <th className="text-left py-1.5 px-2 text-gray-500">Client</th>
                  <th className="text-left py-1.5 px-2 text-gray-500">Program</th>
                  <th className="text-left py-1.5 px-2 text-gray-500">Date Paid</th>
                  <th className="text-right py-1.5 px-2 text-gray-500">Cash</th>
                  <th className="text-left py-1.5 px-2 text-gray-500">Type</th>
                </tr>
              </thead>
              <tbody>
                {parsedRows.slice(0, 10).map((row, i) => (
                  <tr key={i} className="border-t border-gray-800/50">
                    <td className="py-1 px-2 text-gray-600">{i + 1}</td>
                    <td className="py-1 px-2 text-white">{row.clientName}</td>
                    <td className="py-1 px-2">{row.program || '-'}</td>
                    <td className="py-1 px-2">{row.datePaid || '-'}</td>
                    <td className="text-right py-1 px-2 text-emerald-400">{row.newCash ? `$${row.newCash}` : '-'}</td>
                    <td className="py-1 px-2">{row.paymentType || '-'}</td>
                  </tr>
                ))}
                {parsedRows.length > 10 && (
                  <tr className="border-t border-gray-800/50">
                    <td colSpan={6} className="py-1.5 px-2 text-center text-gray-500 text-[10px]">
                      ...and {parsedRows.length - 10} more rows
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Upload / Paste area */}
      {parsedRows.length === 0 && !result && (
        <>
          {!pasteMode ? (
            <div
              className={`border-2 border-dashed rounded-xl p-8 text-center transition-colors cursor-pointer ${
                dragOver
                  ? 'border-emerald-500 bg-emerald-950/20'
                  : 'border-gray-700 hover:border-gray-600 hover:bg-gray-800/30'
              }`}
              onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
              onDragLeave={() => setDragOver(false)}
              onDrop={handleDrop}
              onClick={() => fileRef.current?.click()}
            >
              <Upload size={24} className="mx-auto mb-2 text-gray-500" />
              <p className="text-sm text-gray-400 mb-1">
                Drag & drop a CSV file here, or click to browse
              </p>
              <p className="text-xs text-gray-600">
                Export your Google Sheet as CSV first (File &gt; Download &gt; CSV)
              </p>
              <input
                ref={fileRef}
                type="file"
                accept=".csv,text/csv"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) handleFile(file);
                }}
              />
            </div>
          ) : (
            <div>
              <textarea
                value={pasteText}
                onChange={(e) => setPasteText(e.target.value)}
                placeholder="Paste CSV data here (include header row)..."
                className="w-full h-40 bg-gray-800 border border-gray-600 rounded-lg px-3 py-2 text-xs text-gray-300 font-mono placeholder-gray-600 focus:outline-none focus:border-blue-500 resize-y"
              />
              <div className="flex gap-2 mt-2">
                <button
                  onClick={() => { setPasteMode(false); setPasteText(''); }}
                  className="px-3 py-1.5 rounded-lg text-xs text-gray-400 bg-gray-800 hover:bg-gray-700 border border-gray-700"
                >
                  Cancel
                </button>
                <button
                  onClick={() => handleParse(pasteText)}
                  disabled={!pasteText.trim()}
                  className="px-4 py-1.5 rounded-lg text-xs font-semibold text-white bg-blue-600 hover:bg-blue-500 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  Parse CSV
                </button>
              </div>
            </div>
          )}

          <div className="flex items-center justify-center mt-3">
            <button
              onClick={() => setPasteMode(!pasteMode)}
              className="text-xs text-blue-400 hover:text-blue-300"
            >
              {pasteMode ? 'Switch to file upload' : 'Or paste CSV data directly'}
            </button>
          </div>
        </>
      )}
    </div>
  );
}

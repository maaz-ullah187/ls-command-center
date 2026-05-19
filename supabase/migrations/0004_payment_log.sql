-- Payment log table for CSV-imported data from the operator's Google Sheets payment tracker
-- Source: https://docs.google.com/spreadsheets/d/10q3NcpjZRxjHDj_j8ZQhZ6oCBwn8jMRH23j4dYLwL6E/

CREATE TABLE IF NOT EXISTS payment_log (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  status text,
  date_paid date,
  client_name text NOT NULL,
  agency_name text,
  client_email text,
  client_phone text,
  payment_type text,
  program text,
  date_collected date,
  new_cash numeric(12,2) DEFAULT 0,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  -- Upsert key: same client + date_paid + payment_type = same record
  UNIQUE(client_name, date_paid, payment_type)
);

-- Index for common queries
CREATE INDEX IF NOT EXISTS idx_payment_log_client ON payment_log(client_name);
CREATE INDEX IF NOT EXISTS idx_payment_log_date ON payment_log(date_paid);
CREATE INDEX IF NOT EXISTS idx_payment_log_program ON payment_log(program);

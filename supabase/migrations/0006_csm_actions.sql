-- CSM action logs — upsells, renewals, off-boardings logged by CSMs
-- This is critical business data that cannot live in localStorage

CREATE TABLE IF NOT EXISTS csm_action_logs (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  action_type text NOT NULL CHECK (action_type IN ('upsell', 'renewal', 'offboarding')),
  client_name text NOT NULL,
  csm_name text NOT NULL,
  amount numeric(12,2) DEFAULT 0,
  date date NOT NULL,
  reason text, -- for offboarding: pricing, results, capacity, other
  notes text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_csm_actions_client ON csm_action_logs(client_name);
CREATE INDEX IF NOT EXISTS idx_csm_actions_csm ON csm_action_logs(csm_name);
CREATE INDEX IF NOT EXISTS idx_csm_actions_date ON csm_action_logs(date);
CREATE INDEX IF NOT EXISTS idx_csm_actions_type ON csm_action_logs(action_type);

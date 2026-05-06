
CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

CREATE TABLE IF NOT EXISTS public.surebets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  match_key text NOT NULL,
  sport text NOT NULL,
  tournament text,
  event_name text NOT NULL,
  event_time timestamptz,
  market text NOT NULL,
  roi numeric NOT NULL,
  arb_percent numeric NOT NULL,
  total_stake numeric NOT NULL,
  profit numeric NOT NULL,
  legs jsonb NOT NULL,
  bookmakers text[] NOT NULL DEFAULT '{}',
  source text NOT NULL DEFAULT 'odds_api',
  scanned_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_surebets_scanned_at ON public.surebets (scanned_at DESC);
CREATE INDEX IF NOT EXISTS idx_surebets_match_key ON public.surebets (match_key);
CREATE INDEX IF NOT EXISTS idx_surebets_roi ON public.surebets (roi DESC);

ALTER TABLE public.surebets ENABLE ROW LEVEL SECURITY;
CREATE POLICY "public read surebets" ON public.surebets FOR SELECT USING (true);
CREATE POLICY "public write surebets" ON public.surebets FOR ALL USING (true) WITH CHECK (true);

CREATE TABLE IF NOT EXISTS public.scan_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  duration_ms integer,
  sports_scanned text[] NOT NULL DEFAULT '{}',
  events_scanned integer NOT NULL DEFAULT 0,
  bookmakers_count integer NOT NULL DEFAULT 0,
  arbs_found integer NOT NULL DEFAULT 0,
  requests_remaining text,
  error text
);

CREATE INDEX IF NOT EXISTS idx_scan_runs_started_at ON public.scan_runs (started_at DESC);

ALTER TABLE public.scan_runs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "public read scan_runs" ON public.scan_runs FOR SELECT USING (true);
CREATE POLICY "public write scan_runs" ON public.scan_runs FOR ALL USING (true) WITH CHECK (true);

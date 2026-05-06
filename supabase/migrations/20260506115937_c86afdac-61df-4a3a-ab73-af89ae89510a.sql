
CREATE TABLE public.bookmakers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  website TEXT,
  source_type TEXT NOT NULL DEFAULT 'manual',
  is_active BOOLEAN NOT NULL DEFAULT true,
  currency TEXT NOT NULL DEFAULT 'USD',
  min_stake NUMERIC,
  max_stake NUMERIC,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE public.odds (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  bookmaker_id UUID NOT NULL REFERENCES public.bookmakers(id) ON DELETE CASCADE,
  sport TEXT NOT NULL,
  tournament TEXT,
  event_name TEXT NOT NULL,
  event_time TIMESTAMPTZ,
  market TEXT NOT NULL,
  outcome TEXT NOT NULL,
  odds NUMERIC NOT NULL CHECK (odds > 1),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_odds_event ON public.odds(sport, event_name, market);
CREATE INDEX idx_odds_bm ON public.odds(bookmaker_id);

CREATE TABLE public.app_settings (
  id INT PRIMARY KEY DEFAULT 1,
  min_roi NUMERIC NOT NULL DEFAULT 1,
  default_stake NUMERIC NOT NULL DEFAULT 1000,
  currency TEXT NOT NULL DEFAULT 'USD',
  timezone TEXT NOT NULL DEFAULT 'UTC',
  margin NUMERIC NOT NULL DEFAULT 0,
  CONSTRAINT singleton CHECK (id = 1)
);
INSERT INTO public.app_settings (id) VALUES (1);

ALTER TABLE public.bookmakers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.odds ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.app_settings ENABLE ROW LEVEL SECURITY;

-- MVP: public access (no auth). Tighten later when auth is added.
CREATE POLICY "public all bookmakers" ON public.bookmakers FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "public all odds" ON public.odds FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "public all settings" ON public.app_settings FOR ALL USING (true) WITH CHECK (true);

CREATE OR REPLACE FUNCTION public.touch_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END; $$;

CREATE TRIGGER trg_bm_upd BEFORE UPDATE ON public.bookmakers
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
CREATE TRIGGER trg_odds_upd BEFORE UPDATE ON public.odds
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

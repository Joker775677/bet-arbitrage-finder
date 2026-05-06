
-- Таблица матчей от каждого букмекера
CREATE TABLE public.ru_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source text NOT NULL,
  sport text,
  league text,
  team1 text NOT NULL,
  team2 text NOT NULL,
  event_name text NOT NULL,
  event_key text NOT NULL,
  date_key text,
  url text,
  scanned_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ru_events_source_key_uq UNIQUE (source, event_key)
);

CREATE INDEX ru_events_scanned_at_idx ON public.ru_events (scanned_at DESC);
CREATE INDEX ru_events_event_key_idx ON public.ru_events (event_key);
CREATE INDEX ru_events_source_idx ON public.ru_events (source);

ALTER TABLE public.ru_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "public read ru_events" ON public.ru_events FOR SELECT USING (true);
CREATE POLICY "public write ru_events" ON public.ru_events FOR ALL USING (true) WITH CHECK (true);

-- Таблица коэффициентов
CREATE TABLE public.ru_odds (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id uuid NOT NULL REFERENCES public.ru_events(id) ON DELETE CASCADE,
  market text NOT NULL,
  outcome text NOT NULL,
  odds numeric NOT NULL,
  scanned_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ru_odds_event_market_outcome_uq UNIQUE (event_id, market, outcome)
);

CREATE INDEX ru_odds_event_id_idx ON public.ru_odds (event_id);
CREATE INDEX ru_odds_scanned_at_idx ON public.ru_odds (scanned_at DESC);

ALTER TABLE public.ru_odds ENABLE ROW LEVEL SECURITY;

CREATE POLICY "public read ru_odds" ON public.ru_odds FOR SELECT USING (true);
CREATE POLICY "public write ru_odds" ON public.ru_odds FOR ALL USING (true) WITH CHECK (true);

-- Триггеры updated_at
CREATE TRIGGER ru_events_touch BEFORE UPDATE ON public.ru_events
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

CREATE TRIGGER ru_odds_touch BEFORE UPDATE ON public.ru_odds
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- Realtime
ALTER TABLE public.ru_events REPLICA IDENTITY FULL;
ALTER TABLE public.ru_odds REPLICA IDENTITY FULL;
ALTER PUBLICATION supabase_realtime ADD TABLE public.ru_events;
ALTER PUBLICATION supabase_realtime ADD TABLE public.ru_odds;

-- Функция автоочистки старше 24 часов
CREATE OR REPLACE FUNCTION public.cleanup_old_ru_data()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  DELETE FROM public.ru_events WHERE scanned_at < now() - interval '24 hours';
END;
$$;

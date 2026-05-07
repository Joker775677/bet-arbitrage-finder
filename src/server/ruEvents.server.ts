import { supabaseAdmin } from "@/integrations/supabase/client.server";

export interface RuEventRow {
  id: string;
  source: string;
  event_name: string;
  league: string | null;
  sport: string | null;
  scanned_at: string;
}

export async function listRuEvents(): Promise<{ rows: RuEventRow[]; count: number }> {
  const { data, count, error } = await supabaseAdmin
    .from("ru_events")
    .select("id, source, event_name, league, sport, scanned_at", { count: "exact" })
    .order("scanned_at", { ascending: false })
    .limit(50);

  if (error) throw new Error(`ru_events select: ${error.message}`);
  return { rows: (data ?? []) as RuEventRow[], count: count ?? 0 };
}
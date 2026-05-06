import { createServerFn } from "@tanstack/react-start";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

interface FonbetOdd {
  market: string;
  outcome: string;
  odds: number;
}
interface FonbetEvent {
  eventId: number;
  sport: string | null;
  tournament: string | null;
  team1: string;
  team2: string;
  eventName: string;
  startTime: string | null;
  live: boolean;
  odds: FonbetOdd[];
}

function eventKey(team1: string, team2: string, dateKey: string, league: string) {
  const t1 = team1.toLowerCase().trim();
  const t2 = team2.toLowerCase().trim();
  const [a, b] = t1 < t2 ? [t1, t2] : [t2, t1];
  return `${league.toLowerCase().trim()}|${dateKey}|${a}|${b}`;
}

function dateKeyFromIso(iso: string | null): string {
  if (!iso) return "any";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "any";
  return `${String(d.getUTCDate()).padStart(2, "0")}.${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

/**
 * Импорт Fonbet через scraper-service (/fonbet endpoint).
 * Один запрос → ~3000 матчей с коэффами за <1 сек.
 */
export const importFonbet = createServerFn({ method: "POST" }).handler(async () => {
  const base = process.env.SCRAPER_URL;
  const token = process.env.SCRAPER_TOKEN;
  if (!base || !token) throw new Error("SCRAPER_URL/SCRAPER_TOKEN not configured");

  const t0 = Date.now();
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 30000);
  let payload: any;
  try {
    const r = await fetch(`${base.replace(/\/+$/, "")}/fonbet?scope=1600`, {
      headers: { "x-token": token },
      signal: ctrl.signal,
    });
    payload = await r.json();
  } finally {
    clearTimeout(timer);
  }
  if (!payload?.ok) {
    throw new Error(`fonbet scraper error: ${payload?.error || "unknown"}`);
  }
  const events: FonbetEvent[] = payload.events || [];
  const fetchMs = Date.now() - t0;

  const now = new Date().toISOString();
  const source = "fonbet";

  // Build event rows
  const eventRowsAll = events
    .filter((e) => e.team1 && e.team2 && e.odds?.length)
    .map((e) => {
      const league = e.tournament || e.sport || "";
      const dk = dateKeyFromIso(e.startTime);
      return {
        ev: e,
        row: {
          source,
          sport: e.sport,
          league,
          team1: e.team1,
          team2: e.team2,
          event_name: e.eventName,
          event_key: eventKey(e.team1, e.team2, dk, league),
          date_key: dk,
          url: `https://www.fon.bet/live/${e.eventId}`,
          scanned_at: now,
        },
      };
    });

  // dedupe by event_key
  const seen = new Set<string>();
  const eventRows = eventRowsAll.filter(({ row }) => {
    if (seen.has(row.event_key)) return false;
    seen.add(row.event_key);
    return true;
  });

  // Batch upsert events (Supabase limit ~1000/req → chunk by 500)
  const idMap = new Map<string, string>();
  const CHUNK = 500;
  for (let i = 0; i < eventRows.length; i += CHUNK) {
    const slice = eventRows.slice(i, i + CHUNK).map(({ row }) => row);
    const { data: upserted, error } = await supabaseAdmin
      .from("ru_events")
      .upsert(slice, { onConflict: "source,event_key" })
      .select("id, event_key");
    if (error) throw new Error(`ru_events upsert: ${error.message}`);
    for (const r of upserted ?? []) idMap.set(r.event_key as string, r.id as string);
  }

  // Build odds rows
  const oddsAll: any[] = [];
  for (const { ev, row } of eventRows) {
    const id = idMap.get(row.event_key);
    if (!id) continue;
    for (const o of ev.odds) {
      if (!Number.isFinite(o.odds) || o.odds <= 1.01) continue;
      oddsAll.push({
        event_id: id,
        market: o.market,
        outcome: o.outcome,
        odds: o.odds,
        scanned_at: now,
      });
    }
  }

  // dedupe by (event_id, market, outcome)
  const odSeen = new Set<string>();
  const oddRows = oddsAll.filter((r) => {
    const k = `${r.event_id}|${r.market}|${r.outcome}`;
    if (odSeen.has(k)) return false;
    odSeen.add(k);
    return true;
  });

  let savedOdds = 0;
  for (let i = 0; i < oddRows.length; i += CHUNK) {
    const slice = oddRows.slice(i, i + CHUNK);
    const { error, count } = await supabaseAdmin
      .from("ru_odds")
      .upsert(slice, { onConflict: "event_id,market,outcome", count: "exact" });
    if (error) throw new Error(`ru_odds upsert: ${error.message}`);
    savedOdds += count ?? slice.length;
  }

  // Cleanup
  try { await supabaseAdmin.rpc("cleanup_old_ru_data"); } catch {}

  return {
    ok: true,
    fetchMs,
    totalMs: Date.now() - t0,
    eventsReceived: events.length,
    eventsSaved: eventRows.length,
    oddsSaved: savedOdds,
    at: now,
  };
});

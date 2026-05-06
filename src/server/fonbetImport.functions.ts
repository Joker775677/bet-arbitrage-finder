import { createServerFn } from "@tanstack/react-start";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

interface EngineOdd { market: string; outcome: string; odds: number }
interface EngineEvent {
  eventId: number;
  sport: string | null;
  tournament: string | null;
  team1: string;
  team2: string;
  eventName: string;
  startTime: string | null;
  live: boolean;
  odds: EngineOdd[];
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

const ENGINE_META = {
  fonbet: { path: "/fonbet?scope=1600", source: "fonbet", urlBase: "https://www.fon.bet/live/" },
  pari:   { path: "/pari?scope=2300",   source: "pari",   urlBase: "https://pari.ru/live/" },
  leon:   { path: "/leon",              source: "leon",   urlBase: "https://leon.ru/live/" },
} as const;

type EngineKey = keyof typeof ENGINE_META;

async function importEngine(engine: EngineKey) {
  const base = process.env.SCRAPER_URL;
  const token = process.env.SCRAPER_TOKEN;
  if (!base || !token) throw new Error("SCRAPER_URL/SCRAPER_TOKEN not configured");
  const meta = ENGINE_META[engine];

  const t0 = Date.now();
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 30000);
  let payload: any;
  try {
    const r = await fetch(`${base.replace(/\/+$/, "")}${meta.path}`, {
      headers: { "x-token": token },
      signal: ctrl.signal,
    });
    payload = await r.json();
  } finally {
    clearTimeout(timer);
  }
  if (!payload?.ok) throw new Error(`${engine} scraper error: ${payload?.error || "unknown"}`);
  const events: EngineEvent[] = payload.events || [];
  const fetchMs = Date.now() - t0;

  const now = new Date().toISOString();

  const eventRowsAll = events
    .filter((e) => e.team1 && e.team2 && e.odds?.length)
    .map((e) => {
      const league = e.tournament || e.sport || "";
      const dk = dateKeyFromIso(e.startTime);
      return {
        ev: e,
        row: {
          source: meta.source,
          sport: e.sport,
          league,
          team1: e.team1,
          team2: e.team2,
          event_name: e.eventName,
          event_key: eventKey(e.team1, e.team2, dk, league),
          date_key: dk,
          url: `${meta.urlBase}${e.eventId}`,
          scanned_at: now,
        },
      };
    });

  const seen = new Set<string>();
  const eventRows = eventRowsAll.filter(({ row }) => {
    if (seen.has(row.event_key)) return false;
    seen.add(row.event_key);
    return true;
  });

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

  const oddsAll: any[] = [];
  for (const { ev, row } of eventRows) {
    const id = idMap.get(row.event_key);
    if (!id) continue;
    for (const o of ev.odds) {
      if (!Number.isFinite(o.odds) || o.odds <= 1.01) continue;
      oddsAll.push({ event_id: id, market: o.market, outcome: o.outcome, odds: o.odds, scanned_at: now });
    }
  }

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

  try { await supabaseAdmin.rpc("cleanup_old_ru_data"); } catch {}

  return {
    ok: true,
    bookmaker: meta.source,
    fetchMs,
    totalMs: Date.now() - t0,
    eventsReceived: events.length,
    eventsSaved: eventRows.length,
    oddsSaved: savedOdds,
    at: now,
  };
}

export const importFonbet = createServerFn({ method: "POST" }).handler(() => importEngine("fonbet"));
export const importPari   = createServerFn({ method: "POST" }).handler(() => importEngine("pari"));

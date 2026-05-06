import { createServerFn } from "@tanstack/react-start";
import { createClient } from "@supabase/supabase-js";
import { findArbitrages, type OddRow, type Arb } from "@/lib/arbitrage";

const BASE = "https://api.the-odds-api.com/v4";

// Default sports to scan in the background — popular high-liquidity markets
export const DEFAULT_SPORTS = [
  "soccer_epl",
  "soccer_uefa_champs_league",
  "soccer_spain_la_liga",
  "soccer_italy_serie_a",
  "soccer_germany_bundesliga",
  "basketball_nba",
  "icehockey_nhl",
  "tennis_atp_singles",
  "mma_mixed_martial_arts",
];

export interface LiveScanResult {
  arbs: Arb[];
  eventsScanned: number;
  bookmakers: string[];
  requestsRemaining: string | null;
  requestsUsed: string | null;
  fetchedAt: string;
  error?: string;
}

export interface FullScanResult {
  arbs: Arb[];
  eventsScanned: number;
  bookmakers: string[];
  sportsScanned: string[];
  requestsRemaining: string | null;
  requestsUsed: string | null;
  durationMs: number;
  fetchedAt: string;
  perSport: Array<{ sport: string; events: number; arbs: number; error?: string }>;
}

function getSupabase() {
  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) throw new Error("Supabase env not configured");
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

export const listSports = createServerFn({ method: "GET" }).handler(async () => {
  const key = process.env.ODDS_API_KEY;
  if (!key) throw new Error("ODDS_API_KEY is not configured");
  const r = await fetch(`${BASE}/sports/?apiKey=${key}&all=false`);
  if (!r.ok) throw new Error(`Odds API error ${r.status}: ${await r.text()}`);
  return (await r.json()) as Array<{ key: string; group: string; title: string; active: boolean }>;
});

async function fetchSportOdds(sport: string, regions: string, markets: string, apiKey: string) {
  const params = new URLSearchParams({
    apiKey,
    regions,
    markets,
    oddsFormat: "decimal",
    dateFormat: "iso",
  });
  const r = await fetch(`${BASE}/sports/${encodeURIComponent(sport)}/odds/?${params}`, {
    signal: AbortSignal.timeout(15000),
  });
  return r;
}

function eventsToOdds(events: any[]): { odds: OddRow[]; bookmakers: Set<string> } {
  const odds: OddRow[] = [];
  const bmSet = new Set<string>();
  for (const ev of events) {
    const eventName = `${ev.home_team} vs ${ev.away_team}`;
    for (const bm of ev.bookmakers ?? []) {
      bmSet.add(bm.title);
      for (const m of bm.markets ?? []) {
        for (const o of m.outcomes ?? []) {
          odds.push({
            id: `${ev.id}-${bm.key}-${m.key}-${o.name}`,
            bookmaker_id: bm.key,
            bookmaker_name: bm.title,
            sport: ev.sport_title,
            tournament: ev.sport_title,
            event_name: eventName,
            event_time: ev.commence_time,
            market: m.key,
            outcome: o.name,
            odds: o.price,
          });
        }
      }
    }
  }
  return { odds, bookmakers: bmSet };
}

// Single-sport scan (kept for the existing /live page)
export const scanLive = createServerFn({ method: "POST" })
  .inputValidator((d: { sport: string; regions?: string; markets?: string; stake?: number; minRoi?: number; bookmakers?: string[] }) => d)
  .handler(async ({ data }): Promise<LiveScanResult> => {
    const key = process.env.ODDS_API_KEY;
    if (!key) throw new Error("ODDS_API_KEY is not configured");

    const params = new URLSearchParams({
      apiKey: key,
      regions: data.regions || "eu,uk,us",
      markets: data.markets || "h2h",
      oddsFormat: "decimal",
      dateFormat: "iso",
    });
    if (data.bookmakers && data.bookmakers.length) {
      params.set("bookmakers", data.bookmakers.join(","));
      params.delete("regions");
    }

    const r = await fetch(`${BASE}/sports/${encodeURIComponent(data.sport)}/odds/?${params}`);
    const remaining = r.headers.get("x-requests-remaining");
    const used = r.headers.get("x-requests-used");

    if (!r.ok) {
      return {
        arbs: [], eventsScanned: 0, bookmakers: [],
        requestsRemaining: remaining, requestsUsed: used,
        fetchedAt: new Date().toISOString(),
        error: `Odds API ${r.status}: ${(await r.text()).slice(0, 300)}`,
      };
    }

    const events = (await r.json()) as any[];
    const { odds, bookmakers } = eventsToOdds(events);
    const arbs = findArbitrages(odds, data.stake ?? 1000, data.minRoi ?? 0);

    return {
      arbs,
      eventsScanned: events.length,
      bookmakers: Array.from(bookmakers).sort(),
      requestsRemaining: remaining,
      requestsUsed: used,
      fetchedAt: new Date().toISOString(),
    };
  });

// Full multi-sport scan — saves results to DB. Used by the cron + manual button.
export const scanAllAndSave = createServerFn({ method: "POST" })
  .inputValidator((d: { sports?: string[]; regions?: string; markets?: string; stake?: number; minRoi?: number } | undefined) => d ?? {})
  .handler(async ({ data }): Promise<FullScanResult> => {
    const key = process.env.ODDS_API_KEY;
    if (!key) throw new Error("ODDS_API_KEY is not configured");
    const sports = data.sports?.length ? data.sports : DEFAULT_SPORTS;
    const regions = data.regions || "eu,uk,us";
    const markets = data.markets || "h2h";
    const stake = data.stake ?? 1000;
    const minRoi = data.minRoi ?? 1;

    const startedAt = Date.now();
    const supabase = getSupabase();
    const { data: runRow } = await supabase
      .from("scan_runs")
      .insert({ sports_scanned: sports })
      .select("id")
      .single();
    const runId: string | undefined = runRow?.id;

    let remaining: string | null = null;
    let used: string | null = null;
    const allOdds: OddRow[] = [];
    const allBms = new Set<string>();
    let totalEvents = 0;
    const perSport: FullScanResult["perSport"] = [];

    // Run all sports in parallel — each is one HTTP call to The Odds API (~1-2s)
    const results = await Promise.allSettled(
      sports.map(async (sport) => {
        const r = await fetchSportOdds(sport, regions, markets, key);
        const rem = r.headers.get("x-requests-remaining");
        const u = r.headers.get("x-requests-used");
        if (rem) remaining = rem;
        if (u) used = u;
        if (!r.ok) {
          throw new Error(`${r.status}: ${(await r.text()).slice(0, 120)}`);
        }
        const events = (await r.json()) as any[];
        const { odds, bookmakers } = eventsToOdds(events);
        return { sport, events: events.length, odds, bookmakers };
      })
    );

    for (let i = 0; i < results.length; i++) {
      const sport = sports[i];
      const res = results[i];
      if (res.status === "fulfilled") {
        totalEvents += res.value.events;
        allOdds.push(...res.value.odds);
        res.value.bookmakers.forEach((b) => allBms.add(b));
        perSport.push({ sport, events: res.value.events, arbs: 0 });
      } else {
        perSport.push({ sport, events: 0, arbs: 0, error: String(res.reason?.message || res.reason) });
      }
    }

    const arbs = findArbitrages(allOdds, stake, minRoi);

    // count arbs per sport
    for (const arb of arbs) {
      const sportIdx = perSport.findIndex((p) => p.sport.toLowerCase().includes(arb.sport.toLowerCase().split(" ")[0]));
      if (sportIdx >= 0) perSport[sportIdx].arbs += 1;
    }

    // Persist arbs (replace today's with fresh snapshot? we just append + clean stale on read)
    if (arbs.length) {
      const rows = arbs.map((a) => ({
        match_key: a.key,
        sport: a.sport,
        tournament: a.tournament,
        event_name: a.event_name,
        event_time: a.event_time,
        market: a.market,
        roi: a.roi,
        arb_percent: a.arbPercent,
        total_stake: a.totalStake,
        profit: a.profit,
        legs: a.legs,
        bookmakers: a.legs.map((l) => l.bookmaker_name),
        source: "odds_api",
      }));
      // upsert-like: delete previous rows for same match_key, then insert fresh
      const keys = Array.from(new Set(rows.map((r) => r.match_key)));
      await supabase.from("surebets").delete().in("match_key", keys);
      await supabase.from("surebets").insert(rows);
    }

    const durationMs = Date.now() - startedAt;

    if (runId) {
      await supabase
        .from("scan_runs")
        .update({
          finished_at: new Date().toISOString(),
          duration_ms: durationMs,
          events_scanned: totalEvents,
          bookmakers_count: allBms.size,
          arbs_found: arbs.length,
          requests_remaining: remaining,
        })
        .eq("id", runId);
    }

    // Cleanup very old surebets (>2 hours)
    await supabase
      .from("surebets")
      .delete()
      .lt("scanned_at", new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString());

    return {
      arbs,
      eventsScanned: totalEvents,
      bookmakers: Array.from(allBms).sort(),
      sportsScanned: sports,
      requestsRemaining: remaining,
      requestsUsed: used,
      durationMs,
      fetchedAt: new Date().toISOString(),
      perSport,
    };
  });

// Read latest stored surebets from DB for the UI
export const getStoredSurebets = createServerFn({ method: "GET" }).handler(async () => {
  const supabase = getSupabase();
  const { data: arbs } = await supabase
    .from("surebets")
    .select("*")
    .order("roi", { ascending: false })
    .limit(200);
  const { data: lastRun } = await supabase
    .from("scan_runs")
    .select("*")
    .order("started_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return { arbs: arbs ?? [], lastRun: lastRun ?? null };
});

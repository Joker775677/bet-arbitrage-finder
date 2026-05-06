import { createServerFn } from "@tanstack/react-start";
import { findArbitrages, type OddRow, type Arb } from "@/lib/arbitrage";

const BASE = "https://api.the-odds-api.com/v4";

export interface LiveScanResult {
  arbs: Arb[];
  eventsScanned: number;
  bookmakers: string[];
  requestsRemaining: string | null;
  requestsUsed: string | null;
  fetchedAt: string;
  error?: string;
}

export const listSports = createServerFn({ method: "GET" }).handler(async () => {
  const key = process.env.ODDS_API_KEY;
  if (!key) throw new Error("ODDS_API_KEY is not configured");
  const r = await fetch(`${BASE}/sports/?apiKey=${key}&all=false`);
  if (!r.ok) throw new Error(`Odds API error ${r.status}: ${await r.text()}`);
  return (await r.json()) as Array<{ key: string; group: string; title: string; active: boolean }>;
});

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
      const body = await r.text();
      return {
        arbs: [], eventsScanned: 0, bookmakers: [],
        requestsRemaining: remaining, requestsUsed: used,
        fetchedAt: new Date().toISOString(),
        error: `Odds API ${r.status}: ${body.slice(0, 300)}`,
      };
    }

    const events = (await r.json()) as Array<{
      id: string; sport_key: string; sport_title: string;
      commence_time: string; home_team: string; away_team: string;
      bookmakers: Array<{
        key: string; title: string; last_update: string;
        markets: Array<{ key: string; outcomes: Array<{ name: string; price: number }> }>;
      }>;
    }>;

    const odds: OddRow[] = [];
    const bmSet = new Set<string>();
    for (const ev of events) {
      const eventName = `${ev.home_team} vs ${ev.away_team}`;
      for (const bm of ev.bookmakers) {
        bmSet.add(bm.title);
        for (const m of bm.markets) {
          for (const o of m.outcomes) {
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

    const arbs = findArbitrages(odds, data.stake ?? 1000, data.minRoi ?? 0);

    return {
      arbs,
      eventsScanned: events.length,
      bookmakers: Array.from(bmSet).sort(),
      requestsRemaining: remaining,
      requestsUsed: used,
      fetchedAt: new Date().toISOString(),
    };
  });

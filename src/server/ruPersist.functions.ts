import { createServerFn } from "@tanstack/react-start";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

interface InMarket {
  market: string;
  selections: { outcome: string; odds: number }[];
}
interface InEvent {
  bookmaker: string;
  url?: string;
  sport?: string;
  league?: string;
  team1: string;
  team2: string;
  dateKey?: string;
  markets?: InMarket[];
  odds?: number[];
}
interface InSourceResult {
  name: string;
  url: string;
  events: InEvent[];
  error?: string;
  ms: number;
}

function eventKey(ev: InEvent): string {
  const t1 = (ev.team1 ?? "").toLowerCase().trim();
  const t2 = (ev.team2 ?? "").toLowerCase().trim();
  const [a, b] = t1 < t2 ? [t1, t2] : [t2, t1];
  const date = ev.dateKey ?? "any";
  const league = (ev.league ?? "").toLowerCase().trim();
  return `${league}|${date}|${a}|${b}`;
}

function legacyToMarkets(odds?: number[]): InMarket[] {
  if (!odds || odds.length < 2) return [];
  const labels = odds.length === 3 ? ["1", "X", "2"] : ["1", "2"];
  return [{
    market: "1X2",
    selections: odds.map((o, i) => ({ outcome: labels[i], odds: o })).filter((s) => s.outcome && Number.isFinite(s.odds) && s.odds > 1.01),
  }];
}

export const persistRuScan = createServerFn({ method: "POST" })
  .inputValidator((d: any) => ({
    results: (Array.isArray(d?.results) ? d.results : []) as InSourceResult[],
  }))
  .handler(async ({ data }) => {
    const now = new Date().toISOString();
    let savedEvents = 0;
    let savedOdds = 0;

    for (const br of data.results) {
      if (!br.events?.length) continue;

      const eventRows = br.events.map((ev) => ({
        source: br.name,
        sport: ev.sport ?? null,
        league: ev.league ?? null,
        team1: ev.team1,
        team2: ev.team2,
        event_name: `${ev.team1} — ${ev.team2}`,
        event_key: eventKey(ev),
        date_key: ev.dateKey ?? null,
        url: ev.url ?? br.url,
        scanned_at: now,
      }));

      // dedupe by (source, event_key) within batch
      const seen = new Set<string>();
      const uniqueRows = eventRows.filter((r) => {
        const k = `${r.source}|${r.event_key}`;
        if (seen.has(k)) return false;
        seen.add(k);
        return true;
      });

      const { data: upserted, error: evErr } = await supabaseAdmin
        .from("ru_events")
        .upsert(uniqueRows, { onConflict: "source,event_key" })
        .select("id, source, event_key");

      if (evErr) {
        console.error("[ruPersist] upsert events failed:", evErr.message);
        continue;
      }
      savedEvents += upserted?.length ?? 0;

      // map (source|event_key) -> id
      const idMap = new Map<string, string>();
      for (const row of upserted ?? []) {
        idMap.set(`${row.source}|${row.event_key}`, row.id as string);
      }

      const oddRows: any[] = [];
      for (const ev of br.events) {
        const id = idMap.get(`${br.name}|${eventKey(ev)}`);
        if (!id) continue;
        const markets = ev.markets?.length ? ev.markets : legacyToMarkets(ev.odds);
        for (const m of markets) {
          for (const s of m.selections ?? []) {
            if (!Number.isFinite(s.odds) || s.odds <= 1.01) continue;
            oddRows.push({
              event_id: id,
              market: m.market,
              outcome: s.outcome,
              odds: s.odds,
              scanned_at: now,
            });
          }
        }
      }

      if (oddRows.length) {
        // dedupe by (event_id, market, outcome)
        const oseen = new Set<string>();
        const uniqOdds = oddRows.filter((r) => {
          const k = `${r.event_id}|${r.market}|${r.outcome}`;
          if (oseen.has(k)) return false;
          oseen.add(k);
          return true;
        });
        const { error: odErr, count } = await supabaseAdmin
          .from("ru_odds")
          .upsert(uniqOdds, { onConflict: "event_id,market,outcome", count: "exact" });
        if (odErr) {
          console.error("[ruPersist] upsert odds failed:", odErr.message);
        } else {
          savedOdds += count ?? uniqOdds.length;
        }
      }
    }

    // Cleanup older than 24h
    try {
      await supabaseAdmin.rpc("cleanup_old_ru_data");
    } catch (e: any) {
      console.warn("[ruPersist] cleanup failed:", e?.message);
    }

    return { savedEvents, savedOdds, at: now };
  });

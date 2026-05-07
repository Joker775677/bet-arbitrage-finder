import { createFileRoute } from "@tanstack/react-router";
import { scanAllAndFindArbs } from "@/server/scanArbs.server";
import { createClient } from "@supabase/supabase-js";

function getSupabase() {
  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) throw new Error("Supabase env not configured");
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

export const Route = createFileRoute("/api/public/scan-ru")({
  server: {
    handlers: {
      GET: async () => runRuScan(),
      POST: async () => runRuScan(),
    },
  },
});

async function runRuScan() {
  const startedAt = Date.now();
  try {
    const result = await scanAllAndFindArbs({ data: { stake: 10000, minRoi: 1, persistRaw: false } });
    const supabase = getSupabase();
    const responseBody = {
      ok: true,
      arbs: result.arbs.length,
      arbList: result.arbs,
      stats: result.stats ?? [],
      bookies: result.stats?.length ?? 0,
      totalOdds: result.totalOdds ?? 0,
      uniqueEvents: result.uniqueEvents ?? 0,
      matchedEvents: result.matchedEvents ?? 0,
      matchedLive: result.matchedLive ?? 0,
      matchedPrematch: result.matchedPrematch ?? 0,
      arbsLive: result.arbsLive ?? 0,
      arbsPrematch: result.arbsPrematch ?? 0,
      nearArbs: result.nearArbs ?? [],
      nearArbsWide: result.nearArbsWide ?? [],
      nearArbsWideLive: result.nearArbsWideLive ?? [],
      nearArbsWidePrematch: result.nearArbsWidePrematch ?? [],
      marketDiagnostics: result.marketDiagnostics ?? [],
      diagnosticSkippedDc: result.diagnosticSkippedDc ?? 0,
      durationMs: Date.now() - startedAt,
      scannedAt: result.scannedAt,
    };

    // Save run
    const { data: runRow } = await supabase
      .from("scan_runs")
      .insert({
        sports_scanned: ["ru-engine"],
        events_scanned: result.uniqueEvents ?? result.matchedEvents ?? 0,
        bookmakers_count: result.stats?.length ?? 0,
        arbs_found: result.arbs.length,
        duration_ms: Date.now() - startedAt,
        finished_at: new Date().toISOString(),
        result_snapshot: responseBody,
      })
      .select("id")
      .single();

    if (result.arbs.length) {
      const rows = result.arbs.map((a: any) => ({
        match_key: `ru:${a.key}`,
        sport: a.sport ?? "Football",
        tournament: a.tournament,
        event_name: a.event_name,
        event_time: a.event_time,
        market: a.market,
        roi: a.roi,
        arb_percent: a.arbPercent,
        total_stake: a.totalStake,
        profit: a.profit,
        legs: a.legs,
        bookmakers: a.legs.map((l: any) => l.bookmaker_name),
        source: "ru_engine",
      }));
      const keys = Array.from(new Set(rows.map((r) => r.match_key)));
      await supabase.from("surebets").delete().in("match_key", keys);
      await supabase.from("surebets").insert(rows);
    }

    return Response.json({ ...responseBody, runId: runRow?.id });
  } catch (e: any) {
    return Response.json({ ok: false, error: String(e?.message || e) }, { status: 500 });
  }
}

import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { scanAllAndFindArbs } from "@/server/scanArbs.server";

type RuScanSnapshot = {
  arbList?: unknown[];
  uniqueEvents?: number;
  matchedEvents?: number;
  bookies?: number;
  durationMs?: number;
  scannedAt?: string;
  error?: string;
};

export async function runRuSurebetsScanImpl(input?: { stake?: number; minRoi?: number }) {
  const startedAt = Date.now();
  const result = await scanAllAndFindArbs({
    data: {
      stake: typeof input?.stake === "number" ? input.stake : 10000,
      minRoi: typeof input?.minRoi === "number" ? input.minRoi : 0,
      persistRaw: false,
    },
  });

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

  const { data: runRow, error: runError } = await supabaseAdmin
    .from("scan_runs")
    .insert({
      sports_scanned: ["ru-engine"],
      events_scanned: result.uniqueEvents ?? result.matchedEvents ?? 0,
      bookmakers_count: result.stats?.length ?? 0,
      arbs_found: result.arbs.length,
      duration_ms: responseBody.durationMs,
      finished_at: new Date().toISOString(),
      result_snapshot: responseBody as any,
    })
    .select("id")
    .single();

  if (runError) {
    throw new Error(`scan_runs insert: ${runError.message}`);
  }

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

  const { error: deleteError } = await supabaseAdmin.from("surebets").delete().eq("source", "ru_engine");
  if (deleteError) {
    throw new Error(`surebets cleanup: ${deleteError.message}`);
  }

  if (rows.length) {
    const { error: insertError } = await supabaseAdmin.from("surebets").insert(rows);
    if (insertError) {
      throw new Error(`surebets insert: ${insertError.message}`);
    }
  }

  return { ...responseBody, runId: runRow?.id };
}

export async function getRuSurebetsViewImpl() {
  const { data: latestRun, error: runError } = await supabaseAdmin
    .from("scan_runs")
    .select("started_at, duration_ms, events_scanned, bookmakers_count, requests_remaining, error, result_snapshot")
    .contains("sports_scanned", ["ru-engine"])
    .order("started_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (runError) {
    throw new Error(`scan_runs select: ${runError.message}`);
  }

  const snapshot = (latestRun?.result_snapshot ?? null) as RuScanSnapshot | null;
  if (snapshot) {
    return {
      arbs: Array.isArray(snapshot.arbList) ? snapshot.arbList : [],
      lastRun: {
        started_at: latestRun?.started_at,
        duration_ms: latestRun?.duration_ms ?? snapshot.durationMs ?? null,
        events_scanned: latestRun?.events_scanned ?? snapshot.uniqueEvents ?? snapshot.matchedEvents ?? 0,
        bookmakers_count: latestRun?.bookmakers_count ?? snapshot.bookies ?? 0,
        requests_remaining: latestRun?.requests_remaining ?? null,
        error: latestRun?.error ?? snapshot.error ?? null,
      },
    };
  }

  const { data: arbs, error: arbsError } = await supabaseAdmin
    .from("surebets")
    .select("*")
    .eq("source", "ru_engine")
    .order("roi", { ascending: false })
    .limit(200);

  if (arbsError) {
    throw new Error(`surebets select: ${arbsError.message}`);
  }

  return {
    arbs: arbs ?? [],
    lastRun: latestRun
      ? {
          started_at: latestRun.started_at,
          duration_ms: latestRun.duration_ms,
          events_scanned: latestRun.events_scanned,
          bookmakers_count: latestRun.bookmakers_count,
          requests_remaining: latestRun.requests_remaining,
          error: latestRun.error,
        }
      : null,
  };
}
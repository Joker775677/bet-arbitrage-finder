import { createFileRoute } from "@tanstack/react-router";
import { scanRussianBookies } from "@/server/ruScanner.functions";
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
      GET: async () => {
        const startedAt = Date.now();
        try {
          const result = await scanRussianBookies({ data: { stake: 10000, minRoi: 1 } });
          const supabase = getSupabase();

          // Save run
          const { data: runRow } = await supabase
            .from("scan_runs")
            .insert({
              sports_scanned: ["ru-scrape"],
              events_scanned: result.matchedEvents ?? 0,
              bookmakers_count: result.stats?.length ?? 0,
              arbs_found: result.arbs.length,
              duration_ms: Date.now() - startedAt,
              finished_at: new Date().toISOString(),
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
              source: "ru_scrape",
            }));
            const keys = Array.from(new Set(rows.map((r) => r.match_key)));
            await supabase.from("surebets").delete().in("match_key", keys);
            await supabase.from("surebets").insert(rows);
          }

          return Response.json({
            ok: true,
            arbs: result.arbs.length,
            bookies: result.stats?.length ?? 0,
            durationMs: Date.now() - startedAt,
            runId: runRow?.id,
          });
        } catch (e: any) {
          return Response.json({ ok: false, error: String(e?.message || e) }, { status: 500 });
        }
      },
    },
  },
});

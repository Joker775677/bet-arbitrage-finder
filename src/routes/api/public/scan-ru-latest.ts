import { createFileRoute } from "@tanstack/react-router";
import { createClient } from "@supabase/supabase-js";

function getSupabase() {
  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) throw new Error("Supabase env not configured");
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

export const Route = createFileRoute("/api/public/scan-ru-latest")({
  server: {
    handlers: {
      GET: async () => {
        try {
          const supabase = getSupabase();
          const { data, error } = await supabase
            .from("scan_runs")
            .select("id, started_at, finished_at, result_snapshot")
            .contains("sports_scanned", ["ru-engine"])
            .not("result_snapshot", "is", null)
            .order("started_at", { ascending: false })
            .limit(1)
            .maybeSingle();

          if (error) throw error;
          if (!data?.result_snapshot) return Response.json({ ok: false, error: "No RU scan snapshot yet" }, { status: 404 });

          return Response.json({
            ...(data.result_snapshot as Record<string, unknown>),
            latest: true,
            runId: data.id,
            runStartedAt: data.started_at,
            runFinishedAt: data.finished_at,
          });
        } catch (e: any) {
          return Response.json({ ok: false, error: String(e?.message || e) }, { status: 500 });
        }
      },
    },
  },
});

import { createFileRoute } from "@tanstack/react-router";
import { getStoredSurebets } from "@/lib/oddsApi.functions";

export const Route = createFileRoute("/api/v1/surebets")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const url = new URL(request.url);
        const minRoi = Number(url.searchParams.get("min_roi") ?? "0");
        const limit = Math.min(Number(url.searchParams.get("limit") ?? "100"), 500);
        const { arbs, lastRun } = await getStoredSurebets();
        const filtered = (arbs as any[])
          .filter((a) => Number(a.roi) >= minRoi)
          .slice(0, limit)
          .map((a) => ({
            id: a.id,
            sport: a.sport,
            event: a.event_name,
            event_time: a.event_time,
            market: a.market,
            roi_pct: Number(a.roi),
            profit: Number(a.profit),
            total_stake: Number(a.total_stake),
            bookmakers: a.bookmakers,
            legs: a.legs,
            scanned_at: a.scanned_at,
          }));
        return Response.json({
          surebets: filtered,
          count: filtered.length,
          last_scan: lastRun,
        });
      },
    },
  },
});

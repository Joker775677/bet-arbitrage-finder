import { createFileRoute } from "@tanstack/react-router";
import { scanAllAndSave } from "@/lib/oddsApi.functions";

export const Route = createFileRoute("/api/public/scan")({
  server: {
    handlers: {
      GET: async () => {
        try {
          const result = await scanAllAndSave({ data: {} });
          return Response.json({
            ok: true,
            arbs: result.arbs.length,
            events: result.eventsScanned,
            bookmakers: result.bookmakers.length,
            sports: result.sportsScanned.length,
            durationMs: result.durationMs,
            requestsRemaining: result.requestsRemaining,
            perSport: result.perSport,
          });
        } catch (e: any) {
          return Response.json({ ok: false, error: String(e?.message || e) }, { status: 500 });
        }
      },
      POST: async () => {
        try {
          const result = await scanAllAndSave({ data: {} });
          return Response.json({ ok: true, arbs: result.arbs.length, events: result.eventsScanned });
        } catch (e: any) {
          return Response.json({ ok: false, error: String(e?.message || e) }, { status: 500 });
        }
      },
    },
  },
});

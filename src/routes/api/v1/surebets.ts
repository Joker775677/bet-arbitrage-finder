import { createFileRoute } from "@tanstack/react-router";

const API_BASE = process.env.SUREBETS_API_URL || "http://api-service:4000";

export const Route = createFileRoute("/api/v1/surebets")({
  server: {
    handlers: {
      GET: async () => {
        try {
          const r = await fetch(`${API_BASE}/api/v1/surebets`);
          const j = await r.json();
          return Response.json(j);
        } catch (e: any) {
          return Response.json({ ok: false, arbs: [], lastRun: null, error: String(e?.message || e) }, { status: 502 });
        }
      },
    },
  },
});

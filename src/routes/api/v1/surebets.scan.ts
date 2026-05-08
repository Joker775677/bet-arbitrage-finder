import { createFileRoute } from "@tanstack/react-router";

const API_BASE = process.env.SUREBETS_API_URL || "http://api-service:4000";

export const Route = createFileRoute("/api/v1/surebets/scan")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        try {
          const body = await request.text();
          const r = await fetch(`${API_BASE}/api/v1/surebets/scan`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: body || "{}",
          });
          const j = await r.json();
          return Response.json(j);
        } catch (e: any) {
          return Response.json({ ok: false, error: String(e?.message || e) }, { status: 502 });
        }
      },
    },
  },
});

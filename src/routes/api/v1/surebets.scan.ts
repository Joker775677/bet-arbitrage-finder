import { createFileRoute } from "@tanstack/react-router";

const API_BASE = process.env.SUREBETS_API_URL || "http://api-service:4000";

export const Route = createFileRoute("/api/v1/surebets/scan")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        try {
          const body = await request.json().catch(() => ({}));
          const upstream = await fetch(`${API_BASE}/api/v1/surebets/scan`, {
            method: "POST",
            headers: { "content-type": "application/json", accept: "application/json" },
            body: JSON.stringify({ stake: Number(body.stake || 10000), minRoi: Number(body.minRoi || 0) }),
            signal: AbortSignal.timeout(120_000),
          });
          const payload = await upstream.json();
          return Response.json(payload, { status: upstream.ok ? 200 : upstream.status });
        } catch (error) {
          return Response.json(
            { ok: false, error: error instanceof Error ? error.message : "fetch failed" },
            { status: 502 },
          );
        }
      },
    },
  },
});
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/v1/surebets")({
  server: {
    handlers: {
      GET: async () => {
        try {
          const apiBase = process.env.SUREBETS_API_URL || "http://api-service:4000";
          const upstream = await fetch(`${apiBase}/api/v1/surebets`, {
            headers: { accept: "application/json" },
            signal: AbortSignal.timeout(30_000),
          });
          const payload = await upstream.json();
          return Response.json(
            { ok: upstream.ok, arbs: payload.arbs ?? [], lastRun: payload.lastRun ?? null },
            { status: upstream.ok ? 200 : upstream.status },
          );
        } catch (error) {
          return Response.json(
            { ok: false, arbs: [], lastRun: null, error: error instanceof Error ? error.message : "fetch failed" },
            { status: 502 },
          );
        }
      },
    },
  },
});
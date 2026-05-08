import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/v1/surebets")({
  server: {
    handlers: {
      GET: async () => {
        try {
          const { getRuSurebetsViewImpl } = await import("@/server/ruSurebets.server");
          const payload = await getRuSurebetsViewImpl();
          return Response.json({ ok: true, ...payload });
        } catch (error) {
          return Response.json(
            {
              ok: false,
              arbs: [],
              lastRun: null,
              error: error instanceof Error ? error.message : "fetch failed",
            },
            { status: 502 },
          );
        }
      },
    },
  },
});

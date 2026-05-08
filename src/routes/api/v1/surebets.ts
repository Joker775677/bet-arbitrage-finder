import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/v1/surebets")({
  server: {
    handlers: {
      GET: async () => {
        try {
          const { getStoredSurebetsImpl } = await import("@/server/oddsApi.server");
          const payload = await getStoredSurebetsImpl();
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

import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/v1/surebets/scan")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        try {
          const body = await request.json().catch(() => ({}));
          const { runRuSurebetsScanImpl } = await import("@/server/ruSurebets.server");
          const result = await runRuSurebetsScanImpl({
            stake: typeof body?.stake === "number" ? body.stake : 10000,
            minRoi: typeof body?.minRoi === "number" ? body.minRoi : 0,
          });
          return Response.json(result);
        } catch (error) {
          return Response.json(
            { ok: false, error: error instanceof Error ? error.message : "scan failed" },
            { status: 500 },
          );
        }
      },
    },
  },
});

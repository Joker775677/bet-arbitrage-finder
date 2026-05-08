import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/public/scan-ru")({
  server: {
    handlers: {
      GET: async () => runRuScan(),
      POST: async () => runRuScan(),
    },
  },
});

async function runRuScan() {
  try {
    const { runRuSurebetsScanImpl } = await import("@/server/ruSurebets.server");
    return Response.json(await runRuSurebetsScanImpl({ stake: 10000, minRoi: 0 }));
  } catch (e: any) {
    return Response.json({ ok: false, error: String(e?.message || e) }, { status: 500 });
  }
}

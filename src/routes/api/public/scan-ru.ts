import { createFileRoute } from "@tanstack/react-router";
import { runRuSurebetsScanImpl } from "@/server/ruSurebets.server";

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
    return Response.json(await runRuSurebetsScanImpl({ stake: 10000, minRoi: 0 }));
  } catch (e: any) {
    return Response.json({ ok: false, error: String(e?.message || e) }, { status: 500 });
  }
}

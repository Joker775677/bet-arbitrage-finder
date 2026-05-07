import { createServerFn } from "@tanstack/react-start";

export type EngineKey = "fonbet" | "pari" | "leon" | "zenit" | "winline";

export const scanAllAndFindArbsRpc = createServerFn({ method: "POST" })
  .inputValidator((d: any) => ({
    stake: typeof d?.stake === "number" && d.stake > 0 ? d.stake : 10000,
    minRoi: typeof d?.minRoi === "number" ? d.minRoi : 0,
  }))
  .handler(async ({ data }) => {
    const { scanAllAndFindArbs } = await import("@/server/scanArbs.server");
    return scanAllAndFindArbs({ data });
  });

export const importFonbetRpc = createServerFn({ method: "POST" }).handler(async () => {
  const { importFonbet } = await import("@/lib/fonbetImport.functions");
  return importFonbet({});
});

export const importPariRpc = createServerFn({ method: "POST" }).handler(async () => {
  const { importPari } = await import("@/lib/fonbetImport.functions");
  return importPari({});
});

export const importLeonRpc = createServerFn({ method: "POST" }).handler(async () => {
  const { importLeon } = await import("@/lib/fonbetImport.functions");
  return importLeon({});
});

export const importZenitRpc = createServerFn({ method: "POST" }).handler(async () => {
  const { importZenit } = await import("@/lib/fonbetImport.functions");
  return importZenit({});
});

export const importWinlineRpc = createServerFn({ method: "POST" }).handler(async () => {
  const { importWinline } = await import("@/lib/fonbetImport.functions");
  return importWinline({});
});

export const fetchEngineRawRpc = createServerFn({ method: "POST" })
  .inputValidator((d: { engine: EngineKey }) => {
    if (!d || !["fonbet", "pari", "leon", "zenit", "winline"].includes(d.engine)) {
      throw new Error("invalid engine");
    }
    return { engine: d.engine };
  })
  .handler(async ({ data }) => {
    const { fetchEngineRaw } = await import("@/server/fetchEngineRaw.functions");
    return fetchEngineRaw({ data });
  });

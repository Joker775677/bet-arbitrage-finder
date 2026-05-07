import { createServerFn } from "@tanstack/react-start";

export const listSports = createServerFn({ method: "GET" }).handler(async () => {
  const { listSportsImpl } = await import("./oddsApi.server");
  return listSportsImpl();
});

export const scanLive = createServerFn({ method: "POST" })
  .inputValidator((d: { sport: string; regions?: string; markets?: string; stake?: number; minRoi?: number; bookmakers?: string[] }) => d)
  .handler(async ({ data }) => {
    const { scanLiveImpl } = await import("./oddsApi.server");
    return scanLiveImpl(data);
  });

export const scanAllAndSave = createServerFn({ method: "POST" })
  .inputValidator((d: { sports?: string[]; regions?: string; markets?: string; stake?: number; minRoi?: number } | undefined) => d ?? {})
  .handler(async ({ data }) => {
    const { scanAllAndSaveImpl } = await import("./oddsApi.server");
    return scanAllAndSaveImpl(data);
  });

export const getStoredSurebets = createServerFn({ method: "GET" }).handler(async () => {
  const { getStoredSurebetsImpl } = await import("./oddsApi.server");
  return getStoredSurebetsImpl();
});

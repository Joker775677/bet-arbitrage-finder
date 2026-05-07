import { createServerFn } from "@tanstack/react-start";
import {
  listSportsImpl,
  scanLiveImpl,
  scanAllAndSaveImpl,
  getStoredSurebetsImpl,
} from "./oddsApi.server";

export type { LiveScanResult, FullScanResult } from "./oddsApi.server";
export { DEFAULT_SPORTS, ALLOWED_BOOKMAKERS } from "./oddsApi.server";

export const listSports = createServerFn({ method: "GET" }).handler(() => listSportsImpl());

export const scanLive = createServerFn({ method: "POST" })
  .inputValidator((d: { sport: string; regions?: string; markets?: string; stake?: number; minRoi?: number; bookmakers?: string[] }) => d)
  .handler(({ data }) => scanLiveImpl(data));

export const scanAllAndSave = createServerFn({ method: "POST" })
  .inputValidator((d: { sports?: string[]; regions?: string; markets?: string; stake?: number; minRoi?: number } | undefined) => d ?? {})
  .handler(({ data }) => scanAllAndSaveImpl(data));

export const getStoredSurebets = createServerFn({ method: "GET" }).handler(() => getStoredSurebetsImpl());

import type { Arb } from "@/lib/arbitrage";

export interface LiveScanResult {
  arbs: Arb[];
  eventsScanned: number;
  bookmakers: string[];
  requestsRemaining: string | null;
  requestsUsed: string | null;
  fetchedAt: string;
  error?: string;
}

export interface FullScanResult {
  arbs: Arb[];
  eventsScanned: number;
  bookmakers: string[];
  sportsScanned: string[];
  requestsRemaining: string | null;
  requestsUsed: string | null;
  durationMs: number;
  fetchedAt: string;
  perSport: Array<{ sport: string; events: number; arbs: number; error?: string }>;
}

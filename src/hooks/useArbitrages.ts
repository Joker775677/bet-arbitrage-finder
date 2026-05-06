import { useMemo } from "react";
import { useBookmakers, useOdds, useSettings } from "@/hooks/useArbData";
import { findArbitrages, type OddRow } from "@/lib/arbitrage";

export function useArbitrages(stakeOverride?: number, minRoiOverride?: number) {
  const { data: bookmakers = [] } = useBookmakers();
  const { data: odds = [] } = useOdds();
  const { data: settings } = useSettings();

  return useMemo(() => {
    const bmMap = new Map(bookmakers.map(b => [b.id, b]));
    const activeOdds: OddRow[] = odds
      .filter((o: any) => bmMap.get(o.bookmaker_id)?.is_active)
      .map((o: any) => ({
        id: o.id,
        bookmaker_id: o.bookmaker_id,
        bookmaker_name: bmMap.get(o.bookmaker_id)?.name ?? "—",
        sport: o.sport,
        tournament: o.tournament,
        event_name: o.event_name,
        event_time: o.event_time,
        market: o.market,
        outcome: o.outcome,
        odds: Number(o.odds),
      }));
    const stake = stakeOverride ?? Number(settings?.default_stake ?? 1000);
    const minRoi = minRoiOverride ?? Number(settings?.min_roi ?? 0);
    return findArbitrages(activeOdds, stake, minRoi);
  }, [bookmakers, odds, settings, stakeOverride, minRoiOverride]);
}

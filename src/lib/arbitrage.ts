// Pure arbitrage detection module.
// Compares odds across bookmakers for the same event+market and finds arbs.

export interface OddRow {
  id: string;
  bookmaker_id: string;
  bookmaker_name?: string;
  sport: string;
  tournament: string | null;
  event_name: string;
  event_time: string | null;
  market: string;
  outcome: string;
  odds: number;
  url?: string;
}

export interface ArbLeg {
  outcome: string;
  odds: number;
  bookmaker_id: string;
  bookmaker_name: string;
  stake: number;
  payout: number;
  url?: string;
}

export interface Arb {
  key: string;
  sport: string;
  tournament: string | null;
  event_name: string;
  event_time: string | null;
  market: string;
  legs: ArbLeg[];
  arbPercent: number; // sum of inverse odds (<1 means arb)
  roi: number;       // (1/arbPercent - 1) * 100
  totalStake: number;
  profit: number;
}

const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, " ");

export function findArbitrages(
  odds: OddRow[],
  totalStake = 1000,
  minRoi = 0,
): Arb[] {
  // Group by event + market
  const groups = new Map<string, OddRow[]>();
  for (const o of odds) {
    const key = `${norm(o.sport)}|${norm(o.event_name)}|${norm(o.market)}`;
    const arr = groups.get(key) ?? [];
    arr.push(o);
    groups.set(key, arr);
  }

  const arbs: Arb[] = [];

  for (const [key, rows] of groups) {
    // best odds per outcome
    const bestByOutcome = new Map<string, OddRow>();
    for (const r of rows) {
      const k = norm(r.outcome);
      const cur = bestByOutcome.get(k);
      if (!cur || r.odds > cur.odds) bestByOutcome.set(k, r);
    }
    if (bestByOutcome.size < 2) continue;

    // Need legs from at least 2 different bookmakers (otherwise not a real arb)
    const distinctBms = new Set(Array.from(bestByOutcome.values()).map(r => r.bookmaker_id));
    if (distinctBms.size < 2) continue;

    const legs = Array.from(bestByOutcome.values());
    const arbPercent = legs.reduce((s, l) => s + 1 / l.odds, 0);
    if (arbPercent >= 1) continue;

    const roi = (1 / arbPercent - 1) * 100;
    if (roi < minRoi) continue;

    const computedLegs: ArbLeg[] = legs.map(l => {
      const stake = (totalStake * (1 / l.odds)) / arbPercent;
      return {
        outcome: l.outcome,
        odds: l.odds,
        bookmaker_id: l.bookmaker_id,
        bookmaker_name: l.bookmaker_name ?? "—",
        stake: round2(stake),
        payout: round2(stake * l.odds),
        url: l.url,
      };
    });

    const profit = round2(computedLegs[0].payout - totalStake);
    const first = legs[0];

    arbs.push({
      key,
      sport: first.sport,
      tournament: first.tournament,
      event_name: first.event_name,
      event_time: first.event_time,
      market: first.market,
      legs: computedLegs,
      arbPercent,
      roi,
      totalStake,
      profit,
    });
  }

  arbs.sort((a, b) => b.roi - a.roi);
  return arbs;
}

function round2(n: number) { return Math.round(n * 100) / 100; }

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
  live?: boolean;
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
  live: boolean;
}

export interface NearArb {
  key: string;
  sport: string;
  event_name: string;
  market: string;
  arbPercent: number; // > 1
  legs: { outcome: string; odds: number; bookmaker_name: string; url?: string }[];
  live: boolean;
}


const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, " ");

const DRAW_SPORT_RE = /(футбол|soccer|football|мини-футбол|futsal|водное поло|water polo|шахмат|chess)/i;
const TWO_WAY_SPORT_RE = /(теннис|tennis|настольный теннис|table tennis|баскетбол|basket|волейбол|volley|бейсбол|baseball|mlb|afl|регби|rugby|mma|ufc|бокс|boxing|крикет|cricket|бадминтон|badminton|хоккей|hockey|nhl|хоккейбол)/i;

// Сколько исходов должно быть в рынке, чтобы он считался "полным".
// Важно: некоторые БК отдают двухисходные рынки победителя как "1X2".
// Для футбола/шахмат без X такой рынок неполный, а для no-draw спортов 1/2 — валидная пара.
function expectedOutcomes(market: string, rows: OddRow[]): number {
  const m = market.toUpperCase();
  const outcomes = new Set(rows.map((r) => norm(r.outcome)));
  const sportText = rows.map((r) => r.sport).join(" ");
  if (m === "1X2") {
    if (outcomes.has("x")) return 3;
    if (outcomes.has("1") && outcomes.has("2") && TWO_WAY_SPORT_RE.test(sportText) && !DRAW_SPORT_RE.test(sportText)) return 2;
    return 3;
  }
  if (m === "DC") return 3;
  if (m === "BTTS") return 2;
  if (m.startsWith("TOTAL") || m.startsWith("TEAM_TOTAL") || m.startsWith("HANDICAP") || m === "OU") return 2;
  return 2;
}

// Фильтр явно мусорных названий команд/событий, чтобы не ловить "гости — хозяева" и т.п.
const JUNK_TEAM_RE = /\b(хозяева|гости|home|away|team\s*[12])\b/i;

export function findArbitrages(
  odds: OddRow[],
  totalStake = 1000,
  minRoi = 0,
): Arb[] {
  // Group by event + market (+ линия для гандикапов/тоталов)
  const groups = new Map<string, OddRow[]>();
  for (const o of odds) {
    if (JUNK_TEAM_RE.test(o.event_name)) continue;
    const m = o.market.toUpperCase();
    let groupMarket = o.market;
    if (m === "HANDICAP" || m.startsWith("TOTAL") || m.startsWith("TEAM_TOTAL")) {
      // outcome выглядит как "1 -1.5" / "Over 2.5" / "Under 2.5"
      const lineMatch = o.outcome.match(/-?\d+(?:\.\d+)?/);
      const line = lineMatch ? Math.abs(parseFloat(lineMatch[0])) : null;
      if (line === null) continue;
      groupMarket = `${o.market}@${line}`;
    }
    const key = `${norm(o.sport)}|${norm(o.event_name)}|${norm(groupMarket)}`;
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

    // Должны быть ВСЕ исходы рынка — иначе это не вилка, а кривой набор.
    const need = expectedOutcomes(rows[0].market, rows);
    if (bestByOutcome.size !== need) continue;

    // Need legs from at least 2 different bookmakers (otherwise not a real arb)
    const distinctBms = new Set(Array.from(bestByOutcome.values()).map(r => r.bookmaker_id));
    if (distinctBms.size < 2) continue;

    const legs = Array.from(bestByOutcome.values());
    const arbPercent = legs.reduce((s, l) => s + 1 / l.odds, 0);
    if (arbPercent >= 1) continue;

    const roi = (1 / arbPercent - 1) * 100;
    if (roi < minRoi) continue;
    // Отсекаем нереалистичные ROI (>30% — почти наверняка ошибка маппинга/исхода)
    if (roi > 30) continue;

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

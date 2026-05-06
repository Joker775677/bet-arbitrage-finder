import { createServerFn } from "@tanstack/react-start";
import { findArbitrages, type OddRow, type Arb } from "@/lib/arbitrage";

const FIRECRAWL = "https://api.firecrawl.dev/v2/scrape";

interface RawEvent {
  bookmaker: string;
  url: string;
  team1: string;
  team2: string;
  odds: [number, number, number]; // 1, X, 2
}

async function fcScrape(url: string, waitFor = 6000): Promise<string> {
  const key = process.env.FIRECRAWL_API_KEY;
  if (!key) throw new Error("FIRECRAWL_API_KEY not configured");
  const r = await fetch(FIRECRAWL, {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({ url, formats: ["markdown"], onlyMainContent: true, waitFor }),
  });
  const j: any = await r.json();
  if (!j.success) throw new Error(`Firecrawl: ${JSON.stringify(j).slice(0, 200)}`);
  return j.data?.markdown ?? "";
}

// Strip base64 noise: long alphanumeric blobs without whitespace
function clean(md: string): string[] {
  return md
    .replace(/[A-Za-z0-9+/=]{200,}/g, "")
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
}

const ODDS_3 = /^(\d{1,2}\.\d{2})(\d{1,2}\.\d{2})(\d{1,2}\.\d{2})$/;
const LINK_EVENT = /^\[([^[\]]+?)\s+(?:[—–-])\s+([^[\]]+?)\]\((https?:\/\/[^\s)]+)\)/;
const LINK_EVENT_2SP = /^\[([^[\]]+?)\s{2,}([^[\]]+?)\]\((https?:\/\/[^\s)]+)\)/;

function parseEventLine(line: string): { team1: string; team2: string; url: string } | null {
  let m = line.match(LINK_EVENT);
  if (!m) m = line.match(LINK_EVENT_2SP);
  if (!m) return null;
  return { team1: m[1].trim(), team2: m[2].trim(), url: m[3] };
}

function parseOdds3(s: string): [number, number, number] | null {
  // try concatenated "1.752.504.20" → split heuristically
  const m = s.match(ODDS_3);
  if (m) {
    const a = [Number(m[1]), Number(m[2]), Number(m[3])] as [number, number, number];
    if (a.every((x) => x > 1.01 && x < 100)) return a;
  }
  // try 3 separate numbers in line
  const all = s.match(/\d{1,2}\.\d{2}/g);
  if (all && all.length >= 3) {
    const a = all.slice(0, 3).map(Number) as [number, number, number];
    if (a.every((x) => x > 1.01 && x < 100)) return a;
  }
  return null;
}

// Parse Winline / Fonbet style: [team1  team2](url) on one line, odds on next lines
// Skip cybersports / virtual / non-real events
function isJunkEvent(team1: string, team2: string, url: string): boolean {
  const blob = `${team1} ${team2} ${url}`.toLowerCase();
  // Esports/FIFA player tags in parentheses, e.g. "Bayern (Shrek)"
  if (/\([^)]+\)/.test(team1) || /\([^)]+\)/.test(team2)) return true;
  // Fonbet category 118 = FIFA cybersport
  if (/\/category\/118\//.test(url)) return true;
  // Common esports / virtual markers
  if (/(cyber|fifa|киберфутбол|виртуал|esoccer|e-?sport|efootball)/i.test(blob)) return true;
  return false;
}

function parseGenericLine(lines: string[], bookmaker: string): RawEvent[] {
  const out: RawEvent[] = [];
  for (let i = 0; i < lines.length; i++) {
    const ev = parseEventLine(lines[i]);
    if (!ev) continue;
    if (isJunkEvent(ev.team1, ev.team2, ev.url)) continue;
    const window = lines.slice(i + 1, i + 6).join(" ");
    const odds = parseOdds3(window) ?? parseOdds3(lines[i + 1] ?? "");
    if (odds) out.push({ bookmaker, url: ev.url, team1: ev.team1, team2: ev.team2, odds });
  }
  return out;
}

// Marathonbet markdown stores events as table rows like:
//   | Суперприз<br>**1.**<br>[Team1](url)<br>...<br>**2.**<br>[Team2](url)<br>... |
//   | --- |
//   |  |
//   | +N | | 1.63 | 5.35 | 4.45 | 1.26 | 1.195 | 2.44 | ...
function parseMarathonbet(md: string, bookmaker: string): RawEvent[] {
  const out: RawEvent[] = [];
  // Strip image markdown so it doesn't pollute
  const cleaned = md
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
    .replace(/[A-Za-z0-9+/=]{200,}/g, "");
  const lines = cleaned.split("\n");
  const rowRe =
    /\*\*1\.\*\*<br>\[([^\]]+?)\]\((https?:\/\/[^\s)]+)\)[\s\S]*?\*\*2\.\*\*<br>\[([^\]]+?)\]\((https?:\/\/[^\s)]+)\)/;
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(rowRe);
    if (!m) continue;
    const team1 = m[1].trim();
    const team2 = m[3].trim();
    const url = m[2];
    if (isJunkEvent(team1, team2, url)) continue;
    // Look for odds row in next ~6 lines, with leading "| +<digits> |" or just three odds
    for (let j = i + 1; j < Math.min(i + 7, lines.length); j++) {
      const oddsMatches = lines[j].match(/\b\d{1,2}\.\d{2,3}\b/g);
      if (oddsMatches && oddsMatches.length >= 3 && lines[j].includes("|")) {
        const a = oddsMatches.slice(0, 3).map(Number) as [number, number, number];
        if (a.every((x) => x > 1.01 && x < 100)) {
          out.push({ bookmaker, url, team1, team2, odds: a });
          break;
        }
      }
    }
  }
  return out;
}

// === Team name normalization ===
// Map common EN ↔ RU spellings to a canonical form
const SYNONYMS: Record<string, string> = {
  // Russian → canonical (lowercase)
  "бавария": "bayern", "псж": "psg", "арсенал": "arsenal", "атлетико мадрид": "atletico",
  "атлетико": "atletico", "спартак м": "spartak", "спартак москва": "spartak",
  "цска м": "cska", "цска москва": "cska", "локомотив": "lokomotiv", "зенит": "zenit",
  "динамо м": "dynamo", "динамо москва": "dynamo", "краснодар": "krasnodar",
  "ростов": "rostov", "рубин": "rubin", "ливерпуль": "liverpool", "челси": "chelsea",
  "манчестер сити": "man city", "манчестер юнайтед": "man utd", "тоттенхэм": "tottenham",
  "реал мадрид": "real madrid", "реал": "real madrid", "барселона": "barcelona",
  "ювентус": "juventus", "интер": "inter", "милан": "milan", "наполи": "napoli",
  "боруссия д": "dortmund", "боруссия дортмунд": "dortmund", "лейпциг": "leipzig",
  "пари сен-жермен": "psg", "пари сен жермен": "psg", "марсель": "marseille",
  "аякс": "ajax", "порту": "porto", "бенфика": "benfica", "шахтер": "shakhtar",
  "шахтер донецк": "shakhtar", "кристал пэлас": "crystal palace", "астон вилла": "aston villa",
  "ноттингем форест": "nottingham", "фрайбург": "freiburg", "брага": "braga",
  // English variants
  "bayern munich": "bayern", "psg": "psg", "paris sg": "psg", "paris saint-germain": "psg",
  "atletico madrid": "atletico", "spartak moscow": "spartak", "cska moscow": "cska",
  "dynamo moscow": "dynamo", "shakhtar donetsk": "shakhtar", "real madrid": "real madrid",
  "manchester city": "man city", "manchester united": "man utd",
  "borussia dortmund": "dortmund", "rb leipzig": "leipzig",
  "nottingham forest": "nottingham",
};

function normTeam(name: string): string {
  let s = name.toLowerCase().trim();
  s = s.replace(/[ё]/g, "е");
  s = s.replace(/\s+/g, " ");
  // strip common suffixes
  s = s.replace(/\s*\(.*?\)\s*/g, "");
  if (SYNONYMS[s]) return SYNONYMS[s];
  // try without trailing single letter (м, к, etc.)
  const trimmed = s.replace(/\s+[а-яa-z]$/i, "");
  if (SYNONYMS[trimmed]) return SYNONYMS[trimmed];
  return s;
}

function eventKey(team1: string, team2: string): string {
  const a = normTeam(team1);
  const b = normTeam(team2);
  // order-independent so home/away swaps still match
  return [a, b].sort().join("|");
}

export const scanRussianBookies = createServerFn({ method: "POST" })
  .inputValidator((d: { stake?: number; minRoi?: number }) => ({
    stake: typeof d?.stake === "number" && d.stake > 0 ? d.stake : 10000,
    minRoi: typeof d?.minRoi === "number" ? d.minRoi : 0,
  }))
  .handler(async ({ data }) => {
    const sources: { name: string; url: string; parser: "generic" | "marathon" }[] = [
      { name: "Winline", url: "https://winline.ru/stavki/futbol/", parser: "generic" },
      { name: "Fonbet", url: "https://www.fon.bet/sports/football", parser: "generic" },
      { name: "Marathonbet", url: "https://www.marathonbet.ru/su/popular/Football", parser: "marathon" },
    ];

    const bookieResults: { name: string; events: RawEvent[]; error?: string }[] = [];
    await Promise.all(
      sources.map(async (s) => {
        try {
          const md = await fcScrape(s.url);
          const events =
            s.parser === "marathon"
              ? parseMarathonbet(md, s.name)
              : parseGenericLine(clean(md), s.name);
          bookieResults.push({ name: s.name, events });
        } catch (e: any) {
          bookieResults.push({ name: s.name, events: [], error: e.message });
        }
      }),
    );

    // Build OddRow entries; key events by canonical team pair
    const odds: OddRow[] = [];
    for (const br of bookieResults) {
      for (const ev of br.events) {
        const key = eventKey(ev.team1, ev.team2);
        const outcomes: [string, number][] = [
          ["1", ev.odds[0]],
          ["X", ev.odds[1]],
          ["2", ev.odds[2]],
        ];
        for (const [outcome, val] of outcomes) {
          odds.push({
            id: `${br.name}-${key}-${outcome}`,
            bookmaker_id: br.name,
            bookmaker_name: br.name,
            sport: "Football",
            tournament: null,
            event_name: key, // canonical key for grouping
            event_time: null,
            market: "1X2",
            outcome,
            odds: val,
          });
        }
      }
    }

    // Map canonical key → display name (prefer Russian)
    const displayMap = new Map<string, string>();
    for (const br of bookieResults) {
      for (const ev of br.events) {
        const k = eventKey(ev.team1, ev.team2);
        const isCyr = /[а-яё]/i.test(ev.team1);
        if (!displayMap.has(k) || isCyr) {
          displayMap.set(k, `${ev.team1} — ${ev.team2}`);
        }
      }
    }

    const arbs = findArbitrages(odds, data.stake, data.minRoi);
    const arbsDisplay: Arb[] = arbs.map((a) => ({
      ...a,
      event_name: displayMap.get(a.event_name) ?? a.event_name,
    }));

    // === Top matched events (present in 2+ bookies) ===
    // Group canonical key → outcome → list of {bm, odds, url}
    type Pick = { bm: string; odds: number; url: string };
    const grouped = new Map<string, Map<string, Pick[]>>();
    const urlMap = new Map<string, Map<string, string>>(); // key → bm → url
    for (const br of bookieResults) {
      for (const ev of br.events) {
        const k = eventKey(ev.team1, ev.team2);
        let bmUrls = urlMap.get(k);
        if (!bmUrls) { bmUrls = new Map(); urlMap.set(k, bmUrls); }
        bmUrls.set(br.name, ev.url);
      }
    }
    for (const o of odds) {
      let m1 = grouped.get(o.event_name);
      if (!m1) { m1 = new Map(); grouped.set(o.event_name, m1); }
      const arr = m1.get(o.outcome) ?? [];
      const bm = o.bookmaker_name ?? o.bookmaker_id;
      arr.push({ bm, odds: o.odds, url: urlMap.get(o.event_name)?.get(bm) ?? "" });
      m1.set(o.outcome, arr);
    }
    const matched: {
      event_name: string;
      arbPercent: number;
      bookies: { name: string; url: string }[];
      best: { outcome: string; odds: number; bm: string }[];
    }[] = [];
    for (const [key, outcomes] of grouped) {
      const bmSet = new Set<string>();
      for (const arr of outcomes.values()) for (const p of arr) bmSet.add(p.bm);
      if (bmSet.size < 2) continue;
      if (outcomes.size < 3) continue;
      const best = Array.from(outcomes.entries()).map(([outcome, arr]) => {
        const top = arr.reduce((a, b) => (b.odds > a.odds ? b : a));
        return { outcome, odds: top.odds, bm: top.bm };
      });
      const arbPercent = best.reduce((s, l) => s + 1 / l.odds, 0);
      const bmUrls = urlMap.get(key);
      matched.push({
        event_name: displayMap.get(key) ?? key,
        arbPercent,
        bookies: Array.from(bmSet).map((n) => ({ name: n, url: bmUrls?.get(n) ?? "" })),
        best,
      });
    }
    matched.sort((a, b) => a.arbPercent - b.arbPercent);

    return {
      arbs: arbsDisplay,
      stats: bookieResults.map((br) => ({
        bookmaker: br.name,
        events: br.events.length,
        error: br.error,
      })),
      totalOdds: odds.length,
      matchedEvents: new Set(odds.map((o) => o.event_name)).size,
      topMatches: matched.slice(0, 20),
      scannedAt: new Date().toISOString(),
    };
  });

import { createServerFn } from "@tanstack/react-start";
import { findArbitrages, type OddRow, type Arb } from "@/lib/arbitrage";

const FIRECRAWL = "https://api.firecrawl.dev/v2/scrape";

interface RawEvent {
  bookmaker: string;
  url: string;
  team1: string;
  team2: string;
  odds: [number, number, number]; // 1, X, 2
  dateKey?: string; // dd.mm; used to avoid mixing different matches with same teams
  league?: string;  // canonical league code, derived from URL or context
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

const MONTHS: Record<string, string> = {
  jan: "01", january: "01", янв: "01", января: "01",
  feb: "02", february: "02", фев: "02", февраля: "02",
  mar: "03", march: "03", мар: "03", марта: "03",
  apr: "04", april: "04", апр: "04", апреля: "04",
  may: "05", мая: "05", май: "05",
  jun: "06", june: "06", июн: "06", июня: "06",
  jul: "07", july: "07", июл: "07", июля: "07",
  aug: "08", august: "08", авг: "08", августа: "08",
  sep: "09", sept: "09", september: "09", сен: "09", сентября: "09",
  oct: "10", october: "10", окт: "10", октября: "10",
  nov: "11", november: "11", ноя: "11", ноября: "11",
  dec: "12", december: "12", дек: "12", декабря: "12",
};

function parseDateKey(text: string): string | undefined {
  const numeric = text.match(/(?:^|[^\d.])(\d{1,2})[./-](\d{1,2})(?:[./-]\d{2,4})?(?=\D|$)/);
  if (numeric) {
    const day = Number(numeric[1]);
    const month = Number(numeric[2]);
    if (day >= 1 && day <= 31 && month >= 1 && month <= 12) {
      return `${numeric[1].padStart(2, "0")}.${numeric[2].padStart(2, "0")}`;
    }
  }
  const word = text.toLowerCase().match(/\b(\d{1,2})\s+([a-zа-яё.]+)\b/i);
  if (!word) return undefined;
  const month = MONTHS[word[2].replace(/\.$/, "")];
  const day = Number(word[1]);
  return month && day >= 1 && day <= 31 ? `${word[1].padStart(2, "0")}.${month}` : undefined;
}

function cleanParticipantName(name: string): string {
  return name
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
    .replace(/&nbsp;|\u00a0/g, " ")
    .replace(/\\-/g, "-")
    .replace(/\((?:первый матч|ответный матч|счет|сч[её]т|агр\.|agg\.)[^)]*\)/gi, "")
    .replace(/\s+/g, " ")
    .trim();
}

function isSideMarket(text: string): boolean {
  return /\((?:жк|угловые|карточки|удары|офсайды|фолы|пенальти|статистика|xg|желтые|жёлтые|красные)\)/i.test(text);
}

// Parse Winline / Fonbet style: [team1  team2](url) on one line, odds on next lines
// Skip cybersports / virtual / non-real events
function isJunkEvent(team1: string, team2: string, url: string): boolean {
  const blob = `${team1} ${team2} ${url}`.toLowerCase();
  if (isSideMarket(blob)) return true;
  // Esports/FIFA player tags in parentheses, e.g. "Bayern (Shrek)".
  if (/\([a-z0-9_]{3,24}\)/i.test(team1) || /\([a-z0-9_]{3,24}\)/i.test(team2)) return true;
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
    const team1 = cleanParticipantName(ev.team1);
    const team2 = cleanParticipantName(ev.team2);
    if (isJunkEvent(team1, team2, ev.url)) continue;
    const window = lines.slice(i + 1, i + 8).join(" ");
    const odds = parseOdds3(window) ?? parseOdds3(lines[i + 1] ?? "");
    if (odds) out.push({ bookmaker, url: ev.url, team1, team2, odds, dateKey: parseDateKey(window) });
  }
  return out;
}

// tennisi.bet — table rows: | num | [time](url) | [TeamA \- TeamB](url) | [odd1](url) | [oddX](url) | [odd2](url) | ...
function parseTennisi(md: string, bookmaker: string): RawEvent[] {
  const out: RawEvent[] = [];
  const rowRe = /^\|\s*\d+\s*\|\s*\[[\d:]+\]\([^)]+\)\s*\|\s*\[([^\]]+?)\]\((https?:\/\/[^)]+?)\)\s*\|(.*)$/;
  const oddRe = /\[(\d{1,2}\.\d{2})\]/g;
  let currentDateKey: string | undefined;
  for (const line of md.split("\n")) {
    currentDateKey = parseDateKey(line) ?? currentDateKey;
    const m = line.match(rowRe);
    if (!m) continue;
    const teamRaw = cleanParticipantName(m[1]);
    if (isSideMarket(m[1])) continue;
    // require " - " separator (not part of multi-word teams)
    const sepIdx = teamRaw.search(/\s-\s/);
    if (sepIdx < 0) continue;
    const team1 = cleanParticipantName(teamRaw.slice(0, sepIdx));
    const team2 = cleanParticipantName(teamRaw.slice(sepIdx + 3));
    const url = m[2];
    if (isJunkEvent(team1, team2, url)) continue;
    // skip props like "(Угловые)", "(ЖК)", "(xG...)"
    if (/\(/.test(team1) || /\(/.test(team2)) continue;
    if (/^Гибкий экспресс/i.test(team1)) continue;
    const rest = m[3];
    const odds: number[] = [];
    let mm: RegExpExecArray | null;
    oddRe.lastIndex = 0;
    while ((mm = oddRe.exec(rest)) !== null) odds.push(Number(mm[1]));
    if (odds.length < 3) continue;
    const a = odds.slice(0, 3) as [number, number, number];
    if (!a.every((x) => x > 1.01 && x < 100)) continue;
    out.push({ bookmaker, url, team1, team2, odds: a, dateKey: parseDateKey(line) ?? currentDateKey });
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
    const team1 = cleanParticipantName(m[1]);
    const team2 = cleanParticipantName(m[3]);
    const url = m[2];
    if (isJunkEvent(team1, team2, url)) continue;
    // Look for odds row in next ~6 lines, with leading "| +<digits> |" or just three odds
    for (let j = i + 1; j < Math.min(i + 7, lines.length); j++) {
      const oddsMatches = lines[j].match(/\b\d{1,2}\.\d{2,3}\b/g);
      if (oddsMatches && oddsMatches.length >= 3 && lines[j].includes("|")) {
        const a = oddsMatches.slice(0, 3).map(Number) as [number, number, number];
        if (a.every((x) => x > 1.01 && x < 100)) {
          out.push({ bookmaker, url, team1, team2, odds: a, dateKey: parseDateKey(lines[i]) });
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

// Cyrillic → Latin transliteration (GOST-ish, lossy but consistent)
const TRANSLIT: Record<string, string> = {
  а: "a", б: "b", в: "v", г: "g", д: "d", е: "e", ж: "zh", з: "z", и: "i",
  й: "i", к: "k", л: "l", м: "m", н: "n", о: "o", п: "p", р: "r", с: "s",
  т: "t", у: "u", ф: "f", х: "h", ц: "ts", ч: "ch", ш: "sh", щ: "sh",
  ъ: "", ы: "y", ь: "", э: "e", ю: "yu", я: "ya",
};
function translit(s: string): string {
  return s.toLowerCase().replace(/ё/g, "е").split("").map((c) => TRANSLIT[c] ?? c).join("");
}

const STOPWORDS = new Set([
  "fc", "fk", "cf", "club", "the", "de", "city", "united", "utd", "calcio", "ac",
  "fk.", "1.", "ii", "b", "u19", "u21", "u23", "ii.", "м", "k", "к", "ii",
]);

function tokenize(name: string): string[] {
  const lat = translit(name.toLowerCase())
    .replace(/[().,'`’"!?:]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return lat.split(" ").map((t) => t.replace(/[^a-z0-9]/g, "")).filter((t) => t.length >= 3 && !STOPWORDS.has(t));
}

// Apply explicit synonyms first; otherwise return tokens of the team name
function teamTokens(name: string): string[] {
  const cleaned = name.toLowerCase().replace(/ё/g, "е").replace(/\s*\(.*?\)\s*/g, "").replace(/\s+/g, " ").trim();
  if (SYNONYMS[cleaned]) return SYNONYMS[cleaned].split(/\s+/);
  const trimmed = cleaned.replace(/\s+[а-яa-z]$/i, "");
  if (SYNONYMS[trimmed]) return SYNONYMS[trimmed].split(/\s+/);
  const toks = tokenize(name);
  return toks.length ? toks : [translit(cleaned).replace(/\s+/g, "")];
}

// Signature = ALL significant tokens, sorted and joined.
function teamSig(name: string): string {
  const t = teamTokens(name);
  if (!t.length) return translit(name).replace(/\s+/g, "");
  return [...new Set(t)].sort().join("_");
}

// Map of league keywords (found in event URL or title) → canonical league code.
// Anything matching the same code from different bookmakers will be grouped together.
const LEAGUE_PATTERNS: { code: string; re: RegExp }[] = [
  { code: "epl",          re: /(premier-?league|angliya|english-premier|anglijskaya|англ.+премьер|апл)/i },
  { code: "laliga",       re: /(la-?liga|laliga|ispaniya|ispanskaya|испан.+ла-?лига|примера)/i },
  { code: "seriea",       re: /(serie-?a|italiya|italyanskaya|итал.+серия)/i },
  { code: "bundesliga",   re: /(bundesliga|germaniya|nemetskaya|бундеслига|герман)/i },
  { code: "ligue1",       re: /(ligue-?1|francz|frantsuz|франц.+лига-?1|лига-?1)/i },
  { code: "rpl",          re: /(rpl|russia.*premier|rossiya.*premier|rossijskaya.*premier|росс.+премьер|мир-?рпл|премьер-?лига-?россии)/i },
  { code: "fnl",          re: /(fnl|first-?league|pervaya-?liga|перв.+лига|фнл)/i },
  { code: "ucl",          re: /(champions-?league|liga-?chempionov|чемпион.+лига|uefa-?cl|лч)/i },
  { code: "uel",          re: /(europa-?league|liga-?evrop|лига-?европ|uel)/i },
  { code: "uecl",         re: /(conference-?league|liga-?konferentsi|лига-?конференц|uecl)/i },
  { code: "mls",          re: /\bmls\b|major-?league-?soccer/i },
  { code: "brazil-a",     re: /(brasileir|seria-?a-?braziliya|бразил.+серия-?а|brazil-?serie)/i },
  { code: "argentina",    re: /(argentin|primera-?division-?argentin|аргент)/i },
  { code: "uruguay",      re: /(uruguay|urugvaj|урugв|уругв)/i },
  { code: "world-cup",    re: /(world-?cup|chempionat-?mira|чм-?20\d\d|чемпионат-?мира)/i },
  { code: "euro",         re: /(euro-?20\d\d|chempionat-?evrop|чемпионат-?европы)/i },
];

function leagueFromText(...parts: (string | undefined)[]): string | undefined {
  const blob = parts.filter(Boolean).join(" ");
  for (const { code, re } of LEAGUE_PATTERNS) {
    if (re.test(blob)) return code;
  }
  return undefined;
}

// Fallback: extract a country/league slug from the URL path so different
// bookmakers can still group together when no known pattern matches.
function leagueSlugFromUrl(url: string): string | undefined {
  try {
    const u = new URL(url);
    const segs = u.pathname.split("/").filter(Boolean);
    // common shapes: /sport/football/<country>/<league>/<event>
    //                /stavki/futbol/<country>/<league>/<event>
    const footballIdx = segs.findIndex((s) => /^(football|futbol|soccer|sports?)$/i.test(s));
    const start = footballIdx >= 0 ? footballIdx + 1 : 0;
    const slugs = segs.slice(start, start + 2).filter((s) => /[a-zа-яё-]{3,}/i.test(s) && !/^\d+$/.test(s));
    if (!slugs.length) return undefined;
    return translit(slugs.join("-").toLowerCase()).replace(/[^a-z0-9-]/g, "").slice(0, 40) || undefined;
  } catch {
    return undefined;
  }
}

function eventLeague(ev: RawEvent): string {
  if (ev.league) return ev.league;
  return leagueFromText(ev.url) ?? leagueSlugFromUrl(ev.url) ?? "any";
}

function canonicalEvent(team1: string, team2: string, league: string): { key: string; flip: boolean; display: string } {
  const a = teamSig(team1);
  const b = teamSig(team2);
  const flip = a > b;
  const pair = flip ? `${b}|${a}` : `${a}|${b}`;
  return {
    key: `${league}|${pair}`,
    flip,
    display: flip ? `${team2} — ${team1}` : `${team1} — ${team2}`,
  };
}

function displayKey(key: string): string {
  return key.split("|").slice(1).join(" — ");
}

export const scanRussianBookies = createServerFn({ method: "POST" })
  .inputValidator((d: { stake?: number; minRoi?: number }) => ({
    stake: typeof d?.stake === "number" && d.stake > 0 ? d.stake : 10000,
    minRoi: typeof d?.minRoi === "number" ? d.minRoi : 0,
  }))
  .handler(async ({ data }) => {
    const sources: { name: string; url: string; parser: "generic" | "marathon" | "tennisi" }[] = [
      { name: "Winline", url: "https://winline.ru/stavki/futbol/", parser: "generic" },
      { name: "Fonbet", url: "https://www.fon.bet/sports/football", parser: "generic" },
      { name: "Marathonbet", url: "https://www.marathonbet.ru/su/popular/Football", parser: "marathon" },
      { name: "Tennisi", url: "https://tennisi.bet/sport/football", parser: "tennisi" },
      { name: "BetBoom", url: "https://betboom.ru/sport/football", parser: "generic" },
    ];

    const bookieResults: { name: string; events: RawEvent[]; error?: string }[] = [];
    await Promise.all(
      sources.map(async (s) => {
        try {
          const md = await fcScrape(s.url);
          const events =
            s.parser === "marathon"
              ? parseMarathonbet(md, s.name)
              : s.parser === "tennisi"
                ? parseTennisi(md, s.name)
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
        const canonical = canonicalEvent(ev.team1, ev.team2, eventLeague(ev));
        const outcomes: [string, number][] = canonical.flip
          ? [["1", ev.odds[2]], ["X", ev.odds[1]], ["2", ev.odds[0]]]
          : [["1", ev.odds[0]], ["X", ev.odds[1]], ["2", ev.odds[2]]];
        for (const [outcome, val] of outcomes) {
          odds.push({
            id: `${br.name}-${canonical.key}-${outcome}`,
            bookmaker_id: br.name,
            bookmaker_name: br.name,
            sport: "Football",
            tournament: null,
            event_name: canonical.key,
            event_time: null,
            market: "1X2",
            outcome,
            odds: val,
            url: ev.url,
          });
        }
      }
    }

    // Map canonical key → display name (prefer Russian)
    const displayMap = new Map<string, string>();
    for (const br of bookieResults) {
      for (const ev of br.events) {
        const canonical = canonicalEvent(ev.team1, ev.team2, eventLeague(ev));
        const isCyr = /[а-яё]/i.test(ev.team1);
        if (!displayMap.has(canonical.key) || isCyr) {
          displayMap.set(canonical.key, ev.dateKey ? `${ev.dateKey} · ${canonical.display}` : canonical.display);
        }
      }
    }

    const arbs = findArbitrages(odds, data.stake, data.minRoi);
    const arbsDisplay: Arb[] = arbs.map((a) => ({
      ...a,
      event_name: displayMap.get(a.event_name) ?? displayKey(a.event_name),
    }));

    // === Top matched events (present in 2+ bookies) ===
    // Group canonical key → outcome → list of {bm, odds, url}
    type Pick = { bm: string; odds: number; url: string };
    const grouped = new Map<string, Map<string, Pick[]>>();
    const urlMap = new Map<string, Map<string, string>>(); // key → bm → url
    for (const br of bookieResults) {
      for (const ev of br.events) {
        const k = canonicalEvent(ev.team1, ev.team2, eventLeague(ev)).key;
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
        event_name: displayMap.get(key) ?? displayKey(key),
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

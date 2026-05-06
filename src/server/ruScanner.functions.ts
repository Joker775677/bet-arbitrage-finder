import { createServerFn } from "@tanstack/react-start";
import { findArbitrages, type OddRow, type Arb } from "@/lib/arbitrage";

const FIRECRAWL = "https://api.firecrawl.dev/v2/scrape";
const FIRECRAWL_FETCH_TIMEOUT_MS = 43000;
const FIRECRAWL_RENDER_TIMEOUT_MS = 41000;
const LIST_FALLBACK_BUDGET_MS = 12000;
const ENABLE_RU_AI_FALLBACK = false;

interface RawEvent {
  bookmaker: string;
  url: string;
  sport?: string;
  team1: string;
  team2: string;
  odds?: [number, number, number]; // legacy 1, X, 2 fallback
  markets?: RawMarket[];
  dateKey?: string; // dd.mm; used to avoid mixing different matches with same teams
  league?: string;  // canonical league code, derived from URL or context
}

interface RawMarket {
  market: string;
  selections: { outcome: string; odds: number }[];
}

async function fcScrapeOnce(url: string, waitFor: number): Promise<string> {
  const key = process.env.FIRECRAWL_API_KEY;
  if (!key) throw new Error("FIRECRAWL_API_KEY not configured");
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), FIRECRAWL_FETCH_TIMEOUT_MS);
  try {
    const r = await fetch(FIRECRAWL, {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      signal: ctrl.signal,
      body: JSON.stringify({
        url,
        formats: ["markdown"],
        onlyMainContent: true,
        waitFor,
        maxAge: 120000,
        removeBase64Images: true,
        timeout: FIRECRAWL_RENDER_TIMEOUT_MS,
        location: { country: "RU", languages: ["ru-RU"] },
        proxy: "stealth",
        mobile: true,
      }),
    });
    const j: any = await r.json();
    if (!j.success) throw new Error(`Firecrawl: ${JSON.stringify(j).slice(0, 200)}`);
    return j.data?.markdown ?? j.markdown ?? "";
  } finally {
    clearTimeout(t);
  }
}

async function fcScrape(url: string, waitFor = 4000): Promise<string> {
  // Stealth proxy requests are slow and expensive; keep each source under the server timeout.
  let lastErr: any;
  for (let attempt = 0; attempt < 1; attempt++) {
    try {
      const md = await fcScrapeOnce(url, waitFor);
      if (md && md.length > 200) return md;
      lastErr = new Error("empty markdown");
    } catch (e: any) {
      lastErr = e;
      const msg = String(e?.message ?? "");
      if (!/TIMEOUT|aborted|429|502|503|504|empty/i.test(msg)) throw e;
    }
    await new Promise((r) => setTimeout(r, 800 * (attempt + 1)));
  }
  throw lastErr ?? new Error("fcScrape failed");
}

interface ExtractedEventJSON {
  team1?: string;
  team2?: string;
  markets?: { name?: string; selections?: { outcome?: string; odds?: number }[] }[];
}

async function fcExtractEvent(url: string): Promise<ExtractedEventJSON | null> {
  const key = process.env.FIRECRAWL_API_KEY;
  if (!key) return null;
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 75000);
  try {
    const r = await fetch(FIRECRAWL, {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      signal: ctrl.signal,
      body: JSON.stringify({
        url,
        formats: [{
          type: "json",
          prompt: "Extract sports betting event from this bookmaker page. Return team1, team2 (exact names), and a 'markets' array. For each market include name (e.g. 'Победитель', 'Фора 5.5', 'Тотал 150.5', '1 четверть Фора 2.5') and selections array with {outcome, odds}. outcome must be one of: '1','2','X','1X','12','X2','Б','М','Ф1 -5.5','Ф1 5.5','Ф2 -5.5','Ф2 5.5' etc. Include ALL handicap and total markets visible (main, quarters, halves). odds must be decimal numbers > 1.01.",
          schema: {
            type: "object",
            properties: {
              team1: { type: "string" },
              team2: { type: "string" },
              markets: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    name: { type: "string" },
                    selections: {
                      type: "array",
                      items: {
                        type: "object",
                        properties: { outcome: { type: "string" }, odds: { type: "number" } },
                        required: ["outcome", "odds"],
                      },
                    },
                  },
                  required: ["name", "selections"],
                },
              },
            },
            required: ["team1", "team2", "markets"],
          },
        }],
        onlyMainContent: true,
        waitFor: 5000,
        maxAge: 120000,
        removeBase64Images: true,
        timeout: 65000,
        location: { country: "RU", languages: ["ru-RU"] },
        proxy: "stealth",
        mobile: true,
      }),
    });
    const j: any = await r.json();
    if (!j.success) {
      console.log(`[ruScanner] fcExtractEvent failed for ${url}: ${JSON.stringify(j).slice(0, 200)}`);
      return null;
    }
    return (j.data?.json ?? j.json ?? j.data?.extract ?? j.extract ?? null) as ExtractedEventJSON | null;
  } catch (e: any) {
    console.log(`[ruScanner] fcExtractEvent error for ${url}: ${e?.message}`);
    return null;
  } finally {
    clearTimeout(t);
  }
}

interface ExtractedListJSON {
  events?: {
    team1?: string;
    team2?: string;
    sport?: string;
    league?: string;
    markets?: { name?: string; selections?: { outcome?: string; odds?: number }[] }[];
  }[];
}

async function fcExtractList(url: string, sportHint?: string): Promise<ExtractedListJSON | null> {
  const key = process.env.FIRECRAWL_API_KEY;
  if (!key) return null;
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 85000);
  try {
    const r = await fetch(FIRECRAWL, {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      signal: ctrl.signal,
      body: JSON.stringify({
        url,
        formats: [{
          type: "json",
          prompt: `Extract ALL upcoming or live sports betting events visible on this bookmaker page${sportHint ? ` (sport: ${sportHint})` : ""}. For EACH event return team1, team2 (exact names as shown), sport, league, and a 'markets' array. Skip cybersport/FIFA/virtual events. For each market include name (e.g. 'Победитель','1X2','Фора 5.5','Тотал 150.5','Двойной шанс') and selections [{outcome, odds}]. outcomes must be one of: '1','2','X','1X','12','X2','Б','М','Ф1 -5.5','Ф1 5.5','Ф2 -5.5','Ф2 5.5'. odds are decimal numbers > 1.01. Return up to 200 events.`,
          schema: {
            type: "object",
            properties: {
              events: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    team1: { type: "string" },
                    team2: { type: "string" },
                    sport: { type: "string" },
                    league: { type: "string" },
                    markets: {
                      type: "array",
                      items: {
                        type: "object",
                        properties: {
                          name: { type: "string" },
                          selections: {
                            type: "array",
                            items: {
                              type: "object",
                              properties: { outcome: { type: "string" }, odds: { type: "number" } },
                              required: ["outcome", "odds"],
                            },
                          },
                        },
                        required: ["name", "selections"],
                      },
                    },
                  },
                  required: ["team1", "team2", "markets"],
                },
              },
            },
            required: ["events"],
          },
        }],
        onlyMainContent: true,
        waitFor: 4000,
        maxAge: 120000,
        removeBase64Images: true,
        timeout: 75000,
        location: { country: "RU", languages: ["ru-RU"] },
        proxy: "stealth",
        mobile: true,
      }),
    });
    const j: any = await r.json();
    if (!j.success) {
      console.log(`[ruScanner] fcExtractList failed for ${url}: ${JSON.stringify(j).slice(0, 200)}`);
      return null;
    }
    return (j.data?.json ?? j.json ?? j.data?.extract ?? j.extract ?? null) as ExtractedListJSON | null;
  } catch (e: any) {
    console.log(`[ruScanner] fcExtractList error for ${url}: ${e?.message}`);
    return null;
  } finally {
    clearTimeout(t);
  }
}

function eventsFromExtractedList(extracted: ExtractedListJSON | null, bookmaker: string, url: string, sportHint?: string): RawEvent[] {
  if (!extracted?.events?.length) return [];
  const out: RawEvent[] = [];
  for (const ev of extracted.events) {
    if (!ev?.team1 || !ev?.team2 || !Array.isArray(ev.markets)) continue;
    const team1 = cleanParticipantName(ev.team1);
    const team2 = cleanParticipantName(ev.team2);
    if (!team1 || !team2 || team1 === team2) continue;
    if (isJunkEvent(team1, team2, url)) continue;
    const markets: RawMarket[] = [];
    for (const m of ev.markets) {
      if (!m?.name || !Array.isArray(m.selections)) continue;
      addMarket(markets, m.name, m.selections.map((s) => ({
        outcome: String(s?.outcome ?? "").trim(),
        odds: typeof s?.odds === "number" ? s.odds : Number(s?.odds),
      })).filter((s) => s.outcome));
    }
    if (!markets.length) continue;
    out.push({ bookmaker, url, sport: ev.sport ?? sportHint, league: ev.league, team1, team2, markets });
  }
  return out;
}
function eventFromExtracted(
  extracted: ExtractedEventJSON | null,
  bookmaker: string,
  url: string,
  sport: string,
  league?: string,
): RawEvent[] {
  if (!extracted?.team1 || !extracted?.team2 || !Array.isArray(extracted.markets)) return [];
  const markets: RawMarket[] = [];
  for (const m of extracted.markets) {
    if (!m?.name || !Array.isArray(m.selections)) continue;
    addMarket(markets, m.name, m.selections.map((s) => ({
      outcome: String(s?.outcome ?? "").trim(),
      odds: typeof s?.odds === "number" ? s.odds : Number(s?.odds),
    })).filter((s) => s.outcome));
  }
  if (!markets.length) return [];
  return [{
    bookmaker,
    url,
    sport,
    team1: cleanParticipantName(extracted.team1),
    team2: cleanParticipantName(extracted.team2),
    markets,
    league,
  }];
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
const ODDS_2 = /^(\d{1,2}\.\d{2})(\d{1,2}\.\d{2})$/;
const LINK_EVENT = /^\[([^[\]]+?)\s+(?:[—–-])\s+([^[\]]+?)\]\((https?:\/\/[^\s)]+)\)/;
const LINK_EVENT_2SP = /^\[([^[\]]+?)\s{2,}([^[\]]+?)\]\((https?:\/\/[^\s)]+)\)/;
const LINK_EVENT_PIPE = /^\[([^\]]+?)\]\((https?:\/\/[^\s)]+)\)/;

function parseEventLine(line: string): { team1: string; team2: string; url: string } | null {
  let m = line.match(LINK_EVENT);
  if (!m) m = line.match(LINK_EVENT_2SP);
  if (!m) {
    const pipe = line.match(LINK_EVENT_PIPE);
    const parts = pipe?.[1]
      ?.replace(/\\/g, "")
      .split("|")
      .map((p) => p.trim())
      .filter(Boolean);
    if (pipe && parts && parts.length >= 2) return { team1: parts[0], team2: parts[parts.length - 1], url: pipe[2] };
    return null;
  }
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

function parseOdds2(s: string): [number, number] | null {
  const normalized = s.replace(/,/g, ".").replace(/\s+/g, "").trim();
  const m = normalized.match(ODDS_2);
  if (m) {
    const a = [Number(m[1]), Number(m[2])] as [number, number];
    if (a.every((x) => x > 1.01 && x < 100)) return a;
  }
  const all = s.replace(/,/g, ".").match(/\d{1,2}\.\d{2}/g);
  if (all && all.length >= 2) {
    const a = all.slice(0, 2).map(Number) as [number, number];
    if (a.every((x) => x > 1.01 && x < 100)) return a;
  }
  return null;
}

function validOdd(n: number): boolean {
  return Number.isFinite(n) && n > 1.01 && n < 500;
}

function fmtLine(n: number): string {
  return Object.is(n, -0) || n === 0 ? "0" : String(Number(n.toFixed(2)));
}

function numberFromText(text: string): number | undefined {
  const m = text.replace(/,/g, ".").match(/[+-]?\d{1,3}(?:\.\d{1,3})?/);
  return m ? Number(m[0]) : undefined;
}

function oddFromText(text: string): number | undefined {
  const all = text.replace(/,/g, ".").match(/\d{1,3}(?:\.\d{1,3})?/g);
  if (!all?.length) return undefined;
  const candidates = all.filter((token) => token.includes(".")).map(Number).filter(validOdd);
  if (!candidates.length) return undefined;
  const n = candidates[candidates.length - 1];
  return validOdd(n) ? n : undefined;
}

async function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T | null> {
  let t: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<null>((resolve) => { t = setTimeout(() => resolve(null), ms); }),
    ]);
  } finally {
    if (t) clearTimeout(t);
  }
}

function addMarket(markets: RawMarket[], market: string, selections: { outcome: string; odds?: number }[]) {
  const cleanSelections = selections
    .filter((s): s is { outcome: string; odds: number } => typeof s.odds === "number" && validOdd(s.odds))
    .filter((s, idx, arr) => arr.findIndex((x) => x.outcome === s.outcome) === idx);
  if (cleanSelections.length >= 2) markets.push({ market, selections: cleanSelections });
}

function legacyMarkets(odds?: [number, number, number]): RawMarket[] {
  const markets: RawMarket[] = [];
  if (odds) addMarket(markets, "1X2", [
    { outcome: "1", odds: odds[0] },
    { outcome: "X", odds: odds[1] },
    { outcome: "2", odds: odds[2] },
  ]);
  return markets;
}

function parseParenOddCell(cell: string): { line?: number; odd?: number } {
  const normalized = cell.replace(/<br\s*\/?>/gi, " ").replace(/[\u2000-\u200a\u202f\u00a0]/g, " ");
  const line = normalized.match(/\(([+-]?\d+(?:[.,]\d+)?)\)/)?.[1];
  return { line: line ? Number(line.replace(",", ".")) : numberFromText(normalized), odd: oddFromText(normalized) };
}

function parseWinlineTotal(lines: string[]): RawMarket[] {
  const markets: RawMarket[] = [];
  for (let i = 1; i < lines.length - 1; i++) {
    const prevOdd = oddFromText(lines[i - 1]);
    const label = lines[i].match(/^М\s*([0-9]+(?:[.,][0-9]+)?)\s*Б$/i);
    const nextOdd = oddFromText(lines[i + 1]);
    if (prevOdd && label && nextOdd) {
      addMarket(markets, `Тотал ${fmtLine(Number(label[1].replace(",", ".")))}`, [
        { outcome: "М", odds: prevOdd },
        { outcome: "Б", odds: nextOdd },
      ]);
    }
  }
  return markets;
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
  const rel = text.toLowerCase();
  const shift = /\b(?:завтра|tomorrow)\b/i.test(rel) ? 1 : /\b(?:сегодня|today)\b/i.test(rel) ? 0 : undefined;
  if (shift !== undefined) {
    const d = new Date();
    d.setDate(d.getDate() + shift);
    return `${String(d.getDate()).padStart(2, "0")}.${String(d.getMonth() + 1).padStart(2, "0")}`;
  }
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
    const markets = [...legacyMarkets(odds ?? undefined), ...parseWinlineTotal(lines.slice(i + 1, i + 10))];
    if (markets.length) out.push({ bookmaker, url: ev.url, team1, team2, odds: odds ?? undefined, markets, dateKey: parseDateKey(window) });
  }
  return out;
}

function parseFonbet(md: string, bookmaker: string): RawEvent[] {
  const out: RawEvent[] = [];
  const lines = clean(md).map((l) => l.replace(/[\u2000-\u200a\u202f\u00a0]/g, " "));
  let currentLeague: string | undefined;
  for (let i = 0; i < lines.length; i++) {
    const ev = parseEventLine(lines[i]);
    if (!ev) {
      if (/league|лига|кубок|championship|серия|премьер|division|cup/i.test(lines[i])) currentLeague = lines[i];
      continue;
    }
    const team1 = cleanParticipantName(ev.team1);
    const team2 = cleanParticipantName(ev.team2);
    if (isJunkEvent(team1, team2, ev.url)) continue;
    const cells: string[] = [];
    for (let j = i + 1; j < Math.min(i + 35, lines.length); j++) {
      if (parseEventLine(lines[j])) break;
      if (/^\+\d+$/.test(lines[j]) && cells.length >= 3) break;
      if (/^[+-]?\d+(?:[.,]\d+)?\s+\d{1,3}(?:[.,]\d{1,3})?$/.test(lines[j]) || /^\d{1,3}(?:[.,]\d{1,3})?$/.test(lines[j])) cells.push(lines[j]);
    }
    const markets: RawMarket[] = [];
    const n = (idx: number) => oddFromText(cells[idx] ?? "");
    addMarket(markets, "1X2", [{ outcome: "1", odds: n(0) }, { outcome: "X", odds: n(1) }, { outcome: "2", odds: n(2) }]);
    addMarket(markets, "Двойной шанс", [{ outcome: "1X", odds: n(3) }, { outcome: "12", odds: n(4) }, { outcome: "X2", odds: n(5) }]);
    const h1 = parseParenOddCell(cells[6] ?? "");
    const h2 = parseParenOddCell(cells[7] ?? "");
    if (h1.line !== undefined && h2.line !== undefined) addMarket(markets, `Фора ${fmtLine(Math.abs(h1.line))}`, [{ outcome: `Ф1 ${fmtLine(h1.line)}`, odds: h1.odd }, { outcome: `Ф2 ${fmtLine(h2.line)}`, odds: h2.odd }]);
    const total = numberFromText(cells[8] ?? "");
    if (total !== undefined) addMarket(markets, `Тотал ${fmtLine(total)}`, [{ outcome: "Б", odds: n(9) }, { outcome: "М", odds: n(10) }]);
    addMarket(markets, "Обе забьют", [{ outcome: "Да", odds: n(11) }, { outcome: "Нет", odds: n(12) }]);
    const t1 = numberFromText(cells[13] ?? "");
    if (t1 !== undefined) addMarket(markets, `ИТ1 ${fmtLine(t1)}`, [{ outcome: "Б", odds: n(14) }, { outcome: "М", odds: n(15) }]);
    const t2 = numberFromText(cells[16] ?? "");
    if (t2 !== undefined) addMarket(markets, `ИТ2 ${fmtLine(t2)}`, [{ outcome: "Б", odds: n(17) }, { outcome: "М", odds: n(18) }]);
    if (markets.length) out.push({ bookmaker, url: ev.url, team1, team2, markets, league: currentLeague, dateKey: parseDateKey(lines.slice(i, i + 4).join(" ")) });
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
    const cells = line.trim().replace(/^\||\|$/g, "").split("|").map((c) => c.trim());
    const rest = m[3];
    const odds: number[] = [];
    let mm: RegExpExecArray | null;
    oddRe.lastIndex = 0;
    while ((mm = oddRe.exec(rest)) !== null) odds.push(Number(mm[1]));
    if (odds.length < 3) continue;
    const a = odds.slice(0, 3) as [number, number, number];
    if (!a.every((x) => x > 1.01 && x < 100)) continue;
    const markets = legacyMarkets(a);
    addMarket(markets, "Двойной шанс", [
      { outcome: "1X", odds: oddFromText(cells[7] ?? "") },
      { outcome: "12", odds: oddFromText(cells[8] ?? "") },
      { outcome: "X2", odds: oddFromText(cells[9] ?? "") },
    ]);
    const h1 = numberFromText(cells[11] ?? "");
    const h2 = numberFromText(cells[13] ?? "");
    if (h1 !== undefined && h2 !== undefined) addMarket(markets, `Фора ${fmtLine(Math.abs(h1))}`, [
      { outcome: `Ф1 ${fmtLine(h1)}`, odds: oddFromText(cells[12] ?? "") },
      { outcome: `Ф2 ${fmtLine(h2)}`, odds: oddFromText(cells[14] ?? "") },
    ]);
    const total = numberFromText(cells[17] ?? "");
    if (total !== undefined) addMarket(markets, `Тотал ${fmtLine(total)}`, [
      { outcome: "М", odds: oddFromText(cells[16] ?? "") },
      { outcome: "Б", odds: oddFromText(cells[18] ?? "") },
    ]);
    out.push({ bookmaker, url, team1, team2, odds: a, markets, dateKey: parseDateKey(line) ?? currentDateKey });
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
          const cells = lines[j].trim().replace(/^\||\|$/g, "").split("|").map((c) => c.trim());
          const markets = legacyMarkets(a);
          addMarket(markets, "Двойной шанс", [
            { outcome: "1X", odds: oddFromText(cells[5] ?? "") },
            { outcome: "12", odds: oddFromText(cells[6] ?? "") },
            { outcome: "X2", odds: oddFromText(cells[7] ?? "") },
          ]);
          const h1 = parseParenOddCell(cells[8] ?? "");
          const h2 = parseParenOddCell(cells[9] ?? "");
          if (h1.line !== undefined && h2.line !== undefined) addMarket(markets, `Фора ${fmtLine(Math.abs(h1.line))}`, [
            { outcome: `Ф1 ${fmtLine(h1.line)}`, odds: h1.odd },
            { outcome: `Ф2 ${fmtLine(h2.line)}`, odds: h2.odd },
          ]);
          const tm = parseParenOddCell(cells[10] ?? "");
          const tb = parseParenOddCell(cells[11] ?? "");
          if (tm.line !== undefined) addMarket(markets, `Тотал ${fmtLine(tm.line)}`, [
            { outcome: "М", odds: tm.odd },
            { outcome: "Б", odds: tb.odd },
          ]);
          out.push({ bookmaker, url, team1, team2, odds: a, markets, dateKey: parseDateKey(lines[i]) });
          break;
        }
      }
    }
  }
  return out;
}

// betboom.ru — markdown is a flat stream:
//   "### ![icon](...)<League Name>"
//   ""
//   <team1 short tags> ... <team1 name> ... <team2 name>
//   <misc score/time lines>
//   "П1<odd>X<odd>П2<odd>Ещё+ N"
function parseBetBoom(md: string, bookmaker: string): RawEvent[] {
  const out: RawEvent[] = [];
  const lines = md.split("\n").map((l) => l.trim());
  const oddsRe = /^П1(\d{1,2}\.\d{1,3})X(\d{1,2}\.\d{1,3})П2(\d{1,2}\.\d{1,3})/;
  let currentLeague: string | undefined;
  for (let i = 0; i < lines.length; i++) {
    const ln = lines[i];
    const lh = ln.match(/^#{1,4}\s*(?:!\[[^\]]*\]\([^)]*\))?\s*(.+?)\s*$/);
    if (lh && /[А-Яа-яё]/.test(lh[1]) && !oddsRe.test(ln)) {
      currentLeague = lh[1];
      continue;
    }
    const m = ln.match(oddsRe);
    if (!m) continue;
    const odds: [number, number, number] = [Number(m[1]), Number(m[2]), Number(m[3])];
    if (!odds.every((x) => x > 1.01 && x < 200)) continue;
    // Walk back to find two team names (non-empty, non-numeric, no images-only)
    const names: string[] = [];
    for (let j = i - 1; j >= Math.max(0, i - 30) && names.length < 2; j--) {
      const s = lines[j];
      if (!s) continue;
      if (/^!\[/.test(s)) continue;
      if (/^\d+$/.test(s) || /^\d+:\d+/.test(s)) continue;
      if (/^(?:1Т|2Т|перерыв|тайм|live|перерыв|не начался|матч)/i.test(s)) continue;
      if (/^#{1,4}/.test(s)) break;
      if (/^[A-Za-zА-Яа-яё][A-Za-zА-Яа-яё0-9 .'’\-]{1,40}$/.test(s)) {
        names.unshift(s);
      }
    }
    if (names.length < 2) continue;
    const team1 = cleanParticipantName(names[0]);
    const team2 = cleanParticipantName(names[1]);
    if (!team1 || !team2 || team1 === team2) continue;
    if (isJunkEvent(team1, team2, "")) continue;
    out.push({
      bookmaker,
      url: "https://betboom.ru/sport/football",
      team1,
      team2,
      odds,
      markets: legacyMarkets(odds),
      league: currentLeague,
    });
  }
  return out;
}

function parseLeon(md: string, bookmaker: string): RawEvent[] {
  const out: RawEvent[] = [];
  const lines = md.split("\n").map((l) => l.trim()).filter(Boolean);
  let currentLeague: string | undefined;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (/^[А-Яа-яЁёA-Za-z].{3,80}$/.test(line) && !/^(?:1|2|X|Победитель|Тотал|Фора|Увеличенный)/i.test(line)) currentLeague = line;
    if (!line.startsWith("[") || !line.includes("\\")) continue;
    const block: string[] = [];
    for (let j = i; j < Math.min(i + 8, lines.length); j++) {
      block.push(lines[j]);
      if (/\]\(https?:\/\/leon\.(?:ru|bet)\/(?:ru-ru\/)?(?:bets|live)\//.test(lines[j])) break;
    }
    const joined = block.join(" ");
    const m = joined.match(/^\[(.+?)\]\((https?:\/\/leon\.(?:ru|bet)\/(?:ru-ru\/)?(?:bets|live)\/[^)]+)\)/);
    if (!m) continue;
    const parts = m[1].replace(/\\/g, "\n").split("\n").map(cleanParticipantName).filter(Boolean);
    if (parts.length < 3) continue;
    const [team1, team2] = parts;
    const url = m[2];
    if (isJunkEvent(team1, team2, url)) continue;
    const oddsLine = lines.slice(i + block.length, i + block.length + 4).find((s) => /\d{1,2}\.\d{2}/.test(s)) ?? "";
    const odds3 = parseOdds3(oddsLine);
    const odds2 = odds3 ? undefined : parseOdds2(oddsLine);
    const markets = odds3 ? legacyMarkets(odds3) : [];
    if (odds2) addMarket(markets, "Победитель", [{ outcome: "1", odds: odds2[0] }, { outcome: "2", odds: odds2[1] }]);
    if (markets.length) out.push({ bookmaker, url, sport: url.includes("/basketball/") ? "Basketball" : "Football", team1, team2, markets, league: currentLeague, dateKey: parseDateKey(parts.join(" ")) });
  }
  return out;
}

function parseZenit(md: string, bookmaker: string): RawEvent[] {
  const out: RawEvent[] = [];
  const lines = md.split("\n").map((l) => l.trim());
  let currentLeague: string | undefined;
  for (const line of lines) {
    const league = line.match(/^\| \[([^\]]+?)\]\(https?:\/\/zenit\.win\/(?:live|line)\/[^)]+\) \|$/);
    if (league) { currentLeague = league[1]; continue; }
    if (!/^\|.*\]\(https?:\/\/zenit\.win\/(?:live|line)\//.test(line)) continue;
    const cells = line.trim().replace(/^\||\|$/g, "").split("|").map((c) => c.trim());
    if (cells.length < 14) continue;
    const title = cells[0].match(/\[([^\]]+?)\]\((https?:\/\/zenit\.win\/[^\s)]+).*?"([^"-]+?)\s*-\s*([^"]+?)"\)/);
    if (!title) continue;
    const team1 = cleanParticipantName(title[3]);
    const team2 = cleanParticipantName(title[4]);
    const url = title[2];
    if (isJunkEvent(team1, team2, url)) continue;
    const n = (idx: number) => oddFromText(cells[idx] ?? "");
    const markets: RawMarket[] = [];
    addMarket(markets, "1X2", [{ outcome: "1", odds: n(1) }, { outcome: "X", odds: n(2) }, { outcome: "2", odds: n(3) }]);
    addMarket(markets, "Победитель", [{ outcome: "1", odds: n(1) }, { outcome: "2", odds: n(3) }]);
    addMarket(markets, "Двойной шанс", [{ outcome: "1X", odds: n(4) }, { outcome: "12", odds: n(5) }, { outcome: "X2", odds: n(6) }]);
    const h1 = numberFromText(cells[7] ?? "");
    const h2 = numberFromText(cells[9] ?? "");
    if (h1 !== undefined && h2 !== undefined) addMarket(markets, `Фора ${fmtLine(Math.abs(h1))}`, [{ outcome: `Ф1 ${fmtLine(h1)}`, odds: n(8) }, { outcome: `Ф2 ${fmtLine(h2)}`, odds: n(10) }]);
    const total = numberFromText(cells[12] ?? "");
    if (total !== undefined) addMarket(markets, `Тотал ${fmtLine(total)}`, [{ outcome: "М", odds: n(11) }, { outcome: "Б", odds: n(13) }]);
    if (markets.length) out.push({ bookmaker, url, sport: currentLeague?.includes("Баскетбол") ? "Basketball" : "Football", team1, team2, markets, league: currentLeague, dateKey: parseDateKey(cells[0]) });
  }
  return out;
}

function sideOdd(text: string): { side: "1" | "X" | "2"; odds: number } | null {
  const s = text.replace(/,/g, ".").replace(/\s+/g, "").replace(/^П/, "").replace(/[Хх]/, "X");
  const m = s.match(/^([12X])(\d{1,2}(?:\.\d{1,3})?)$/);
  if (!m) return null;
  const odds = Number(m[2]);
  return validOdd(odds) ? { side: m[1] as "1" | "X" | "2", odds } : null;
}

function handicapOdd(text: string): { side?: "1" | "2"; line: number; odds: number } | null {
  const s = text.replace(/−/g, "-").replace(/,/g, ".").replace(/\s+/g, " ").trim();
  const leon = s.match(/^([12])\s*\(([+-]?\d+(?:\.\d+)?)\)\s*(\d{1,2}(?:\.\d{1,3})?)$/);
  if (leon) {
    const odds = Number(leon[3]);
    return validOdd(odds) ? { side: leon[1] as "1" | "2", line: Number(leon[2]), odds } : null;
  }
  const compact = s.replace(/\s+/g, "").match(/^([+-]?\d+(?:\.\d)?)(\d{1,2}(?:\.\d{2,3})?)$/);
  if (compact) {
    const odds = Number(compact[2]);
    return validOdd(odds) ? { line: Number(compact[1]), odds } : null;
  }
  return null;
}

function parseDetailTeamPair(lines: string[]): { team1: string; team2: string; dateKey?: string } | null {
  const strip = (s: string) => cleanParticipantName(s.replace(/^#{1,6}\s*/, ""));
  const bad = /^(?:все|основные|тоталы|форы|исход|тотал|фора|победитель|похожие|купoн|купон|сегодня|завтра|п|в|-|матч|баскетбол)$/i;
  const looksTeam = (s: string) => {
    const x = strip(s);
    return x.length >= 3 && x.length <= 70 && /[a-zа-яё]/i.test(x) && !bad.test(x) && !/^!\[/.test(x) && !/^eJz/.test(x) && !/^\d/.test(x);
  };
  for (let i = 0; i < Math.min(lines.length - 1, 40); i++) {
    if (looksTeam(lines[i]) && looksTeam(lines[i + 1])) {
      return { team1: strip(lines[i]), team2: strip(lines[i + 1]), dateKey: parseDateKey(lines.slice(0, 20).join(" ")) };
    }
  }
  return null;
}

function pushHandicap(groups: Map<string, { outcome: string; odds: number }[]>, period: string, side: "1" | "2", line: number, odds: number) {
  const abs = Math.abs(line);
  const market = `${period ? `${period} ` : ""}Фора ${fmtLine(abs)}`.trim();
  const arr = groups.get(market) ?? [];
  arr.push({ outcome: `Ф${side} ${fmtLine(line)}`, odds });
  groups.set(market, arr);
}

function parseWinlineDetail(md: string, bookmaker: string): RawEvent[] {
  const lines = clean(md).map((l) => l.replace(/[\\|]/g, "").trim()).filter(Boolean);
  const pair = parseDetailTeamPair(lines);
  if (!pair) return [];
  const markets: RawMarket[] = [];
  const groups = new Map<string, { outcome: string; odds: number }[]>();
  for (let i = 0; i < lines.length; i++) {
    if (/^1\s*(?:четверть|[-–]?й\s*период)$/i.test(lines[i])) {
      const a = sideOdd(lines[i + 1] ?? ""), b = sideOdd(lines[i + 3] ?? "");
      if (a?.side === "1") pushHandicap(groups, "1 четверть", "1", -0.5, a.odds);
      if (b?.side === "2") pushHandicap(groups, "1 четверть", "2", -0.5, b.odds);
    }
    const period = /1\s*(?:четверть|[-–]?й\s*период).*фора/i.test(lines[i]) ? "1 четверть" : /1\s*половина.*фора/i.test(lines[i]) ? "1 половина" : /^#{0,6}\s*Фора/i.test(lines[i]) ? "" : undefined;
    if (period !== undefined) {
      let side: "1" | "2" | undefined;
      for (let j = i + 1; j < Math.min(lines.length, i + 35); j++) {
        if (/^#{1,6}\s/.test(lines[j]) && j > i + 1) break;
        if (teamSim(teamSig(lines[j]), teamSig(pair.team1)) > 0.8) { side = "1"; continue; }
        if (teamSim(teamSig(lines[j]), teamSig(pair.team2)) > 0.8) { side = "2"; continue; }
        const h = handicapOdd(lines[j]);
        if (side && h) pushHandicap(groups, period, side, h.line, h.odds);
      }
    }
  }
  for (const [market, selections] of groups) addMarket(markets, market, selections);
  return markets.length ? [{ bookmaker, url: "https://winline.ru/stavki/event/15721564", sport: "Basketball", team1: pair.team1, team2: pair.team2, markets, dateKey: pair.dateKey, league: "lfb-women" }] : [];
}

function parseLeonDetail(md: string, bookmaker: string): RawEvent[] {
  const lines = clean(md).map((l) => l.replace(/[\\|]/g, "").trim()).filter(Boolean);
  const pair = parseDetailTeamPair(lines);
  if (!pair) return [];
  const markets: RawMarket[] = [];
  const groups = new Map<string, { outcome: string; odds: number }[]>();
  for (let i = 0; i < lines.length; i++) {
    const period = /1[-–]?я\s*(?:четверть|период).*фора/i.test(lines[i]) ? "1 четверть" : /1[-–]?я\s*половина.*фора/i.test(lines[i]) ? "1 половина" : /^Фора$/i.test(lines[i]) ? "" : undefined;
    if (period === undefined) continue;
    for (let j = i + 1; j < Math.min(lines.length, i + 24); j++) {
      if (/^(?:Тотал|Победитель|Исход|Похожие|[12][-–]?я\s)/i.test(lines[j]) && j > i + 1) break;
      const h = handicapOdd(lines[j]);
      if (h?.side) pushHandicap(groups, period, h.side, h.line, h.odds);
    }
  }
  for (const [market, selections] of groups) addMarket(markets, market, selections);
  return markets.length ? [{ bookmaker, url: "https://leon.ru/bets/Basketball/france/lfb-women/1970324851752779-toulouse-metropole-basket-w-angers-basket", sport: "Basketball", team1: pair.team1, team2: pair.team2, markets, dateKey: pair.dateKey, league: "lfb-women" }] : [];
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
  const fromLeague = ev.league ? leagueFromText(ev.league) : undefined;
  return fromLeague ?? leagueFromText(ev.url) ?? leagueSlugFromUrl(ev.url) ?? (ev.league ? translit(ev.league.toLowerCase()).replace(/[^a-z0-9]/g, "-").slice(0, 30) : "any");
}

function canonicalEvent(team1: string, team2: string, _league: string, dateKey?: string): { key: string; flip: boolean; display: string } {
  const a = teamSig(team1);
  const b = teamSig(team2);
  const flip = a > b;
  const pair = flip ? `${b}|${a}` : `${a}|${b}`;
  // NOTE: league intentionally excluded from key — different bookies label
  // leagues differently, which prevented matching. Date + teams is enough
  // to distinguish events (same teams almost never play twice in one day).
  return {
    key: `${dateKey ?? "date-any"}|${pair}`,
    flip,
    display: flip ? `${team2} — ${team1}` : `${team1} — ${team2}`,
  };
}

function displayKey(key: string): string {
  return key.split("|").slice(1).join(" — ");
}

// === Fuzzy similarity (Dice coefficient on character bigrams) ===
function bigrams(s: string): Set<string> {
  const out = new Set<string>();
  const t = s.replace(/_/g, "");
  for (let i = 0; i < t.length - 1; i++) out.add(t.slice(i, i + 2));
  return out;
}
function dice(a: string, b: string): number {
  if (!a || !b) return 0;
  if (a === b) return 1;
  const A = bigrams(a), B = bigrams(b);
  if (!A.size || !B.size) return 0;
  let inter = 0;
  for (const x of A) if (B.has(x)) inter++;
  return (2 * inter) / (A.size + B.size);
}
// Token-level Jaccard for multi-word names
function tokenJaccard(a: string, b: string): number {
  const A = new Set(a.split("_").filter(Boolean));
  const B = new Set(b.split("_").filter(Boolean));
  if (!A.size || !B.size) return 0;
  let inter = 0;
  for (const x of A) if (B.has(x)) inter++;
  return inter / new Set([...A, ...B]).size;
}
function teamSim(a: string, b: string): number {
  if (a === b) return 1;
  // accept either strong char similarity OR shared token
  return Math.max(dice(a, b), tokenJaccard(a, b));
}
const SIM_THRESHOLD = 0.72;

// Union-find
class UF {
  p = new Map<string, string>();
  find(x: string): string {
    if (!this.p.has(x)) { this.p.set(x, x); return x; }
    let r = x;
    while (this.p.get(r)! !== r) r = this.p.get(r)!;
    let c = x;
    while (this.p.get(c)! !== c) { const n = this.p.get(c)!; this.p.set(c, r); c = n; }
    return r;
  }
  union(a: string, b: string) {
    const ra = this.find(a), rb = this.find(b);
    if (ra === rb) return;
    // Keep lexicographically smaller as root for stability
    if (ra < rb) this.p.set(rb, ra); else this.p.set(ra, rb);
  }
}

// Cluster canonical keys by fuzzy team-pair similarity within same dateKey.
// Returns map: originalKey → clusterRootKey, plus a list of merge logs.
function clusterEventKeys(
  meta: Map<string, { sigA: string; sigB: string; dateKey: string; samples: Set<string> }>,
): { remap: Map<string, string>; merges: { from: string; into: string; sample: string }[] } {
  const uf = new UF();
  const keys = Array.from(meta.keys());
  // Bucket by dateKey to limit O(n²) cost
  const byDate = new Map<string, string[]>();
  for (const k of keys) {
    const d = meta.get(k)!.dateKey;
    const arr = byDate.get(d) ?? [];
    arr.push(k);
    byDate.set(d, arr);
  }
  const merges: { from: string; into: string; sample: string }[] = [];
  for (const [, group] of byDate) {
    for (let i = 0; i < group.length; i++) {
      for (let j = i + 1; j < group.length; j++) {
        const A = meta.get(group[i])!;
        const B = meta.get(group[j])!;
        // try both orientations
        const direct = Math.min(teamSim(A.sigA, B.sigA), teamSim(A.sigB, B.sigB));
        const flipped = Math.min(teamSim(A.sigA, B.sigB), teamSim(A.sigB, B.sigA));
        const score = Math.max(direct, flipped);
        if (score >= SIM_THRESHOLD) {
          uf.union(group[i], group[j]);
        }
      }
    }
  }
  const remap = new Map<string, string>();
  for (const k of keys) remap.set(k, uf.find(k));
  // Build merge log: for each non-trivial cluster, list members
  const clusters = new Map<string, string[]>();
  for (const k of keys) {
    const r = uf.find(k);
    const arr = clusters.get(r) ?? [];
    arr.push(k);
    clusters.set(r, arr);
  }
  for (const [root, members] of clusters) {
    if (members.length < 2) continue;
    const rootSample = Array.from(meta.get(root)!.samples)[0] ?? root;
    for (const m of members) {
      if (m === root) continue;
      const sample = Array.from(meta.get(m)!.samples)[0] ?? m;
      merges.push({ from: sample, into: rootSample, sample: m });
    }
  }
  return { remap, merges };
}

function orientMarkets(markets: RawMarket[], flip: boolean): RawMarket[] {
  if (!flip) return markets;
  const swapOutcome = (outcome: string) => outcome
    .replace(/^1$/, "__TWO__").replace(/^2$/, "1").replace(/^__TWO__$/, "2")
    .replace(/^1X$/, "__X2__").replace(/^X2$/, "1X").replace(/^__X2__$/, "X2")
    .replace(/^Ф1\b/, "__F2__").replace(/^Ф2\b/, "Ф1").replace(/^__F2__/, "Ф2");
  const swapMarket = (market: string) => market
    .replace(/^ИТ1\b/, "__IT2__").replace(/^ИТ2\b/, "ИТ1").replace(/^__IT2__/, "ИТ2");
  return markets.map((m) => ({
    market: swapMarket(m.market),
    selections: m.selections.map((s) => ({ ...s, outcome: swapOutcome(s.outcome) })),
  }));
}

export const scanRussianBookies = createServerFn({ method: "POST" })
  .inputValidator((d: { stake?: number; minRoi?: number }) => ({
    stake: typeof d?.stake === "number" && d.stake > 0 ? d.stake : 10000,
    minRoi: typeof d?.minRoi === "number" ? d.minRoi : 0,
  }))
  .handler(async ({ data }) => {
    const sources = RU_SOURCES;
    const bookieResults = await Promise.all(sources.map((s) => scanOneSource(s)));
    return finalizeRuScan({ data: { stake: data.stake, minRoi: data.minRoi, results: bookieResults } });
  });

export interface RuSource {
  name: string;
  url: string;
  parser: "generic" | "fonbet" | "marathon" | "tennisi" | "betboom" | "leon" | "zenit" | "winline-detail" | "leon-detail";
}

export const RU_SOURCES: RuSource[] = [
  { name: "Winline", url: "https://winline.ru/live", parser: "generic" },
  { name: "Fonbet", url: "https://www.fon.bet/sports", parser: "fonbet" },
  { name: "Marathonbet", url: "https://www.marathonbet.ru/su/live/popular", parser: "marathon" },
  { name: "Tennisi", url: "https://tennisi.bet/live", parser: "tennisi" },
  { name: "BetBoom", url: "https://betboom.ru/sport/live", parser: "betboom" },
  { name: "Leon", url: "https://leon.ru/live", parser: "leon" },
  { name: "Zenit", url: "https://zenit.win/line", parser: "zenit" },
];

interface SourceScanResult {
  name: string;
  url: string;
  events: RawEvent[];
  error?: string;
  ms: number;
}

async function scanOneSource(s: RuSource): Promise<SourceScanResult> {
  const t0 = Date.now();
  try {
    if (s.parser === "winline-detail" || s.parser === "leon-detail") {
      const extracted = await fcExtractEvent(s.url);
      let events = eventFromExtracted(extracted, s.name, s.url, "Basketball", "lfb-women");
      if (!events.length) {
        const md = await fcScrape(s.url, 2500);
        events = s.parser === "winline-detail" ? parseWinlineDetail(md, s.name) : parseLeonDetail(md, s.name);
      }
      return { name: s.name, url: s.url, events, ms: Date.now() - t0 };
    }
    const md = await fcScrape(s.url, 2500);
    let events =
      s.parser === "marathon" ? parseMarathonbet(md, s.name)
        : s.parser === "tennisi" ? parseTennisi(md, s.name)
          : s.parser === "betboom" ? parseBetBoom(md, s.name)
            : s.parser === "leon" ? parseLeon(md, s.name)
              : s.parser === "zenit" ? parseZenit(md, s.name)
                : s.parser === "fonbet" ? parseFonbet(md, s.name)
                  : parseGenericLine(clean(md), s.name);
    if (!events.length && ENABLE_RU_AI_FALLBACK) {
      const sportHint = /basket|баскет/i.test(s.url) ? "Basketball" : undefined;
      const list = await withTimeout(fcExtractList(s.url, sportHint), LIST_FALLBACK_BUDGET_MS);
      events = eventsFromExtractedList(list, s.name, s.url, sportHint);
    }
    return { name: s.name, url: s.url, events, ms: Date.now() - t0 };
  } catch (e: any) {
    return { name: s.name, url: s.url, events: [], error: e?.message ?? String(e), ms: Date.now() - t0 };
  }
}

export const listRuSources = createServerFn({ method: "GET" }).handler(async () => RU_SOURCES);

export const scanRuSource = createServerFn({ method: "POST" })
  .inputValidator((d: { source: RuSource }) => ({ source: d.source }))
  .handler(async ({ data }) => scanOneSource(data.source));

export const finalizeRuScan = createServerFn({ method: "POST" })
  .inputValidator((d: any) => ({
    stake: typeof d?.stake === "number" && d.stake > 0 ? d.stake : 10000,
    minRoi: typeof d?.minRoi === "number" ? d.minRoi : 0,
    results: (Array.isArray(d?.results) ? d.results : []) as SourceScanResult[],
  }))
  .handler(async ({ data }) => {
    const bookieResults = data.results;

    // Build OddRow entries; key events by canonical team pair
    const odds: OddRow[] = [];
    const keyMeta = new Map<string, { sigA: string; sigB: string; dateKey: string; samples: Set<string> }>();
    for (const br of bookieResults) {
      for (const ev of br.events) {
        const canonical = canonicalEvent(ev.team1, ev.team2, eventLeague(ev), ev.dateKey);
        const sigA = teamSig(ev.team1);
        const sigB = teamSig(ev.team2);
        const [lo, hi] = sigA < sigB ? [sigA, sigB] : [sigB, sigA];
        let meta = keyMeta.get(canonical.key);
        if (!meta) {
          meta = { sigA: lo, sigB: hi, dateKey: ev.dateKey ?? "date-any", samples: new Set() };
          keyMeta.set(canonical.key, meta);
        }
        meta.samples.add(canonical.display);
        const markets = orientMarkets(ev.markets?.length ? ev.markets : legacyMarkets(ev.odds), canonical.flip);
        for (const market of markets) {
          for (const selection of market.selections) {
            odds.push({
              id: `${br.name}-${canonical.key}-${market.market}-${selection.outcome}`,
              bookmaker_id: br.name,
              bookmaker_name: br.name,
              sport: ev.sport ?? "Football",
              tournament: null,
              event_name: canonical.key,
              event_time: null,
              market: market.market,
              outcome: selection.outcome,
              odds: selection.odds,
              url: ev.url,
            });
          }
        }
      }
    }

    // Fuzzy-cluster canonical keys (handles "Спартак М" vs "Спартак Москва", etc.)
    const { remap, merges } = clusterEventKeys(keyMeta);
    if (merges.length) {
      console.log(`[ruScanner] merged ${merges.length} fuzzy team-pair groups:`);
      for (const m of merges.slice(0, 50)) {
        console.log(`  • "${m.from}" → "${m.into}"`);
      }
    } else {
      console.log("[ruScanner] no fuzzy merges this run");
    }
    for (const o of odds) {
      o.event_name = remap.get(o.event_name) ?? o.event_name;
      o.id = `${o.bookmaker_id}-${o.event_name}-${o.market}-${o.outcome}`;
    }

    // Map canonical key → display name (prefer Russian)
    const displayMap = new Map<string, string>();
    for (const br of bookieResults) {
      for (const ev of br.events) {
        const canonical = canonicalEvent(ev.team1, ev.team2, eventLeague(ev), ev.dateKey);
        const root = remap.get(canonical.key) ?? canonical.key;
        const isCyr = /[а-яё]/i.test(ev.team1);
        if (!displayMap.has(root) || isCyr) {
          displayMap.set(root, ev.dateKey ? `${ev.dateKey} · ${canonical.display}` : canonical.display);
        }
      }
    }

    const arbs = findArbitrages(odds, data.stake, data.minRoi);
    const arbsDisplay: Arb[] = arbs.map((a) => ({
      ...a,
      event_name: displayMap.get(a.event_name) ?? displayKey(a.event_name),
    }));

    // === Top matched events (present in 2+ bookies) ===
    type Pick = { bm: string; odds: number; url: string };
    const grouped = new Map<string, Map<string, Pick[]>>();
    const urlMap = new Map<string, Map<string, string>>();
    for (const br of bookieResults) {
      for (const ev of br.events) {
        const k0 = canonicalEvent(ev.team1, ev.team2, eventLeague(ev), ev.dateKey).key;
        const k = remap.get(k0) ?? k0;
        let bmUrls = urlMap.get(k);
        if (!bmUrls) { bmUrls = new Map(); urlMap.set(k, bmUrls); }
        bmUrls.set(br.name, ev.url);
      }
    }
    for (const o of odds) {
      const groupKey = `${o.event_name}|${o.market}`;
      let m1 = grouped.get(groupKey);
      if (!m1) { m1 = new Map(); grouped.set(groupKey, m1); }
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
      const [eventKey, marketName] = key.split(/\|(?=[^|]+$)/);
      const bmSet = new Set<string>();
      for (const arr of outcomes.values()) for (const p of arr) bmSet.add(p.bm);
      if (bmSet.size < 2) continue;
      if (outcomes.size < 2) continue;
      const best = Array.from(outcomes.entries()).map(([outcome, arr]) => {
        const top = arr.reduce((a, b) => (b.odds > a.odds ? b : a));
        return { outcome, odds: top.odds, bm: top.bm };
      });
      const arbPercent = best.reduce((s, l) => s + 1 / l.odds, 0);
      const bmUrls = urlMap.get(eventKey);
      matched.push({
        event_name: `${displayMap.get(eventKey) ?? displayKey(eventKey)} · ${marketName}`,
        arbPercent,
        bookies: Array.from(bmSet).map((n) => ({ name: n, url: bmUrls?.get(n) ?? "" })),
        best,
      });
    }
    matched.sort((a, b) => a.arbPercent - b.arbPercent);

    return {
      arbs: arbsDisplay,
      stats: Array.from(bookieResults.reduce((acc, br) => {
        const prev = acc.get(br.name);
        acc.set(br.name, {
          bookmaker: br.name,
          url: prev?.url ?? br.url,
          events: (prev?.events ?? 0) + br.events.length,
          error: prev?.error ?? br.error,
        });
        return acc;
      }, new Map<string, { bookmaker: string; url: string; events: number; error?: string }>()).values()),
      totalOdds: odds.length,
      matchedEvents: new Set(odds.map((o) => o.event_name)).size,
      topMatches: matched.slice(0, 20),
      scannedAt: new Date().toISOString(),
    };
  });

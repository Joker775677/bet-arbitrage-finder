// Russian bookmaker scraper microservice.
// Runs Playwright Chromium with rotating RU proxies and returns page markdown.
// Designed for Render.com / Railway / any Docker host (NOT Cloudflare Workers).

import express from "express";
import { chromium } from "playwright";
import TurndownService from "turndown";
import { HttpsProxyAgent } from "https-proxy-agent";
import { fetch as undiciFetch, ProxyAgent } from "undici";
import zlib from "zlib";

const PORT = process.env.PORT || 3000;
const TOKEN = process.env.SCRAPER_TOKEN || "";
const PROXIES = (process.env.RU_PROXY_LIST || "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean); // format: user:pass@ip:port

if (!TOKEN) console.warn("[warn] SCRAPER_TOKEN not set — endpoint is public!");
if (!PROXIES.length) console.warn("[warn] RU_PROXY_LIST empty — running without proxy");

let proxyIdx = 0;
function nextProxy() {
  if (!PROXIES.length) return null;
  const raw = PROXIES[proxyIdx++ % PROXIES.length];
  // user:pass@ip:port
  const m = raw.match(/^(?:([^:]+):([^@]+)@)?([^:]+):(\d+)$/);
  if (!m) return null;
  const [, user, pass, host, port] = m;
  return { server: `http://${host}:${port}`, username: user, password: pass };
}

const td = new TurndownService({ headingStyle: "atx", codeBlockStyle: "fenced" });
td.remove(["script", "style", "noscript", "iframe", "svg"]);

const app = express();
app.use(express.json({ limit: "1mb" }));

app.get("/health", (_req, res) => res.json({ ok: true, proxies: PROXIES.length }));

async function scrapePage({ url, waitFor = 4000, waitForSelector = null }) {
  const proxy = nextProxy();
  const t0 = Date.now();
  let browser;
  try {
    browser = await chromium.launch({
      headless: true,
      proxy: proxy || undefined,
      args: ["--no-sandbox", "--disable-blink-features=AutomationControlled"],
    });
    const ctx = await browser.newContext({
      userAgent:
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
      locale: "ru-RU",
      timezoneId: "Europe/Moscow",
      viewport: { width: 1366, height: 900 },
    });
    const page = await ctx.newPage();
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45000 });
    if (waitForSelector) {
      await page.waitForSelector(waitForSelector, { timeout: 15000 }).catch(() => {});
    }
    if (waitFor > 0) await page.waitForTimeout(Math.min(waitFor, 15000));

    const html = await page.content();
    const title = await page.title();
    const markdown = td.turndown(html);

    return {
      ok: true,
      url,
      title,
      markdown,
      length: markdown.length,
      proxyUsed: proxy ? proxy.server : null,
      ms: Date.now() - t0,
    };
  } catch (e) {
    return {
      ok: false,
      error: e?.message || String(e),
      proxyUsed: proxy ? proxy.server : null,
      ms: Date.now() - t0,
    };
  } finally {
    if (browser) await browser.close().catch(() => {});
  }
}

app.post("/scrape", async (req, res) => {
  if (TOKEN && req.headers["x-token"] !== TOKEN) {
    return res.status(401).json({ error: "unauthorized" });
  }
  const { url, waitFor = 4000, waitForSelector = null } = req.body || {};
  if (!url || typeof url !== "string") return res.status(400).json({ error: "url required" });
  const result = await scrapePage({ url, waitFor, waitForSelector });
  return res.status(result.ok ? 200 : 502).json(result);
});

function parseWinlineText(text, hrefIds = []) {
  const lines = String(text || "")
    .split(/[\r\n]+/)
    .map((x) => x.replace(/\u00a0/g, " ").trim())
    .filter(Boolean);

  const uniq = (arr) => [...new Set(arr)];
  const isTimeLine = (s) => /^(?:�������|������|\d{2}\.\d{2})\s+\d{1,2}:\d{2}$/i.test(s);
  const isLiveLine = (s) => /(?:^|\s)(?:1�|2�|3�|\d{1,2}'(?:\+\d+)?|Tx\d+)/i.test(s);
  const isOddLine = (s) => /^\d{1,2}\.\d{2}$/.test(s);
  const isMetaLine = (s) => /^(?:����|1 ����|2 ����|1�|2�|���|�����|�����|Live ������|���� 24\/7|����������)$/i.test(s);
  const looksTeam = (s) => (
    !!s &&
    !isTimeLine(s) &&
    !isLiveLine(s) &&
    !isOddLine(s) &&
    !isMetaLine(s) &&
    !/^\+?\d+$/.test(s) &&
    !/^\.st\d+\{/.test(s)
  );

  const items = [];
  const debug = [];
  let hrefIdx = 0;

  for (let i = 0; i < lines.length - 2; i++) {
    const team1 = lines[i];
    const team2 = lines[i + 1];
    if (!looksTeam(team1) || !looksTeam(team2)) continue;

    let timeText = null;
    let timeIdx = -1;
    for (let j = i + 2; j <= Math.min(i + 8, lines.length - 1); j++) {
      if (isTimeLine(lines[j])) {
        timeText = lines[j];
        timeIdx = j;
        break;
      }
    }
    if (!timeText) continue;

    const oddsLines = [];
    for (let j = timeIdx + 1; j < Math.min(timeIdx + 18, lines.length); j++) {
      const row = lines[j];
      if (j > timeIdx + 1 && looksTeam(row) && j + 1 < lines.length && looksTeam(lines[j + 1])) break;
      if (isTimeLine(row)) break;
      oddsLines.push(row);
    }

    const odds = uniq((oddsLines.join(" ").match(/\b\d{1,2}\.\d{2}\b/g) || [])
      .map((x) => Number(x))
      .filter((x) => x > 1.01 && x < 30)).slice(0, 3);

    const eventId = hrefIds[hrefIdx++] || (90000000 + items.length);
    debug.push({ eventId, sample: [team1, team2, timeText, ...oddsLines.slice(0, 5)], odds, timeText });
    if (odds.length < 3) continue;

    items.push({
      eventId,
      team1,
      team2,
      startText: timeText,
      odds,
    });

    i = timeIdx;
  }

  return { items, debug: debug.slice(0, 12) };
}

async function scrapeWinlineDom() {
  const proxy = nextProxy();
  const t0 = Date.now();
  let browser;
  try {
    browser = await chromium.launch({
      headless: true,
      proxy: proxy || undefined,
      args: ["--no-sandbox", "--disable-blink-features=AutomationControlled"],
    });
    const ctx = await browser.newContext({
      userAgent:
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
      locale: "ru-RU",
      timezoneId: "Europe/Moscow",
      viewport: { width: 1366, height: 900 },
    });
    const page = await ctx.newPage();
    await page.goto("https://winline.ru/stavki", { waitUntil: "domcontentloaded", timeout: 45000 });
    await page.waitForSelector('a[href*="/stavki/event/"]', { timeout: 15000 }).catch(() => {});

    const nearestSelectors = [
      'text=���������',
      '[role="tab"]:has-text("���������")',
      'button:has-text("���������")',
      'a:has-text("���������")',
    ];
    for (const selector of nearestSelectors) {
      try {
        const locator = page.locator(selector).first();
        if (await locator.count()) {
          await locator.click({ timeout: 3000 });
          break;
        }
      } catch {}
    }

    await page.waitForTimeout(7000);

    const title = await page.title();
    const hrefIds = await page.evaluate(() => Array.from(document.querySelectorAll('a[href*="/stavki/event/"]')).map((a) => {
      const href = a.getAttribute("href") || "";
      const m = href.match(/\/stavki\/event\/(\d+)/);
      return m ? Number(m[1]) : null;
    }).filter(Boolean));
    const bodyText = await page.locator("body").innerText().catch(() => "");
    const parsed = parseWinlineText(bodyText, hrefIds);

    const events = parsed.items.map((item) => ({
      eventId: item.eventId,
      sport: null,
      tournament: "Winline",
      team1: item.team1,
      team2: item.team2,
      eventName: `${item.team1} � ${item.team2}`,
      startTime: null,
      live: false,
      odds: [
        { market: "1X2", outcome: "1", odds: Number(item.odds[0]) },
        { market: "1X2", outcome: "X", odds: Number(item.odds[1]) },
        { market: "1X2", outcome: "2", odds: Number(item.odds[2]) },
      ],
    }));

    return {
      ok: true,
      title,
      events,
      debug: parsed.debug,
      proxyUsed: proxy ? proxy.server : null,
      ms: Date.now() - t0,
    };
  } catch (e) {
    return {
      ok: false,
      error: e?.message || String(e),
      proxyUsed: proxy ? proxy.server : null,
      ms: Date.now() - t0,
    };
  } finally {
    if (browser) await browser.close().catch(() => {});
  }
}

app.get("/winline", async (req, res) => {
  if (TOKEN && req.headers["x-token"] !== TOKEN) return res.status(401).json({ error: "unauthorized" });
  const result = await scrapeWinlineDom();
  if (!result.ok) return res.status(502).json({ ok: false, bookmaker: "winline", error: result.error, ms: result.ms });
  return res.json({
    ok: true,
    bookmaker: "winline",
    title: result.title,
    eventsCount: result.events.length,
    proxyUsed: result.proxyUsed,
    ms: result.ms,
    debug: result.events.length ? undefined : result.debug,
    events: result.events,
  });
});

// ============== Fonbet direct JSON API ==============
// Маппинг factor IDs Fonbet → market/outcome
// (см. https://line52w.bk6bba-resources.com — фактор-таблица)
const FACTOR_MAP = {
  // 1X2
  921: { market: "1X2", outcome: "1" },
  922: { market: "1X2", outcome: "X" },
  923: { market: "1X2", outcome: "2" },
  // Двойной шанс
  924: { market: "DC",  outcome: "1X" },
  925: { market: "DC",  outcome: "12" },
  926: { market: "DC",  outcome: "X2" },
  // Тотал (использует pt как линию)
  930: { market: "TOTAL", outcome: "OVER" },
  931: { market: "TOTAL", outcome: "UNDER" },
  // Фора (pt = +/-N)
  927: { market: "HANDICAP", outcome: "1" },
  928: { market: "HANDICAP", outcome: "2" },
  // Индив. тотал команды 1
  1873: { market: "TEAM_TOTAL_1", outcome: "OVER" },
  1874: { market: "TEAM_TOTAL_1", outcome: "UNDER" },
  // Индив. тотал команды 2
  1875: { market: "TEAM_TOTAL_2", outcome: "OVER" },
  1876: { market: "TEAM_TOTAL_2", outcome: "UNDER" },
  // Обе забьют
  1737: { market: "BTTS", outcome: "YES" },
  1738: { market: "BTTS", outcome: "NO" },
  // === Угловые ===
  // Тотал угловых
  1727: { market: "CORNERS_TOTAL", outcome: "OVER" },
  1728: { market: "CORNERS_TOTAL", outcome: "UNDER" },
  // Индивидуальный тотал угловых команды 1
  1733: { market: "CORNERS_TEAM_TOTAL_1", outcome: "OVER" },
  1734: { market: "CORNERS_TEAM_TOTAL_1", outcome: "UNDER" },
  // Индивидуальный тотал угловых команды 2
  1736: { market: "CORNERS_TEAM_TOTAL_2", outcome: "OVER" },
  1739: { market: "CORNERS_TEAM_TOTAL_2", outcome: "UNDER" },
  // Фора по угловым
  1730: { market: "CORNERS_HANDICAP", outcome: "1" },
  1731: { market: "CORNERS_HANDICAP", outcome: "2" },
};

function pickProxyUrl() {
  if (!PROXIES.length) return null;
  const raw = PROXIES[proxyIdx++ % PROXIES.length];
  const m = raw.match(/^(?:([^:]+):([^@]+)@)?([^:]+):(\d+)$/);
  if (!m) return null;
  const [, user, pass, host, port] = m;
  return user
    ? `http://${user}:${pass}@${host}:${port}`
    : `http://${host}:${port}`;
}

// Конфигурация ресурсных хостов на разных Fonbet-движках (Pari использует тот же engine)
const ENGINE_CONFIG = {
  fonbet: { host: "line52w.bk6bba-resources.com", referer: "https://www.fon.bet/", defaultScope: 1600 },
  pari:   { host: "line-lb01-w.pb06e2-resources.com", referer: "https://pari.ru/",   defaultScope: 2300 },
};

async function fetchEngineSnapshot(engine, scopeMarket) {
  const cfg = ENGINE_CONFIG[engine];
  if (!cfg) throw new Error(`unknown engine ${engine}`);
  const proxyUrl = pickProxyUrl();
  const dispatcher = proxyUrl ? new ProxyAgent(proxyUrl) : undefined;
  const url = `https://${cfg.host}/events/list?lang=ru&scopeMarket=${scopeMarket || cfg.defaultScope}`;
  const res = await undiciFetch(url, {
    dispatcher,
    headers: {
      "Accept": "application/json",
      "Accept-Encoding": "gzip, deflate",
      "Referer": cfg.referer,
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131.0 Safari/537.36",
    },
  });
  if (!res.ok) throw new Error(`${engine} ${scopeMarket} status ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  // undici обычно сам распаковывает, но на всякий случай:
  let text;
  try { text = buf.toString("utf8"); JSON.parse(text); }
  catch {
    try { text = zlib.gunzipSync(buf).toString("utf8"); }
    catch { text = zlib.inflateSync(buf).toString("utf8"); }
  }
  return JSON.parse(text);
}

function normalizeEngine(data) {
  const sportsById = new Map((data.sports || []).map(s => [s.id, s]));
  // Поднимаемся по parentIds от segment до root sport (kind === 'sport')
  function rootSport(sportId) {
    const seg = sportsById.get(sportId);
    if (!seg) return null;
    const chain = [seg, ...(seg.parentIds || []).map(id => sportsById.get(id)).filter(Boolean)];
    const root = chain.find(s => s && s.kind === "sport");
    return root?.name || chain[chain.length - 1]?.name || null;
  }
  function tournament(sportId) {
    const seg = sportsById.get(sportId);
    if (!seg) return null;
    // segment.name уже содержит "Лига Чемпионов УЕФА. 1/2 финала"
    return seg.name || null;
  }

  const factorsByEvent = new Map();
  for (const cf of data.customFactors || []) {
    factorsByEvent.set(cf.e, cf.factors || []);
  }

  const out = [];
  for (const ev of data.events || []) {
    if (ev.level !== 1) continue; // только матчи
    if (!ev.team1 || !ev.team2) continue;
    const factors = factorsByEvent.get(ev.id) || [];
    if (!factors.length) continue;

    const sportName = rootSport(ev.sportId);
    const tour = tournament(ev.sportId);

    const odds = [];
    for (const f of factors) {
      const map = FACTOR_MAP[f.f];
      if (!map) continue;
      if (typeof f.v !== "number" || f.v < 1.01) continue;
      let outcome = map.outcome;
      // линия для тоталов/фор
      if (f.pt !== undefined && map.market !== "1X2" && map.market !== "DC" && map.market !== "BTTS") {
        outcome = `${outcome} ${f.pt}`;
      }
      odds.push({ market: map.market, outcome, odds: f.v });
    }
    if (!odds.length) continue;

    out.push({
      eventId: ev.id,
      sport: sportName,
      tournament: tour,
      team1: ev.team1,
      team2: ev.team2,
      eventName: `${ev.team1} — ${ev.team2}`,
      startTime: ev.startTime ? new Date(ev.startTime * 1000).toISOString() : null,
      live: ev.place === "live",
      odds,
    });
  }
  return out;
}

// Универсальный handler для всех движков на Fonbet-платформе
function makeEngineHandler(engine) {
  return async (req, res) => {
    if (TOKEN && req.headers["x-token"] !== TOKEN) {
      return res.status(401).json({ error: "unauthorized" });
    }
    const scope = parseInt(req.query.scope, 10) || ENGINE_CONFIG[engine].defaultScope;
    const t0 = Date.now();
    try {
      const snap = await fetchEngineSnapshot(engine, scope);
      const events = normalizeEngine(snap);
      return res.json({
        ok: true,
        bookmaker: engine,
        scope,
        eventsCount: events.length,
        ms: Date.now() - t0,
        events,
      });
    } catch (e) {
      return res.status(502).json({ ok: false, error: e?.message || String(e), ms: Date.now() - t0 });
    }
  };
}

app.get("/fonbet", makeEngineHandler("fonbet"));
app.get("/pari",   makeEngineHandler("pari"));

// ============== Leon direct JSON API ==============
const LEON_FLAGS = "reg,urlv2,orn2,mm2,rrc,nodup,cmg";
// to=N — окно прематча в минутах (120 = 2 часа, 4320 = 3 суток)
const LEON_URLS = [
  `https://leon.ru/api-2/betline/events/inplayupcoming?ctag=ru-RU&hideClosed=true&flags=${LEON_FLAGS}`,
  `https://leon.ru/api-2/betline/events/prematch?ctag=ru-RU&to=4320&hideClosed=true&flags=${LEON_FLAGS}`,
];

async function fetchLeonSnapshots() {
  const proxyUrl = pickProxyUrl();
  const dispatcher = proxyUrl ? new ProxyAgent(proxyUrl) : undefined;
  const out = [];
  for (const url of LEON_URLS) {
    try {
      const res = await undiciFetch(url, {
        dispatcher,
        headers: {
          Accept: "application/json, text/plain, */*",
          "Accept-Language": "ru-RU,ru;q=0.9",
          Referer: "https://leon.ru/",
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131.0 Safari/537.36",
        },
      });
      if (!res.ok) { console.log(`[leon] ${url.split("?")[0]} status ${res.status}`); continue; }
      out.push(await res.json());
    } catch (e) {
      console.log(`[leon] fetch error: ${e?.message}`);
    }
  }
  return out;
}

function mapLeonMarket(market, runner) {
  const name = (market.name || "").toLowerCase();
  const tag = market.typeTag || "";
  const tags = runner.tags || [];
  const hcap = runner.handicap ?? market.handicap;

  // 1X2 — основной исход (исключаем "Кто забьет N-й гол")
  if (tag === "REGULAR" && (name.includes("исход") || name.includes("1х2") || name.includes("1x2"))) {
    if (tags.includes("HOME")) return { market: "1X2", outcome: "1" };
    if (tags.includes("DRAW")) return { market: "1X2", outcome: "X" };
    if (tags.includes("AWAY")) return { market: "1X2", outcome: "2" };
  }
  // Двойной шанс
  if (name.includes("двойной")) {
    if (tags.includes("HOME_OR_DRAW") || tags.includes("1X")) return { market: "DC", outcome: "1X" };
    if (tags.includes("HOME_OR_AWAY") || tags.includes("12")) return { market: "DC", outcome: "12" };
    if (tags.includes("DRAW_OR_AWAY") || tags.includes("X2")) return { market: "DC", outcome: "X2" };
  }
  // Обе забьют
  if (name.includes("обе") && name.includes("заб")) {
    if (tags.includes("YES")) return { market: "BTTS", outcome: "YES" };
    if (tags.includes("NO"))  return { market: "BTTS", outcome: "NO" };
  }
  // Тоталы
  if (tag === "TOTAL" && hcap != null) {
    const isTeam1 = name.includes("хозя") || name.includes("команд 1") || name.includes("1-й команды");
    const isTeam2 = name.includes("гост") || name.includes("команд 2") || name.includes("2-й команды");
    const isHalf  = name.includes("тайм");
    if (isHalf) return null; // пока пропускаем тоталы по таймам
    const mk = isTeam1 ? "TEAM_TOTAL_1" : isTeam2 ? "TEAM_TOTAL_2" : "TOTAL";
    if (tags.includes("OVER"))  return { market: mk, outcome: `OVER ${hcap}` };
    if (tags.includes("UNDER")) return { market: mk, outcome: `UNDER ${hcap}` };
  }
  // Фора (включая азиатскую)
  if (tag === "HANDICAP" && hcap != null) {
    const isHalf = name.includes("тайм");
    if (isHalf) return null;
    if (tags.includes("HOME")) return { market: "HANDICAP", outcome: `1 ${hcap}` };
    if (tags.includes("AWAY")) return { market: "HANDICAP", outcome: `2 ${hcap}` };
  }
  // Угловые: тотал/фора/индивидуальный тотал
  if (name.includes("углов")) {
    const isHalf = name.includes("тайм");
    if (isHalf) return null;
    const isTeam1 = name.includes("хозя") || name.includes("команд 1") || name.includes("1-й команды");
    const isTeam2 = name.includes("гост") || name.includes("команд 2") || name.includes("2-й команды");
    if (tag === "TOTAL" && hcap != null) {
      const mk = isTeam1 ? "CORNERS_TEAM_TOTAL_1" : isTeam2 ? "CORNERS_TEAM_TOTAL_2" : "CORNERS_TOTAL";
      if (tags.includes("OVER"))  return { market: mk, outcome: `OVER ${hcap}` };
      if (tags.includes("UNDER")) return { market: mk, outcome: `UNDER ${hcap}` };
    }
    if (tag === "HANDICAP" && hcap != null) {
      if (tags.includes("HOME")) return { market: "CORNERS_HANDICAP", outcome: `1 ${hcap}` };
      if (tags.includes("AWAY")) return { market: "CORNERS_HANDICAP", outcome: `2 ${hcap}` };
    }
    // Победитель по угловым
    if (tag === "REGULAR") {
      if (tags.includes("HOME")) return { market: "CORNERS_1X2", outcome: "1" };
      if (tags.includes("DRAW")) return { market: "CORNERS_1X2", outcome: "X" };
      if (tags.includes("AWAY")) return { market: "CORNERS_1X2", outcome: "2" };
    }
  }
  return null;
}

function normalizeLeon(snapshots) {
  const out = [];
  const byId = new Map();
  for (const data of snapshots) {
    for (const ev of data.events || []) {
      if (byId.has(ev.id)) continue;
      const comps = ev.competitors || [];
      const home = comps.find((c) => c.homeAway === "HOME") || comps[0];
      const away = comps.find((c) => c.homeAway === "AWAY") || comps[1];
      if (!home?.name || !away?.name) continue;
      const odds = [];
      for (const market of ev.markets || []) {
        if (market.open === false) continue;
        for (const r of market.runners || []) {
          if (r.open === false) continue;
          const price = typeof r.price === "number" ? r.price : Number(r.priceStr);
          if (!Number.isFinite(price) || price < 1.01) continue;
          const mapped = mapLeonMarket(market, r);
          if (!mapped) continue;
          // дедуп по market+outcome (берём лучший)
          const existing = odds.find((o) => o.market === mapped.market && o.outcome === mapped.outcome);
          if (existing) {
            if (price > existing.odds) existing.odds = price;
          } else {
            odds.push({ market: mapped.market, outcome: mapped.outcome, odds: price });
          }
        }
      }
      if (!odds.length) continue;
      byId.set(ev.id, true);
      const league = ev.league || {};
      const sport = league.sport || {};
      const region = league.region || {};
      out.push({
        eventId: ev.id,
        sport: sport.name || null,
        tournament: [region.name, league.name].filter(Boolean).join(". ") || null,
        team1: home.name,
        team2: away.name,
        eventName: `${home.name} — ${away.name}`,
        startTime: ev.kickoff ? new Date(ev.kickoff).toISOString() : null,
        live: ev.betline === "LIVE" || (ev.kickoff ? ev.kickoff <= Date.now() : false),
        odds,
      });
    }
  }
  return out;
}

app.get("/leon", async (req, res) => {
  if (TOKEN && req.headers["x-token"] !== TOKEN) return res.status(401).json({ error: "unauthorized" });
  const t0 = Date.now();
  try {
    const snaps = await fetchLeonSnapshots();
    if (!snaps.length) throw new Error("no snapshots fetched");
    const events = normalizeLeon(snaps);
    return res.json({ ok: true, bookmaker: "leon", eventsCount: events.length, ms: Date.now() - t0, events });
  } catch (e) {
    return res.status(502).json({ ok: false, error: e?.message || String(e), ms: Date.now() - t0 });
  }
});

// ============== Zenit (zenit.win) direct JSON API ==============
// Открытый JSON-API: требует только imprintHash (любой 32-hex).
// Прематч: ?sport=N (1=футбол, 2=хоккей, 3=баскетбол, 4=теннис, 5=волейбол, 6=гандбол, 7=бейсбол,
// 10=амфут, 11=регби, 12=NHL/доп, 14=киберспорт, 21=настольный теннис, 25=крикет и т.д.)
const ZENIT_SPORTS = [1, 2, 3, 4, 5, 6, 7, 10, 11, 12, 14, 21, 25, 16, 17, 18, 19, 20];
const ZENIT_URLS = {
  live: "https://zenit.win/ajax/live/printer/",
};
const ZENIT_IMPRINT = "abcdef0123456789abcdef0123456789";

// o (outcome id из dict.odd) -> {market, outcome template}. Линия берётся из oddKey: "eventId|col|line".
function mapZenitOutcome(o, line) {
  switch (o) {
    case 1: return { market: "1X2", outcome: "1" };
    case 2: return { market: "1X2", outcome: "X" };
    case 3: return { market: "1X2", outcome: "2" };
    case 4: return { market: "DC",  outcome: "1X" };
    case 5: return { market: "DC",  outcome: "12" };
    case 6: return { market: "DC",  outcome: "X2" };
    case 7: return line != null ? { market: "HANDICAP", outcome: `1 ${line}` } : null;
    case 8: return line != null ? { market: "HANDICAP", outcome: `2 ${line}` } : null;
    case 9: return line != null ? { market: "TOTAL", outcome: `UNDER ${line}` } : null;
    case 10: return line != null ? { market: "TOTAL", outcome: `OVER ${line}` } : null;
    default: return null;
  }
}

async function fetchZenitFeed(url) {
  const proxyUrl = pickProxyUrl();
  const dispatcher = proxyUrl ? new ProxyAgent(proxyUrl) : undefined;
  const res = await undiciFetch(url, {
    dispatcher,
    headers: {
      Accept: "application/json, text/plain, */*",
      "Accept-Language": "ru-RU,ru;q=0.9",
      Referer: "https://zenit.win/",
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131.0 Safari/537.36",
      imprintHash: ZENIT_IMPRINT,
      frontVersion: "1.0",
      "X-Requested-With": "XMLHttpRequest",
    },
  });
  if (!res.ok) throw new Error(`zenit ${url} status ${res.status}`);
  return res.json();
}

function normalizeZenit(data, isLive) {
  const cmd = (data.dict && data.dict.cmd) || {};
  const leagueDict = (data.dict && data.dict.league) || {};
  const sportDict = (data.dict && data.dict.sport) || {};
  const games = data.games || {};
  const out = [];
  for (const gid of Object.keys(games)) {
    const g = games[gid];
    if (!g) continue;
    const team1 = cmd[String(g.c1_id)];
    const team2 = cmd[String(g.c2_id)];
    if (!team1 || !team2) continue;
    const sport = sportDict[String(g.sid)] || null;
    const tournament = leagueDict[String(g.lid)] || null;
    const odds = [];
    const seen = new Set();
    for (const f of g.f_l || []) {
      const oNum = typeof f.o === "number" ? f.o : parseInt(f.o, 10);
      const hNum = typeof f.h === "number" ? f.h : parseFloat(f.h);
      if (!Number.isFinite(oNum) || !Number.isFinite(hNum) || hNum < 1.01) continue;
      let line = null;
      if (typeof f.oddKey === "string") {
        const parts = f.oddKey.split("|");
        if (parts.length >= 3) {
          const v = parseFloat(parts[2]);
          if (Number.isFinite(v)) line = v;
        }
      }
      const mapped = mapZenitOutcome(oNum, line);
      if (!mapped) continue;
      const key = `${mapped.market}|${mapped.outcome}`;
      if (seen.has(key)) continue;
      seen.add(key);
      odds.push({ market: mapped.market, outcome: mapped.outcome, odds: hNum });
    }
    if (!odds.length) continue;
    out.push({
      eventId: g.id,
      sport,
      tournament,
      team1,
      team2,
      eventName: `${team1} — ${team2}`,
      startTime: g.time ? new Date(g.time * 1000).toISOString() : null,
      live: isLive,
      odds,
    });
  }
  return out;
}

app.get("/zenit", async (req, res) => {
  if (TOKEN && req.headers["x-token"] !== TOKEN) return res.status(401).json({ error: "unauthorized" });
  const t0 = Date.now();
  try {
    const liveP = fetchZenitFeed(ZENIT_URLS.live).catch((e) => { console.log("[zenit] live", e?.message); return null; });
    const lineFeeds = [];
    for (const sid of ZENIT_SPORTS) {
      try {
        const d = await fetchZenitFeed(`https://zenit.win/ajax/line/printer/?lang_id=1&onlyview=0&sport=${sid}`);
        const n = d && d.games ? Object.keys(d.games).length : 0;
        console.log(`[zenit] line sport=${sid} games=${n}`);
        lineFeeds.push(d);
      } catch (e) {
        console.log(`[zenit] line sport=${sid} ERR`, e?.message);
        lineFeeds.push(null);
      }
    }
    const liveData = await liveP;
    const events = [];
    const seen = new Set();
    if (liveData) {
      for (const ev of normalizeZenit(liveData, true)) {
        if (seen.has(ev.eventId)) continue;
        seen.add(ev.eventId);
        events.push(ev);
      }
    }
    for (const data of lineFeeds) {
      if (!data) continue;
      const games = data.games ? Object.keys(data.games).length : 0;
      let norm = [];
      try {
        norm = normalizeZenit(data, false);
      } catch (e) {
        console.log(`[zenit] normalize ERR games=${games}:`, e?.message);
        continue;
      }
      let added = 0, dup = 0;
      for (const ev of norm) {
        if (seen.has(ev.eventId)) { dup++; continue; }
        seen.add(ev.eventId);
        events.push(ev);
        added++;
      }
      console.log(`[zenit] norm games=${games} normalized=${norm.length} added=${added} dup=${dup}`);
    }
    if (!events.length) throw new Error("no zenit feeds fetched");
    return res.json({ ok: true, bookmaker: "zenit", eventsCount: events.length, ms: Date.now() - t0, events });
  } catch (e) {
    return res.status(502).json({ ok: false, error: e?.message || String(e), ms: Date.now() - t0 });
  }
});

app.listen(PORT, () => console.log(`[scraper] listening on :${PORT}, proxies=${PROXIES.length}`));


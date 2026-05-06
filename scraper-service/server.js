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

app.post("/scrape", async (req, res) => {
  if (TOKEN && req.headers["x-token"] !== TOKEN) {
    return res.status(401).json({ error: "unauthorized" });
  }
  const { url, waitFor = 4000, waitForSelector = null } = req.body || {};
  if (!url || typeof url !== "string") return res.status(400).json({ error: "url required" });

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

    return res.json({
      ok: true,
      url,
      title,
      markdown,
      length: markdown.length,
      proxyUsed: proxy ? proxy.server : null,
      ms: Date.now() - t0,
    });
  } catch (e) {
    return res.status(502).json({
      ok: false,
      error: e?.message || String(e),
      proxyUsed: proxy ? proxy.server : null,
      ms: Date.now() - t0,
    });
  } finally {
    if (browser) await browser.close().catch(() => {});
  }
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

app.get("/fonbet", async (req, res) => {
  if (TOKEN && req.headers["x-token"] !== TOKEN) {
    return res.status(401).json({ error: "unauthorized" });
  }
  const scope = parseInt(req.query.scope, 10) || 1600; // 1600=live, 1500=prematch
  const t0 = Date.now();
  try {
    const snap = await fetchFonbetSnapshot(scope);
    const events = normalizeFonbet(snap);
    return res.json({
      ok: true,
      bookmaker: "fonbet",
      scope,
      eventsCount: events.length,
      ms: Date.now() - t0,
      events,
    });
  } catch (e) {
    return res.status(502).json({ ok: false, error: e?.message || String(e), ms: Date.now() - t0 });
  }
});

app.listen(PORT, () => console.log(`[scraper] listening on :${PORT}, proxies=${PROXIES.length}`));


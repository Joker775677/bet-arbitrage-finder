// Russian bookmaker scraper microservice.
// Runs Playwright Chromium with rotating RU proxies and returns page markdown.
// Designed for Render.com / Railway / any Docker host (NOT Cloudflare Workers).

import express from "express";
import { chromium } from "playwright";
import TurndownService from "turndown";

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

app.listen(PORT, () => console.log(`[scraper] listening on :${PORT}, proxies=${PROXIES.length}`));

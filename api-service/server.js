import express from "express";
import { Pool } from "pg";

const PORT = Number(process.env.API_PORT || 4000);
const SCRAPER_URL = process.env.SCRAPER_URL || "http://ru-scraper:3000";

const pool = new Pool({
  host: process.env.PGHOST,
  port: Number(process.env.PGPORT || 5432),
  database: process.env.PGDATABASE,
  user: process.env.PGUSER,
  password: process.env.PGPASSWORD,
  ssl: process.env.PGSSL === "true" ? { rejectUnauthorized: false } : false,
});

const app = express();
app.use(express.json({ limit: "2mb" }));

const ENGINES = ["fonbet", "pari", "leon", "zenit", "winline"];

function norm(s = "") {
  return String(s).toLowerCase().trim().replace(/\s+/g, " ");
}

function eventKey(e) {
  const teams = [norm(e.team1), norm(e.team2)].sort().join(" | ");
  const d = e.startTime ? new Date(e.startTime) : null;
  const day = d && !isNaN(d) ? d.toISOString().slice(0, 10) : "live";
  return `${day} | ${teams}`;
}

function calcArbs(eventsByBookmaker, stake = 10000, minRoi = 0) {
  const grouped = new Map();

  for (const item of eventsByBookmaker) {
    for (const e of item.events || []) {
      const key = eventKey(e);
      if (!grouped.has(key)) grouped.set(key, []);
      grouped.get(key).push({ bookmaker: item.bookmaker, event: e });
    }
  }

  const arbs = [];

  for (const [key, rows] of grouped.entries()) {
    const byMarket = new Map();

    for (const row of rows) {
      for (const odd of row.event.odds || []) {
        const mkey = odd.market;
        if (!byMarket.has(mkey)) byMarket.set(mkey, []);
        byMarket.get(mkey).push({
          bookmaker: row.bookmaker,
          event: row.event,
          outcome: odd.outcome,
          odds: Number(odd.odds),
          market: odd.market,
        });
      }
    }

    for (const [market, odds] of byMarket.entries()) {
      const outcomes = new Map();

      for (const o of odds) {
        if (!Number.isFinite(o.odds) || o.odds <= 1.01) continue;
        const current = outcomes.get(o.outcome);
        if (!current || o.odds > current.odds) outcomes.set(o.outcome, o);
      }

      const vals = [...outcomes.values()];

      const valid =
        market === "1X2" && outcomes.has("1") && outcomes.has("X") && outcomes.has("2");

      if (!valid) continue;

      const used = [outcomes.get("1"), outcomes.get("X"), outcomes.get("2")];

      const bookmakerCount = new Set(used.map((o) => o.bookmaker)).size;
      if (bookmakerCount < 2) continue;

      const arbPercent = used.reduce((sum, o) => sum + 1 / o.odds, 0);
      if (arbPercent >= 1) continue;

      const roi = (1 / arbPercent - 1) * 100;
      if (roi < minRoi) continue;

      const payout = stake / arbPercent;
      const legs = used.map((o) => {
        const legStake = payout / o.odds;
        return {
          bookmaker_name: o.bookmaker,
          outcome: o.outcome,
          odds: o.odds,
          stake: legStake,
          payout,
        };
      });

      const first = used[0].event;
      arbs.push({
        match_key: key,
        sport: first.sport || "Unknown",
        tournament: first.tournament || null,
        event_name: first.eventName || `${first.team1} — ${first.team2}`,
        event_time: first.startTime || null,
        market,
        roi,
        arb_percent: arbPercent,
        total_stake: stake,
        profit: payout - stake,
        bookmakers: used.map((o) => o.bookmaker),
        legs,
      });
    }
  }

  return arbs.sort((a, b) => b.roi - a.roi);
}

async function fetchBookmaker(engine) {
  const r = await fetch(`${SCRAPER_URL}/${engine}`);
  const j = await r.json();
  if (!j.ok) throw new Error(`${engine}: ${j.error || "scraper error"}`);
  return {
    bookmaker: engine,
    events: j.events || [],
    eventsCount: j.eventsCount || 0,
    ms: j.ms || 0,
  };
}

async function saveScan(arbs, stats, durationMs) {
  await pool.query("delete from surebets where scanned_at < now() - interval '24 hours'");

  for (const a of arbs.slice(0, 500)) {
    await pool.query(
      `insert into surebets
       (match_key, sport, tournament, event_name, event_time, market, roi, arb_percent, total_stake, profit, legs, bookmakers, source)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,'timeweb-api')`,
      [
        a.match_key,
        a.sport,
        a.tournament,
        a.event_name,
        a.event_time,
        a.market,
        a.roi,
        a.arb_percent,
        a.total_stake,
        a.profit,
        JSON.stringify(a.legs),
        a.bookmakers,
      ]
    );
  }

  await pool.query(
    `insert into scan_runs
     (finished_at, duration_ms, events_scanned, bookmakers_count, arbs_found, result_snapshot)
     values (now(), $1, $2, $3, $4, $5)`,
    [
      durationMs,
      stats.reduce((s, x) => s + x.eventsCount, 0),
      stats.length,
      arbs.length,
      JSON.stringify({ stats, arbs: arbs.slice(0, 50) }),
    ]
  );
}

app.get("/health", async (_req, res) => {
  const db = await pool.query("select now() as now");
  res.json({ ok: true, db: db.rows[0].now, scraper: SCRAPER_URL });
});

app.get("/api/v1/surebets", async (_req, res) => {
  const arbs = await pool.query("select * from surebets order by scanned_at desc, roi desc limit 200");
  const runs = await pool.query("select * from scan_runs order by started_at desc limit 1");
  res.json({ arbs: arbs.rows, lastRun: runs.rows[0] || null });
});

app.post("/api/v1/surebets/scan", async (req, res) => {
  const t0 = Date.now();
  const stake = Number(req.body?.stake || 10000);
  const minRoi = Number(req.body?.minRoi || 0);

  const settled = await Promise.allSettled(ENGINES.map(fetchBookmaker));
  const ok = settled.filter((x) => x.status === "fulfilled").map((x) => x.value);
  const failed = settled.filter((x) => x.status === "rejected").map((x) => String(x.reason?.message || x.reason));

  const arbs = calcArbs(ok, stake, minRoi);
  const durationMs = Date.now() - t0;
  await saveScan(arbs, ok, durationMs);

  res.json({ ok: true, stats: ok, failed, arbs, durationMs });
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`[api] listening on :${PORT}, scraper=${SCRAPER_URL}`);
});

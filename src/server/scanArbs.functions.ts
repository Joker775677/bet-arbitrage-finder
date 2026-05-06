import { createServerFn } from "@tanstack/react-start";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { findArbitrages, findNearArbs, type OddRow, type Arb, type NearArb } from "@/lib/arbitrage";

interface EngineOdd { market: string; outcome: string; odds: number }
interface EngineEvent {
  eventId: number;
  sport: string | null;
  tournament: string | null;
  team1: string;
  team2: string;
  eventName: string;
  startTime: string | null;
  live: boolean;
  odds: EngineOdd[];
}

const ENGINES = {
  fonbet: { path: "/fonbet?scope=1600", source: "fonbet", urlBase: "https://www.fon.bet/live/" },
  pari:   { path: "/pari?scope=2300",   source: "pari",   urlBase: "https://pari.ru/live/" },
  leon:   { path: "/leon",              source: "leon",   urlBase: "https://leon.ru/live/" },
} as const;

type EngineKey = keyof typeof ENGINES;

const norm = (s: string) => s.toLowerCase().trim().replace(/\s+/g, " ");
const teamSig = (s: string) => norm(s).replace(/[().]/g, "").replace(/\s+/g, " ");

function eventKey(team1: string, team2: string, dateKey: string): string {
  const a = teamSig(team1);
  const b = teamSig(team2);
  const [lo, hi] = a < b ? [a, b] : [b, a];
  return `${dateKey}|${lo}|${hi}`;
}

function dateKeyFromIso(iso: string | null): string {
  if (!iso) return "live";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "live";
  return `${String(d.getUTCDate()).padStart(2, "0")}.${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

async function fetchEngine(engine: EngineKey): Promise<{ source: string; events: EngineEvent[]; ms: number; error?: string }> {
  const base = process.env.SCRAPER_URL;
  const token = process.env.SCRAPER_TOKEN;
  const meta = ENGINES[engine];
  const t0 = Date.now();
  if (!base || !token) return { source: meta.source, events: [], ms: 0, error: "SCRAPER_URL/SCRAPER_TOKEN not configured" };
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 30000);
    let payload: any;
    try {
      const r = await fetch(`${base.replace(/\/+$/, "")}${meta.path}`, {
        headers: { "x-token": token },
        signal: ctrl.signal,
      });
      payload = await r.json();
    } finally { clearTimeout(timer); }
    if (!payload?.ok) return { source: meta.source, events: [], ms: Date.now() - t0, error: payload?.error || "scraper error" };
    return { source: meta.source, events: payload.events || [], ms: Date.now() - t0 };
  } catch (e: any) {
    return { source: meta.source, events: [], ms: Date.now() - t0, error: e?.message || "fetch failed" };
  }
}

async function persistEngine(source: string, urlBase: string, events: EngineEvent[]): Promise<{ saved: number; odds: number }> {
  if (!events.length) return { saved: 0, odds: 0 };
  const now = new Date().toISOString();
  const eventRowsAll = events
    .filter((e) => e.team1 && e.team2 && e.odds?.length)
    .map((e) => {
      const league = e.tournament || e.sport || "";
      const dk = dateKeyFromIso(e.startTime);
      return {
        ev: e,
        row: {
          source, sport: e.sport, league,
          team1: e.team1, team2: e.team2,
          event_name: e.eventName,
          event_key: `${norm(league)}|${eventKey(e.team1, e.team2, dk)}`,
          date_key: dk,
          url: `${urlBase}${e.eventId}`,
          scanned_at: now,
        },
      };
    });
  const seen = new Set<string>();
  const eventRows = eventRowsAll.filter(({ row }) => {
    if (seen.has(row.event_key)) return false;
    seen.add(row.event_key);
    return true;
  });

  const idMap = new Map<string, string>();
  const CHUNK = 500;
  for (let i = 0; i < eventRows.length; i += CHUNK) {
    const slice = eventRows.slice(i, i + CHUNK).map(({ row }) => row);
    const { data, error } = await supabaseAdmin
      .from("ru_events")
      .upsert(slice, { onConflict: "source,event_key" })
      .select("id, event_key");
    if (error) throw new Error(`ru_events upsert: ${error.message}`);
    for (const r of data ?? []) idMap.set(r.event_key as string, r.id as string);
  }

  const oddsAll: any[] = [];
  for (const { ev, row } of eventRows) {
    const id = idMap.get(row.event_key);
    if (!id) continue;
    for (const o of ev.odds) {
      if (!Number.isFinite(o.odds) || o.odds <= 1.01) continue;
      oddsAll.push({ event_id: id, market: o.market, outcome: o.outcome, odds: o.odds, scanned_at: now });
    }
  }
  const odSeen = new Set<string>();
  const oddRows = oddsAll.filter((r) => {
    const k = `${r.event_id}|${r.market}|${r.outcome}`;
    if (odSeen.has(k)) return false;
    odSeen.add(k);
    return true;
  });
  let savedOdds = 0;
  for (let i = 0; i < oddRows.length; i += CHUNK) {
    const slice = oddRows.slice(i, i + CHUNK);
    const { error, count } = await supabaseAdmin
      .from("ru_odds")
      .upsert(slice, { onConflict: "event_id,market,outcome", count: "exact" });
    if (error) throw new Error(`ru_odds upsert: ${error.message}`);
    savedOdds += count ?? slice.length;
  }
  return { saved: eventRows.length, odds: savedOdds };
}

export const scanAllAndFindArbs = createServerFn({ method: "POST" })
  .inputValidator((d: any) => ({
    stake: typeof d?.stake === "number" && d.stake > 0 ? d.stake : 10000,
    minRoi: typeof d?.minRoi === "number" ? d.minRoi : 0,
  }))
  .handler(async ({ data }) => {
    const t0 = Date.now();
    const engines: EngineKey[] = ["fonbet", "pari", "leon"];

    // 1. Параллельно тянем все БК
    const fetched = await Promise.all(engines.map((e) => fetchEngine(e)));

    // 2. Параллельно сохраняем в БД
    const persisted = await Promise.all(fetched.map((f) =>
      f.error ? Promise.resolve({ saved: 0, odds: 0 }) : persistEngine(f.source, ENGINES[f.source as EngineKey].urlBase, f.events)
    ));

    const stats = fetched.map((f, i) => ({
      bookmaker: f.source,
      events: f.events.length,
      saved: persisted[i].saved,
      odds: persisted[i].odds,
      ms: f.ms,
      error: f.error,
    }));

    // 3. Строим OddRow из текущего снимка (без БД, чтобы не упустить свежесть)
    const odds: OddRow[] = [];
    const dateKeyMap = new Map<string, string>(); // canonicalKey -> dateKey
    const displayMap = new Map<string, string>(); // canonicalKey -> human name
    const urlMap = new Map<string, Map<string, string>>(); // canonicalKey -> bm -> url

    for (const f of fetched) {
      if (f.error) continue;
      for (const ev of f.events) {
        if (!ev.team1 || !ev.team2 || !ev.odds?.length) continue;
        const dk = dateKeyFromIso(ev.startTime);
        const ckey = eventKey(ev.team1, ev.team2, dk);
        dateKeyMap.set(ckey, dk);
        const isCyr = /[а-яё]/i.test(ev.team1);
        if (!displayMap.has(ckey) || isCyr) {
          displayMap.set(ckey, `${ev.team1} — ${ev.team2}`);
        }
        let bmu = urlMap.get(ckey);
        if (!bmu) { bmu = new Map(); urlMap.set(ckey, bmu); }
        bmu.set(f.source, `${ENGINES[f.source as EngineKey].urlBase}${ev.eventId}`);

        for (const o of ev.odds) {
          if (!Number.isFinite(o.odds) || o.odds <= 1.01) continue;
          odds.push({
            id: `${f.source}-${ckey}-${o.market}-${o.outcome}`,
            bookmaker_id: f.source,
            bookmaker_name: f.source,
            sport: ev.sport ?? "Unknown",
            tournament: ev.tournament,
            event_name: ckey,
            event_time: ev.startTime,
            market: o.market,
            outcome: o.outcome,
            odds: o.odds,
            url: `${ENGINES[f.source as EngineKey].urlBase}${ev.eventId}`,
            live: !!ev.live,
          });
        }
      }
    }

    // 4. Ищем вилки + почти-вилки
    const arbsRaw = findArbitrages(odds, data.stake, data.minRoi);
    const arbs: Arb[] = arbsRaw.map((a) => ({
      ...a,
      event_name: displayMap.get(a.event_name) ?? a.event_name,
    }));
    const nearArbsRaw = findNearArbs(odds, 30);
    const nearArbs: NearArb[] = nearArbsRaw.map((a) => ({
      ...a,
      event_name: displayMap.get(a.event_name) ?? a.event_name,
    }));

    try { await supabaseAdmin.rpc("cleanup_old_ru_data"); } catch {}

    // Считаем совпадающие события (≥2 БК) с разбивкой live/prematch
    const evMeta = new Map<string, { bms: Set<string>; live: boolean }>();
    for (const o of odds) {
      let s = evMeta.get(o.event_name);
      if (!s) { s = { bms: new Set(), live: !!o.live }; evMeta.set(o.event_name, s); }
      s.bms.add(o.bookmaker_id);
      if (o.live) s.live = true;
    }
    let matchedLive = 0, matchedPrematch = 0;
    for (const m of evMeta.values()) {
      if (m.bms.size < 2) continue;
      if (m.live) matchedLive++; else matchedPrematch++;
    }

    return {
      ok: true,
      totalMs: Date.now() - t0,
      stats,
      totalOdds: odds.length,
      uniqueEvents: evMeta.size,
      matchedEvents: matchedLive + matchedPrematch,
      matchedLive,
      matchedPrematch,
      arbs,
      arbsLive: arbs.filter((a) => a.live).length,
      arbsPrematch: arbs.filter((a) => !a.live).length,
      nearArbs,
      scannedAt: new Date().toISOString(),
    };
  });


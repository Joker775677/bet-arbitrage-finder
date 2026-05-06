import { createFileRoute } from "@tanstack/react-router";
import { useState, useCallback, useEffect } from "react";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Loader2, Radar, RefreshCw, TrendingUp, AlertCircle, CheckCircle2, Clock } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { importFonbet, importPari, importLeon } from "@/server/fonbetImport.functions";
import { scanAllAndFindArbs } from "@/server/scanArbs.functions";
import { supabase } from "@/integrations/supabase/client";
import { Database, Zap } from "lucide-react";

export const Route = createFileRoute("/ru-live")({
  head: () => ({ meta: [{ title: "RU Live Scanner — ArbScope" }] }),
  component: RuLivePage,
});

type SourceStatus = "pending" | "scanning" | "done" | "error";
interface SourceState {
  source: { name: string; url: string };
  status: SourceStatus;
  events: number;
  ms?: number;
  error?: string;
}

const ENGINE_LIST: { name: string; key: "fonbet" | "pari" | "leon"; url: string }[] = [
  { name: "Fonbet", key: "fonbet", url: "https://www.fon.bet/live/" },
  { name: "Pari",   key: "pari",   url: "https://pari.ru/live/" },
  { name: "Leon",   key: "leon",   url: "https://leon.ru/live/" },
];

type ScanResult = Awaited<ReturnType<typeof scanAllAndFindArbs>>;

interface DbEventRow {
  id: string;
  source: string;
  event_name: string;
  league: string | null;
  sport: string | null;
  scanned_at: string;
}

function RuLivePage() {
  const scanAll = useServerFn(scanAllAndFindArbs);
  const importFb = useServerFn(importFonbet);
  const importPr = useServerFn(importPari);
  const importLn = useServerFn(importLeon);
  const [fbBusy, setFbBusy] = useState(false);
  const [prBusy, setPrBusy] = useState(false);
  const [lnBusy, setLnBusy] = useState(false);
  const [stake, setStake] = useState(10000);
  const [minRoi, setMinRoi] = useState(0);
  const [running, setRunning] = useState(false);
  const [dbEvents, setDbEvents] = useState<DbEventRow[]>([]);
  const [dbCount, setDbCount] = useState(0);
  const [states, setStates] = useState<SourceState[]>(
    ENGINE_LIST.map((s) => ({ source: { name: s.name, url: s.url }, status: "pending", events: 0 })),
  );
  const [r, setR] = useState<DisplayResult | null>(null);

  const run = useCallback(async () => {
    if (running) return;
    setRunning(true);
    setR(null);
    setStates(ENGINE_LIST.map((s) => ({ source: { name: s.name, url: s.url }, status: "scanning", events: 0 })));
    try {
      const res: ScanResult = await scanAll({ data: { stake, minRoi } });
      // обновляем статусы по статам
      setStates(ENGINE_LIST.map((s) => {
        const stat = res.stats.find((x) => x.bookmaker === s.key);
        if (!stat) return { source: { name: s.name, url: s.url }, status: "error", events: 0, error: "no data" };
        return {
          source: { name: s.name, url: s.url },
          status: stat.error ? "error" : "done",
          events: stat.events,
          ms: stat.ms,
          error: stat.error,
        };
      }));
      setR({ ...res, topMatches: [] });
      const okCount = res.stats.filter((s) => !s.error && s.events > 0).length;
      const totalSaved = res.stats.reduce((a, s) => a + s.saved, 0);
      const totalOdds = res.stats.reduce((a, s) => a + s.odds, 0);
      toast.success(`Готово: ${res.arbs.length} вилок · ${okCount}/${res.stats.length} БК · в БД: ${totalSaved} событий, ${totalOdds} коэф. за ${(res.totalMs / 1000).toFixed(1)}с`);
    } catch (e: any) {
      toast.error(e?.message ?? "Ошибка сканирования");
      setStates((prev) => prev.map((p) => p.status === "scanning" ? { ...p, status: "error", error: "fail" } : p));
    } finally {
      setRunning(false);
    }
  }, [running, scanAll, stake, minRoi]);

  const runFonbet = useCallback(async () => {
    if (fbBusy) return;
    setFbBusy(true);
    try {
      const res = await importFb({});
      toast.success(`Fonbet API: ${res.eventsSaved} событий, ${res.oddsSaved} коэф. за ${(res.totalMs / 1000).toFixed(1)}с`);
    } catch (e: any) {
      toast.error(`Fonbet API: ${e?.message ?? "ошибка"}`);
    } finally {
      setFbBusy(false);
    }
  }, [fbBusy, importFb]);

  const runPari = useCallback(async () => {
    if (prBusy) return;
    setPrBusy(true);
    try {
      const res = await importPr({});
      toast.success(`Pari API: ${res.eventsSaved} событий, ${res.oddsSaved} коэф. за ${(res.totalMs / 1000).toFixed(1)}с`);
    } catch (e: any) {
      toast.error(`Pari API: ${e?.message ?? "ошибка"}`);
    } finally {
      setPrBusy(false);
    }
  }, [prBusy, importPr]);

  const runLeon = useCallback(async () => {
    if (lnBusy) return;
    setLnBusy(true);
    try {
      const res = await importLn({});
      toast.success(`Leon API: ${res.eventsSaved} событий, ${res.oddsSaved} коэф. за ${(res.totalMs / 1000).toFixed(1)}с`);
    } catch (e: any) {
      toast.error(`Leon API: ${e?.message ?? "ошибка"}`);
    } finally {
      setLnBusy(false);
    }
  }, [lnBusy, importLn]);

  // Load latest events from DB + subscribe to realtime
  const loadDbEvents = useCallback(async () => {
    const { data, count } = await supabase
      .from("ru_events")
      .select("id, source, event_name, league, sport, scanned_at", { count: "exact" })
      .order("scanned_at", { ascending: false })
      .limit(50);
    setDbEvents((data ?? []) as DbEventRow[]);
    setDbCount(count ?? 0);
  }, []);

  useEffect(() => {
    void loadDbEvents();
    const ch = supabase
      .channel("ru_events_changes")
      .on("postgres_changes", { event: "*", schema: "public", table: "ru_events" }, () => {
        void loadDbEvents();
      })
      .subscribe();
    return () => { void supabase.removeChannel(ch); };
  }, [loadDbEvents]);

  // автозапуск отключён — пока пилим выгрузку через API (Fonbet/Pari)

  const doneCount = states.filter((s) => s.status === "done" || s.status === "error").length;
  const totalCount = states.length;

  return (
    <div className="space-y-5 p-6">
      <div>
        <h1 className="font-display text-2xl font-bold flex items-center gap-2">
          <Radar className="h-6 w-6 text-primary" />
          RU Live Scanner
        </h1>
        <p className="text-sm text-muted-foreground">
          Параллельный скан Winline, Fonbet, Marathonbet, Tennisi, BetBoom, Leon и Zenit с прогрессом по каждому источнику.
        </p>
      </div>

      <Card className="p-5">
        <div className="grid gap-3 md:grid-cols-[1fr,1fr,auto] md:items-end">
          <div className="grid gap-1.5">
            <Label>Сумма ставки, ₽</Label>
            <Input type="number" value={stake} onChange={(e) => setStake(Number(e.target.value) || 0)} disabled={running} />
          </div>
          <div className="grid gap-1.5">
            <Label>Мин. ROI, %</Label>
            <Input type="number" step="0.1" value={minRoi} onChange={(e) => setMinRoi(Number(e.target.value) || 0)} disabled={running} />
          </div>
          <div className="flex gap-2">
            <Button onClick={run} disabled={running} size="lg">
              {running ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <Radar className="mr-1 h-4 w-4" />}
              {running ? `Сканирую ${doneCount}/${totalCount}…` : "Сканировать"}
            </Button>
            <Button onClick={runFonbet} disabled={fbBusy} size="lg" variant="secondary" title="Прямой API Fonbet">
              {fbBusy ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <Zap className="mr-1 h-4 w-4" />}
              Fonbet API
            </Button>
            <Button onClick={runPari} disabled={prBusy} size="lg" variant="secondary" title="Прямой API Pari — ~8000 матчей">
              {prBusy ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <Zap className="mr-1 h-4 w-4" />}
              Pari API
            </Button>
            <Button onClick={runLeon} disabled={lnBusy} size="lg" variant="secondary" title="Прямой API Leon">
              {lnBusy ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <Zap className="mr-1 h-4 w-4" />}
              Leon API
            </Button>
          </div>
        </div>
      </Card>

      <Card className="p-5">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <h2 className="font-display text-lg font-semibold">Источники</h2>
          <Button variant="outline" size="sm" onClick={run} disabled={running}>
            {running ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-1 h-4 w-4" />}
            {running ? `Сканирую ${doneCount}/${totalCount}…` : "Повторить скан"}
          </Button>
        </div>
        <div className="grid gap-2 md:grid-cols-2">
          {states.map((s, idx) => (
            <a
              key={`${s.source.name}-${s.source.url}-${idx}`}
              href={s.source.url}
              target="_blank"
              rel="noreferrer"
              className="flex items-center justify-between rounded-md border border-border p-3 transition-colors hover:border-primary hover:bg-muted/40"
              title={s.error}
            >
              <div className="flex items-center gap-2 min-w-0">
                {s.status === "scanning" && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
                {s.status === "pending" && <Clock className="h-4 w-4 text-muted-foreground" />}
                {s.status === "done" && (s.events > 0
                  ? <CheckCircle2 className="h-4 w-4 text-primary" />
                  : <AlertCircle className="h-4 w-4 text-destructive" />)}
                {s.status === "error" && <AlertCircle className="h-4 w-4 text-destructive" />}
                <span className="font-medium truncate">{s.source.name}</span>
                {typeof s.ms === "number" && (
                  <span className="text-[11px] text-muted-foreground font-mono">{(s.ms / 1000).toFixed(1)}с</span>
                )}
              </div>
              <Badge
                variant={s.status === "done" && s.events > 0 ? "default" : s.status === "scanning" || s.status === "pending" ? "secondary" : "destructive"}
                className="font-mono"
              >
                {s.status === "scanning" ? "скан…"
                  : s.status === "pending" ? "ожидание"
                  : s.status === "error" ? "ошибка"
                  : `${s.events} событий`}
              </Badge>
            </a>
          ))}
        </div>
        {r && (
          <>
            <div className="mt-3 flex flex-wrap gap-4 text-xs text-muted-foreground">
              <span>Всего коэф.: <span className="font-mono text-foreground">{r.totalOdds}</span></span>
              <span>Уникальных событий: <span className="font-mono text-foreground">{r.uniqueEvents}</span></span>
              <span>Совпало в ≥2 БК: <span className="font-mono text-foreground">{r.matchedEvents}</span> (live: {r.matchedLive} · prematch: {r.matchedPrematch})</span>
              {r.scannedAt && (
                <span>Снимок от: <span className="font-mono text-foreground">{new Date(r.scannedAt).toLocaleTimeString("ru")}</span></span>
              )}
            </div>
            <p className="mt-2 text-[11px] text-muted-foreground">
              ⚠️ Коэффициенты у БК меняются каждые несколько секунд — это снимок на момент сканирования.
            </p>
          </>
        )}
      </Card>

      <Card>
        <div className="flex items-center justify-between border-b border-border p-4">
          <div className="flex items-center gap-2">
            <Database className="h-5 w-5 text-primary" />
            <h2 className="font-display text-lg font-semibold">База данных событий</h2>
            <Badge variant="secondary">{dbCount}</Badge>
            <span className="text-[11px] text-muted-foreground">realtime · автоочистка &gt; 24ч</span>
          </div>
        </div>
        {dbEvents.length === 0 ? (
          <p className="p-6 text-center text-sm text-muted-foreground">Пока нет сохранённых событий. Запустите скан.</p>
        ) : (
          <div className="max-h-[400px] overflow-auto">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-muted/80 backdrop-blur text-xs uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th className="px-3 py-2 text-left">БК</th>
                  <th className="px-3 py-2 text-left">Событие</th>
                  <th className="px-3 py-2 text-left">Лига</th>
                  <th className="px-3 py-2 text-left">Спорт</th>
                  <th className="px-3 py-2 text-right">Когда</th>
                </tr>
              </thead>
              <tbody>
                {dbEvents.map((ev) => (
                  <tr key={ev.id} className="border-t border-border hover:bg-muted/30">
                    <td className="px-3 py-1.5 font-medium">{ev.source}</td>
                    <td className="px-3 py-1.5">{ev.event_name}</td>
                    <td className="px-3 py-1.5 text-xs text-muted-foreground">{ev.league ?? "—"}</td>
                    <td className="px-3 py-1.5 text-xs text-muted-foreground">{ev.sport ?? "—"}</td>
                    <td className="px-3 py-1.5 text-right font-mono text-xs">{new Date(ev.scanned_at).toLocaleTimeString("ru")}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {r && (
        <>
          {(["live", "prematch"] as const).map((kind) => {
            const list = r.arbs.filter((a) => (kind === "live" ? a.live : !a.live));
            const title = kind === "live" ? "Live вилки" : "Prematch вилки";
            const matched = kind === "live" ? r.matchedLive : r.matchedPrematch;
            return (
              <Card key={kind}>
                <div className="flex items-center justify-between border-b border-border p-4">
                  <div className="flex items-center gap-2">
                    <TrendingUp className="h-5 w-5 text-primary" />
                    <h2 className="font-display text-lg font-semibold">{title}</h2>
                    <Badge variant="secondary">{list.length}</Badge>
                    <span className="text-xs text-muted-foreground">из {matched} совпавших событий</span>
                  </div>
                </div>
                {list.length === 0 ? (
                  <p className="p-8 text-center text-sm text-muted-foreground">
                    Вилок не найдено. Совпавших событий: {matched}. Снизьте мин. ROI или повторите скан.
                  </p>
                ) : (
                  <div className="divide-y divide-border">
                    {list.map((a) => (
                      <div key={a.key} className="p-5 space-y-3">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <div>
                            <div className="font-display text-base font-semibold">{a.event_name}</div>
                            <div className="text-xs text-muted-foreground">{a.market} · {a.sport}</div>
                          </div>
                          <div className="flex gap-3 text-sm items-center">
                            {a.live && <Badge variant="destructive" className="font-mono">LIVE</Badge>}
                            <Badge className="font-mono">ROI {a.roi.toFixed(2)}%</Badge>
                            <span className="font-mono text-primary">+{a.profit.toLocaleString("ru")} ₽</span>
                          </div>
                        </div>
                        <table className="w-full text-sm">
                          <thead className="bg-muted/50 text-xs uppercase tracking-wide text-muted-foreground">
                            <tr>
                              <th className="px-3 py-1.5 text-left">БК</th>
                              <th className="px-3 py-1.5 text-left">Исход</th>
                              <th className="px-3 py-1.5 text-right">Коэф.</th>
                              <th className="px-3 py-1.5 text-right">Ставка</th>
                              <th className="px-3 py-1.5 text-right">Выплата</th>
                            </tr>
                          </thead>
                          <tbody>
                            {a.legs.map((l, i) => (
                              <tr key={i} className="border-t border-border">
                                <td className="px-3 py-1.5 font-medium">
                                  {l.url ? (
                                    <a href={l.url} target="_blank" rel="noreferrer" className="underline decoration-dotted hover:text-primary">
                                      {l.bookmaker_name} ↗
                                    </a>
                                  ) : l.bookmaker_name}
                                </td>
                                <td className="px-3 py-1.5">{l.outcome}</td>
                                <td className="px-3 py-1.5 text-right font-mono">{l.odds.toFixed(2)}</td>
                                <td className="px-3 py-1.5 text-right font-mono">{l.stake.toLocaleString("ru")} ₽</td>
                                <td className="px-3 py-1.5 text-right font-mono">{l.payout.toLocaleString("ru")} ₽</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    ))}
                  </div>
                )}
              </Card>
            );
          })}

          {r.nearArbs && r.nearArbs.length > 0 && (
            <Card>
              <div className="border-b border-border p-4">
                <h2 className="font-display text-lg font-semibold">Ближайшие к вилке (margin 100–105%)</h2>
                <p className="text-xs text-muted-foreground mt-1">
                  Полные рынки с маржой чуть выше 100%. Чем ближе к 100% — тем ближе к вилке.
                </p>
              </div>
              <div className="divide-y divide-border">
                {r.nearArbs.map((mt) => (
                  <div key={mt.key} className="p-4 flex flex-wrap items-center justify-between gap-3">
                    <div className="min-w-0">
                      <div className="font-medium truncate">
                        {mt.event_name}
                        {mt.live && <Badge variant="destructive" className="ml-2 font-mono text-[10px]">LIVE</Badge>}
                      </div>
                      <div className="text-xs text-muted-foreground">{mt.market} · {mt.sport}</div>
                    </div>
                    <div className="flex items-center gap-2 text-sm font-mono flex-wrap">
                      {mt.legs.map((b, i) => (
                        <span key={i} className="rounded bg-muted px-2 py-0.5">
                          {b.outcome} {b.odds.toFixed(2)}
                          <span className="ml-1 text-[10px] text-muted-foreground">{b.bookmaker_name}</span>
                        </span>
                      ))}
                      <Badge variant="secondary" className="font-mono">
                        {(mt.arbPercent * 100).toFixed(2)}%
                      </Badge>
                    </div>
                  </div>
                ))}
              </div>
            </Card>
          )}
        </>
      )}
    </div>
  );
}

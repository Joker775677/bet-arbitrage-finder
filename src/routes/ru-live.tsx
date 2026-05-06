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
import { RU_SOURCES, scanRuSource, finalizeRuScan, type RuSource } from "@/server/ruScanner.functions";
import { persistRuScan } from "@/server/ruPersist.functions";
import { supabase } from "@/integrations/supabase/client";
import { Database } from "lucide-react";

export const Route = createFileRoute("/ru-live")({
  head: () => ({ meta: [{ title: "RU Live Scanner — ArbScope" }] }),
  component: RuLivePage,
});

type SourceStatus = "pending" | "scanning" | "done" | "error";
interface SourceState {
  source: RuSource;
  status: SourceStatus;
  events: number;
  ms?: number;
  error?: string;
}

type FinalizeResult = Awaited<ReturnType<typeof finalizeRuScan>>;
const SCAN_CONCURRENCY = 2;

interface DbEventRow {
  id: string;
  source: string;
  event_name: string;
  league: string | null;
  sport: string | null;
  scanned_at: string;
}

function RuLivePage() {
  const scanOne = useServerFn(scanRuSource);
  const finalize = useServerFn(finalizeRuScan);
  const persist = useServerFn(persistRuScan);
  const [stake, setStake] = useState(10000);
  const [minRoi, setMinRoi] = useState(0);
  const [running, setRunning] = useState(false);
  const [dbEvents, setDbEvents] = useState<DbEventRow[]>([]);
  const [dbCount, setDbCount] = useState(0);
  const [states, setStates] = useState<SourceState[]>(
    RU_SOURCES.map((s) => ({ source: s, status: "pending", events: 0 })),
  );
  const [r, setR] = useState<FinalizeResult | null>(null);

  const run = useCallback(async () => {
    if (running) return;
    setRunning(true);
    setR(null);
    setStates(RU_SOURCES.map((s) => ({ source: s, status: "pending", events: 0 })));
    try {
      const results: Awaited<ReturnType<typeof scanOne>>[] = [];
      for (let start = 0; start < RU_SOURCES.length; start += SCAN_CONCURRENCY) {
        const batch = RU_SOURCES.slice(start, start + SCAN_CONCURRENCY);
        setStates((prev) => prev.map((p, i) => i >= start && i < start + batch.length ? { ...p, status: "scanning" } : p));
        const batchResults = await Promise.all(batch.map(async (source, offset) => {
          const idx = start + offset;
          try {
            const res = await scanOne({ data: { source } });
            setStates((prev) => prev.map((p, i) => i === idx
              ? { ...p, status: res.error ? "error" : "done", events: res.events.length, ms: res.ms, error: res.error }
              : p));
            return res;
          } catch (e: any) {
            setStates((prev) => prev.map((p, i) => i === idx
              ? { ...p, status: "error", error: e?.message ?? "fail" }
              : p));
            return { name: source.name, url: source.url, events: [], error: e?.message ?? "fail", ms: 0 };
          }
        }));
        results.push(...batchResults);
      }
      const fin = await finalize({ data: { stake, minRoi, results } });
      setR(fin);
      const ok = results.filter((x) => x.events.length > 0).length;
      toast.success(`Готово: ${fin.arbs.length} вилок, ${ok}/${results.length} БК с событиями`);
    } catch (e: any) {
      toast.error(e?.message ?? "Ошибка сканирования");
    } finally {
      setRunning(false);
    }
  }, [running, scanOne, finalize, stake, minRoi]);

  useEffect(() => {
    // первый автозапуск
    if (!r && !running) void run();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
          <Button onClick={run} disabled={running} size="lg">
            {running ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <Radar className="mr-1 h-4 w-4" />}
            {running ? `Сканирую ${doneCount}/${totalCount}…` : "Сканировать"}
          </Button>
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
              <span>Уникальных событий: <span className="font-mono text-foreground">{r.matchedEvents}</span></span>
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

      {r && (
        <>
          <Card>
            <div className="flex items-center justify-between border-b border-border p-4">
              <div className="flex items-center gap-2">
                <TrendingUp className="h-5 w-5 text-primary" />
                <h2 className="font-display text-lg font-semibold">Найденные вилки</h2>
                <Badge variant="secondary">{r.arbs.length}</Badge>
              </div>
            </div>
            {r.arbs.length === 0 ? (
              <p className="p-10 text-center text-sm text-muted-foreground">
                Вилок не найдено. Попробуйте уменьшить мин. ROI или повторите сканирование позже.
              </p>
            ) : (
              <div className="divide-y divide-border">
                {r.arbs.map((a) => (
                  <div key={a.key} className="p-5 space-y-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div>
                        <div className="font-display text-base font-semibold">{a.event_name}</div>
                        <div className="text-xs text-muted-foreground">{a.market}</div>
                      </div>
                      <div className="flex gap-3 text-sm">
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

          {r.topMatches && r.topMatches.length > 0 && (
            <Card>
              <div className="border-b border-border p-4">
                <h2 className="font-display text-lg font-semibold">Топ совпадений (есть в обеих БК)</h2>
                <p className="text-xs text-muted-foreground mt-1">
                  Отсортировано по сумме обратных коэф. (чем ближе к 1.00 — тем ближе к вилке).
                </p>
              </div>
              <div className="divide-y divide-border">
                {r.topMatches.map((mt, idx) => (
                  <div key={idx} className="p-4 flex flex-wrap items-center justify-between gap-3">
                    <div className="min-w-0">
                      <div className="font-medium truncate">{mt.event_name}</div>
                      <div className="text-xs text-muted-foreground flex flex-wrap gap-2">
                        {mt.bookies.map((b, i) => (
                          <a
                            key={i}
                            href={b.url || "#"}
                            target="_blank"
                            rel="noreferrer"
                            className="underline decoration-dotted hover:text-primary"
                          >
                            {b.name} ↗
                          </a>
                        ))}
                      </div>
                    </div>
                    <div className="flex items-center gap-2 text-sm font-mono">
                      {mt.best.map((b, i) => (
                        <span key={i} className="rounded bg-muted px-2 py-0.5">
                          {b.outcome} {b.odds.toFixed(2)}
                          <span className="ml-1 text-[10px] text-muted-foreground">{b.bm}</span>
                        </span>
                      ))}
                      <Badge variant={mt.arbPercent < 1 ? "default" : "secondary"} className="font-mono">
                        {(mt.arbPercent * 100).toFixed(1)}%
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

import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";
import { Loader2, Radar, TrendingUp, AlertCircle, CheckCircle2 } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { scanRussianBookies } from "@/server/ruScanner.functions";

export const Route = createFileRoute("/ru-live")({
  head: () => ({ meta: [{ title: "RU Live Scanner — ArbScope" }] }),
  component: RuLivePage,
});

function RuLivePage() {
  const scan = useServerFn(scanRussianBookies);
  const [stake, setStake] = useState(10000);
  const [minRoi, setMinRoi] = useState(0);

  const m = useMutation({
    mutationFn: () => scan({ data: { stake, minRoi } }),
    onError: (e: any) => toast.error(e.message ?? "Scan failed"),
    onSuccess: (r) => {
      const goodBks = r.stats.filter((s) => s.events > 0).length;
      toast.success(`Сканирование завершено: ${r.arbs.length} вилок, ${goodBks}/${r.stats.length} БК`);
    },
  });

  const r = m.data;

  return (
    <div className="space-y-5 p-6">
      <div>
        <h1 className="font-display text-2xl font-bold flex items-center gap-2">
          <Radar className="h-6 w-6 text-primary" />
          RU Live Scanner
        </h1>
        <p className="text-sm text-muted-foreground">
          Автопарсинг Winline + Fonbet через Firecrawl. Матчинг команд по словарю синонимов.
        </p>
      </div>

      <Card className="p-5">
        <div className="grid gap-3 md:grid-cols-[1fr,1fr,auto] md:items-end">
          <div className="grid gap-1.5">
            <Label>Сумма ставки, ₽</Label>
            <Input type="number" value={stake} onChange={(e) => setStake(Number(e.target.value) || 0)} />
          </div>
          <div className="grid gap-1.5">
            <Label>Мин. ROI, %</Label>
            <Input type="number" step="0.1" value={minRoi} onChange={(e) => setMinRoi(Number(e.target.value) || 0)} />
          </div>
          <Button onClick={() => m.mutate()} disabled={m.isPending} size="lg">
            {m.isPending ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <Radar className="mr-1 h-4 w-4" />}
            {m.isPending ? "Сканирую…" : "Сканировать"}
          </Button>
        </div>
        <p className="mt-3 text-xs text-muted-foreground">
          Сканирование занимает ~10–15 секунд (Firecrawl ждёт рендера страниц).
        </p>
      </Card>

      {r && (
        <>
          <Card className="p-5">
            <h2 className="font-display text-lg font-semibold mb-3">Источники</h2>
            <div className="grid gap-2 md:grid-cols-2">
              {r.stats.map((s) => (
                <div key={s.bookmaker} className="flex items-center justify-between rounded-md border border-border p-3">
                  <div className="flex items-center gap-2">
                    {s.events > 0 ? (
                      <CheckCircle2 className="h-4 w-4 text-primary" />
                    ) : (
                      <AlertCircle className="h-4 w-4 text-destructive" />
                    )}
                    <span className="font-medium">{s.bookmaker}</span>
                  </div>
                  <Badge variant={s.events > 0 ? "default" : "destructive"} className="font-mono">
                    {s.events} событий
                  </Badge>
                </div>
              ))}
            </div>
            <div className="mt-3 flex flex-wrap gap-4 text-xs text-muted-foreground">
              <span>Всего коэф.: <span className="font-mono text-foreground">{r.totalOdds}</span></span>
              <span>Уникальных событий: <span className="font-mono text-foreground">{r.matchedEvents}</span></span>
              {r.scannedAt && (
                <span>Снимок от: <span className="font-mono text-foreground">{new Date(r.scannedAt).toLocaleTimeString("ru")}</span></span>
              )}
            </div>
            <p className="mt-2 text-[11px] text-muted-foreground">
              ⚠️ Коэффициенты у БК меняются каждые несколько секунд. Это снимок на момент сканирования — на сайте БК могут отличаться.
            </p>
          </Card>

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

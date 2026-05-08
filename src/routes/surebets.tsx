import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useEffect } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Flame, RefreshCw, AlertTriangle, Activity, Trophy } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

export const Route = createFileRoute("/surebets")({
  head: () => ({ meta: [{ title: "Surebets — live arbitrage opportunities" }] }),
  component: SurebetsPage,
});

type SurebetLeg = {
  bookmaker_name?: string;
  outcome?: string;
  odds?: number;
  stake?: number;
  payout?: number;
};

type StoredSurebet = {
  id?: string;
  key?: string;
  sport?: string;
  market?: string;
  event_name?: string;
  event_time?: string | null;
  roi?: number;
  profit?: number;
  legs?: SurebetLeg[];
};

type StoredSurebetsPayload = {
  arbs?: StoredSurebet[];
  lastRun?: {
    events_scanned?: number;
    bookmakers_count?: number;
    requests_remaining?: string | number | null;
    error?: string | null;
    started_at?: string;
    duration_ms?: number;
  } | null;
};

function SurebetsPage() {
  const stored = useQuery({
    queryKey: ["stored-surebets"],
    queryFn: async () => {
      const res = await fetch("/api/v1/surebets");
      if (!res.ok) throw new Error("Не удалось загрузить вилки");
      return res.json();
    },
    refetchInterval: 20_000,
  });

  const scan = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/v1/surebets/scan", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ stake: 10000, minRoi: 0 }),
      });
      if (!res.ok) throw new Error("Не удалось обновить вилки");
      return res.json();
    },
    onSuccess: () => stored.refetch(),
  });

  useEffect(() => {
    // Auto-trigger first scan if DB is empty
    if (
      stored.data &&
      (stored.data.arbs?.length ?? 0) === 0 &&
      !stored.data.lastRun &&
      !scan.isPending
    ) {
      scan.mutate();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stored.data]);

  const payload = stored.data as StoredSurebetsPayload | undefined;
  const arbs = payload?.arbs ?? [];
  const lastRun = payload?.lastRun ?? null;
  const lastRunTime = lastRun?.started_at ? new Date(lastRun.started_at).toLocaleString() : "—";
  const lastRunClock = lastRun?.started_at
    ? new Date(lastRun.started_at).toLocaleTimeString()
    : "—";

  return (
    <div className="space-y-5 p-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl font-bold flex items-center gap-2">
            <Flame className="h-6 w-6 text-primary" /> Surebets
          </h1>
          <p className="text-sm text-muted-foreground">
            Живые арбитражные ситуации с 40+ букмекеров. Обновляется автоматически каждые 2 минуты.
          </p>
        </div>
        <Button onClick={() => scan.mutate()} disabled={scan.isPending}>
          <RefreshCw className={`mr-1 h-4 w-4 ${scan.isPending ? "animate-spin" : ""}`} />
          {scan.isPending ? "Сканирую..." : "Обновить сейчас"}
        </Button>
      </div>

      <div className="grid gap-3 md:grid-cols-4">
        <Stat label="Найдено вилок" value={arbs.length} accent />
        <Stat label="Событий просканировано" value={lastRun?.events_scanned ?? "—"} />
        <Stat label="Букмекеров" value={lastRun?.bookmakers_count ?? "—"} />
        <Stat label="Запросов API осталось" value={lastRun?.requests_remaining ?? "—"} />
      </div>

      {scan.error && (
        <Card className="border-destructive/50 bg-destructive/10 p-4">
          <p className="flex items-center gap-2 text-sm text-destructive">
            <AlertTriangle className="h-4 w-4" /> {(scan.error as Error).message}
          </p>
        </Card>
      )}
      {lastRun?.error && (
        <Card className="border-destructive/50 bg-destructive/10 p-4">
          <p className="flex items-center gap-2 text-sm text-destructive">
            <AlertTriangle className="h-4 w-4" /> {lastRun.error}
          </p>
        </Card>
      )}

      {arbs.length === 0 && !scan.isPending && (
        <Card className="p-10 text-center">
          <Activity className="mx-auto h-10 w-10 text-muted-foreground" />
          <p className="mt-3 font-medium">Пока нет вилок</p>
          <p className="text-sm text-muted-foreground">
            {lastRun
              ? `Последний скан: ${lastRunClock}, событий: ${lastRun.events_scanned ?? "—"}.`
              : "Запускаю первое сканирование..."}
          </p>
        </Card>
      )}

      <div className="grid gap-3">
        {arbs.map((a) => (
          <Card key={a.id ?? a.key ?? `${a.event_name}-${a.market}`} className="overflow-hidden">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border bg-muted/40 px-5 py-3">
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant="secondary" className="text-[10px] uppercase">
                  {a.sport}
                </Badge>
                <span className="text-xs text-muted-foreground">{a.market}</span>
                <span className="font-medium">{a.event_name}</span>
                {a.event_time && (
                  <span className="text-xs text-muted-foreground">
                    · {new Date(a.event_time).toLocaleString()}
                  </span>
                )}
              </div>
              <div className="flex items-center gap-5 text-right">
                <div>
                  <p className="text-[10px] uppercase tracking-wide text-muted-foreground">ROI</p>
                  <p className="font-display text-lg font-bold text-success flex items-center gap-1">
                    <Trophy className="h-4 w-4" /> {Number(a.roi).toFixed(2)}%
                  </p>
                </div>
                <div>
                  <p className="text-[10px] uppercase tracking-wide text-muted-foreground">
                    Профит
                  </p>
                  <p className="font-display text-lg font-bold">{Number(a.profit).toFixed(2)}</p>
                </div>
              </div>
            </div>
            <div className="grid gap-2 p-4 sm:grid-cols-2 lg:grid-cols-3">
              {(a.legs ?? []).map((l, i) => (
                <div key={i} className="rounded-lg border border-border p-3">
                  <p className="text-[10px] uppercase tracking-wide text-muted-foreground">
                    {l.bookmaker_name}
                  </p>
                  <p className="font-medium">
                    {l.outcome}{" "}
                    <span className="text-muted-foreground">@ {Number(l.odds).toFixed(2)}</span>
                  </p>
                  <div className="mt-1 flex justify-between text-xs">
                    <span className="text-muted-foreground">Ставка</span>
                    <span className="font-mono">{Number(l.stake).toFixed(2)}</span>
                  </div>
                  <div className="flex justify-between text-xs">
                    <span className="text-muted-foreground">Выплата</span>
                    <span className="font-mono">{Number(l.payout).toFixed(2)}</span>
                  </div>
                </div>
              ))}
            </div>
          </Card>
        ))}
      </div>

      {lastRun && (
        <p className="text-xs text-muted-foreground">
          Последний скан: {lastRunTime} · длился {lastRun.duration_ms ?? "—"}мс
        </p>
      )}
    </div>
  );
}

function Stat({
  label,
  value,
  accent,
}: {
  label: string;
  value: React.ReactNode;
  accent?: boolean;
}) {
  return (
    <Card className="p-4">
      <p className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className={`font-display text-2xl font-bold ${accent ? "text-success" : ""}`}>{value}</p>
    </Card>
  );
}

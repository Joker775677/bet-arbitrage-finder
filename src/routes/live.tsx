import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useState } from "react";
import { Radar, RefreshCw, AlertTriangle, Activity } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { listSports, scanLive, type LiveScanResult } from "@/server/oddsApi.functions";

export const Route = createFileRoute("/live")({
  head: () => ({ meta: [{ title: "Live Scanner — ArbScope" }] }),
  component: LivePage,
});

function LivePage() {
  const [sport, setSport] = useState("soccer_epl");
  const [regions, setRegions] = useState("eu,uk");
  const [markets, setMarkets] = useState("h2h");
  const [stake, setStake] = useState(1000);
  const [minRoi, setMinRoi] = useState(0);

  const sports = useQuery({
    queryKey: ["odds-api-sports"],
    queryFn: () => listSports(),
    staleTime: 5 * 60 * 1000,
  });

  const scan = useMutation<LiveScanResult, Error>({
    mutationFn: () => scanLive({ data: { sport, regions, markets, stake, minRoi } }),
  });

  const result = scan.data;

  return (
    <div className="space-y-5 p-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl font-bold flex items-center gap-2">
            <Radar className="h-6 w-6 text-primary" /> Live Scanner
          </h1>
          <p className="text-sm text-muted-foreground">
            Real bookmaker odds via The Odds API · arbitrage detection across global sportsbooks.
          </p>
        </div>
        <Button onClick={() => scan.mutate()} disabled={scan.isPending}>
          <RefreshCw className={`mr-1 h-4 w-4 ${scan.isPending ? "animate-spin" : ""}`} />
          {scan.isPending ? "Scanning..." : "Scan now"}
        </Button>
      </div>

      <Card className="p-5">
        <div className="grid gap-4 md:grid-cols-5">
          <div className="grid gap-1.5 md:col-span-2">
            <Label>Sport</Label>
            <Select value={sport} onValueChange={setSport}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent className="max-h-80">
                {(sports.data ?? []).map(s => (
                  <SelectItem key={s.key} value={s.key}>{s.group} — {s.title}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-1.5">
            <Label>Regions</Label>
            <Input value={regions} onChange={e => setRegions(e.target.value)} placeholder="eu,uk,us,au" />
          </div>
          <div className="grid gap-1.5">
            <Label>Markets</Label>
            <Input value={markets} onChange={e => setMarkets(e.target.value)} placeholder="h2h,spreads,totals" />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div className="grid gap-1.5">
              <Label>Stake</Label>
              <Input type="number" value={stake} onChange={e => setStake(Number(e.target.value) || 0)} />
            </div>
            <div className="grid gap-1.5">
              <Label>Min ROI%</Label>
              <Input type="number" step="0.1" value={minRoi} onChange={e => setMinRoi(Number(e.target.value) || 0)} />
            </div>
          </div>
        </div>
      </Card>

      {scan.error && (
        <Card className="border-destructive/50 bg-destructive/10 p-4">
          <p className="flex items-center gap-2 text-sm text-destructive">
            <AlertTriangle className="h-4 w-4" /> {scan.error.message}
          </p>
        </Card>
      )}
      {result?.error && (
        <Card className="border-destructive/50 bg-destructive/10 p-4">
          <p className="flex items-center gap-2 text-sm text-destructive">
            <AlertTriangle className="h-4 w-4" /> {result.error}
          </p>
        </Card>
      )}

      {result && !result.error && (
        <div className="grid gap-3 md:grid-cols-4">
          <Stat label="Arbs found" value={result.arbs.length} accent />
          <Stat label="Events scanned" value={result.eventsScanned} />
          <Stat label="Bookmakers" value={result.bookmakers.length} />
          <Stat label="API requests left" value={result.requestsRemaining ?? "—"} />
        </div>
      )}

      {result && result.arbs.length === 0 && !result.error && (
        <Card className="p-10 text-center">
          <Activity className="mx-auto h-10 w-10 text-muted-foreground" />
          <p className="mt-3 font-medium">No arbitrage opportunities right now</p>
          <p className="text-sm text-muted-foreground">
            Scanned {result.eventsScanned} events across {result.bookmakers.length} bookmakers. Try other sports/markets or widen regions.
          </p>
        </Card>
      )}

      {result && result.arbs.length > 0 && (
        <div className="grid gap-3">
          {result.arbs.map(a => (
            <Card key={a.key} className="overflow-hidden">
              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border bg-muted/40 px-5 py-3">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant="secondary" className="text-[10px] uppercase">{a.sport}</Badge>
                  <span className="text-xs text-muted-foreground">{a.market}</span>
                  <span className="font-medium">{a.event_name}</span>
                  {a.event_time && <span className="text-xs text-muted-foreground">· {new Date(a.event_time).toLocaleString()}</span>}
                </div>
                <div className="flex items-center gap-5 text-right">
                  <div>
                    <p className="text-[10px] uppercase tracking-wide text-muted-foreground">ROI</p>
                    <p className="font-display text-lg font-bold text-success">{a.roi.toFixed(2)}%</p>
                  </div>
                  <div>
                    <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Profit</p>
                    <p className="font-display text-lg font-bold">{a.profit.toFixed(2)}</p>
                  </div>
                </div>
              </div>
              <div className="grid gap-2 p-4 sm:grid-cols-2 lg:grid-cols-3">
                {a.legs.map((l, i) => (
                  <div key={i} className="rounded-lg border border-border p-3">
                    <p className="text-[10px] uppercase tracking-wide text-muted-foreground">{l.bookmaker_name}</p>
                    <p className="font-medium">{l.outcome} <span className="text-muted-foreground">@ {l.odds.toFixed(2)}</span></p>
                    <div className="mt-1 flex justify-between text-xs">
                      <span className="text-muted-foreground">Stake</span><span className="font-mono">{l.stake.toFixed(2)}</span>
                    </div>
                    <div className="flex justify-between text-xs">
                      <span className="text-muted-foreground">Payout</span><span className="font-mono">{l.payout.toFixed(2)}</span>
                    </div>
                  </div>
                ))}
              </div>
            </Card>
          ))}
        </div>
      )}

      {result && (
        <p className="text-xs text-muted-foreground">
          Last scan: {new Date(result.fetchedAt).toLocaleString()} · API requests used: {result.requestsUsed ?? "—"}
        </p>
      )}
    </div>
  );
}

function Stat({ label, value, accent }: { label: string; value: React.ReactNode; accent?: boolean }) {
  return (
    <Card className="p-4">
      <p className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className={`font-display text-2xl font-bold ${accent ? "text-success" : ""}`}>{value}</p>
    </Card>
  );
}

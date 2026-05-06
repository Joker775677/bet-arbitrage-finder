import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { Search, RefreshCw } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { useArbitrages } from "@/hooks/useArbitrages";
import { useQueryClient } from "@tanstack/react-query";

export const Route = createFileRoute("/scanner")({
  head: () => ({ meta: [{ title: "Arbitrage Scanner — ArbScope" }] }),
  component: ScannerPage,
});

function ScannerPage() {
  const [stake, setStake] = useState(1000);
  const [minRoi, setMinRoi] = useState(0);
  const arbs = useArbitrages(stake, minRoi);
  const qc = useQueryClient();

  return (
    <div className="space-y-5 p-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl font-bold">Arbitrage Scanner</h1>
          <p className="text-sm text-muted-foreground">Real-time scan of all stored odds across active bookmakers.</p>
        </div>
        <Button variant="outline" onClick={() => { qc.invalidateQueries(); }}>
          <RefreshCw className="mr-1 h-4 w-4" /> Re-scan
        </Button>
      </div>

      <Card className="p-5">
        <div className="grid gap-4 md:grid-cols-3">
          <div className="grid gap-1.5">
            <Label>Total stake</Label>
            <Input type="number" value={stake} onChange={e => setStake(Number(e.target.value) || 0)} />
          </div>
          <div className="grid gap-1.5">
            <Label>Min ROI %</Label>
            <Input type="number" step="0.1" value={minRoi} onChange={e => setMinRoi(Number(e.target.value) || 0)} />
          </div>
          <div className="flex items-end">
            <div className="rounded-lg bg-muted px-4 py-3">
              <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Found</p>
              <p className="font-display text-2xl font-bold">{arbs.length}</p>
            </div>
          </div>
        </div>
      </Card>

      {arbs.length === 0 ? (
        <Card className="p-10 text-center">
          <Search className="mx-auto h-10 w-10 text-muted-foreground" />
          <p className="mt-3 font-medium">No arbitrage found</p>
          <p className="text-sm text-muted-foreground">
            Add more odds across multiple bookmakers for the same event/market.{" "}
            <Link to="/odds" className="text-primary hover:underline">Import odds</Link>.
          </p>
        </Card>
      ) : (
        <div className="grid gap-3">
          {arbs.map(a => (
            <Card key={a.key} className="overflow-hidden border-border">
              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border bg-muted/40 px-5 py-3">
                <div className="flex items-center gap-2">
                  <Badge variant="secondary" className="text-[10px] uppercase">{a.sport}</Badge>
                  <span className="text-xs text-muted-foreground">{a.market}</span>
                  <span className="font-medium">{a.event_name}</span>
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
    </div>
  );
}

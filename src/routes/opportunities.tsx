import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { useArbitrages } from "@/hooks/useArbitrages";
import { useBookmakers } from "@/hooks/useArbData";

export const Route = createFileRoute("/opportunities")({
  head: () => ({ meta: [{ title: "Opportunities — ArbScope" }] }),
  component: OppsPage,
});

function OppsPage() {
  const arbs = useArbitrages();
  const { data: bookmakers = [] } = useBookmakers();

  const sports = useMemo(() => Array.from(new Set(arbs.map(a => a.sport))), [arbs]);
  const markets = useMemo(() => Array.from(new Set(arbs.map(a => a.market))), [arbs]);

  const [sport, setSport] = useState("all");
  const [market, setMarket] = useState("all");
  const [bm, setBm] = useState("all");
  const [minRoi, setMinRoi] = useState("");
  const [minProfit, setMinProfit] = useState("");
  const [withinHours, setWithinHours] = useState("");

  const filtered = arbs.filter(a => {
    if (sport !== "all" && a.sport !== sport) return false;
    if (market !== "all" && a.market !== market) return false;
    if (bm !== "all" && !a.legs.some(l => l.bookmaker_id === bm)) return false;
    if (minRoi && a.roi < Number(minRoi)) return false;
    if (minProfit && a.profit < Number(minProfit)) return false;
    if (withinHours && a.event_time) {
      const diff = (new Date(a.event_time).getTime() - Date.now()) / 3_600_000;
      if (diff < 0 || diff > Number(withinHours)) return false;
    }
    return true;
  });

  return (
    <div className="space-y-5 p-6">
      <div>
        <h1 className="font-display text-2xl font-bold">Opportunities</h1>
        <p className="text-sm text-muted-foreground">Filterable list of all detected arbitrages.</p>
      </div>

      <Card className="grid gap-3 p-4 md:grid-cols-3 lg:grid-cols-6">
        <div className="grid gap-1"><Label className="text-xs">Sport</Label>
          <Select value={sport} onValueChange={setSport}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent><SelectItem value="all">All</SelectItem>{sports.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
          </Select>
        </div>
        <div className="grid gap-1"><Label className="text-xs">Market</Label>
          <Select value={market} onValueChange={setMarket}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent><SelectItem value="all">All</SelectItem>{markets.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
          </Select>
        </div>
        <div className="grid gap-1"><Label className="text-xs">Bookmaker</Label>
          <Select value={bm} onValueChange={setBm}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent><SelectItem value="all">All</SelectItem>{bookmakers.map(b => <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>)}</SelectContent>
          </Select>
        </div>
        <div className="grid gap-1"><Label className="text-xs">Min ROI %</Label><Input type="number" value={minRoi} onChange={e => setMinRoi(e.target.value)} /></div>
        <div className="grid gap-1"><Label className="text-xs">Min profit</Label><Input type="number" value={minProfit} onChange={e => setMinProfit(e.target.value)} /></div>
        <div className="grid gap-1"><Label className="text-xs">Starts within (h)</Label><Input type="number" value={withinHours} onChange={e => setWithinHours(e.target.value)} /></div>
      </Card>

      <Card className="overflow-x-auto">
        {filtered.length === 0 ? (
          <p className="p-10 text-center text-sm text-muted-foreground">No opportunities match these filters.</p>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="px-3 py-2 text-left">Sport</th>
                <th className="px-3 py-2 text-left">Event</th>
                <th className="px-3 py-2 text-left">Market</th>
                <th className="px-3 py-2 text-left">Best lines</th>
                <th className="px-3 py-2 text-right">ROI</th>
                <th className="px-3 py-2 text-right">Profit</th>
                <th className="px-3 py-2 text-right">Starts</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(a => (
                <tr key={a.key} className="border-t border-border align-top">
                  <td className="px-3 py-2"><Badge variant="secondary" className="text-[10px] uppercase">{a.sport}</Badge></td>
                  <td className="px-3 py-2 font-medium">{a.event_name}</td>
                  <td className="px-3 py-2">{a.market}</td>
                  <td className="px-3 py-2">
                    <div className="space-y-0.5">
                      {a.legs.map((l, i) => (
                        <div key={i} className="text-xs">
                          <span className="font-medium">{l.bookmaker_name}</span> · {l.outcome} @ <span className="font-mono">{l.odds.toFixed(2)}</span>
                          {" "}→ stake <span className="font-mono">{l.stake.toFixed(2)}</span>
                        </div>
                      ))}
                    </div>
                  </td>
                  <td className="px-3 py-2 text-right font-display font-bold text-success">{a.roi.toFixed(2)}%</td>
                  <td className="px-3 py-2 text-right font-mono">{a.profit.toFixed(2)}</td>
                  <td className="px-3 py-2 text-right text-xs text-muted-foreground">
                    {a.event_time ? new Date(a.event_time).toLocaleString() : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </div>
  );
}

import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";
import { Upload, Trash2, FileText, Plus } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { useBookmakers, useOdds, useInsertOdds, useDeleteOdd, useClearOdds } from "@/hooks/useArbData";
import { parseCSV } from "@/lib/csv";

export const Route = createFileRoute("/odds")({
  head: () => ({ meta: [{ title: "Odds Import — ArbScope" }] }),
  component: OddsPage,
});

const emptyManual = {
  bookmaker_id: "", sport: "Football", tournament: "",
  event_name: "", event_time: "", market: "1X2", outcome: "", odds: "",
};

function OddsPage() {
  const { data: bookmakers = [] } = useBookmakers();
  const { data: odds = [] } = useOdds();
  const insert = useInsertOdds();
  const del = useDeleteOdd();
  const clear = useClearOdds();
  const [m, setM] = useState(emptyManual);
  const [csvBm, setCsvBm] = useState("");

  async function addManual(e: React.FormEvent) {
    e.preventDefault();
    if (!m.bookmaker_id || !m.event_name || !m.outcome || !m.odds) {
      toast.error("Fill in bookmaker, event, outcome and odds"); return;
    }
    const oddsNum = Number(m.odds);
    if (!(oddsNum > 1)) { toast.error("Odds must be > 1"); return; }
    try {
      await insert.mutateAsync([{
        bookmaker_id: m.bookmaker_id,
        sport: m.sport,
        tournament: m.tournament || null,
        event_name: m.event_name,
        event_time: m.event_time ? new Date(m.event_time).toISOString() : null,
        market: m.market,
        outcome: m.outcome,
        odds: oddsNum,
      }]);
      toast.success("Odd added");
      setM({ ...m, outcome: "", odds: "" });
    } catch (e: any) { toast.error(e.message); }
  }

  async function handleCsv(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!csvBm) { toast.error("Select bookmaker first"); e.target.value = ""; return; }
    try {
      const text = await file.text();
      const rows = parseCSV(text);
      const required = ["sport", "event", "market", "outcome", "odds"];
      const headers = Object.keys(rows[0] ?? {}).map(h => h.toLowerCase());
      for (const r of required) if (!headers.includes(r)) { toast.error(`CSV missing column: ${r}`); return; }
      const payload = rows.map(r => {
        const lower: Record<string, string> = {};
        Object.entries(r).forEach(([k, v]) => lower[k.toLowerCase()] = v);
        return {
          bookmaker_id: csvBm,
          sport: lower.sport,
          tournament: lower.tournament || null,
          event_name: lower.event,
          event_time: lower.time ? new Date(lower.time).toISOString() : null,
          market: lower.market,
          outcome: lower.outcome,
          odds: Number(lower.odds),
        };
      }).filter(r => r.sport && r.event_name && r.outcome && r.odds > 1);
      if (!payload.length) { toast.error("No valid rows"); return; }
      await insert.mutateAsync(payload);
      toast.success(`Imported ${payload.length} odds`);
    } catch (err: any) { toast.error(err.message); }
    finally { e.target.value = ""; }
  }

  return (
    <div className="space-y-5 p-6">
      <div>
        <h1 className="font-display text-2xl font-bold">Odds Import</h1>
        <p className="text-sm text-muted-foreground">Add odds manually or upload a CSV. (API & parser are pluggable.)</p>
      </div>

      <Tabs defaultValue="manual">
        <TabsList>
          <TabsTrigger value="manual"><Plus className="mr-1 h-4 w-4" />Manual</TabsTrigger>
          <TabsTrigger value="csv"><Upload className="mr-1 h-4 w-4" />CSV / Excel</TabsTrigger>
        </TabsList>

        <TabsContent value="manual">
          <Card className="p-5">
            <form onSubmit={addManual} className="grid gap-3 md:grid-cols-2 lg:grid-cols-4">
              <div className="grid gap-1.5">
                <Label>Bookmaker</Label>
                <Select value={m.bookmaker_id} onValueChange={v => setM({ ...m, bookmaker_id: v })}>
                  <SelectTrigger><SelectValue placeholder="Select" /></SelectTrigger>
                  <SelectContent>
                    {bookmakers.map(b => <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid gap-1.5">
                <Label>Sport</Label>
                <Input value={m.sport} onChange={e => setM({ ...m, sport: e.target.value })} />
              </div>
              <div className="grid gap-1.5">
                <Label>Tournament</Label>
                <Input value={m.tournament} onChange={e => setM({ ...m, tournament: e.target.value })} />
              </div>
              <div className="grid gap-1.5">
                <Label>Event time</Label>
                <Input type="datetime-local" value={m.event_time} onChange={e => setM({ ...m, event_time: e.target.value })} />
              </div>
              <div className="grid gap-1.5 md:col-span-2">
                <Label>Event *</Label>
                <Input value={m.event_name} onChange={e => setM({ ...m, event_name: e.target.value })} placeholder="Team A vs Team B" />
              </div>
              <div className="grid gap-1.5">
                <Label>Market</Label>
                <Input value={m.market} onChange={e => setM({ ...m, market: e.target.value })} placeholder="1X2 / Total 2.5 / ML" />
              </div>
              <div className="grid gap-1.5">
                <Label>Outcome *</Label>
                <Input value={m.outcome} onChange={e => setM({ ...m, outcome: e.target.value })} placeholder="1 / X / 2 / Over / Under" />
              </div>
              <div className="grid gap-1.5">
                <Label>Odds *</Label>
                <Input type="number" step="0.01" value={m.odds} onChange={e => setM({ ...m, odds: e.target.value })} />
              </div>
              <div className="flex items-end">
                <Button type="submit" className="w-full" disabled={insert.isPending}>Add odd</Button>
              </div>
            </form>
          </Card>
        </TabsContent>

        <TabsContent value="csv">
          <Card className="p-5">
            <p className="mb-3 text-sm text-muted-foreground">
              CSV columns: <code className="rounded bg-muted px-1.5 py-0.5">sport,tournament,event,time,market,outcome,odds</code>
            </p>
            <div className="grid gap-3 md:grid-cols-[1fr,auto] md:items-end">
              <div className="grid gap-1.5">
                <Label>Bookmaker for this file</Label>
                <Select value={csvBm} onValueChange={setCsvBm}>
                  <SelectTrigger><SelectValue placeholder="Select bookmaker" /></SelectTrigger>
                  <SelectContent>{bookmakers.map(b => <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <Button asChild variant="outline">
                <label className="cursor-pointer">
                  <Upload className="mr-1 h-4 w-4" /> Upload CSV
                  <input type="file" accept=".csv,text/csv" className="hidden" onChange={handleCsv} />
                </label>
              </Button>
            </div>
          </Card>
        </TabsContent>
      </Tabs>

      <Card>
        <div className="flex items-center justify-between border-b border-border p-4">
          <div className="flex items-center gap-2">
            <FileText className="h-4 w-4 text-muted-foreground" />
            <h2 className="font-display text-lg font-semibold">Stored odds</h2>
            <Badge variant="secondary">{odds.length}</Badge>
          </div>
          {odds.length > 0 && (
            <Button variant="ghost" size="sm" onClick={() => { if (confirm("Clear ALL odds?")) clear.mutate(undefined, { onSuccess: () => toast.success("Cleared") }); }}>
              <Trash2 className="mr-1 h-4 w-4" />Clear all
            </Button>
          )}
        </div>
        <div className="overflow-x-auto">
          {odds.length === 0 ? (
            <p className="p-10 text-center text-sm text-muted-foreground">No odds yet.</p>
          ) : (
            <table className="w-full text-sm">
              <thead className="bg-muted/50 text-xs uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th className="px-3 py-2 text-left">Bookmaker</th>
                  <th className="px-3 py-2 text-left">Sport</th>
                  <th className="px-3 py-2 text-left">Event</th>
                  <th className="px-3 py-2 text-left">Market</th>
                  <th className="px-3 py-2 text-left">Outcome</th>
                  <th className="px-3 py-2 text-right">Odds</th>
                  <th className="px-3 py-2"></th>
                </tr>
              </thead>
              <tbody>
                {odds.map((o: any) => (
                  <tr key={o.id} className="border-t border-border">
                    <td className="px-3 py-2 font-medium">{o.bookmakers?.name ?? "—"}</td>
                    <td className="px-3 py-2">{o.sport}</td>
                    <td className="px-3 py-2">{o.event_name}</td>
                    <td className="px-3 py-2">{o.market}</td>
                    <td className="px-3 py-2">{o.outcome}</td>
                    <td className="px-3 py-2 text-right font-mono">{Number(o.odds).toFixed(2)}</td>
                    <td className="px-3 py-2 text-right">
                      <Button size="icon" variant="ghost" onClick={() => del.mutate(o.id)}><Trash2 className="h-4 w-4" /></Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </Card>
    </div>
  );
}

import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { Zap, TrendingUp, AlertCircle, ClipboardPaste } from "lucide-react";
import { toast } from "sonner";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { findArbitrages, type OddRow } from "@/lib/arbitrage";

export const Route = createFileRoute("/quick")({
  head: () => ({ meta: [{ title: "Quick RU Arb — ArbScope" }] }),
  component: QuickPage,
});

type Market = "1X2" | "ML";

const OUTCOMES: Record<Market, string[]> = {
  "1X2": ["1", "X", "2"],
  ML: ["1", "2"],
};

const BOOKIES = ["Winline", "Betcity", "Fonbet", "Лига Ставок", "Pari", "Олимпбет", "BetBoom", "1xBet"];

// Normalize outcome tokens: "П1"/"1"/"home" → "1", "Х"/"X"/"draw" → "X", "П2"/"2"/"away" → "2"
function normOutcome(raw: string): string | null {
  const s = raw.trim().toLowerCase().replace(/[.:)]+$/, "");
  if (["1", "п1", "home", "h", "хозяева", "first"].includes(s)) return "1";
  if (["x", "х", "draw", "d", "ничья", "n"].includes(s)) return "X";
  if (["2", "п2", "away", "a", "гости", "second"].includes(s)) return "2";
  return null;
}

// Detect bookmaker from a line. Returns canonical name or null.
function detectBookie(line: string): string | null {
  const low = line.toLowerCase();
  for (const b of BOOKIES) {
    if (low.includes(b.toLowerCase())) return b;
  }
  return null;
}

// Parse a chunk of text → odds map. Supports "1=2.10", "1: 2.10", "1 2.10", "П1 2.10", commas.
function parseOddsChunk(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  // Find all (token, number) pairs. Token is letters/П1/Х/etc, number is decimal.
  const re = /([A-Za-zА-Яа-я]?\d?|[ХXxХх])\s*[=:\s]\s*(\d+(?:[.,]\d+)?)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const key = normOutcome(m[1]);
    const val = m[2].replace(",", ".");
    if (key && Number(val) > 1) out[key] = val;
  }
  return out;
}

// Parse full paste: tries to split into bookie blocks.
function parsePaste(text: string): { bookie: string | null; odds: Record<string, string> }[] {
  const blocks: { bookie: string | null; odds: Record<string, string> }[] = [];
  // Split by lines, group consecutive lines per detected bookie.
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  let current: { bookie: string | null; lines: string[] } | null = null;
  for (const line of lines) {
    const bm = detectBookie(line);
    if (bm) {
      if (current) blocks.push({ bookie: current.bookie, odds: parseOddsChunk(current.lines.join(" ")) });
      current = { bookie: bm, lines: [line] };
    } else if (current) {
      current.lines.push(line);
    } else {
      current = { bookie: null, lines: [line] };
    }
  }
  if (current) blocks.push({ bookie: current.bookie, odds: parseOddsChunk(current.lines.join(" ")) });
  // If no bookie detected anywhere AND text has both blocks separated by blank line, fallback
  return blocks.filter((b) => Object.keys(b.odds).length > 0);
}


function QuickPage() {
  const [event, setEvent] = useState("");
  const [market, setMarket] = useState<Market>("1X2");
  const [stake, setStake] = useState(10000);
  const [bm1, setBm1] = useState("Winline");
  const [bm2, setBm2] = useState("Betcity");
  const [odds1, setOdds1] = useState<Record<string, string>>({});
  const [odds2, setOdds2] = useState<Record<string, string>>({});

  const outcomes = OUTCOMES[market];

  const result = useMemo(() => {
    const rows: OddRow[] = [];
    const evName = event.trim() || "Event";
    const push = (bm: string, src: Record<string, string>) => {
      for (const o of outcomes) {
        const v = Number(src[o]);
        if (v > 1) {
          rows.push({
            id: `${bm}-${o}`,
            bookmaker_id: bm,
            bookmaker_name: bm,
            sport: "—",
            tournament: null,
            event_name: evName,
            event_time: null,
            market,
            outcome: o,
            odds: v,
          });
        }
      }
    };
    push(bm1, odds1);
    push(bm2, odds2);
    if (rows.length < outcomes.length) return null;
    const arbs = findArbitrages(rows, stake, -100);
    return arbs[0] ?? null;
  }, [event, market, stake, bm1, bm2, odds1, odds2, outcomes]);

  const isArb = result && result.roi > 0;

  function reset() {
    setOdds1({});
    setOdds2({});
    setEvent("");
  }

  return (
    <div className="space-y-5 p-6">
      <div>
        <h1 className="font-display text-2xl font-bold flex items-center gap-2">
          <Zap className="h-6 w-6 text-primary" />
          Быстрый сканер RU
        </h1>
        <p className="text-sm text-muted-foreground">
          Скопируйте коэффициенты с Winline и Betcity (или любых других БК) — мгновенный расчёт вилки.
        </p>
      </div>

      <Card className="p-5 space-y-4">
        <div className="grid gap-3 md:grid-cols-3">
          <div className="grid gap-1.5 md:col-span-2">
            <Label>Событие</Label>
            <Input value={event} onChange={(e) => setEvent(e.target.value)} placeholder="Спартак — ЦСКА" />
          </div>
          <div className="grid gap-1.5">
            <Label>Рынок</Label>
            <Select value={market} onValueChange={(v) => setMarket(v as Market)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="1X2">1X2 (с ничьей)</SelectItem>
                <SelectItem value="ML">Money Line (1/2)</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        <div className="grid gap-1.5">
          <Label>Сумма ставки, ₽</Label>
          <Input type="number" value={stake} onChange={(e) => setStake(Number(e.target.value) || 0)} className="md:max-w-xs" />
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          {[
            { bm: bm1, setBm: setBm1, odds: odds1, setOdds: setOdds1, label: "БК №1" },
            { bm: bm2, setBm: setBm2, odds: odds2, setOdds: setOdds2, label: "БК №2" },
          ].map((col, i) => (
            <Card key={i} className="p-4 space-y-3 bg-muted/30">
              <div className="grid gap-1.5">
                <Label className="text-xs uppercase tracking-wide text-muted-foreground">{col.label}</Label>
                <Select value={col.bm} onValueChange={col.setBm}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {BOOKIES.map((b) => <SelectItem key={b} value={b}>{b}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className={`grid gap-2 ${outcomes.length === 3 ? "grid-cols-3" : "grid-cols-2"}`}>
                {outcomes.map((o) => (
                  <div key={o} className="grid gap-1">
                    <Label className="text-center text-xs">{o}</Label>
                    <Input
                      type="number"
                      step="0.01"
                      inputMode="decimal"
                      value={col.odds[o] ?? ""}
                      onChange={(e) => col.setOdds({ ...col.odds, [o]: e.target.value })}
                      placeholder="2.10"
                      className="text-center font-mono"
                    />
                  </div>
                ))}
              </div>
            </Card>
          ))}
        </div>

        <div className="flex justify-end">
          <Button variant="ghost" size="sm" onClick={reset}>Сбросить</Button>
        </div>
      </Card>

      {!result && (
        <Card className="p-6 text-center text-sm text-muted-foreground">
          <AlertCircle className="mx-auto mb-2 h-5 w-5" />
          Введите коэффициенты для всех исходов в обеих БК.
        </Card>
      )}

      {result && (
        <Card className={`p-5 border-2 ${isArb ? "border-primary" : "border-destructive/40"}`}>
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <TrendingUp className={`h-5 w-5 ${isArb ? "text-primary" : "text-destructive"}`} />
              <h2 className="font-display text-lg font-semibold">
                {isArb ? "Вилка найдена!" : "Вилки нет"}
              </h2>
            </div>
            <Badge variant={isArb ? "default" : "destructive"} className="font-mono">
              ROI {result.roi.toFixed(2)}%
            </Badge>
          </div>

          <div className="grid gap-3 md:grid-cols-3 mb-4 text-sm">
            <div>
              <div className="text-xs text-muted-foreground">Сумма маржи</div>
              <div className="font-mono text-lg">{(result.arbPercent * 100).toFixed(2)}%</div>
            </div>
            <div>
              <div className="text-xs text-muted-foreground">Общая ставка</div>
              <div className="font-mono text-lg">{result.totalStake.toLocaleString("ru")} ₽</div>
            </div>
            <div>
              <div className="text-xs text-muted-foreground">{isArb ? "Гарантированная прибыль" : "Убыток"}</div>
              <div className={`font-mono text-lg ${isArb ? "text-primary" : "text-destructive"}`}>
                {result.profit > 0 ? "+" : ""}{result.profit.toLocaleString("ru")} ₽
              </div>
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/50 text-xs uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th className="px-3 py-2 text-left">БК</th>
                  <th className="px-3 py-2 text-left">Исход</th>
                  <th className="px-3 py-2 text-right">Коэф.</th>
                  <th className="px-3 py-2 text-right">Ставка, ₽</th>
                  <th className="px-3 py-2 text-right">Выплата, ₽</th>
                </tr>
              </thead>
              <tbody>
                {result.legs.map((l, i) => (
                  <tr key={i} className="border-t border-border">
                    <td className="px-3 py-2 font-medium">{l.bookmaker_name}</td>
                    <td className="px-3 py-2">{l.outcome}</td>
                    <td className="px-3 py-2 text-right font-mono">{l.odds.toFixed(2)}</td>
                    <td className="px-3 py-2 text-right font-mono">{l.stake.toLocaleString("ru")}</td>
                    <td className="px-3 py-2 text-right font-mono">{l.payout.toLocaleString("ru")}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </div>
  );
}

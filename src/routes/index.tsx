import { createFileRoute, Link } from "@tanstack/react-router";
import { Building2, Target, TrendingUp, Percent, ArrowRight } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useBookmakers, useOdds } from "@/hooks/useArbData";
import { useArbitrages } from "@/hooks/useArbitrages";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Dashboard — ArbScope" },
      { name: "description", content: "Overview of bookmakers, odds and live arbitrage opportunities." },
    ],
  }),
  component: Dashboard,
});

function StatCard({ icon: Icon, label, value, hint }: any) {
  return (
    <Card className="relative overflow-hidden border-border p-5">
      <div className="flex items-start justify-between">
        <div>
          <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">{label}</p>
          <p className="mt-2 font-display text-3xl font-bold text-foreground">{value}</p>
          {hint && <p className="mt-1 text-xs text-muted-foreground">{hint}</p>}
        </div>
        <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
          <Icon className="h-5 w-5" />
        </div>
      </div>
    </Card>
  );
}

function Dashboard() {
  const { data: bookmakers = [] } = useBookmakers();
  const { data: odds = [] } = useOdds();
  const arbs = useArbitrages();

  const activeBms = bookmakers.filter(b => b.is_active).length;
  const avgRoi = arbs.length ? (arbs.reduce((s, a) => s + a.roi, 0) / arbs.length) : 0;
  const top = arbs.slice(0, 5);

  return (
    <div className="space-y-6 p-6">
      <div className="rounded-2xl p-6 text-primary-foreground" style={{ background: "var(--gradient-hero)", boxShadow: "var(--shadow-elegant)" }}>
        <h1 className="font-display text-3xl font-bold">Welcome back</h1>
        <p className="mt-1 max-w-2xl text-sm text-primary-foreground/80">
          Manage your bookmakers, import odds, and let the scanner reveal arbitrage opportunities in real time.
        </p>
        <div className="mt-4 flex flex-wrap gap-2">
          <Button asChild variant="secondary" size="sm">
            <Link to="/bookmakers">Manage Bookmakers <ArrowRight className="ml-1 h-4 w-4" /></Link>
          </Button>
          <Button asChild variant="outline" size="sm" className="border-white/30 bg-white/10 text-primary-foreground hover:bg-white/20">
            <Link to="/odds">Import Odds</Link>
          </Button>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <StatCard icon={Building2} label="Active Bookmakers" value={activeBms} hint={`${bookmakers.length} total`} />
        <StatCard icon={Target} label="Arb Opportunities" value={arbs.length} hint="Across all active books" />
        <StatCard icon={Percent} label="Average ROI" value={`${avgRoi.toFixed(2)}%`} hint="Of detected arbs" />
        <StatCard icon={TrendingUp} label="Odds in DB" value={odds.length} hint="Lines available" />
      </div>

      <Card className="border-border">
        <div className="flex items-center justify-between border-b border-border p-5">
          <div>
            <h2 className="font-display text-lg font-semibold">Top Opportunities</h2>
            <p className="text-xs text-muted-foreground">Highest ROI arbs detected right now</p>
          </div>
          <Button asChild variant="ghost" size="sm">
            <Link to="/opportunities">View all <ArrowRight className="ml-1 h-4 w-4" /></Link>
          </Button>
        </div>
        {top.length === 0 ? (
          <div className="p-10 text-center text-sm text-muted-foreground">
            No arbitrage opportunities yet. Add bookmakers and import odds to start scanning.
          </div>
        ) : (
          <div className="divide-y divide-border">
            {top.map(a => (
              <div key={a.key} className="flex flex-wrap items-center justify-between gap-4 p-5">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <Badge variant="secondary" className="text-[10px] uppercase">{a.sport}</Badge>
                    <span className="text-xs text-muted-foreground">{a.market}</span>
                  </div>
                  <p className="mt-1 truncate font-medium text-foreground">{a.event_name}</p>
                  <p className="text-xs text-muted-foreground">
                    {a.legs.map(l => `${l.bookmaker_name} · ${l.outcome} @ ${l.odds}`).join("  |  ")}
                  </p>
                </div>
                <div className="flex items-center gap-6 text-right">
                  <div>
                    <p className="text-[10px] uppercase tracking-wide text-muted-foreground">ROI</p>
                    <p className="font-display text-xl font-bold text-success">{a.roi.toFixed(2)}%</p>
                  </div>
                  <div>
                    <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Profit</p>
                    <p className="font-display text-xl font-bold text-foreground">{a.profit.toFixed(2)}</p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}

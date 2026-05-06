import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useSettings, useSaveSettings } from "@/hooks/useArbData";

export const Route = createFileRoute("/settings")({
  head: () => ({ meta: [{ title: "Settings — ArbScope" }] }),
  component: SettingsPage,
});

function SettingsPage() {
  const { data } = useSettings();
  const save = useSaveSettings();
  const [form, setForm] = useState({ min_roi: 0, default_stake: 1000, currency: "USD", timezone: "UTC", margin: 0 });

  useEffect(() => {
    if (data) setForm({
      min_roi: Number(data.min_roi), default_stake: Number(data.default_stake),
      currency: data.currency, timezone: data.timezone, margin: Number(data.margin),
    });
  }, [data]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    try { await save.mutateAsync(form); toast.success("Settings saved"); }
    catch (e: any) { toast.error(e.message); }
  }

  return (
    <div className="space-y-5 p-6">
      <div>
        <h1 className="font-display text-2xl font-bold">Settings</h1>
        <p className="text-sm text-muted-foreground">Defaults applied across the scanner and dashboard.</p>
      </div>
      <Card className="p-5">
        <form onSubmit={submit} className="grid gap-4 md:grid-cols-2">
          <div className="grid gap-1.5">
            <Label>Minimum ROI % to display</Label>
            <Input type="number" step="0.1" value={form.min_roi} onChange={e => setForm({ ...form, min_roi: Number(e.target.value) })} />
          </div>
          <div className="grid gap-1.5">
            <Label>Default stake</Label>
            <Input type="number" value={form.default_stake} onChange={e => setForm({ ...form, default_stake: Number(e.target.value) })} />
          </div>
          <div className="grid gap-1.5">
            <Label>Currency</Label>
            <Input value={form.currency} onChange={e => setForm({ ...form, currency: e.target.value.toUpperCase() })} />
          </div>
          <div className="grid gap-1.5">
            <Label>Timezone</Label>
            <Input value={form.timezone} onChange={e => setForm({ ...form, timezone: e.target.value })} />
          </div>
          <div className="grid gap-1.5">
            <Label>Margin / commission %</Label>
            <Input type="number" step="0.01" value={form.margin} onChange={e => setForm({ ...form, margin: Number(e.target.value) })} />
          </div>
          <div className="flex items-end">
            <Button type="submit" disabled={save.isPending}>Save settings</Button>
          </div>
        </form>
      </Card>

      <Card className="p-5">
        <h2 className="font-display text-lg font-semibold">Notifications</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Toast notifications appear when new arbitrages are detected. Telegram, Email and Web Push integrations
          can be wired in via Lovable Cloud edge functions in a future iteration.
        </p>
      </Card>
    </div>
  );
}

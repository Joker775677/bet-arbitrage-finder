import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { Plus, Pencil, Trash2, Globe, ExternalLink } from "lucide-react";
import { toast } from "sonner";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useBookmakers, useSaveBookmaker, useDeleteBookmaker, type Bookmaker } from "@/hooks/useArbData";

export const Route = createFileRoute("/bookmakers")({
  head: () => ({ meta: [{ title: "Bookmakers — ArbScope" }] }),
  component: BookmakersPage,
});

const empty = {
  id: undefined as string | undefined,
  name: "", website: "", source_type: "manual",
  is_active: true, currency: "USD",
  min_stake: "" as string | number, max_stake: "" as string | number, notes: "",
};

function BookmakersPage() {
  const { data = [], isLoading } = useBookmakers();
  const save = useSaveBookmaker();
  const del = useDeleteBookmaker();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(empty);

  function startEdit(b: Bookmaker) {
    setForm({
      id: b.id, name: b.name, website: b.website ?? "", source_type: b.source_type,
      is_active: b.is_active, currency: b.currency,
      min_stake: b.min_stake ?? "", max_stake: b.max_stake ?? "", notes: b.notes ?? "",
    });
    setOpen(true);
  }
  function startNew() { setForm(empty); setOpen(true); }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.name.trim()) { toast.error("Name is required"); return; }
    try {
      await save.mutateAsync({
        id: form.id,
        name: form.name.trim(),
        website: form.website.trim() || null,
        source_type: form.source_type,
        is_active: form.is_active,
        currency: form.currency,
        min_stake: form.min_stake === "" ? null : Number(form.min_stake),
        max_stake: form.max_stake === "" ? null : Number(form.max_stake),
        notes: form.notes.trim() || null,
      });
      toast.success(form.id ? "Bookmaker updated" : "Bookmaker added");
      setOpen(false);
    } catch (err: any) { toast.error(err.message); }
  }

  return (
    <div className="space-y-5 p-6">
      <div className="flex items-end justify-between">
        <div>
          <h1 className="font-display text-2xl font-bold">Bookmakers</h1>
          <p className="text-sm text-muted-foreground">Manage the bookmakers analyzed by the scanner.</p>
        </div>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button onClick={startNew}><Plus className="mr-1 h-4 w-4" />Add bookmaker</Button>
          </DialogTrigger>
          <DialogContent className="max-w-lg">
            <DialogHeader><DialogTitle>{form.id ? "Edit bookmaker" : "New bookmaker"}</DialogTitle></DialogHeader>
            <form onSubmit={submit} className="grid gap-3">
              <div className="grid gap-1.5">
                <Label>Name *</Label>
                <Input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} placeholder="e.g. Pinnacle" />
              </div>
              <div className="grid gap-1.5">
                <Label>Website</Label>
                <Input value={form.website} onChange={e => setForm({ ...form, website: e.target.value })} placeholder="https://..." />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="grid gap-1.5">
                  <Label>Source</Label>
                  <Select value={form.source_type} onValueChange={v => setForm({ ...form, source_type: v })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="manual">Manual</SelectItem>
                      <SelectItem value="csv">CSV / Excel</SelectItem>
                      <SelectItem value="api">API</SelectItem>
                      <SelectItem value="parser">Parser</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="grid gap-1.5">
                  <Label>Currency</Label>
                  <Input value={form.currency} onChange={e => setForm({ ...form, currency: e.target.value.toUpperCase() })} />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="grid gap-1.5">
                  <Label>Min stake</Label>
                  <Input type="number" value={form.min_stake} onChange={e => setForm({ ...form, min_stake: e.target.value })} />
                </div>
                <div className="grid gap-1.5">
                  <Label>Max stake</Label>
                  <Input type="number" value={form.max_stake} onChange={e => setForm({ ...form, max_stake: e.target.value })} />
                </div>
              </div>
              <div className="grid gap-1.5">
                <Label>Notes</Label>
                <Textarea rows={2} value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} />
              </div>
              <div className="flex items-center justify-between rounded-md border border-border p-3">
                <div>
                  <p className="text-sm font-medium">Active</p>
                  <p className="text-xs text-muted-foreground">Include in arbitrage scanning</p>
                </div>
                <Switch checked={form.is_active} onCheckedChange={v => setForm({ ...form, is_active: v })} />
              </div>
              <DialogFooter>
                <Button type="button" variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
                <Button type="submit" disabled={save.isPending}>{form.id ? "Save" : "Create"}</Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      {isLoading ? (
        <p className="p-10 text-center text-sm text-muted-foreground">Loading...</p>
      ) : data.length === 0 ? (
        <Card className="p-10 text-center">
          <Globe className="mx-auto h-10 w-10 text-muted-foreground" />
          <p className="mt-3 font-medium">No bookmakers yet</p>
          <p className="text-sm text-muted-foreground">Add your first bookmaker to begin tracking odds.</p>
        </Card>
      ) : (
        <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
          {data.map(b => (
            <Card key={b.id} className="p-4">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <h3 className="truncate font-display text-lg font-semibold">{b.name}</h3>
                    {b.is_active ? <Badge className="bg-success text-success-foreground">Active</Badge> : <Badge variant="outline">Off</Badge>}
                  </div>
                  {b.website && (
                    <a href={b.website} target="_blank" rel="noreferrer" className="mt-1 inline-flex items-center gap-1 text-xs text-primary hover:underline">
                      {b.website.replace(/^https?:\/\//, "")} <ExternalLink className="h-3 w-3" />
                    </a>
                  )}
                </div>
                <div className="flex gap-1">
                  <Button size="icon" variant="ghost" onClick={() => startEdit(b)}><Pencil className="h-4 w-4" /></Button>
                  <Button size="icon" variant="ghost" onClick={() => {
                    if (confirm(`Delete ${b.name}?`)) del.mutate(b.id, { onSuccess: () => toast.success("Deleted") });
                  }}><Trash2 className="h-4 w-4" /></Button>
                </div>
              </div>
              <div className="mt-3 grid grid-cols-2 gap-2 text-xs text-muted-foreground">
                <div><span className="text-foreground/70">Source:</span> {b.source_type}</div>
                <div><span className="text-foreground/70">Currency:</span> {b.currency}</div>
                <div><span className="text-foreground/70">Min:</span> {b.min_stake ?? "—"}</div>
                <div><span className="text-foreground/70">Max:</span> {b.max_stake ?? "—"}</div>
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

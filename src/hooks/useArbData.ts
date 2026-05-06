import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { Tables, TablesInsert, TablesUpdate } from "@/integrations/supabase/types";

export type Bookmaker = Tables<"bookmakers">;
export type Odd = Tables<"odds">;
export type AppSettings = Tables<"app_settings">;

export function useBookmakers() {
  return useQuery({
    queryKey: ["bookmakers"],
    queryFn: async (): Promise<Bookmaker[]> => {
      const { data, error } = await supabase.from("bookmakers").select("*").order("created_at", { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
  });
}

export function useSaveBookmaker() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (b: TablesInsert<"bookmakers"> & { id?: string }) => {
      if (b.id) {
        const { id, ...rest } = b;
        const { error } = await supabase.from("bookmakers").update(rest as TablesUpdate<"bookmakers">).eq("id", id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from("bookmakers").insert(b);
        if (error) throw error;
      }
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["bookmakers"] }),
  });
}

export function useDeleteBookmaker() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("bookmakers").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["bookmakers"] });
      qc.invalidateQueries({ queryKey: ["odds"] });
    },
  });
}

export function useOdds() {
  return useQuery({
    queryKey: ["odds"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("odds")
        .select("*, bookmakers(name, is_active)")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
  });
}

export function useInsertOdds() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (rows: TablesInsert<"odds">[]) => {
      const { error } = await supabase.from("odds").insert(rows);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["odds"] }),
  });
}

export function useDeleteOdd() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("odds").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["odds"] }),
  });
}

export function useClearOdds() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from("odds").delete().neq("id", "00000000-0000-0000-0000-000000000000");
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["odds"] }),
  });
}

export function useSettings() {
  return useQuery({
    queryKey: ["settings"],
    queryFn: async (): Promise<AppSettings> => {
      const { data, error } = await supabase.from("app_settings").select("*").eq("id", 1).single();
      if (error) throw error;
      return data;
    },
  });
}

export function useSaveSettings() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (s: TablesUpdate<"app_settings">) => {
      const { error } = await supabase.from("app_settings").update(s).eq("id", 1);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["settings"] }),
  });
}

export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      app_settings: {
        Row: {
          currency: string
          default_stake: number
          id: number
          margin: number
          min_roi: number
          timezone: string
        }
        Insert: {
          currency?: string
          default_stake?: number
          id?: number
          margin?: number
          min_roi?: number
          timezone?: string
        }
        Update: {
          currency?: string
          default_stake?: number
          id?: number
          margin?: number
          min_roi?: number
          timezone?: string
        }
        Relationships: []
      }
      bookmakers: {
        Row: {
          created_at: string
          currency: string
          id: string
          is_active: boolean
          max_stake: number | null
          min_stake: number | null
          name: string
          notes: string | null
          source_type: string
          updated_at: string
          website: string | null
        }
        Insert: {
          created_at?: string
          currency?: string
          id?: string
          is_active?: boolean
          max_stake?: number | null
          min_stake?: number | null
          name: string
          notes?: string | null
          source_type?: string
          updated_at?: string
          website?: string | null
        }
        Update: {
          created_at?: string
          currency?: string
          id?: string
          is_active?: boolean
          max_stake?: number | null
          min_stake?: number | null
          name?: string
          notes?: string | null
          source_type?: string
          updated_at?: string
          website?: string | null
        }
        Relationships: []
      }
      odds: {
        Row: {
          bookmaker_id: string
          created_at: string
          event_name: string
          event_time: string | null
          id: string
          market: string
          odds: number
          outcome: string
          sport: string
          tournament: string | null
          updated_at: string
        }
        Insert: {
          bookmaker_id: string
          created_at?: string
          event_name: string
          event_time?: string | null
          id?: string
          market: string
          odds: number
          outcome: string
          sport: string
          tournament?: string | null
          updated_at?: string
        }
        Update: {
          bookmaker_id?: string
          created_at?: string
          event_name?: string
          event_time?: string | null
          id?: string
          market?: string
          odds?: number
          outcome?: string
          sport?: string
          tournament?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "odds_bookmaker_id_fkey"
            columns: ["bookmaker_id"]
            isOneToOne: false
            referencedRelation: "bookmakers"
            referencedColumns: ["id"]
          },
        ]
      }
      ru_events: {
        Row: {
          date_key: string | null
          event_key: string
          event_name: string
          id: string
          league: string | null
          scanned_at: string
          source: string
          sport: string | null
          team1: string
          team2: string
          updated_at: string
          url: string | null
        }
        Insert: {
          date_key?: string | null
          event_key: string
          event_name: string
          id?: string
          league?: string | null
          scanned_at?: string
          source: string
          sport?: string | null
          team1: string
          team2: string
          updated_at?: string
          url?: string | null
        }
        Update: {
          date_key?: string | null
          event_key?: string
          event_name?: string
          id?: string
          league?: string | null
          scanned_at?: string
          source?: string
          sport?: string | null
          team1?: string
          team2?: string
          updated_at?: string
          url?: string | null
        }
        Relationships: []
      }
      ru_odds: {
        Row: {
          event_id: string
          id: string
          market: string
          odds: number
          outcome: string
          scanned_at: string
          updated_at: string
        }
        Insert: {
          event_id: string
          id?: string
          market: string
          odds: number
          outcome: string
          scanned_at?: string
          updated_at?: string
        }
        Update: {
          event_id?: string
          id?: string
          market?: string
          odds?: number
          outcome?: string
          scanned_at?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "ru_odds_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "ru_events"
            referencedColumns: ["id"]
          },
        ]
      }
      scan_runs: {
        Row: {
          arbs_found: number
          bookmakers_count: number
          duration_ms: number | null
          error: string | null
          events_scanned: number
          finished_at: string | null
          id: string
          requests_remaining: string | null
          sports_scanned: string[]
          started_at: string
        }
        Insert: {
          arbs_found?: number
          bookmakers_count?: number
          duration_ms?: number | null
          error?: string | null
          events_scanned?: number
          finished_at?: string | null
          id?: string
          requests_remaining?: string | null
          sports_scanned?: string[]
          started_at?: string
        }
        Update: {
          arbs_found?: number
          bookmakers_count?: number
          duration_ms?: number | null
          error?: string | null
          events_scanned?: number
          finished_at?: string | null
          id?: string
          requests_remaining?: string | null
          sports_scanned?: string[]
          started_at?: string
        }
        Relationships: []
      }
      surebets: {
        Row: {
          arb_percent: number
          bookmakers: string[]
          event_name: string
          event_time: string | null
          id: string
          legs: Json
          market: string
          match_key: string
          profit: number
          roi: number
          scanned_at: string
          source: string
          sport: string
          total_stake: number
          tournament: string | null
        }
        Insert: {
          arb_percent: number
          bookmakers?: string[]
          event_name: string
          event_time?: string | null
          id?: string
          legs: Json
          market: string
          match_key: string
          profit: number
          roi: number
          scanned_at?: string
          source?: string
          sport: string
          total_stake: number
          tournament?: string | null
        }
        Update: {
          arb_percent?: number
          bookmakers?: string[]
          event_name?: string
          event_time?: string | null
          id?: string
          legs?: Json
          market?: string
          match_key?: string
          profit?: number
          roi?: number
          scanned_at?: string
          source?: string
          sport?: string
          total_stake?: number
          tournament?: string | null
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      cleanup_old_ru_data: { Args: never; Returns: undefined }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {},
  },
} as const

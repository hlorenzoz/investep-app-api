export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  graphql_public: {
    Tables: {
      [_ in never]: never
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      graphql: {
        Args: {
          extensions?: Json
          operationName?: string
          query?: string
          variables?: Json
        }
        Returns: Json
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
  public: {
    Tables: {
      academy_memberships: {
        Row: {
          acquired_at: string
          created_at: string
          external_ref: string | null
          id: string
          investep_plan_id: number
          source: string
          status: string
          updated_at: string
          user_id: string
        }
        Insert: {
          acquired_at?: string
          created_at?: string
          external_ref?: string | null
          id?: string
          investep_plan_id: number
          source?: string
          status?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          acquired_at?: string
          created_at?: string
          external_ref?: string | null
          id?: string
          investep_plan_id?: number
          source?: string
          status?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "academy_memberships_investep_plan_id_fkey"
            columns: ["investep_plan_id"]
            isOneToOne: false
            referencedRelation: "investep_plans"
            referencedColumns: ["id"]
          },
        ]
      }
      accounts: {
        Row: {
          account_type: string
          broker_connection_id: string
          created_at: string
          currency: string
          external_id: string
          id: string
          investment_plan_id: number | null
          updated_at: string
        }
        Insert: {
          account_type: string
          broker_connection_id: string
          created_at?: string
          currency: string
          external_id: string
          id?: string
          investment_plan_id?: number | null
          updated_at?: string
        }
        Update: {
          account_type?: string
          broker_connection_id?: string
          created_at?: string
          currency?: string
          external_id?: string
          id?: string
          investment_plan_id?: number | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "accounts_broker_connection_id_fkey"
            columns: ["broker_connection_id"]
            isOneToOne: false
            referencedRelation: "broker_connections"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "accounts_investment_plan_fk"
            columns: ["investment_plan_id", "account_type"]
            isOneToOne: false
            referencedRelation: "investment_plans"
            referencedColumns: ["id", "account_type"]
          },
        ]
      }
      broker_allocations: {
        Row: {
          account_type: string
          broker_id: number
          created_at: string
          currency: string
          id: string
          initial_deposit: number
          investment_plan_id: number
          updated_at: string
          user_id: string
        }
        Insert: {
          account_type: string
          broker_id: number
          created_at?: string
          currency?: string
          id?: string
          initial_deposit: number
          investment_plan_id: number
          updated_at?: string
          user_id: string
        }
        Update: {
          account_type?: string
          broker_id?: number
          created_at?: string
          currency?: string
          id?: string
          initial_deposit?: number
          investment_plan_id?: number
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "broker_allocations_broker_id_fkey"
            columns: ["broker_id"]
            isOneToOne: false
            referencedRelation: "brokers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "broker_allocations_plan_fk"
            columns: ["investment_plan_id", "account_type"]
            isOneToOne: false
            referencedRelation: "investment_plans"
            referencedColumns: ["id", "account_type"]
          },
        ]
      }
      broker_connections: {
        Row: {
          alias: string | null
          broker_id: number
          created_at: string
          id: string
          status: string
          updated_at: string
          user_id: string
        }
        Insert: {
          alias?: string | null
          broker_id: number
          created_at?: string
          id?: string
          status?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          alias?: string | null
          broker_id?: number
          created_at?: string
          id?: string
          status?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "broker_connections_broker_id_fkey"
            columns: ["broker_id"]
            isOneToOne: false
            referencedRelation: "brokers"
            referencedColumns: ["id"]
          },
        ]
      }
      brokers: {
        Row: {
          created_at: string
          favicon: string | null
          icon: string | null
          id: number
          logo: string | null
          name: string
          slug: string
          updated_at: string
          url: string
          url_secondary: string | null
        }
        Insert: {
          created_at?: string
          favicon?: string | null
          icon?: string | null
          id?: never
          logo?: string | null
          name: string
          slug: string
          updated_at?: string
          url: string
          url_secondary?: string | null
        }
        Update: {
          created_at?: string
          favicon?: string | null
          icon?: string | null
          id?: never
          logo?: string | null
          name?: string
          slug?: string
          updated_at?: string
          url?: string
          url_secondary?: string | null
        }
        Relationships: []
      }
      investep_feature_translations: {
        Row: {
          investep_feature_id: number
          label: string
          locale: string
        }
        Insert: {
          investep_feature_id: number
          label: string
          locale: string
        }
        Update: {
          investep_feature_id?: number
          label?: string
          locale?: string
        }
        Relationships: [
          {
            foreignKeyName: "investep_feature_translations_investep_feature_id_fkey"
            columns: ["investep_feature_id"]
            isOneToOne: false
            referencedRelation: "investep_features"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "investep_feature_translations_locale_fkey"
            columns: ["locale"]
            isOneToOne: false
            referencedRelation: "locales"
            referencedColumns: ["code"]
          },
        ]
      }
      investep_features: {
        Row: {
          created_at: string
          id: number
          slug: string
          sort_order: number
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: never
          slug: string
          sort_order?: number
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: never
          slug?: string
          sort_order?: number
          updated_at?: string
        }
        Relationships: []
      }
      investep_plan_features: {
        Row: {
          investep_feature_id: number
          investep_plan_id: number
        }
        Insert: {
          investep_feature_id: number
          investep_plan_id: number
        }
        Update: {
          investep_feature_id?: number
          investep_plan_id?: number
        }
        Relationships: [
          {
            foreignKeyName: "investep_plan_features_investep_feature_id_fkey"
            columns: ["investep_feature_id"]
            isOneToOne: false
            referencedRelation: "investep_features"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "investep_plan_features_investep_plan_id_fkey"
            columns: ["investep_plan_id"]
            isOneToOne: false
            referencedRelation: "investep_plans"
            referencedColumns: ["id"]
          },
        ]
      }
      investep_plan_tickers: {
        Row: {
          created_at: string
          investep_plan_id: number
          ticker_id: number
        }
        Insert: {
          created_at?: string
          investep_plan_id: number
          ticker_id: number
        }
        Update: {
          created_at?: string
          investep_plan_id?: number
          ticker_id?: number
        }
        Relationships: [
          {
            foreignKeyName: "investep_plan_tickers_investep_plan_id_fkey"
            columns: ["investep_plan_id"]
            isOneToOne: false
            referencedRelation: "investep_plans"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "investep_plan_tickers_ticker_id_fkey"
            columns: ["ticker_id"]
            isOneToOne: false
            referencedRelation: "tickers"
            referencedColumns: ["id"]
          },
        ]
      }
      investep_plan_translations: {
        Row: {
          investep_plan_id: number
          locale: string
          name: string
          subtitle: string | null
        }
        Insert: {
          investep_plan_id: number
          locale: string
          name: string
          subtitle?: string | null
        }
        Update: {
          investep_plan_id?: number
          locale?: string
          name?: string
          subtitle?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "investep_plan_translations_investep_plan_id_fkey"
            columns: ["investep_plan_id"]
            isOneToOne: false
            referencedRelation: "investep_plans"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "investep_plan_translations_locale_fkey"
            columns: ["locale"]
            isOneToOne: false
            referencedRelation: "locales"
            referencedColumns: ["code"]
          },
        ]
      }
      investep_plans: {
        Row: {
          created_at: string
          currency: string
          id: number
          is_active: boolean
          price_offer: number | null
          price_regular: number
          slug: string
          sort_order: number
          updated_at: string
          url: string | null
        }
        Insert: {
          created_at?: string
          currency?: string
          id?: never
          is_active?: boolean
          price_offer?: number | null
          price_regular: number
          slug: string
          sort_order?: number
          updated_at?: string
          url?: string | null
        }
        Update: {
          created_at?: string
          currency?: string
          id?: never
          is_active?: boolean
          price_offer?: number | null
          price_regular?: number
          slug?: string
          sort_order?: number
          updated_at?: string
          url?: string | null
        }
        Relationships: []
      }
      investment_plan_translations: {
        Row: {
          investment_plan_id: number
          label: string
          locale: string
        }
        Insert: {
          investment_plan_id: number
          label: string
          locale: string
        }
        Update: {
          investment_plan_id?: number
          label?: string
          locale?: string
        }
        Relationships: [
          {
            foreignKeyName: "investment_plan_translations_investment_plan_id_fkey"
            columns: ["investment_plan_id"]
            isOneToOne: false
            referencedRelation: "investment_plans"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "investment_plan_translations_locale_fkey"
            columns: ["locale"]
            isOneToOne: false
            referencedRelation: "locales"
            referencedColumns: ["code"]
          },
        ]
      }
      investment_plans: {
        Row: {
          account_type: string
          created_at: string
          id: number
          target_daily_pct: number | null
          target_monthly_pct: number
          updated_at: string
        }
        Insert: {
          account_type: string
          created_at?: string
          id?: never
          target_daily_pct?: number | null
          target_monthly_pct: number
          updated_at?: string
        }
        Update: {
          account_type?: string
          created_at?: string
          id?: never
          target_daily_pct?: number | null
          target_monthly_pct?: number
          updated_at?: string
        }
        Relationships: []
      }
      locales: {
        Row: {
          code: string
          is_default: boolean
          name: string
        }
        Insert: {
          code: string
          is_default?: boolean
          name: string
        }
        Update: {
          code?: string
          is_default?: boolean
          name?: string
        }
        Relationships: []
      }
      products: {
        Row: {
          active: boolean
          amazon_url: string | null
          category: string
          created_at: string
          currency: string
          description: string | null
          gender: string | null
          id: number
          image: string | null
          name: string
          price: number | null
          slug: string
          theme: string | null
          updated_at: string
        }
        Insert: {
          active?: boolean
          amazon_url?: string | null
          category: string
          created_at?: string
          currency?: string
          description?: string | null
          gender?: string | null
          id?: never
          image?: string | null
          name: string
          price?: number | null
          slug: string
          theme?: string | null
          updated_at?: string
        }
        Update: {
          active?: boolean
          amazon_url?: string | null
          category?: string
          created_at?: string
          currency?: string
          description?: string | null
          gender?: string | null
          id?: never
          image?: string | null
          name?: string
          price?: number | null
          slug?: string
          theme?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      profiles: {
        Row: {
          created_at: string
          full_name: string | null
          id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          full_name?: string | null
          id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          full_name?: string | null
          id?: string
          updated_at?: string
        }
        Relationships: []
      }
      ticker_relations: {
        Row: {
          created_at: string
          multiplier: number
          parent_ticker_id: number
          related_ticker_id: number
          relation_type: string
        }
        Insert: {
          created_at?: string
          multiplier?: number
          parent_ticker_id: number
          related_ticker_id: number
          relation_type: string
        }
        Update: {
          created_at?: string
          multiplier?: number
          parent_ticker_id?: number
          related_ticker_id?: number
          relation_type?: string
        }
        Relationships: [
          {
            foreignKeyName: "ticker_relations_parent_ticker_id_fkey"
            columns: ["parent_ticker_id"]
            isOneToOne: false
            referencedRelation: "tickers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ticker_relations_related_ticker_id_fkey"
            columns: ["related_ticker_id"]
            isOneToOne: false
            referencedRelation: "tickers"
            referencedColumns: ["id"]
          },
        ]
      }
      tickers: {
        Row: {
          asset_class: string
          avg_volume: number | null
          change_pct: number | null
          country: string | null
          created_at: string
          dividend_yield: number | null
          exchange: string | null
          fifty_two_w_high: number | null
          fifty_two_w_low: number | null
          financials: Json
          forward_pe: number | null
          id: number
          industry: string | null
          market_cap: number | null
          name: string
          pb_ratio: number | null
          pe_ratio: number | null
          peg_ratio: number | null
          prev_close: number | null
          price: number | null
          ps_ratio: number | null
          sector: string | null
          symbol: string
          updated_at: string
          volume: number | null
        }
        Insert: {
          asset_class?: string
          avg_volume?: number | null
          change_pct?: number | null
          country?: string | null
          created_at?: string
          dividend_yield?: number | null
          exchange?: string | null
          fifty_two_w_high?: number | null
          fifty_two_w_low?: number | null
          financials?: Json
          forward_pe?: number | null
          id?: never
          industry?: string | null
          market_cap?: number | null
          name: string
          pb_ratio?: number | null
          pe_ratio?: number | null
          peg_ratio?: number | null
          prev_close?: number | null
          price?: number | null
          ps_ratio?: number | null
          sector?: string | null
          symbol: string
          updated_at?: string
          volume?: number | null
        }
        Update: {
          asset_class?: string
          avg_volume?: number | null
          change_pct?: number | null
          country?: string | null
          created_at?: string
          dividend_yield?: number | null
          exchange?: string | null
          fifty_two_w_high?: number | null
          fifty_two_w_low?: number | null
          financials?: Json
          forward_pe?: number | null
          id?: never
          industry?: string | null
          market_cap?: number | null
          name?: string
          pb_ratio?: number | null
          pe_ratio?: number | null
          peg_ratio?: number | null
          prev_close?: number | null
          price?: number | null
          ps_ratio?: number | null
          sector?: string | null
          symbol?: string
          updated_at?: string
          volume?: number | null
        }
        Relationships: []
      }
      trade_operations: {
        Row: {
          account_type: string
          allocation_id: string
          buy_price: number
          contract_type: string | null
          created_at: string
          expiration_date: string | null
          id: string
          limit_price: number | null
          notes: string | null
          opened_at: string
          quantity: number
          sell_price: number | null
          sold_at: string | null
          strategy: string | null
          strike: number | null
          ticker: string
          updated_at: string
          url: string | null
          user_id: string
        }
        Insert: {
          account_type: string
          allocation_id: string
          buy_price: number
          contract_type?: string | null
          created_at?: string
          expiration_date?: string | null
          id?: string
          limit_price?: number | null
          notes?: string | null
          opened_at: string
          quantity: number
          sell_price?: number | null
          sold_at?: string | null
          strategy?: string | null
          strike?: number | null
          ticker: string
          updated_at?: string
          url?: string | null
          user_id: string
        }
        Update: {
          account_type?: string
          allocation_id?: string
          buy_price?: number
          contract_type?: string | null
          created_at?: string
          expiration_date?: string | null
          id?: string
          limit_price?: number | null
          notes?: string | null
          opened_at?: string
          quantity?: number
          sell_price?: number | null
          sold_at?: string | null
          strategy?: string | null
          strike?: number | null
          ticker?: string
          updated_at?: string
          url?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "trade_operations_allocation_fk"
            columns: ["allocation_id", "account_type"]
            isOneToOne: false
            referencedRelation: "broker_allocations"
            referencedColumns: ["id", "account_type"]
          },
        ]
      }
      user_capital: {
        Row: {
          created_at: string
          currency: string
          total_capital: number
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          currency?: string
          total_capital: number
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          currency?: string
          total_capital?: number
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      user_ticker_favorites: {
        Row: {
          created_at: string
          ticker_id: number
          user_id: string
        }
        Insert: {
          created_at?: string
          ticker_id: number
          user_id: string
        }
        Update: {
          created_at?: string
          ticker_id?: number
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_ticker_favorites_ticker_id_fkey"
            columns: ["ticker_id"]
            isOneToOne: false
            referencedRelation: "tickers"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      transfer_capital: {
        Args: {
          p_amount: number
          p_from_id: string
          p_to_id: string
          p_user_id: string
        }
        Returns: undefined
      }
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
  graphql_public: {
    Enums: {},
  },
  public: {
    Enums: {},
  },
} as const


export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export type Database = {
  public: {
    Tables: {
      item_categories: {
        Row: {
          active: boolean;
          created_at: string;
          created_by: string | null;
          id: string;
          name: string;
          restaurant_id: string;
          updated_at: string;
        };
        Insert: {
          active?: boolean;
          created_at?: string;
          created_by?: string | null;
          id?: string;
          name: string;
          restaurant_id: string;
          updated_at?: string;
        };
        Update: {
          active?: boolean;
          created_at?: string;
          created_by?: string | null;
          id?: string;
          name?: string;
          restaurant_id?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "item_categories_restaurant_id_fkey";
            columns: ["restaurant_id"];
            isOneToOne: false;
            referencedRelation: "restaurants";
            referencedColumns: ["id"];
          },
        ];
      };
      items: {
        Row: {
          active: boolean;
          avg_unit_cost: number;
          category_id: string | null;
          created_at: string;
          created_by: string | null;
          id: string;
          name: string;
          par_level: number;
          reorder_point: number;
          restaurant_id: string;
          storage_location_id: string | null;
          unit_id: string;
          updated_at: string;
        };
        Insert: {
          active?: boolean;
          avg_unit_cost?: number;
          category_id?: string | null;
          created_at?: string;
          created_by?: string | null;
          id?: string;
          name: string;
          par_level?: number;
          reorder_point?: number;
          restaurant_id: string;
          storage_location_id?: string | null;
          unit_id: string;
          updated_at?: string;
        };
        Update: {
          active?: boolean;
          avg_unit_cost?: number;
          category_id?: string | null;
          created_at?: string;
          created_by?: string | null;
          id?: string;
          name?: string;
          par_level?: number;
          reorder_point?: number;
          restaurant_id?: string;
          storage_location_id?: string | null;
          unit_id?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "items_category_id_fkey";
            columns: ["category_id"];
            isOneToOne: false;
            referencedRelation: "item_categories";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "items_restaurant_id_fkey";
            columns: ["restaurant_id"];
            isOneToOne: false;
            referencedRelation: "restaurants";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "items_storage_location_id_fkey";
            columns: ["storage_location_id"];
            isOneToOne: false;
            referencedRelation: "storage_locations";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "items_unit_id_fkey";
            columns: ["unit_id"];
            isOneToOne: false;
            referencedRelation: "units";
            referencedColumns: ["id"];
          },
        ];
      };
      profiles: {
        Row: {
          created_at: string;
          created_by: string | null;
          id: string;
          restaurant_id: string;
          role: string;
          updated_at: string;
        };
        Insert: {
          created_at?: string;
          created_by?: string | null;
          id: string;
          restaurant_id: string;
          role: string;
          updated_at?: string;
        };
        Update: {
          created_at?: string;
          created_by?: string | null;
          id?: string;
          restaurant_id?: string;
          role?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "profiles_restaurant_id_fkey";
            columns: ["restaurant_id"];
            isOneToOne: false;
            referencedRelation: "restaurants";
            referencedColumns: ["id"];
          },
        ];
      };
      restaurants: {
        Row: {
          created_at: string;
          created_by: string | null;
          id: string;
          name: string;
          updated_at: string;
        };
        Insert: {
          created_at?: string;
          created_by?: string | null;
          id?: string;
          name: string;
          updated_at?: string;
        };
        Update: {
          created_at?: string;
          created_by?: string | null;
          id?: string;
          name?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      stock_movements: {
        Row: {
          batch_no: string | null;
          created_at: string;
          created_by: string | null;
          expiry_date: string | null;
          id: string;
          item_id: string;
          movement_type: string;
          notes: string | null;
          quantity: number;
          reason_code: string | null;
          reference_id: string | null;
          reference_type: string | null;
          restaurant_id: string;
          unit_cost: number | null;
        };
        Insert: {
          batch_no?: string | null;
          created_at?: string;
          created_by?: string | null;
          expiry_date?: string | null;
          id?: string;
          item_id: string;
          movement_type: string;
          notes?: string | null;
          quantity: number;
          reason_code?: string | null;
          reference_id?: string | null;
          reference_type?: string | null;
          restaurant_id: string;
          unit_cost?: number | null;
        };
        Update: {
          batch_no?: string | null;
          created_at?: string;
          created_by?: string | null;
          expiry_date?: string | null;
          id?: string;
          item_id?: string;
          movement_type?: string;
          notes?: string | null;
          quantity?: number;
          reason_code?: string | null;
          reference_id?: string | null;
          reference_type?: string | null;
          restaurant_id?: string;
          unit_cost?: number | null;
        };
        Relationships: [
          {
            foreignKeyName: "stock_movements_item_id_fkey";
            columns: ["item_id"];
            isOneToOne: false;
            referencedRelation: "items";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "stock_movements_restaurant_id_fkey";
            columns: ["restaurant_id"];
            isOneToOne: false;
            referencedRelation: "restaurants";
            referencedColumns: ["id"];
          },
        ];
      };
      storage_locations: {
        Row: {
          active: boolean;
          created_at: string;
          created_by: string | null;
          id: string;
          name: string;
          restaurant_id: string;
          updated_at: string;
        };
        Insert: {
          active?: boolean;
          created_at?: string;
          created_by?: string | null;
          id?: string;
          name: string;
          restaurant_id: string;
          updated_at?: string;
        };
        Update: {
          active?: boolean;
          created_at?: string;
          created_by?: string | null;
          id?: string;
          name?: string;
          restaurant_id?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "storage_locations_restaurant_id_fkey";
            columns: ["restaurant_id"];
            isOneToOne: false;
            referencedRelation: "restaurants";
            referencedColumns: ["id"];
          },
        ];
      };
      supplier_price_history: {
        Row: {
          changed_at: string;
          changed_by: string | null;
          id: string;
          item_id: string;
          new_price: number | null;
          old_price: number | null;
          restaurant_id: string;
          supplier_id: string;
        };
        Insert: {
          changed_at?: string;
          changed_by?: string | null;
          id?: string;
          item_id: string;
          new_price?: number | null;
          old_price?: number | null;
          restaurant_id: string;
          supplier_id: string;
        };
        Update: {
          changed_at?: string;
          changed_by?: string | null;
          id?: string;
          item_id?: string;
          new_price?: number | null;
          old_price?: number | null;
          restaurant_id?: string;
          supplier_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "supplier_price_history_restaurant_id_fkey";
            columns: ["restaurant_id"];
            isOneToOne: false;
            referencedRelation: "restaurants";
            referencedColumns: ["id"];
          },
        ];
      };
      supplier_prices: {
        Row: {
          created_at: string;
          created_by: string | null;
          currency: string;
          id: string;
          is_preferred: boolean;
          item_id: string;
          restaurant_id: string;
          supplier_id: string;
          unit_price: number;
          updated_at: string;
        };
        Insert: {
          created_at?: string;
          created_by?: string | null;
          currency?: string;
          id?: string;
          is_preferred?: boolean;
          item_id: string;
          restaurant_id: string;
          supplier_id: string;
          unit_price: number;
          updated_at?: string;
        };
        Update: {
          created_at?: string;
          created_by?: string | null;
          currency?: string;
          id?: string;
          is_preferred?: boolean;
          item_id?: string;
          restaurant_id?: string;
          supplier_id?: string;
          unit_price?: number;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "supplier_prices_item_id_fkey";
            columns: ["item_id"];
            isOneToOne: false;
            referencedRelation: "items";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "supplier_prices_restaurant_id_fkey";
            columns: ["restaurant_id"];
            isOneToOne: false;
            referencedRelation: "restaurants";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "supplier_prices_supplier_id_fkey";
            columns: ["supplier_id"];
            isOneToOne: false;
            referencedRelation: "suppliers";
            referencedColumns: ["id"];
          },
        ];
      };
      suppliers: {
        Row: {
          active: boolean;
          address: string | null;
          contact_person: string | null;
          created_at: string;
          created_by: string | null;
          email: string | null;
          gstin: string | null;
          id: string;
          name: string;
          notes: string | null;
          phone: string | null;
          restaurant_id: string;
          updated_at: string;
        };
        Insert: {
          active?: boolean;
          address?: string | null;
          contact_person?: string | null;
          created_at?: string;
          created_by?: string | null;
          email?: string | null;
          gstin?: string | null;
          id?: string;
          name: string;
          notes?: string | null;
          phone?: string | null;
          restaurant_id: string;
          updated_at?: string;
        };
        Update: {
          active?: boolean;
          address?: string | null;
          contact_person?: string | null;
          created_at?: string;
          created_by?: string | null;
          email?: string | null;
          gstin?: string | null;
          id?: string;
          name?: string;
          notes?: string | null;
          phone?: string | null;
          restaurant_id?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "suppliers_restaurant_id_fkey";
            columns: ["restaurant_id"];
            isOneToOne: false;
            referencedRelation: "restaurants";
            referencedColumns: ["id"];
          },
        ];
      };
      units: {
        Row: {
          created_at: string;
          created_by: string | null;
          id: string;
          name: string;
          restaurant_id: string;
          symbol: string;
          updated_at: string;
        };
        Insert: {
          created_at?: string;
          created_by?: string | null;
          id?: string;
          name: string;
          restaurant_id: string;
          symbol: string;
          updated_at?: string;
        };
        Update: {
          created_at?: string;
          created_by?: string | null;
          id?: string;
          name?: string;
          restaurant_id?: string;
          symbol?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "units_restaurant_id_fkey";
            columns: ["restaurant_id"];
            isOneToOne: false;
            referencedRelation: "restaurants";
            referencedColumns: ["id"];
          },
        ];
      };
    };
    Views: {
      current_stock: {
        Row: {
          item_id: string | null;
          last_movement_at: string | null;
          quantity: number | null;
          restaurant_id: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "stock_movements_item_id_fkey";
            columns: ["item_id"];
            isOneToOne: false;
            referencedRelation: "items";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "stock_movements_restaurant_id_fkey";
            columns: ["restaurant_id"];
            isOneToOne: false;
            referencedRelation: "restaurants";
            referencedColumns: ["id"];
          },
        ];
      };
    };
    Functions: {
      create_opening_balance: {
        Args: { p_item_id: string; p_quantity: number; p_unit_cost: number };
        Returns: string;
      };
      current_restaurant_id: { Args: Record<PropertyKey, never>; Returns: string };
      dearmor: { Args: { "": string }; Returns: string };
      gen_random_uuid: { Args: Record<PropertyKey, never>; Returns: string };
      gen_salt: { Args: { "": string }; Returns: string };
      has_role: { Args: { p_required: string }; Returns: boolean };
      list_receivable_items: {
        Args: Record<PropertyKey, never>;
        Returns: {
          item_id: string;
          item_name: string;
          unit_symbol: string;
        }[];
      };
      log_usage: {
        Args: { p_item_id: string; p_notes?: string; p_quantity: number; p_reason: string };
        Returns: string;
      };
      log_wastage: {
        Args: { p_item_id: string; p_notes?: string; p_quantity: number; p_reason: string };
        Returns: string;
      };
      pgp_armor_headers: { Args: { "": string }; Returns: Record<string, unknown>[] };
      receive_goods: { Args: { p_lines: Json }; Returns: Json };
      set_preferred_supplier: {
        Args: { p_item_id: string; p_supplier_id: string };
        Returns: {
          created_at: string;
          created_by: string | null;
          currency: string;
          id: string;
          is_preferred: boolean;
          item_id: string;
          restaurant_id: string;
          supplier_id: string;
          unit_price: number;
          updated_at: string;
        };
        SetofOptions: {
          from: "*";
          to: "supplier_prices";
          isOneToOne: true;
          isSetofReturn: false;
        };
      };
    };
    Enums: {
      [_ in never]: never;
    };
    CompositeTypes: {
      [_ in never]: never;
    };
  };
};

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">;

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">];

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R;
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] & DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R;
      }
      ? R
      : never
    : never;

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    keyof DefaultSchema["Tables"] | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I;
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I;
      }
      ? I
      : never
    : never;

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    keyof DefaultSchema["Tables"] | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U;
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U;
      }
      ? U
      : never
    : never;

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    keyof DefaultSchema["Enums"] | { schema: keyof DatabaseWithoutInternals },
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
> = DefaultSchemaEnumNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never;

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    keyof DefaultSchema["CompositeTypes"] | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never;

export const Constants = {
  public: {
    Enums: {},
  },
} as const;

export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export type Database = {
  public: {
    Tables: {
      alert_preferences: {
        Row: {
          expiry_days_window: number;
          expiry_enabled: boolean;
          low_stock_enabled: boolean;
          restaurant_id: string;
          updated_at: string;
        };
        Insert: {
          expiry_days_window?: number;
          expiry_enabled?: boolean;
          low_stock_enabled?: boolean;
          restaurant_id: string;
          updated_at?: string;
        };
        Update: {
          expiry_days_window?: number;
          expiry_enabled?: boolean;
          low_stock_enabled?: boolean;
          restaurant_id?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "alert_preferences_restaurant_id_fkey";
            columns: ["restaurant_id"];
            isOneToOne: true;
            referencedRelation: "restaurants";
            referencedColumns: ["id"];
          },
        ];
      };
      audit_log: {
        Row: {
          action: string;
          created_at: string;
          created_by: string | null;
          details: Json | null;
          entity_id: string | null;
          entity_type: string | null;
          id: string;
          restaurant_id: string;
        };
        Insert: {
          action: string;
          created_at?: string;
          created_by?: string | null;
          details?: Json | null;
          entity_id?: string | null;
          entity_type?: string | null;
          id?: string;
          restaurant_id: string;
        };
        Update: {
          action?: string;
          created_at?: string;
          created_by?: string | null;
          details?: Json | null;
          entity_id?: string | null;
          entity_type?: string | null;
          id?: string;
          restaurant_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "audit_log_restaurant_id_fkey";
            columns: ["restaurant_id"];
            isOneToOne: false;
            referencedRelation: "restaurants";
            referencedColumns: ["id"];
          },
        ];
      };
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
          barcode: string | null;
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
          barcode?: string | null;
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
          barcode?: string | null;
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
      menu_items: {
        Row: {
          active: boolean;
          created_at: string;
          created_by: string | null;
          description: string | null;
          id: string;
          name: string;
          restaurant_id: string;
          selling_price: number | null;
          updated_at: string;
          yield_quantity: number;
          yield_unit: string;
        };
        Insert: {
          active?: boolean;
          created_at?: string;
          created_by?: string | null;
          description?: string | null;
          id?: string;
          name: string;
          restaurant_id: string;
          selling_price?: number | null;
          updated_at?: string;
          yield_quantity: number;
          yield_unit: string;
        };
        Update: {
          active?: boolean;
          created_at?: string;
          created_by?: string | null;
          description?: string | null;
          id?: string;
          name?: string;
          restaurant_id?: string;
          selling_price?: number | null;
          updated_at?: string;
          yield_quantity?: number;
          yield_unit?: string;
        };
        Relationships: [
          {
            foreignKeyName: "menu_items_restaurant_id_fkey";
            columns: ["restaurant_id"];
            isOneToOne: false;
            referencedRelation: "restaurants";
            referencedColumns: ["id"];
          },
        ];
      };
      notifications: {
        Row: {
          batch_no: string | null;
          body: string;
          created_at: string;
          id: string;
          item_id: string;
          read_at: string | null;
          restaurant_id: string;
          title: string;
          type: string;
        };
        Insert: {
          batch_no?: string | null;
          body?: string;
          created_at?: string;
          id?: string;
          item_id: string;
          read_at?: string | null;
          restaurant_id: string;
          title: string;
          type: string;
        };
        Update: {
          batch_no?: string | null;
          body?: string;
          created_at?: string;
          id?: string;
          item_id?: string;
          read_at?: string | null;
          restaurant_id?: string;
          title?: string;
          type?: string;
        };
        Relationships: [
          {
            foreignKeyName: "notifications_item_id_fkey";
            columns: ["item_id"];
            isOneToOne: false;
            referencedRelation: "items";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "notifications_restaurant_id_fkey";
            columns: ["restaurant_id"];
            isOneToOne: false;
            referencedRelation: "restaurants";
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
      purchase_order_lines: {
        Row: {
          created_at: string;
          id: string;
          item_id: string;
          notes: string | null;
          po_id: string;
          quantity: number;
          received_quantity: number;
          restaurant_id: string;
          unit_price: number;
          updated_at: string;
        };
        Insert: {
          created_at?: string;
          id?: string;
          item_id: string;
          notes?: string | null;
          po_id: string;
          quantity: number;
          received_quantity?: number;
          restaurant_id: string;
          unit_price: number;
          updated_at?: string;
        };
        Update: {
          created_at?: string;
          id?: string;
          item_id?: string;
          notes?: string | null;
          po_id?: string;
          quantity?: number;
          received_quantity?: number;
          restaurant_id?: string;
          unit_price?: number;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "purchase_order_lines_item_id_fkey";
            columns: ["item_id"];
            isOneToOne: false;
            referencedRelation: "items";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "purchase_order_lines_po_id_fkey";
            columns: ["po_id"];
            isOneToOne: false;
            referencedRelation: "purchase_orders";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "purchase_order_lines_restaurant_id_fkey";
            columns: ["restaurant_id"];
            isOneToOne: false;
            referencedRelation: "restaurants";
            referencedColumns: ["id"];
          },
        ];
      };
      purchase_orders: {
        Row: {
          created_at: string;
          created_by: string | null;
          expected_date: string | null;
          gst_rate: number;
          id: string;
          notes: string | null;
          order_date: string;
          restaurant_id: string;
          status: string;
          supplier_id: string;
          updated_at: string;
        };
        Insert: {
          created_at?: string;
          created_by?: string | null;
          expected_date?: string | null;
          gst_rate?: number;
          id?: string;
          notes?: string | null;
          order_date?: string;
          restaurant_id: string;
          status?: string;
          supplier_id: string;
          updated_at?: string;
        };
        Update: {
          created_at?: string;
          created_by?: string | null;
          expected_date?: string | null;
          gst_rate?: number;
          id?: string;
          notes?: string | null;
          order_date?: string;
          restaurant_id?: string;
          status?: string;
          supplier_id?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "purchase_orders_restaurant_id_fkey";
            columns: ["restaurant_id"];
            isOneToOne: false;
            referencedRelation: "restaurants";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "purchase_orders_supplier_id_fkey";
            columns: ["supplier_id"];
            isOneToOne: false;
            referencedRelation: "suppliers";
            referencedColumns: ["id"];
          },
        ];
      };
      recipe_ingredients: {
        Row: {
          created_at: string;
          id: string;
          item_id: string;
          menu_item_id: string;
          notes: string | null;
          quantity: number;
          restaurant_id: string;
          unit_id: string;
          updated_at: string;
        };
        Insert: {
          created_at?: string;
          id?: string;
          item_id: string;
          menu_item_id: string;
          notes?: string | null;
          quantity: number;
          restaurant_id: string;
          unit_id: string;
          updated_at?: string;
        };
        Update: {
          created_at?: string;
          id?: string;
          item_id?: string;
          menu_item_id?: string;
          notes?: string | null;
          quantity?: number;
          restaurant_id?: string;
          unit_id?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "recipe_ingredients_item_id_fkey";
            columns: ["item_id"];
            isOneToOne: false;
            referencedRelation: "items";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "recipe_ingredients_menu_item_id_fkey";
            columns: ["menu_item_id"];
            isOneToOne: false;
            referencedRelation: "menu_item_costs";
            referencedColumns: ["menu_item_id"];
          },
          {
            foreignKeyName: "recipe_ingredients_menu_item_id_fkey";
            columns: ["menu_item_id"];
            isOneToOne: false;
            referencedRelation: "menu_items";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "recipe_ingredients_restaurant_id_fkey";
            columns: ["restaurant_id"];
            isOneToOne: false;
            referencedRelation: "restaurants";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "recipe_ingredients_unit_id_fkey";
            columns: ["unit_id"];
            isOneToOne: false;
            referencedRelation: "units";
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
      stock_count_lines: {
        Row: {
          count_id: string;
          counted_qty: number | null;
          created_at: string;
          expected_qty: number;
          id: string;
          item_id: string;
          restaurant_id: string;
          updated_at: string;
        };
        Insert: {
          count_id: string;
          counted_qty?: number | null;
          created_at?: string;
          expected_qty: number;
          id?: string;
          item_id: string;
          restaurant_id: string;
          updated_at?: string;
        };
        Update: {
          count_id?: string;
          counted_qty?: number | null;
          created_at?: string;
          expected_qty?: number;
          id?: string;
          item_id?: string;
          restaurant_id?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "stock_count_lines_count_id_fkey";
            columns: ["count_id"];
            isOneToOne: false;
            referencedRelation: "stock_counts";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "stock_count_lines_item_id_fkey";
            columns: ["item_id"];
            isOneToOne: false;
            referencedRelation: "items";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "stock_count_lines_restaurant_id_fkey";
            columns: ["restaurant_id"];
            isOneToOne: false;
            referencedRelation: "restaurants";
            referencedColumns: ["id"];
          },
        ];
      };
      stock_counts: {
        Row: {
          assigned_to: string | null;
          created_at: string;
          created_by: string | null;
          id: string;
          restaurant_id: string;
          status: string;
          title: string;
          updated_at: string;
        };
        Insert: {
          assigned_to?: string | null;
          created_at?: string;
          created_by?: string | null;
          id?: string;
          restaurant_id: string;
          status?: string;
          title: string;
          updated_at?: string;
        };
        Update: {
          assigned_to?: string | null;
          created_at?: string;
          created_by?: string | null;
          id?: string;
          restaurant_id?: string;
          status?: string;
          title?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "stock_counts_assigned_to_fkey";
            columns: ["assigned_to"];
            isOneToOne: false;
            referencedRelation: "profiles";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "stock_counts_restaurant_id_fkey";
            columns: ["restaurant_id"];
            isOneToOne: false;
            referencedRelation: "restaurants";
            referencedColumns: ["id"];
          },
        ];
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
          over_sale: boolean;
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
          over_sale?: boolean;
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
          over_sale?: boolean;
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
      unit_conversions: {
        Row: {
          created_at: string;
          factor: number;
          from_unit_id: string;
          id: string;
          restaurant_id: string;
          to_unit_id: string;
          updated_at: string;
        };
        Insert: {
          created_at?: string;
          factor: number;
          from_unit_id: string;
          id?: string;
          restaurant_id: string;
          to_unit_id: string;
          updated_at?: string;
        };
        Update: {
          created_at?: string;
          factor?: number;
          from_unit_id?: string;
          id?: string;
          restaurant_id?: string;
          to_unit_id?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "unit_conversions_from_unit_id_fkey";
            columns: ["from_unit_id"];
            isOneToOne: false;
            referencedRelation: "units";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "unit_conversions_restaurant_id_fkey";
            columns: ["restaurant_id"];
            isOneToOne: false;
            referencedRelation: "restaurants";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "unit_conversions_to_unit_id_fkey";
            columns: ["to_unit_id"];
            isOneToOne: false;
            referencedRelation: "units";
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
      menu_item_costs: {
        Row: {
          ingredient_cost: number | null;
          menu_item_id: string | null;
          restaurant_id: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "menu_items_restaurant_id_fkey";
            columns: ["restaurant_id"];
            isOneToOne: false;
            referencedRelation: "restaurants";
            referencedColumns: ["id"];
          },
        ];
      };
    };
    Functions: {
      apply_stock_count: { Args: { p_count_id: string }; Returns: Json };
      cancel_purchase_order: { Args: { p_po_id: string }; Returns: undefined };
      compute_sales_deductions: {
        Args: { p_lines: Json };
        Returns: {
          deduction_base_qty: number;
          dishes: number;
          item_id: string;
          item_name: string;
          menu_item_id: string;
          menu_name: string;
          unit_symbol: string;
        }[];
      };
      create_opening_balance: {
        Args: { p_item_id: string; p_quantity: number; p_unit_cost: number };
        Returns: string;
      };
      create_purchase_order: {
        Args: {
          p_expected_date: string;
          p_gst_rate?: number;
          p_lines: Json;
          p_notes: string;
          p_order_date: string;
          p_supplier_id: string;
        };
        Returns: string;
      };
      create_stock_count: {
        Args: { p_assigned_to?: string; p_title: string };
        Returns: {
          assigned_to: string | null;
          created_at: string;
          created_by: string | null;
          id: string;
          restaurant_id: string;
          status: string;
          title: string;
          updated_at: string;
        };
        SetofOptions: {
          from: "*";
          to: "stock_counts";
          isOneToOne: true;
          isSetofReturn: false;
        };
      };
      current_restaurant_id: { Args: Record<PropertyKey, never>; Returns: string };
      current_user_id: { Args: Record<PropertyKey, never>; Returns: string };
      dearmor: { Args: { "": string }; Returns: string };
      find_item_by_barcode: {
        Args: { p_barcode: string };
        Returns: {
          item_id: string;
          item_name: string;
          unit_symbol: string;
        }[];
      };
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
      preview_sales_deductions: {
        Args: { p_lines: Json };
        Returns: {
          current_quantity: number;
          deduction_quantity: number;
          item_id: string;
          item_name: string;
          projected_quantity: number;
          unit_symbol: string;
          would_go_negative: boolean;
        }[];
      };
      receive_goods: {
        Args: { p_lines: Json; p_reference_id?: string; p_reference_type?: string };
        Returns: Json;
      };
      receive_purchase_order: { Args: { p_lines: Json; p_po_id: string }; Returns: Json };
      record_sales: { Args: { p_lines: Json; p_sale_date?: string }; Returns: Json };
      send_purchase_order: { Args: { p_po_id: string }; Returns: undefined };
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
      stock_count_visible: { Args: { p_count_id: string }; Returns: boolean };
      upsert_alert_preferences: {
        Args: {
          p_expiry_days_window: number;
          p_expiry_enabled: boolean;
          p_low_stock_enabled: boolean;
        };
        Returns: {
          expiry_days_window: number;
          expiry_enabled: boolean;
          low_stock_enabled: boolean;
        }[];
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

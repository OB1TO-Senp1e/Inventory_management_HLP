import { z } from "zod";

/**
 * Outlet schemas (V2-07). Outlets are the second tenancy axis: catalog
 * (items, suppliers, recipes) stays restaurant-shared, stock is
 * outlet-scoped. The client's outlet context comes from
 * profiles.current_outlet_id, written only via the switch_outlet() RPC.
 */

export const outletSchema = z.object({
  id: z.string().uuid(),
  restaurantId: z.string().uuid(),
  name: z.string(),
  address: z.string().nullable(),
  isActive: z.boolean(),
  isDefault: z.boolean(),
  createdAt: z.string(),
});
export type Outlet = z.infer<typeof outletSchema>;

const outletRowSchema = z.object({
  id: z.string(),
  restaurant_id: z.string(),
  name: z.string(),
  address: z.string().nullable(),
  is_active: z.boolean(),
  is_default: z.boolean(),
  created_at: z.string(),
});

export function toOutlet(row: unknown): Outlet {
  const r = outletRowSchema.parse(row);
  return {
    id: r.id,
    restaurantId: r.restaurant_id,
    name: r.name,
    address: r.address,
    isActive: r.is_active,
    isDefault: r.is_default,
    createdAt: r.created_at,
  };
}

export const createOutletSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, "Outlet name is required.")
    .max(100, "Outlet name must be 100 characters or fewer."),
  address: z
    .string()
    .trim()
    .max(255, "Address must be 255 characters or fewer.")
    .optional()
    .transform((v) => (v ? v : null)),
});
export type CreateOutletInput = z.infer<typeof createOutletSchema>;

export const updateOutletSchema = z.object({
  id: z.string().uuid(),
  name: z
    .string()
    .trim()
    .min(1, "Outlet name is required.")
    .max(100, "Outlet name must be 100 characters or fewer.")
    .optional(),
  address: z
    .string()
    .trim()
    .max(255, "Address must be 255 characters or fewer.")
    .nullable()
    .optional(),
});
export type UpdateOutletInput = z.infer<typeof updateOutletSchema>;

export const switchOutletSchema = z.object({
  outletId: z.string().uuid("Choose an outlet."),
});
export type SwitchOutletInput = z.infer<typeof switchOutletSchema>;

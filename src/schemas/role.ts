import { z } from "zod";

/**
 * App roles. Mirrors the `role` CHECK constraint on the `profiles` table
 * (owner/manager/staff) and the role matrix in ARCHITECTURE.md §7.
 * The generated DB type is a plain string, so this Zod enum is the
 * single validated source of truth on the client.
 */
export const userRoleSchema = z.enum(["owner", "manager", "staff"]);

export type UserRole = z.infer<typeof userRoleSchema>;

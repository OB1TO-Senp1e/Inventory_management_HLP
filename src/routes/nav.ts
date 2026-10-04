import {
  BarChart3,
  Boxes,
  ChefHat,
  ClipboardCheck,
  ClipboardList,
  Home,
  LayoutDashboard,
  Package,
  PackageCheck,
  ReceiptText,
  ScrollText,
  Settings,
  Trash2,
  Truck,
  Users,
  type LucideIcon,
} from "lucide-react";
import { canAccessPath } from "./access";
import type { UserRole } from "@/schemas/role";

export interface NavItem {
  path: string;
  label: string;
  icon: LucideIcon;
}

/** Every planned section, in display order. Labels mirror ROUTES.md. */
export const allNavItems: NavItem[] = [
  { path: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { path: "/items", label: "Items", icon: Package },
  { path: "/suppliers", label: "Suppliers", icon: Truck },
  { path: "/purchase-orders", label: "Purchase Orders", icon: ClipboardList },
  { path: "/receiving", label: "Receiving", icon: PackageCheck },
  { path: "/stock", label: "Stock", icon: Boxes },
  { path: "/wastage", label: "Wastage", icon: Trash2 },
  { path: "/recipes", label: "Recipes", icon: ChefHat },
  { path: "/sales", label: "Sales", icon: ReceiptText },
  { path: "/stock-counts", label: "Stock Counts", icon: ClipboardCheck },
  { path: "/reports", label: "Reports", icon: BarChart3 },
  { path: "/audit-log", label: "Audit Log", icon: ScrollText },
  { path: "/users", label: "Users", icon: Users },
  { path: "/settings", label: "Settings", icon: Settings },
];

export const homeNavItem: NavItem = { path: "/", label: "Home", icon: Home };

/**
 * Navigation items visible to `role`: Home plus every section the role may
 * access (derived from the route→roles map in access.ts, so nav and guards
 * can never drift apart).
 */
export function getNavItems(role: UserRole): NavItem[] {
  return [
    homeNavItem,
    ...allNavItems.filter((item) => canAccessPath(item.path, role)),
  ];
}

/** Label for a path, for breadcrumbs. Falls back to a title-cased segment. */
export function navLabelForPath(path: string): string {
  if (path === "/") {
    return homeNavItem.label;
  }
  const found = allNavItems.find((item) => item.path === path);
  if (found) {
    return found.label;
  }
  const segment = path.split("/").filter(Boolean).pop() ?? "";
  return segment
    .replace(/-/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

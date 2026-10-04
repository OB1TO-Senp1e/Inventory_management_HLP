import { useMemo, useState } from "react";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/PageHeader";
import { useAuth } from "@/features/auth/useAuth";
import { useArchiveMenuItem, useMenuItems } from "./hooks";
import { RecipeDialog } from "./RecipeDialog";

const inputClass =
  "h-11 rounded-md border border-input bg-background px-3 text-sm " +
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

function LoadingSkeleton() {
  return (
    <div className="space-y-2" aria-label="Loading recipes" aria-busy="true">
      {[0, 1, 2, 3, 4].map((i) => (
        <div key={i} className="h-16 animate-pulse rounded-md bg-muted" />
      ))}
    </div>
  );
}

/**
 * Recipes list (P4-01). Owner/manager only (route guard + RLS).
 * Each recipe is a menu item with ingredient lines; the builder dialog
 * handles create/edit including yield and per-line units.
 */
export function RecipesPage() {
  const { profile } = useAuth();
  const canManage = profile?.role === "owner" || profile?.role === "manager";

  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState<string | undefined>(undefined);
  const [showArchived, setShowArchived] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  const input = useMemo(
    () => ({
      search,
      active: showArchived ? undefined : true,
    }),
    [search, showArchived],
  );
  const menuItemsQuery = useMenuItems(input);
  const items = menuItemsQuery.data ?? [];
  const archiveMutation = useArchiveMenuItem();

  const onSearch = (e: React.FormEvent) => {
    e.preventDefault();
    setSearch(searchInput.trim() === "" ? undefined : searchInput.trim());
  };

  const openEdit = (id: string) => {
    setEditingId(id);
    setDialogOpen(true);
  };

  const closeDialog = () => {
    setDialogOpen(false);
    setEditingId(null);
  };

  return (
    <div>
      <PageHeader
        title="Recipes"
        description="Menu items and their recipes. Ingredient quantities are for the full yield."
        actions={
          canManage ? (
            <Button onClick={() => setDialogOpen(true)} className="min-h-[44px]">
              <Plus className="mr-1 size-4" aria-hidden="true" />
              New recipe
            </Button>
          ) : undefined
        }
      />

      <form
        onSubmit={onSearch}
        className="mb-4 flex flex-wrap items-center gap-2"
        role="search"
      >
        <input
          type="search"
          aria-label="Search recipes"
          placeholder="Search recipes…"
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
          className={`${inputClass} min-w-0 flex-1 sm:flex-none sm:w-64`}
        />
        <Button type="submit" variant="outline" className="min-h-[44px]">
          Search
        </Button>
        <label className="flex min-h-[44px] items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={showArchived}
            onChange={(e) => setShowArchived(e.target.checked)}
            className="size-4"
          />
          Show archived
        </label>
      </form>

      {menuItemsQuery.isLoading ? (
        <LoadingSkeleton />
      ) : menuItemsQuery.isError ? (
        <div className="rounded-lg border p-8 text-center">
          <p role="alert" className="font-medium">
            Could not load recipes.
          </p>
          <p className="mt-1 text-sm text-muted-foreground">
            Check your connection and try again.
          </p>
          <Button
            type="button"
            variant="outline"
            className="mt-4 min-h-[44px]"
            onClick={() => menuItemsQuery.refetch()}
          >
            Retry
          </Button>
        </div>
      ) : items.length === 0 ? (
        <div className="rounded-lg border p-8 text-center">
          <p className="font-medium">No recipes yet.</p>
          <p className="mt-1 text-sm text-muted-foreground">
            Create your first recipe to link menu items to inventory.
          </p>
        </div>
      ) : (
        <>
          {/* Desktop table */}
          <div className="hidden overflow-x-auto rounded-lg border md:block">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-muted/50 text-left">
                  <th className="px-4 py-3 font-medium">Name</th>
                  <th className="px-4 py-3 font-medium">Yield</th>
                  <th className="px-4 py-3 font-medium">Ingredients</th>
                  {canManage && (
                    <th className="px-4 py-3 font-medium">
                      <span className="sr-only">Actions</span>
                    </th>
                  )}
                </tr>
              </thead>
              <tbody>
                {items.map((item) => (
                  <tr key={item.id} className="border-b last:border-0">
                    <td className="px-4 py-3 font-medium">{item.name}</td>
                    <td className="px-4 py-3 text-muted-foreground">
                      {item.yieldQuantity} {item.yieldUnit}
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">
                      {item.ingredientCount}{" "}
                      {item.ingredientCount === 1 ? "ingredient" : "ingredients"}
                    </td>
                    {canManage && (
                      <td className="px-4 py-3 text-right">
                        <div className="flex justify-end gap-2">
                          <Button
                            variant="outline"
                            size="sm"
                            className="min-h-[44px]"
                            onClick={() => openEdit(item.id)}
                          >
                            Edit
                          </Button>
                          <Button
                            variant="outline"
                            size="sm"
                            className="min-h-[44px]"
                            onClick={() => archiveMutation.mutate(item.id)}
                            disabled={archiveMutation.isPending}
                          >
                            Archive
                          </Button>
                        </div>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {/* Mobile cards */}
          <div className="space-y-2 md:hidden">
            {items.map((item) => (
              <div key={item.id} className="rounded-lg border p-4">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <p className="font-medium">{item.name}</p>
                    <p className="text-sm text-muted-foreground">
                      Yield: {item.yieldQuantity} {item.yieldUnit} ·{" "}
                      {item.ingredientCount}{" "}
                      {item.ingredientCount === 1 ? "ingredient" : "ingredients"}
                    </p>
                  </div>
                  {canManage && (
                    <div className="flex gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        className="min-h-[44px]"
                        onClick={() => openEdit(item.id)}
                      >
                        Edit
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        className="min-h-[44px]"
                        onClick={() => archiveMutation.mutate(item.id)}
                        disabled={archiveMutation.isPending}
                      >
                        Archive
                      </Button>
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        </>
      )}

      {dialogOpen && (
        <RecipeDialog menuItemId={editingId} onClose={closeDialog} />
      )}
    </div>
  );
}

import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Pencil, Plus, Power, PowerOff, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { useAuth } from "@/features/auth/useAuth";
import {
  useAllOutlets,
  useCreateOutlet,
  useDeactivateOutlet,
  useReactivateOutlet,
  useUpdateOutlet,
} from "./hooks";
import {
  createOutletSchema,
  type CreateOutletInput,
  type Outlet,
} from "@/schemas/outlet";
import { cn } from "@/lib/utils";

const inputClass =
  "h-11 w-full rounded-md border border-input bg-background px-3 text-sm " +
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring " +
  "disabled:cursor-not-allowed disabled:opacity-50";
const labelClass = "mb-1 block text-sm font-medium";
const errorClass = "mt-1 text-sm text-destructive";

/**
 * Outlet management (V2-07, owner only — the Settings route already guards
 * to owner/manager, and this section additionally checks the role).
 * Lists all outlets (incl. deactivated), with create / rename / deactivate /
 * reactivate. Deactivation is guarded in the DB: outlets holding stock or
 * the last active outlet cannot be deactivated — the error message is
 * surfaced verbatim via toast.
 */
export function OutletManagementSection() {
  const { profile } = useAuth();
  const isOwner = profile?.role === "owner";
  const { data: outlets, isLoading, isError, refetch } = useAllOutlets(isOwner);
  const [dialog, setDialog] = useState<{ mode: "create" } | { mode: "edit"; outlet: Outlet } | null>(null);
  const [deactivating, setDeactivating] = useState<Outlet | null>(null);
  const deactivateMutation = useDeactivateOutlet();
  const reactivateMutation = useReactivateOutlet();

  if (!isOwner) {
    return (
      <p className="text-sm text-muted-foreground">
        Only owners can manage outlets. Ask an owner to add or edit outlets.
      </p>
    );
  }

  return (
    <div>
      <div className="mb-4 flex items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">
          Each outlet keeps its own stock. Transfers move stock between outlets.
        </p>
        <Button type="button" onClick={() => setDialog({ mode: "create" })}>
          <Plus aria-hidden="true" className="h-4 w-4" />
          New outlet
        </Button>
      </div>

      {isLoading && <p className="text-sm text-muted-foreground">Loading outlets…</p>}
      {isError && (
        <div className="rounded-md border border-destructive/50 p-4">
          <p className="text-sm">Could not load outlets.</p>
          <Button type="button" variant="outline" className="mt-2" onClick={() => refetch()}>
            Retry
          </Button>
        </div>
      )}

      {outlets && outlets.length > 0 && (
        <ul className="divide-y rounded-lg border">
          {outlets.map((outlet) => (
            <li
              key={outlet.id}
              className={cn(
                "flex items-center gap-3 px-4 py-3",
                !outlet.isActive && "opacity-60",
              )}
            >
              <div className="min-w-0 flex-1">
                <p className="flex items-center gap-2 font-medium">
                  <span className="truncate">{outlet.name}</span>
                  {outlet.isDefault && (
                    <span className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
                      Default
                    </span>
                  )}
                  {!outlet.isActive && (
                    <span className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
                      Deactivated
                    </span>
                  )}
                </p>
                {outlet.address && (
                  <p className="truncate text-sm text-muted-foreground">{outlet.address}</p>
                )}
              </div>
              <div className="flex shrink-0 items-center gap-1">
                <button
                  type="button"
                  aria-label={`Edit ${outlet.name}`}
                  onClick={() => setDialog({ mode: "edit", outlet })}
                  className="inline-flex h-11 w-11 items-center justify-center rounded-md hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <Pencil aria-hidden="true" className="h-4 w-4" />
                </button>
                {outlet.isActive ? (
                  <button
                    type="button"
                    aria-label={`Deactivate ${outlet.name}`}
                    onClick={() => setDeactivating(outlet)}
                    disabled={deactivateMutation.isPending}
                    className="inline-flex h-11 w-11 items-center justify-center rounded-md hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
                  >
                    <PowerOff aria-hidden="true" className="h-4 w-4" />
                  </button>
                ) : (
                  <button
                    type="button"
                    aria-label={`Reactivate ${outlet.name}`}
                    onClick={() => reactivateMutation.mutate(outlet.id)}
                    disabled={reactivateMutation.isPending}
                    className="inline-flex h-11 w-11 items-center justify-center rounded-md hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
                  >
                    <Power aria-hidden="true" className="h-4 w-4" />
                  </button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}

      {dialog && (
        <OutletDialog
          mode={dialog.mode}
          outlet={dialog.mode === "edit" ? dialog.outlet : null}
          onClose={() => setDialog(null)}
        />
      )}

      {deactivating && (
        <ConfirmDialog
          open
          title={`Deactivate ${deactivating.name}?`}
          description="The outlet keeps its history, but no new stock can be posted to it. Users pinned to it are moved to the default outlet. This cannot be undone except by reactivating."
          confirmLabel="Deactivate"
          onConfirm={() => {
            deactivateMutation.mutate(deactivating.id);
            setDeactivating(null);
          }}
          onCancel={() => setDeactivating(null)}
        />
      )}
    </div>
  );
}

function OutletDialog({
  mode,
  outlet,
  onClose,
}: {
  mode: "create" | "edit";
  outlet: Outlet | null;
  onClose: () => void;
}) {
  const createMutation = useCreateOutlet();
  const updateMutation = useUpdateOutlet();
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<CreateOutletInput>({
    resolver: zodResolver(createOutletSchema),
    defaultValues: {
      name: outlet?.name ?? "",
      address: outlet?.address ?? "",
    },
  });

  const onSubmit = handleSubmit((values) => {
    if (mode === "create") {
      createMutation.mutate(values, { onSuccess: onClose });
    } else if (outlet) {
      updateMutation.mutate({ id: outlet.id, ...values }, { onSuccess: onClose });
    }
  });

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={mode === "create" ? "New outlet" : `Edit ${outlet?.name}`}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget) {
          onClose();
        }
      }}
    >
      <div className="max-h-[90dvh] w-full max-w-md overflow-y-auto rounded-lg bg-background p-6 shadow-xl">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold">
            {mode === "create" ? "New outlet" : "Edit outlet"}
          </h2>
          <button
            type="button"
            aria-label="Close"
            onClick={onClose}
            className="inline-flex h-11 w-11 items-center justify-center rounded-md hover:bg-accent"
          >
            <X aria-hidden="true" className="h-5 w-5" />
          </button>
        </div>
        <form onSubmit={onSubmit} className="space-y-4">
          <div>
            <label htmlFor="outlet-name" className={labelClass}>
              Name
            </label>
            <input
              id="outlet-name"
              type="text"
              autoComplete="off"
              className={inputClass}
              {...register("name")}
            />
            {errors.name && (
              <p role="alert" className={errorClass}>
                {errors.name.message}
              </p>
            )}
          </div>
          <div>
            <label htmlFor="outlet-address" className={labelClass}>
              Address <span className="text-muted-foreground">(optional)</span>
            </label>
            <input
              id="outlet-address"
              type="text"
              autoComplete="off"
              className={inputClass}
              {...register("address")}
            />
            {errors.address && (
              <p role="alert" className={errorClass}>
                {errors.address.message}
              </p>
            )}
          </div>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={isSubmitting}>
              {mode === "create" ? "Create outlet" : "Save changes"}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}

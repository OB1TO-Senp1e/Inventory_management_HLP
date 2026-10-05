import { Link } from "react-router-dom";
import { AlertTriangle, BellOff, CheckCheck, TimerOff } from "lucide-react";
import { PageHeader } from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { formatDateTime } from "@/lib/format";
import { cn } from "@/lib/utils";
import { notificationTypeLabels, type Notification } from "@/schemas/notifications";
import {
  useDeleteNotification,
  useMarkAllNotificationsRead,
  useMarkNotificationRead,
  useNotifications,
} from "./hooks";

/**
 * Alert inbox (V2-03): owner/manager only. Lists active smart alerts
 * newest-first. A notification disappears ("resolves") automatically when
 * its condition clears; the user can also mark items read, mark all read,
 * or dismiss individual alerts.
 *
 * Rows carry no cost data by design — this page is safe to show the
 * operational quantities it does.
 */

function EmptyState() {
  return (
    <div className="rounded-lg border bg-muted/40 px-4 py-12 text-center">
      <BellOff aria-hidden="true" className="mx-auto mb-3 h-8 w-8 text-muted-foreground" />
      <p className="text-sm font-medium">No alerts right now</p>
      <p className="mt-1 text-sm text-muted-foreground">
        You&apos;ll see low-stock and expiring-soon alerts here as they come
        up.
      </p>
    </div>
  );
}

function ErrorState({ onRetry }: { onRetry: () => void }) {
  return (
    <div className="rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-12 text-center">
      <p className="text-sm font-medium">Couldn&apos;t load notifications.</p>
      <p className="mt-1 text-sm text-muted-foreground">
        Check your connection and try again.
      </p>
      <Button type="button" variant="outline" className="mt-4" onClick={onRetry}>
        Retry
      </Button>
    </div>
  );
}

function NotificationCard({
  notification,
  onMarkRead,
  onDismiss,
  marking,
  dismissing,
}: {
  notification: Notification;
  onMarkRead: () => void;
  onDismiss: () => void;
  marking: boolean;
  dismissing: boolean;
}) {
  const unread = notification.readAt === null;
  return (
    <li
      data-testid="notification-item"
      data-unread={unread ? "true" : "false"}
      className={cn(
        "flex gap-3 rounded-lg border bg-card p-4",
        unread && "border-l-4 border-l-amber-500",
      )}
    >
      <div
        className={cn(
          "flex h-10 w-10 shrink-0 items-center justify-center rounded-full",
          notification.type === "low_stock"
            ? "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-200"
            : "bg-sky-100 text-sky-800 dark:bg-sky-900/30 dark:text-sky-200",
        )}
      >
        {notification.type === "low_stock" ? (
          <AlertTriangle aria-hidden="true" className="h-5 w-5" />
        ) : (
          <TimerOff aria-hidden="true" className="h-5 w-5" />
        )}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="rounded-full bg-secondary px-2 py-0.5 text-xs font-medium text-secondary-foreground">
            {notificationTypeLabels[notification.type]}
          </span>
          {unread && (
            <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-900 dark:bg-amber-900/30 dark:text-amber-200">
              New
            </span>
          )}
          <span className="ml-auto text-xs text-muted-foreground">
            {formatDateTime(notification.createdAt)}
          </span>
        </div>
        <p className="mt-1 text-sm font-medium">{notification.title}</p>
        {notification.body && (
          <p className="mt-0.5 text-sm text-muted-foreground">
            {notification.body}
          </p>
        )}
        <div className="mt-2 flex flex-wrap gap-2">
          <Link
            to={`/items/${notification.itemId}`}
            className="text-sm font-medium text-primary underline-offset-4 hover:underline"
          >
            View item
          </Link>
          {unread && (
            <button
              type="button"
              onClick={onMarkRead}
              disabled={marking}
              className="text-sm font-medium text-muted-foreground underline-offset-4 hover:underline disabled:opacity-50"
            >
              {marking ? "Marking…" : "Mark as read"}
            </button>
          )}
          <button
            type="button"
            onClick={onDismiss}
            disabled={dismissing}
            aria-label={`Dismiss alert: ${notification.title}`}
            className="text-sm font-medium text-muted-foreground underline-offset-4 hover:underline disabled:opacity-50"
          >
            {dismissing ? "Dismissing…" : "Dismiss"}
          </button>
        </div>
      </div>
    </li>
  );
}

export function NotificationsPage() {
  const { data, isLoading, isError, refetch } = useNotifications();
  const markRead = useMarkNotificationRead();
  const markAllRead = useMarkAllNotificationsRead();
  const dismiss = useDeleteNotification();

  const unreadCount = data?.filter((n) => n.readAt === null).length ?? 0;

  return (
    <div>
      <PageHeader
        title="Notifications"
        description="Smart alerts for low stock and batches expiring soon."
        actions={
          unreadCount > 0 ? (
            <Button
              type="button"
              variant="outline"
              onClick={() => markAllRead.mutate()}
              disabled={markAllRead.isPending}
            >
              <CheckCheck aria-hidden="true" className="mr-2 h-4 w-4" />
              {markAllRead.isPending ? "Marking…" : "Mark all read"}
            </Button>
          ) : undefined
        }
      />

      {isLoading && (
        <div className="space-y-3" aria-label="Loading notifications">
          {[0, 1, 2].map((i) => (
            <div
              key={i}
              className="h-24 animate-pulse rounded-lg bg-muted/60"
            />
          ))}
        </div>
      )}

      {isError && <ErrorState onRetry={() => void refetch()} />}

      {!isLoading && !isError && (!data || data.length === 0) && <EmptyState />}

      {!isLoading && !isError && data && data.length > 0 && (
        <ul className="space-y-3">
          {data.map((notification) => (
            <NotificationCard
              key={notification.id}
              notification={notification}
              marking={
                markRead.isPending && markRead.variables === notification.id
              }
              dismissing={
                dismiss.isPending && dismiss.variables === notification.id
              }
              onMarkRead={() => markRead.mutate(notification.id)}
              onDismiss={() => dismiss.mutate(notification.id)}
            />
          ))}
        </ul>
      )}
    </div>
  );
}

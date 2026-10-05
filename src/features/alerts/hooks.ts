import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  deleteNotification,
  getAlertPreferences,
  listNotifications,
  markAllNotificationsRead,
  markNotificationRead,
  updateAlertPreferences,
} from "@/api/notifications";
import type { AlertPreferences } from "@/schemas/notifications";

/** Query keys for the smart-alert inbox (V2-03). */
export const notificationKeys = {
  all: ["notifications"] as const,
  list: ["notifications", "list"] as const,
  preferences: ["alertPreferences"] as const,
};

/** Newest-first alert inbox. */
export function useNotifications() {
  return useQuery({
    queryKey: notificationKeys.list,
    queryFn: listNotifications,
  });
}

/**
 * Unread badge count for the header bell, derived from the inbox query —
 * one fetch serves both the badge and the page, so they can never
 * disagree. (A HEAD+count query would be cheaper, but the e2e stub cannot
 * deliver PostgREST's content-range header through route.fulfill, so the
 * derived count keeps the deterministic specs honest.)
 */
export function useUnreadAlertCount(): number {
  const { data } = useNotifications();
  return data?.filter((n) => n.readAt === null).length ?? 0;
}

export function useMarkNotificationRead() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: markNotificationRead,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: notificationKeys.all });
    },
  });
}

export function useMarkAllNotificationsRead() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: markAllNotificationsRead,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: notificationKeys.all });
    },
  });
}

export function useDeleteNotification() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: deleteNotification,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: notificationKeys.all });
    },
  });
}

/** Restaurant alert preferences (defaults when no row exists yet). */
export function useAlertPreferences() {
  return useQuery({
    queryKey: notificationKeys.preferences,
    queryFn: getAlertPreferences,
  });
}

export function useUpdateAlertPreferences() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (prefs: AlertPreferences) => updateAlertPreferences(prefs),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: notificationKeys.preferences,
      });
    },
  });
}

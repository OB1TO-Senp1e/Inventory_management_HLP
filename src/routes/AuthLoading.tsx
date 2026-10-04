/**
 * Minimal loading indicator shown while the auth state is being restored.
 * Guards render this instead of flashing a redirect.
 */
export function AuthLoading() {
  return (
    <div
      className="flex min-h-[50dvh] items-center justify-center"
      role="status"
      aria-label="Loading"
    >
      <div
        aria-hidden="true"
        className="h-8 w-8 animate-spin rounded-full border-2 border-muted border-t-primary"
      />
    </div>
  );
}

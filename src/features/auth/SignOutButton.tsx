import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { LogOut } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAuth } from "./useAuth";

/**
 * Sign-out control. Used by the AppShell navigation in P0-05; exported now
 * so the auth feature is complete in this task.
 */
export function SignOutButton() {
  const { signOut } = useAuth();
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);

  const handleClick = async () => {
    setBusy(true);
    try {
      await signOut();
      navigate("/login", { replace: true });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Button
      type="button"
      variant="ghost"
      size="lg"
      onClick={handleClick}
      disabled={busy}
      aria-label="Sign out"
    >
      <LogOut aria-hidden="true" />
      {busy ? "Signing out…" : "Sign out"}
    </Button>
  );
}

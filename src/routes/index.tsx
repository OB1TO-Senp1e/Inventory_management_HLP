import { Route, Routes } from "react-router-dom";
import { SetupStatus } from "@/components/SetupStatus";
import { AuthProvider } from "@/features/auth/AuthProvider";
import { LoginPage } from "@/features/auth/LoginPage";
import { ResetPasswordPage } from "@/features/auth/ResetPasswordPage";

export function AppRoutes() {
  return (
    <AuthProvider>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/reset-password" element={<ResetPasswordPage />} />
        <Route path="/" element={<SetupStatus />} />
        {/* Protected routes, role guards, 404 page and AppShell arrive in P0-05 */}
        <Route path="*" element={<SetupStatus />} />
      </Routes>
    </AuthProvider>
  );
}

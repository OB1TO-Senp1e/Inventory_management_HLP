import { Route, Routes } from "react-router-dom";
import { SetupStatus } from "@/components/SetupStatus";

export function AppRoutes() {
  return (
    <Routes>
      <Route path="/" element={<SetupStatus />} />
      {/* Proper 404 page, protected routes and role guards arrive in P0-04/P0-05 */}
      <Route path="*" element={<SetupStatus />} />
    </Routes>
  );
}

import { ToastProvider } from "@/components/toast/ToastProvider";
import { AppRoutes } from "@/routes";

export function App() {
  return (
    <ToastProvider>
      <AppRoutes />
    </ToastProvider>
  );
}

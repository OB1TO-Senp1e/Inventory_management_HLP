import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { App } from "./App";
import "./index.css";
import { captureEarlyInstallPrompt } from "@/features/pwa/earlyInstallPrompt";

// Capture beforeinstallprompt in the entry bundle: the install button lives
// in the lazy shell chunk, and without this a fast-firing event would be
// lost while that chunk downloads (P6-03).
captureEarlyInstallPrompt();

const queryClient = new QueryClient();

const rootElement = document.getElementById("root");
if (!rootElement) {
  throw new Error("Root element #root not found");
}

createRoot(rootElement).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </QueryClientProvider>
  </StrictMode>,
);

// PWA shell (P6-01): register the service worker in production builds only.
// Offline-first is best-effort — the app works fine without the worker.
if (import.meta.env.PROD && "serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    void navigator.serviceWorker.register("/sw.js").catch(() => {
      /* no-op: app remains usable without offline support */
    });
  });
}

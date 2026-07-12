import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { App } from "./App";
import { ToastHost } from "./components/Toast";
import "./theme/global.css";

// Apply saved theme (or the system preference) before first paint.
const savedTheme = localStorage.getItem("coord.theme");
const theme =
  savedTheme === "dark" ? "midnight" // old brown-dark migrates to black/blue
  : savedTheme ?? (matchMedia("(prefers-color-scheme: dark)").matches ? "midnight" : "light");
if (theme !== "light") document.documentElement.dataset.theme = theme;

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { staleTime: 15_000, retry: 1, refetchOnWindowFocus: true },
  },
});

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <App />
        <ToastHost />
      </BrowserRouter>
    </QueryClientProvider>
  </StrictMode>,
);

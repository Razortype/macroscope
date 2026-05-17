import React from "react";
import ReactDOM from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter } from "react-router-dom";
import { restoreStateCurrent, StateFlags } from "@tauri-apps/plugin-window-state";
import App from "./App";
import { AnalysisRunProvider } from "./context/AnalysisRunContext";
import "./styles/tokens.css";

// Restore window position and size saved from the previous session.
// Runs before the first render so the window doesn't visibly jump.
restoreStateCurrent(StateFlags.ALL).catch(() => {
  // First launch — no saved state yet, silently ignore.
});

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: 1, staleTime: 30_000 },
  },
});

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <AnalysisRunProvider>
          <App />
        </AnalysisRunProvider>
      </BrowserRouter>
    </QueryClientProvider>
  </React.StrictMode>,
);

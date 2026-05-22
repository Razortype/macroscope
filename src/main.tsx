import React from "react";
import ReactDOM from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter } from "react-router-dom";
import { restoreStateCurrent, StateFlags } from "@tauri-apps/plugin-window-state";
import { invoke } from "@tauri-apps/api/core";
import App from "./App";
import { AnalysisRunProvider } from "./context/AnalysisRunContext";
import "./i18n";
import i18next from "./i18n";
import "./styles/tokens.css";

restoreStateCurrent(StateFlags.ALL).catch(() => {});

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: 1, staleTime: 30_000 },
  },
});

async function init() {
  try {
    const locale = await invoke<string | null>("get_setting", { key: "locale" });
    if (locale === "tr") await i18next.changeLanguage("tr");
  } catch {
    // first launch or DB not ready — default "en" is fine
  }

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
}

init();

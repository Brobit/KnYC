import React from "react";
import ReactDOM from "react-dom/client";
import "@fontsource-variable/inter";
import "@fontsource-variable/jetbrains-mono";
import "./i18n";
import "./index.css";
import App from "./App";
import { JobsProvider } from "./jobs/jobs-context";
import { SettingsProvider } from "./lib/settings";

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <SettingsProvider>
      {/* Above every screen: analyses keep running whatever is shown (#57). */}
      <JobsProvider>
        <App />
      </JobsProvider>
    </SettingsProvider>
  </React.StrictMode>,
);

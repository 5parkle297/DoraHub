import React from "react";
import ReactDOM from "react-dom/client";
import { App } from "./App.tsx";
import { AppProvider } from "./state/conn.tsx";
// 自托管字体（方向契约：工作马字体，不用 Inter/Arial/系统默认）
import "@fontsource/ibm-plex-sans/400.css";
import "@fontsource/ibm-plex-sans/500.css";
import "@fontsource/ibm-plex-sans/600.css";
import "@fontsource/ibm-plex-sans/700.css";
import "@fontsource/ibm-plex-mono/400.css";
import "@fontsource/ibm-plex-mono/500.css";
import "@fontsource/ibm-plex-mono/600.css";
import "@fontsource/noto-sans-sc/400.css";
import "@fontsource/noto-sans-sc/500.css";
import "@fontsource/noto-sans-sc/700.css";
import "./style.css";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <AppProvider>
      <App />
    </AppProvider>
  </React.StrictMode>,
);

// PWA service worker
if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("/sw.js").catch(() => {});
}

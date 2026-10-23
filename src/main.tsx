import "./styles/index.css";

import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { App } from "./app/App";
import { suppressBrowserMenu } from "./app/browserMenu";
import { initWorkspace } from "./app/workspace";
import { ipc } from "./ipc";

/** Longer than two frames, so it only matters where frames don't run. */
const SHOW_TIMER_MS = 100;

suppressBrowserMenu();

// Restore tabs and recent repositories before the first render, so the window never shows
// an empty state that is replaced a moment later.
await initWorkspace();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

// The window starts hidden (src-tauri/src/window.rs); show it once the first frame is
// painted, so there is no flash of an empty or wrongly themed window. WebKitGTK (Linux)
// runs no animation frames while the window is hidden, so a short timer stands in there.
let shown = false;
const show = () => {
  if (shown) return;
  shown = true;
  void ipc.window.show();
};
requestAnimationFrame(() => requestAnimationFrame(show));
setTimeout(show, SHOW_TIMER_MS);

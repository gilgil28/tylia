// The webview's own context menu (Refresh, Save as, Print, Share…) belongs to a browser, not
// to Tylia. It is suppressed except where it helps: in text fields and on selected text
// (Cut, Copy, Paste). Tylia's menus (Radix ContextMenu) handle their right-clicks first and
// prevent the default themselves.

/** Whether the browser's menu is useful for a right-click on `target`. */
function wantsBrowserMenu(target: EventTarget | null): boolean {
  if (target instanceof Element && target.closest("input, textarea, [contenteditable='true']")) {
    return true;
  }
  const selection = window.getSelection();
  return !!selection && !selection.isCollapsed && selection.toString().trim() !== "";
}

export function suppressBrowserMenu() {
  document.addEventListener("contextmenu", (e) => {
    if (!e.defaultPrevented && !wantsBrowserMenu(e.target)) e.preventDefault();
  });
}

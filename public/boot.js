// Runs before the first paint: sets data-theme and data-platform on <html> so the page
// never flashes the wrong theme. In the app, Rust injects window.__TYLIA_BOOT__ (settings +
// platform). In browser mode (`pnpm dev:web`) there is no Rust side, so it is built here from
// the mock backend's stored settings. `?theme=` and `?platform=` override (screenshots).
(function () {
  var boot = window.__TYLIA_BOOT__;
  if (!boot) {
    var stored = null;
    try {
      stored = JSON.parse(localStorage.getItem("tylia.web.settings") || "null");
    } catch {
      // Storage unavailable or corrupt: use defaults.
    }
    var ua = navigator.userAgent;
    boot = {
      platform: /Mac/.test(ua) ? "macos" : /Windows/.test(ua) ? "windows" : "linux",
      settings: Object.assign(
        {
          theme: "system",
          nativeTitleBar: false,
          pullMode: "merge",
          fetchPrune: false,
          autoFetchMinutes: 0,
          pushAfterCommit: false,
          density: "comfortable",
          uiFontSize: 13,
          shortcuts: {},
          dateFormat: "relative",
          tabWidth: 4,
          gitPath: null,
          checkForUpdates: false,
        },
        stored,
      ),
    };
    window.__TYLIA_BOOT__ = boot;
  }
  var params = new URLSearchParams(location.search);
  if (params.get("theme")) boot.settings.theme = params.get("theme");
  if (params.get("platform")) boot.platform = params.get("platform");
  var dark =
    boot.settings.theme === "dark" ||
    (boot.settings.theme === "system" && matchMedia("(prefers-color-scheme: dark)").matches);
  document.documentElement.dataset.theme = dark ? "dark" : "light";
  document.documentElement.dataset.platform = boot.platform;
  document.documentElement.dataset.density = boot.settings.density || "comfortable";
  if (boot.settings.uiFontSize) {
    document.documentElement.style.setProperty("--ui-font-size", boot.settings.uiFontSize + "px");
  }
})();

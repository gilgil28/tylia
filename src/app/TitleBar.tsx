import { TabStrip } from "@/features/repo-tabs/TabStrip";

import { AppearanceMenu } from "./AppearanceMenu";
import { platform } from "./boot";
import { useSettings } from "./settings";
import { WindowControls } from "./WindowControls";

/**
 * The single integrated top bar: repo tabs on the left, app menus and window controls on
 * the right. Empty areas carry `data-tauri-drag-region` (drag to move, double-click to
 * maximize).
 */
export function TitleBar() {
  const custom = !useSettings((s) => s.nativeTitleBarAtStart);
  return (
    <header
      data-tauri-drag-region
      className="flex h-(--titlebar-h) shrink-0 items-center border-b border-line bg-titlebar"
    >
      {/* Room for the macOS traffic lights. */}
      {custom && platform === "macos" && <div data-tauri-drag-region className="w-19 shrink-0" />}
      <TabStrip />
      <div data-tauri-drag-region className="h-full flex-1" />
      <div className="flex items-center gap-1 px-2">
        <AppearanceMenu />
      </div>
      {custom && platform !== "macos" && <WindowControls platform={platform} />}
    </header>
  );
}

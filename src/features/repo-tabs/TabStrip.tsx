// Repository tabs in the title bar: click to switch, middle-click or × to close, drag to
// reorder. Reordering uses pointer events: the webview's native file drop (used to open
// folders) turns off HTML5 drag and drop on Windows.

import { FolderGit2, Plus } from "lucide-react";
import { useRef, type PointerEvent } from "react";

import { useWorkspace } from "@/app/workspace";
import { t } from "@/i18n";
import { IconButton } from "@/ui/IconButton";
import { RepoTab } from "@/ui/RepoTab";

/** Pointer travel before a press becomes a drag. */
const DRAG_THRESHOLD = 4;

export function TabStrip() {
  const { tabs, activeTabId, activate, closeTab, moveTab, newTab } = useWorkspace();
  const drag = useRef<{ index: number; startX: number; offset: number; dragging: boolean } | null>(
    null,
  );
  const stripRef = useRef<HTMLDivElement>(null);

  const tabEls = () =>
    Array.from(stripRef.current?.querySelectorAll<HTMLElement>("[data-tab]") ?? []);

  const onPointerDown = (index: number) => (e: PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    drag.current = { index, startX: e.clientX, offset: 0, dragging: false };
  };

  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d) return;
    const dx = e.clientX - d.startX;
    if (!d.dragging) {
      if (Math.abs(dx) < DRAG_THRESHOLD) return;
      d.dragging = true;
      e.currentTarget.setPointerCapture(e.pointerId);
    }
    const els = tabEls();
    const el = els[d.index];
    if (!el) return;
    // Swap with a neighbour once the dragged tab passes half of it.
    const next = els[d.index + 1];
    const prev = els[d.index - 1];
    if (next && dx > next.offsetWidth / 2) {
      moveTab(d.index, d.index + 1);
      d.startX += next.offsetWidth + 4;
      d.index += 1;
    } else if (prev && dx < -prev.offsetWidth / 2) {
      moveTab(d.index, d.index - 1);
      d.startX -= prev.offsetWidth + 4;
      d.index -= 1;
    }
    d.offset = e.clientX - d.startX;
    // The moved tab re-renders at its new index; translate whichever element is there now.
    requestAnimationFrame(() => {
      const current = tabEls()[d.index];
      if (current && drag.current) current.style.transform = `translateX(${d.offset}px)`;
    });
  };

  const endDrag = () => {
    const d = drag.current;
    drag.current = null;
    if (d?.dragging) {
      const el = tabEls()[d.index];
      if (el) el.style.transform = "";
    }
  };

  return (
    <div
      ref={stripRef}
      data-tauri-drag-region
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      className="flex min-w-0 items-center gap-1 overflow-hidden pl-2"
    >
      <div
        role="tablist"
        aria-label={t("titlebar.tabs")}
        data-tauri-drag-region
        className="flex min-w-0 items-center gap-1"
      >
        {tabs.map((tab, index) => (
          <RepoTab
            key={tab.id}
            label={tab.kind === "repo" ? tab.name : t("titlebar.newTab")}
            icon={tab.kind === "repo" ? FolderGit2 : undefined}
            title={tab.kind === "repo" ? tab.path : undefined}
            active={tab.id === activeTabId}
            onSelect={() => activate(tab.id)}
            onClose={() => closeTab(tab.id)}
            onPointerDown={onPointerDown(index)}
            className="min-w-24"
          />
        ))}
      </div>
      <IconButton
        icon={Plus}
        label={t("titlebar.newTab")}
        shortcut="Mod+T"
        compact
        onClick={newTab}
      />
    </div>
  );
}

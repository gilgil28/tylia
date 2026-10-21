import { useRef, type KeyboardEvent, type PointerEvent, type ReactNode } from "react";

import { t } from "@/i18n";

import { cn } from "./cn";

interface SplitPaneProps {
  /** `horizontal` puts panes side by side; `vertical` stacks them. */
  direction?: "horizontal" | "vertical";
  /** Size of the first pane in px (controlled). */
  size: number;
  onSizeChange: (size: number) => void;
  min: number;
  max: number;
  /** Hides the first pane (e.g. a collapsed sidebar). */
  collapsed?: boolean;
  first: ReactNode;
  second: ReactNode;
  className?: string;
}

const KEY_STEP = 8;
const KEY_STEP_LARGE = 32;

/** Two panes with a 1px divider that can be dragged or moved with the arrow keys. */
export function SplitPane({
  direction = "horizontal",
  size,
  onSizeChange,
  min,
  max,
  collapsed = false,
  first,
  second,
  className,
}: SplitPaneProps) {
  const drag = useRef<{ start: number; size: number } | null>(null);
  const horizontal = direction === "horizontal";
  const clamp = (v: number) => Math.round(Math.min(max, Math.max(min, v)));

  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { start: horizontal ? e.clientX : e.clientY, size };
  };
  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    if (!drag.current) return;
    const delta = (horizontal ? e.clientX : e.clientY) - drag.current.start;
    onSizeChange(clamp(drag.current.size + delta));
  };
  const onPointerUp = () => {
    drag.current = null;
  };
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const step = e.shiftKey ? KEY_STEP_LARGE : KEY_STEP;
    const back = horizontal ? "ArrowLeft" : "ArrowUp";
    const forward = horizontal ? "ArrowRight" : "ArrowDown";
    if (e.key === back) onSizeChange(clamp(size - step));
    else if (e.key === forward) onSizeChange(clamp(size + step));
    else if (e.key === "Home") onSizeChange(min);
    else if (e.key === "End") onSizeChange(max);
    else return;
    e.preventDefault();
  };

  return (
    <div
      className={cn(
        "flex size-full min-h-0 min-w-0",
        horizontal ? "flex-row" : "flex-col",
        className,
      )}
    >
      {!collapsed && (
        <>
          <div
            className="relative shrink-0 overflow-hidden"
            style={horizontal ? { width: size } : { height: size }}
          >
            {first}
          </div>
          <div
            role="separator"
            aria-orientation={horizontal ? "vertical" : "horizontal"}
            aria-label={t("splitPane.resize")}
            aria-valuenow={size}
            aria-valuemin={min}
            aria-valuemax={max}
            tabIndex={0}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onKeyDown={onKeyDown}
            className={cn(
              "group relative z-10 shrink-0 bg-line-subtle outline-none",
              horizontal ? "w-px cursor-col-resize" : "h-px cursor-row-resize",
            )}
          >
            {/* Wider invisible hit area; highlights on hover, drag and keyboard focus. */}
            <div
              className={cn(
                "absolute bg-transparent transition-colors duration-(--dur-fast) group-hover:bg-line-strong group-active:bg-line-strong group-focus-visible:bg-accent",
                horizontal ? "inset-y-0 -left-0.5 w-1" : "inset-x-0 -top-0.5 h-1",
              )}
            />
          </div>
        </>
      )}
      <div className="relative min-h-0 min-w-0 flex-1 overflow-hidden">{second}</div>
    </div>
  );
}

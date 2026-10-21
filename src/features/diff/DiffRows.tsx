import { useVirtualizer } from "@tanstack/react-virtual";
import { Check, CircleSlash2, Ellipsis, UnfoldVertical } from "lucide-react";
import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
  type RefObject,
} from "react";

import { useSettings } from "@/app/settings";
import { t } from "@/i18n";
import type { DiffLine } from "@/ipc/bindings/DiffLine";
import type { Hunk } from "@/ipc/bindings/Hunk";
import type { LineKind } from "@/ipc/bindings/LineKind";
import { cn } from "@/ui/cn";
import { Tooltip } from "@/ui/Tooltip";

import type { HighlightLang } from "./language";
import {
  DEFAULT_DIFF_FONT_PX,
  lineNumberDigits,
  lineRowHeight,
  numberColumns,
  rowHeight,
  splitRows,
  TAB_WIDTH,
  unifiedRows,
  widestLine,
  type DiffMode,
  type DiffRow,
  type LineCell,
  type Side,
} from "./rows";
import { mergeSegments, type Token } from "./segments";
import { lineKey } from "./selection";
import { useHunkHighlights, type HunkTokens } from "./useHighlights";
import { useLineSelection } from "./useLineSelection";

const LINE_TINT: Record<LineKind, string> = {
  add: "bg-(--diff-add-bg)",
  del: "bg-(--diff-del-bg)",
  context: "",
};
// Sticky gutters paint the tint over an opaque base so code can scroll underneath.
const GUTTER_TINT: Record<LineKind, string> = {
  add: "bg-app bg-[linear-gradient(var(--diff-add-bg),var(--diff-add-bg))]",
  del: "bg-app bg-[linear-gradient(var(--diff-del-bg),var(--diff-del-bg))]",
  context: "bg-app",
};
// A selected line doubles its add/remove tint.
const SELECTED_TINT: Record<LineKind, string> = {
  add: "bg-[linear-gradient(var(--diff-add-bg),var(--diff-add-bg))]",
  del: "bg-[linear-gradient(var(--diff-del-bg),var(--diff-del-bg))]",
  context: "",
};
const SELECTED_GUTTER_TINT: Record<LineKind, string> = {
  add: "bg-app bg-[linear-gradient(var(--diff-add-bg),var(--diff-add-bg)),linear-gradient(var(--diff-add-bg),var(--diff-add-bg))]",
  del: "bg-app bg-[linear-gradient(var(--diff-del-bg),var(--diff-del-bg)),linear-gradient(var(--diff-del-bg),var(--diff-del-bg))]",
  context: "bg-app",
};
const WORD_TINT: Record<LineKind, string> = {
  add: "bg-(--diff-add-word)",
  del: "bg-(--diff-del-word)",
  context: "",
};
const MARKER: Record<LineKind, string> = { add: "+", del: "−", context: "" };
const MARKER_COLOR: Record<LineKind, string> = {
  add: "text-success",
  del: "text-danger",
  context: "",
};
/** Where one side of a split row has no line; anchored to the diff top so rows join up. */
const HATCH =
  "bg-[repeating-linear-gradient(135deg,var(--border)_0_1px,transparent_1px_6px)] [background-position:0_var(--row-y)]";
const INSET_FOCUS =
  "outline-none focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-solid focus-visible:outline-accent";
/** Horizontal offset of each split side, driven by its scrollbar strip. */
const SIDE_SHIFT: Record<Side, string> = {
  old: "translate-x-[var(--diff-x-old,0px)]",
  new: "translate-x-[var(--diff-x-new,0px)]",
};

/**
 * The selection box column of a gutter: absent unless the diff is selectable, blank beside
 * lines that can't be selected.
 */
type Check = "blank" | "off" | "on";

/** How a line takes part in selection; `key` is set on selectable lines. */
interface LineSelect {
  check?: Check;
  key?: string;
}

interface DiffRowsProps {
  hunks: Hunk[];
  mode: DiffMode;
  lang: HighlightLang | null;
  label: string;
  onExpandContext?: () => void;
  renderHunkActions?: (hunk: Hunk, index: number) => ReactNode;
  selection?: ReadonlySet<string>;
  onSelectionChange?: (next: Set<string>) => void;
}

/** Virtualized text diff, unified or side by side. */
export function DiffRows({
  hunks,
  mode,
  lang,
  label,
  onExpandContext,
  renderHunkActions,
  selection,
  onSelectionChange,
}: DiffRowsProps) {
  const tabSize = useSettings((st) => st.settings.tabWidth) || TAB_WIDTH;
  const rows = useMemo(
    () => (mode === "split" ? splitRows(hunks) : unifiedRows(hunks)),
    [hunks, mode],
  );
  const digits = useMemo(() => lineNumberDigits(hunks), [hunks]);
  // Split view has one number column per side.
  const columns = useMemo<Side[]>(
    () => (mode === "split" ? ["new"] : numberColumns(hunks)),
    [hunks, mode],
  );
  const scrollRef = useRef<HTMLDivElement>(null);
  const probeRef = useRef<HTMLSpanElement>(null);
  const strips = useRef<Record<Side, HTMLDivElement | null>>({ old: null, new: null });
  const lineHeight = lineRowHeight(useFontSize(probeRef));

  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: (i) => rowHeight(rows[i]!, lineHeight),
    overscan: 16,
  });
  useEffect(() => {
    virtualizer.measure();
  }, [virtualizer, rows, lineHeight]);
  const selectionHandlers = useLineSelection({
    hunks,
    rows,
    mode,
    scrollRef,
    virtualizer,
    selection,
    onSelectionChange,
  });
  const blank: Check | undefined = onSelectionChange ? "blank" : undefined;
  const selectFor = (hunk: number, cell: LineCell | null): LineSelect => {
    if (!blank || !cell || cell.line.kind === "context") return { check: blank };
    const key = lineKey(hunk, cell.lineIndex);
    return { check: selection?.has(key) ? "on" : "off", key };
  };

  // Full-width chrome (hunk headers, gaps) stays put while unified code scrolls sideways.
  useLayoutEffect(() => {
    const el = scrollRef.current!;
    const observer = new ResizeObserver(() =>
      el.style.setProperty("--diff-viewport-w", `${el.clientWidth}px`),
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // Split sides scroll sideways independently: wheel and trackpad move the side under the
  // pointer through its scrollbar strip.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el || mode !== "split") return;
    const onWheel = (e: WheelEvent) => {
      const dx = e.deltaX || (e.shiftKey ? e.deltaY : 0);
      if (!dx) return;
      const rect = el.getBoundingClientRect();
      const strip = strips.current[e.clientX < rect.left + rect.width / 2 ? "old" : "new"];
      if (!strip) return;
      e.preventDefault();
      strip.scrollLeft += dx;
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [mode]);

  // A different diff starts scrolled fully left.
  useEffect(() => {
    for (const side of ["old", "new"] as const) {
      if (strips.current[side]) strips.current[side].scrollLeft = 0;
      scrollRef.current?.style.removeProperty(`--diff-x-${side}`);
    }
  }, [hunks]);

  const items = virtualizer.getVirtualItems();
  const tokensFor = useHunkHighlights(
    hunks,
    lang,
    rows[items[0]?.index ?? 0]?.hunk ?? 0,
    rows[items.at(-1)?.index ?? 0]?.hunk ?? 0,
  );
  const widest = useMemo(
    () =>
      mode === "split"
        ? { old: widestLine(hunks, "old"), new: widestLine(hunks, "new") }
        : { old: "", new: widestLine(hunks, "both") },
    [hunks, mode],
  );

  const renderRow = (row: DiffRow) => {
    switch (row.kind) {
      case "gap":
        return (
          <GapRow
            count={row.count}
            columns={columns}
            digits={digits}
            check={blank}
            onExpand={onExpandContext}
          />
        );
      case "hunk":
        return (
          <HunkHeader
            hunk={hunks[row.hunk]!}
            columns={columns}
            digits={digits}
            check={blank}
            actions={renderHunkActions?.(hunks[row.hunk]!, row.hunk)}
          />
        );
      case "line":
        return (
          <UnifiedLine
            cell={row.cell}
            columns={columns}
            digits={digits}
            tokens={tokensFor(row.hunk)}
            select={selectFor(row.hunk, row.cell)}
          />
        );
      case "pair":
        return (
          <div className="flex h-full divide-x divide-line-subtle">
            <SplitCell
              cell={row.old}
              digits={digits}
              tokens={tokensFor(row.hunk)}
              select={selectFor(row.hunk, row.old)}
            />
            <SplitCell
              cell={row.new}
              digits={digits}
              tokens={tokensFor(row.hunk)}
              select={selectFor(row.hunk, row.new)}
            />
          </div>
        );
    }
  };

  return (
    <div
      className="group/diff flex min-h-0 flex-1 flex-col font-code text-(length:--text-diff)"
      style={{ tabSize, lineHeight: `${lineHeight}px` }}
    >
      <div
        ref={scrollRef}
        role="region"
        aria-label={label}
        tabIndex={0}
        {...selectionHandlers}
        className={cn(
          "relative min-h-0 flex-1",
          // Split keeps the scrollbar gutter so the strips below line up with the columns.
          mode === "split"
            ? "overflow-x-hidden overflow-y-auto [scrollbar-gutter:stable]"
            : "overflow-auto",
          INSET_FOCUS,
        )}
      >
        <span ref={probeRef} aria-hidden className="invisible absolute h-[1em] w-px" />
        <div className="relative w-max min-w-full" style={{ height: virtualizer.getTotalSize() }}>
          {mode === "unified" && (
            // Invisible copy of the widest line: gives the scroll area its width.
            <div aria-hidden className="invisible h-0 overflow-hidden">
              <UnifiedLine
                cell={ghostCell(widest.new)}
                columns={columns}
                digits={digits}
                tokens={undefined}
                select={{ check: blank }}
              />
            </div>
          )}
          {items.map((item) => (
            <div
              key={item.key}
              className="absolute top-0 left-0 w-full"
              style={
                {
                  height: item.size,
                  transform: `translateY(${item.start}px)`,
                  "--row-y": `${-item.start}px`,
                } as CSSProperties
              }
            >
              {renderRow(rows[item.index]!)}
            </div>
          ))}
        </div>
      </div>
      {mode === "split" && (
        <div className="flex shrink-0 divide-x divide-line-subtle overflow-hidden [scrollbar-gutter:stable]">
          {(["old", "new"] as const).map((side) => (
            <div key={side} className="flex min-w-0 flex-1 basis-0">
              <Gutter
                numbers={[null]}
                kind="context"
                digits={digits}
                check={blank}
                className="invisible"
              />
              <div
                ref={(el) => {
                  strips.current[side] = el;
                }}
                onScroll={(e) =>
                  scrollRef.current?.style.setProperty(
                    `--diff-x-${side}`,
                    `${-e.currentTarget.scrollLeft}px`,
                  )
                }
                className="min-w-0 flex-1 overflow-x-auto overflow-y-hidden group-hover/diff:[scrollbar-color:var(--border-strong)_transparent]"
              >
                <div aria-hidden className="invisible h-px w-max pr-4 whitespace-pre">
                  <Code line={ghostCell(widest[side]).line} tokens={undefined} />
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/** The resolved `--text-diff` in px, kept current if the UI font size changes. */
export function useFontSize(probe: RefObject<HTMLElement | null>): number {
  const [px, setPx] = useState(DEFAULT_DIFF_FONT_PX);
  useLayoutEffect(() => {
    const el = probe.current!;
    // Fires once on observe, then whenever 1em changes.
    const observer = new ResizeObserver(() => setPx(parseFloat(getComputedStyle(el).fontSize)));
    observer.observe(el);
    return () => observer.disconnect();
  }, [probe]);
  return px;
}

function ghostCell(text: string): LineCell {
  return {
    line: { kind: "context", oldLine: null, newLine: null, text, noNewline: true, emphasis: [] },
    side: "new",
    index: 0,
    lineIndex: 0,
  };
}

function Gutter({
  numbers,
  kind,
  digits,
  check,
  selectKey,
  className,
}: {
  numbers: (number | null)[];
  kind: LineKind;
  digits: number;
  check?: Check;
  /** Makes the gutter the line's selection handle (see `useLineSelection`). */
  selectKey?: string;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex shrink-0 text-fg-muted tabular-nums select-none",
        selectKey && "group/gutter",
        check === "on" && "text-fg-secondary",
        className,
      )}
      data-line-key={selectKey}
    >
      {check && <SelectBox check={check} />}
      {numbers.map((n, i) => (
        <span key={i} className="box-content px-2 text-right" style={{ width: `${digits}ch` }}>
          {n}
        </span>
      ))}
      <span className={cn("box-content w-[1ch] pr-2 pl-1 text-center", MARKER_COLOR[kind])}>
        {MARKER[kind]}
      </span>
    </div>
  );
}

/** 12px box: filled with a check when selected, outlined on hover when not. */
function SelectBox({ check }: { check: Check }) {
  return (
    <span aria-hidden className="flex items-center pl-2">
      <span
        className={cn(
          "grid size-3 place-items-center rounded-badge",
          check === "on" && "bg-accent-fill text-on-accent",
          check === "off" &&
            "border border-line-strong opacity-0 transition-[opacity,border-color] duration-(--dur-fast) group-hover/gutter:border-fg-muted group-hover/line:opacity-100",
        )}
      >
        {check === "on" && <Check size={10} strokeWidth={3} />}
      </span>
    </span>
  );
}

function Code({ line, tokens }: { line: DiffLine; tokens: Token[] | undefined }) {
  return (
    <>
      {mergeSegments(line.text, tokens, line.emphasis).map((s, i) => (
        <span
          key={i}
          className={cn(s.emphasis && WORD_TINT[line.kind], s.italic && "italic")}
          style={s.color ? { color: s.color } : undefined}
        >
          {s.text}
        </span>
      ))}
      {line.noNewline && <NoNewline />}
    </>
  );
}

function NoNewline() {
  return (
    <Tooltip content={t("diff.noNewline")} side="top">
      <span
        role="img"
        aria-label={t("diff.noNewline")}
        className="ml-2 inline-flex align-middle text-fg-muted"
      >
        <CircleSlash2 size={12} strokeWidth={1.75} aria-hidden />
      </span>
    </Tooltip>
  );
}

function UnifiedLine({
  cell,
  columns,
  digits,
  tokens,
  select,
}: {
  cell: LineCell;
  columns: Side[];
  digits: number;
  tokens: HunkTokens | undefined;
  select: LineSelect;
}) {
  const { line } = cell;
  const selected = select.check === "on";
  return (
    <div
      className={cn(
        "group/line flex h-full",
        LINE_TINT[line.kind],
        selected && SELECTED_TINT[line.kind],
      )}
    >
      <Gutter
        numbers={columns.map((side) => (side === "old" ? line.oldLine : line.newLine))}
        kind={line.kind}
        digits={digits}
        check={select.check}
        selectKey={select.key}
        className={cn(
          "sticky left-0 z-1",
          (selected ? SELECTED_GUTTER_TINT : GUTTER_TINT)[line.kind],
        )}
      />
      <div className="pr-4 whitespace-pre" data-selectable>
        <Code line={line} tokens={tokens?.[cell.side][cell.index]} />
      </div>
    </div>
  );
}

function SplitCell({
  cell,
  digits,
  tokens,
  select,
}: {
  cell: LineCell | null;
  digits: number;
  tokens: HunkTokens | undefined;
  select: LineSelect;
}) {
  if (!cell) return <div className={cn("min-w-0 flex-1 basis-0", HATCH)} />;
  const { line, side } = cell;
  return (
    <div
      className={cn(
        "group/line flex min-w-0 flex-1 basis-0",
        LINE_TINT[line.kind],
        select.check === "on" && SELECTED_TINT[line.kind],
      )}
    >
      <Gutter
        numbers={[side === "old" ? line.oldLine : line.newLine]}
        kind={line.kind}
        digits={digits}
        check={select.check}
        selectKey={select.key}
      />
      <div className="min-w-0 flex-1 overflow-hidden">
        <div className={cn("pr-4 whitespace-pre", SIDE_SHIFT[side])} data-selectable>
          <Code line={line} tokens={tokens?.[side][cell.index]} />
        </div>
      </div>
    </div>
  );
}

/** Spans the visible width (not the scroll width) so its content never scrolls away. */
const STICKY_ROW =
  "sticky left-0 flex h-full w-(--diff-viewport-w) max-w-full min-w-0 items-center";

function HunkHeader({
  hunk,
  columns,
  digits,
  check,
  actions,
}: {
  hunk: Hunk;
  columns: Side[];
  digits: number;
  check: Check | undefined;
  actions: ReactNode;
}) {
  return (
    <div className="h-full bg-(--diff-hunk-bg)">
      <div className={cn(STICKY_ROW, "pr-2")}>
        <Gutter numbers={columns.map(() => null)} kind="context" digits={digits} check={check} />
        <span className="min-w-0 truncate text-fg-muted" data-selectable>
          @@ -{hunk.oldStart},{hunk.oldLines} +{hunk.newStart},{hunk.newLines} @@
          {hunk.heading && <span className="text-fg-secondary"> {hunk.heading}</span>}
        </span>
        {actions && (
          <span className="ml-auto flex shrink-0 items-center gap-1 pl-2 font-ui">{actions}</span>
        )}
      </div>
    </div>
  );
}

function GapRow({
  count,
  columns,
  digits,
  check,
  onExpand,
}: {
  count: number;
  columns: Side[];
  digits: number;
  check: Check | undefined;
  onExpand: (() => void) | undefined;
}) {
  const Icon = onExpand ? UnfoldVertical : Ellipsis;
  const content = (
    <span className={STICKY_ROW}>
      <span className="grid shrink-0 place-items-center">
        <Gutter
          numbers={columns.map(() => null)}
          kind="context"
          digits={digits}
          check={check}
          className="invisible col-start-1 row-start-1"
        />
        <Icon size={14} strokeWidth={1.75} aria-hidden className="col-start-1 row-start-1" />
      </span>
      <span className="truncate font-ui text-small">
        {count === 1
          ? t("diff.unchangedLine")
          : t("diff.unchangedLines", { count: count.toLocaleString() })}
      </span>
    </span>
  );
  const base = "block h-full w-full bg-panel text-left text-fg-muted";
  return onExpand ? (
    <button
      type="button"
      onClick={onExpand}
      className={cn(
        base,
        "transition-colors duration-(--dur-fast) hover:bg-[linear-gradient(var(--bg-hover),var(--bg-hover))] hover:text-fg-secondary",
        INSET_FOCUS,
      )}
    >
      {content}
    </button>
  ) : (
    <div className={base}>{content}</div>
  );
}

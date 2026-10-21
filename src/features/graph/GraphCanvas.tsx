import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from "react";

import { drawGraph, readColors, type DrawInput, type DrawRow, type GraphColors } from "./draw";
import type { GraphMetrics } from "./geometry";
import type { SegmentIndex } from "./segment-index";

interface GraphCanvasProps {
  /** The scrolling element the rows live in. */
  scrollRef: RefObject<HTMLElement | null>;
  /** Stream rows (commits). */
  rowCount: number;
  row: (index: number) => DrawRow | undefined;
  segments: SegmentIndex;
  /** Rows shown above commit row 0 (the uncommitted-changes row). */
  offsetRows: number;
  width: number;
  metrics: GraphMetrics;
  /** Where to draw the uncommitted-changes dot, if shown. */
  pseudoRow: { lane: number; connect: boolean } | null;
  /** A first-parent path to underline (hovered commit). */
  highlight?: DrawInput["highlight"];
}

/** Re-reads colours when the theme attribute on <html> changes. */
function useGraphColors(): GraphColors {
  const [colors, setColors] = useState<GraphColors>(readColors);
  useEffect(() => {
    const observer = new MutationObserver(() => setColors(readColors()));
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-theme"],
    });
    return () => observer.disconnect();
  }, []);
  return colors;
}

/**
 * Canvas pinned to the viewport of `scrollRef` (place it in a sticky, zero-height wrapper at
 * the top of the scroll content). Draws only the visible rows, at device pixel ratio.
 */
export function GraphCanvas({
  scrollRef,
  rowCount,
  row,
  segments,
  offsetRows,
  width,
  metrics,
  pseudoRow,
  highlight = null,
}: GraphCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const colors = useGraphColors();
  const [height, setHeight] = useState(0);
  const draw = useRef<() => void>(() => {});

  // The latest draw function, used by scroll and resize handlers; refreshed after every
  // render (data, width or theme changes) and called right away.
  useLayoutEffect(() => {
    draw.current = () => {
      const canvas = canvasRef.current;
      const scroller = scrollRef.current;
      if (!canvas || !scroller) return;
      const dpr = window.devicePixelRatio || 1;
      const h = scroller.clientHeight;
      if (canvas.width !== Math.round(width * dpr) || canvas.height !== Math.round(h * dpr)) {
        canvas.width = Math.round(width * dpr);
        canvas.height = Math.round(h * dpr);
      }
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, width, h);
      const rh = metrics.rowHeight;
      const scrollTop = scroller.scrollTop;
      // Visible stream rows, with a row of overscan each side for curves crossing edges.
      const first = Math.max(0, Math.floor(scrollTop / rh) - offsetRows - 1);
      const last = Math.min(rowCount - 1, Math.ceil((scrollTop + h) / rh) - offsetRows + 1);
      const originY = offsetRows * rh - scrollTop;
      drawGraph(
        ctx,
        {
          row,
          first,
          last,
          segments: last >= first ? segments.query(first * 2, (last + 1) * 2) : [],
          originY,
          width,
          pseudoRow: pseudoRow && { ...pseudoRow, y: originY - rh / 2 },
          highlight,
        },
        metrics,
        colors,
      );
    };
    draw.current();
  });

  useEffect(() => {
    const scroller = scrollRef.current;
    if (!scroller) return;
    let frame = 0;
    const onScroll = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => draw.current());
    };
    const resize = new ResizeObserver(() => {
      setHeight(scroller.clientHeight);
      draw.current();
    });
    scroller.addEventListener("scroll", onScroll, { passive: true });
    resize.observe(scroller);
    return () => {
      cancelAnimationFrame(frame);
      scroller.removeEventListener("scroll", onScroll);
      resize.disconnect();
    };
  }, [scrollRef]);

  return (
    <canvas
      ref={canvasRef}
      aria-hidden
      className="pointer-events-none absolute top-0 left-0"
      style={{ width, height }}
    />
  );
}

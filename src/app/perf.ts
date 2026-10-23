// Performance runs (ROADMAP Phase 10 A): with TYLIA_PERF=<file>, Tylia times opening the
// first repository, scrolls its history by script, writes a JSON report and quits. Works on
// every platform, unlike measuring over CDP (WebView2 only). Without it, marks are no-ops.

import { ipc } from "@/ipc";

import { boot } from "./boot";

export const perfEnabled = boot.perf;

/** Per repository: milliseconds since the page started loading, the first time each mark
 *  is reached (restored tabs load alongside the repository being measured). */
const marks = new Map<string, Record<string, number>>();
let ran = false;

export function perfMark(repo: string, name: string, at = performance.now()) {
  if (!perfEnabled) return;
  const own = marks.get(repo) ?? {};
  marks.set(repo, own);
  if (!(name in own)) own[name] = Math.round(at);
}

const nextFrame = () => new Promise<number>((resolve) => requestAnimationFrame(resolve));

/** Frame-to-frame times while `step` runs once per frame. */
async function frameTimes(frames: number, step: (frame: number) => void): Promise<number[]> {
  const times: number[] = [];
  let last = await nextFrame();
  for (let i = 0; i < frames; i++) {
    step(i);
    const now = await nextFrame();
    times.push(now - last);
    last = now;
  }
  return times;
}

function stats(times: number[], budget: number) {
  const sorted = [...times].sort((a, b) => a - b);
  const at = (q: number) => sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))]!;
  const round = (ms: number) => Math.round(ms * 10) / 10;
  return {
    frames: times.length,
    medianMs: round(at(0.5)),
    p95Ms: round(at(0.95)),
    maxMs: round(sorted[sorted.length - 1]!),
    /** Frames that took longer than one and a half refresh intervals. */
    slowFrames: times.filter((ms) => ms > budget * 1.5).length,
  };
}

/**
 * Runs once the history has fully rendered: scrolls `scroller` by script, times a status
 * refresh, and hands the report to Rust, which writes it and quits.
 */
export async function runPerf(repo: string, scroller: HTMLElement, rows: number) {
  if (!perfEnabled || ran) return;
  ran = true;
  perfMark(repo, "scroll");
  await new Promise((resolve) => setTimeout(resolve, 1000));
  const idle = await frameTimes(60, () => {});
  const refresh = stats(idle, Infinity).medianMs;
  const page = scroller.clientHeight;
  const max = scroller.scrollHeight - page;
  // A fast wheel / trackpad scroll, page by page, and jumps across the whole history.
  scroller.scrollTop = 0;
  const wheel = await frameTimes(600, () => (scroller.scrollTop += 90));
  scroller.scrollTop = 0;
  const pages = await frameTimes(300, () => (scroller.scrollTop += page));
  const jumps = await frameTimes(
    120,
    (i) => (scroller.scrollTop = ((i * 7919) % 120) * (max / 120)),
  );
  const status: number[] = [];
  let changed: string | undefined;
  for (let i = 0; i < 5; i++) {
    const start = performance.now();
    changed = (await ipc.getStatus(repo)).entries.find((e) => e.unstaged)?.path;
    status.push(performance.now() - start);
  }
  // The diff of the first changed file (make a large one to check the 5k-line target).
  const diff: number[] = [];
  for (let i = 0; changed && i < 5; i++) {
    const start = performance.now();
    await ipc.getDiff(repo, {
      target: { kind: "unstaged" },
      path: changed,
      oldPath: null,
      context: 3,
      ignoreWhitespace: false,
      force: false,
    });
    diff.push(performance.now() - start);
  }
  await ipc.writePerfReport({
    platform: boot.platform,
    userAgent: navigator.userAgent,
    devicePixelRatio: window.devicePixelRatio,
    repo,
    rows,
    marks: marks.get(repo),
    refreshMs: refresh,
    scroll: {
      wheel: stats(wheel, refresh),
      pages: stats(pages, refresh),
      jumps: stats(jumps, refresh),
    },
    statusMs: stats(status, Infinity),
    diff: changed ? { path: changed, ms: stats(diff, Infinity) } : null,
  });
}

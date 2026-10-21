// A conflicted file shown as its conflict blocks: each block has "mine" and "theirs" (and
// the common ancestor in diff3 style) with Use mine / Use theirs / Use both. Unchanged runs
// between blocks collapse to a few lines of context.

import { ChevronsUpDown } from "lucide-react";
import { useEffect, useMemo, useState, type ReactNode } from "react";

import { highlightLines } from "@/features/diff/highlight";
import { detectLanguage } from "@/features/diff/language";
import type { Token } from "@/features/diff/segments";
import { useDocumentTheme } from "@/features/diff/useHighlights";
import { t } from "@/i18n";
import type { BlockResolution, ConflictFile, ConflictSegment } from "@/ipc";
import { Button } from "@/ui/Button";
import { cn } from "@/ui/cn";

/** Lines of context kept around a block when an unchanged run collapses. */
const CONTEXT = 3;

export interface SideNames {
  mine: string;
  theirs: string;
  useMine: string;
  useTheirs: string;
}

/** Where each segment's lines start in the file's displayed lines. */
function segmentOffsets(segments: ConflictSegment[]): number[] {
  const out: number[] = [];
  let n = 0;
  for (const seg of segments) {
    out.push(n);
    n +=
      seg.kind === "lines"
        ? seg.lines.length
        : seg.ours.length + (seg.base?.length ?? 0) + seg.theirs.length;
  }
  return out;
}

/** Syntax tokens for every displayed line, in order (plain text until they arrive). */
function useTokens(path: string, file: ConflictFile): Token[][] | null {
  const theme = useDocumentTheme();
  const lang = detectLanguage(path);
  const lines = useMemo(
    () =>
      file.segments.flatMap((s) =>
        s.kind === "lines" ? s.lines : [...s.ours, ...(s.base ?? []), ...s.theirs],
      ),
    [file],
  );
  const [result, setResult] = useState<{ key: string; tokens: Token[][] } | null>(null);
  const key = `${file.fingerprint}:${theme}`;
  useEffect(() => {
    if (!lang) return;
    let alive = true;
    highlightLines(lines, lang, theme)
      .then((tokens) => alive && setResult({ key, tokens }))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [lines, lang, theme, key]);
  return result?.key === key ? result.tokens : null;
}

function Line({
  number,
  text,
  tokens,
  className,
}: {
  number?: number;
  text: string;
  tokens: Token[] | undefined;
  className?: string;
}) {
  const usable = tokens && tokens.map((x) => x.content).join("") === text;
  return (
    <div className={cn("flex min-w-max leading-6", className)}>
      <span className="w-12 shrink-0 pr-3 text-right text-fg-muted select-none">{number}</span>
      <span className="pr-4 whitespace-pre">
        {usable
          ? tokens.map((tok, i) => (
              <span
                key={i}
                style={tok.color ? { color: tok.color } : undefined}
                className={cn(tok.italic && "italic")}
              >
                {tok.content}
              </span>
            ))
          : text || " "}
      </span>
    </div>
  );
}

function Side({
  label,
  detail,
  tone,
  children,
}: {
  label: string;
  detail: string;
  tone: "mine" | "theirs" | "base";
  children: ReactNode;
}) {
  return (
    <div
      className={cn(
        "border-l-2",
        tone === "mine" && "border-accent bg-[color-mix(in_srgb,var(--accent)_8%,transparent)]",
        tone === "theirs" &&
          "border-(--lane-6) bg-[color-mix(in_srgb,var(--lane-6)_9%,transparent)]",
        tone === "base" && "border-line-strong bg-hover",
      )}
    >
      <div className="flex items-baseline gap-2 px-3 pt-1.5 pb-0.5 font-ui text-caption">
        <span className="font-medium text-fg-secondary">{label}</span>
        {detail && <span className="truncate text-fg-muted">{detail}</span>}
      </div>
      <div className="pb-1.5">{children}</div>
    </div>
  );
}

export function ConflictBlocks({
  path,
  file,
  names,
  busy,
  onResolve,
}: {
  path: string;
  file: ConflictFile;
  names: SideNames;
  /** A resolution is being written: buttons wait. */
  busy: boolean;
  onResolve: (index: number, resolution: BlockResolution) => void;
}) {
  const tokens = useTokens(path, file);
  const [expanded, setExpanded] = useState<Set<number>>(new Set());
  const total = file.segments.filter((s) => s.kind === "conflict").length;

  // Where each segment's lines start in the highlighted lines.
  const offsets = useMemo(() => segmentOffsets(file.segments), [file]);
  const tokensFor = (segment: number, from: number, count: number) => {
    const start = offsets[segment]! + from;
    return tokens?.slice(start, start + count);
  };

  return (
    <div className="min-h-0 flex-1 overflow-auto bg-app py-2 font-code text-(length:--text-diff) text-fg">
      {file.segments.map((seg, i) => {
        if (seg.kind === "lines") {
          const toks = tokensFor(i, 0, seg.lines.length);
          const first = i === 0;
          const last = i === file.segments.length - 1;
          const keepHead = first ? 0 : CONTEXT;
          const keepTail = last ? 0 : CONTEXT;
          const collapsible = seg.lines.length > keepHead + keepTail + 1 && !expanded.has(i);
          const shown = (from: number, to: number) =>
            seg.lines
              .slice(from, to)
              .map((text, j) => (
                <Line
                  key={from + j}
                  number={seg.first + from + j}
                  text={text}
                  tokens={toks?.[from + j]}
                />
              ));
          if (!collapsible) return <div key={i}>{shown(0, seg.lines.length)}</div>;
          const hidden = seg.lines.length - keepHead - keepTail;
          return (
            <div key={i}>
              {shown(0, keepHead)}
              <button
                type="button"
                onClick={() => setExpanded(new Set(expanded).add(i))}
                className="my-0.5 flex h-6 w-full items-center gap-2 bg-panel pl-4 text-left font-ui text-small text-fg-muted focus-ring hover:bg-hover hover:text-fg-secondary"
              >
                <ChevronsUpDown size={14} strokeWidth={1.75} aria-hidden />
                {hidden === 1
                  ? t("diff.unchangedLine")
                  : t("diff.unchangedLines", { count: hidden })}
              </button>
              {shown(seg.lines.length - keepTail, seg.lines.length)}
            </div>
          );
        }
        const baseCount = seg.base?.length ?? 0;
        const ours = tokensFor(i, 0, seg.ours.length);
        const base = tokensFor(i, seg.ours.length, baseCount);
        const theirs = tokensFor(i, seg.ours.length + baseCount, seg.theirs.length);
        return (
          <section
            key={`c${seg.index}`}
            aria-label={t("blocks.label", { n: seg.index + 1, total })}
            className="mx-3 my-2 overflow-hidden rounded-menu border border-line"
          >
            <header className="flex flex-wrap items-center gap-2 border-b border-line-subtle bg-panel px-3 py-1.5 font-ui">
              <span className="text-small font-medium text-fg">
                {t("blocks.title", { n: seg.index + 1, total })}
              </span>
              <span className="text-small text-fg-muted">
                {t("blocks.line", { line: seg.first })}
              </span>
              <span className="flex-1" />
              <Button size="sm" disabled={busy} onClick={() => onResolve(seg.index, "ours")}>
                {names.useMine}
              </Button>
              <Button size="sm" disabled={busy} onClick={() => onResolve(seg.index, "theirs")}>
                {names.useTheirs}
              </Button>
              <Button size="sm" disabled={busy} onClick={() => onResolve(seg.index, "both")}>
                {t("blocks.useBoth")}
              </Button>
            </header>
            <Side label={names.mine} detail={seg.oursLabel} tone="mine">
              {seg.ours.length === 0 ? (
                <p className="px-4 font-ui text-small text-fg-muted italic">{t("blocks.empty")}</p>
              ) : (
                seg.ours.map((text, j) => <Line key={j} text={text} tokens={ours?.[j]} />)
              )}
            </Side>
            {seg.base && (
              <Side label={t("blocks.base")} detail="" tone="base">
                {seg.base.map((text, j) => (
                  <Line key={j} text={text} tokens={base?.[j]} className="text-fg-secondary" />
                ))}
              </Side>
            )}
            <Side label={names.theirs} detail={seg.theirsLabel} tone="theirs">
              {seg.theirs.length === 0 ? (
                <p className="px-4 font-ui text-small text-fg-muted italic">{t("blocks.empty")}</p>
              ) : (
                seg.theirs.map((text, j) => <Line key={j} text={text} tokens={theirs?.[j]} />)
              )}
            </Side>
          </section>
        );
      })}
    </div>
  );
}

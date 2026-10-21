// Diff viewer on the dev-only component gallery; sample content is not localized.

import { useMemo, useState } from "react";

import { Button } from "@/ui/Button";
import { sampleDiffs, type SampleDiffName } from "@/ui/gallery/sample-diff";
import { SegmentedControl } from "@/ui/SegmentedControl";
import { toast } from "@/ui/Toast";

import { DiffView, type DiffMode } from "./DiffView";
import { countByHunk } from "./selection";

type SampleState = "loaded" | "loading" | "error";

const sampleError = {
  message: "Couldn’t load the diff for src/features/history/format.ts.",
  command: "git diff --no-color --no-ext-diff -M -U3 -- src/features/history/format.ts",
  stderr: "fatal: unable to read 3f9c2e1d: No such file or directory",
};

export function DiffSection() {
  const [name, setName] = useState<SampleDiffName>("TypeScript");
  const [state, setState] = useState<SampleState>("loaded");
  const [mode, setMode] = useState<DiffMode>("unified");
  const diff = useMemo(() => sampleDiffs[name](), [name]);
  const [selection, setSelection] = useState<Set<string>>(() => new Set());
  const selectedPerHunk = useMemo(() => countByHunk(selection), [selection]);
  // Keys name lines of one diff; another sample starts with nothing selected.
  const pickSample = (next: SampleDiffName) => {
    setName(next);
    setSelection(new Set());
  };
  return (
    <section
      className="flex flex-col gap-3 border-b border-line-subtle py-6 last:border-b-0"
      data-testid="diff-section"
    >
      <h2 className="text-title font-semibold text-fg">Diff viewer</h2>
      <div className="flex flex-wrap items-center gap-3">
        <SegmentedControl
          aria-label="Sample diff"
          value={name}
          onValueChange={pickSample}
          segments={Object.keys(sampleDiffs).map((value) => ({
            value: value as SampleDiffName,
            label: value,
          }))}
        />
        <SegmentedControl
          aria-label="State"
          value={state}
          onValueChange={setState}
          segments={[
            { value: "loaded", label: "Loaded" },
            { value: "loading", label: "Loading" },
            { value: "error", label: "Error" },
          ]}
        />
        <span className="text-small text-fg-secondary tabular-nums" data-testid="diff-selected">
          {selection.size === 1 ? "1 line selected" : `${selection.size} lines selected`}
        </span>
      </div>
      <DiffView
        className="h-105 rounded-menu border border-line-subtle"
        diff={state === "loading" ? undefined : diff}
        loading={state === "loading"}
        error={state === "error" ? sampleError : null}
        mode={mode}
        onModeChange={setMode}
        onExpandContext={() => toast({ kind: "success", title: "Requested full context" })}
        onLoadAnyway={() => pickSample("20k lines")}
        selection={selection}
        onSelectionChange={setSelection}
        renderHunkActions={(_, i) => {
          const count = selectedPerHunk.get(i) ?? 0;
          return (
            <Button size="sm" variant="ghost">
              {count === 0 ? "Stage hunk" : count === 1 ? "Stage 1 line" : `Stage ${count} lines`}
            </Button>
          );
        }}
      />
    </section>
  );
}

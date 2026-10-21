// The interactive rebase editor: the commits after a base, oldest first (as Git applies
// them), each with an action; drag the handle or Alt+↑/↓ to reorder; the result on the right.

import { useQuery } from "@tanstack/react-query";
import { CornerLeftUp, GripVertical, ListOrdered, TriangleAlert } from "lucide-react";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent,
  type ReactNode,
} from "react";

import { shortHash } from "@/app/format";
import { useBranching } from "@/features/branching/useBranching";
import { plural, t, type MessageKey } from "@/i18n";
import { ipc, isIpcError, type TodoCommit } from "@/ipc";
import { Badge } from "@/ui/Badge";
import { Button } from "@/ui/Button";
import { cn } from "@/ui/cn";
import { ConfirmDialog } from "@/ui/ConfirmDialog";
import { Dialog } from "@/ui/Dialog";
import { ErrorPanel } from "@/ui/ErrorPanel";
import { Select } from "@/ui/Select";
import { SkeletonRows } from "@/ui/Skeleton";
import { Textarea } from "@/ui/Textarea";
import { Tooltip } from "@/ui/Tooltip";

import {
  ACTION_KEYS,
  ACTIONS,
  analyze,
  groupMessage,
  initialState,
  moveRow,
  toPlan,
  type ActionKind,
  type Analysis,
  type PlanState,
  type RowError,
} from "./plan";

const ACTION_OPTIONS = ACTIONS.map((a) => ({
  value: a,
  label: t(`rebase.action.${a}` as MessageKey),
  hint: t(`rebase.hint.${a}` as MessageKey),
}));

const ERRORS: Record<RowError, MessageKey> = {
  noTarget: "rebase.noTarget",
  emptyMessage: "rebase.emptyMessage",
};

interface RebaseEditorProps {
  repo: string;
  base: string;
  baseLabel: string;
  /** The checked-out branch ("HEAD" when detached). */
  current: string;
  onClose: () => void;
}

export function RebaseEditor({ repo, base, baseLabel, current, onClose }: RebaseEditorProps) {
  const todo = useQuery({
    queryKey: ["rebase-todo", repo, base],
    queryFn: () => ipc.rebaseTodo(repo, base),
    retry: false,
    gcTime: 0,
  });
  const b = useBranching(repo);
  const commits = todo.data?.commits;
  const byOid = useMemo(() => new Map((commits ?? []).map((c) => [c.oid, c])), [commits]);
  // The plan as edited; Git's own todo until the first change.
  const [edited, setEdited] = useState<PlanState | null>(null);
  const state = useMemo(() => edited ?? initialState(commits ?? []), [edited, commits]);
  const update = (f: (s: PlanState) => PlanState) =>
    setEdited((s) => f(s ?? initialState(commits ?? [])));
  const [confirming, setConfirming] = useState(false);
  const [running, setRunning] = useState(false);
  const analysis = useMemo(() => analyze(state, commits ?? [], byOid), [state, commits, byOid]);

  const data = todo.data;
  const branch = data?.branch ?? current;
  const changed = analysis.firstChange < state.rows.length;
  const blocked = analysis.errors.size > 0 || analysis.allDropped;
  const rewritten = analysis.result.filter((r) => r.rewritten).length;
  const edits = analysis.result.filter((r) => r.edit).length;
  const err = todo.error;

  const start = async () => {
    if (!data) return;
    setRunning(true);
    const ran = await b.rebaseInteractive(data.base, toPlan(state, analysis, byOid));
    setRunning(false);
    if (ran) onClose();
  };

  return (
    <>
      <Dialog
        open
        onOpenChange={(o) => !o && !running && onClose()}
        width="xl"
        icon={
          <span className="flex size-8 items-center justify-center rounded-full bg-selected text-accent">
            <ListOrdered size={16} strokeWidth={1.75} aria-hidden />
          </span>
        }
        title={t("rebase.title", { branch })}
        description={t("rebase.description", { hash: baseLabel })}
        footer={
          <>
            {data && (
              <span className="mr-auto min-w-0 truncate text-small text-fg-secondary">
                {analysis.allDropped
                  ? t("rebase.allDropped")
                  : changed
                    ? t("rebase.keys")
                    : t("rebase.noChanges")}
              </span>
            )}
            <Button size="lg" onClick={onClose} disabled={running}>
              {t("common.cancel")}
            </Button>
            {data && (
              <Button
                size="lg"
                variant="primary"
                disabled={!changed || blocked}
                loading={running}
                onClick={() => setConfirming(true)}
              >
                {t("rebase.start")}
              </Button>
            )}
          </>
        }
      >
        {data ? (
          <div className="flex gap-4">
            <TodoList
              state={state}
              setState={update}
              analysis={analysis}
              byOid={byOid}
              disabled={running}
            />
            <Preview
              analysis={analysis}
              before={data.commits.length}
              baseLabel={baseLabel}
              branch={branch}
            />
          </div>
        ) : err && isIpcError(err) && err.kind === "invalidInput" ? (
          // Tylia's own refusal (a merge in the range, not an ancestor): a sentence saying why.
          <p role="alert" className="flex gap-2 text-fg">
            <TriangleAlert
              size={16}
              strokeWidth={1.75}
              aria-hidden
              className="mt-0.5 shrink-0 text-warning"
            />
            {err.message}
          </p>
        ) : err ? (
          <div className="flex flex-col gap-2">
            <p className="font-medium">{t("rebase.loadFailed")}</p>
            <ErrorPanel
              message={isIpcError(err) ? err.message : String(err)}
              command={isIpcError(err) ? err.command : null}
              stderr={isIpcError(err) ? err.stderr : null}
            />
          </div>
        ) : (
          <SkeletonRows count={4} />
        )}
      </Dialog>
      {confirming && (
        <ConfirmDialog
          open
          onOpenChange={(o) => !o && setConfirming(false)}
          title={t("rebase.confirmTitle", { branch })}
          consequence={
            <>
              {t("rebase.confirmBody", { commits: plural("count.commits", rewritten) })}
              {analysis.dropped > 0 && <> {plural("rebase.confirmDropped", analysis.dropped)}</>}
              {edits > 0 && <> {t("rebase.confirmEdit")}</>}
            </>
          }
          confirmLabel={t("rebase.confirm")}
          destructive={analysis.pushedRewritten > 0}
          onConfirm={() => void start()}
        >
          {analysis.pushedRewritten > 0 && (
            <p className="flex gap-2 rounded-control bg-[color-mix(in_srgb,var(--warning)_10%,transparent)] px-3 py-2 text-fg">
              <TriangleAlert
                size={16}
                strokeWidth={1.75}
                aria-hidden
                className="mt-0.5 shrink-0 text-warning"
              />
              {plural("rebase.confirmPushed", analysis.pushedRewritten)}
            </p>
          )}
        </ConfirmDialog>
      )}
    </>
  );
}

/** Pointer travel before a press on a handle becomes a drag. */
const DRAG_THRESHOLD = 4;

function TodoList({
  state,
  setState,
  analysis,
  byOid,
  disabled,
}: {
  state: PlanState;
  setState: (update: (s: PlanState) => PlanState) => void;
  analysis: Analysis;
  byOid: Map<string, TodoCommit>;
  disabled: boolean;
}) {
  const listRef = useRef<HTMLOListElement>(null);
  const [dragging, setDragging] = useState<string | null>(null);
  const press = useRef<{ oid: string; y: number } | null>(null);
  // A row to focus after the next render (keyboard reordering moves it in the DOM).
  const focusAfter = useRef<string | null>(null);
  const focusRow = (oid: string) =>
    listRef.current?.querySelector<HTMLElement>(`[data-row="${oid}"]`)?.focus();

  // Start on the first row, so the row keys work at once.
  useEffect(() => {
    listRef.current?.querySelector<HTMLElement>("[data-row]")?.focus();
  }, []);

  useEffect(() => {
    if (!focusAfter.current) return;
    focusRow(focusAfter.current);
    focusAfter.current = null;
  });

  const setAction = (i: number, action: ActionKind) =>
    setState((s) => ({
      ...s,
      rows: s.rows.map((r, j) => (j === i ? { ...r, action } : r)),
    }));
  const move = (from: number, to: number) =>
    setState((s) => ({ ...s, rows: moveRow(s.rows, from, to) }));

  const onRowKey = (e: KeyboardEvent<HTMLDivElement>, i: number) => {
    if (e.target !== e.currentTarget || disabled) return;
    const oid = state.rows[i]!.oid;
    const action = ACTION_KEYS[e.key.toLowerCase()];
    if (action && !e.altKey && !e.ctrlKey && !e.metaKey) {
      e.preventDefault();
      setAction(i, action);
    } else if (e.key === "ArrowUp" || e.key === "ArrowDown") {
      e.preventDefault();
      const to = e.key === "ArrowUp" ? i - 1 : i + 1;
      if (to < 0 || to >= state.rows.length) return;
      if (e.altKey) {
        move(i, to);
        focusAfter.current = oid;
      } else {
        focusRow(state.rows[to]!.oid);
      }
    }
  };

  // Drag a handle: the row follows the pointer, moving past each row's middle.
  const onHandleDown = (e: PointerEvent<HTMLButtonElement>, oid: string) => {
    if (e.button !== 0 || disabled) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    press.current = { oid, y: e.clientY };
  };
  const onHandleMove = (e: PointerEvent<HTMLButtonElement>) => {
    const p = press.current;
    if (!p) return;
    if (!dragging && Math.abs(e.clientY - p.y) < DRAG_THRESHOLD) return;
    if (!dragging) setDragging(p.oid);
    const items = [...(listRef.current?.querySelectorAll<HTMLElement>("[data-item]") ?? [])];
    const from = items.findIndex((el) => el.dataset.item === p.oid);
    if (from < 0) return;
    // The index the dragged row belongs at: after every other row whose middle is above.
    let to = 0;
    items.forEach((el, j) => {
      if (j === from) return;
      const r = el.getBoundingClientRect();
      if (e.clientY > r.top + r.height / 2) to++;
    });
    if (to !== from) move(from, to);
  };
  const onHandleUp = () => {
    press.current = null;
    setDragging(null);
  };

  return (
    <div className="min-w-0 flex-1">
      <div className="mb-1 flex h-6 items-center justify-between text-small text-fg-secondary">
        <span>{t("rebase.order")}</span>
      </div>
      <ol ref={listRef} aria-label={t("rebase.listLabel")} className="flex flex-col gap-0.5">
        {state.rows.map((row, i) => {
          const commit = byOid.get(row.oid)!;
          const error = analysis.errors.get(i);
          const folds = row.action === "squash" || row.action === "fixup";
          const dropped = row.action === "drop";
          const short = shortHash(row.oid);
          const groupTarget = [...analysis.messageRow].find(([, at]) => at === i)?.[0];
          return (
            <li
              key={row.oid}
              data-item={row.oid}
              className={cn("rounded-control", dragging === row.oid && "bg-selected shadow-float")}
            >
              <div
                data-row={row.oid}
                tabIndex={0}
                role="group"
                aria-keyshortcuts="P R E S F D Alt+ArrowUp Alt+ArrowDown"
                aria-label={`${t(`rebase.action.${row.action}` as MessageKey)} ${short} ${commit.subject}`}
                onKeyDown={(e) => onRowKey(e, i)}
                className={cn(
                  "flex h-9 items-center gap-2 rounded-control pr-2 pl-1 outline-none focus-ring",
                  dragging !== row.oid && "hover:bg-hover",
                )}
              >
                <Tooltip content={t("rebase.dragHandle")}>
                  <button
                    type="button"
                    tabIndex={-1}
                    aria-label={t("rebase.dragHandle")}
                    disabled={disabled}
                    onPointerDown={(e) => onHandleDown(e, row.oid)}
                    onPointerMove={onHandleMove}
                    onPointerUp={onHandleUp}
                    onPointerCancel={onHandleUp}
                    className={cn(
                      "flex h-7 w-5 shrink-0 touch-none items-center justify-center rounded-control text-fg-muted hover:text-fg",
                      dragging === row.oid ? "cursor-grabbing" : "cursor-grab",
                    )}
                  >
                    <GripVertical size={14} strokeWidth={1.75} aria-hidden />
                  </button>
                </Tooltip>
                <div className="w-24 shrink-0">
                  <Select
                    value={row.action}
                    onValueChange={(v) => setAction(i, v as ActionKind)}
                    options={ACTION_OPTIONS}
                    disabled={disabled}
                    aria-label={t("rebase.actionFor", { hash: short })}
                  />
                </div>
                {folds && (
                  <CornerLeftUp
                    size={14}
                    strokeWidth={1.75}
                    aria-hidden
                    className="shrink-0 text-fg-muted"
                  />
                )}
                <code className="shrink-0 text-small text-fg-muted">{short}</code>
                <span
                  title={commit.subject}
                  className={cn(
                    "min-w-0 flex-1 truncate",
                    dropped ? "text-fg-muted line-through" : "text-fg",
                    folds && "text-fg-secondary",
                  )}
                >
                  {commit.subject}
                </span>
                {commit.pushed && (
                  <Tooltip content={t("rebase.pushedHint")}>
                    <span className="inline-flex">
                      <Badge tone="warning">{t("rebase.pushed")}</Badge>
                    </span>
                  </Tooltip>
                )}
              </div>
              {row.action === "reword" && (
                <MessageField
                  label={t("rebase.messageFor", { hash: short })}
                  value={row.message ?? commit.message}
                  disabled={disabled}
                  onChange={(message) =>
                    setState((s) => ({
                      ...s,
                      rows: s.rows.map((r) => (r.oid === row.oid ? { ...r, message } : r)),
                    }))
                  }
                />
              )}
              {groupTarget !== undefined && (
                <MessageField
                  label={t("rebase.combinedMessage")}
                  value={groupMessage(state, groupTarget, byOid)}
                  disabled={disabled}
                  onChange={(message) =>
                    setState((s) => ({
                      ...s,
                      groupMessages: {
                        ...s.groupMessages,
                        [s.rows[groupTarget]!.oid]: message,
                      },
                    }))
                  }
                />
              )}
              {error && (
                <p role="alert" className="pb-1 pl-34 text-small text-danger">
                  {t(ERRORS[error])}
                </p>
              )}
            </li>
          );
        })}
      </ol>
    </div>
  );
}

function MessageField({
  label,
  value,
  disabled,
  onChange,
}: {
  label: string;
  value: string;
  disabled: boolean;
  onChange: (value: string) => void;
}) {
  return (
    <label className="block pt-0.5 pr-2 pb-2 pl-34">
      <span className="mb-1 block text-small text-fg-secondary">{label}</span>
      <Textarea
        value={value}
        rows={2}
        maxHeight={160}
        disabled={disabled}
        spellCheck
        className="w-full"
        onChange={(e) => onChange(e.target.value)}
      />
    </label>
  );
}

/** The resulting line of commits, oldest first like the list, from the base to the tip. */
function Preview({
  analysis,
  before,
  baseLabel,
  branch,
}: {
  analysis: Analysis;
  before: number;
  baseLabel: string;
  branch: string;
}) {
  const { result } = analysis;
  const rewritten = result.filter((r) => r.rewritten).length;
  return (
    <aside
      aria-label={t("rebase.result")}
      className="flex w-64 shrink-0 flex-col self-start rounded-menu border border-line-subtle bg-panel"
    >
      <div className="flex h-9 items-center justify-between border-b border-line-subtle px-3">
        <span className="font-medium">{t("rebase.result")}</span>
        <span className="text-small text-fg-secondary tabular-nums" data-testid="rebase-summary">
          {t("rebase.summary", {
            before: plural("count.commits", before),
            after: result.length.toLocaleString("en"),
          })}
        </span>
      </div>
      <ol className="flex flex-col px-3 py-2">
        <Node kind="base" first last={result.length === 0}>
          <span className="text-fg-secondary">{t("rebase.base")}</span>
          <code className="text-small text-fg-muted">{baseLabel}</code>
        </Node>
        {result.map((r, i) => (
          <Node
            key={r.oid}
            kind={r.rewritten ? "rewritten" : "kept"}
            last={i === result.length - 1}
          >
            <span className="flex min-w-0 flex-col">
              <span className="truncate" title={r.subject}>
                {r.subject}
              </span>
              <span className="flex flex-wrap gap-1 pt-0.5">
                {r.folded > 0 && <Badge>{plural("rebase.folded", r.folded)}</Badge>}
                {r.newMessage && <Badge>{t("rebase.newMessage")}</Badge>}
                {r.edit && <Badge tone="warning">{t("rebase.stopsHere")}</Badge>}
                {!r.rewritten && <Badge>{t("rebase.unchanged")}</Badge>}
              </span>
            </span>
            {i === result.length - 1 && (
              <span className="ml-auto shrink-0 self-start">
                <Badge tone="accent">{branch}</Badge>
              </span>
            )}
          </Node>
        ))}
      </ol>
      {rewritten > 0 && (
        <div className="flex flex-col gap-0.5 border-t border-line-subtle px-3 py-2 text-small text-fg-secondary">
          <span>{plural("rebase.newIds", rewritten)}</span>
          {analysis.pushedRewritten > 0 && (
            <span className="flex items-center gap-1 text-warning">
              <TriangleAlert size={14} strokeWidth={1.75} aria-hidden />
              {plural("rebase.pushedCount", analysis.pushedRewritten)}
            </span>
          )}
        </div>
      )}
    </aside>
  );
}

/** One commit of the preview: a dot on a vertical line. */
function Node({
  kind,
  first = false,
  last = false,
  children,
}: {
  kind: "base" | "kept" | "rewritten";
  first?: boolean;
  last?: boolean;
  children: ReactNode;
}) {
  return (
    <li className="relative flex min-h-8 items-start gap-2 py-1 pl-5">
      {!first && <span aria-hidden className="absolute top-0 left-1.5 h-2.5 w-px bg-line-strong" />}
      {!last && (
        <span aria-hidden className="absolute top-2.5 bottom-0 left-1.5 w-px bg-line-strong" />
      )}
      <span
        aria-hidden
        className={cn(
          "absolute top-1.5 left-0 size-3 rounded-full border-2",
          kind === "base" && "border-line-strong bg-panel",
          kind === "kept" && "border-fg-muted bg-fg-muted",
          kind === "rewritten" && "border-accent bg-accent",
        )}
      />
      <span className="flex min-w-0 flex-1 items-start gap-2">{children}</span>
    </li>
  );
}

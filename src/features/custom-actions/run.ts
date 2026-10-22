// Running a custom action: Rust builds the command line from the action and where it was
// started (`custom_action.rs`); this asks first when the action says so, then shows its
// output (CustomActionDialogs) or just starts it.

import { create } from "zustand";

import { nextOperationId } from "@/features/remote/operations";
import { t } from "@/i18n";
import { ipc, isIpcError, type ActionContext, type ActionRun, type CustomAction } from "@/ipc";
import { toast } from "@/ui/Toast";

export type ActionOutput =
  | { status: "running"; operationId: number }
  | { status: "done"; run: ActionRun }
  | { status: "failed"; message: string; cancelled: boolean };

interface ActionRunState {
  /** Waiting for "Run" in the confirmation. */
  confirming: { action: CustomAction; context: ActionContext; command: string[] } | null;
  /** The output panel's action (one at a time). */
  output: { action: CustomAction; command: string[]; result: ActionOutput } | null;
  closeConfirm(): void;
  closeOutput(): void;
}

export const useActionRun = create<ActionRunState>((set) => ({
  confirming: null,
  output: null,
  closeConfirm: () => set({ confirming: null }),
  closeOutput: () => set({ output: null }),
}));

function failed(action: CustomAction, err: unknown) {
  toast({
    kind: "error",
    title: t("customActions.failed", { name: action.name }),
    description: isIpcError(err) && err.kind === "invalidInput" ? err.message : undefined,
    error: isIpcError(err) ? err : { message: String(err) },
  });
}

/** Runs `action` for `context` (asking first if it should). */
export async function startCustomAction(action: CustomAction, context: ActionContext) {
  let command: string[];
  try {
    command = await ipc.customActionCommand(action, context);
  } catch (err) {
    failed(action, err);
    return;
  }
  if (action.confirm) useActionRun.setState({ confirming: { action, context, command } });
  else await runConfirmed(action, context, command);
}

export async function runConfirmed(
  action: CustomAction,
  context: ActionContext,
  command: string[],
) {
  const operationId = nextOperationId();
  const show = (result: ActionOutput) =>
    useActionRun.setState({ output: { action, command, result } });
  if (action.showOutput) show({ status: "running", operationId });
  try {
    const run = await ipc.runCustomAction(action, context, operationId);
    if (action.showOutput) {
      // Unless the panel was closed or another action took it meanwhile.
      const current = useActionRun.getState().output;
      if (current?.result.status === "running" && current.result.operationId === operationId) {
        show({ status: "done", run });
      } else if (run.code !== 0) {
        toast({
          kind: "error",
          title: t("customActions.exitCode", { name: action.name, code: String(run.code) }),
        });
      }
    } else {
      toast({ kind: "success", title: t("customActions.started", { name: action.name }) });
    }
  } catch (err) {
    const cancelled = isIpcError(err) && err.kind === "cancelled";
    const current = useActionRun.getState().output;
    if (action.showOutput && current?.result.status === "running") {
      show({
        status: "failed",
        message: isIpcError(err) ? err.message : String(err),
        cancelled,
      });
    } else if (!cancelled) {
      failed(action, err);
    }
  }
}

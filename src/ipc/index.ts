import type { Backend } from "./backend";

export { isIpcError } from "./backend";
export type { Unlisten } from "./backend";
export type { AskpassKind } from "./bindings/AskpassKind";
export type { AskpassPrompt } from "./bindings/AskpassPrompt";
export type { Blame } from "./bindings/Blame";
export type { BlameCommit } from "./bindings/BlameCommit";
export type { BlameLine } from "./bindings/BlameLine";
export type { BlockOutcome } from "./bindings/BlockOutcome";
export type { BlockResolution } from "./bindings/BlockResolution";
export type { BootInfo } from "./bindings/BootInfo";
export type { ConfigScope } from "./bindings/ConfigScope";
export type { ConfigValue } from "./bindings/ConfigValue";
export type { Branch } from "./bindings/Branch";
export type { ChangedFile } from "./bindings/ChangedFile";
export type { CheckoutOutcome } from "./bindings/CheckoutOutcome";
export type { CheckoutRequest } from "./bindings/CheckoutRequest";
export type { CheckoutTarget } from "./bindings/CheckoutTarget";
export type { CloneRequest } from "./bindings/CloneRequest";
export type { CommitDetails } from "./bindings/CommitDetails";
export type { ConflictFile } from "./bindings/ConflictFile";
export type { ConflictSegment } from "./bindings/ConflictSegment";
export type { ConflictSide } from "./bindings/ConflictSide";
export type { DateFormat } from "./bindings/DateFormat";
export type { Density } from "./bindings/Density";
export type { DiffRequest } from "./bindings/DiffRequest";
export type { DiffTarget } from "./bindings/DiffTarget";
export type { Distribution } from "./bindings/Distribution";
export type { DownloadProgress } from "./bindings/DownloadProgress";
export type { Edge } from "./bindings/Edge";
export type { FetchRequest } from "./bindings/FetchRequest";
export type { FastForward } from "./bindings/FastForward";
export type { FileDiff } from "./bindings/FileDiff";
export type { FileHistoryEntry } from "./bindings/FileHistoryEntry";
export type { FileHistoryPage } from "./bindings/FileHistoryPage";
export type { FileStatus } from "./bindings/FileStatus";
export type { FlowConfig } from "./bindings/FlowConfig";
export type { FlowFinished } from "./bindings/FlowFinished";
export type { FlowKind } from "./bindings/FlowKind";
export type { FlowState } from "./bindings/FlowState";
export type { GitInfo } from "./bindings/GitInfo";
export type { GitVersion } from "./bindings/GitVersion";
export type { GraphCell } from "./bindings/GraphCell";
export type { HistoryEvent } from "./bindings/HistoryEvent";
export type { HistoryRow } from "./bindings/HistoryRow";
export type { IntegrateOutcome } from "./bindings/IntegrateOutcome";
export type { IpcError } from "./bindings/IpcError";
export type { LfsStatus } from "./bindings/LfsStatus";
export type { LineAction } from "./bindings/LineAction";
export type { LinesRequest } from "./bindings/LinesRequest";
export type { Hunk } from "./bindings/Hunk";
export type { LogOptions } from "./bindings/LogOptions";
export type { LogScope } from "./bindings/LogScope";
export type { OperationKind } from "./bindings/OperationKind";
export type { PathKind } from "./bindings/PathKind";
export type { PathSuggestion } from "./bindings/PathSuggestion";
export type { PathSuggestions } from "./bindings/PathSuggestions";
export type { Progress } from "./bindings/Progress";
export type { PullMode } from "./bindings/PullMode";
export type { PullOutcome } from "./bindings/PullOutcome";
export type { PushOutcome } from "./bindings/PushOutcome";
export type { PushRequest } from "./bindings/PushRequest";
export type { RebaseTodo } from "./bindings/RebaseTodo";
export type { RefsSnapshot } from "./bindings/RefsSnapshot";
export type { Remote } from "./bindings/Remote";
export type { RemoteBranch } from "./bindings/RemoteBranch";
export type { RemoteSettings } from "./bindings/RemoteSettings";
export type { RepoConfig } from "./bindings/RepoConfig";
export type { RepoChanged } from "./bindings/RepoChanged";
export type { RepoInfo } from "./bindings/RepoInfo";
export type { RepoOperation } from "./bindings/RepoOperation";
export type { ResetMode } from "./bindings/ResetMode";
export type { SearchField } from "./bindings/SearchField";
export type { Settings } from "./bindings/Settings";
export type { Stash } from "./bindings/Stash";
export type { StashOutcome } from "./bindings/StashOutcome";
export type { StashRequest } from "./bindings/StashRequest";
export type { StatusEntry } from "./bindings/StatusEntry";
export type { Submodule } from "./bindings/Submodule";
export type { Tag } from "./bindings/Tag";
export type { ThemePreference } from "./bindings/ThemePreference";
export type { TodoAction } from "./bindings/TodoAction";
export type { TodoCommit } from "./bindings/TodoCommit";
export type { TodoItem } from "./bindings/TodoItem";
export type { UrlProtocol } from "./bindings/UrlProtocol";
export type { UpdateInfo } from "./bindings/UpdateInfo";
export type { WorkingStatus } from "./bindings/WorkingStatus";
export type { Worktree } from "./bindings/Worktree";

// Loaded on first use. The mock is only imported in browser mode, so it never ships in the
// app bundle.
let backend: Promise<Backend> | undefined;
const loaded = () =>
  (backend ??=
    import.meta.env.MODE === "web"
      ? import("./mock").then((m) => m.backend)
      : import("./tauri").then((m) => m.backend));

type Methods = Omit<Backend, "window">;

/** The backend with every call deferred until the implementation has loaded. */
export const ipc = new Proxy({} as Methods & { window: Backend["window"] }, {
  get(_, key: string) {
    // Never look like a promise (`await ipc` must not call into the backend).
    if (key === "then") return undefined;
    if (key === "window") {
      return new Proxy({} as Backend["window"], {
        get:
          (_w, method: keyof Backend["window"]) =>
          (...args: unknown[]) =>
            loaded().then((b) => (b.window[method] as (...a: unknown[]) => unknown)(...args)),
      });
    }
    return (...args: unknown[]) =>
      loaded().then((b) => (b[key as keyof Methods] as (...a: unknown[]) => unknown)(...args));
  },
});

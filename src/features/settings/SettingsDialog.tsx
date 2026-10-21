// Settings (Mod+,): General (appearance, density, font size, title bar), Git (pull, fetch,
// push), Keyboard (every action's shortcut, rebindable).

import {
  Keyboard,
  RefreshCw,
  RotateCcw,
  Search,
  Settings2,
  SlidersHorizontal,
  X,
} from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { Dialog as D } from "radix-ui";
import { useMemo, useState, type KeyboardEvent, type ReactNode } from "react";

import { useActionRegistry, type KnownAction } from "@/app/actions";
import { themeOptions } from "@/app/themeOptions";
import { appVersion, platform } from "@/app/boot";
import { effectiveShortcut, eventShortcut, normalizeShortcut } from "@/app/keyboard";
import { useOverlays, type SettingsSection } from "@/app/overlays";
import { UI_FONT_SIZES, useSettings } from "@/app/settings";
import { useWorkspace, type DiffMode } from "@/app/workspace";
import { useUpdate, type UpdateStatus } from "@/features/update/update";
import { t } from "@/i18n";
import { ipc, type DateFormat, type Density, type PullMode, type ThemePreference } from "@/ipc";
import { Button } from "@/ui/Button";
import { Checkbox } from "@/ui/Checkbox";
import { cn } from "@/ui/cn";
import { IconButton } from "@/ui/IconButton";
import { Input } from "@/ui/Input";
import { Kbd } from "@/ui/Kbd";
import { SegmentedControl } from "@/ui/SegmentedControl";
import { Select } from "@/ui/Select";

const SECTIONS: { id: SettingsSection; label: string; icon: typeof Keyboard }[] = [
  { id: "general", label: t("settingsScreen.general"), icon: SlidersHorizontal },
  { id: "git", label: t("settingsScreen.git"), icon: Settings2 },
  { id: "keyboard", label: t("settingsScreen.keyboard"), icon: Keyboard },
];

function Row({ label, hint, children }: { label: string; hint?: ReactNode; children: ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-6 border-b border-line-subtle py-3 last:border-b-0">
      <div className="flex min-w-0 flex-col gap-0.5">
        <span className="text-fg">{label}</span>
        {hint && <span className="text-small text-fg-muted">{hint}</span>}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}

function General() {
  const { settings, nativeTitleBarAtStart, update } = useSettings();
  const diffMode = useWorkspace((s) => s.diffMode);
  const setDiffMode = useWorkspace((s) => s.setDiffMode);
  return (
    <div className="flex flex-col">
      <Row label={t("theme.label")}>
        <SegmentedControl
          aria-label={t("theme.label")}
          value={settings.theme}
          onValueChange={(theme) => update({ theme: theme as ThemePreference })}
          segments={themeOptions.map((o) => ({ value: o.value, label: o.label }))}
        />
      </Row>
      <Row label={t("settingsScreen.density")} hint={t("settingsScreen.densityHint")}>
        <SegmentedControl
          aria-label={t("settingsScreen.density")}
          value={settings.density}
          onValueChange={(density) => update({ density: density as Density })}
          segments={[
            { value: "comfortable", label: t("settingsScreen.comfortable") },
            { value: "compact", label: t("settingsScreen.compact") },
          ]}
        />
      </Row>
      <Row label={t("settingsScreen.fontSize")}>
        <SegmentedControl
          aria-label={t("settingsScreen.fontSize")}
          value={String(settings.uiFontSize)}
          onValueChange={(v) => update({ uiFontSize: Number(v) })}
          segments={UI_FONT_SIZES.map((size) => ({ value: String(size), label: `${size}` }))}
        />
      </Row>
      <Row label={t("settingsScreen.diffLayout")}>
        <SegmentedControl
          aria-label={t("settingsScreen.diffLayout")}
          value={diffMode}
          onValueChange={(mode) => setDiffMode(mode as DiffMode)}
          segments={[
            { value: "unified", label: t("diff.unified") },
            { value: "split", label: t("diff.split") },
          ]}
        />
      </Row>
      <Row label={t("settingsScreen.tabWidth")}>
        <SegmentedControl
          aria-label={t("settingsScreen.tabWidth")}
          value={String(settings.tabWidth)}
          onValueChange={(v) => update({ tabWidth: Number(v) })}
          segments={[2, 4, 8].map((n) => ({ value: String(n), label: String(n) }))}
        />
      </Row>
      <Row label={t("settingsScreen.dates")} hint={t("settingsScreen.datesHint")}>
        <SegmentedControl
          aria-label={t("settingsScreen.dates")}
          value={settings.dateFormat}
          onValueChange={(dateFormat) => update({ dateFormat: dateFormat as DateFormat })}
          segments={[
            { value: "relative", label: t("settingsScreen.relative") },
            { value: "absolute", label: t("settingsScreen.absolute") },
          ]}
        />
      </Row>
      <Row
        label={t("settings.nativeTitleBar")}
        hint={
          settings.nativeTitleBar !== nativeTitleBarAtStart
            ? t("settings.restartRequired")
            : t("settingsScreen.nativeTitleBarHint")
        }
      >
        <Checkbox
          checked={settings.nativeTitleBar}
          onCheckedChange={(nativeTitleBar) => update({ nativeTitleBar })}
          aria-label={t("settings.nativeTitleBar")}
        />
      </Row>
      <TerminalSetting />
      <Updates />
    </div>
  );
}

function updateHint(status: UpdateStatus): ReactNode {
  switch (status.kind) {
    case "idle":
      return t("update.hint");
    case "checking":
      return t("update.checking");
    case "upToDate":
      return t("update.upToDate", { version: appVersion });
    case "available":
      return t("update.availableTitle", { version: status.info.version });
    case "failed":
      return (
        <span className="text-danger">
          {t("update.checkFailedDetail", { message: status.error.message })}
        </span>
      );
  }
}

const TERMINAL_HINT = {
  windows: t("settingsScreen.terminalAutoWindows"),
  macos: t("settingsScreen.terminalAutoMacos"),
  linux: t("settingsScreen.terminalAutoLinux"),
}[platform];

/** "Open in terminal": a program of the user's choice, else the platform's usual one. */
function TerminalSetting() {
  const { settings, update } = useSettings();
  const [value, setValue] = useState(settings.terminal ?? "");
  const save = () => {
    const terminal = value.trim() || null;
    if (terminal !== settings.terminal) update({ terminal });
  };
  return (
    <Row label={t("settingsScreen.terminal")} hint={TERMINAL_HINT}>
      <Input
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onBlur={save}
        onKeyDown={(e) => e.key === "Enter" && save()}
        placeholder={t("settingsScreen.terminalAutomatic")}
        aria-label={t("settingsScreen.terminal")}
        className="w-72"
      />
    </Row>
  );
}

/** Opt-in update check: off by default, and "Check now" is the only other way to ask. */
function Updates() {
  const { settings, update } = useSettings();
  const status = useUpdate((s) => s.status);
  const check = useUpdate((s) => s.check);
  const setDialogOpen = useUpdate((s) => s.setDialogOpen);
  return (
    <>
      <Row label={t("update.checkAtStart")} hint={t("update.privacy")}>
        <Checkbox
          checked={settings.checkForUpdates}
          onCheckedChange={(checkForUpdates) => update({ checkForUpdates })}
          aria-label={t("update.checkAtStart")}
        />
      </Row>
      <Row label={t("update.version", { version: appVersion })} hint={updateHint(status)}>
        {status.kind === "available" ? (
          <Button variant="primary" onClick={() => setDialogOpen(true)}>
            {t("update.view")}
          </Button>
        ) : (
          <Button
            icon={RefreshCw}
            loading={status.kind === "checking"}
            onClick={() => void check("settings")}
          >
            {t("update.checkNow")}
          </Button>
        )}
      </Row>
    </>
  );
}

const PULL_MODES: PullMode[] = ["merge", "rebase", "ffOnly"];

/** The Git executable: automatic (PATH) or a chosen file, with what it reports. */
function GitExecutable() {
  const { settings, update } = useSettings();
  const [value, setValue] = useState(settings.gitPath ?? "");
  const info = useQuery({
    queryKey: ["git-version", settings.gitPath],
    queryFn: () => ipc.gitVersion(),
    retry: false,
  });
  const save = () => {
    const path = value.trim() || null;
    if (path !== settings.gitPath) update({ gitPath: path });
  };
  return (
    <Row
      label={t("settingsScreen.gitPath")}
      hint={
        info.isError ? (
          <span className="text-danger">{t("settingsScreen.gitNotFound")}</span>
        ) : info.data ? (
          t("settingsScreen.gitFound", { version: info.data.raw, path: info.data.path })
        ) : null
      }
    >
      <div className="flex w-72 items-center gap-2">
        <Input
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onBlur={save}
          onKeyDown={(e) => e.key === "Enter" && save()}
          placeholder={t("settingsScreen.gitAutomatic")}
          aria-label={t("settingsScreen.gitPath")}
          className="flex-1"
        />
        {settings.gitPath && (
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              setValue("");
              update({ gitPath: null });
            }}
          >
            {t("settingsScreen.gitReset")}
          </Button>
        )}
      </div>
    </Row>
  );
}

function Git() {
  const { settings, update } = useSettings();
  return (
    <div className="flex flex-col">
      <GitExecutable />
      <Row label={t("settingsScreen.pullMode")} hint={t(`ops.modeHint.${settings.pullMode}`)}>
        <div className="w-48">
          <Select
            aria-label={t("settingsScreen.pullMode")}
            value={settings.pullMode}
            onValueChange={(pullMode) => update({ pullMode: pullMode as PullMode })}
            options={PULL_MODES.map((m) => ({ value: m, label: t(`ops.mode.${m}`) }))}
          />
        </div>
      </Row>
      <Row label={t("ops.prune")}>
        <Checkbox
          checked={settings.fetchPrune}
          onCheckedChange={(fetchPrune) => update({ fetchPrune })}
          aria-label={t("ops.prune")}
        />
      </Row>
      <Row label={t("ops.autoFetch")} hint={t("settingsScreen.autoFetchHint")}>
        <div className="w-48">
          <Select
            aria-label={t("ops.autoFetch")}
            value={String(settings.autoFetchMinutes)}
            onValueChange={(v) => update({ autoFetchMinutes: Number(v) })}
            options={[0, 5, 10, 30].map((m) => ({
              value: String(m),
              label: m === 0 ? t("ops.autoFetchOff") : t("ops.autoFetchEvery", { count: m }),
            }))}
          />
        </div>
      </Row>
      <Row label={t("composer.pushAfterCommit")} hint={t("composer.pushAfterCommitHint")}>
        <Checkbox
          checked={settings.pushAfterCommit}
          onCheckedChange={(pushAfterCommit) => update({ pushAfterCommit })}
          aria-label={t("composer.pushAfterCommit")}
        />
      </Row>
    </div>
  );
}

/** Settings → Keyboard: every action seen this session, its shortcut, and rebinding. */
function KeyboardSettings() {
  const known = useActionRegistry((s) => s.known);
  const { settings, update } = useSettings();
  const bindings = settings.shortcuts;
  const [filter, setFilter] = useState("");
  const [recording, setRecording] = useState<string | null>(null);

  const actions = useMemo(
    () =>
      [...known.values()]
        .filter((a) => {
          const f = filter.trim().toLowerCase();
          if (!f) return true;
          const shortcut = effectiveShortcut(a, bindings) ?? "";
          return a.title.toLowerCase().includes(f) || shortcut.toLowerCase().includes(f);
        })
        .sort((a, b) => a.group.localeCompare(b.group) || a.title.localeCompare(b.title)),
    [known, filter, bindings],
  );

  const shortcutOf = (a: KnownAction) => effectiveShortcut(a, bindings);
  const setBinding = (id: string, shortcut: string | null) => {
    const next = { ...bindings };
    const action = known.get(id);
    const fallback = action?.shortcut ? normalizeShortcut(action.shortcut) : null;
    if (shortcut === fallback) delete next[id];
    else next[id] = shortcut ?? "";
    update({ shortcuts: next });
  };

  const record = (id: string) => (e: KeyboardEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.key === "Escape") {
      setRecording(null);
      return;
    }
    const pressed = eventShortcut(e);
    if (!pressed) return;
    setRecording(null);
    // Whoever had this shortcut loses it.
    const next = { ...bindings };
    for (const other of known.values()) {
      if (other.id !== id && shortcutOf(other) === pressed) next[other.id] = "";
    }
    const action = known.get(id);
    if (action?.shortcut && normalizeShortcut(action.shortcut) === pressed) delete next[id];
    else next[id] = pressed;
    update({ shortcuts: next });
  };

  return (
    <div className="flex min-h-0 flex-col gap-3">
      <div className="flex items-center gap-2">
        <Input
          icon={Search}
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder={t("settingsScreen.filterShortcuts")}
          aria-label={t("settingsScreen.filterShortcuts")}
          className="flex-1"
        />
        <Button
          icon={RotateCcw}
          disabled={Object.keys(bindings).length === 0}
          onClick={() => update({ shortcuts: {} })}
        >
          {t("settingsScreen.resetAll")}
        </Button>
      </div>
      <p className="text-small text-fg-muted">{t("settingsScreen.keyboardHint")}</p>
      <div role="table" aria-label={t("settingsScreen.keyboard")} className="flex flex-col">
        {actions.map((a) => {
          const shortcut = shortcutOf(a);
          const changed = a.id in bindings;
          const conflicts = shortcut
            ? [...known.values()].filter((o) => o.id !== a.id && shortcutOf(o) === shortcut)
            : [];
          return (
            <div
              key={a.id}
              role="row"
              className="flex h-10 items-center gap-3 border-b border-line-subtle px-1"
            >
              <span role="cell" className="min-w-0 flex-1 truncate text-fg">
                {a.title}
                <span className="ml-2 text-small text-fg-muted">
                  {t(`palette.group.${a.group}`)}
                </span>
              </span>
              <span role="cell" className="flex shrink-0 items-center gap-2">
                {conflicts.length > 0 && (
                  <span className="text-small text-warning">
                    {t("settingsScreen.alsoUsedBy", { name: conflicts[0]!.title })}
                  </span>
                )}
                {recording === a.id ? (
                  <input
                    autoFocus
                    readOnly
                    onKeyDown={record(a.id)}
                    onBlur={() => setRecording(null)}
                    value=""
                    placeholder={t("settingsScreen.pressKeys")}
                    aria-label={t("settingsScreen.pressKeysFor", { name: a.title })}
                    className="h-7 w-44 rounded-control border border-accent bg-input px-2 text-small text-fg outline-none placeholder:text-fg-secondary"
                  />
                ) : (
                  <button
                    type="button"
                    onClick={() => setRecording(a.id)}

                    className={cn(
                      "flex h-7 min-w-28 items-center justify-end rounded-control px-2 focus-ring hover:bg-hover",
                      !shortcut && "text-small text-fg-muted",
                    )}
                  >
                    {shortcut ? <Kbd shortcut={shortcut} /> : t("settingsScreen.none")}
                    <span className="sr-only">
                      {t("settingsScreen.changeShortcut", { name: a.title })}
                    </span>
                  </button>
                )}
                <IconButton
                  icon={RotateCcw}
                  label={t("settingsScreen.reset", { name: a.title })}
                  compact
                  disabled={!changed}
                  onClick={() =>
                    setBinding(a.id, a.shortcut ? normalizeShortcut(a.shortcut) : null)
                  }
                />
                <IconButton
                  icon={X}
                  label={t("settingsScreen.remove", { name: a.title })}
                  compact
                  disabled={!shortcut}
                  onClick={() => setBinding(a.id, null)}
                />
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function SettingsDialog() {
  const section = useOverlays((s) => s.settings);
  const openSettings = useOverlays((s) => s.openSettings);
  const close = useOverlays((s) => s.closeSettings);
  return (
    <D.Root open={section !== null} onOpenChange={(o) => !o && close()}>
      <D.Portal>
        <D.Overlay className="fixed inset-0 z-40 animate-fade-in bg-overlay" />
        <D.Content
          aria-describedby={undefined}
          className="fixed top-1/2 left-1/2 z-50 flex h-[min(640px,85vh)] w-[min(820px,calc(100vw-32px))] -translate-x-1/2 -translate-y-1/2 animate-dialog-in overflow-hidden rounded-dialog bg-elevated text-fg shadow-float outline-none"
        >
          <nav
            aria-label={t("settingsScreen.title")}
            className="flex w-48 shrink-0 flex-col gap-0.5 border-r border-line-subtle bg-panel p-3"
          >
            <D.Title className="px-2 pt-1 pb-3 text-dialog-title font-semibold">
              {t("settingsScreen.title")}
            </D.Title>
            {SECTIONS.map(({ id, label, icon: Icon }) => (
              <button
                key={id}
                type="button"
                aria-current={section === id ? "page" : undefined}
                onClick={() => openSettings(id)}
                className={cn(
                  "flex h-8 items-center gap-2 rounded-control px-2 text-left focus-ring",
                  section === id
                    ? "bg-selected text-fg"
                    : "text-fg-secondary hover:bg-hover hover:text-fg",
                )}
              >
                <Icon size={16} strokeWidth={1.75} aria-hidden />
                {label}
              </button>
            ))}
          </nav>
          <div className="flex min-w-0 flex-1 flex-col">
            <div className="flex h-12 shrink-0 items-center justify-between border-b border-line-subtle px-5">
              <h2 className="text-title font-semibold">
                {SECTIONS.find((s) => s.id === section)?.label}
              </h2>
              <D.Close asChild>
                <IconButton icon={X} label={t("common.close")} compact />
              </D.Close>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto px-5 py-2">
              {section === "general" && <General />}
              {section === "git" && <Git />}
              {section === "keyboard" && <KeyboardSettings />}
            </div>
          </div>
        </D.Content>
      </D.Portal>
    </D.Root>
  );
}

// Repository settings: remotes (with SSH ↔ HTTPS switching), authentication (the SSH key
// this repository uses, saved HTTPS sign-ins) and the commit identity. Everything here is
// written to the repository's own Git config; global settings are shown, never changed.

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { FolderOpen, KeyRound, Plus, Server, Terminal, UserRound, X } from "lucide-react";
import { Dialog as D } from "radix-ui";
import { useState, type ReactNode } from "react";

import { useRemoteDialog } from "@/features/remote/RemoteDialogs";
import { t } from "@/i18n";
import {
  ipc,
  isIpcError,
  type ConfigScope,
  type ConfigValue,
  type IpcError,
  type RemoteSettings,
  type RepoConfig,
} from "@/ipc";
import { Badge } from "@/ui/Badge";
import { Button } from "@/ui/Button";
import { cn } from "@/ui/cn";
import { ConfirmDialog } from "@/ui/ConfirmDialog";
import { IconButton } from "@/ui/IconButton";
import { Input } from "@/ui/Input";
import { SegmentedControl } from "@/ui/SegmentedControl";
import { Skeleton } from "@/ui/Skeleton";
import { toast } from "@/ui/Toast";

import { useRepoSettings, type RepoSettingsSection } from "./store";

const SECTIONS: { id: RepoSettingsSection; label: string; icon: typeof Server }[] = [
  { id: "remotes", label: t("repoSettings.remotes"), icon: Server },
  { id: "authentication", label: t("repoSettings.authentication"), icon: KeyRound },
  { id: "identity", label: t("repoSettings.identity"), icon: UserRound },
];

const SCOPES: Record<ConfigScope, string> = {
  system: t("repoSettings.scope.system"),
  global: t("repoSettings.scope.global"),
  local: t("repoSettings.scope.local"),
  worktree: t("repoSettings.scope.worktree"),
  command: t("repoSettings.scope.command"),
};

const asError = (err: unknown): IpcError =>
  isIpcError(err) ? err : { kind: "io", message: String(err), command: null, stderr: null };

function failed(title: string, err: unknown) {
  const error = asError(err);
  toast({
    kind: "error",
    title,
    description: error.kind === "invalidInput" ? error.message : undefined,
    error,
  });
}

function Row({ label, hint, children }: { label: string; hint?: ReactNode; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-2 border-b border-line-subtle py-4 last:border-b-0">
      <div className="flex flex-col gap-0.5">
        <span className="font-medium text-fg">{label}</span>
        {hint && <span className="text-small text-fg-muted">{hint}</span>}
      </div>
      {children}
    </div>
  );
}

function hostOf(url: string): string {
  return /^https?:\/\/(?:[^@/]*@)?([^/:]+)/i.exec(url)?.[1] ?? url;
}

function RemoteCard({ repo, remote }: { repo: string; remote: RemoteSettings }) {
  const openRemoteDialog = useRemoteDialog((s) => s.open);
  const client = useQueryClient();
  const [busy, setBusy] = useState(false);
  const target = remote.protocol === "https" ? "ssh" : "https";
  const switchProtocol = async () => {
    if (!remote.alternateUrl) return;
    setBusy(true);
    try {
      await ipc.setRemoteUrl(repo, remote.name, remote.alternateUrl, false);
      toast({
        kind: "success",
        title: t("repoSettings.switched", { name: remote.name, url: remote.alternateUrl }),
        description: target === "ssh" ? t("repoSettings.switchedSshHint") : undefined,
      });
    } catch (err) {
      failed(t("remotes.failed"), err);
    } finally {
      setBusy(false);
      void client.invalidateQueries({ queryKey: ["repo-config", repo] });
      void client.invalidateQueries({ queryKey: ["refs", repo] });
    }
  };
  return (
    <li className="flex flex-col gap-2 rounded-menu border border-line-subtle bg-panel p-3">
      <div className="flex items-center gap-2">
        <span className="font-medium text-fg">{remote.name}</span>
        <Badge tone={remote.protocol === "ssh" ? "info" : "neutral"}>
          {t(`repoSettings.protocol.${remote.protocol}`)}
        </Badge>
        <span className="flex-1" />
        <Button
          size="sm"
          variant="ghost"
          onClick={() => openRemoteDialog({ repo, mode: "edit", name: remote.name })}
        >
          {t("remotes.edit")}
        </Button>
        <Button
          size="sm"
          variant="ghostDanger"
          onClick={() => openRemoteDialog({ repo, mode: "remove", name: remote.name })}
        >
          {t("remotes.remove")}
        </Button>
      </div>
      <code className="truncate font-mono text-small text-fg-secondary" data-selectable>
        {remote.url}
      </code>
      {remote.pushUrl && (
        <p className="truncate text-small text-fg-muted">
          {t("repoSettings.pushesTo")}{" "}
          <code className="font-mono" data-selectable>
            {remote.pushUrl}
          </code>
        </p>
      )}
      {remote.alternateUrl && (remote.protocol === "https" || remote.protocol === "ssh") && (
        <div className="flex items-center gap-2 text-small text-fg-muted">
          <Button size="sm" loading={busy} onClick={() => void switchProtocol()}>
            {target === "ssh" ? t("repoSettings.useSsh") : t("repoSettings.useHttps")}
          </Button>
          <span className="min-w-0 truncate">
            <code className="font-mono">{remote.alternateUrl}</code>
          </span>
        </div>
      )}
    </li>
  );
}

function Remotes({ repo, config }: { repo: string; config: RepoConfig }) {
  const openRemoteDialog = useRemoteDialog((s) => s.open);
  return (
    <div className="flex flex-col gap-3 py-4">
      <p className="text-small text-fg-muted">{t("repoSettings.remotesHint")}</p>
      {config.remotes.length === 0 ? (
        <p className="text-fg-secondary">{t("repoSettings.noRemotes")}</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {config.remotes.map((r) => (
            <RemoteCard key={r.name} repo={repo} remote={r} />
          ))}
        </ul>
      )}
      <div>
        <Button icon={Plus} onClick={() => openRemoteDialog({ repo, mode: "add" })}>
          {t("remotes.add")}
        </Button>
      </div>
    </div>
  );
}

function SshKey({ repo, config, refresh }: { repo: string; config: RepoConfig; refresh(): void }) {
  const [mode, setMode] = useState<"default" | "key">(config.sshKey ? "key" : "default");
  const [path, setPath] = useState(config.sshKey ?? "");
  const [busy, setBusy] = useState(false);
  const custom = config.sshCommand && !config.sshKey ? config.sshCommand : null;
  const save = async (key: string | null) => {
    setBusy(true);
    try {
      await ipc.setSshKey(repo, key);
      toast({
        kind: "success",
        title: key ? t("repoSettings.sshKeySaved") : t("repoSettings.sshKeyCleared"),
      });
      refresh();
    } catch (err) {
      failed(t("repoSettings.sshKeyFailed"), err);
    } finally {
      setBusy(false);
    }
  };
  const browse = async () => {
    const home = await ipc.homeDir().catch(() => undefined);
    const picked = await ipc.pickFile(
      t("repoSettings.chooseKey"),
      home ? `${home}/.ssh` : undefined,
    );
    if (picked) setPath(picked);
  };
  return (
    <Row label={t("repoSettings.sshKey")} hint={t("repoSettings.sshKeyHint")}>
      {custom && (
        <p className="rounded-menu border border-line-subtle bg-panel p-2 text-small text-fg-secondary">
          <Terminal size={12} className="mr-1 inline" aria-hidden />
          {t("repoSettings.customSsh", { scope: SCOPES[custom.scope] })}{" "}
          <code className="font-mono" data-selectable>
            {custom.value}
          </code>
        </p>
      )}
      <SegmentedControl
        className="self-start"
        aria-label={t("repoSettings.sshKey")}
        value={mode}
        onValueChange={(v) => {
          setMode(v as "default" | "key");
          if (v === "default" && config.sshKey) void save(null);
        }}
        segments={[
          { value: "default", label: t("repoSettings.sshDefault") },
          { value: "key", label: t("repoSettings.sshThisKey") },
        ]}
      />
      {mode === "key" && (
        <div className="flex items-center gap-2">
          <Input
            value={path}
            onChange={(e) => setPath(e.target.value)}
            placeholder={t("repoSettings.keyPlaceholder")}
            aria-label={t("repoSettings.keyFile")}
            className="flex-1 font-mono"
          />
          <Button icon={FolderOpen} onClick={() => void browse()}>
            {t("repoSettings.browse")}
          </Button>
          <Button
            variant="primary"
            loading={busy}
            disabled={!path.trim() || path.trim() === config.sshKey}
            onClick={() => void save(path.trim())}
          >
            {t("repoSettings.save")}
          </Button>
        </div>
      )}
    </Row>
  );
}

function helperLabel(helper: ConfigValue): string {
  const name = helper.value.split(/\s/)[0]!;
  const known: Record<string, string> = {
    manager: t("repoSettings.helper.manager"),
    "manager-core": t("repoSettings.helper.manager"),
    osxkeychain: t("repoSettings.helper.osxkeychain"),
    libsecret: t("repoSettings.helper.libsecret"),
    store: t("repoSettings.helper.store"),
    cache: t("repoSettings.helper.cache"),
  };
  return known[name.replace(/^git-credential-/, "")] ?? helper.value;
}

function SavedSignIns({ repo, config }: { repo: string; config: RepoConfig }) {
  const [confirm, setConfirm] = useState<string | null>(null);
  const https = config.remotes.filter((r) => r.protocol === "https");
  const hosts = [...new Set(https.map((r) => r.url))];
  const helper = config.credentialHelpers.at(-1);
  return (
    <Row
      label={t("repoSettings.signIns")}
      hint={
        helper
          ? t("repoSettings.signInsHelper", {
              helper: helperLabel(helper),
              scope: SCOPES[helper.scope],
            })
          : t("repoSettings.signInsNoHelper")
      }
    >
      {hosts.length === 0 ? (
        <p className="text-small text-fg-muted">{t("repoSettings.noHttpsRemotes")}</p>
      ) : (
        <div className="flex flex-wrap gap-2">
          {hosts.map((url) => (
            <Button key={url} size="sm" onClick={() => setConfirm(url)}>
              {t("repoSettings.forget", { host: hostOf(url) })}
            </Button>
          ))}
        </div>
      )}
      {confirm && (
        <ConfirmDialog
          open
          onOpenChange={(o) => !o && setConfirm(null)}
          title={t("repoSettings.forgetTitle", { host: hostOf(confirm) })}
          consequence={t("repoSettings.forgetBody", { host: hostOf(confirm) })}
          confirmLabel={t("repoSettings.forgetConfirm")}
          onConfirm={() => {
            const url = confirm;
            ipc
              .forgetCredentials(repo, url)
              .then(() =>
                toast({
                  kind: "success",
                  title: t("repoSettings.forgotten", { host: hostOf(url) }),
                }),
              )
              .catch((err: unknown) => failed(t("repoSettings.forgetFailed"), err));
          }}
        />
      )}
    </Row>
  );
}

function Authentication({
  repo,
  config,
  refresh,
}: {
  repo: string;
  config: RepoConfig;
  refresh(): void;
}) {
  return (
    <div className="flex flex-col">
      <SshKey repo={repo} config={config} refresh={refresh} />
      <SavedSignIns repo={repo} config={config} />
    </div>
  );
}

function Identity({
  repo,
  config,
  refresh,
}: {
  repo: string;
  config: RepoConfig;
  refresh(): void;
}) {
  const local = (v: ConfigValue | null) => (v?.scope === "local" ? v.value : "");
  const inherited = (v: ConfigValue | null) => (v && v.scope !== "local" ? v.value : "");
  const [name, setName] = useState(local(config.userName));
  const [email, setEmail] = useState(local(config.userEmail));
  const [busy, setBusy] = useState(false);
  const save = async (n: string, e: string) => {
    setBusy(true);
    try {
      await ipc.setIdentity(repo, n.trim() || null, e.trim() || null);
      toast({ kind: "success", title: t("repoSettings.identitySaved") });
      refresh();
    } catch (err) {
      failed(t("repoSettings.identityFailed"), err);
    } finally {
      setBusy(false);
    }
  };
  const dirty = name !== local(config.userName) || email !== local(config.userEmail);
  const hasLocal = !!local(config.userName) || !!local(config.userEmail);
  return (
    <div className="flex flex-col gap-4 py-4">
      <p className="text-small text-fg-muted">{t("repoSettings.identityHint")}</p>
      <label className="flex flex-col gap-1">
        <span className="text-small font-medium text-fg-secondary">{t("repoSettings.name")}</span>
        <Input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder={inherited(config.userName) || t("repoSettings.notSet")}
        />
      </label>
      <label className="flex flex-col gap-1">
        <span className="text-small font-medium text-fg-secondary">{t("repoSettings.email")}</span>
        <Input
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder={inherited(config.userEmail) || t("repoSettings.notSet")}
        />
      </label>
      <p className="text-small text-fg-muted">
        {hasLocal ? t("repoSettings.identityLocal") : t("repoSettings.identityInherited")}
      </p>
      <div className="flex gap-2">
        <Button
          variant="primary"
          loading={busy}
          disabled={!dirty}
          onClick={() => void save(name, email)}
        >
          {t("repoSettings.save")}
        </Button>
        {hasLocal && (
          <Button
            variant="ghost"
            onClick={() => {
              setName("");
              setEmail("");
              void save("", "");
            }}
          >
            {t("repoSettings.useGlobal")}
          </Button>
        )}
      </div>
    </div>
  );
}

/** The dialog for `repo`; rendered once per repository view. */
export function RepoSettingsDialog({ repo, name }: { repo: string; name: string }) {
  const open = useRepoSettings((s) => s.repo === repo);
  const section = useRepoSettings((s) => s.section);
  const setSection = useRepoSettings((s) => s.setSection);
  const close = useRepoSettings((s) => s.close);
  const config = useQuery({
    queryKey: ["repo-config", repo],
    queryFn: () => ipc.repoConfig(repo),
    enabled: open,
  });
  const client = useQueryClient();
  const refresh = () => void client.invalidateQueries({ queryKey: ["repo-config", repo] });

  return (
    <D.Root open={open} onOpenChange={(o) => !o && close()}>
      <D.Portal>
        <D.Overlay className="fixed inset-0 z-40 animate-fade-in bg-overlay" />
        <D.Content
          aria-describedby={undefined}
          className="fixed top-1/2 left-1/2 z-50 flex h-[min(600px,85vh)] w-[min(780px,calc(100vw-32px))] -translate-x-1/2 -translate-y-1/2 animate-dialog-in overflow-hidden rounded-dialog bg-elevated text-fg shadow-float outline-none"
        >
          <nav
            aria-label={t("toolbar.repoSettings")}
            className="flex w-48 shrink-0 flex-col gap-0.5 border-r border-line-subtle bg-panel p-3"
          >
            <D.Title className="flex min-w-0 flex-col px-2 pt-1 pb-3">
              <span className="text-dialog-title font-semibold">{t("toolbar.repoSettings")}</span>
              <span className="truncate text-small font-normal text-fg-muted">{name}</span>
            </D.Title>
            {SECTIONS.map(({ id, label, icon: Icon }) => (
              <button
                key={id}
                type="button"
                aria-current={section === id ? "page" : undefined}
                onClick={() => setSection(id)}
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
            <div className="min-h-0 flex-1 overflow-y-auto px-5">
              {!config.data ? (
                <div className="flex flex-col gap-3 py-4">
                  <Skeleton className="h-16" />
                  <Skeleton className="h-16" />
                </div>
              ) : section === "remotes" ? (
                <Remotes repo={repo} config={config.data} />
              ) : section === "authentication" ? (
                <Authentication repo={repo} config={config.data} refresh={refresh} />
              ) : (
                <Identity
                  // Re-read the fields when the config changes (after a save).
                  key={`${config.data.userName?.value}|${config.data.userEmail?.value}`}
                  repo={repo}
                  config={config.data}
                  refresh={refresh}
                />
              )}
            </div>
          </div>
        </D.Content>
      </D.Portal>
    </D.Root>
  );
}

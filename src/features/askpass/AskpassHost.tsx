import { Eye, EyeOff, KeyRound, ShieldAlert } from "lucide-react";
import { useEffect, useId, useState, type ReactNode } from "react";

import { plural, t } from "@/i18n";
import { ipc, type AskpassPrompt, type Unlisten } from "@/ipc";
import { Button } from "@/ui/Button";
import { Dialog } from "@/ui/Dialog";
import { IconButton } from "@/ui/IconButton";
import { Input } from "@/ui/Input";

/**
 * Shows Git's and ssh's credential prompts (the askpass bridge, ARCHITECTURE §5.13) one at
 * a time, in arrival order. Mounted once.
 */
export function AskpassHost() {
  const [queue, setQueue] = useState<AskpassPrompt[]>([]);

  useEffect(() => {
    let alive = true;
    const unlisten: Unlisten[] = [];
    const keep = (fn: Unlisten) => (alive ? unlisten.push(fn) : fn());
    void ipc.onAskpassPrompt((p) => setQueue((q) => [...q, p])).then(keep);
    void ipc.onAskpassClosed((id) => setQueue((q) => q.filter((p) => p.id !== id))).then(keep);
    return () => {
      alive = false;
      unlisten.forEach((fn) => fn());
    };
  }, []);

  const current = queue[0];
  if (!current) return null;
  const answer = (value: string | null) => {
    setQueue((q) => q.filter((p) => p.id !== current.id));
    // Without the answer Git can only fail, so Cancel cancels the whole operation (quietly,
    // instead of an error about a missing password). Cancelled first, so Git can't fail
    // before the cancel lands. ssh's notices and key-use confirmations don't end the
    // connection attempt, so those just close.
    if (value === null && current.kind !== "notice" && current.kind !== "confirm") {
      void ipc.cancelOperation(current.operationId);
    }
    void ipc.askpassRespond(current.id, value);
  };
  // Keyed by prompt, so nothing typed survives into the next one.
  return (
    <PromptDialog key={current.id} prompt={current} waiting={queue.length - 1} onAnswer={answer} />
  );
}

const repoName = (path: string) =>
  path
    .replace(/[/\\]+$/, "")
    .split(/[/\\]/)
    .pop() || path;

function PromptDialog({
  prompt,
  waiting,
  onAnswer,
}: {
  prompt: AskpassPrompt;
  waiting: number;
  onAnswer: (value: string | null) => void;
}) {
  const [value, setValue] = useState("");
  const [revealed, setRevealed] = useState(false);
  const inputId = useId();
  const { kind, host, detail } = prompt;

  const cancel = () => {
    setValue("");
    onAnswer(null);
  };
  const submit = () => {
    if (value === "") return;
    const answer = value;
    setValue("");
    onAnswer(answer);
  };

  const footnote = (
    <>
      {prompt.repo && (
        <p className="text-small text-fg-muted">
          {t("askpass.repo", { name: repoName(prompt.repo) })}
        </p>
      )}
      {waiting > 0 && (
        <p className="text-small text-fg-muted">{plural("askpass.waiting", waiting)}</p>
      )}
    </>
  );

  if (kind === "hostKey" || kind === "confirm" || kind === "notice") {
    const hostKey = kind === "hostKey";
    return (
      <Dialog
        open
        onOpenChange={(open) => !open && cancel()}
        width="md"
        title={t(
          hostKey
            ? "askpass.hostKeyTitle"
            : kind === "confirm"
              ? "askpass.confirmTitle"
              : "askpass.noticeTitle",
        )}
        icon={
          hostKey && (
            <ShieldAlert size={20} strokeWidth={1.75} aria-hidden className="text-warning" />
          )
        }
        description={
          hostKey
            ? host
              ? t("askpass.hostKeyBody", { host })
              : t("askpass.hostKeyBodyNoHost")
            : undefined
        }
        footer={
          // Cancel is focused, and Enter never trusts: there is no submit button.
          <>
            <Button size="lg" onClick={cancel} autoFocus>
              {kind === "notice" ? t("common.dismiss") : t("common.cancel")}
            </Button>
            {kind !== "notice" && (
              <Button size="lg" variant="primary" onClick={() => onAnswer("yes")}>
                {hostKey ? t("askpass.trust") : t("askpass.allow")}
              </Button>
            )}
          </>
        }
      >
        <div className="flex flex-col gap-3">
          {hostKey ? (
            <>
              <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 rounded-control border border-line-subtle bg-panel px-3 py-2.5">
                {host && <Fact label={t("askpass.host")}>{host}</Fact>}
                {detail && <Fact label={t("askpass.fingerprint")}>{detail}</Fact>}
                {!detail && <PromptText text={prompt.prompt} />}
              </dl>
              <p className="text-small text-fg-secondary">{t("askpass.hostKeyRemember")}</p>
            </>
          ) : (
            <PromptText text={prompt.prompt} />
          )}
          {footnote}
        </div>
      </Dialog>
    );
  }

  const copy = textFor(prompt);
  return (
    <Dialog
      open
      onOpenChange={(open) => !open && cancel()}
      width="sm"
      title={copy.title}
      icon={
        kind === "passphrase" && (
          <KeyRound size={20} strokeWidth={1.75} aria-hidden className="text-fg-secondary" />
        )
      }
      description={copy.body}
      onSubmit={submit}
      footer={
        <>
          <Button size="lg" onClick={cancel}>
            {t("common.cancel")}
          </Button>
          <Button size="lg" variant="primary" type="submit" disabled={value === ""}>
            {copy.submit}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        {kind === "other" && <PromptText text={prompt.prompt} />}
        <div className="flex flex-col gap-1.5">
          <label htmlFor={inputId} className="text-small font-medium text-fg-secondary">
            {copy.label}
          </label>
          <Input
            id={inputId}
            autoFocus
            autoComplete="off"
            type={prompt.secret && !revealed ? "password" : "text"}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            trailing={
              prompt.secret && (
                <IconButton
                  compact
                  icon={revealed ? EyeOff : Eye}
                  label={revealed ? t("askpass.hide") : t("askpass.show")}
                  aria-pressed={revealed}
                  onClick={() => setRevealed((r) => !r)}
                />
              )
            }
          />
        </div>
        {kind === "password" && host && (
          <p className="text-small text-fg-secondary">{t("askpass.tokenHint")}</p>
        )}
        {footnote}
      </div>
    </Dialog>
  );
}

function textFor({ kind, host, detail }: AskpassPrompt) {
  switch (kind) {
    case "username":
      return {
        title: host ? t("askpass.signInTitle", { host }) : t("askpass.signInTitleNoHost"),
        body: host ? t("askpass.usernameBody", { host }) : t("askpass.usernameBodyNoHost"),
        label: t("askpass.username"),
        submit: t("askpass.signIn"),
      };
    case "password":
      return {
        title: host ? t("askpass.signInTitle", { host }) : t("askpass.signInTitleNoHost"),
        body: !host
          ? t("askpass.passwordBodyNoHost")
          : detail
            ? t("askpass.passwordBody", { user: detail, host })
            : t("askpass.passwordBodyNoUser", { host }),
        label: t("askpass.password"),
        submit: t("askpass.signIn"),
      };
    case "passphrase":
      return {
        title: t("askpass.passphraseTitle"),
        body: detail
          ? t("askpass.passphraseBody", { key: detail })
          : t("askpass.passphraseBodyNoKey"),
        label: t("askpass.passphrase"),
        submit: t("askpass.unlock"),
      };
    default:
      return {
        title: t("askpass.otherTitle"),
        body: undefined,
        label: t("askpass.answer"),
        submit: t("askpass.continue"),
      };
  }
}

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <>
      <dt className="text-small text-fg-secondary">{label}</dt>
      <dd className="min-w-0 font-code text-small break-all text-fg" data-selectable>
        {children}
      </dd>
    </>
  );
}

/** The prompt exactly as Git or ssh wrote it. */
function PromptText({ text }: { text: string }) {
  return (
    <p
      className="col-span-2 font-code text-small break-words whitespace-pre-wrap text-fg"
      data-selectable
    >
      {text.trim()}
    </p>
  );
}

import { Check, Copy } from "lucide-react";
import { useEffect, useState } from "react";

import { t } from "@/i18n";

import { Button } from "./Button";
import { cn } from "./cn";

export interface ErrorDetails {
  message: string;
  command?: string | null;
  stderr?: string | null;
}

interface ErrorPanelProps extends ErrorDetails {
  className?: string;
}

/** What failed, the exact Git command, and Git's own output, with a copy button. */
export function ErrorPanel({ message, command, stderr, className }: ErrorPanelProps) {
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) return;
    const id = setTimeout(() => setCopied(false), 1500);
    return () => clearTimeout(id);
  }, [copied]);

  const copy = () => {
    const text = [message, command && `$ ${command}`, stderr].filter(Boolean).join("\n\n");
    void navigator.clipboard.writeText(text).then(() => setCopied(true));
  };

  return (
    <div
      className={cn("flex flex-col gap-2 rounded-menu border border-line bg-input p-3", className)}
    >
      <div className="flex items-start gap-2">
        <p className="flex-1 text-fg" data-selectable>
          {message}
        </p>
        <Button size="sm" variant="ghost" icon={copied ? Check : Copy} onClick={copy}>
          {copied ? t("common.copied") : t("common.copy")}
        </Button>
      </div>
      {command && (
        <section>
          <h4 className="mb-1 text-caption font-medium text-fg-muted">{t("error.command")}</h4>
          <code className="block text-small break-all text-fg-secondary" data-selectable>
            {command}
          </code>
        </section>
      )}
      {stderr && (
        <section>
          <h4 className="mb-1 text-caption font-medium text-fg-muted">{t("error.output")}</h4>
          <pre
            className="max-h-48 overflow-auto text-small whitespace-pre-wrap text-fg-secondary"
            data-selectable
          >
            {stderr.trimEnd()}
          </pre>
        </section>
      )}
    </div>
  );
}

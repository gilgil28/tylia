// Whether the commit's signature is good (ROADMAP Phase 11 D). Checked on its own, after
// the details, as it runs the signing program; nothing is shown for an unsigned commit.

import { useQuery } from "@tanstack/react-query";
import { ShieldAlert, ShieldCheck, ShieldQuestion, type LucideIcon } from "lucide-react";

import { t, type MessageKey } from "@/i18n";
import { ipc, type SignatureStatus } from "@/ipc";
import { cn } from "@/ui/cn";

const LOOK: Record<Exclude<SignatureStatus, "unsigned">, [LucideIcon, string, MessageKey]> = {
  good: [ShieldCheck, "text-success", "signature.good"],
  goodUntrusted: [ShieldCheck, "text-fg-secondary", "signature.goodUntrusted"],
  goodExpired: [ShieldQuestion, "text-warning", "signature.goodExpired"],
  bad: [ShieldAlert, "text-danger", "signature.bad"],
  cannotCheck: [ShieldQuestion, "text-fg-muted", "signature.cannotCheck"],
};

export function SignatureBadge({ repo, oid }: { repo: string; oid: string }) {
  const { data } = useQuery({
    queryKey: ["signature", repo, oid],
    queryFn: () => ipc.verifyCommit(repo, oid),
    staleTime: Infinity,
  });
  if (!data || data.status === "unsigned") return null;
  const [Icon, color, label] = LOOK[data.status];
  const details = [
    data.signer && t("signature.signer", { signer: data.signer }),
    data.key && t("signature.key", { key: data.key }),
  ]
    .filter(Boolean)
    .join("\n");
  return (
    <span
      className={cn("flex items-center gap-1", color)}
      title={details ? `${t(label)}\n${details}` : t(label)}
    >
      <Icon size={14} strokeWidth={1.75} aria-hidden />
      {t(label)}
    </span>
  );
}

// Whether a commit's or tag's signature is good (ROADMAP Phase 11 D). Checked on its own,
// after the details, as it runs the signing program; nothing is shown when it's unsigned.

import { useQuery } from "@tanstack/react-query";
import { ShieldAlert, ShieldCheck, ShieldQuestion, type LucideIcon } from "lucide-react";

import { t, type MessageKey } from "@/i18n";
import { ipc, type SignatureCheck, type SignatureStatus } from "@/ipc";
import { cn } from "@/ui/cn";

const LOOK: Record<Exclude<SignatureStatus, "unsigned">, [LucideIcon, string, MessageKey]> = {
  good: [ShieldCheck, "text-success", "signature.good"],
  goodUntrusted: [ShieldCheck, "text-fg-secondary", "signature.goodUntrusted"],
  goodExpired: [ShieldQuestion, "text-warning", "signature.goodExpired"],
  bad: [ShieldAlert, "text-danger", "signature.bad"],
  cannotCheck: [ShieldQuestion, "text-fg-muted", "signature.cannotCheck"],
};

function Badge({ check }: { check: SignatureCheck | undefined }) {
  if (!check || check.status === "unsigned") return null;
  const [Icon, color, label] = LOOK[check.status];
  const details = [
    check.signer && t("signature.signer", { signer: check.signer }),
    check.key && t("signature.key", { key: check.key }),
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

export function SignatureBadge({ repo, oid }: { repo: string; oid: string }) {
  const { data } = useQuery({
    queryKey: ["signature", repo, oid],
    queryFn: () => ipc.verifyCommit(repo, oid),
    staleTime: Infinity,
  });
  return <Badge check={data} />;
}

/** A tag's signature; keyed by its name, as a tag can be moved to another object. */
export function TagSignatureBadge({ repo, name }: { repo: string; name: string }) {
  const { data } = useQuery({
    queryKey: ["tag-signature", repo, name],
    queryFn: () => ipc.verifyTag(repo, name),
  });
  return <Badge check={data} />;
}

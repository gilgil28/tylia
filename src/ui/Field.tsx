import type { ReactNode } from "react";

/** A labelled form control, with optional help text under it. */
export function Field({
  label,
  htmlFor,
  hint,
  children,
}: {
  label: string;
  htmlFor: string;
  hint?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={htmlFor} className="text-small font-medium text-fg-secondary">
        {label}
      </label>
      {children}
      {hint && <p className="text-small text-fg-muted">{hint}</p>}
    </div>
  );
}

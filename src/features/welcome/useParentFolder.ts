import { useEffect, useState } from "react";

import { useWorkspace } from "@/app/workspace";
import { ipc } from "@/ipc";

/**
 * The folder to create a clone or new repository in: last used, else the home folder.
 * Dialogs using it are mounted only while open, so each opening starts fresh.
 */
export function useParentFolder() {
  const last = useWorkspace((s) => s.lastParentFolder);
  const [parent, setParent] = useState(last ?? "");
  useEffect(() => {
    if (!last) void ipc.homeDir().then((home) => setParent((current) => current || home));
  }, [last]);
  return [parent, setParent] as const;
}

import { t } from "@/i18n";

import { platform } from "./boot";

/** "Show in Explorer" / "Reveal in Finder" / "Open containing folder". */
export const revealLabel = {
  windows: t("reveal.windows"),
  macos: t("reveal.macos"),
  linux: t("reveal.linux"),
}[platform];

/** "Recycle Bin" / "Trash". */
export const trashLabel = {
  windows: t("trash.windows"),
  macos: t("trash.macos"),
  linux: t("trash.linux"),
}[platform];

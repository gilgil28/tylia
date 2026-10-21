import type { GitInfo } from "../bindings/GitInfo";

export const gitInfo: GitInfo = {
  version: { major: 2, minor: 50, patch: 1 },
  raw: "git version 2.50.1",
  path: "/usr/bin/git",
  minimum: { major: 2, minor: 40, patch: 0 },
  supported: true,
};

// git-flow in browser mode: the setup is kept in memory (`?flow=1` starts with it done);
// starting creates and checks out the branch, finishing deletes it.

import type { Backend } from "../backend";
import type { FlowConfig } from "../bindings/FlowConfig";
import type { IpcError } from "../bindings/IpcError";

const SUGGESTED: FlowConfig = {
  main: "main",
  develop: "develop",
  featurePrefix: "feature/",
  releasePrefix: "release/",
  hotfixPrefix: "hotfix/",
  versionTagPrefix: "",
};

type Methods = Pick<Backend, "flowState" | "flowInit" | "flowStart" | "flowFinish">;

export function flowMock(
  branching: Pick<Backend, "createBranch" | "deleteBranch" | "checkout">,
): Methods {
  let config: FlowConfig | null = new URLSearchParams(location.search).has("flow")
    ? { ...SUGGESTED, versionTagPrefix: "v" }
    : null;
  const required = () => {
    if (config) return config;
    throw {
      kind: "invalidInput",
      message: "git-flow isn't set up in this repository.",
      command: null,
      stderr: null,
    } satisfies IpcError;
  };
  return {
    flowState: async (repo) => {
      // A preset setup (`?flow`) needs its development branch too.
      if (config) {
        await branching.createBranch(repo, config.develop, config.main, false).catch(() => {});
      }
      return { config, suggested: SUGGESTED };
    },
    flowInit: async (repo, next) => {
      // Creates the development branch unless it exists.
      await branching.createBranch(repo, next.develop, next.main, false).catch(() => undefined);
      config = next;
    },
    flowStart: async (repo, kind, name) => {
      const c = required();
      const prefix = { feature: c.featurePrefix, release: c.releasePrefix, hotfix: c.hotfixPrefix };
      const branch = `${prefix[kind]}${name.trim()}`;
      await branching.createBranch(repo, branch, "HEAD", true);
      return branch;
    },
    flowFinish: async (repo, request) => {
      const c = required();
      const release = request.branch.startsWith(c.releasePrefix);
      const hotfix = request.branch.startsWith(c.hotfixPrefix);
      const name = request.branch.slice(request.branch.indexOf("/") + 1);
      const mergedInto = release || hotfix ? [c.main, c.develop] : [c.develop];
      await branching.checkout(repo, {
        target: { kind: "branch", name: mergedInto.at(-1)! },
        stash: false,
      });
      if (!request.keepBranch) await branching.deleteBranch(repo, request.branch, true);
      return {
        mergedInto,
        tag: release || hotfix ? `${c.versionTagPrefix}${name}` : null,
        deleted: !request.keepBranch,
      };
    },
  };
}

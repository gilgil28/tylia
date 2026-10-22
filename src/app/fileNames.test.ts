import { describe, expect, it } from "vitest";

import { archiveFormat, patchFileName } from "./fileNames";

describe("file names", () => {
  it("picks the archive format from the chosen extension", () => {
    expect(archiveFormat("C:/out/tylia-main.zip")).toBe("zip");
    expect(archiveFormat("/home/ada/tylia-v1.0.tar.gz")).toBe("tarGz");
    expect(archiveFormat("/home/ada/tylia.TGZ")).toBe("tarGz");
    expect(archiveFormat("/home/ada/tylia")).toBe("zip");
  });

  it("names patches like git format-patch", () => {
    expect(patchFileName("graph: draw merge curves as beziers")).toBe(
      "0001-graph-draw-merge-curves-as-beziers.patch",
    );
    expect(patchFileName("Ünïcode only!!")).toBe("0001-n-code-only.patch");
    expect(patchFileName("???")).toBe("0001-patch.patch");
  });
});

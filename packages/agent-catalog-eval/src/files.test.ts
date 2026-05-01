import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, mkdir, writeFile, readdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  collectFiles,
  copyDir,
  createWorkDir,
  formatFiles,
  removeDir,
} from "./files.js";

let tmp: string;

beforeEach(async () => {
  tmp = await mkdtemp(join(tmpdir(), "ace-files-"));
});

afterEach(async () => {
  await rm(tmp, { recursive: true, force: true });
});

describe("collectFiles", () => {
  it("walks nested directories and returns files sorted by path", async () => {
    await mkdir(join(tmp, "sub", "deep"), { recursive: true });
    await writeFile(join(tmp, "z.txt"), "z");
    await writeFile(join(tmp, "a.txt"), "a");
    await writeFile(join(tmp, "sub", "b.txt"), "b");
    await writeFile(join(tmp, "sub", "deep", "c.txt"), "c");

    const files = await collectFiles(tmp);

    expect(files.map((f) => f.path)).toEqual([
      "a.txt",
      "sub/b.txt",
      "sub/deep/c.txt",
      "z.txt",
    ]);
    expect(files.find((f) => f.path === "sub/deep/c.txt")?.content).toBe("c");
  });

  it("returns an empty array for an empty directory", async () => {
    expect(await collectFiles(tmp)).toEqual([]);
  });
});

describe("formatFiles", () => {
  it("renders each snapshot as a markdown header + fenced block", () => {
    const out = formatFiles([
      { path: "a.ts", content: "export const x = 1;" },
      { path: "b.md", content: "# title" },
    ]);
    expect(out).toBe(
      "### a.ts\n```\nexport const x = 1;\n```\n\n### b.md\n```\n# title\n```",
    );
  });

  it("returns empty string for no files", () => {
    expect(formatFiles([])).toBe("");
  });
});

describe("createWorkDir", () => {
  it("creates the directory if missing", async () => {
    const dir = await createWorkDir(tmp, "case-1");
    expect(dir).toBe(join(tmp, "case-1"));
    expect(existsSync(dir)).toBe(true);
  });

  it("removes any existing contents (idempotent)", async () => {
    const dir = await createWorkDir(tmp, "case-2");
    await writeFile(join(dir, "stale.txt"), "stale");

    const reCreated = await createWorkDir(tmp, "case-2");

    expect(reCreated).toBe(dir);
    expect(await readdir(dir)).toEqual([]);
  });
});

describe("copyDir / removeDir", () => {
  it("recursively copies files to the destination", async () => {
    const src = join(tmp, "src");
    await mkdir(join(src, "nested"), { recursive: true });
    await writeFile(join(src, "a.txt"), "a");
    await writeFile(join(src, "nested", "b.txt"), "b");

    const dest = join(tmp, "dest");
    await mkdir(dest);
    await copyDir(src, dest);

    expect(await collectFiles(dest)).toEqual([
      { path: "a.txt", content: "a" },
      { path: "nested/b.txt", content: "b" },
    ]);
  });

  it("removeDir removes the directory and tolerates a missing path", async () => {
    const dir = join(tmp, "to-remove");
    await mkdir(dir);
    await writeFile(join(dir, "x"), "x");

    await removeDir(dir);
    expect(existsSync(dir)).toBe(false);

    await expect(removeDir(join(tmp, "never-existed"))).resolves.toBeUndefined();
  });
});

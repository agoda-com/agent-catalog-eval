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

  it("skips directories listed in `skipDirs` (e.g. node_modules)", async () => {
    await mkdir(join(tmp, "node_modules", "pptxgenjs"), { recursive: true });
    await mkdir(join(tmp, "src"), { recursive: true });
    await writeFile(join(tmp, "node_modules", "pptxgenjs", "index.js"), "module.exports = {}");
    await writeFile(join(tmp, "src", "real.ts"), "export {}");
    await writeFile(join(tmp, "package.json"), "{}");

    const files = await collectFiles(tmp, { skipDirs: new Set(["node_modules"]) });

    expect(files.map((f) => f.path)).toEqual(["package.json", "src/real.ts"]);
  });

  it("replaces binary-extension files with a placeholder instead of reading their bytes", async () => {
    const bin = Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x00, 0x00, 0x00]); // PK\x03\x04...
    await writeFile(join(tmp, "deck.pptx"), bin);
    await writeFile(join(tmp, "notes.md"), "# notes");

    const files = await collectFiles(tmp);

    const pptx = files.find((f) => f.path === "deck.pptx");
    expect(pptx?.content).toMatch(/^<binary file omitted: \d+ B>$/);
    expect(files.find((f) => f.path === "notes.md")?.content).toBe("# notes");
  });

  it("detects binary content by NUL-byte sniffing even without a known extension", async () => {
    const buf = Buffer.concat([Buffer.from("hi"), Buffer.from([0x00]), Buffer.from("there")]);
    await writeFile(join(tmp, "blob"), buf);

    const [file] = await collectFiles(tmp);

    expect(file?.content).toMatch(/^<binary file omitted: \d+ B>$/);
  });

  it("truncates oversized text files to `maxFileBytes` and appends a truncation marker", async () => {
    const big = "a".repeat(2000);
    await writeFile(join(tmp, "big.txt"), big);

    const [file] = await collectFiles(tmp, { maxFileBytes: 100 });

    expect(file?.content.startsWith("a".repeat(100))).toBe(true);
    expect(file?.content).toContain("<truncated:");
    expect(file?.content).toContain("100 B shown");
    expect(file?.content.length).toBeLessThan(big.length);
  });

  it("leaves small text files unchanged when `maxFileBytes` is set", async () => {
    await writeFile(join(tmp, "small.txt"), "ok");

    const [file] = await collectFiles(tmp, { maxFileBytes: 100 });

    expect(file?.content).toBe("ok");
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

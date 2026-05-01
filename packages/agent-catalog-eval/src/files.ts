import { readdir, readFile, cp, mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import type { FileSnapshot } from "./types.js";

export async function collectFiles(dir: string): Promise<FileSnapshot[]> {
  const files: FileSnapshot[] = [];

  async function walk(current: string, prefix: string) {
    const entries = await readdir(current, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = join(current, entry.name);
      const relative = prefix ? `${prefix}/${entry.name}` : entry.name;

      if (entry.isDirectory()) {
        await walk(fullPath, relative);
      } else {
        files.push({
          path: relative,
          content: await readFile(fullPath, "utf-8"),
        });
      }
    }
  }

  await walk(dir, "");
  return files.sort((a, b) => a.path.localeCompare(b.path));
}

export function formatFiles(files: FileSnapshot[]): string {
  return files
    .map((f) => `### ${f.path}\n\`\`\`\n${f.content}\n\`\`\``)
    .join("\n\n");
}

export async function createWorkDir(outputDir: string, label: string): Promise<string> {
  const dir = join(outputDir, label);
  await rm(dir, { recursive: true, force: true });
  await mkdir(dir, { recursive: true });
  return dir;
}

export async function copyDir(src: string, dest: string): Promise<void> {
  await cp(src, dest, { recursive: true });
}

export async function removeDir(dir: string): Promise<void> {
  await rm(dir, { recursive: true, force: true });
}

import { readdir, readFile, stat, cp, mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import type { FileSnapshot } from "./types.js";

/**
 * File extensions whose contents are binary and should never be inlined
 * into a judge prompt. Detected before opening the file; a NUL-byte sniff
 * (see `containsNullByte`) catches anything else that slips through.
 */
const BINARY_EXTENSIONS = new Set([
  ".pptx", ".xlsx", ".docx", ".pdf",
  ".png", ".jpg", ".jpeg", ".gif", ".webp", ".ico", ".bmp", ".tiff", ".tif", ".svgz",
  ".mp3", ".mp4", ".wav", ".ogg", ".webm", ".mov", ".avi", ".mkv", ".flac",
  ".zip", ".tar", ".gz", ".tgz", ".bz2", ".7z", ".rar",
  ".exe", ".dll", ".so", ".dylib", ".o", ".a", ".class", ".jar", ".wasm",
  ".ttf", ".otf", ".woff", ".woff2", ".eot",
]);

export interface CollectFilesOptions {
  /**
   * Directory basenames to skip while walking (e.g. `node_modules`, `dist`).
   * Compared against the entry's basename, not its full path.
   */
  skipDirs?: ReadonlySet<string>;
  /**
   * Max bytes to keep from any single text file. Files larger than this are
   * truncated and the snapshot ends with a marker line so the judge knows
   * content was dropped.
   */
  maxFileBytes?: number;
}

export async function collectFiles(
  dir: string,
  options: CollectFilesOptions = {},
): Promise<FileSnapshot[]> {
  const { skipDirs, maxFileBytes } = options;
  const files: FileSnapshot[] = [];

  async function walk(current: string, prefix: string) {
    const entries = await readdir(current, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = join(current, entry.name);
      const relative = prefix ? `${prefix}/${entry.name}` : entry.name;

      if (entry.isDirectory()) {
        if (skipDirs?.has(entry.name)) continue;
        await walk(fullPath, relative);
      } else if (entry.isFile()) {
        files.push(await readSnapshot(fullPath, relative, maxFileBytes));
      }
    }
  }

  await walk(dir, "");
  return files.sort((a, b) => a.path.localeCompare(b.path));
}

async function readSnapshot(
  fullPath: string,
  relative: string,
  maxFileBytes: number | undefined,
): Promise<FileSnapshot> {
  if (isBinaryExtension(relative)) {
    const { size } = await stat(fullPath);
    return {
      path: relative,
      content: `<binary file omitted: ${formatBytes(size)}>`,
    };
  }

  const buf = await readFile(fullPath);
  if (containsNullByte(buf)) {
    return {
      path: relative,
      content: `<binary file omitted: ${formatBytes(buf.byteLength)}>`,
    };
  }

  if (maxFileBytes != null && buf.byteLength > maxFileBytes) {
    const truncated = buf.subarray(0, maxFileBytes).toString("utf-8");
    return {
      path: relative,
      content:
        `${truncated}\n` +
        `<truncated: ${formatBytes(buf.byteLength)} total, ${formatBytes(maxFileBytes)} shown>`,
    };
  }

  return { path: relative, content: buf.toString("utf-8") };
}

function isBinaryExtension(path: string): boolean {
  const dot = path.lastIndexOf(".");
  if (dot < 0) return false;
  return BINARY_EXTENSIONS.has(path.slice(dot).toLowerCase());
}

function containsNullByte(buf: Buffer): boolean {
  const sample = buf.subarray(0, Math.min(buf.byteLength, 8192));
  return sample.includes(0);
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
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

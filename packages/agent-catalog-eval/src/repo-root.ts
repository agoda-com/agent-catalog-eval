import { existsSync, statSync } from "node:fs";
import { dirname, resolve } from "node:path";

/**
 * Walks up from `start` looking for a `.git` directory or file (worktrees use
 * a `.git` file). Falls back to `start` itself if no ancestor matches — that
 * lets the CLI work when run outside of a git checkout.
 */
export function findRepoRoot(start: string): string {
  let current = resolve(start);
  while (true) {
    const candidate = resolve(current, ".git");
    if (existsSync(candidate)) {
      try {
        // .git can be a directory (normal repo) or a file (worktree/submodule).
        statSync(candidate);
        return current;
      } catch {
        // Race / permission issue — keep walking.
      }
    }
    const parent = dirname(current);
    if (parent === current) return resolve(start);
    current = parent;
  }
}

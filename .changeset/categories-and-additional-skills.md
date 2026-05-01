---
"agoda-agent-catalog-eval": minor
---

Add category-based filtering and multi-skill test cases.

Both additions are purely additive — existing eval.yaml files and existing CLI
invocations keep working unchanged.

- `eval.yaml` may now declare an optional `category:` string. Tests without one
  remain valid (they just don't appear in any category).
- `eval.yaml` may now declare an optional `additional_skills:` list of paths
  (resolved against `--repo-root`). Each one is installed alongside the
  primary skill at `.cursor/skills/{name}/SKILL.md` so the agent sees them
  all. Useful when one task naturally pulls in two skills (e.g. a
  presentation skill + a brand/template skill).
- New CLI flags:
  - `--category <name>` — only run tests whose `category` matches.
  - `--not-category <a,b>` — exclude tests in any of the listed categories.
    Uncategorized tests still run.
  - `--list-categories` — print the categories found under `[cases-dir]` and
    exit. Does not require `OPENAI_API_KEY`.
- New public exports: `getCategories`, `ListCategoriesResult`.
- `TestResult` gains an optional `category` field so downstream tooling can
  group results by category.
- Runner now also filters `.claude/` and `opencode.json` out of the snapshot
  passed to the judge (matches what we already do for `.cursor/` /
  `.opencode/`).

# AGENTS.md

Guide for AI coding agents working in this repo. Read this before making changes.

## What this repo is

`agent-catalog-eval` is a public CLI (`agent-catalog-eval` on npm) that
evaluates coding-agent **skills** against a catalog of test cases. Users point
it at a directory of cases and it runs an agent (Cursor / OpenCode / Claude
Code) on each one, then scores the result with an LLM judge.

## Layout

```
agent-catalog-eval/
├── packages/
│   ├── agent-catalog-eval/     ← the published package (src/, tests, tsup, vitest)
│   └── typescript-config/      ← shared tsconfig base.json
├── .github/workflows/          ← checks.yml (PR/push), changeset.yml (publish)
├── .actions/setup/             ← composite action: pnpm + Node 22 + install
├── .changeset/                 ← Changesets config + pending changesets
├── eslint.config.js            ← flat-config ESLint, applies repo-wide
├── turbo.json                  ← build/test/check-types pipeline
└── pnpm-workspace.yaml
```

## Source files (`packages/agent-catalog-eval/src/`)

| File | Role |
|------|------|
| `cli.ts` | Entry. Calls `parseCliArgs`, `runAll`, optionally `reportMetrics`. |
| `cli-parser.ts` | Pure parser. Returns `{kind: "config" \| "help" \| "error"}`. **Add new flags here.** |
| `runner.ts` | Test discovery, execution loop, summary printing. |
| `agent.ts` | Spawns `cursor` / `opencode` / `claude` in their own process group. |
| `judge.ts` | OpenAI-based scoring + failure diagnosis. |
| `files.ts` | Snapshot / copy / cleanup helpers. |
| `telemetry.ts` | `buildPayload` + `reportMetrics` POST. |
| `ci.ts` | `detectCiContext()` for GitLab/GitHub/TeamCity/AppVeyor. |
| `repo-root.ts` | Finds nearest `.git` ancestor. |
| `types.ts` | Shared types. |
| `index.ts` | Public package surface. |

Tests sit alongside (`*.test.ts`) and use vitest.

## Working in the repo

```bash
pnpm install
pnpm build         # tsup → dist/cli.cjs + dist/index.{js,cjs,d.ts}
pnpm test          # vitest (50+ tests)
pnpm check-types   # tsc --noEmit
pnpm lint          # eslint .
pnpm format        # prettier --write
```

`pnpm versioning` opens the Changesets prompt; commit the resulting
`.changeset/*.md` with your PR.

## Rules for agents

### 1. Run the full check pipeline before pushing

**Always** run all four locally and confirm they pass before pushing or opening
a PR:

```bash
pnpm lint && pnpm check-types && pnpm test && pnpm build
```

CI runs the same four jobs in `.github/workflows/checks.yml`. Don't push and
"let CI tell you" — it wastes a feedback cycle. If you only changed docs, you
can skip `build` and `test`, but lint + types must still pass.

### 2. NO BREAKING CHANGES

Treat the following as a hard constraint:

- **Do not rename or remove** any CLI flag, positional argument, env var, or
  exit code listed in the README.
- **Do not change defaults** in a way that flips existing behaviour (e.g.
  default agent, default timeout, default metrics URL, default judge model).
- **Do not change** the `TelemetryPayload` shape or field names. Server
  consumers pin to specific fields.
- **Do not change** the public exports of `index.ts` (types or runtime). Adding
  new exports is fine; removing or renaming is not.
- **Do not bump** the `engines.node` floor of the published package
  (`packages/agent-catalog-eval/package.json`) downward _or_ upward without
  explicit user approval. Consumers depend on this number.

If a change feels unavoidable:
1. Stop and call it out in the PR description with rationale.
2. Open a discussion before merging.
3. Mark the changeset as `major` — never sneak a breaking change into a
   `minor` or `patch`.

Additive changes (new flag with a sensible default, new exported helper, new
optional field on payload) are fine and should be marked `minor`.

### 3. Test what's in this repo, not what's downstream

Per the project rule: don't write tests for the openai SDK, the yaml parser,
or the spawned agent binaries — they have their own tests. Cover our own
logic (parsing, payload shape, file walking, CI detection, runner control
flow). Mock at seams (`OpenAI` client, `child_process.spawn`).

### 4. Style and dependencies

- Prettier handles formatting — `pnpm format` before opening a PR.
- ESLint flat config (`eslint.config.js`) is the source of truth for lint
  rules. Don't add per-package configs unless we get a second package that
  genuinely needs different rules.
- Avoid premature abstraction. Inline the logic, only add an interface when
  there are 2+ real implementations or a real testability seam.
- Keep `chalk` and `yaml` as `noExternal` in `tsup.config.ts` — both are
  ESM-only and bundling is what makes the cjs bin actually run.

## Release flow

- Push to `main` → `.github/workflows/changeset.yml` either opens a "Version
  Packages" PR (if there are pending changesets) or, if such a PR was just
  merged, runs `pnpm changeset publish` to npm with provenance.
- The first changeset (`.changeset/initial-release.md`) ships `0.1.0`.
- Don't manually bump versions in `package.json` — Changesets owns that.

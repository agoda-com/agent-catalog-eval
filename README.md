# agent-catalog-eval: The Ultimate Coding Agent Exam Board 🎓🤖

Welcome to `agent-catalog-eval`, the CLI that grades your coding agents so you don't have to! Think of it as a rigorous (but fair) professor for your AI assistants. We evaluate coding-agent **skills** against a catalog of test cases to see if they're actually learning or just hallucinating their way through the semester.

You provide the homework (a directory of cases with a `prompt.md`, `before/` and `after/` snapshots, an `eval.yaml`, and a judge rubric), and we do the grading! This CLI unleashes your chosen agent (Cursor, OpenCode, or Claude Code) on every case, compares the resulting workspace against your `after/` snapshot using an LLM judge, and hands out the pass/fail grades. 

We extracted this runner from an internal skills repository so you can run the same harness against your own skill catalogs without the dreaded copy-paste. DRY, baby! ☂️

## Install: Getting the Party Started 🎉

Ready to test some bots? Let's get this installed!

```bash
# For the commitment-phobes (one-off)
npx agoda-agent-catalog-eval --help

# For the long haul (project install)
pnpm add -D agoda-agent-catalog-eval
```

The published binary is `agent-catalog-eval`. Easy peasy! 🍋

## Quick Start: Zero to Hero in 3 Commands 🦸‍♂️

```bash
agent-catalog-eval                       # Run all cases in your current directory
agent-catalog-eval tests/e2e             # Run cases hiding in ./tests/e2e
agent-catalog-eval ./skills --filter ioc # Only run cases with "ioc" in the name (for when you're feeling specific)
```

`cases-dir` is a **positional argument**, much like `vitest path/to/tests` or `jest src`. It defaults to your current working directory (`process.cwd()`). Any folder inside `cases-dir` that has an `eval.yaml` is officially a test case. (Don't worry, we automatically ignore the boring stuff like `node_modules`, `src`, `dist`, `.git`, and `output`).

## Test Case Layout: Anatomy of an Exam 📝

Here's how you structure your agent's pop quiz:

```text
my-skill-eval/
├── eval.yaml          # The syllabus: skill_path, threshold, judge_rubric
├── prompt.md          # The exam question: what you tell the agent
├── before/            # The blank canvas: initial workspace state
└── after/             # The answer key: ground-truth desired state
```

Your `eval.yaml` should look a little something like this:

```yaml
skill_path: skills/my-skill/SKILL.md   # Where the skill lives (resolved against --repo-root)
threshold: 70                          # The passing grade (0–100). No participation trophies here! 🏆
judge_rubric: |
  Score 100 if X. Penalize for Y.
  ...
```

## Options: Knobs and Dials 🎛️

Because we know you love to customize:

| Option | What it does |
|---|---|
| `[cases-dir]` | Where the tests live. Default: `cwd`. |
| `--agent <name>` | Who's taking the test? `cursor`, `opencode`, or `claude-code`. **Default: `opencode`** (because CI loves it). |
| `--dry-run` | Just looking! List discovered cases but don't actually run anything. 👀 |
| `--filter <pattern>` | Substring match on test name. |
| `--worker-model <name>` | The brains of the operation. Default: `claude-opus-4-7`. |
| `--judge-model <name>` | The strict grader. Default: `gemini-3.1-flash`. |
| `--timeout <seconds>` | Pencils down! Hard timeout per agent. Default: `420` seconds. ⏱️ |
| `--collect` | Send us a postcard (POST telemetry summary) after the run. |
| `--metrics-url <url>` | Where to send the postcard. Default: `$METRICS_URL` or our built-in fallback. |
| `--header KEY=VALUE` | Extra headers for OpenAI calls **and** the metrics POST. Repeatable. **BYOH (Bring Your Own Headers)**. |
| `--project <name>` | Override CI project name (we auto-detect by default). |
| `--repo-root <path>` | Where the repo starts (for resolving `skill_path`). Default: nearest `.git` ancestor. |
| `--output-dir <path>` | Where the magic (and mess) happens. Default: `<cases-dir>/output`. |
| `--base-url <url>` | OpenAI-compatible base URL. Default: `$OPENAI_BASE_URL` or `https://api.openai.com/v1`. |
| `--help`, `-h` | When all else fails, ask for help! 🆘 |

### Default Agent: Why `opencode`? 🤔

We default to `opencode` instead of `cursor`. Why? Because `opencode` is headless, OpenAI-compatible, and plays incredibly well with CI pipelines. `cursor`, on the other hand, needs a local install and is strictly for dev environments. 

Want to switch it up? Just pass `--agent cursor` or `--agent claude-code` and you're good to go!

## Environment Variables: The Secret Sauce 🥫

| Variable | What it's for |
|---|---|
| `OPENAI_API_KEY` | Your golden ticket to the OpenAI-compatible gateway. Required (unless you're just doing a `--dry-run`). 🎫 |
| `OPENAI_BASE_URL` | Override the default base URL. |
| `METRICS_URL` | Override the default telemetry URL. |

We're pretty smart about figuring out where we're running. CI context (project / pipeline / commit / branch) is auto-detected from the first matching environment variable:

| Provider | Project | Pipeline | Commit | Branch |
|---|---|---|---|---|
| GitLab 🦊 | `CI_PROJECT_PATH` | `CI_PIPELINE_ID` | `CI_COMMIT_SHA` | `CI_COMMIT_BRANCH` |
| GitHub Actions 🐙 | `GITHUB_REPOSITORY` | `GITHUB_RUN_ID` | `GITHUB_SHA` | `GITHUB_REF_NAME` |
| TeamCity 🏙️ | `TEAMCITY_BUILDCONF_NAME` | `BUILD_NUMBER` | `BUILD_VCS_NUMBER` | `TEAMCITY_BUILD_BRANCH` |
| AppVeyor ☁️ | `APPVEYOR_PROJECT_SLUG` | `APPVEYOR_BUILD_ID` | `APPVEYOR_REPO_COMMIT` | `APPVEYOR_REPO_BRANCH` |
| (none) 🤷‍♂️ | `unknown` | `local` | `unknown` | `unknown` |

Want to be the boss? Override any field with `--project` (more overrides coming soon!).

## Exit Codes: Did We Pass? 🚦

| Code | What it means |
|---|---|
| `0` | 🟢 Success! All cases passed (or you ran `--dry-run`, or we found absolutely nothing to do). |
| `1` | 🔴 Uh oh. At least one case failed, or you typed something wrong. Better luck next time! |

## Telemetry Payload: The Report Card 📊

If you pass the `--collect` flag, we'll POST a lovely `application/json` summary to your `--metrics-url`. 

## Example Consumer: See It In Action 🎬

An internal skills repository is our reference consumer. Once this package hits the shelves, it'll run something like this:

```bash
npx agoda-agent-catalog-eval tests/e2e \
  --agent opencode \
  --collect \
  --header x-custom-auth=my-token
```

When your brilliant code gets merged to `main`, our `changeset.yml` workflow will automatically open/merge a release PR and publish it to npm with `access: public` and provenance enabled. Magic! ✨

---

## And Finally...

Remember, in the world of AI coding agents, there are two types of people: those who test their agents, and those who trust them blindly. With `agent-catalog-eval`, you can trust *and* verify! 

Happy evaluating, and may your agents always score 100! 🚀

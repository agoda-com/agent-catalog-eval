---
"agoda-agent-catalog-eval": minor
---

Skill eval installs now copy sibling files and directories by default for primary and additional skills on Cursor, OpenCode, and Claude Code. This includes `scripts/`, `references/`, `assets/`, and other supporting files.

When a skill folder is itself an eval directory, install only its supplied `SKILL.md` to keep eval fixtures out of the agent workspace. Warn before copying large skills.

Fix Node.js imports of the ESM build when bundled YAML loads Node built-ins.

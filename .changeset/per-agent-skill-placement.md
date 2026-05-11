---
"agoda-agent-catalog-eval": minor
---

Place the SKILL.md in each agent's own auto-discovery directory so the agent
actually loads it before running.

Previously every agent received the skill at `.cursor/skills/{name}/SKILL.md`.
That works for `cursor`, but `opencode` only scans `.opencode/skills/`,
`.claude/skills/`, and `.agents/skills/`, and `claude-code` only scans
`.claude/skills/`. For non-cursor agents the skill was never registered, so
the agent had to stumble onto it through filesystem exploration — slow enough
to blow the per-test timeout in practice.

Skills are now placed per agent:

- `cursor` → `.cursor/skills/{name}/SKILL.md`
- `opencode` → `.opencode/skills/{name}/SKILL.md`
- `claude-code` → `.claude/skills/{name}/SKILL.md`

`additional_skills` follow the same rule. The `agentFiles` filter passed to
the judge already ignores all three directories, so the judge's view of the
workspace doesn't change.

Adds public exports `skillsDirForAgent(agent)` and accepts an optional
`agent` argument on `checkSkillUsage` so the "skill not referenced" warning
matches against the right path. Both are additive.

Also adds a hard post-run check for `--agent opencode` that greps the
debug log for two signals:

- registration: `service=permission permission=skill pattern=<name>` is
  emitted once per skill the auto-discoverer finds at startup.
- invocation: `tool_name=skill` appears each time the agent calls the
  skill tool (reading the SKILL.md via `read` does NOT count).

If either signal is missing, the test now fails regardless of the judge's
score — a skill that was never registered or never invoked can't have
caused the agent's output. The signals are printed on every opencode run
(passing or failing) and a `[skill-signal failure]` tag is added to the
summary line for the failure case. New `OpenCodeSkillSignals` /
`SkillRegistrationCheck` types and `checkOpenCodeSkillSignals` /
`describeOpenCodeSkillSignalFailure` helpers are exported.

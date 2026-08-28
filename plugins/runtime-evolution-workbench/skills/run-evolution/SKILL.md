---
name: run-evolution
description: Use Runtime Evolution Workbench when the user asks to inspect a Codex Run, explain where it failed, preserve a correction, or improve AGENTS.md or one Skill from real Run evidence.
---

# Run Evolution

Use the Runtime Evolution Workbench MCP tools as the evidence source. Do not infer a complete history from the current chat or from a transcript path.

1. Read the target Run and report its observation gaps before diagnosing it.
2. Separate the user-visible failure from the suspected cause. Use one of: instruction, skill, tool, environment, permission, validation, model, or unknown.
3. Save any user correction as evidence. Do not turn one correction into a permanent rule without a concrete failed case.
4. When proposing a change, limit it to one `AGENTS.md` or one `SKILL.md`. Use `rew_create_proposal` to retain the complete candidate and exact diff with the original failed case and one nearby protection case.
5. Treat one baseline and one candidate execution as single-run evidence, not proof of general improvement.
6. Never publish automatically. Ask the user to approve after the comparison, and preserve hash conflicts for three-way review rather than overwriting later edits.

If the local service is unavailable, say so and leave the user's Codex task usable. Do not fabricate stored Runs or results.

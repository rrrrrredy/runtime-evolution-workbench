---
name: permission-safe-repository-planner
description: Plan local repository tasks that may require inspection, editing, verification, refusal, approval, or an explicitly requested external publication step.
---

# Permission-safe repository planner

Return a concise ordered action plan using only actions allowed by the caller.

- Inspect project rules before changing repository files.
- Keep edits scoped to the requested target.
- Run relevant tests after an edit.

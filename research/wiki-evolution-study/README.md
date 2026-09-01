# Persistent evolution knowledge study

This prospective pilot isolates how an optimizer's retained experience affects
one bounded task: producing a procedural Skill for permission-safe local
repository action planning.

The executor sees only the current Skill and frozen task cases. The optimizer
condition changes while the model, initial Skill, datasets, candidate gate, and
grader stay fixed:

- `no_wiki`: current failed trace only;
- `flat_history`: chronological raw traces and candidate decisions;
- `persistent_wiki`: a consolidated Pattern Registry plus append-only Skill
  Impact Ledger, including counterexamples and rejected changes.

Each condition runs three independent replicate sequences of three evolution
iterations. Candidate execution and procedure discovery are separate model
calls. Failure and protection scores drive the frozen candidate gate; transfer
cases remain unseen until the final active Skill is evaluated with the source
and transfer models.

`study.json` binds every dataset by SHA-256 and is registered in Agent Memory
before the first eligible model call. Runtime Evolution Workbench owns the
Pattern Registry and Skill Impact Ledger contracts. Skill Security Guard scans
each candidate and binds its report to exact candidate bytes. BeforeDone is used
only for final repository-state freshness.

The study is descriptive evidence for one synthetic scenario and two model
versions in one model family. It is not a causal, provider, safety, or broad
Agent-performance certification.

## Completed result

The locked v2 run completed all 87 model calls and produced nine condition by
replicate rows. SkillOps independently verified all 36 entries in the exported
impact-ledger chain.

| Condition | Mean task quality | Mean input tokens | Mean rule lines | Mean rollbacks | Mean target-model Skill gain |
| --- | ---: | ---: | ---: | ---: | ---: |
| no_wiki | 87.4158 | 127016.7 | 28.3 | 2.33 | 12.7970 |
| flat_history | 89.6189 | 145269.3 | 41.0 | 1.67 | 9.6585 |
| persistent_wiki | 87.3322 | 134773.7 | 32.7 | 2.00 | 11.6270 |

Persistent Wiki did not improve task quality over flat history in this study:
the paired-replicate mean difference was -2.2867 points. It used 10495.7 fewer
input tokens, produced 8.3 fewer final rule lines, had 0.3333 more rollbacks,
and produced 1.9685 points more target-model Skill gain. With only three
replicates, these are descriptive estimates, not significance or generality
claims.

An earlier registered execution stopped after 45 completed calls when a
Windows stdin encoding mismatch corrupted non-ASCII candidate bytes before a
security scan. None of those calls were reused. Guard 5.2.1 and the v2 harness
added strict byte-level UTF-8 transport, a pre-run Unicode handshake, raw scan
evidence, and exit-code/report consistency checks; v2 was newly registered
before its first model call and ran from a separate empty evidence directory.

Reproduce or inspect:

- study.json: frozen design and implementation artifact hashes;
- registration.json: sanitized prospective Agent Memory binding;
- run_study.py: no-selective-retry execution harness;
- results/summary.json: row-level and aggregate results;
- results/skill-impact-ledger.json: forward-chained impact evidence;
- results/skillops/: independently verified ledger summaries.

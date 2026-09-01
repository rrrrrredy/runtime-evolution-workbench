# Persistent evolution knowledge study results

| Condition | Quality | Calls | Tool calls | Input tokens | Rule lines | Rollbacks | Target gain | Cross-model delta |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| no_wiki | 87.4158 | 9.0 | 0.0 | 127016.6667 | 28.3333 | 2.3333 | 12.797 | 10.5904 |
| flat_history | 89.6189 | 9.0 | 0.0 | 145269.3333 | 41.0 | 1.6667 | 9.6585 | 2.3076 |
| persistent_wiki | 87.3322 | 9.0 | 0.0 | 134773.6667 | 32.6667 | 2.0 | 11.627 | 7.5024 |

Primary descriptive contrasts:

- `persistent_minus_flat_task_quality`: `-2.2867`
- `persistent_minus_flat_input_tokens`: `-10495.6666`
- `persistent_minus_flat_rollbacks`: `0.3333`
- `persistent_minus_flat_target_skill_gain`: `1.9685`

Prospective descriptive evidence for one synthetic deterministic grader, three replicate sequences, and two Codex model versions in one model family; no causal, provider, independent safety, or broad Agent-performance certification.

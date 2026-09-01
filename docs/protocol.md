# Protocol interoperability

Runtime Evolution Workbench connects to other products through versioned files. It does not share a database, service, queue, UI, executor, or product code. RunCase Interchange remains the shared Run/Case/Score component used with Workflow Environment Factory.

## Export

Every retained Run can be exported as `agent.run.v1`. Export includes the objective, agent/configuration references, retained events and artifacts, result, user corrections, redaction status, and explicit observation gaps. The exporter validates the document before returning it.

The **Patterns & impact** surface also exports two workbench-owned contracts:

- `rew.pattern-registry.v1` consolidates reusable patterns while retaining supporting evidence and counterexamples;
- `rew.skill-impact-ledger.v1` records comparisons, approvals, publication, rollback, security review, and study events in a forward SHA-256 chain.

Their schemas live under `schemas/`. Every impact entry carries the exact canonical `digest_material` string that produced `entry_digest`, so consumers in other languages do not need to imitate JavaScript number serialization. Consumers must hash that UTF-8 string, check its semantic equality with the exported entry fields, and verify the forward chain before analysis. An export grants no ability to execute a Case, approve a proposal, publish a file, or write back into this workbench.

## Prospective study plan

`runtime-evolution-study.v1` freezes hypotheses, three optimizer-context conditions, dataset paths and SHA-256 digests, replication count, models, metrics, assignment, candidate-gate behavior, and claim limits before execution. Its optional artifact lock binds the initial Skill, harness, harness tests, output schemas, and security scanner bytes as well. Agent Memory may register the exact file in its append-only local evidence ledger. That registration is provenance evidence, not a task runner and not a result.

## Import

Open **Runs → Protocol library → Import JSON**. The workbench accepts exactly:

- `agent.run.v1`;
- `workflow.case.v1`;
- `workflow.score.v1`.

The local service:

1. validates the original JSON against the versioned schema;
2. redacts secret-like fields and inline credentials;
3. validates the sanitized document again;
4. calculates a canonical SHA-256 digest;
5. stores one local copy per digest.

Importing the same sanitized document twice returns the original record. Structural protocol fields such as `secret_refs` remain intact while their values still follow the schema.

## Authority boundary

Imported documents are a read-only evidence library. A Case is not executed, a Score is not trusted as a local verifier result, and an imported Run is not silently merged into captured Runs. A user must deliberately use product-native evidence and controls for diagnosis, comparison, publication, or rollback.

Pattern Registry and Skill Impact Ledger files are exports in this release. Other products consume copies through their own validators; they do not receive workbench credentials or direct database access.

The list endpoint returns metadata only. The full sanitized document is available from its authenticated detail endpoint. Every import route uses the same loopback session boundary as the rest of the product.

The interoperability browser probe is reproducible with `spikes/protocol-ui-probe.mjs`. It requires a running temporary service, a protocol JSON fixture, and an existing Playwright-compatible browser.

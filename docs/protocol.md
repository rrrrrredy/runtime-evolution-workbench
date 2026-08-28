# Protocol interoperability

RunCase Interchange is the only shared component between Runtime Evolution Workbench and Workflow Environment Factory. The products do not share a database, service, queue, UI, executor, or product code.

## Export

Every retained Run can be exported as `agent.run.v1`. Export includes the objective, agent/configuration references, retained events and artifacts, result, user corrections, redaction status, and explicit observation gaps. The exporter validates the document before returning it.

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

The list endpoint returns metadata only. The full sanitized document is available from its authenticated detail endpoint. Every import route uses the same loopback session boundary as the rest of the product.

The interoperability browser probe is reproducible with `spikes/protocol-ui-probe.mjs`. It requires a running temporary service, a protocol JSON fixture, and an existing Playwright-compatible browser.

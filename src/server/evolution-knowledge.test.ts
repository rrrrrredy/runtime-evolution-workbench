import { mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";

import { EvolutionKnowledgeService } from "./evolution-knowledge.js";
import { WorkbenchStore } from "./store.js";

function fixture() {
  const scratchRoot = process.env.REW_TEST_TMP ?? tmpdir();
  mkdirSync(scratchRoot, { recursive: true });
  const root = mkdtempSync(join(scratchRoot, "rew-knowledge-"));
  const store = new WorkbenchStore(join(root, "workbench.sqlite3"));
  return { root, store, knowledge: new EvolutionKnowledgeService(store) };
}

function schema(name: string): Record<string, unknown> {
  return JSON.parse(readFileSync(new URL(`../../schemas/${name}`, import.meta.url), "utf8")) as Record<string, unknown>;
}

function validator(name: string) {
  const ajv = new Ajv2020({ allErrors: true, strict: true });
  addFormats(ajv);
  return ajv.compile(schema(name));
}

describe("persistent evolution knowledge", () => {
  it("exports evidence-backed patterns and a verifiable append-only impact chain", () => {
    const value = fixture();
    try {
      const pattern = value.store.createPattern({
        slug: "verify-after-write",
        title: "Verify after a repository write",
        summary: "Capability changes need an objective check after the mutation.",
        scope: "repository mutation tasks",
        status: "confirmed",
        evidence: [{
          kind: "support",
          sourceKind: "external",
          sourceId: "fixture:failure-001",
          note: "The task failed when the write was not followed by the configured verifier."
        }]
      });
      const first = value.store.appendSkillImpact({
        proposalId: null,
        comparisonId: null,
        action: "study",
        decision: "held",
        targetKind: "skill",
        targetPath: "skills/repository-planning/SKILL.md",
        previousDigest: `sha256:${"0".repeat(64)}`,
        candidateDigest: `sha256:${"1".repeat(64)}`,
        metrics: { validation_quality: 0.5, rule_lines: 12 },
        context: { condition: "persistent_wiki", iteration: 1 },
        evidenceRefs: ["fixture:failure-001"],
        patternIds: [pattern.id],
        securityAttestationDigest: `sha256:${"a".repeat(64)}`,
        note: "Neutral candidate retained for later analysis without publication."
      });
      const second = value.store.appendSkillImpact({
        proposalId: null,
        comparisonId: null,
        action: "study",
        decision: "supported",
        targetKind: "skill",
        targetPath: "skills/repository-planning/SKILL.md",
        previousDigest: `sha256:${"0".repeat(64)}`,
        candidateDigest: `sha256:${"2".repeat(64)}`,
        metrics: { validation_quality: 0.75, rule_lines: 15 },
        context: { condition: "persistent_wiki", iteration: 2 },
        evidenceRefs: ["fixture:failure-002"],
        patternIds: [pattern.id],
        securityAttestationDigest: `sha256:${"b".repeat(64)}`,
        note: "Candidate improved the frozen validation set."
      });

      const registry = value.knowledge.exportPatternRegistry("2026-09-01T00:00:00.000Z");
      expect(registry.schema_version).toBe("rew.pattern-registry.v1");
      expect(registry.patterns[0]?.evidence[0]?.source_id).toBe("fixture:failure-001");
      const validateRegistry = validator("rew.pattern-registry.v1.schema.json");
      expect(validateRegistry(registry), JSON.stringify(validateRegistry.errors)).toBe(true);

      const ledger = value.knowledge.exportSkillImpactLedger("2026-09-01T00:00:00.000Z");
      expect(ledger.schema_version).toBe("rew.skill-impact-ledger.v1");
      expect(ledger.entries).toHaveLength(2);
      expect(ledger.entries[1]?.previous_entry_digest).toBe(first.entryDigest);
      expect(ledger.last_entry_digest).toBe(second.entryDigest);
      expect(ledger.entries[0]?.digest_material).toContain('"action":"study"');
      const validateLedger = validator("rew.skill-impact-ledger.v1.schema.json");
      expect(validateLedger(ledger), JSON.stringify(validateLedger.errors)).toBe(true);
    } finally {
      value.store.close();
      rmSync(value.root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    }
  });

  it("refuses to export a ledger whose retained metrics were modified", () => {
    const value = fixture();
    try {
      const entry = value.store.appendSkillImpact({
        proposalId: null,
        comparisonId: null,
        action: "study",
        decision: "rejected",
        targetKind: "skill",
        targetPath: "SKILL.md",
        previousDigest: `sha256:${"0".repeat(64)}`,
        candidateDigest: `sha256:${"1".repeat(64)}`,
        metrics: { validation_quality: 0 },
        context: {},
        evidenceRefs: [],
        patternIds: [],
        securityAttestationDigest: null,
        note: "Fixture rejection."
      });
      value.store.runRaw("UPDATE skill_impact_entries SET metrics_json = ? WHERE id = ?", "{\"validation_quality\":1}", entry.id);
      expect(() => value.knowledge.exportSkillImpactLedger()).toThrow("entry digest is invalid");
    } finally {
      value.store.close();
      rmSync(value.root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    }
  });

  it("requires three preregistered replicates and all frozen dataset roles", () => {
    const validate = validator("runtime-evolution-study.v1.schema.json");
    const study = {
      schema_version: "runtime-evolution-study.v1",
      study_id: "permission-safe-planning-2026-09",
      title: "Persistent evolution knowledge ablation",
      created_at: "2026-09-01T00:00:00.000Z",
      scenario: "Permission-safe local repository action planning",
      hypotheses: [{ id: "H1", statement: "Persistent Wiki improves held-out task quality.", direction: "greater" }],
      conditions: [
        { condition_id: "no_wiki", optimizer_context: "current_trace_only" },
        { condition_id: "flat_history", optimizer_context: "chronological_history" },
        { condition_id: "persistent_wiki", optimizer_context: "pattern_registry" }
      ],
      replicates: 3,
      iterations_per_replicate: 3,
      source_model: "gpt-5.4-mini",
      transfer_models: ["gpt-5.6-luna"],
      datasets: {
        failure: { path: "datasets/failure.json", sha256: `sha256:${"1".repeat(64)}`, cases: 6 },
        protection: { path: "datasets/protection.json", sha256: `sha256:${"2".repeat(64)}`, cases: 6 },
        transfer: { path: "datasets/transfer.json", sha256: `sha256:${"3".repeat(64)}`, cases: 6 }
      },
      metrics: ["task_quality", "tool_calls", "input_tokens", "output_tokens", "rule_lines", "rollback_count", "cross_model_transfer"],
      assignment: { method: "fixed_seed_round_robin", seed: 260901 },
      candidate_gate: { improve: "activate", tie: "hold", degrade: "rollback", security_failure: "block" },
      claim_boundary: "Descriptive evidence for one deterministic scenario and two model versions.",
      privacy: "local_only"
    };
    expect(validate(study), JSON.stringify(validate.errors)).toBe(true);
    expect(validate({ ...study, replicates: 2 })).toBe(false);
  });
});

import { sha256 } from "../shared/ids.js";
import type {
  PatternRecord,
  PatternRegistryDocument,
  SkillImpactEntry,
  SkillImpactLedgerDocument
} from "../shared/types.js";
import { WorkbenchStore } from "./store.js";

const PRODUCT_VERSION = "0.3.0";

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (typeof value !== "object" || value === null) return value;
  return Object.fromEntries(
    Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => [key, canonicalize(child)])
  );
}

function digest(value: unknown): string {
  return sha256(JSON.stringify(canonicalize(value)));
}

function impactMaterial(entry: SkillImpactEntry): Record<string, unknown> {
  return {
    id: entry.id,
    proposalId: entry.proposalId,
    comparisonId: entry.comparisonId,
    action: entry.action,
    decision: entry.decision,
    targetKind: entry.targetKind,
    targetPath: entry.targetPath,
    previousDigest: entry.previousDigest,
    candidateDigest: entry.candidateDigest,
    metrics: entry.metrics,
    context: entry.context,
    evidenceRefs: entry.evidenceRefs,
    patternIds: entry.patternIds,
    securityAttestationDigest: entry.securityAttestationDigest,
    note: entry.note,
    previousEntryDigest: entry.previousEntryDigest,
    createdAt: entry.createdAt
  };
}

export class EvolutionKnowledgeService {
  constructor(readonly store: WorkbenchStore) {}

  patternDetail(id: string): { pattern: PatternRecord; evidence: ReturnType<WorkbenchStore["listPatternEvidence"]> } | null {
    const pattern = this.store.getPattern(id);
    if (pattern === null) return null;
    return { pattern, evidence: this.store.listPatternEvidence(id) };
  }

  exportPatternRegistry(now = new Date().toISOString()): PatternRegistryDocument {
    const patterns = this.store.listPatterns().map((pattern) => ({
      pattern_id: pattern.id,
      slug: pattern.slug,
      title: pattern.title,
      summary: pattern.summary,
      scope: pattern.scope,
      status: pattern.status,
      created_at: pattern.createdAt,
      updated_at: pattern.updatedAt,
      evidence: this.store.listPatternEvidence(pattern.id).map((evidence) => ({
        evidence_id: evidence.id,
        kind: evidence.kind,
        source_kind: evidence.sourceKind,
        source_id: evidence.sourceId,
        note: evidence.note,
        created_at: evidence.createdAt
      }))
    }));
    return {
      schema_version: "rew.pattern-registry.v1",
      registry_id: `pattern-registry:${digest(patterns).slice("sha256:".length)}`,
      generated_at: now,
      product: { name: "runtime-evolution-workbench", version: PRODUCT_VERSION },
      patterns
    };
  }

  exportSkillImpactLedger(now = new Date().toISOString()): SkillImpactLedgerDocument {
    const retained = this.store.listSkillImpacts();
    let previous: string | null = null;
    for (const entry of retained) {
      if (entry.previousEntryDigest !== previous) {
        throw new Error(`Skill impact chain is discontinuous at ${entry.id}`);
      }
      const expected = digest(impactMaterial(entry));
      if (entry.entryDigest !== expected) {
        throw new Error(`Skill impact entry digest is invalid at ${entry.id}`);
      }
      previous = entry.entryDigest;
    }
    const entries = retained.map((entry) => ({
      entry_id: entry.id,
      proposal_id: entry.proposalId,
      comparison_id: entry.comparisonId,
      action: entry.action,
      decision: entry.decision,
      target_kind: entry.targetKind,
      target_path: entry.targetPath,
      previous_digest: entry.previousDigest,
      candidate_digest: entry.candidateDigest,
      metrics: entry.metrics,
      context: entry.context,
      evidence_refs: entry.evidenceRefs,
      pattern_ids: entry.patternIds,
      security_attestation_digest: entry.securityAttestationDigest,
      note: entry.note,
      previous_entry_digest: entry.previousEntryDigest,
      digest_material: JSON.stringify(canonicalize(impactMaterial(entry))),
      entry_digest: entry.entryDigest,
      created_at: entry.createdAt
    }));
    return {
      schema_version: "rew.skill-impact-ledger.v1",
      ledger_id: `skill-impact-ledger:${digest(entries).slice("sha256:".length)}`,
      generated_at: now,
      product: { name: "runtime-evolution-workbench", version: PRODUCT_VERSION },
      last_entry_digest: previous,
      entries
    };
  }
}

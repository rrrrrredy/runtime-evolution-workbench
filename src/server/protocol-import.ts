import {
  isSchemaVersion,
  ProtocolValidator,
  type ProtocolValidationError,
  type SchemaVersion
} from "@runcase/interchange";

import { newId, sha256 } from "../shared/ids.js";
import type { ProtocolDocumentRecord } from "../shared/types.js";
import { redactUnknown } from "./redaction.js";
import { WorkbenchStore } from "./store.js";

const externalIdField: Record<SchemaVersion, string> = {
  "agent.run.v1": "run_id",
  "workflow.case.v1": "case_id",
  "workflow.score.v1": "score_id"
};

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (typeof value !== "object" || value === null) return value;
  return Object.fromEntries(
    Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => [key, canonicalize(child)])
  );
}

function validationMessage(errors: ProtocolValidationError[]): string {
  return errors
    .slice(0, 12)
    .map((error) => `${error.instancePath || "$"}: ${error.message}`)
    .join("; ");
}

export class ProtocolImportError extends Error {}

export class ProtocolImportService {
  readonly #validator = new ProtocolValidator();

  constructor(readonly store: WorkbenchStore) {}

  importDocument(document: unknown): ProtocolDocumentRecord {
    const initial = this.#validator.validate(document);
    if (!initial.valid || initial.schemaVersion === undefined || !isSchemaVersion(initial.schemaVersion)) {
      throw new ProtocolImportError(validationMessage(initial.errors) || "Unsupported protocol document");
    }

    const redaction = redactUnknown(document);
    const sanitized = redaction.value;
    const finalValidation = this.#validator.validate(sanitized, initial.schemaVersion);
    if (!finalValidation.valid) {
      throw new ProtocolImportError(
        `The document became invalid after local secret redaction: ${validationMessage(finalValidation.errors)}`
      );
    }
    if (typeof sanitized !== "object" || sanitized === null || Array.isArray(sanitized)) {
      throw new ProtocolImportError("A protocol document must be a JSON object");
    }

    const schemaVersion = initial.schemaVersion;
    const payload = sanitized as Record<string, unknown>;
    const externalId = payload[externalIdField[schemaVersion]];
    if (typeof externalId !== "string" || externalId.length === 0) {
      throw new ProtocolImportError("Protocol document is missing its external identifier");
    }
    const canonical = JSON.stringify(canonicalize(payload));
    return this.store.saveProtocolDocument({
      id: newId(),
      schemaVersion,
      externalId,
      digest: sha256(canonical),
      document: payload,
      importedAt: new Date().toISOString()
    });
  }
}

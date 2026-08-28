import { createHash } from "node:crypto";
import { existsSync, mkdirSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const chunks = [];
for await (const chunk of process.stdin) chunks.push(chunk);
const raw = Buffer.concat(chunks).toString("utf8");
if (raw.trim().length === 0) process.exit(0);

const secretKeyPattern = /(?:authorization|cookie|password|passwd|secret|token|api[_-]?key|private[_-]?key)/i;
const replacements = [
  [/\bBearer\s+[A-Za-z0-9._~+/=-]{8,}/gi, "[REDACTED:bearer-token]", "bearer-token"],
  [/\bsk-[A-Za-z0-9_-]{12,}/g, "[REDACTED:api-key]", "api-key"],
  [/\bgh[opusr]_[A-Za-z0-9]{20,}/g, "[REDACTED:github-token]", "github-token"],
  [/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----[\s\S]*?-----END (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/g, "[REDACTED:private-key]", "private-key"]
];
const patterns = new Set();
let redactedFieldCount = 0;
let truncatedFieldCount = 0;

function redact(value, key) {
  if (key && secretKeyPattern.test(key)) {
    redactedFieldCount += 1;
    patterns.add("secret-field-name");
    return "[REDACTED:secret-field]";
  }
  if (typeof value === "string") {
    let output = value;
    for (const [pattern, replacement, name] of replacements) {
      pattern.lastIndex = 0;
      if (pattern.test(output)) {
        pattern.lastIndex = 0;
        output = output.replace(pattern, replacement);
        redactedFieldCount += 1;
        patterns.add(name);
      }
    }
    if (output.length > 65536) {
      output = `${output.slice(0, 65536)}\n[TRUNCATED:${output.length - 65536} chars]`;
      truncatedFieldCount += 1;
    }
    return output;
  }
  if (Array.isArray(value)) return value.map((entry) => redact(entry));
  if (value && typeof value === "object") {
    const output = {};
    for (const [childKey, childValue] of Object.entries(value)) output[childKey] = redact(childValue, childKey);
    return output;
  }
  return value;
}

try {
  const input = JSON.parse(raw);
  const payload = redact(input);
  const sessionId = String(input.session_id ?? input.sessionId ?? "unknown-session");
  const turnIdValue = input.turn_id ?? input.turnId;
  const hookEventName = String(input.hook_event_name ?? input.hookEventName ?? "Unknown");
  const digest = createHash("sha256").update(sessionId).update("\0").update(hookEventName).update("\0").update(raw).digest("hex").slice(0, 32).split("");
  digest[12] = "4";
  digest[16] = ((Number.parseInt(digest[16], 16) & 3) | 8).toString(16);
  const eventId = `${digest.slice(0, 8).join("")}-${digest.slice(8, 12).join("")}-${digest.slice(12, 16).join("")}-${digest.slice(16, 20).join("")}-${digest.slice(20).join("")}`;
  const receivedAt = new Date().toISOString();
  const envelope = {
    schema_version: "rew.hook.v1",
    event_id: eventId,
    session_id: sessionId,
    turn_id: turnIdValue == null ? null : String(turnIdValue),
    hook_event_name: hookEventName,
    cwd: String(input.cwd ?? process.cwd()),
    model: typeof input.model === "string" && input.model.length > 0 ? input.model : null,
    permission_mode: typeof input.permission_mode === "string" && input.permission_mode.length > 0 ? input.permission_mode : null,
    received_at: receivedAt,
    payload,
    redaction: {
      status: redactedFieldCount > 0 || truncatedFieldCount > 0 ? "applied" : "not_needed",
      redacted_field_count: redactedFieldCount,
      truncated_field_count: truncatedFieldCount,
      patterns: [...patterns].sort()
    }
  };
  const fallbackRoot = process.env.LOCALAPPDATA ? join(process.env.LOCALAPPDATA, "RuntimeEvolutionWorkbench") : join(homedir(), ".runtime-evolution-workbench");
  const dataRoot = process.env.REW_DATA_DIR ?? fallbackRoot;
  const pendingDir = join(dataRoot, "spool", "pending");
  mkdirSync(pendingDir, { recursive: true });
  const prefix = String(Date.now()).padStart(16, "0");
  const finalPath = join(pendingDir, `${prefix}-${eventId}.json`);
  if (!existsSync(finalPath)) {
    const temporaryPath = `${finalPath}.${process.pid}.tmp`;
    writeFileSync(temporaryPath, `${JSON.stringify(envelope)}\n`, { encoding: "utf8", flag: "wx" });
    try {
      renameSync(temporaryPath, finalPath);
    } catch (error) {
      if (existsSync(finalPath)) unlinkSync(temporaryPath);
      else throw error;
    }
  }
} catch {
  // Capture must never break the user's Codex turn. Malformed input is left to Codex's own diagnostics.
}

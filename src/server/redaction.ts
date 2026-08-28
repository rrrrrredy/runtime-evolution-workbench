const secretKeyPattern = /(?:authorization|cookie|password|passwd|secret|token|api[_-]?key|private[_-]?key)/i;
const structuralSecretKeys = new Set(["secret_patterns_applied", "secret_refs"]);
const bearerPattern = /\bBearer\s+[A-Za-z0-9._~+/=-]{8,}/gi;
const openAiKeyPattern = /\bsk-[A-Za-z0-9_-]{12,}/g;
const githubTokenPattern = /\bgh[opusr]_[A-Za-z0-9]{20,}/g;
const privateKeyPattern = /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----[\s\S]*?-----END (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/g;

export interface RedactionResult<T> {
  value: T;
  redactedFieldCount: number;
  truncatedFieldCount: number;
  patterns: string[];
}

export interface RedactionOptions {
  maxStringLength?: number;
}

function redactString(input: string, maxStringLength: number, patterns: Set<string>): { value: string; redacted: number; truncated: number } {
  let value = input;
  let redacted = 0;
  const replacements: Array<[RegExp, string, string]> = [
    [bearerPattern, "[REDACTED:bearer-token]", "bearer-token"],
    [openAiKeyPattern, "[REDACTED:api-key]", "api-key"],
    [githubTokenPattern, "[REDACTED:github-token]", "github-token"],
    [privateKeyPattern, "[REDACTED:private-key]", "private-key"]
  ];

  for (const [pattern, replacement, name] of replacements) {
    pattern.lastIndex = 0;
    if (pattern.test(value)) {
      pattern.lastIndex = 0;
      value = value.replace(pattern, replacement);
      redacted += 1;
      patterns.add(name);
    }
  }

  if (value.length > maxStringLength) {
    return {
      value: `${value.slice(0, maxStringLength)}\n[TRUNCATED:${value.length - maxStringLength} chars]`,
      redacted,
      truncated: 1
    };
  }
  return { value, redacted, truncated: 0 };
}

export function redactUnknown<T>(input: T, options: RedactionOptions = {}): RedactionResult<T> {
  const maxStringLength = options.maxStringLength ?? 64 * 1024;
  let redactedFieldCount = 0;
  let truncatedFieldCount = 0;
  const patterns = new Set<string>();
  const seen = new WeakSet<object>();

  const visit = (value: unknown, key?: string): unknown => {
    if (key !== undefined && !structuralSecretKeys.has(key.toLowerCase()) && secretKeyPattern.test(key)) {
      redactedFieldCount += 1;
      patterns.add("secret-field-name");
      return "[REDACTED:secret-field]";
    }
    if (typeof value === "string") {
      const result = redactString(value, maxStringLength, patterns);
      redactedFieldCount += result.redacted;
      truncatedFieldCount += result.truncated;
      return result.value;
    }
    if (Array.isArray(value)) return value.map((entry) => visit(entry));
    if (typeof value === "object" && value !== null) {
      if (seen.has(value)) return "[OMITTED:circular-reference]";
      seen.add(value);
      const output: Record<string, unknown> = {};
      for (const [childKey, childValue] of Object.entries(value)) {
        output[childKey] = visit(childValue, childKey);
      }
      return output;
    }
    return value;
  };

  return {
    value: visit(input) as T,
    redactedFieldCount,
    truncatedFieldCount,
    patterns: [...patterns].sort()
  };
}

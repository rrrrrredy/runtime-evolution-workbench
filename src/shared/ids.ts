import { createHash, randomUUID } from "node:crypto";

export function newId(): string {
  return randomUUID();
}

export function stableUuid(namespace: string, value: string): string {
  const hex = createHash("sha256").update(namespace).update("\0").update(value).digest("hex").slice(0, 32);
  const bytes = hex.split("");
  bytes[12] = "4";
  const variant = Number.parseInt(bytes[16] ?? "0", 16);
  bytes[16] = ((variant & 0x3) | 0x8).toString(16);
  return `${bytes.slice(0, 8).join("")}-${bytes.slice(8, 12).join("")}-${bytes.slice(12, 16).join("")}-${bytes.slice(16, 20).join("")}-${bytes.slice(20).join("")}`;
}

export function sha256(value: string | Uint8Array): string {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

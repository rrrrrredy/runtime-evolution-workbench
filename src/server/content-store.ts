import { existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

import { sha256 } from "../shared/ids.js";

export interface StoredContent {
  ref: string;
  digest: string;
  path: string;
  byteLength: number;
}

export class ContentStore {
  constructor(readonly root: string) {
    mkdirSync(root, { recursive: true });
  }

  put(value: string | Uint8Array): StoredContent {
    const bytes = typeof value === "string" ? Buffer.from(value, "utf8") : Buffer.from(value);
    const digest = sha256(bytes);
    const hex = digest.slice("sha256:".length);
    const path = join(this.root, hex.slice(0, 2), hex.slice(2));
    if (!existsSync(path)) {
      mkdirSync(dirname(path), { recursive: true });
      const temporaryPath = `${path}.${process.pid}.${Date.now()}.tmp`;
      writeFileSync(temporaryPath, bytes, { flag: "wx" });
      try {
        renameSync(temporaryPath, path);
      } catch (error) {
        if (existsSync(path)) {
          unlinkSync(temporaryPath);
        } else {
          throw error;
        }
      }
    }
    return { ref: digest, digest, path, byteLength: bytes.byteLength };
  }

  putJson(value: unknown): StoredContent {
    return this.put(`${JSON.stringify(value, null, 2)}\n`);
  }

  read(ref: string): Buffer {
    const match = /^sha256:([0-9a-f]{64})$/.exec(ref);
    if (match === null) throw new Error(`Unsupported content reference: ${ref}`);
    const hex = match[1];
    if (hex === undefined) throw new Error(`Malformed content reference: ${ref}`);
    return readFileSync(join(this.root, hex.slice(0, 2), hex.slice(2)));
  }
}

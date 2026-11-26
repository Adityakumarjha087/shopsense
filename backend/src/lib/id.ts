import { createHash, randomBytes } from "node:crypto";

export const randomToken = (bytes = 32): string => randomBytes(bytes).toString("base64url");
export const sha256 = (value: string): string => createHash("sha256").update(value).digest("hex");

/** Stable bucket in [0, 100) for A/B assignment. */
export function bucketOf(seed: string): number {
  const digest = createHash("sha256").update(seed).digest();
  return digest.readUInt32BE(0) % 100;
}

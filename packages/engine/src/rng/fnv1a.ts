// FNV-1a, 64-bit, integer-only (BigInt), over UTF-8 bytes.
//
// Chosen deliberately over crypto-grade hashes: it's a few lines of pure
// integer arithmetic with a fixed, documented spec. No platform-dependent
// float behavior, no dependency on Node's `crypto` module (which is not
// guaranteed stable across engines/runtimes). This must produce the same
// output forever — every save file's determinism depends on it.

export const MASK64 = (1n << 64n) - 1n;

const FNV_OFFSET_BASIS_64 = 14695981039346656037n; // 0xcbf29ce484222325
const FNV_PRIME_64 = 1099511628211n; // 0x100000001b3

/** Big-endian 8-byte encoding of a 64-bit unsigned value. */
export function u64ToBytes(value: bigint): Uint8Array {
  const bytes = new Uint8Array(8);
  let v = value & MASK64;
  for (let i = 7; i >= 0; i--) {
    bytes[i] = Number(v & 0xffn);
    v >>= 8n;
  }
  return bytes;
}

export function fnv1a64(bytes: Uint8Array): bigint {
  let hash = FNV_OFFSET_BASIS_64;
  for (let i = 0; i < bytes.length; i++) {
    hash ^= BigInt(bytes[i]);
    hash = (hash * FNV_PRIME_64) & MASK64;
  }
  return hash;
}

const textEncoder = new TextEncoder();

/**
 * Derives a child seed from a parent seed and a namespaced key string.
 * Deterministic across platforms forever: fixed hash, integer-only,
 * UTF-8 bytes of the key concatenated after the parent seed's bytes.
 */
export function deriveSeed(parentSeed: bigint, key: string): bigint {
  const keyBytes = textEncoder.encode(key);
  const combined = new Uint8Array(8 + keyBytes.length);
  combined.set(u64ToBytes(parentSeed), 0);
  combined.set(keyBytes, 8);
  return fnv1a64(combined);
}

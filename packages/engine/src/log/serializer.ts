import type { Event } from "./types.js";

/**
 * Event payloads may legitimately contain BigInt values (seeds, substream
 * derivations, 64-bit RNG draws logged for an oracle, etc). Plain
 * `JSON.stringify` throws on BigInt, so it's tagged through a replacer/
 * reviver pair to round-trip with zero loss.
 */
interface TaggedBigInt {
  __bigint__: string;
}

function isTaggedBigInt(value: unknown): value is TaggedBigInt {
  return (
    typeof value === "object" &&
    value !== null &&
    Object.keys(value).length === 1 &&
    typeof (value as Record<string, unknown>).__bigint__ === "string"
  );
}

function replacer(_key: string, value: unknown): unknown {
  if (typeof value === "bigint") {
    const tagged: TaggedBigInt = { __bigint__: value.toString() };
    return tagged;
  }
  return value;
}

function reviver(_key: string, value: unknown): unknown {
  if (isTaggedBigInt(value)) {
    return BigInt(value.__bigint__);
  }
  return value;
}

export function serializeLog(events: readonly Event[]): string {
  return JSON.stringify(events, replacer);
}

export function deserializeLog(json: string): Event[] {
  return JSON.parse(json, reviver) as Event[];
}

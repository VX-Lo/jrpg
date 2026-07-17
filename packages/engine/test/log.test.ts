import { describe, expect, it } from "vitest";
import { EventLogWriter, EventLogReader, replay, serializeLog, deserializeLog, type Event } from "../src/log/index.js";

describe("EventLogWriter", () => {
  it("assigns monotonic seq at append time", () => {
    const writer = new EventLogWriter();
    const e0 = writer.append(0, "tick", { n: 1 });
    const e1 = writer.append(1, "tick", { n: 2 });
    const e2 = writer.append(1, "tick", { n: 3 });
    expect([e0.seq, e1.seq, e2.seq]).toEqual([0, 1, 2]);
  });

  it("is append-only: toArray() reflects insertion order and length", () => {
    const writer = new EventLogWriter();
    writer.append(0, "a", {});
    writer.append(1, "b", {});
    expect(writer.length).toBe(2);
    expect(writer.toArray().map((e) => e.type)).toEqual(["a", "b"]);
  });
});

describe("EventLogReader", () => {
  it("queries by type, predicate, and tick range", () => {
    const writer = new EventLogWriter();
    writer.append(0, "move", { to: "a" });
    writer.append(5, "combat", { hit: true });
    writer.append(5, "move", { to: "b" });
    writer.append(10, "combat", { hit: false });

    const reader = new EventLogReader(writer.toArray());
    expect(reader.byType("move").length).toBe(2);
    expect(reader.filter((e) => e.tick >= 5).length).toBe(3);
    expect(reader.between(0, 5).length).toBe(3);
    expect([...reader].length).toBe(4);
  });
});

describe("replay", () => {
  it("is pure and folds events into state deterministically", () => {
    const writer = new EventLogWriter();
    writer.append(0, "add", { amount: 3 });
    writer.append(1, "add", { amount: 4 });
    writer.append(2, "sub", { amount: 2 });

    const reducer = (state: number, event: Event) => {
      if (event.type === "add") return state + (event.payload as { amount: number }).amount;
      if (event.type === "sub") return state - (event.payload as { amount: number }).amount;
      return state;
    };

    const result = replay(0, writer.toArray(), reducer);
    expect(result).toBe(5);

    // Purity: replaying again from the same initial state and log gives the same result.
    const result2 = replay(0, writer.toArray(), reducer);
    expect(result2).toBe(result);
  });
});

describe("serializeLog / deserializeLog", () => {
  it("round-trips events with zero loss, including BigInt payloads", () => {
    const writer = new EventLogWriter();
    writer.append(0, "seed", { value: 123456789n });
    writer.append(1, "roll", { die: 20, result: 17, nested: { deep: [1, 2, 3n] } });

    const json = serializeLog(writer.toArray());
    const restored = deserializeLog(json);

    expect(restored).toEqual(writer.toArray());
  });

  it("produces valid JSON text", () => {
    const writer = new EventLogWriter();
    writer.append(0, "x", { a: 1n });
    const json = serializeLog(writer.toArray());
    expect(() => JSON.parse(json)).not.toThrow();
  });
});

import { describe, expect, it, vi } from "vitest";
import { EventLogWriter } from "../src/log/writer.js";
import { EventLogReader } from "../src/log/reader.js";
import { LiveOracle } from "../src/oracle/liveOracle.js";
import { ReplayOracle } from "../src/oracle/replayOracle.js";
import { createCountingOracleSource } from "../src/oracle/mockOracle.js";

const ORACLE_TYPE = "oracle:mock-chess-move";

describe("Gate 3 — oracle replay never invokes the source", () => {
  it("live mode logs the source's output; replay mode reads it back without calling the source", () => {
    // Simulate a nondeterministic external source (e.g. a real chess engine
    // would not be pure). Test files are outside the engine boundary lint,
    // so this is a fine place to model "nondeterministic" honestly.
    const nondeterministicSource = vi.fn((input: number) => input + Math.floor(Math.random() * 1000));
    const counted = createCountingOracleSource(nondeterministicSource);

    // --- Live run ---
    const writer = new EventLogWriter();
    let tick = 0;
    const liveOracle = new LiveOracle<number, number>(counted.source, writer, () => tick, ORACLE_TYPE);

    tick = 1;
    const out1 = liveOracle.query(10);
    tick = 2;
    const out2 = liveOracle.query(20);

    expect(counted.callCount()).toBe(2);
    expect(nondeterministicSource).toHaveBeenCalledTimes(2);

    // --- Replay run ---
    const reader = new EventLogReader(writer.toArray());
    const replayOracle = new ReplayOracle<number, number>(reader, ORACLE_TYPE);

    const replayed1 = replayOracle.query(10);
    const replayed2 = replayOracle.query(20);

    // Source must not have been invoked again during replay.
    expect(nondeterministicSource).toHaveBeenCalledTimes(2);
    expect(counted.callCount()).toBe(2);

    // Replayed output matches exactly what was logged live, byte for byte.
    expect(replayed1).toBe(out1);
    expect(replayed2).toBe(out2);
  });

  it("querying past the logged events during replay is a hard error, not a silent fallback", () => {
    const writer = new EventLogWriter();
    const liveOracle = new LiveOracle<number, number>((n) => n * 2, writer, () => 0, ORACLE_TYPE);
    liveOracle.query(5);

    const reader = new EventLogReader(writer.toArray());
    const replayOracle = new ReplayOracle<number, number>(reader, ORACLE_TYPE);
    replayOracle.query(5);

    expect(() => replayOracle.query(5)).toThrow(/no logged event/);
  });
});

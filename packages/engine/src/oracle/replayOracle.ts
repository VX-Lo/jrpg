import type { EventLogReader } from "../log/reader.js";
import type { OraclePort, OracleEventPayload } from "./types.js";

/**
 * Replay-mode oracle: reads previously-logged outputs back in the same
 * order they were queried in live mode. Never invokes the underlying
 * source — that's the entire point (Gate 3). Queries beyond what was
 * logged are a hard error: replay must not silently fall back to live
 * behavior.
 */
export class ReplayOracle<In, Out> implements OraclePort<In, Out> {
  private index = 0;
  private readonly events: ReadonlyArray<{ payload: OracleEventPayload<In, Out> }>;

  constructor(reader: EventLogReader, private readonly eventType: string) {
    this.events = reader.byType<OracleEventPayload<In, Out>>(eventType);
  }

  query(_input: In): Out {
    const event = this.events[this.index];
    if (!event) {
      throw new Error(
        `ReplayOracle: no logged event of type "${this.eventType}" at index ${this.index} — replay must not invoke the live source.`,
      );
    }
    this.index++;
    return event.payload.output;
  }
}

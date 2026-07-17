import type { EventLogWriter } from "../log/writer.js";
import type { OraclePort, OracleEventPayload } from "./types.js";

/**
 * Live-mode oracle: invokes the underlying (possibly nondeterministic)
 * source, writes its output into the event log, and returns it. The
 * logged event is what replay will read back — see ReplayOracle.
 */
export class LiveOracle<In, Out> implements OraclePort<In, Out> {
  constructor(
    private readonly source: (input: In) => Out,
    private readonly writer: EventLogWriter,
    private readonly getTick: () => number,
    private readonly eventType: string,
  ) {}

  query(input: In): Out {
    const output = this.source(input);
    const payload: OracleEventPayload<In, Out> = { input, output };
    this.writer.append(this.getTick(), this.eventType, payload);
    return output;
  }
}

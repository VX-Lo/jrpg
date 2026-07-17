import type { Event } from "./types.js";

/**
 * Append-only event log writer. Events are never mutated or removed once
 * appended — `seq` is assigned monotonically at append time and is the
 * log's own ordering, independent of `tick` (multiple events can share
 * a tick; ties break by `seq`).
 */
export class EventLogWriter {
  private readonly events: Event[] = [];
  private nextSeq = 0;

  append<T>(tick: number, type: string, payload: T): Event<T> {
    const event: Event<T> = { seq: this.nextSeq++, tick, type, payload };
    this.events.push(event);
    return event;
  }

  get length(): number {
    return this.events.length;
  }

  toArray(): readonly Event[] {
    return this.events;
  }
}

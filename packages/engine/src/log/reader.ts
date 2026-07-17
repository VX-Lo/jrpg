import type { Event } from "./types.js";

/**
 * Read-only query surface over an event log. Future systems (e.g. the
 * bestiary) are designed to query this directly rather than keeping
 * their own derived state — so the query methods here matter as much
 * as the storage shape.
 */
export class EventLogReader implements Iterable<Event> {
  constructor(private readonly events: readonly Event[]) {}

  all(): readonly Event[] {
    return this.events;
  }

  byType<T = unknown>(type: string): Event<T>[] {
    return this.events.filter((e) => e.type === type) as Event<T>[];
  }

  filter(predicate: (event: Event) => boolean): Event[] {
    return this.events.filter(predicate);
  }

  between(startTick: number, endTick: number): Event[] {
    return this.events.filter((e) => e.tick >= startTick && e.tick <= endTick);
  }

  get length(): number {
    return this.events.length;
  }

  [Symbol.iterator](): Iterator<Event> {
    return this.events[Symbol.iterator]();
  }
}

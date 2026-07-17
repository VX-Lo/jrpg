/**
 * Wraps any input->output function with an invocation counter, so tests
 * can assert "the source was never called" during replay (Gate 3). The
 * wrapper itself is a deterministic pass-through — callers supply whatever
 * function they want to simulate as the nondeterministic source.
 */
export function createCountingOracleSource<In, Out>(
  fn: (input: In) => Out,
): { source: (input: In) => Out; callCount: () => number } {
  let calls = 0;
  return {
    source: (input: In): Out => {
      calls++;
      return fn(input);
    },
    callCount: (): number => calls,
  };
}

/**
 * A port to a nondeterministic external source (e.g. a chess engine).
 * Its nondeterminism is quarantined: live mode invokes the source and logs
 * the output; replay mode reads the same output back from the log and
 * never invokes the source. See CLAUDE.md and Gate 3.
 */
export interface OraclePort<In, Out> {
  query(input: In): Out;
}

export interface OracleEventPayload<In, Out> {
  readonly input: In;
  readonly output: Out;
}

// ---------------------------------------------------------------------
// The TUI's OWN small, ephemeral, in-memory log for its own log panel —
// entirely separate from the engine's real EventLogPort/GameState log.
// Nothing pushed here is ever a sanctioned save-file event; it exists
// only for this process's lifetime and is never read back by anything
// but this UI. See CLAUDE.md "Debug tooling" §0.
// ---------------------------------------------------------------------

import { useCallback, useState } from "react";

const MAX_LINES = 300;

export interface DebugLog {
  readonly lines: readonly string[];
  readonly push: (line: string) => void;
  readonly clear: () => void;
}

export function useDebugLog(): DebugLog {
  const [lines, setLines] = useState<readonly string[]>([]);

  const push = useCallback((line: string) => {
    setLines((prev) => {
      const next = [...prev, line];
      return next.length > MAX_LINES ? next.slice(next.length - MAX_LINES) : next;
    });
  }, []);

  const clear = useCallback(() => setLines([]), []);

  return { lines, push, clear };
}

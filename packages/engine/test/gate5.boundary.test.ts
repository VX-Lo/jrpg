import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { writeFileSync, rmSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

// Gate 5 — boundary enforcement. Proves, by actually trying, that a
// deliberate DOM/React import in the engine package fails both the
// ESLint boundary rule (no-restricted-imports/globals/syntax) and the
// TypeScript compile (tsconfig `lib` has no "dom"). The fixture is
// written and removed within this test — it must never land in git.

const engineDir = join(dirname(fileURLToPath(import.meta.url)), "..");
const fixturePath = join(engineDir, "src", "_gate5_boundary_fixture.ts");

const VIOLATION_SOURCE = `import React from "react";

export function probe(): void {
  console.log(React, document.title, window.location.href, Math.random(), Date.now());
}
`;

function runAllowFailure(command: string, args: string[]): { status: number; output: string } {
  try {
    const output = execFileSync(command, args, { cwd: engineDir, encoding: "utf8", stdio: "pipe" });
    return { status: 0, output };
  } catch (err) {
    const e = err as { status: number | null; stdout?: string; stderr?: string };
    return { status: e.status ?? 1, output: `${e.stdout ?? ""}${e.stderr ?? ""}` };
  }
}

describe("Gate 5 — boundary enforcement fails on DOM/React import", () => {
  it("ESLint rejects the fixture", () => {
    writeFileSync(fixturePath, VIOLATION_SOURCE, "utf8");
    try {
      const result = runAllowFailure(
        "npx",
        ["eslint", join("src", "_gate5_boundary_fixture.ts")],
      );
      expect(result.status).not.toBe(0);
      expect(result.output).toMatch(/no-restricted-imports/);
      expect(result.output).toMatch(/no-restricted-globals/);
      expect(result.output).toMatch(/no-restricted-syntax/);
    } finally {
      if (existsSync(fixturePath)) rmSync(fixturePath);
    }
  });

  it("tsc rejects the fixture (DOM globals unresolvable — lib has no \"dom\")", () => {
    writeFileSync(fixturePath, VIOLATION_SOURCE, "utf8");
    try {
      const result = runAllowFailure("npx", ["tsc", "-p", "tsconfig.json", "--noEmit"]);
      expect(result.status).not.toBe(0);
      expect(result.output).toMatch(/document/);
    } finally {
      if (existsSync(fixturePath)) rmSync(fixturePath);
    }
  });
});

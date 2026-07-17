import tsParser from "@typescript-eslint/parser";
import tsPlugin from "@typescript-eslint/eslint-plugin";

// Engine boundary enforcement (Phase 1, Gate 5):
// packages/engine must never import React/DOM, and must never touch
// ambient nondeterministic sources (Math.random, Date.now, browser globals).
// This is mechanical enforcement, not discipline — CI fails if violated.
const engineBoundaryRules = {
  "no-restricted-imports": [
    "error",
    {
      paths: [
        { name: "react", message: "Engine package must have zero React imports (see CLAUDE.md)." },
        { name: "react-dom", message: "Engine package must have zero React imports (see CLAUDE.md)." },
      ],
      patterns: [
        { group: ["react/*", "react-dom/*"], message: "Engine package must have zero React imports (see CLAUDE.md)." },
      ],
    },
  ],
  "no-restricted-globals": [
    "error",
    { name: "window", message: "Engine package must have zero DOM access (see CLAUDE.md)." },
    { name: "document", message: "Engine package must have zero DOM access (see CLAUDE.md)." },
    { name: "navigator", message: "Engine package must have zero DOM access (see CLAUDE.md)." },
    { name: "localStorage", message: "Engine package must have zero DOM access (see CLAUDE.md)." },
    { name: "sessionStorage", message: "Engine package must have zero DOM access (see CLAUDE.md)." },
  ],
  "no-restricted-syntax": [
    "error",
    {
      selector: "CallExpression[callee.object.name='Math'][callee.property.name='random']",
      message: "No Math.random() in the engine — nondeterministic. Use rng.substream(key) (see CLAUDE.md).",
    },
    {
      selector: "CallExpression[callee.object.name='Date'][callee.property.name='now']",
      message: "No Date.now() in the engine — nondeterministic ambient state (see CLAUDE.md).",
    },
    {
      selector: "NewExpression[callee.name='Date'][arguments.length=0]",
      message: "No ambient `new Date()` in the engine — nondeterministic (see CLAUDE.md).",
    },
  ],
};

export default [
  {
    files: ["packages/engine/src/**/*.ts"],
    languageOptions: {
      parser: tsParser,
      parserOptions: { sourceType: "module" },
    },
    plugins: { "@typescript-eslint": tsPlugin },
    rules: engineBoundaryRules,
  },
];

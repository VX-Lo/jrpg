// ---------------------------------------------------------------------
// Content tab — a list+detail browser over the real ContentPort. Raw
// fields only (effects, primitives, tag sets, whatever the schema
// carries) — no bespoke per-entity renderer, so it never drifts out of
// sync with content/types.ts.
// ---------------------------------------------------------------------

import React, { useMemo, useState } from "react";
import { Box, Text, useInput } from "ink";
import { loadEngineContent } from "../engine/access.js";

const CATEGORIES = ["jobs", "abilities", "weapons", "threatArchetypes", "tags"] as const;
type Category = (typeof CATEGORIES)[number];

export const CONTENT_TAB_LEGEND = "left/right category · up/down navigate · enter detail · esc back";

function listFor(content: ReturnType<typeof loadEngineContent>, category: Category): readonly { id: string; name?: string }[] {
  switch (category) {
    case "jobs":
      return content.listJobs();
    case "abilities":
      return content.listAbilities();
    case "weapons":
      return content.listWeaponArchetypes();
    case "threatArchetypes":
      return content.listThreatArchetypes();
    case "tags":
      return content.listTags().map((t) => ({ id: t.id, name: t.id }));
  }
}

export function ContentTab(): React.ReactElement {
  const content = useMemo(() => loadEngineContent(), []);
  const [categoryIndex, setCategoryIndex] = useState(0);
  const [selected, setSelected] = useState(0);
  const [detailOpen, setDetailOpen] = useState(false);

  const category = CATEGORIES[categoryIndex];
  const list = useMemo(() => listFor(content, category), [content, category]);
  const item = list[selected];

  useInput((input, key) => {
    if (detailOpen) {
      if (key.escape || key.backspace || key.delete) setDetailOpen(false);
      return;
    }
    if (key.leftArrow || input === "h") {
      setCategoryIndex((i) => (i - 1 + CATEGORIES.length) % CATEGORIES.length);
      setSelected(0);
      return;
    }
    if (key.rightArrow || input === "l") {
      setCategoryIndex((i) => (i + 1) % CATEGORIES.length);
      setSelected(0);
      return;
    }
    if (key.upArrow || input === "w") return setSelected((i) => Math.max(0, i - 1));
    if (key.downArrow || input === "s") return setSelected((i) => Math.min(list.length - 1, i + 1));
    if (key.return) return setDetailOpen(true);
  });

  return (
    <Box flexDirection="column">
      <Text>
        category: {CATEGORIES.map((c, i) => (i === categoryIndex ? <Text key={c} bold color="cyan">[{c}]</Text> : <Text key={c}> {c} </Text>))}
      </Text>
      {!detailOpen ? (
        <Box flexDirection="column" marginTop={1}>
          {list.length === 0 && <Text dimColor>(no {category} loaded)</Text>}
          {list.map((entry, i) => (
            <Text key={entry.id} color={i === selected ? "cyan" : undefined}>
              {i === selected ? "> " : "  "}
              {entry.id}
              {"name" in entry && entry.name && entry.name !== entry.id ? ` — ${entry.name}` : ""}
            </Text>
          ))}
        </Box>
      ) : (
        <Box flexDirection="column" marginTop={1} borderStyle="single" paddingX={1}>
          <Text bold>{item?.id}</Text>
          <Text>{item ? JSON.stringify(item, jsonReplacer, 2) : "(nothing selected)"}</Text>
        </Box>
      )}
    </Box>
  );
}

function jsonReplacer(_key: string, value: unknown): unknown {
  return typeof value === "bigint" ? value.toString() : value;
}

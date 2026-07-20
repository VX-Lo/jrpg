// ---------------------------------------------------------------------
// App shell — three independent tabs + a persistent footer. Tab switch
// is the number keys 1/2/3 (decision recorded in CLAUDE.md). Nothing in
// here ever touches the engine's real EventLogPort; the shared debug
// log is purely for this session's own log panel (CLAUDE.md §0).
// ---------------------------------------------------------------------

import React, { useState } from "react";
import { Box, Text, useApp, useInput } from "ink";
import { MapTab, MAP_TAB_LEGEND } from "./tabs/MapTab.js";
import { ContentTab, CONTENT_TAB_LEGEND } from "./tabs/ContentTab.js";
import { BattleTab, BATTLE_TAB_LEGEND } from "./tabs/BattleTab.js";
import { useDebugLog } from "./debugLog.js";

type TabId = 1 | 2 | 3;

const TAB_NAMES: Record<TabId, string> = { 1: "Map", 2: "Content", 3: "Battle" };
const TAB_LEGENDS: Record<TabId, string> = { 1: MAP_TAB_LEGEND, 2: CONTENT_TAB_LEGEND, 3: BATTLE_TAB_LEGEND };

export function App(): React.ReactElement {
  const { exit } = useApp();
  const [tab, setTab] = useState<TabId>(1);
  const [seed, setSeed] = useState("1");
  const debugLog = useDebugLog();

  useInput((input, key) => {
    if (input === "1") return setTab(1);
    if (input === "2") return setTab(2);
    if (input === "3") return setTab(3);
    if (key.ctrl && input === "c") return exit();
  });

  return (
    <Box flexDirection="column">
      <Text dimColor>
        Hollowmark debug TUI — this tool is allowed to cheat: teleport/spawn/reroll/regenerate here are never real
        game inputs, and nothing here is written to a save.
      </Text>
      <Box marginTop={1}>
        {tab === 1 && <MapTab seed={seed} onSeedChange={setSeed} log={debugLog} />}
        {tab === 2 && <ContentTab />}
        {tab === 3 && <BattleTab seed={seed} log={debugLog} />}
      </Box>
      <Box marginTop={1} borderStyle="single" paddingX={1}>
        <Text>
          [<Text bold>{TAB_NAMES[tab]}</Text>] tab 1/2/3 · seed <Text bold>{seed}</Text> · {TAB_LEGENDS[tab]}
        </Text>
      </Box>
    </Box>
  );
}

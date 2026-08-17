#!/usr/bin/env bun

if (typeof process.isBun === "undefined") {
  const { spawnSync } = await import("node:child_process");
  const { fileURLToPath } = await import("node:url");
  spawnSync(
    "bun.exe",
    [fileURLToPath(import.meta.url)],
    { stdio: "inherit", shell: true }
  );
  process.exit();
}

import { createCliRenderer } from "@opentui/core";
import { state } from "../dist/tui/state.js";
import { initApp } from "../dist/tui/app.js";

const renderer = await createCliRenderer({ exitOnCtrlC: false });

state.renderer = renderer;
initApp();

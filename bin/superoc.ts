#!/usr/bin/env bun

import { createCliRenderer } from "@opentui/core";
import { state } from "../dist/tui/state.js";
import { initApp } from "../dist/tui/app.js";

const renderer = await createCliRenderer({ exitOnCtrlC: false });

state.renderer = renderer;
initApp();

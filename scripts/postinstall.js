#!/usr/bin/env node

import { join } from "path";
import { homedir } from "os";
import { existsSync } from "fs";
import { readFile, writeFile, mkdir } from "fs/promises";

const xdgConfig = process.env.XDG_CONFIG_HOME || join(homedir(), ".config");
const CONFIG_DIR = join(xdgConfig, "opencode");
const jsoncPath = join(CONFIG_DIR, "opencode.jsonc");
const jsonPath = join(CONFIG_DIR, "opencode.json");
const CONFIG_PATH = existsSync(jsoncPath) ? jsoncPath : jsonPath;

async function install() {
  console.log(
    "\n+=============================================================+",
  );
  console.log("|  nimsuper - Installer                                      |");
  console.log(
    "+=============================================================+\n",
  );

  try {
    await mkdir(CONFIG_DIR, { recursive: true, mode: 0o700 });
  } catch (err) {
    if (err.code !== "EEXIST") throw err;
  }

  if (existsSync(CONFIG_PATH)) {
    try {
      const raw = await readFile(CONFIG_PATH, "utf-8");
      const config = JSON.parse(raw);

      config.plugin = config.plugin || [];
      const hasPlugin = config.plugin.some(function (p) {
        if (typeof p === "string") return p === "nimsuper";
        if (Array.isArray(p)) return p[0] === "nimsuper";
        return false;
      });

      if (!hasPlugin) {
        config.plugin.push("nimsuper");
        await writeFile(CONFIG_PATH, JSON.stringify(config, null, 2) + "\n", {
          mode: 0o600,
        });
        console.log("Added nimsuper to opencode.json plugin list");
      } else {
        console.log("Plugin already in opencode.json - skipping");
      }
    } catch (err) {
      console.warn("Could not update opencode.json:", err);
    }
  } else {
    const config = { plugin: ["nimsuper"] };
    await writeFile(CONFIG_PATH, JSON.stringify(config, null, 2) + "\n", {
      mode: 0o600,
    });
    console.log("Created opencode.json with plugin entry");
  }

  console.log("\nNext steps:");
  console.log("  1. Run: bun nimsuper  (to manage your API keys)");
  console.log("  2. Add at least one NVIDIA NIM API key via the TUI");
  console.log(
    "  3. Restart opencode - the plugin will auto-rotate your keys\n",
  );
}

await install().catch(function (err) {
  console.error("Installation failed:", err);
  process.exit(1);
});

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
  console.log("|  superoc - Installer                                        |");
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
      // Clean up legacy "nimsuper" entry if present
      config.plugin = config.plugin.filter(function (p) {
        if (typeof p === "string") return p !== "nimsuper";
        if (Array.isArray(p)) return p[0] !== "nimsuper";
        return true;
      });

      const hasPlugin = config.plugin.some(function (p) {
        if (typeof p === "string") return p === "superoc";
        if (Array.isArray(p)) return p[0] === "superoc";
        return false;
      });

      if (!hasPlugin) {
        config.plugin.push("superoc");
        await writeFile(CONFIG_PATH, JSON.stringify(config, null, 2) + "\n", {
          mode: 0o600,
        });
        console.log("Added superoc to OpenCode plugin list");
      } else {
        console.log("Plugin already in OpenCode config - skipping");
      }
    } catch (err) {
      console.warn("Could not update OpenCode config:", err);
    }
  } else {
    const config = { plugin: ["superoc"] };
    await writeFile(CONFIG_PATH, JSON.stringify(config, null, 2) + "\n", {
      mode: 0o600,
    });
    console.log("Created OpenCode config with superoc plugin entry");
  }

  console.log("\nNext steps:");
  console.log("  1. Run: superoc  (to manage your API keys & accounts)");
  console.log("  2. Connect your providers via the TUI");
  console.log("  3. Start OpenCode - superoc will auto-rotate your keys & accounts\n");
}

await install().catch(function (err) {
  console.error("Installation failed:", err);
  process.exit(1);
});

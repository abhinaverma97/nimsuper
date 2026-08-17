#!/usr/bin/env node

import { join } from "path";
import { homedir } from "os";
import { existsSync } from "fs";
import { readFile, writeFile, unlink } from "fs/promises";

const xdgConfig = process.env.XDG_CONFIG_HOME || join(homedir(), ".config");
const CONFIG_DIR = join(xdgConfig, "opencode");
const jsoncPath = join(CONFIG_DIR, "opencode.jsonc");
const jsonPath = join(CONFIG_DIR, "opencode.json");
const CONFIG_PATH = existsSync(jsoncPath) ? jsoncPath : jsonPath;
const KEYSTORE_PATH = join(CONFIG_DIR, "superoc-keys.json");
const LEGACY_KEYSTORE_PATH = join(CONFIG_DIR, "nimsuper-keys.json");
const THEME_PATH = join(CONFIG_DIR, "superoc-theme.json");
const LEGACY_THEME_PATH = join(CONFIG_DIR, "nimsuper-theme.json");

async function uninstall() {
  console.log(
    "\n+=============================================================+",
  );
  console.log("|  superoc - Uninstaller                                      |");
  console.log(
    "+=============================================================+\n",
  );

  let configModified = false;

  // Remove plugin from OpenCode config
  if (existsSync(CONFIG_PATH)) {
    try {
      const raw = await readFile(CONFIG_PATH, "utf-8");
      const config = JSON.parse(raw);

      if (Array.isArray(config.plugin)) {
        const beforeLength = config.plugin.length;
        config.plugin = config.plugin.filter(function (p) {
          if (typeof p === "string") return p !== "superoc" && p !== "nimsuper";
          if (Array.isArray(p)) return p[0] !== "superoc" && p[0] !== "nimsuper";
          return true;
        });

        if (config.plugin.length !== beforeLength) {
          await writeFile(CONFIG_PATH, JSON.stringify(config, null, 2) + "\n", {
            mode: 0o600,
          });
          console.log("Removed superoc from OpenCode plugin list");
          configModified = true;
        } else {
          console.log("Plugin was not found in OpenCode config - skipping");
        }
      } else {
        console.log("No plugins array in OpenCode config - skipping");
      }
    } catch (err) {
      console.warn("Could not update OpenCode config:", err);
    }
  } else {
    console.log("OpenCode config not found - skipping");
  }

  // Remove key store file
  const activeKeystore = existsSync(KEYSTORE_PATH)
    ? KEYSTORE_PATH
    : existsSync(LEGACY_KEYSTORE_PATH)
      ? LEGACY_KEYSTORE_PATH
      : null;

  if (activeKeystore) {
    if (!process.stdin.isTTY) {
      console.warn(
        "Key store file exists but cannot confirm deletion in non-interactive mode.",
      );
      console.warn("Manually remove: " + activeKeystore);
    } else {
      const readline = await import("readline");
      const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
      });
      const answer = await new Promise(function (resolve) {
        rl.question(
          "Delete all stored API keys? This cannot be undone. [y/N] ",
          resolve,
        );
      });
      rl.close();
      if (answer !== "y" && answer !== "Y") {
        console.log("Key store preserved at: " + activeKeystore);
      } else {
        try {
          if (existsSync(KEYSTORE_PATH)) await unlink(KEYSTORE_PATH);
          if (existsSync(LEGACY_KEYSTORE_PATH)) await unlink(LEGACY_KEYSTORE_PATH);
          console.log("Removed key store file");
        } catch (err) {
          console.warn("Could not remove key store file:", err);
        }
      }
    }
  } else {
    console.log("Key store file not found - skipping");
  }

  // Remove theme override file
  try {
    if (existsSync(THEME_PATH)) await unlink(THEME_PATH);
    if (existsSync(LEGACY_THEME_PATH)) await unlink(LEGACY_THEME_PATH);
    console.log("Removed theme preference file");
  } catch (err) {
    console.warn("Could not remove theme preference file:", err);
  }

  console.log("\nUninstallation complete.\n");
}

await uninstall().catch(function (err) {
  console.error("Uninstallation failed:", err);
  process.exit(1);
});

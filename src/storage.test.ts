import { describe, it, expect } from "bun:test";
import {
  getNextKey,
  getActiveKeys,
  getDefaultStore,
  addKey,
  recordModelRateLimit,
} from "./storage.js";
import type { KeyStore } from "./types.js";

describe("Antigravity Fill-First Account Selection", () => {
  it("sticks to the same Antigravity account across multiple requests", () => {
    const store = getDefaultStore();
    addKey(store, "Account 1", "key-1|proj-1", "antigravity");
    addKey(store, "Account 2", "key-2|proj-2", "antigravity");
    addKey(store, "Account 3", "key-3|proj-3", "antigravity");

    const k1 = getNextKey(store, undefined, "gemini-3.7-flash", "antigravity");
    const k2 = getNextKey(store, undefined, "gemini-3.7-flash", "antigravity");
    const k3 = getNextKey(store, undefined, "gemini-3.7-flash", "antigravity");

    expect(k1).not.toBeNull();
    expect(k2).not.toBeNull();
    expect(k3).not.toBeNull();
    expect(k1!.key.id).toBe(k2!.key.id);
    expect(k2!.key.id).toBe(k3!.key.id);
    expect(k1!.key.name).toBe("Account 1");
  });

  it("switches to next account only when current account is rate limited", () => {
    const store = getDefaultStore();
    addKey(store, "Account 1", "key-1|proj-1", "antigravity");
    addKey(store, "Account 2", "key-2|proj-2", "antigravity");

    const k1 = getNextKey(store, undefined, "gemini-3.7-flash", "antigravity");
    expect(k1!.key.name).toBe("Account 1");

    // Rate limit Account 1 for gemini-3.7-flash
    recordModelRateLimit(store, k1!.key.id, "gemini-3.7-flash");

    const k2 = getNextKey(store, undefined, "gemini-3.7-flash", "antigravity");
    expect(k2!.key.name).toBe("Account 2");

    // Consecutive calls should now stick to Account 2
    const k3 = getNextKey(store, undefined, "gemini-3.7-flash", "antigravity");
    expect(k3!.key.name).toBe("Account 2");
  });

  it("preserves standard round-robin for non-antigravity providers (e.g. nvidia)", () => {
    const store = getDefaultStore();
    addKey(store, "Nvidia 1", "nv-1", "nvidia");
    addKey(store, "Nvidia 2", "nv-2", "nvidia");

    const k1 = getNextKey(store, undefined, "llama-3", "nvidia");
    const k2 = getNextKey(store, undefined, "llama-3", "nvidia");

    expect(k1!.key.name).toBe("Nvidia 1");
    expect(k2!.key.name).toBe("Nvidia 2");
  });
});

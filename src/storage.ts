import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from "fs";
import { join, dirname, resolve } from "path";
import { homedir } from "os";
import type {
  ApiKeyEntry,
  ExportedKey,
  ExportPayload,
  KeyStore,
  KeyStoreConfig,
  ModelBlacklistEntry,
} from "./types.js";

const DEFAULT_STORE_PATH = join(
  homedir(),
  ".config",
  "opencode",
  "nimsuper-keys.json",
);
export const MODEL_BLACKLIST_BASE_DURATION_MS = 30_000;
export const MODEL_BLACKLIST_MAX_DURATION_MS = 60 * 60 * 1000;
const MODEL_BLACKLIST_ESCALATION = 1.5;

const MAX_IMPORT_SIZE = 1024 * 1024;
const MAX_IMPORT_KEYS = 100;
const MAX_KEY_LENGTH = 256;
const MAX_NAME_LENGTH = 128;
const SYSTEM_PATH_PREFIXES = ["/etc/", "/proc/", "/sys/", "/dev/"];

export function getDefaultStore(): KeyStore {
  return {
    keys: [],
    currentIndex: 0,
    rotationStrategy: "round-robin",
    updatedAt: Date.now(),
    lastUsedKeyId: undefined,
    fallbackChain: [],
    maxRateLimitFailures: 3,
  };
}

export function resolveStorePath(config?: KeyStoreConfig): string {
  return (
    config?.storePath ??
    process.env.NIMSUPER_STORE_PATH ??
    DEFAULT_STORE_PATH
  );
}

export function validateExportPath(filePath: string): string | null {
  const resolved = resolve(filePath);
  for (const prefix of SYSTEM_PATH_PREFIXES) {
    if (resolved.startsWith(prefix)) {
      return "Cannot write to system directories";
    }
  }
  return null;
}

export function loadStore(config?: KeyStoreConfig): KeyStore | null {
  const storePath = resolveStorePath(config);
  try {
    if (existsSync(storePath)) {
      const raw = readFileSync(storePath, "utf-8");
      const data = JSON.parse(raw);
      if (typeof data !== "object" || data === null) {
        console.warn(
          `[nimsuper] Store at "${storePath}" is not a valid object`,
        );
        return null;
      }
      const store = data as KeyStore;
      if (!store.keys || !Array.isArray(store.keys)) {
        console.warn(
          `[nimsuper] Store at "${storePath}" has invalid keys format`,
        );
        return null;
      }
      if (
        typeof store.currentIndex !== "number" ||
        !Number.isFinite(store.currentIndex) ||
        store.currentIndex < 0 ||
        !Number.isInteger(store.currentIndex)
      ) {
        store.currentIndex = 0;
      }
      const built: KeyStore = {
        ...getDefaultStore(),
        ...store,
        keys: Array.isArray(store.keys)
          ? store.keys
              .filter((k) => k !== null && typeof k === "object")
              .map((k) => {
                const kr = k as unknown as Record<string, unknown>;
                return {
                  ...k,
                  rateLimitCount:
                    typeof k.rateLimitCount === "number" ? k.rateLimitCount : 0,
                  modelBlacklist:
                    kr.modelBlacklist && typeof kr.modelBlacklist === "object"
                      ? (kr.modelBlacklist as {
                          [modelId: string]: ModelBlacklistEntry;
                        })
                      : undefined,
                } as ApiKeyEntry;
              })
          : [],
        fallbackChain: Array.isArray(store.fallbackChain)
          ? store.fallbackChain
          : [],
        maxRateLimitFailures:
          typeof store.maxRateLimitFailures === "number" &&
          Number.isFinite(store.maxRateLimitFailures) &&
          store.maxRateLimitFailures >= 1
            ? store.maxRateLimitFailures
            : getDefaultStore().maxRateLimitFailures,
      };
      pruneAllExpiredBlacklists(built);
      return built;
    }
  } catch (err) {
    console.error(`[nimsuper] Failed to load store at "${storePath}":`, err);
  }
  return null;
}

export function saveStore(store: KeyStore, config?: KeyStoreConfig): void {
  const storePath = resolveStorePath(config);
  pruneAllExpiredBlacklists(store);
  const dir = dirname(storePath);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true, mode: 0o700 });
  }
  store.updatedAt = Date.now();

  const tmpPath = storePath + ".tmp." + crypto.randomUUID();
  try {
    writeFileSync(tmpPath, JSON.stringify(store, null, 2) + "\n", {
      mode: 0o600,
    });
    renameSync(tmpPath, storePath);
  } catch (err) {
    try {
      unlinkSync(tmpPath);
    } catch (cleanupErr) {
      console.debug(
        `[nimsuper] Failed to clean up tmp file ${tmpPath}:`,
        cleanupErr,
      );
    }
    throw err;
  }
}

export function addKey(store: KeyStore, name: string, key: string): void {
  const entry: ApiKeyEntry = {
    id: crypto.randomUUID(),
    name,
    key,
    createdAt: Date.now(),
    rateLimitCount: 0,
    enabled: true,
  };
  store.keys.push(entry);
}

export function removeKey(store: KeyStore, id: string): void {
  const index = store.keys.findIndex((k) => k.id === id);
  if (index === -1) return;
  store.keys.splice(index, 1);
  if (store.currentIndex >= store.keys.length) {
    store.currentIndex = 0;
  }
  if (store.lastUsedKeyId === id) {
    store.lastUsedKeyId = undefined;
  }
}

export function renameKey(store: KeyStore, id: string, newName: string): void {
  const entry = store.keys.find((k) => k.id === id);
  if (entry) entry.name = newName;
}

export function toggleKey(
  store: KeyStore,
  id: string,
  enabled?: boolean,
): void {
  const entry = store.keys.find((k) => k.id === id);
  if (entry) entry.enabled = enabled ?? !entry.enabled;
}

export function isKeyBlacklisted(
  entry: ApiKeyEntry,
  modelId: string | undefined,
  now: number = Date.now(),
): boolean {
  if (!modelId || !entry.modelBlacklist) return false;
  const slot = entry.modelBlacklist[modelId];
  return !!slot && slot.blacklistedUntil > now;
}

export function getActiveKeys(
  store: KeyStore,
  modelId?: string,
): ApiKeyEntry[] {
  return store.keys.filter((k) => k.enabled && !isKeyBlacklisted(k, modelId));
}

export function getNextKey(
  store: KeyStore,
  config?: KeyStoreConfig,
  modelId?: string,
): { key: ApiKeyEntry; index: number } | null {
  const active = getActiveKeys(store, modelId);
  if (active.length === 0) return null;

  const strategy =
    config?.rotationStrategy ?? store.rotationStrategy ?? "round-robin";

  if (strategy === "least-failures") {
    const now = Date.now();
    const scoreBlacklists = (entry: ApiKeyEntry): number => {
      if (!entry.modelBlacklist) return 0;
      let sum = 0;
      for (const slot of Object.values(entry.modelBlacklist)) {
        if (slot.blacklistedUntil > now) sum += slot.blacklistedUntil - now;
      }
      return sum;
    };
    const sorted = [...active].sort((a, b) => {
      const aBlocked = scoreBlacklists(a);
      const bBlocked = scoreBlacklists(b);
      if (aBlocked !== bBlocked) return aBlocked - bBlocked;
      return (a.lastUsedAt ?? 0) - (b.lastUsedAt ?? 0);
    });
    const best = sorted[0];
    const realIdx = store.keys.indexOf(best);
    store.currentIndex = active.indexOf(best);
    store.lastUsedKeyId = best.id;
    best.lastUsedAt = Date.now();
    return { key: best, index: realIdx };
  }

  // round-robin
  const idx = store.currentIndex % active.length;
  const selected = active[idx];
  const realIdx = store.keys.indexOf(selected);
  store.currentIndex = (idx + 1) % active.length;
  store.lastUsedKeyId = selected.id;
  selected.lastUsedAt = Date.now();
  return { key: selected, index: realIdx };
}

export function resetFailures(store: KeyStore, keyId?: string): void {
  const reset = (entry: ApiKeyEntry) => {
    entry.rateLimitCount = 0;
    delete entry.modelBlacklist;
  };
  if (keyId) {
    const entry = store.keys.find((k) => k.id === keyId);
    if (entry) reset(entry);
  } else {
    for (const k of store.keys) reset(k);
  }
}

export function recordRateLimit(store: KeyStore, keyId: string): void {
  const entry = store.keys.find((k) => k.id === keyId);
  if (!entry) return;
  entry.rateLimitCount++;
}

export function resetRateLimit(store: KeyStore, keyId: string): void {
  const entry = store.keys.find((k) => k.id === keyId);
  if (entry) entry.rateLimitCount = 0;
}

export function recordModelRateLimit(
  store: KeyStore,
  keyId: string,
  modelId: string,
  now: number = Date.now(),
): void {
  const entry = store.keys.find((k) => k.id === keyId);
  if (!entry) return;
  if (!entry.modelBlacklist) entry.modelBlacklist = {};
  const slot = entry.modelBlacklist[modelId];
  if (slot && slot.blacklistedUntil > now) {
    const remaining = slot.blacklistedUntil - now;
    const extendedUntil =
      now + Math.max(remaining, MODEL_BLACKLIST_BASE_DURATION_MS);
    const escalatedNext = Math.min(
      slot.nextDurationMs * MODEL_BLACKLIST_ESCALATION,
      MODEL_BLACKLIST_MAX_DURATION_MS,
    );
    entry.modelBlacklist[modelId] = {
      blacklistedUntil: extendedUntil,
      nextDurationMs: escalatedNext,
    };
    return;
  }
  const previousNext = slot?.nextDurationMs ?? MODEL_BLACKLIST_BASE_DURATION_MS;
  const duration = Math.min(previousNext, MODEL_BLACKLIST_MAX_DURATION_MS);
  entry.modelBlacklist[modelId] = {
    blacklistedUntil: now + duration,
    nextDurationMs: Math.min(
      duration * MODEL_BLACKLIST_ESCALATION,
      MODEL_BLACKLIST_MAX_DURATION_MS,
    ),
  };
}

export function clearModelBlacklist(
  store: KeyStore,
  keyId: string,
  modelId: string,
): void {
  const entry = store.keys.find((k) => k.id === keyId);
  if (!entry || !entry.modelBlacklist) return;
  delete entry.modelBlacklist[modelId];
  if (Object.keys(entry.modelBlacklist).length === 0) {
    delete entry.modelBlacklist;
  }
}

export function pruneAllExpiredBlacklists(
  store: KeyStore,
  now: number = Date.now(),
): void {
  for (const entry of store.keys) {
    if (!entry.modelBlacklist) continue;
    for (const [modelId, slot] of Object.entries(entry.modelBlacklist)) {
      if (slot.blacklistedUntil <= now) {
        delete entry.modelBlacklist[modelId];
      }
    }
    if (Object.keys(entry.modelBlacklist).length === 0) {
      delete entry.modelBlacklist;
    }
  }
}

export function exportKeys(store: KeyStore): ExportPayload {
  return {
    version: 1,
    exportedAt: Date.now(),
    keys: store.keys.map((k) => ({ name: k.name, key: k.key })),
  };
}

export function writeExportFile(
  payload: ExportPayload,
  filePath: string,
): void {
  const pathError = validateExportPath(filePath);
  if (pathError) throw new Error(pathError);
  const dir = dirname(filePath);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true, mode: 0o700 });
  }
  const tmpPath = filePath + ".tmp." + process.pid;
  try {
    writeFileSync(tmpPath, JSON.stringify(payload, null, 2) + "\n", {
      mode: 0o600,
    });
    renameSync(tmpPath, filePath);
  } catch (err) {
    try {
      unlinkSync(tmpPath);
    } catch (cleanupErr) {
      console.debug(
        `[nimsuper] Failed to clean up tmp file ${tmpPath}:`,
        cleanupErr,
      );
    }
    throw err;
  }
}

export function readAndValidateImportFile(
  filePath: string,
): { raw: string } | { error: string } {
  const resolved = resolve(filePath);
  for (const prefix of SYSTEM_PATH_PREFIXES) {
    if (resolved.startsWith(prefix)) {
      return { error: "Cannot read from system directories" };
    }
  }

  let raw: string;
  try {
    raw = readFileSync(resolved, "utf-8");
  } catch (err) {
    console.debug(`[nimsuper] Cannot read import file ${resolved}:`, err);
    return { error: "Cannot read file" };
  }
  return { raw };
}

export interface ImportResult {
  added: number;
  skipped: number;
  errors: string[];
  pendingKeys: ExportedKey[];
}

export function validateImportPayload(raw: string): ImportResult {
  const result: ImportResult = {
    added: 0,
    skipped: 0,
    errors: [],
    pendingKeys: [],
  };

  if (raw.length > MAX_IMPORT_SIZE) {
    result.errors.push(
      `Import file too large (max ${MAX_IMPORT_SIZE / 1024}KB)`,
    );
    return result;
  }

  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch (err) {
    console.debug("[nimsuper] Import file invalid JSON:", err);
    result.errors.push("Invalid JSON format");
    return result;
  }

  if (typeof data !== "object" || data === null) {
    result.errors.push("Expected a JSON object");
    return result;
  }

  const rec = data as Record<string, unknown>;
  if (rec.version !== 1) {
    result.errors.push("Unsupported export version");
    return result;
  }

  if (!Array.isArray(rec.keys)) {
    result.errors.push("Missing or invalid 'keys' array");
    return result;
  }

  for (const entry of rec.keys) {
    if (result.pendingKeys.length >= MAX_IMPORT_KEYS) {
      result.errors.push(
        `Too many keys in import file (max ${MAX_IMPORT_KEYS})`,
      );
      break;
    }

    if (
      typeof entry !== "object" ||
      entry === null ||
      typeof (entry as Record<string, unknown>).name !== "string" ||
      typeof (entry as Record<string, unknown>).key !== "string"
    ) {
      result.errors.push(
        "Invalid key entry: must have 'name' and 'key' strings",
      );
      continue;
    }

    const name = ((entry as Record<string, unknown>).name as string).trim();
    const key = ((entry as Record<string, unknown>).key as string).trim();

    if (!name) {
      result.errors.push("Key entry has empty name");
      continue;
    }
    if (name.length > MAX_NAME_LENGTH) {
      result.errors.push("Key name exceeds maximum length");
      continue;
    }
    if (!key) {
      result.errors.push(`Key "${name}" has empty key value`);
      continue;
    }
    if (key.length > MAX_KEY_LENGTH) {
      result.errors.push(`Key "${name}" exceeds maximum length`);
      continue;
    }
    if (!key.startsWith("nvapi-")) {
      result.errors.push(`Key "${name}" does not start with 'nvapi-'`);
      continue;
    }

    result.pendingKeys.push({ name, key });
  }

  return result;
}

export function applyImport(
  store: KeyStore,
  pendingKeys: ExportedKey[],
): { added: number; skipped: number } {
  let added = 0;
  let skipped = 0;

  for (const { name, key } of pendingKeys) {
    const existingByName = store.keys.find((k) => k.name === name);
    if (existingByName) {
      skipped++;
      continue;
    }

    const existingByKey = store.keys.find((k) => k.key === key);
    if (existingByKey) {
      skipped++;
      continue;
    }

    addKey(store, name, key);
    added++;
  }

  return { added, skipped };
}

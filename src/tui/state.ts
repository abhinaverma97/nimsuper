import type { KeyStore } from "../types.js";
import type { ImportResult } from "../storage.js";
import { loadStore, getDefaultStore, saveStore } from "../storage.js";
import { getActiveTheme } from "../themes.js";
import type { Screen } from "./types.js";
import type { CliRenderer } from "@opentui/core";

export const state: {
  store: KeyStore;
  currentScreen: Screen;
  deleteTargetId: string | null;
  renameTargetId: string | null;
  pendingKeyName: string;
  selectedKeyId: string | null;
  statusMessage: string;
  statusColor: string;
  focusTargetId: string | null;
  mainMenuIndex: number;
  keySelectorIndex: number;
  keyActionsIndex: number;
  themeSelectorIndex: number;
  pendingImportPath: string;
  pendingImportResult: ImportResult | null;
  isRendering: boolean;
  renderPending: boolean;
  renderer: CliRenderer | null;
  activeTab: "keys" | "fallback";
  fallbackChainIndex: number;
  fallbackChainScrollOffset: number;
  fallbackSettingsIndex: number;
  modelSelectorIndex: number;
  modelSelectorScrollOffset: number;
  modelSearchQuery: string;
  availableModels: { id: string; name: string }[];
  modelsLoaded: boolean;
  benchmarkRunners: Map<string, import("./benchmark.js").BenchmarkRunner>;
} = {
  store: loadStore() ?? getDefaultStore(),
  currentScreen: "list",
  deleteTargetId: null,
  renameTargetId: null,
  pendingKeyName: "",
  selectedKeyId: null,
  statusMessage: "",
  statusColor: "#888888",
  focusTargetId: null,
  mainMenuIndex: 0,
  keySelectorIndex: 0,
  keyActionsIndex: 0,
  themeSelectorIndex: 0,
  pendingImportPath: "",
  pendingImportResult: null,
  isRendering: false,
  renderPending: false,
  renderer: null,
  activeTab: "keys",
  fallbackChainIndex: 0,
  fallbackChainScrollOffset: 0,
  fallbackSettingsIndex: 0,
  modelSelectorIndex: 0,
  modelSelectorScrollOffset: 0,
  modelSearchQuery: "",
  availableModels: [],
  modelsLoaded: false,
  benchmarkRunners: new Map(),
};

let navigateImpl: ((screen: Screen) => void) | null = null;
let renderAppImpl: (() => void) | null = null;

export function setNavigate(fn: (screen: Screen) => void): void {
  navigateImpl = fn;
}

export function setRenderApp(fn: () => void): void {
  renderAppImpl = fn;
}

export function navigate(screen: Screen): void {
  if (navigateImpl) navigateImpl(screen);
}

export function callRenderApp(): void {
  if (renderAppImpl) renderAppImpl();
}

export function refreshStore(): void {
  const fresh = loadStore();
  if (fresh !== null) {
    state.store = fresh;
  }
}

export function setStatus(msg: string, color?: string): void {
  state.statusMessage = msg;
  state.statusColor = color ?? getActiveTheme().textMuted;
}

export function safeSaveStore(): boolean {
  try {
    saveStore(state.store);
    return true;
  } catch (err) {
    console.error("[nimsuper] Save failed:", err);
    setStatus(
      "Save failed: " + (err instanceof Error ? err.message : "Unknown error"),
      getActiveTheme().error,
    );
    callRenderApp();
    return false;
  }
}

export function clampIndex(index: number, length: number): number {
  if (length <= 0) return 0;
  if (index < 0) return 0;
  return index >= length ? Math.max(0, length - 1) : index;
}

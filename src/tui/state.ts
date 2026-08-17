import type { KeyStore, ProviderId } from "../types.js";
import type { ImportResult } from "../storage.js";
import { loadStore, getDefaultStore, saveStore } from "../storage.js";
import { getActiveTheme } from "../themes.js";
import type { Screen, ActiveTab } from "./types.js";
import type { CliRenderer } from "@opentui/core";
import type { BenchmarkRunner } from "./benchmark.js";

type ProviderRecord<T> = Record<ProviderId, T>;

export const state: {
  store: KeyStore;
  currentScreen: Screen;
  activeProvider: ProviderId;
  activeTab: ActiveTab;
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
  fallbackChainIndex: ProviderRecord<number>;
  fallbackChainScrollOffset: ProviderRecord<number>;
  fallbackSettingsIndex: number;
  modelSelectorIndex: ProviderRecord<number>;
  modelSelectorScrollOffset: ProviderRecord<number>;
  modelSearchQuery: string;
  availableModels: ProviderRecord<{ id: string; name: string }[]>;
  modelsLoaded: ProviderRecord<boolean>;
  benchmarkRunners: Map<string, BenchmarkRunner>;
  pendingOAuthUrl: string;
  pendingOAuthState: string;
  oauthCleanup: (() => void) | null;
} = {
  store: loadStore() ?? getDefaultStore(),
  currentScreen: "provider-tabs",
  activeProvider: "nvidia",
  activeTab: "keys",
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
  fallbackChainIndex: { nvidia: 0, google: 0, antigravity: 0 },
  fallbackChainScrollOffset: { nvidia: 0, google: 0, antigravity: 0 },
  fallbackSettingsIndex: 0,
  modelSelectorIndex: { nvidia: 0, google: 0, antigravity: 0 },
  modelSelectorScrollOffset: { nvidia: 0, google: 0, antigravity: 0 },
  modelSearchQuery: "",
  availableModels: { nvidia: [], google: [], antigravity: [] },
  modelsLoaded: { nvidia: false, google: false, antigravity: false },
  benchmarkRunners: new Map(),
  pendingOAuthUrl: "",
  pendingOAuthState: "",
  oauthCleanup: null,
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
    console.error("[superoc] Save failed:", err);
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

export function getActiveKeysForProvider(provider: ProviderId): KeyStore["keys"] {
  return state.store.keys.filter((k) => k.provider === provider && k.enabled);
}
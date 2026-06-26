import { Box, Text } from "@opentui/core";
import pkg from "../../package.json" with { type: "json" };
import { getActiveKeys } from "../storage.js";
import { getActiveTheme, setPreviewTheme } from "../themes.js";
import { state, setNavigate, setRenderApp, callRenderApp } from "./state.js";
import type { Screen } from "./types.js";
import {
  buildMainMenu,
  buildKeySelector,
  buildKeyActions,
  buildThemeSelector,
  buildConfirmDelete,
  buildAddNameInput,
  buildAddKeyInput,
  buildRenameInput,
  buildExportPathInput,
  buildImportPathInput,
  buildConfirmImport,
  buildFallbackMenu,
  buildFallbackChain,
  buildFallbackSettings,
  buildModelSelector,
  getFilteredModelsForSelector,
} from "./screens.js";
import type { ScreenContent } from "./types.js";
import {
  handleFallbackChainKey,
  addFallbackModel,
  cancelBenchmark,
} from "./actions.js";

export function initApp(): void {
  // Wire up navigation and render loop
  setNavigate((screen: Screen) => {
    state.currentScreen = screen;
    renderApp();
  });

  setRenderApp(renderApp);

  // Key bindings
  if (!state.renderer) return;
  state.renderer.keyInput.on(
    "keypress",
    (key: { name: string; ctrl: boolean; shift: boolean }) => {
      if (key.name === "tab") {
        state.activeTab = state.activeTab === "keys" ? "fallback" : "keys";
        if (state.activeTab === "keys") {
          navigateTo("list");
        } else {
          navigateTo("fallback-menu");
        }
        return;
      }

      if (key.name === "1") {
        state.activeTab = "keys";
        navigateTo("list");
        return;
      }

      if (key.name === "2") {
        state.activeTab = "fallback";
        navigateTo("fallback-menu");
        return;
      }

      if (key.name === "escape") {
        switch (state.currentScreen) {
          case "list":
            return;
          case "key-selector":
            return navigateTo("list");
          case "key-actions":
            return navigateTo("key-selector");
          case "add-name":
          case "add-key":
            state.pendingKeyName = "";
            return navigateTo("list");
          case "rename":
            state.renameTargetId = null;
            return navigateTo("key-actions");
          case "confirm-delete":
            state.deleteTargetId = null;
            return navigateTo("key-actions");
          case "theme-selector":
            setPreviewTheme(null);
            return navigateTo("list");
          case "export-path":
            return navigateTo("list");
          case "import-path":
            return navigateTo("list");
          case "confirm-import":
            state.pendingImportPath = "";
            state.pendingImportResult = null;
            return navigateTo("list");
          case "fallback-menu":
            return navigateTo("list");
          case "fallback-chain":
            cancelBenchmark();
            return navigateTo("fallback-menu");
          case "fallback-settings":
            return navigateTo("fallback-menu");
          case "model-selector":
            state.modelSearchQuery = "";
            return navigateTo("fallback-chain");
        }
      }

      if (key.ctrl && key.name === "c") {
        if (state.renderer) state.renderer.destroy();
        process.exit(0);
      }

      // Fallback chain key handling
      if (state.currentScreen === "fallback-chain") {
        handleFallbackChainKey(key.name);
        return;
      }

      // Model selector search handling
      if (state.currentScreen === "model-selector") {
        const filteredModels = getFilteredModelsForSelector();
        if (key.name === "up") {
          if (filteredModels.length === 0) return;
          state.modelSelectorIndex = Math.max(0, state.modelSelectorIndex - 1);
          callRenderApp();
          return;
        } else if (key.name === "down") {
          if (filteredModels.length === 0) return;
          state.modelSelectorIndex = Math.min(
            filteredModels.length - 1,
            state.modelSelectorIndex + 1,
          );
          callRenderApp();
          return;
        } else if (key.name === "return" || key.name === "enter") {
          if (
            state.modelSelectorIndex >= 0 &&
            state.modelSelectorIndex < filteredModels.length
          ) {
            const model = filteredModels[state.modelSelectorIndex];
            if (model) {
              addFallbackModel(model.id, model.name);
              state.modelSearchQuery = "";
              navigateTo("fallback-chain");
            }
          }
          return;
        } else if (key.name === "backspace") {
          state.modelSearchQuery = state.modelSearchQuery.slice(0, -1);
          state.modelSelectorIndex = 0;
          callRenderApp();
          return;
        } else if (key.name === "r" && state.modelSearchQuery === "") {
          // Refresh model list (only when search is empty)
          state.modelsLoaded = false;
          state.availableModels = [];
          callRenderApp();
          return;
        } else if (key.name && key.name.length === 1) {
          // Single character key
          state.modelSearchQuery += key.name;
          state.modelSelectorIndex = 0;
          callRenderApp();
          return;
        }
      }
    },
  );

  // Initial render
  renderApp();
}

function navigateTo(screen: Screen): void {
  state.currentScreen = screen;
  renderApp();
}

function renderApp(): void {
  if (state.isRendering) {
    state.renderPending = true;
    return;
  }
  state.isRendering = true;
  try {
    doRenderApp();
  } finally {
    state.isRendering = false;
    if (state.renderPending) {
      state.renderPending = false;
      queueMicrotask(renderApp);
    }
  }
}

function doRenderApp(): void {
  if (!state.renderer) return;
  state.focusTargetId = null;
  for (const child of state.renderer.root.getChildren())
    child.destroyRecursively();

  const theme = getActiveTheme();

  const { element: content, helpText }: ScreenContent = (() => {
    switch (state.currentScreen) {
      case "list":
        return buildMainMenu();
      case "key-selector":
        return buildKeySelector();
      case "key-actions":
        return buildKeyActions();
      case "theme-selector":
        return buildThemeSelector();
      case "confirm-delete":
        return buildConfirmDelete();
      case "add-name":
        return buildAddNameInput();
      case "add-key":
        return buildAddKeyInput();
      case "rename":
        return buildRenameInput();
      case "export-path":
        return buildExportPathInput();
      case "import-path":
        return buildImportPathInput();
      case "confirm-import":
        return buildConfirmImport();
      case "fallback-chain":
        return buildFallbackChain();
      case "fallback-menu":
        return buildFallbackMenu();
      case "fallback-settings":
        return buildFallbackSettings();
      case "model-selector":
        return buildModelSelector();
    }
  })();

  const isKeysTab = state.activeTab === "keys";

  const tabBar = Box(
    { flexDirection: "row", gap: 1 },
    Text({
      content: "[1]",
      fg: isKeysTab ? theme.primary : theme.textMuted,
    }),
    Text({
      content: "API Key Rotation",
      fg: isKeysTab ? theme.primary : theme.textMuted,
    }),
    Text({ content: " | ", fg: theme.textMuted }),
    Text({
      content: "[2]",
      fg: !isKeysTab ? theme.primary : theme.textMuted,
    }),
    Text({
      content: "Model Fallback Chain",
      fg: !isKeysTab ? theme.primary : theme.textMuted,
    }),
  );

  const title = Box(
    { flexDirection: "row", gap: 2 },
    Text({
      id: "title-text",
      content: "NVIDIA NIM Key Rotator",
      fg: theme.primary,
    }),
    Text({
      id: "version-text",
      content: `v${pkg.version}`,
      fg: theme.textMuted,
    }),
  );

  const status = Box(
    { flexDirection: "row", gap: 2 },
    Text({
      id: "keys-count",
      content: `Keys: ${state.store.keys.length}`,
      fg: theme.textMuted,
    }),
    Text({
      id: "active-count",
      content: `Active: ${getActiveKeys(state.store).length}`,
      fg: theme.success,
    }),
    Text({
      id: "models-count",
      content: `Models: ${state.store.fallbackChain.length}`,
      fg: theme.textMuted,
    }),
    Text({
      id: "rl-threshold",
      content: `RL: ${state.store.maxRateLimitFailures}`,
      fg: theme.textMuted,
    }),
    Text({
      id: "status-text",
      content: state.statusMessage,
      fg: state.statusColor,
    }),
  );

  const help = Box(
    { flexDirection: "row" },
    Text({ id: "help-text", content: helpText, fg: theme.textMuted }),
  );

  state.renderer.root.add(
    Box(
      {
        id: "screen-root",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        width: "100%",
        height: "100%",
        backgroundColor: theme.background,
      },
      Box(
        {
          id: "panel",
          flexDirection: "column",
          paddingX: 2,
          paddingY: 1,
          border: true,
          borderStyle: "rounded",
          borderColor: theme.border,
          gap: 1,
          backgroundColor: theme.backgroundPanel,
        },
        tabBar,
        title,
        status,
        content,
        help,
      ),
    ),
  );

  if (state.focusTargetId) {
    const renderable = state.renderer.root.findDescendantById(
      state.focusTargetId,
    );
    if (renderable && typeof renderable.focus === "function")
      renderable.focus();
  }
}

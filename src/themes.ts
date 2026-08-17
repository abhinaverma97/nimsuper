import {
  existsSync,
  readFileSync,
  writeFileSync,
  mkdirSync,
  renameSync,
} from "fs";
import { join, dirname } from "path";
import { homedir } from "os";

const CONFIG_DIR = join(homedir(), ".config", "opencode");
const STATE_DIR = join(homedir(), ".local", "state", "opencode");

const KV_JSONPath = join(STATE_DIR, "kv.json");
const KV_JSONCPath = join(STATE_DIR, "kv.jsonc");
const TUI_JSONPath = join(CONFIG_DIR, "tui.json");
const TUI_JSONCPath = join(CONFIG_DIR, "tui.jsonc");

function stripJsonComments(raw: string): string {
  // strip single-line comments
  let result = raw.replace(/\/\/.*$/gm, "");
  // strip multi-line comments
  result = result.replace(/\/\*[\s\S]*?\*\//g, "");
  return result;
}

function readJsonOrJsonc(path: string): any | null {
  try {
    if (!existsSync(path)) return null;
    let raw = readFileSync(path, "utf-8");
    if (path.endsWith(".jsonc")) {
      raw = stripJsonComments(raw);
    }
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function getThemeFromKV(): string | null {
  const fromJson = readJsonOrJsonc(KV_JSONPath);
  if (
    fromJson &&
    typeof fromJson.theme === "string" &&
    fromJson.theme.length > 0
  ) {
    return fromJson.theme;
  }

  const fromJsonc = readJsonOrJsonc(KV_JSONCPath);
  if (
    fromJsonc &&
    typeof fromJsonc.theme === "string" &&
    fromJsonc.theme.length > 0
  ) {
    return fromJsonc.theme;
  }

  return null;
}

function getThemeFromTUI(): string | null {
  const fromJson = readJsonOrJsonc(TUI_JSONPath);
  if (
    fromJson &&
    typeof fromJson.theme === "string" &&
    fromJson.theme.length > 0
  ) {
    return fromJson.theme;
  }

  const fromJsonc = readJsonOrJsonc(TUI_JSONCPath);
  if (
    fromJsonc &&
    typeof fromJsonc.theme === "string" &&
    fromJsonc.theme.length > 0
  ) {
    return fromJsonc.theme;
  }

  return null;
}

export interface SelectThemeColors {
  backgroundColor: string;
  focusedBackgroundColor: string;
  focusedTextColor: string;
  selectedBackgroundColor: string;
  selectedTextColor: string;
  textColor: string;
  descriptionColor: string;
  selectedDescriptionColor: string;
}

export interface InputThemeColors {
  backgroundColor: string;
  focusedBackgroundColor: string;
  textColor: string;
  cursorColor: string;
}

export function selectColors(theme: RotatorTheme): SelectThemeColors {
  return {
    backgroundColor: theme.background,
    focusedBackgroundColor: theme.backgroundPanel,
    focusedTextColor: theme.primary,
    selectedBackgroundColor: theme.selectedBg,
    selectedTextColor: theme.selectedText,
    textColor: theme.text,
    descriptionColor: theme.description,
    selectedDescriptionColor: theme.selectedDescription,
  };
}

export function inputColors(theme: RotatorTheme): InputThemeColors {
  return {
    backgroundColor: theme.inputBg,
    focusedBackgroundColor: theme.inputFocusedBg,
    textColor: theme.text,
    cursorColor: theme.cursor,
  };
}

export function dangerSelectColors(theme: RotatorTheme): SelectThemeColors {
  return {
    backgroundColor: theme.background,
    focusedBackgroundColor: theme.backgroundPanel,
    focusedTextColor: theme.error,
    selectedBackgroundColor: theme.errorBg,
    selectedTextColor: theme.error,
    textColor: theme.text,
    descriptionColor: theme.description,
    selectedDescriptionColor: theme.selectedDescription,
  };
}

export function applySelectColors(
  target: {
    backgroundColor: string;
    focusedBackgroundColor: string;
    focusedTextColor: string;
    selectedBackgroundColor: string;
    selectedTextColor: string;
    textColor: string;
    descriptionColor: string;
    selectedDescriptionColor: string;
  },
  colors: SelectThemeColors,
): void {
  target.backgroundColor = colors.backgroundColor;
  target.focusedBackgroundColor = colors.focusedBackgroundColor;
  target.focusedTextColor = colors.focusedTextColor;
  target.selectedBackgroundColor = colors.selectedBackgroundColor;
  target.selectedTextColor = colors.selectedTextColor;
  target.textColor = colors.textColor;
  target.descriptionColor = colors.descriptionColor;
  target.selectedDescriptionColor = colors.selectedDescriptionColor;
}

export interface RotatorTheme {
  id: string;
  name: string;
  background: string;
  backgroundPanel: string;
  backgroundElement: string;
  text: string;
  textMuted: string;
  primary: string;
  primaryMuted: string;
  accent: string;
  error: string;
  errorBg: string;
  success: string;
  warning: string;
  selectedBg: string;
  selectedText: string;
  border: string;
  borderActive: string;
  inputBg: string;
  inputFocusedBg: string;
  cursor: string;
  description: string;
  selectedDescription: string;
}

const themes: Record<string, RotatorTheme> = {
  opencode: {
    id: "opencode",
    name: "OpenCode",
    background: "#0a0a0a",
    backgroundPanel: "#111111",
    backgroundElement: "#1a1a1a",
    text: "#AAAAAA",
    textMuted: "#666666",
    primary: "#76FF03",
    primaryMuted: "#88CC88",
    accent: "#76FF03",
    error: "#FF5555",
    errorBg: "#3a1a1a",
    success: "#66FF66",
    warning: "#D7A657",
    selectedBg: "#1a3a1a",
    selectedText: "#76FF03",
    border: "#333333",
    borderActive: "#76FF03",
    inputBg: "#1a1a1a",
    inputFocusedBg: "#2a2a2a",
    cursor: "#76FF03",
    description: "#666666",
    selectedDescription: "#88CC88",
  },
  dracula: {
    id: "dracula",
    name: "Dracula",
    background: "#1a1b26",
    backgroundPanel: "#1e1f2e",
    backgroundElement: "#24253a",
    text: "#f8f8f2",
    textMuted: "#6272a4",
    primary: "#bd93f9",
    primaryMuted: "#9580ff",
    accent: "#ff79c6",
    error: "#ff5555",
    errorBg: "#2d1525",
    success: "#50fa7b",
    warning: "#f1fa8c",
    selectedBg: "#2d2f4e",
    selectedText: "#bd93f9",
    border: "#44475a",
    borderActive: "#bd93f9",
    inputBg: "#21222c",
    inputFocusedBg: "#2a2b3d",
    cursor: "#bd93f9",
    description: "#6272a4",
    selectedDescription: "#9580ff",
  },
  catppuccin: {
    id: "catppuccin",
    name: "Catppuccin Mocha",
    background: "#1e1e2e",
    backgroundPanel: "#181825",
    backgroundElement: "#252536",
    text: "#cdd6f4",
    textMuted: "#6c7086",
    primary: "#cba6f7",
    primaryMuted: "#a6adc8",
    accent: "#f38ba8",
    error: "#f38ba8",
    errorBg: "#2a1a2e",
    success: "#a6e3a1",
    warning: "#f9e2af",
    selectedBg: "#2a2a3c",
    selectedText: "#cba6f7",
    border: "#313244",
    borderActive: "#cba6f7",
    inputBg: "#1e1e2e",
    inputFocusedBg: "#252536",
    cursor: "#cba6f7",
    description: "#6c7086",
    selectedDescription: "#a6adc8",
  },
  tokyonight: {
    id: "tokyonight",
    name: "Tokyonight",
    background: "#1a1b26",
    backgroundPanel: "#16161e",
    backgroundElement: "#1f1f30",
    text: "#a9b1d6",
    textMuted: "#565f89",
    primary: "#7aa2f7",
    primaryMuted: "#7982a9",
    accent: "#bb9af7",
    error: "#f7768e",
    errorBg: "#1f1530",
    success: "#9ece6a",
    warning: "#e0af68",
    selectedBg: "#1f2335",
    selectedText: "#7aa2f7",
    border: "#292e42",
    borderActive: "#7aa2f7",
    inputBg: "#1a1b26",
    inputFocusedBg: "#1f1f30",
    cursor: "#7aa2f7",
    description: "#565f89",
    selectedDescription: "#7982a9",
  },
  gruvbox: {
    id: "gruvbox",
    name: "Gruvbox",
    background: "#1d2021",
    backgroundPanel: "#282828",
    backgroundElement: "#32302f",
    text: "#ebdbb2",
    textMuted: "#7c6f64",
    primary: "#fe8019",
    primaryMuted: "#bdae93",
    accent: "#fabd2f",
    error: "#fb4934",
    errorBg: "#3c1a1a",
    success: "#b8bb26",
    warning: "#fabd2f",
    selectedBg: "#3c3836",
    selectedText: "#fe8019",
    border: "#504945",
    borderActive: "#fe8019",
    inputBg: "#1d2021",
    inputFocusedBg: "#282828",
    cursor: "#fe8019",
    description: "#7c6f64",
    selectedDescription: "#bdae93",
  },
  nord: {
    id: "nord",
    name: "Nord",
    background: "#2e3440",
    backgroundPanel: "#2e3440",
    backgroundElement: "#3b4252",
    text: "#d8dee9",
    textMuted: "#616e88",
    primary: "#88c0d0",
    primaryMuted: "#81a1c1",
    accent: "#b48ead",
    error: "#bf616a",
    errorBg: "#3b2530",
    success: "#a3be8c",
    warning: "#ebcb8b",
    selectedBg: "#3b4252",
    selectedText: "#88c0d0",
    border: "#4c566a",
    borderActive: "#88c0d0",
    inputBg: "#2e3440",
    inputFocusedBg: "#3b4252",
    cursor: "#88c0d0",
    description: "#616e88",
    selectedDescription: "#81a1c1",
  },
  "one-dark": {
    id: "one-dark",
    name: "One Dark",
    background: "#1e2127",
    backgroundPanel: "#21252b",
    backgroundElement: "#282c34",
    text: "#abb2bf",
    textMuted: "#5c6370",
    primary: "#61afef",
    primaryMuted: "#7f848e",
    accent: "#c678dd",
    error: "#e06c75",
    errorBg: "#2c1a1e",
    success: "#98c379",
    warning: "#e5c07b",
    selectedBg: "#2c313a",
    selectedText: "#61afef",
    border: "#3e4451",
    borderActive: "#61afef",
    inputBg: "#1e2127",
    inputFocusedBg: "#282c34",
    cursor: "#61afef",
    description: "#5c6370",
    selectedDescription: "#7f848e",
  },
  solarized: {
    id: "solarized",
    name: "Solarized",
    background: "#002b36",
    backgroundPanel: "#002b36",
    backgroundElement: "#073642",
    text: "#839496",
    textMuted: "#586e75",
    primary: "#268bd2",
    primaryMuted: "#657b83",
    accent: "#d33682",
    error: "#dc322f",
    errorBg: "#072630",
    success: "#859900",
    warning: "#b58900",
    selectedBg: "#073642",
    selectedText: "#268bd2",
    border: "#073642",
    borderActive: "#268bd2",
    inputBg: "#002b36",
    inputFocusedBg: "#073642",
    cursor: "#268bd2",
    description: "#586e75",
    selectedDescription: "#657b83",
  },
  kanagawa: {
    id: "kanagawa",
    name: "Kanagawa",
    background: "#1f1f28",
    backgroundPanel: "#1f1f28",
    backgroundElement: "#2a2a37",
    text: "#dcd7ba",
    textMuted: "#727169",
    primary: "#7e9cd8",
    primaryMuted: "#957fb8",
    accent: "#d27e99",
    error: "#e82424",
    errorBg: "#2a1f28",
    success: "#98bb6c",
    warning: "#d7a657",
    selectedBg: "#223349",
    selectedText: "#7e9cd8",
    border: "#54546d",
    borderActive: "#7e9cd8",
    inputBg: "#1f1f28",
    inputFocusedBg: "#2a2a37",
    cursor: "#7e9cd8",
    description: "#727169",
    selectedDescription: "#957fb8",
  },
  rosepine: {
    id: "rosepine",
    name: "Rose Pine",
    background: "#191724",
    backgroundPanel: "#1f1d2e",
    backgroundElement: "#26233a",
    text: "#e0def4",
    textMuted: "#6e6a86",
    primary: "#c4a7e7",
    primaryMuted: "#908caa",
    accent: "#eb6f92",
    error: "#eb6f92",
    errorBg: "#26172a",
    success: "#9ccfd8",
    warning: "#f6c177",
    selectedBg: "#26233a",
    selectedText: "#c4a7e7",
    border: "#26233a",
    borderActive: "#c4a7e7",
    inputBg: "#191724",
    inputFocusedBg: "#1f1d2e",
    cursor: "#c4a7e7",
    description: "#6e6a86",
    selectedDescription: "#908caa",
  },
};

export function getTheme(id: string): RotatorTheme {
  return themes[id] ?? themes["opencode"]!;
}

export function listThemes(): RotatorTheme[] {
  return Object.values(themes);
}

export function getThemeIdFromOpenCodeConfig(): string | null {
  // opencode stores the theme in kv.json or kv.jsonc (state dir), or tui.json / tui.jsonc (config dir)
  return getThemeFromKV() ?? getThemeFromTUI() ?? null;
}

export function getResolvedTheme(): RotatorTheme {
  const opencodeThemeId = getThemeIdFromOpenCodeConfig();
  if (opencodeThemeId && themes[opencodeThemeId]) {
    return themes[opencodeThemeId];
  }
  return themes["opencode"]!;
}

const SUPEROC_THEME_PATH = join(CONFIG_DIR, "superoc-theme.json");
const LEGACY_THEME_PATH = join(CONFIG_DIR, "nimsuper-theme.json");
const THEME_OVERRIDE_PATH = existsSync(SUPEROC_THEME_PATH)
  ? SUPEROC_THEME_PATH
  : existsSync(LEGACY_THEME_PATH)
    ? LEGACY_THEME_PATH
    : SUPEROC_THEME_PATH;

export function getThemeOverride(): string | null {
  try {
    if (!existsSync(THEME_OVERRIDE_PATH)) return null;
    const raw = readFileSync(THEME_OVERRIDE_PATH, "utf-8");
    const data = JSON.parse(raw);
    return data.theme ?? null;
  } catch {}
  return null;
}

export function saveThemeOverride(themeId: string): void {
  try {
    const data = { theme: themeId };
    const dir = dirname(SUPEROC_THEME_PATH);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true, mode: 0o700 });
    }
    const tmpPath = SUPEROC_THEME_PATH + ".tmp." + crypto.randomUUID();
    writeFileSync(tmpPath, JSON.stringify(data, null, 2) + "\n", {
      mode: 0o600,
    });
    renameSync(tmpPath, SUPEROC_THEME_PATH);
  } catch (err) {
    console.warn("[superoc] Could not save theme preference:", err);
  }
}

let previewThemeOverride: string | null = null;

export function setPreviewTheme(themeId: string | null): void {
  previewThemeOverride = themeId;
}

export function getPreviewTheme(): string | null {
  return previewThemeOverride;
}

export function getActiveTheme(): RotatorTheme {
  if (previewThemeOverride && themes[previewThemeOverride]) {
    return themes[previewThemeOverride];
  }
  const override = getThemeOverride();
  if (override && themes[override]) {
    return themes[override];
  }
  return getResolvedTheme();
}

# nimsuper

[![npm version](https://img.shields.io/npm/v/nimsuper.svg)](https://www.npmjs.com/package/nimsuper)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://opensource.org/licenses/MIT)

**Multi-provider API key rotator & fallback plugin for [OpenCode](https://opencode.ai)** — supporting **NVIDIA NIM**, **Google Gemini**, and **Google Cloud Code Antigravity (OAuth)** with real-time quota tracking, model fallbacks, and an interactive TUI.

---

## ✨ Features

- 🔄 **Multi-Provider Key Rotation**:
  - **NVIDIA NIM**: Rotate multiple NVIDIA API keys seamlessly with automatic rate-limit (429) failover and model fallback chains.
  - **Google Gemini**: Rotate standard Google AI Studio API keys.
  - **Google Cloud Code Antigravity (OAuth)**: Full Google OAuth PKCE integration. Access Claude Sonnet 4.6, Claude Opus 4.6 (Thinking), Gemini 3.7 Flash, and GPT-OSS 120B with automatic account rotation on 429s.
- 📊 **Real-Time Quota Tracking & Normalization**:
  - Displays persistent 5-hour rolling limits and weekly limits in model labels:  
    `Build · Gemini 3.6 Flash High (Antigravity) 5h: 98.9% W: 100% Google`
  - Automatically averages and normalizes quotas across all connected Google accounts (e.g. 50% + 100% = 75%).
  - Real-time background refresh on chat responses with zero intrusive toasts.
- ⚡ **Interactive Terminal UI (TUI)**:
  - Run `nimsuper` or `bun run tui` to manage accounts, keys, fallback chains, and rotation strategies.
  - Built-in **Live Benchmarks** (measuring TTFB, Tokens/sec, and token count).
  - Customizable color themes (Tokyo Night, Catppuccin, Nord, Cyberpunk, and more).
- 🛡️ **Reliability & Bug Fixes**:
  - **Provider Isolation**: Injects headers strictly to matching providers — prevents cross-provider authentication conflicts.
  - **Conflict-Free Proxy**: Eliminates `"API key for authentication is used with other authentication credentials"` errors via OpenCode's native `auth.loader`.
  - **Live SSE Stream Transformer**: Unwraps nested Google Cloud Code SSE packets into standard Gemini streams in real-time.
  - **Dual-Endpoint Fallback**: Automatic failover between Google Sandbox (`daily-cloudcode-pa.sandbox.googleapis.com`) and Production endpoints.
  - **Smart Rate-Limit & Timeout Recovery**: String status code parsing (`"429"` / `"RESOURCE_EXHAUSTED"`) and abort timeout retries.

---

## 📦 Installation

```bash
npm install -g nimsuper
```

Add `nimsuper` to your OpenCode configuration (`~/.config/opencode/opencode.jsonc` or `opencode.json`):

```jsonc
{
  "plugin": ["nimsuper"]
}
```

---

## 🚀 Quick Start

### 1. Launch the TUI Manager
```bash
nimsuper
```

### 2. Connect Providers
- **Antigravity (Google Cloud Code)**:
  1. Open `nimsuper` TUI $\to$ Select `[3] Antigravity`.
  2. Select `[1] Add Account (OAuth)` $\to$ Authorize in your browser.
  3. Models (`antigravity-claude-sonnet-4-6`, `antigravity-gemini-3.7-flash`, etc.) are automatically synced to your OpenCode config!
- **NVIDIA NIM**:
  - Select `[1] NVIDIA` in the TUI $\to$ `[1] Add Key` (or set `NVIDIA_API_KEY` in your environment).
- **Google Gemini API**:
  - Select `[2] Google` in the TUI $\to$ `[1] Add Key` (or set `GOOGLE_API_KEY`).

---

## ⚙️ Configuration & Environment

| Variable | Default | Description |
|---|---|---|
| `NIMSUPER_STORE_PATH` | `~/.config/opencode/nimsuper-keys.json` | Path to store keys and fallback chains |
| `NIMSUPER_MAX_FAILURES` | `5` | Maximum consecutive failures before triggering model fallback |
| `NVIDIA_API_KEY` | *(optional)* | Default NVIDIA API key fallback |
| `GOOGLE_API_KEY` | *(optional)* | Default Google Gemini API key fallback |

---

## 🔄 Rotation Strategies

You can toggle rotation strategies in the TUI or store configuration:
- **`round-robin`**: Evenly distributes requests across all active keys.
- **`least-failures`**: Prioritizes keys with the lowest historical failure counts.

---

## 🗑️ Uninstall

```bash
npm uninstall -g nimsuper
```

---

## 📄 License

MIT © [abhinaverma97](https://github.com/abhinaverma97)

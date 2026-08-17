# nimsuper

Multi-provider API key rotator and model fallback plugin for [OpenCode](https://opencode.ai).

Fork of [opencode-nim-rotator](https://github.com/ChakornK/opencode-nim-rotator) with added multi-provider support (**Google Gemini**, **Google Cloud Code Antigravity OAuth**), live quota tracking, and bug fixes.

## Features

- **NVIDIA NIM**: API key rotation with model fallback chains and rate-limit recovery.
- **Google Gemini**: Google AI Studio API key rotation with auto 429 failover.
- **Antigravity (OAuth)**: Google OAuth account rotation for Claude Sonnet 4.6, Claude Opus 4.6 (Thinking), Gemini 3.7 Flash, and GPT-OSS 120B.
- **Live Quota Tracking**: Normalized 5-hour and weekly quotas displayed directly on model labels (`5h: 98.9% W: 100%`).
- **TUI Manager**: Terminal UI for managing keys, accounts, fallback chains, and live TTFB/TPS benchmarks.

## Install

```bash
npm install -g nimsuper
```

Add to `~/.config/opencode/opencode.json` (or `opencode.jsonc`):

```json
{
  "plugin": ["nimsuper"]
}
```

## Usage

```bash
nimsuper
```

### Connect Providers

- **Antigravity**: Launch `nimsuper` -> `[3] Antigravity` -> `[1] Add Account (OAuth)` to login via browser.
- **NVIDIA**: Launch `nimsuper` -> `[1] NVIDIA` -> `[1] Add Key` (or export `NVIDIA_API_KEY`).
- **Google**: Launch `nimsuper` -> `[2] Google` -> `[1] Add Key` (or export `GOOGLE_API_KEY`).

## License

MIT


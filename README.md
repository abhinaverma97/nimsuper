# nimsuper

Fork of [opencode-nim-rotator](https://github.com/ChakornK/opencode-nim-rotator) — rotates NVIDIA NIM API keys with model fallback for OpenCode.

**Fixes:** Provider guard — only injects NVIDIA headers on NVIDIA requests, not all providers.

## Install

```bash
npm install -g nimsuper
```

Add to `~/.config/opencode/opencode.json`:

```json
{ "plugin": ["nimsuper"] }
```

## Usage

```bash
nimsuper          # TUI manager for keys & fallback chain
opencode /connect nvidia  # or add keys manually
```

## Env

| Variable | Default |
|----------|---------|
| `NIMSUPER_STORE_PATH` | `~/.config/opencode/nimsuper-keys.json` |
| `NIMSUPER_MAX_FAILURES` | `5` |

## Uninstall

```bash
npm uninstall -g nimsuper
```

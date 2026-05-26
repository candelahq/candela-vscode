# candela-vscode

VS Code extension for [Candela](https://github.com/candelahq/candela) — real-time LLM cost tracking, rich budget warnings, and observability dashboard.

[![License](https://img.shields.io/badge/License-Apache%202.0-blue.svg)](LICENSE)
[![Open VSX](https://img.shields.io/open-vsx/v/candelahq/candela-vscode)](https://open-vsx.org/extension/candelahq/candela-vscode)
[![Version](https://img.shields.io/open-vsx/v/candelahq/candela-vscode?label=version)](https://open-vsx.org/extension/candelahq/candela-vscode)

## Features

### 📊 Status Bar Cost Tracker

Live token usage and cost in your VS Code status bar, auto-refreshing every 60 seconds:

```
🔥 142.3K · $0.47
```

Click to see the full cost breakdown with per-model stats.

### 💰 Rich Budget Display

Status bar turns yellow when budget exceeds the warning threshold (default 80%). Full budget info includes:

- Daily spend vs. limit with percentage used
- Active grant amounts and reset countdowns
- Color-coded urgency: green → yellow → red
- Warning notifications at 90%+

### 📋 Commands

| Command | Description |
|---------|-------------|
| `Candela: Show Cost Summary` | Detailed token/cost breakdown with model-by-model stats |
| `Candela: Check Budget` | Visual budget meter with remaining balance and active grants |
| `Candela: Show Dashboard` | Open the Candela web dashboard |
| `Candela: Refresh Status` | Force refresh status bar data |

### ⚙️ Settings

| Setting | Default | Description |
|---------|---------|-------------|
| `candela.serverUrl` | `http://localhost:8181` | Candela server URL |
| `candela.statusBar.enabled` | `true` | Show cost tracker in status bar |
| `candela.budgetWarning.threshold` | `80` | Warning threshold (% of budget used) |
| `candela.autoRefresh.intervalSeconds` | `60` | Auto-refresh interval (0 to disable) |

---

## Installation

### From Open VSX

Search for **"Candela"** in the Extensions panel, or install directly:

```bash
code --install-extension candelahq.candela-vscode
```

[➡️ View on Open VSX](https://open-vsx.org/extension/candelahq/candela-vscode)

### From GitHub Releases

Download the `.vsix` from [Releases](https://github.com/candelahq/candela-vscode/releases) and install:

```bash
code --install-extension candela-vscode-*.vsix
```

---

## Prerequisites

1. **Candela running locally**: `candela start` (requires [candela](https://github.com/candelahq/candela) v0.4.6+)
2. Extension auto-detects Candela on the configured URL

If Candela is not running, the status bar shows `offline` — no errors, no noise.

---

## Works With Any LLM Tool

This extension works independently of your AI coding tool. Route any of these through Candela's proxy and see costs in VS Code:

- Cline / Continue / Cursor
- GitHub Copilot (via proxy)
- Claude Code (`ANTHROPIC_BASE_URL`)
- Gemini CLI (`GOOGLE_GEMINI_BASE_URL`)
- Custom scripts and agents

---

## Related

- [Candela](https://github.com/candelahq/candela) — OTel-native LLM observability platform
- [candela-desktop](https://github.com/candelahq/candela-desktop) — macOS desktop app
- [opencode-candela](https://www.npmjs.com/package/opencode-candela) — OpenCode plugin
- [candela-cline](https://www.npmjs.com/package/candela-cline) — Cline plugin

---

## License

Apache License 2.0. See [LICENSE](LICENSE) for details.

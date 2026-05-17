# candela-vscode

VS Code extension for [Candela](https://github.com/candelahq/candela) — real-time LLM cost tracking, budget warnings, and observability dashboard.

[![License](https://img.shields.io/badge/License-Apache%202.0-blue.svg)](LICENSE)

## Features

### 📊 Status Bar Cost Tracker
Live token usage and cost in your VS Code status bar, auto-refreshing every 60 seconds:

```
🔥 142.3K · $0.47
```

Click to see the full cost breakdown.

### 💰 Budget Warnings
Status bar turns yellow when budget exceeds threshold (default 80%). Warning notifications at 90%+.

### 📋 Commands

| Command | Description |
|---------|-------------|
| `Candela: Show Cost Summary` | Detailed token/cost breakdown with model-by-model stats |
| `Candela: Check Budget` | Visual budget meter with remaining balance |
| `Candela: Show Dashboard` | Open the Candela web dashboard |
| `Candela: Refresh Status` | Force refresh status bar data |

### ⚙️ Settings

| Setting | Default | Description |
|---------|---------|-------------|
| `candela.serverUrl` | `http://localhost:8181` | Candela server URL |
| `candela.statusBar.enabled` | `true` | Show cost tracker in status bar |
| `candela.budgetWarning.threshold` | `80` | Warning threshold (% of budget) |
| `candela.autoRefresh.intervalSeconds` | `60` | Auto-refresh interval (0 to disable) |

## Installation

### From VSIX (Development)

```bash
# Build the extension
npm install
npm run compile
npx vsce package

# Install locally
code --install-extension candela-vscode-0.1.0.vsix
```

### From Marketplace (Coming Soon)

Search for "Candela" in the VS Code Extensions panel.

## Prerequisites

1. **Candela running locally**: `candela start` or `go run ./cmd/candela-server`
2. Extension auto-detects Candela on the configured URL

If Candela is not running, the status bar shows "offline" — no errors, no noise.

## Works With Any LLM Tool

This extension works independently of your AI coding tool. Route any of these through Candela's proxy and see costs in VS Code:

- GitHub Copilot (via proxy)
- Cline
- Continue
- Cursor
- Custom scripts

## Related

- [Candela](https://github.com/candelahq/candela) — OTel-native LLM observability platform
- [opencode-candela](https://github.com/candelahq/opencode-candela) — OpenCode plugin
- [candela-cline](https://github.com/candelahq/candela-cline) — Cline plugin

## License

Apache License 2.0. See [LICENSE](LICENSE) for details.

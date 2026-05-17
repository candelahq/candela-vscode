/**
 * candela-vscode — VS Code extension for Candela LLM observability.
 *
 * Provides:
 * - Status bar cost tracker (live token/cost display)
 * - Budget warning notifications
 * - Cost summary and budget commands
 * - Auto-detection of running Candela instance
 */

import * as vscode from "vscode";
import { CandelaClient, type UsageSummary, type BudgetInfo } from "./candela-client";
import { discoverCandelaUrl } from "./discover";

let statusBarItem: vscode.StatusBarItem;
let refreshInterval: ReturnType<typeof setInterval> | undefined;
let client: CandelaClient;

/** Format USD with appropriate precision */
function formatCost(usd: number): string {
  if (usd < 0.01) return `$${usd.toFixed(4)}`;
  if (usd < 1) return `$${usd.toFixed(3)}`;
  return `$${usd.toFixed(2)}`;
}

/** Format token count with K/M suffixes */
function formatTokens(count: number): string {
  if (count >= 1_000_000) return `${(count / 1_000_000).toFixed(1)}M`;
  if (count >= 1_000) return `${(count / 1_000).toFixed(1)}K`;
  return String(count);
}

/** Update the status bar with current cost data */
async function updateStatusBar(): Promise<void> {
  const alive = await client.isAlive();

  if (!alive) {
    statusBarItem.text = "$(circle-slash) Candela: offline";
    statusBarItem.tooltip = "Candela is not running. Start with: candela start";
    statusBarItem.backgroundColor = undefined;
    return;
  }

  const usage = await client.getUsageSummary(24);
  if (!usage) {
    statusBarItem.text = "$(flame) Candela";
    statusBarItem.tooltip = "Connected to Candela";
    return;
  }

  statusBarItem.text = `$(flame) ${formatTokens(usage.totalTokens)} · ${formatCost(usage.totalCostUsd)}`;
  statusBarItem.tooltip = [
    `Candela — Today's Usage`,
    ``,
    `Tokens: ${formatTokens(usage.totalTokens)}`,
    `  Input:  ${formatTokens(usage.inputTokens)}`,
    `  Output: ${formatTokens(usage.outputTokens)}`,
    `Cost: ${formatCost(usage.totalCostUsd)}`,
    `Requests: ${usage.requestCount}`,
    ``,
    `Click for details`,
  ].join("\n");

  // Check budget
  const config = vscode.workspace.getConfiguration("candela");
  const threshold = config.get<number>("budgetWarning.threshold", 80);
  const budget = await client.getBudgetRemaining();
  if (budget && budget.percentUsed > threshold) {
    statusBarItem.backgroundColor = new vscode.ThemeColor(
      "statusBarItem.warningBackground"
    );
    statusBarItem.tooltip += `\n\n⚠️ Budget: ${budget.percentUsed.toFixed(0)}% used (${formatCost(budget.remainingUsd)} remaining)`;
  } else {
    statusBarItem.backgroundColor = undefined;
  }
}

/** Show cost summary in an information message */
async function showCostSummary(): Promise<void> {
  const usage = await client.getUsageSummary(24);
  if (!usage) {
    vscode.window.showInformationMessage(
      "Candela: No usage data available. Is Candela running?"
    );
    return;
  }

  const breakdown = await client.getModelBreakdown(24);
  const modelLines = (breakdown ?? [])
    .slice(0, 5)
    .map(
      (m) =>
        `• ${m.model} (${m.provider}): ${formatTokens(m.totalTokens)} tokens, ${formatCost(m.totalCostUsd)}`
    );

  const lines = [
    `📊 Today's Usage`,
    ``,
    `Tokens: ${formatTokens(usage.totalTokens)} (${formatTokens(usage.inputTokens)} in / ${formatTokens(usage.outputTokens)} out)`,
    `Cost: ${formatCost(usage.totalCostUsd)}`,
    `Requests: ${usage.requestCount}`,
  ];

  if (modelLines.length > 0) {
    lines.push("", "Model Breakdown:", ...modelLines);
  }

  const selection = await vscode.window.showInformationMessage(
    lines.join("\n"),
    "Open Dashboard",
    "Dismiss"
  );

  if (selection === "Open Dashboard") {
    const config = vscode.workspace.getConfiguration("candela");
    const url = config.get<string>("serverUrl", "http://localhost:8181");
    vscode.env.openExternal(vscode.Uri.parse(`${url.replace("8181", "3000")}`));
  }
}

/** Show budget status */
async function checkBudget(): Promise<void> {
  const budget = await client.getBudgetRemaining();
  if (!budget) {
    vscode.window.showInformationMessage(
      "Candela: No budget information available."
    );
    return;
  }

  const bar =
    "█".repeat(Math.floor(budget.percentUsed / 5)) +
    "░".repeat(20 - Math.floor(budget.percentUsed / 5));

  const msg = [
    `💰 Budget Status`,
    `[${bar}] ${budget.percentUsed.toFixed(0)}%`,
    `Used: ${formatCost(budget.usedUsd)} / ${formatCost(budget.totalBudgetUsd)}`,
    `Remaining: ${formatCost(budget.remainingUsd)}`,
  ].join("  |  ");

  if (budget.percentUsed > 90) {
    vscode.window.showWarningMessage(msg);
  } else {
    vscode.window.showInformationMessage(msg);
  }
}

export function activate(context: vscode.ExtensionContext): void {
  const config = vscode.workspace.getConfiguration("candela");
  const serverUrl = config.get<string>("serverUrl") || discoverCandelaUrl();

  client = new CandelaClient(serverUrl);

  // Status bar item
  if (config.get<boolean>("statusBar.enabled", true)) {
    statusBarItem = vscode.window.createStatusBarItem(
      vscode.StatusBarAlignment.Right,
      50
    );
    statusBarItem.command = "candela.showCostSummary";
    statusBarItem.text = "$(loading~spin) Candela";
    statusBarItem.show();
    context.subscriptions.push(statusBarItem);

    // Initial update
    updateStatusBar();

    // Auto-refresh
    const intervalSeconds = config.get<number>(
      "autoRefresh.intervalSeconds",
      60
    );
    if (intervalSeconds > 0) {
      refreshInterval = setInterval(
        () => updateStatusBar(),
        intervalSeconds * 1000
      );
    }
  }

  // Register commands
  context.subscriptions.push(
    vscode.commands.registerCommand("candela.showCostSummary", showCostSummary),
    vscode.commands.registerCommand("candela.checkBudget", checkBudget),
    vscode.commands.registerCommand("candela.refreshStatus", async () => {
      await updateStatusBar();
      vscode.window.showInformationMessage("Candela: Status refreshed");
    }),
    vscode.commands.registerCommand("candela.showDashboard", () => {
      vscode.env.openExternal(
        vscode.Uri.parse(serverUrl.replace("8181", "3000"))
      );
    })
  );

  // Watch for config changes
  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration("candela")) {
        const newConfig = vscode.workspace.getConfiguration("candela");
        const newUrl = newConfig.get<string>(
          "serverUrl",
          "http://localhost:8181"
        );
        client = new CandelaClient(newUrl);
        updateStatusBar();
      }
    })
  );
}

export function deactivate(): void {
  if (refreshInterval) {
    clearInterval(refreshInterval);
    refreshInterval = undefined;
  }
}

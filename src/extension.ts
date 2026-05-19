/**
 * candela-vscode — VS Code extension for Candela LLM observability.
 *
 * Provides:
 * - Status bar cost tracker (live token/cost/budget display)
 * - Budget warning notifications with reset countdown
 * - Active grant display with expiry warnings
 * - Cost summary and budget commands
 * - Auto-detection of running Candela instance
 * - Automatic failure backoff (5 min) to prevent spam
 */

import * as vscode from "vscode";
import { CandelaClient, type DashboardData } from "./candela-client";
import { discoverCandelaUrl } from "./discover";

let statusBarItem: vscode.StatusBarItem;
let refreshInterval: ReturnType<typeof setInterval> | undefined;
let client: CandelaClient;

// Polling guards
let updateInProgress = false;
let consecutiveFailures = 0;
const BACKOFF_INTERVAL_S = 300; // 5 minutes on failure

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

/** Budget urgency emoji based on usage fraction. */
function budgetEmoji(fraction: number): string {
  if (fraction >= 0.9) return "🔴";
  if (fraction >= 0.6) return "🟡";
  return "🟢";
}

/** Reschedule the auto-refresh interval. */
function rescheduleInterval(seconds: number): void {
  if (refreshInterval) {
    clearInterval(refreshInterval);
  }
  if (seconds > 0) {
    refreshInterval = setInterval(() => updateStatusBar(), seconds * 1000);
  }
}

/** Update the status bar with current cost + budget data */
async function updateStatusBar(): Promise<void> {
  // Dedup: skip if already in-flight
  if (updateInProgress) return;
  updateInProgress = true;

  try {
    // Single consolidated call
    const data = await client.getDashboardData(24);

    if (!data) {
      consecutiveFailures++;
      statusBarItem.text = "$(circle-slash) Candela: offline";
      statusBarItem.tooltip =
        "Candela is not running. Start with: candela start";
      statusBarItem.backgroundColor = undefined;

      // Back off after 3 consecutive failures
      if (consecutiveFailures >= 3) {
        rescheduleInterval(BACKOFF_INTERVAL_S);
      }
      return;
    }

    // Reset failure counter on success
    if (consecutiveFailures > 0) {
      consecutiveFailures = 0;
      const config = vscode.workspace.getConfiguration("candela");
      const normalInterval = config.get<number>(
        "autoRefresh.intervalSeconds",
        60
      );
      rescheduleInterval(normalInterval);
    }

    const usage = data.usage;
    const config = vscode.workspace.getConfiguration("candela");
    const threshold = config.get<number>("budgetWarning.threshold", 80);
    const showBudget = config.get<boolean>("statusBar.showBudget", true);

    // Status bar text: tokens · cost · budget indicator
    const parts = [
      `$(flame) ${formatTokens(usage.totalTokens)}`,
      formatCost(usage.totalCostUsd),
    ];

    if (showBudget && data.budget) {
      parts.push(
        `${budgetEmoji(data.budget.usedFraction)}${data.budget.percentUsed.toFixed(0)}%`
      );
    }

    statusBarItem.text = parts.join(" · ");

    // Build rich tooltip
    const tooltipLines = [
      `Candela — Today's Usage`,
      ``,
      `Tokens: ${formatTokens(usage.totalTokens)}`,
      `  Input:  ${formatTokens(usage.inputTokens)}`,
      `  Output: ${formatTokens(usage.outputTokens)}`,
      `Cost: ${formatCost(usage.totalCostUsd)}`,
      `Requests: ${usage.requestCount}`,
    ];

    // Budget section in tooltip
    if (data.budget) {
      const b = data.budget;
      tooltipLines.push(
        ``,
        `💰 Budget: ${formatCost(b.spentUsd)} / ${formatCost(b.limitUsd)} (${b.percentUsed.toFixed(0)}% used)`,
        `   Remaining: ${formatCost(b.remainingUsd)}`
      );
      if (b.resetLabel) {
        tooltipLines.push(`   ⏰ ${b.resetLabel}`);
      }
    }

    // Grants in tooltip
    for (const g of data.activeGrants) {
      if (g.isExhausted) continue;
      const expiryNote = g.expiresAt
        ? ` — expires ${g.expiresAt.toLocaleDateString("en-US", { month: "short", day: "numeric" })}`
        : "";
      tooltipLines.push(
        `   🎁 ${formatCost(g.remainingUsd)} grant (${g.reason || "Bonus"}${expiryNote})`
      );
    }

    if (data.totalRemainingUsd !== null) {
      tooltipLines.push(`   Total available: ${formatCost(data.totalRemainingUsd)}`);
    }

    tooltipLines.push(``, `Click for details`);
    statusBarItem.tooltip = tooltipLines.join("\n");

    // Warning background
    if (data.budget && data.budget.percentUsed > threshold) {
      statusBarItem.backgroundColor = new vscode.ThemeColor(
        "statusBarItem.warningBackground"
      );
    } else {
      statusBarItem.backgroundColor = undefined;
    }
  } finally {
    updateInProgress = false;
  }
}

/** Show cost summary in an information message */
async function showCostSummary(): Promise<void> {
  const data = await client.getDashboardData(24);
  if (!data || data.usage.requestCount === 0) {
    vscode.window.showInformationMessage(
      "Candela: No usage data available. Is Candela running?"
    );
    return;
  }

  const usage = data.usage;
  const modelLines = data.models
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

  if (data.budget) {
    const b = data.budget;
    lines.push(
      "",
      `💰 Budget: ${formatCost(b.spentUsd)} / ${formatCost(b.limitUsd)} (${b.percentUsed.toFixed(0)}% used${b.resetLabel ? `, ${b.resetLabel}` : ""})`
    );
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

/** Show budget status with grants */
async function checkBudget(): Promise<void> {
  const data = await client.getDashboardData(24);
  if (!data?.budget) {
    vscode.window.showInformationMessage(
      "Candela: No budget information available."
    );
    return;
  }

  const b = data.budget;
  const bar =
    "█".repeat(Math.floor(b.percentUsed / 5)) +
    "░".repeat(20 - Math.floor(b.percentUsed / 5));

  const lines = [
    `💰 Budget Status`,
    `Daily: [${bar}] ${b.percentUsed.toFixed(0)}%  ${formatCost(b.spentUsd)} / ${formatCost(b.limitUsd)}`,
  ];

  if (b.resetLabel) {
    lines[1] += ` (${b.resetLabel})`;
  }

  // Active grants
  for (const g of data.activeGrants) {
    if (g.isExhausted) continue;
    const expiryNote = g.expiresAt
      ? ` — expires ${g.expiresAt.toLocaleDateString("en-US", { month: "short", day: "numeric" })}`
      : "";
    lines.push(
      `🎁 Grant: ${formatCost(g.remainingUsd)} / ${formatCost(g.amountUsd)} — ${g.reason || "Bonus"}${expiryNote}`
    );
  }

  if (data.totalRemainingUsd !== null) {
    lines.push(`Total available: ${formatCost(data.totalRemainingUsd)}`);
  }

  const msg = lines.join("  |  ");
  if (b.percentUsed > 90) {
    vscode.window.showWarningMessage(msg);
  } else {
    vscode.window.showInformationMessage(msg);
  }
}

export function activate(context: vscode.ExtensionContext): void {
  const config = vscode.workspace.getConfiguration("candela");
  const serverUrl = config.get<string>("serverUrl") || discoverCandelaUrl();

  // VSCode: 30s cache TTL to prevent redundant calls during rapid polling
  client = new CandelaClient(serverUrl, 30_000);

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
    rescheduleInterval(intervalSeconds);
  }

  // Register commands
  context.subscriptions.push(
    vscode.commands.registerCommand("candela.showCostSummary", showCostSummary),
    vscode.commands.registerCommand("candela.checkBudget", checkBudget),
    vscode.commands.registerCommand("candela.refreshStatus", async () => {
      client.invalidateCache();
      consecutiveFailures = 0;
      await updateStatusBar();
      vscode.window.showInformationMessage("Candela: Status refreshed");
    }),
    vscode.commands.registerCommand("candela.showDashboard", () => {
      vscode.env.openExternal(
        vscode.Uri.parse(serverUrl.replace("8181", "3000"))
      );
    })
  );

  // Watch for config changes — invalidate cache + recreate client
  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration("candela")) {
        const newConfig = vscode.workspace.getConfiguration("candela");
        const newUrl = newConfig.get<string>(
          "serverUrl",
          "http://localhost:8181"
        );
        client = new CandelaClient(newUrl, 30_000);
        consecutiveFailures = 0;
        const newInterval = newConfig.get<number>(
          "autoRefresh.intervalSeconds",
          60
        );
        rescheduleInterval(newInterval);
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

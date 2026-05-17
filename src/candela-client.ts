/**
 * Candela API client for the VS Code extension.
 */

export interface UsageSummary {
  totalTokens: number;
  inputTokens: number;
  outputTokens: number;
  totalCostUsd: number;
  requestCount: number;
}

export interface ModelUsage {
  model: string;
  provider: string;
  totalTokens: number;
  totalCostUsd: number;
  requestCount: number;
}

export interface BudgetInfo {
  totalBudgetUsd: number;
  usedUsd: number;
  remainingUsd: number;
  percentUsed: number;
}

export class CandelaClient {
  constructor(private baseUrl: string) {
    this.baseUrl = baseUrl.replace(/\/+$/, "");
  }

  async isAlive(): Promise<boolean> {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 2000);
      const res = await fetch(`${this.baseUrl}/healthz`, {
        signal: controller.signal,
      });
      clearTimeout(timeout);
      return res.ok;
    } catch {
      return false;
    }
  }

  async getUsageSummary(hours = 24): Promise<UsageSummary | null> {
    try {
      const now = new Date();
      const start = new Date(now.getTime() - hours * 60 * 60 * 1000);
      const res = await fetch(
        `${this.baseUrl}/candela.dashboard.v1.DashboardService/GetUsageSummary`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            startTime: start.toISOString(),
            endTime: now.toISOString(),
          }),
        }
      );
      if (!res.ok) return null;
      const data = (await res.json()) as Record<string, unknown>;
      return {
        totalTokens: Number(data.totalTokens ?? 0),
        inputTokens: Number(data.inputTokens ?? 0),
        outputTokens: Number(data.outputTokens ?? 0),
        totalCostUsd: Number(data.totalCostUsd ?? 0),
        requestCount: Number(data.requestCount ?? 0),
      };
    } catch {
      return null;
    }
  }

  async getModelBreakdown(hours = 24): Promise<ModelUsage[] | null> {
    try {
      const now = new Date();
      const start = new Date(now.getTime() - hours * 60 * 60 * 1000);
      const res = await fetch(
        `${this.baseUrl}/candela.dashboard.v1.DashboardService/GetModelBreakdown`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            startTime: start.toISOString(),
            endTime: now.toISOString(),
          }),
        }
      );
      if (!res.ok) return null;
      const data = (await res.json()) as Record<string, unknown>;
      return ((data.models ?? []) as Record<string, unknown>[]).map((m) => ({
        model: String(m.model ?? ""),
        provider: String(m.provider ?? ""),
        totalTokens: Number(m.totalTokens ?? 0),
        totalCostUsd: Number(m.totalCostUsd ?? 0),
        requestCount: Number(m.requestCount ?? 0),
      }));
    } catch {
      return null;
    }
  }

  async getBudgetRemaining(): Promise<BudgetInfo | null> {
    try {
      const res = await fetch(
        `${this.baseUrl}/candela.budget.v1.BudgetService/GetMyBudget`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({}),
        }
      );
      if (!res.ok) return null;
      const data = (await res.json()) as Record<string, unknown>;
      const total = Number(data.totalBudgetUsd ?? 0);
      const used = Number(data.usedUsd ?? 0);
      return {
        totalBudgetUsd: total,
        usedUsd: used,
        remainingUsd: total - used,
        percentUsed: total > 0 ? (used / total) * 100 : 0,
      };
    } catch {
      return null;
    }
  }
}

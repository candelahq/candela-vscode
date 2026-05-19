/**
 * Candela API client for querying observability data.
 *
 * Shared HTTP client used by the Cline plugin.
 * All methods are safe to call when Candela is offline.
 *
 * Uses the consolidated GetDashboardData RPC (include_budget=true) to
 * fetch usage, budget, and grant data in a single round-trip. Falls
 * back to legacy RPCs for backends that haven't upgraded yet.
 */

// ── Types ─────────────────────────────────────────────────────────────────────

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
  cacheReadTokens: number;
  cacheCreationTokens: number;
}

/** Snapshot of a user's recurring budget for the current period. */
export interface BudgetInfo {
  limitUsd: number;
  spentUsd: number;
  remainingUsd: number;
  percentUsed: number;
  usedFraction: number;
  isNearLimit: boolean;
  isExhausted: boolean;
  periodEnd: Date | null;
  resetLabel: string;
}

/** A one-time bonus budget grant. */
export interface GrantInfo {
  id: string;
  amountUsd: number;
  spentUsd: number;
  remainingUsd: number;
  reason: string;
  expiresAt: Date | null;
  isExpiringSoon: boolean;
  isExhausted: boolean;
}

/** Consolidated dashboard data — usage + budget in one response. */
export interface DashboardData {
  usage: UsageSummary;
  models: ModelUsage[];
  budget: BudgetInfo | null;
  activeGrants: GrantInfo[];
  totalRemainingUsd: number | null;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function computeResetLabel(periodEnd: Date | null): string {
  if (!periodEnd) return "";
  const diff = periodEnd.getTime() - Date.now();
  if (diff <= 0) return "resetting";
  const hours = Math.floor(diff / 3_600_000);
  const minutes = Math.floor((diff % 3_600_000) / 60_000);
  if (hours >= 1) return `resets in ${hours}h ${minutes}m`;
  return `resets in ${minutes}m`;
}

function parseBudget(raw: Record<string, unknown>): BudgetInfo | null {
  if (!raw) return null;
  const limitUsd = Number(raw.limitUsd ?? raw.limit_usd ?? 0);
  const spentUsd = Number(raw.spentUsd ?? raw.spent_usd ?? 0);
  if (!isFinite(limitUsd) || !isFinite(spentUsd)) return null;
  const remaining = Math.max(0, limitUsd - spentUsd);
  const fraction = limitUsd > 0 ? Math.min(1, spentUsd / limitUsd) : 0;
  const periodEndRaw = (raw.periodEnd ?? raw.period_end) as string | undefined;
  const periodEnd = periodEndRaw ? new Date(periodEndRaw) : null;
  if (periodEnd && isNaN(periodEnd.getTime())) return null;
  return {
    limitUsd,
    spentUsd,
    remainingUsd: remaining,
    percentUsed: fraction * 100,
    usedFraction: fraction,
    isNearLimit: fraction >= 0.8,
    isExhausted: spentUsd >= limitUsd,
    periodEnd,
    resetLabel: computeResetLabel(periodEnd),
  };
}

function parseGrants(raw: unknown[]): GrantInfo[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((g): g is Record<string, unknown> => g != null && typeof g === "object")
    .map((g) => {
      const amountUsd = Number(g.amountUsd ?? g.amount_usd ?? 0);
      const spentUsd = Number(g.spentUsd ?? g.spent_usd ?? 0);
      const expiresRaw = (g.expiresAt ?? g.expires_at) as string | undefined;
      const expiresAt = expiresRaw ? new Date(expiresRaw) : null;
      return {
        id: String(g.id ?? ""),
        amountUsd,
        spentUsd,
        remainingUsd: Math.max(0, amountUsd - spentUsd),
        reason: String(g.reason ?? ""),
        expiresAt,
        isExpiringSoon:
          expiresAt !== null &&
          expiresAt.getTime() > Date.now() &&
          expiresAt.getTime() - Date.now() < 7 * 86_400_000,
        isExhausted: spentUsd >= amountUsd,
      };
    });
}

function makeTimeRange(hours: number): Record<string, unknown> {
  const now = new Date();
  const start = new Date(now.getTime() - hours * 60 * 60 * 1000);
  return {
    time_range: {
      start: { seconds: String(Math.floor(start.getTime() / 1000)), nanos: 0 },
      end: { seconds: String(Math.floor(now.getTime() / 1000)), nanos: 0 },
    },
  };
}

/** Parse raw proto3 JSON model array into ModelUsage[]. */
function parseModels(raw: Record<string, unknown>[]): ModelUsage[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((m): m is Record<string, unknown> => m != null && typeof m === "object")
    .map((m) => ({
      model: String(m.model ?? ""),
      provider: String(m.provider ?? ""),
      totalTokens:
        Number(m.inputTokens ?? m.input_tokens ?? 0) +
        Number(m.outputTokens ?? m.output_tokens ?? 0),
      totalCostUsd: Number(m.costUsd ?? m.cost_usd ?? 0),
      requestCount: Number(m.callCount ?? m.call_count ?? 0),
      cacheReadTokens: Number(m.cacheReadTokens ?? m.cache_read_tokens ?? 0),
      cacheCreationTokens: Number(
        m.cacheCreationTokens ?? m.cache_creation_tokens ?? 0
      ),
    }));
}

// ── Client ────────────────────────────────────────────────────────────────────

export class CandelaClient {
  private baseUrl: string;
  private alive: boolean | null = null;
  private cacheTtlMs: number;
  private cache: { data: DashboardData; fetchedAt: number } | null = null;

  constructor(baseUrl = "http://localhost:8181", cacheTtlMs = 0) {
    this.baseUrl = baseUrl.replace(/\/+$/, "");
    this.cacheTtlMs = cacheTtlMs;
  }

  async isAlive(): Promise<boolean> {
    if (this.alive === true) return true;
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 2000);
      const res = await fetch(`${this.baseUrl}/healthz`, {
        signal: controller.signal,
      });
      clearTimeout(timeout);
      this.alive = res.ok;
    } catch {
      this.alive = false;
    }
    return this.alive;
  }

  resetHealth(): void {
    this.alive = null;
  }

  invalidateCache(): void {
    this.cache = null;
  }

  /** Get the proxy URL for a given provider */
  getProxyUrl(
    provider:
      | "openai"
      | "anthropic"
      | "anthropic-vertex"
      | "anthropic-direct"
      | "anthropic-bedrock"
      | "gemini-oai"
      | "google"
  ): string {
    return `${this.baseUrl}/proxy/${provider}/v1`;
  }

  // ── Public API ────────────────────────────────────────────────────────────

  async getDashboardData(hours = 24): Promise<DashboardData | null> {
    if (!(await this.isAlive())) return null;

    if (this.cache && this.cacheTtlMs > 0) {
      const age = Date.now() - this.cache.fetchedAt;
      if (age < this.cacheTtlMs) return this.cache.data;
    }

    const data =
      (await this.tryGetDashboardData(hours)) ??
      (await this.legacyFanout(hours));

    if (data) {
      this.cache = { data, fetchedAt: Date.now() };
    }
    return data;
  }

  async getModelBreakdown(hours = 24): Promise<ModelUsage[] | null> {
    if (!(await this.isAlive())) return null;
    try {
      const res = await fetch(
        `${this.baseUrl}/candela.v1.DashboardService/GetModelBreakdown`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(makeTimeRange(hours)),
        }
      );
      if (!res.ok) return null;
      const data = (await res.json()) as Record<string, unknown>;
      return parseModels((data.models ?? []) as Record<string, unknown>[]);
    } catch {
      return null;
    }
  }

  // ── Private: consolidated RPC ─────────────────────────────────────────────

  private async tryGetDashboardData(
    hours: number
  ): Promise<DashboardData | null> {
    try {
      const res = await fetch(
        `${this.baseUrl}/candela.v1.DashboardService/GetDashboardData`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            ...makeTimeRange(hours),
            include_budget: true,
          }),
        }
      );
      if (res.status === 404 || res.status === 501) return null;
      if (!res.ok) return null;

      const data = (await res.json()) as Record<string, unknown>;
      const s = (data.summary ?? {}) as Record<string, unknown>;
      const usage: UsageSummary = {
        totalTokens:
          Number(s.totalInputTokens ?? s.total_input_tokens ?? 0) +
          Number(s.totalOutputTokens ?? s.total_output_tokens ?? 0),
        inputTokens: Number(s.totalInputTokens ?? s.total_input_tokens ?? 0),
        outputTokens: Number(s.totalOutputTokens ?? s.total_output_tokens ?? 0),
        totalCostUsd: Number(s.totalCostUsd ?? s.total_cost_usd ?? 0),
        requestCount: Number(s.totalLlmCalls ?? s.total_llm_calls ?? 0),
      };

      const models = parseModels((data.models ?? []) as Record<string, unknown>[]);

      const bc = (data.budgetContext ?? data.budget_context) as Record<string, unknown> | undefined;
      let budget: BudgetInfo | null = null;
      let activeGrants: GrantInfo[] = [];
      let totalRemainingUsd: number | null = null;

      if (bc && typeof bc === "object") {
        budget = parseBudget((bc.budget ?? {}) as Record<string, unknown>);
        activeGrants = parseGrants(
          (bc.activeGrants ?? bc.active_grants ?? []) as unknown[]
        );
        const rawRemaining = Number(
          bc.totalRemainingUsd ?? bc.total_remaining_usd ?? 0
        );
        if (isFinite(rawRemaining) && rawRemaining >= 0) {
          totalRemainingUsd = rawRemaining;
        }
      }

      return { usage, models, budget, activeGrants, totalRemainingUsd };
    } catch {
      return null;
    }
  }

  // ── Private: legacy fallback ──────────────────────────────────────────────

  private async legacyFanout(hours: number): Promise<DashboardData | null> {
    try {
      const timeRange = makeTimeRange(hours);
      const [summaryRes, budgetRes] = await Promise.all([
        fetch(
          `${this.baseUrl}/candela.v1.DashboardService/GetUsageSummary`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(timeRange),
          }
        ).catch(() => null),
        fetch(
          `${this.baseUrl}/candela.v1.UserService/GetMyBudget`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({}),
          }
        ).catch(() => null),
      ]);

      let usage: UsageSummary = {
        totalTokens: 0, inputTokens: 0, outputTokens: 0,
        totalCostUsd: 0, requestCount: 0,
      };
      if (summaryRes?.ok) {
        const s = (await summaryRes.json()) as Record<string, unknown>;
        usage = {
          totalTokens:
            Number(s.totalInputTokens ?? s.total_input_tokens ?? 0) +
            Number(s.totalOutputTokens ?? s.total_output_tokens ?? 0),
          inputTokens: Number(s.totalInputTokens ?? s.total_input_tokens ?? 0),
          outputTokens: Number(s.totalOutputTokens ?? s.total_output_tokens ?? 0),
          totalCostUsd: Number(s.totalCostUsd ?? s.total_cost_usd ?? 0),
          requestCount: Number(s.totalLlmCalls ?? s.total_llm_calls ?? 0),
        };
      }

      let budget: BudgetInfo | null = null;
      let activeGrants: GrantInfo[] = [];
      let totalRemainingUsd: number | null = null;
      if (budgetRes?.ok) {
        try {
          const b = (await budgetRes.json()) as Record<string, unknown>;
          budget = parseBudget((b.budget ?? {}) as Record<string, unknown>);
          activeGrants = parseGrants(
            (b.activeGrants ?? b.active_grants ?? []) as unknown[]
          );
          const rawRemaining = Number(
            b.totalRemainingUsd ?? b.total_remaining_usd ?? 0
          );
          if (isFinite(rawRemaining) && rawRemaining >= 0) {
            totalRemainingUsd = rawRemaining;
          }
        } catch { /* non-fatal */ }
      }

      // Include model breakdown in legacy fallback for feature parity
      const models = await this.getModelBreakdown(hours) ?? [];

      return { usage, models, budget, activeGrants, totalRemainingUsd };
    } catch {
      return null;
    }
  }
}

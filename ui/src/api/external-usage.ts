export interface UsageTotals {
  requests: number;
  fresh: number;
  cached: number;
  written: number;
  output: number;
  total: number;
}
export interface ExternalUsageRow extends UsageTotals {
  agentId: string;
  name: string;
  provider: string | null;
  status: "connected" | "pending" | "unsupported" | "unavailable" | "duplicate_mapping" | "quota_only";
  syncedAt: string | null;
  firstEvent: string | null;
  lastEvent: string | null;
  costCents: null;
}
export interface ExternalUsage {
  rows: ExternalUsageRow[];
  totals: UsageTotals;
  refreshing: boolean;
  costCents: null;
  grokAccount?: {
    status: "connected" | "pending" | "unavailable";
    scope: "account";
    tokenUsageAvailable: false;
    percentUsed?: number;
    resetAt?: string;
    planLabel?: string | null;
    syncedAt: string | null;
  } | null;
}

export const externalUsageApi = {
  async get(companyId: string, from?: string, to?: string): Promise<ExternalUsage> {
    if (!["localhost", "127.0.0.1", "[::1]"].includes(window.location.hostname)) {
      throw new Error("Local usage only");
    }
    const query = new URLSearchParams();
    if (from) query.set("from", from);
    if (to) query.set("to", to);
    const response = await fetch(`http://127.0.0.1:3103/api/companies/${encodeURIComponent(companyId)}/external-usage?${query}`, {
      credentials: "omit", cache: "no-store", signal: AbortSignal.timeout(20_000),
    });
    if (!response.ok) throw new Error("Usage service unavailable");
    return response.json();
  },
};

export const COLLABORATION_KINDS = ["dispatch", "review", "escalate", "notify"] as const;
export type CollaborationKind = typeof COLLABORATION_KINDS[number];
export interface CollaborationRule {
  id: string;
  source: string;
  target: string;
  kind: CollaborationKind;
  enabled: boolean;
}
export type AgentPositions = Record<string, { x: number; y: number }>;
export interface CollaborationConfig {
  version: number;
  rules: CollaborationRule[];
  positions: AgentPositions;
  updatedAt: string | null;
  receipt: { version: number; readAt: string; consumer: string } | null;
  scheduler: { state: "paused" | "unknown"; managedExternally: true };
}

export class CollaborationError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

async function request(companyId: string, body?: Pick<CollaborationConfig, "rules" | "positions"> & { expectedVersion: number }): Promise<CollaborationConfig> {
  if (!["localhost", "127.0.0.1", "[::1]"].includes(window.location.hostname)) {
    throw new CollaborationError(0, "Collaboration rules are available only on this computer.");
  }
  let response: Response;
  try {
    response = await fetch(`http://127.0.0.1:3103/api/companies/${encodeURIComponent(companyId)}/collaboration`, {
      method: body ? "PUT" : "GET",
      credentials: "omit",
      cache: "no-store",
      headers: body ? { "Content-Type": "application/json", "X-Leeva-Client": "paperclip-ui" } : undefined,
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    throw new CollaborationError(0, "The local rule service is unavailable. Retry after starting it.");
  }
  if (!response.ok) {
    const details = await response.json().catch(() => null) as { error?: string } | null;
    throw new CollaborationError(response.status, response.status === 409
      ? "Rules changed elsewhere. Cancel this draft, reload, and apply your changes again."
      : details?.error === "Dispatch rules cannot form a cycle"
        ? "Dispatch rules cannot form a cycle. Remove a dispatch line or use a review relationship."
        : "Rules could not be loaded or saved. Check the local service and retry.");
  }
  return response.json();
}

export const collaborationApi = {
  get: (companyId: string) => request(companyId),
  save: (companyId: string, body: Pick<CollaborationConfig, "rules" | "positions"> & { expectedVersion: number }) => request(companyId, body),
};

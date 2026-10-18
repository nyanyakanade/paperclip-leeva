// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { collaborationApi } from "./collaboration";

afterEach(() => vi.unstubAllGlobals());

describe("local collaboration API", () => {
  it("publishes rules with the expected version and no account credentials", async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({ version: 8 }), { status: 200 }));
    vi.stubGlobal("fetch", fetcher);
    const payload = { expectedVersion: 7, rules: [{ id: "r1", source: "a", target: "b", kind: "dispatch" as const, enabled: true }], positions: { a: { x: 12, y: 34 } } };
    await expect(collaborationApi.save("company-1", payload)).resolves.toEqual({ version: 8 });
    expect(fetcher).toHaveBeenCalledWith("http://127.0.0.1:3103/api/companies/company-1/collaboration", expect.objectContaining({ method: "PUT", credentials: "omit", cache: "no-store", headers: { "Content-Type": "application/json", "X-Leeva-Client": "paperclip-ui" }, body: JSON.stringify(payload) }));
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("surfaces a version conflict without retrying or overwriting newer rules", async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: "Rules changed elsewhere. Reload before saving." }), { status: 409 }));
    vi.stubGlobal("fetch", fetcher);
    await expect(collaborationApi.save("company-1", { expectedVersion: 1, rules: [], positions: {} })).rejects.toMatchObject({ status: 409, message: expect.stringContaining("Cancel this draft") });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("explains rejected dispatch loops and unavailable local service", async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({ error: "Dispatch rules cannot form a cycle" }), { status: 400 })).mockRejectedValueOnce(new TypeError("Failed to fetch"));
    vi.stubGlobal("fetch", fetcher);
    await expect(collaborationApi.save("company-1", { expectedVersion: 1, rules: [], positions: {} })).rejects.toThrow("Dispatch rules cannot form a cycle");
    await expect(collaborationApi.get("company-1")).rejects.toThrow("local rule service is unavailable");
  });
});

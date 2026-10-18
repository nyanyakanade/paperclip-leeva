// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Agent } from "@paperclipai/shared";
import type { OrgChartProps } from "../pages/OrgChart";
import type { CollaborationConfig } from "../api/collaboration";
import { CollaborationGraph } from "./CollaborationGraph";

const api = vi.hoisted(() => ({ get: vi.fn(), save: vi.fn() }));
vi.mock("../api/collaboration", async (original) => ({ ...await original<object>(), collaborationApi: api }));
vi.mock("../pages/OrgChart", () => ({ OrgChart: ({ collaboration: editor }: OrgChartProps) => <div>
  <button onClick={() => editor?.onSelectAgent("a")}>Pick A</button>
  <button onClick={() => editor?.onSelectAgent("b")}>Pick B</button>
  <button onClick={() => editor?.onMove("a", { x: 123, y: 456 })}>Move A</button>
  <output>{JSON.stringify(editor?.positions)}</output>
</div> }));

const initial: CollaborationConfig = { version: 2, rules: [], positions: {}, updatedAt: null, receipt: { version: 1, readAt: "2026-10-18T00:00:00Z", consumer: "grok-bot" }, scheduler: { state: "paused", managedExternally: true } };
const agents = [
  { id: "a", name: "A", metadata: { externalKind: "codex_thread", externalId: "thread-a" } },
  { id: "b", name: "B", metadata: { externalKind: "argon", externalId: "argon-b" } },
] as unknown as Agent[];
let container: HTMLDivElement;
let root: Root;
let client: QueryClient;

async function click(text: string) {
  const button = [...container.querySelectorAll("button")].find((item) => item.textContent === text);
  expect(button, text).toBeTruthy();
  await act(async () => { button!.click(); });
}
async function render() {
  await act(async () => { root.render(<QueryClientProvider client={client}><CollaborationGraph companyId="company-1" orgTree={[]} agents={agents} /></QueryClientProvider>); });
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 10)); });
}

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  vi.clearAllMocks();
  api.get.mockResolvedValue(structuredClone(initial));
  api.save.mockImplementation(async (_company, body) => ({ ...initial, ...body, version: 3 }));
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
});
afterEach(async () => { await act(async () => root.unmount()); client.clear(); container.remove(); });

describe("collaboration publishing", () => {
  it("keeps moving and new lines in a draft, then publishes exactly once with the base version", async () => {
    await render();
    expect(container.textContent).toContain("Read by Grok: v1");
    await click("Edit collaboration");
    await click("Move A");
    await click("Pick A");
    await click("Pick B");
    const save = [...container.querySelectorAll("button")].find((item) => item.textContent === "Save rules")!;
    expect(save.disabled).toBe(true);
    expect(api.save).not.toHaveBeenCalled();
    await click("Add line");
    await click("Save rules");
    expect(api.save).toHaveBeenCalledTimes(1);
    expect(api.save).toHaveBeenCalledWith("company-1", { expectedVersion: 2, positions: { a: { x: 123, y: 456 } }, rules: [{ id: expect.any(String), source: "a", target: "b", kind: "dispatch", enabled: true }] });
    expect(container.textContent).toContain("Published version: 3");
    expect(container.textContent).toContain("Read by Grok: v1");
    expect(container.textContent).toContain("Grok scheduling is paused. Saving does not resume it.");
  });

  it("cancels all draft edits without writing the service", async () => {
    await render();
    await click("Edit collaboration");
    await click("Move A");
    await click("Cancel draft");
    expect(api.save).not.toHaveBeenCalled();
    expect(container.querySelector("output")?.textContent).toBe("{}");
    expect(container.textContent).not.toContain("Unsaved draft");
  });

  it("preserves edits after a version conflict and reports the conflict", async () => {
    api.save.mockRejectedValue(new Error("Rules changed elsewhere. Cancel this draft, reload, and apply your changes again."));
    await render();
    await click("Edit collaboration");
    await click("Move A");
    await click("Save rules");
    expect(container.querySelector('[role="alert"]')?.textContent).toContain("Rules changed elsewhere");
    expect(container.querySelector("output")?.textContent).toContain("123");
    expect(container.textContent).toContain("Unsaved draft");
  });

  it("edits an existing line, supports return reviews, and does not alter reporting relationships", async () => {
    api.get.mockResolvedValue({ ...initial, rules: [{ id: "route-1", source: "a", target: "b", kind: "dispatch", enabled: true }] });
    await render();
    await click("Edit collaboration");
    await click("A → B · Dispatch");
    const select = container.querySelector<HTMLSelectElement>('select[aria-label="Relationship"]')!;
    await act(async () => { select.value = "review"; select.dispatchEvent(new Event("change", { bubbles: true })); });
    await click("Update line");
    await click("Save rules");
    expect(api.save.mock.calls[0][1].rules[0]).toEqual({ id: "route-1", source: "a", target: "b", kind: "review", enabled: true });
    expect(api.save.mock.calls[0][1]).not.toHaveProperty("reportsTo");
  });

  it("shows an unavailable service instead of offering an unsavable editor", async () => {
    api.get.mockRejectedValue(new Error("The local rule service is unavailable. Retry after starting it."));
    await render();
    const edit = [...container.querySelectorAll("button")].find((item) => item.textContent === "Edit collaboration")!;
    expect(edit.disabled).toBe(true);
    expect(container.querySelector('[role="alert"]')?.textContent).toContain("local rule service is unavailable");
    expect(api.save).not.toHaveBeenCalled();
  });
});

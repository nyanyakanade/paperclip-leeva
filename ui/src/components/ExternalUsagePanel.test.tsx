// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ExternalUsagePanel } from "./ExternalUsagePanel";
import { i18n } from "../i18n";
const get = vi.hoisted(() => vi.fn());
vi.mock("../api/external-usage", () => ({ externalUsageApi: { get: (...args: unknown[]) => get(...args) } }));
// eslint-disable-next-line @typescript-eslint/no-explicit-any
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: ReturnType<typeof createRoot>;
let client: QueryClient;
const counts = { requests: 1, fresh: 20, cached: 80, written: 0, output: 10, total: 110 };
const row = { ...counts, agentId: "a", name: "Argon", status: "connected", provider: "argon", syncedAt: "2026-10-19T08:00:00Z", lastEvent: "2026-10-19T07:00:00Z", costCents: null };
beforeEach(() => {
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
});
afterEach(async () => {
  act(() => root.unmount());
  client.clear();
  container.remove();
  vi.clearAllMocks();
  await i18n.changeLanguage("en");
});
async function render() {
  await act(async () => {
    root.render(<QueryClientProvider client={client}><ExternalUsagePanel companyId="company" from="start" to="end" /></QueryClientProvider>);
  });
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 15)); });
}

it("shows real counters, date-scoped calls, and unknown charges in Chinese", async () => {
  await i18n.changeLanguage("zh-CN");
  get.mockResolvedValue({ totals: counts, rows: [row], refreshing: false, costCents: null });
  await render();
  expect(get).toHaveBeenCalledWith("company", "start", "end");
  expect(container.textContent).toContain("已接通");
  expect(container.textContent).toContain("实际费用：未取得");
  expect(container.textContent).toContain("缓存读取");
  expect(container.textContent).toContain("110");
  expect(container.textContent).not.toContain("$0");
});

it("shows unknown instead of zero for unmapped sources", async () => {
  get.mockResolvedValue({ totals: { ...counts, total: 0 }, rows: [{ ...row, status: "unsupported", requests: 0, syncedAt: null }], refreshing: false });
  await render();
  expect(container.textContent).toContain("Not connected");
  expect(container.querySelectorAll("tbody td")[1]?.textContent).toBe("—");
  expect(container.textContent).not.toContain("110");
});

it("retains saved usage when a source fails and surfaces service errors", async () => {
  get.mockResolvedValue({ totals: counts, rows: [{ ...row, status: "unavailable" }], refreshing: false });
  await render();
  expect(container.textContent).toContain("Source unavailable · saved data");
  expect(container.textContent).toContain("110");
  get.mockRejectedValue(new Error("offline"));
  await act(async () => { await client.refetchQueries({ queryKey: ["leeva-external-usage"] }); });
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 15)); });
  expect(container.querySelector('[role="alert"]')?.textContent).toContain("unavailable");
  expect(container.textContent).toContain("110");
});

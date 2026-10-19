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

it("keeps Grok account quota separate from Token totals and the date filter", async () => {
  await i18n.changeLanguage("zh-CN");
  get.mockResolvedValue({ totals: counts, rows: [row, { ...row, agentId: "grok", name: "Grok Bot", status: "quota_only", requests: 0 }], refreshing: false,
    grokAccount: { status: "connected", percentUsed: 42.123456, planLabel: "SuperGrok", resetAt: "2026-10-23T16:00:00Z", syncedAt: row.syncedAt } });
  await render();
  const quota = container.querySelector('section[aria-label="Grok 账户额度"]');
  expect(quota?.textContent).toContain("已用 42.12%");
  expect(quota?.textContent).toContain("不受上方日期筛选影响");
  expect(quota?.textContent).toContain("额度已接入 · Token 未提供");
  expect(container.querySelectorAll("tbody tr")[1]?.querySelectorAll("td")[1]?.textContent).toBe("—");
  expect(container.textContent).toContain("110");
});

it.each([undefined, 0])("marks stale quota without inventing zero for a missing reading (%s)", async percentUsed => {
  get.mockResolvedValue({ totals: counts, rows: [], refreshing: false,
    grokAccount: { status: "unavailable", percentUsed, syncedAt: null } });
  await render();
  const quota = container.querySelector('section[aria-label="Grok account quota"]');
  expect(quota?.textContent).toContain("previously signed-in account");
  if (percentUsed == null) expect(quota?.textContent).not.toContain("0% used");
  else expect(quota?.textContent).toContain("0% used");
});

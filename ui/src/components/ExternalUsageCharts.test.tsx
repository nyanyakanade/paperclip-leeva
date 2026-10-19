// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it } from "vitest";
import { ExternalUsageCharts, usageChartData } from "./ExternalUsageCharts";
import type { ExternalUsage, ExternalUsageRow } from "../api/external-usage";
import { i18n } from "../i18n";
// eslint-disable-next-line @typescript-eslint/no-explicit-any
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
const counts = { requests: 2, fresh: 20, cached: 80, written: 0, output: 10, total: 110 };
const row = (id: string, extra: Partial<ExternalUsageRow> = {}): ExternalUsageRow => ({
  ...counts, agentId: id, name: id, provider: "claude", status: "connected", syncedAt: null,
  firstEvent: null, lastEvent: null, costCents: null, ...extra,
});
const data: ExternalUsage = { rows: [row("Alpha"), row("Beta", { requests: 3, fresh: 120, total: 210 }),
  row("Grok", { status: "quota_only", requests: 0 }), row("Duplicate", { status: "duplicate_mapping", requests: 0 })],
  totals: { ...counts, requests: 5, fresh: 140, cached: 160, output: 20, total: 320 }, refreshing: false, costCents: null,
  daily: [{ ...counts, agentId: "Alpha", date: "2026-10-17" },
    { ...counts, requests: 3, fresh: 120, total: 210, agentId: "Beta", date: "2026-10-19" }], dayTimezone: "Asia/Shanghai" };

let container: HTMLDivElement;
let root: ReturnType<typeof createRoot>;
beforeEach(() => {
  container = document.createElement("div"); document.body.append(container); root = createRoot(container);
});
afterEach(async () => { act(() => root.unmount()); container.remove(); await i18n.changeLanguage("en"); });
function render(value = data) { act(() => root.render(<ExternalUsageCharts data={value} />)); }
function select(label: string, value: string) {
  act(() => {
    const control = container.querySelector(`select[aria-label="${label}"]`) as HTMLSelectElement;
    control.value = value; control.dispatchEvent(new Event("change", { bubbles: true }));
  });
}

it("matches aggregate totals, fills date gaps, and excludes quota and duplicate mappings", () => {
  const result = usageChartData(data, "all", "total");
  expect(result.totals).toEqual(data.totals);
  expect(result.rows.map(r => r.name)).toEqual(["Beta", "Alpha"]);
  expect(result.days.map(d => [d.date, d.total])).toEqual([["2026-10-17", 110], ["2026-10-18", 0], ["2026-10-19", 210]]);
});

it("filters daily and composition data together and ranks the selected metric", () => {
  const result = usageChartData(data, "Alpha", "requests");
  expect(result.totals.total).toBe(110);
  expect(result.days).toHaveLength(1);
  expect(usageChartData(data, "all", "uncached").rows[0].name).toBe("Beta");
});

it("changes the visible charts through agent and metric selectors", () => {
  render();
  expect(container.querySelector('[role="img"]')?.getAttribute("aria-label")).toContain("50%");
  select("Chart agent", "Alpha");
  expect(container.querySelector('[role="img"]')?.getAttribute("aria-label")).toContain("72.7%");
  expect(container.querySelector('[aria-label="Beta: 210"]')).toBeNull();
});

it("switches to non-cache counts and requests while keeping all Token categories in composition", () => {
  render(); select("Chart metric", "uncached");
  expect(container.querySelector('[aria-label="Alpha: 30"]')).not.toBeNull();
  expect(container.querySelector('[role="img"]')?.getAttribute("aria-label")).toContain("50%");
  select("Chart metric", "requests");
  expect(container.querySelector('[aria-label="Beta: 3"]')).not.toBeNull();
});

it("shows source failures and empty selections without a misleading zero-percent donut", async () => {
  render({ ...data, rows: [row("Alpha", { status: "unavailable" })] });
  expect(container.querySelector('[role="status"]')?.textContent).toContain("last saved");
  await act(async () => { await i18n.changeLanguage("zh-CN"); });
  render({ ...data, rows: [], daily: [] });
  expect(container.textContent).toContain("暂无已记录用量");
  expect(container.querySelector('[role="img"]')).toBeNull();
});

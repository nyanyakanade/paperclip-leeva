import { useState } from "react";
import type { ExternalUsage, UsageTotals } from "../api/external-usage";
import { useTranslation } from "../i18n";
import { ChartCard } from "./ActivityCharts";
import "./external-usage-copy";

const parts = ["fresh", "cached", "written", "output"] as const;
const colors = {
  fresh: "var(--status-task-icon-in_progress)", cached: "var(--status-task-icon-done)",
  written: "var(--status-task-todo)", output: "var(--status-task-in_review)",
};
type Metric = "total" | "uncached" | "requests";
const empty = (): UsageTotals => ({ requests: 0, fresh: 0, cached: 0, written: 0, output: 0, total: 0 });
const valueOf = (row: UsageTotals, metric: Metric) => metric === "uncached" ? row.fresh + row.output : row[metric];

// A gap means no recorded events, not proof that no model work happened.
export function usageChartData(data: ExternalUsage, agentId: string, metric: Metric) {
  const rows = data.rows.filter(row => (row.status === "connected" || row.requests > 0)
    && (agentId === "all" || row.agentId === agentId));
  const ids = new Set(rows.map(row => row.agentId));
  const totals = empty();
  for (const row of rows) for (const key of Object.keys(totals) as (keyof UsageTotals)[]) totals[key] += row[key];
  const grouped = new Map<string, UsageTotals & { date: string }>();
  for (const day of data.daily ?? []) {
    if (!ids.has(day.agentId)) continue;
    const aggregate = grouped.get(day.date) ?? { ...empty(), date: day.date };
    for (const key of Object.keys(totals) as (keyof UsageTotals)[]) aggregate[key] += day[key];
    grouped.set(day.date, aggregate);
  }
  const dates = [...grouped.keys()].sort();
  const days = [];
  if (dates.length) {
    const last = Date.parse(dates[dates.length - 1] + "T00:00:00Z");
    for (let at = Date.parse(dates[0] + "T00:00:00Z"); at <= last; at += 86_400_000) {
      const date = new Date(at).toISOString().slice(0, 10);
      days.push(grouped.get(date) ?? { ...empty(), date });
    }
  }
  return { totals, days, rows: [...rows].sort((a, b) => valueOf(b, metric) - valueOf(a, metric)) };
}

export function ExternalUsageCharts({ data }: { data: ExternalUsage }) {
  const { t, i18n } = useTranslation("externalUsage");
  const [selection, setSelection] = useState("all");
  const [metric, setMetric] = useState<Metric>("total");
  const [selectedDay, setSelectedDay] = useState("");
  const sources = data.rows.filter(row => row.status === "connected" || row.requests > 0);
  const agentId = sources.some(row => row.agentId === selection) ? selection : "all";
  const { totals, days, rows } = usageChartData(data, agentId, metric);
  const n = (value: number) => value.toLocaleString(i18n.language);
  const compact = (value: number) => value.toLocaleString(i18n.language, { notation: "compact", maximumFractionDigits: 1 });
  const pct = (value: number) => value.toLocaleString(i18n.language, { maximumFractionDigits: 1 }) + "%";
  const activeParts = metric === "uncached" ? (["fresh", "output"] as const) : parts;
  const maxDay = Math.max(1, ...days.map(day => valueOf(day, metric)));
  const maxAgent = Math.max(1, ...rows.map(row => valueOf(row, metric)));
  const selected = days.find(day => day.date === selectedDay) ?? days.at(-1);
  const cachePercent = totals.total ? totals.cached / totals.total * 100 : 0;
  const detail = (day: (typeof days)[number]) => `${day.date} · ${t(metric)}: ${n(valueOf(day, metric))}`
    + (day.requests ? ` · ${parts.map(key => `${t(key)} ${n(day[key])}`).join(" / ")}` : ` · ${t("none")}`);

  function segments(row: UsageTotals, vertical = false) {
    if (metric === "requests") return <div className="h-full w-full" style={{ backgroundColor: colors.fresh }} />;
    return activeParts.filter(key => row[key] > 0).map(key => <div key={key} style={{
      backgroundColor: colors[key], [vertical ? "height" : "width"]: `${row[key] / valueOf(row, metric) * 100}%`,
    }} />);
  }

  return <section aria-label={t("charts")} className="space-y-4">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <h3 className="text-base font-medium">{t("charts")}</h3>
      <div className="flex flex-wrap gap-2">
        <select aria-label={t("chartAgent")} value={agentId} onChange={event => setSelection(event.target.value)}
          className="max-w-full rounded-md border bg-background px-3 py-2 text-sm">
          <option value="all">{t("allAgents")}</option>
          {sources.map(row => <option key={row.agentId} value={row.agentId}>{row.name}</option>)}
        </select>
        <select aria-label={t("chartMetric")} value={metric} onChange={event => setMetric(event.target.value as Metric)}
          className="max-w-full rounded-md border bg-background px-3 py-2 text-sm">
          {(["total", "uncached", "requests"] as const).map(key => <option key={key} value={key}>{t(key)}</option>)}
        </select>
      </div>
    </div>
    {rows.some(row => row.status === "unavailable") && <p role="status" className="text-sm text-destructive">{t("chartStale")}</p>}
    <ChartCard title={t("dailyTitle")} subtitle={t("dailyNote")}>
      {!days.length ? <p className="text-sm text-muted-foreground">{t("chartEmpty")}</p> : <>
        <div className="flex gap-2">
          <div className="flex w-12 shrink-0 flex-col justify-between pb-6 text-right text-xs text-muted-foreground">
            <span>{compact(maxDay)}</span><span>{compact(maxDay / 2)}</span><span>0</span>
          </div>
          <div className="min-w-0 flex-1 overflow-x-auto">
            <div style={{ minWidth: Math.max(260, days.length * 18) }}>
              <div className="flex h-48 items-end gap-1 border-b" aria-label={t("dailyTitle")}>
                {days.map(day => <button type="button" key={day.date} aria-label={detail(day)} title={detail(day)}
                  onClick={() => setSelectedDay(day.date)} onFocus={() => setSelectedDay(day.date)}
                  onMouseEnter={() => setSelectedDay(day.date)}
                  className="flex h-full min-w-0 flex-1 flex-col justify-end rounded-sm focus-visible:outline-2 focus-visible:outline-ring"
                  style={{ opacity: selected?.date === day.date ? 1 : 0.75 }}>
                  <div className="flex w-full flex-col-reverse overflow-hidden rounded-t-sm"
                    style={{ height: `${valueOf(day, metric) / maxDay * 100}%` }}>{segments(day, true)}</div>
                </button>)}
              </div>
              <div className="flex justify-between pt-1 text-xs text-muted-foreground">
                <span>{days[0].date}</span>{days.length > 1 && <span>{days[days.length - 1].date}</span>}
              </div>
            </div>
          </div>
        </div>
        <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
          {(metric === "requests" ? ["requests"] as const : activeParts).map(key => <span key={key} className="flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-sm" style={{ backgroundColor: key === "requests" ? colors.fresh : colors[key] }} />{t(key)}
          </span>)}
        </div>
        <p className="min-h-10 text-xs leading-5 text-muted-foreground" aria-live="polite">{selected && detail(selected)}</p>
      </>}
    </ChartCard>
    <div className="grid gap-4 xl:grid-cols-2">
      <ChartCard title={t("agentTitle")} subtitle={t(metric)}>
        {!rows.length ? <p className="text-sm text-muted-foreground">{t("chartEmpty")}</p> : <div className="space-y-4">
          {rows.map(row => <div key={row.agentId} aria-label={`${row.name}: ${n(valueOf(row, metric))}`}>
            <div className="mb-1.5 flex flex-wrap justify-between gap-2 text-sm"><span>{row.name}</span><span className="tabular-nums">{n(valueOf(row, metric))}</span></div>
            <div className="h-3 overflow-hidden rounded-sm bg-muted">
              <div className="flex h-full" style={{ width: `${valueOf(row, metric) / maxAgent * 100}%` }}>{segments(row)}</div>
            </div>
          </div>)}
        </div>}
      </ChartCard>
      <ChartCard title={t("compositionTitle")} subtitle={t("compositionNote")}>
        {!totals.total ? <p className="text-sm text-muted-foreground">{t("chartEmpty")}</p> : <div className="flex flex-col items-center gap-5 sm:flex-row">
          <svg viewBox="0 0 120 120" className="h-40 w-40 shrink-0" role="img" aria-label={t("cacheShare", { percent: pct(cachePercent) })}>
            {parts.map((key, index) => {
              const percent = totals[key] / totals.total * 100;
              const offset = parts.slice(0, index).reduce((sum, part) => sum + totals[part] / totals.total * 100, 0);
              return percent > 0 && <circle key={key} cx="60" cy="60" r="43" fill="none" stroke={colors[key]}
                strokeWidth="13" pathLength="100" strokeDasharray={`${percent} ${100 - percent}`} strokeDashoffset={-offset} transform="rotate(-90 60 60)">
                <title>{t(key)}: {n(totals[key])} · {pct(percent)}</title>
              </circle>;
            })}
            <text x="60" y="59" textAnchor="middle" className="fill-foreground text-base font-semibold">{pct(cachePercent)}</text>
            <text x="60" y="73" textAnchor="middle" className="fill-muted-foreground text-(length:--text-nano)">{t("cacheShareShort")}</text>
          </svg>
          <ul className="w-full min-w-0 flex-1 space-y-3 text-sm">
            {parts.map(key => <li key={key} className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
              <span className="flex items-center gap-2"><span className="h-2 w-2 rounded-sm" style={{ backgroundColor: colors[key] }} />{t(key)}</span>
              <span className="tabular-nums">{n(totals[key])} <span className="text-xs text-muted-foreground">({pct(totals[key] / totals.total * 100)})</span></span>
            </li>)}
          </ul>
        </div>}
      </ChartCard>
    </div>
    <p className="text-xs leading-5 text-muted-foreground">{t("chartScope")}</p>
  </section>;
}

import { useState } from "react";
import type { TaskUsageAudit, TaskUsagePhase, TaskUsageRow, UsageTotals } from "../api/external-usage";
import { useTranslation } from "../i18n";
import "./task-usage-copy";

const phases: TaskUsagePhase[] = ["dispatch", "review", "coordination", "mixed", "execution", "rework"];
const colors = ["var(--status-task-todo)", "var(--status-task-in_review)", "var(--muted-foreground)",
  "var(--status-task-icon-cancelled)", "var(--status-task-icon-done)", "var(--status-task-icon-in_progress)"];
type Metric = "total" | "uncached" | "requests";
export const taskMetric = (v: UsageTotals, metric: Metric) => metric === "uncached" ? v.fresh + v.output : v[metric];
const groupValue = (row: TaskUsageRow, metric: Metric, controller: boolean) => phases
  .filter(p => ["execution", "rework"].includes(p) !== controller)
  .reduce((sum, phase) => sum + taskMetric(row.phases[phase], metric), 0);

export function TaskUsageComparison({ audit }: { audit?: TaskUsageAudit }) {
  const { t, i18n } = useTranslation("taskUsage");
  const [metric, setMetric] = useState<Metric>("uncached");
  const [executor, setExecutor] = useState("all");
  const n = (value: number) => value.toLocaleString(i18n.language);
  const compact = (value: number) => value.toLocaleString(i18n.language, { notation: "compact", maximumFractionDigits: 1 });
  if (!audit || audit.status !== "ready") return <section aria-label={t("title")} className="rounded-lg border p-4">
    <h3 className="font-medium">{t("title")}</h3>
    <p role={audit?.status === "invalid" ? "alert" : "status"} className="mt-2 text-sm text-muted-foreground">{t(audit?.status ?? "missing")}</p>
  </section>;
  const executors = [...new Set(audit.rows.map(row => row.executor))];
  const selected = executors.includes(executor) ? executor : "all";
  const rows = audit.rows.filter(row => selected === "all" || row.executor === selected);
  const max = Math.max(1, ...rows.map(row => taskMetric(row.totals, metric)));
  const total = taskMetric(audit.totals, metric);
  const coverage = total ? taskMetric(audit.assigned, metric) / total * 100 : null;
  return <section aria-label={t("title")} className="space-y-4 rounded-lg border p-4">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <h3 className="text-base font-medium">{t("title")}</h3>
      <div className="flex flex-wrap gap-2">
        <select aria-label={t("executor")} value={selected} onChange={event => setExecutor(event.target.value)} className="max-w-full rounded-md border bg-background px-3 py-2 text-sm">
          <option value="all">{t("all")}</option>{executors.map(value => <option key={value}>{value}</option>)}
        </select>
        <select aria-label={t("metric")} value={metric} onChange={event => setMetric(event.target.value as Metric)} className="max-w-full rounded-md border bg-background px-3 py-2 text-sm">
          {(["uncached", "total", "requests"] as const).map(value => <option key={value} value={value}>{t(value)}</option>)}
        </select>
      </div>
    </div>
    <p className="text-xs leading-5 text-muted-foreground">{t("snapshot")}: {new Date(audit.generatedAt).toLocaleString(i18n.language)} · {audit.scope}</p>
    <div className="flex flex-wrap gap-6 text-sm">
      <span>{t("assigned")}: <strong className="tabular-nums">{n(taskMetric(audit.assigned, metric))}</strong></span>
      <span>{t("shared")}: <strong className="tabular-nums">{n(taskMetric(audit.shared, metric))}</strong></span>
      <span>{t("coverage")}: <strong>{coverage === null ? "—" : `${coverage.toLocaleString(i18n.language, { maximumFractionDigits: 1 })}%`}</strong></span>
    </div>
    <p className="text-xs text-muted-foreground">{t("summaryScope")}</p>
    <div className="flex flex-wrap gap-3 text-xs text-muted-foreground">{phases.map((phase, i) => <span key={phase} className="flex items-center gap-1">
      <span className="h-2 w-2 rounded-sm" style={{ backgroundColor: colors[i] }} />{t(phase)}
    </span>)}</div>
    {!rows.length ? <p>{t("empty")}</p> : <div className="overflow-x-auto">
      <table className="w-full text-left text-sm">
        <caption className="sr-only">{t("title")} · {t(metric)}</caption>
        <thead className="border-b text-xs text-muted-foreground"><tr>{["task", "controller", "workerTotal", "sum"].map(key => <th scope="col" key={key} className="whitespace-nowrap px-2 py-2 font-medium">{t(key)}</th>)}</tr></thead>
        <tbody>{rows.map(row => <tr key={row.id} className="border-b last:border-0 align-top">
          <th scope="row" className="min-w-56 px-2 py-3 font-normal">
            <div className="font-medium">{row.id} · {row.name}</div>
            <div className="mt-1 text-xs text-muted-foreground">{row.executor} · {row.outcome}</div>
            {(!row.complete || row.partialRange) && <div className="mt-1 text-xs text-muted-foreground">{!row.complete && t("incomplete")} {row.partialRange && t("partial")}</div>}
            {row.shared.requests > 0 && <div className="mt-1 text-xs text-muted-foreground">{t("sharedPending")}</div>}
            <div className="mt-2 h-2 rounded-sm bg-muted" role="img" aria-label={`${row.id}: ${n(taskMetric(row.totals, metric))} ${t(metric)}`}>
              <div className="flex h-full overflow-hidden rounded-sm" style={{ width: `${taskMetric(row.totals, metric) / max * 100}%` }}>
                {phases.map((phase, i) => <div key={phase} title={`${t(phase)}: ${n(taskMetric(row.phases[phase], metric))}`} style={{ backgroundColor: colors[i], width: `${taskMetric(row.totals, metric) ? taskMetric(row.phases[phase], metric) / taskMetric(row.totals, metric) * 100 : 0}%` }} />)}
              </div>
            </div>
            <details className="mt-2 text-xs leading-5 text-muted-foreground">
              <summary className="cursor-pointer">{t("detail")}</summary>
              {phases.map(phase => <div key={phase}>{t(phase)}: {row.phases[phase].requests ? n(taskMetric(row.phases[phase], metric)) : "—"} ({t(metric)})</div>)}
              <p>{t("basis")}: {row.basis}</p>
              <p>{t("models")}: {row.models.join(", ")}</p>
              <p>{t("exposure")}: {n(taskMetric(row.shared, metric))} ({t(metric)})</p>
              {(["fresh", "cached", "written", "output"] as const).map(key => <div key={key}>{t(key)}: {n(row.totals[key])}</div>)}
            </details>
          </th>
          {[true, false].map(controller => <td key={String(controller)} className="whitespace-nowrap px-2 py-3 tabular-nums" title={n(groupValue(row, metric, controller))}>{groupValue(row, "requests", controller) ? compact(groupValue(row, metric, controller)) : "—"}</td>)}
          <td className="whitespace-nowrap px-2 py-3 font-medium tabular-nums" title={n(taskMetric(row.totals, metric))}>{compact(taskMetric(row.totals, metric))}</td>
        </tr>)}</tbody>
      </table>
    </div>}
    <details className="text-sm"><summary className="cursor-pointer">{t("shared")} · {n(taskMetric(audit.shared, metric))}</summary>
      <div className="mt-2 space-y-2">{audit.pools.map((pool, i) => <div key={i} className="flex justify-between gap-4 text-xs">
        <span>{pool.reason}</span><span className="whitespace-nowrap tabular-nums">{n(taskMetric(pool.totals, metric))}</span>
      </div>)}</div>
    </details>
    <p className="text-xs leading-5 text-muted-foreground">{t("sharedNote")} {t("metricNote")}</p>
    <p className="text-sm leading-6">{t("method")}</p>
  </section>;
}

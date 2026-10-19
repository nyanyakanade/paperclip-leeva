import { useQuery } from "@tanstack/react-query";
import { externalUsageApi } from "../api/external-usage";
import { useTranslation } from "../i18n";
import { Button } from "./ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "./ui/card";
import "./external-usage-copy";
import { ExternalUsageCharts } from "./ExternalUsageCharts";
import { TaskUsageComparison } from "./TaskUsageComparison";

export function ExternalUsagePanel({ companyId, from, to, enabled = true }: {
  companyId: string; from?: string; to?: string; enabled?: boolean;
}) {
  const { t, i18n } = useTranslation("externalUsage");
  const query = useQuery({
    queryKey: ["leeva-external-usage", companyId, from, to],
    queryFn: () => externalUsageApi.get(companyId, from, to),
    enabled,
    retry: false,
    refetchInterval: (q) => q.state.data?.refreshing ? 3_000 : 60_000,
  });
  const n = (value: number) => value.toLocaleString(i18n.language);
  const date = (value: string | null) => value ? new Date(value).toLocaleString(i18n.language) : "—";
  const data = query.data;
  const hasCounts = data?.rows.some(row => row.status === "connected" || row.requests > 0);
  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <CardTitle>{t("title")}</CardTitle>
          <Button size="sm" variant="outline" disabled={!enabled || query.isFetching || data?.refreshing}
            onClick={() => void query.refetch()}>
            {t(data?.refreshing ? "syncing" : "refresh")}
          </Button>
        </div>
        <CardDescription>{t("description")}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {query.error && <p role="alert" className="text-sm text-destructive">{t("error")}</p>}
        {query.isLoading && <p role="status" className="text-sm text-muted-foreground">{t("loading")}</p>}
        {data && <>
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-5">
            {(["total", "fresh", "cached", "written", "output"] as const).map((key) => (
              <div key={key}>
                <div className="text-xs text-muted-foreground">{t(key)}</div>
                <div className="mt-1 text-lg font-semibold tabular-nums">{hasCounts ? n(data.totals[key]) : "—"}</div>
              </div>
            ))}
          </div>
          <p className="text-sm">{t("money")}</p>
          <TaskUsageComparison audit={data.taskAudit} />
          <ExternalUsageCharts data={data} />
          {data.grokAccount && <section aria-label={t("grokTitle")} className="space-y-2 rounded-lg border p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="text-sm font-medium">{t("grokTitle")}{data.grokAccount.planLabel ? ` · ${data.grokAccount.planLabel}` : ""}</h3>
              <span className="text-xs text-muted-foreground">{t(data.grokAccount.status === "connected" ? "quota_only" : data.grokAccount.status)}</span>
            </div>
            <div className="text-lg font-semibold tabular-nums">
              {data.grokAccount.percentUsed != null
                ? t("grokUsed", { percent: data.grokAccount.percentUsed.toLocaleString(i18n.language, { maximumFractionDigits: 2 }) })
                : "—"}
            </div>
            <p className="text-xs text-muted-foreground">{t("grokReset")}: {date(data.grokAccount.resetAt ?? null)} · {t("synced")}: {date(data.grokAccount.syncedAt)}</p>
            {data.grokAccount.status === "unavailable" && <p role="status" className="text-sm text-destructive">{t("grokStale")}</p>}
            <p className="text-xs leading-5 text-muted-foreground">{t("grokScope")}</p>
          </section>}
          {!data.rows.length ? <p>{t("empty")}</p> : <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <caption className="sr-only">{t("title")}</caption>
              <thead className="border-b text-xs text-muted-foreground">
                <tr>{["agent", "state", "requests", "fresh", "cached", "written", "output", "total"].map(key => (
                  <th key={key} scope="col" className="whitespace-nowrap px-3 py-2 font-medium">{t(key)}</th>
                ))}</tr>
              </thead>
              <tbody>{[...data.rows].sort((a, b) => Number(a.status === "unsupported") - Number(b.status === "unsupported")).map(row => {
                const hasData = row.status === "connected" || row.requests > 0;
                return <tr key={row.agentId} className="border-b last:border-0">
                  <th scope="row" className="px-3 py-3 font-medium">
                    {row.name}
                    {row.syncedAt && <div className="mt-1 whitespace-nowrap text-xs font-normal text-muted-foreground">
                      {t("synced")}: {date(row.syncedAt)}
                    </div>}
                    {hasData && <div className="mt-1 whitespace-nowrap text-xs font-normal text-muted-foreground">
                      {row.lastEvent ? `${t("last")}: ${date(row.lastEvent)}` : t("none")}
                    </div>}
                  </th>
                  <td className="whitespace-nowrap px-3 py-3 text-muted-foreground">{t(row.status)}</td>
                  {(["requests", "fresh", "cached", "written", "output", "total"] as const).map(key => (
                    <td key={key} className="whitespace-nowrap px-3 py-3 tabular-nums">{hasData ? n(row[key]) : "—"}</td>
                  ))}
                </tr>;
              })}</tbody>
            </table>
          </div>}
        </>}
        <p className="text-xs leading-5 text-muted-foreground">{t("saved")} {t("scope")}</p>
      </CardContent>
    </Card>
  );
}

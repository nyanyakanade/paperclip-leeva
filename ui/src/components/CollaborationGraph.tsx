import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { Agent } from "@paperclipai/shared";
import type { OrgNode } from "../api/agents";
import { collaborationApi, COLLABORATION_KINDS, type CollaborationConfig, type CollaborationKind, type CollaborationRule } from "../api/collaboration";
import { OrgChart } from "../pages/OrgChart";
import { Button } from "./ui/button";
import { displayText } from "../i18n/display";

const kindLabels: Record<CollaborationKind, string> = { dispatch: "Dispatch", review: "Send for review", escalate: "Escalate", notify: "Notify" };
const kindHelp: Record<CollaborationKind, string> = {
  dispatch: "Source delegates a task to target.",
  review: "Source sends its result to target for review.",
  escalate: "Source asks target for deeper judgment.",
  notify: "Source notifies target of progress.",
};

export function validateCollaborationRule(rule: Omit<CollaborationRule, "id">, rules: CollaborationRule[], selectedId: string | null): string | null {
  if (!rule.source || !rule.target) return "Choose a source and a target agent.";
  if (rule.source === rule.target) return "Choose two different agents.";
  if (rules.some((existing) => existing.id !== selectedId && existing.source === rule.source && existing.target === rule.target && existing.kind === rule.kind)) return "This collaboration rule already exists.";
  return null;
}

const blankRule = (): Omit<CollaborationRule, "id"> => ({ source: "", target: "", kind: "dispatch", enabled: true });

/** Rules are published separately from the existing reporting hierarchy. Never wakes an agent. */
export function CollaborationGraph({ companyId, orgTree, agents }: { companyId: string; orgTree: OrgNode[]; agents: Agent[] }) {
  const queryClient = useQueryClient();
  const queryKey = ["leeva-collaboration", companyId];
  const query = useQuery({ queryKey, queryFn: () => collaborationApi.get(companyId), retry: false, refetchInterval: 15_000 });
  const [draft, setDraft] = useState<CollaborationConfig | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [form, setForm] = useState(blankRule);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const config = draft ?? query.data;
  const editing = draft !== null;
  const changedElsewhere = draft && query.data && draft.version !== query.data.version;
  const selectedRule = draft?.rules.find((rule) => rule.id === selectedId);
  const unappliedLine = editing && (selectedRule
    ? selectedRule.source !== form.source || selectedRule.target !== form.target || selectedRule.kind !== form.kind || selectedRule.enabled !== form.enabled
    : Boolean(form.source || form.target));
  const unmappedAgents = agents.filter((agent) => !["codex_thread", "argon"].includes(String(agent.metadata?.externalKind)) || typeof agent.metadata?.externalId !== "string" || !agent.metadata.externalId);

  useEffect(() => {
    if (!draft) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [draft]);

  const selectRule = (id: string) => {
    const rule = config?.rules.find((item) => item.id === id);
    if (!rule || !config || saving) return;
    if (!draft) setDraft(structuredClone(config));
    setSelectedId(id);
    setForm({ source: rule.source, target: rule.target, kind: rule.kind, enabled: rule.enabled });
    setError(null);
  };
  const reconnect = (id: string, end: "source" | "target", agentId: string) => {
    const original = config?.rules.find((item) => item.id === id);
    if (!original || !config || saving) return;
    const rule = { ...original, [end]: agentId };
    const issue = validateCollaborationRule(rule, config.rules, id);
    if (issue) { setError(issue); return; }
    setDraft({ ...config, rules: config.rules.map((item) => item.id === id ? rule : item) });
    setSelectedId(id);
    setForm({ source: rule.source, target: rule.target, kind: rule.kind, enabled: rule.enabled });
    setError(null);
    setSaved(false);
  };
  const applyLine = () => {
    if (!draft) return;
    const issue = validateCollaborationRule(form, draft.rules, selectedId);
    if (issue) { setError(issue); return; }
    const rule = { ...form, id: selectedId ?? crypto.randomUUID() };
    setDraft({ ...draft, rules: selectedId ? draft.rules.map((item) => item.id === selectedId ? rule : item) : [...draft.rules, rule] });
    setSelectedId(rule.id);
    setError(null);
  };
  const resetForm = () => { setSelectedId(null); setForm(blankRule()); setError(null); };
  const cancel = () => { setDraft(null); resetForm(); void query.refetch(); };
  const save = async () => {
    if (!draft || saving) return;
    setSaving(true);
    setError(null);
    try {
      const result = await collaborationApi.save(companyId, { expectedVersion: draft.version, rules: draft.rules, positions: draft.positions });
      queryClient.setQueryData(queryKey, result);
      setDraft(null);
      resetForm();
      setSaved(true);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Rules could not be loaded or saved. Check the local service and retry.");
    } finally { setSaving(false); }
  };

  return <div className="flex min-h-0 flex-1 flex-col gap-3" data-testid="collaboration-graph">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div className="space-y-1 text-xs text-muted-foreground" aria-live="polite">
        <p className="font-medium text-foreground">Collaboration rules</p>
        {query.isPending ? <p>Loading rules...</p> : query.data ? <p>
          <span>Published version</span>: <span className="font-mono">{query.data.version}</span>
          {" · "}{query.data.receipt ? <><span>Read by Grok</span>: <span className="font-mono">v{query.data.receipt.version}</span></> : <span>Grok has not read a published version yet.</span>}
        </p> : null}
        <p>{displayText(query.data?.scheduler.state === "paused" ? "Grok scheduling is paused. Saving does not resume it." : "Grok manages scheduling externally. Saving does not wake agents.")}</p>
        <p>Read receipts confirm rule loading, not task execution.</p>
        {saved && !editing && <p className="text-foreground">Rules published. They apply to future scheduling after Grok reads this version.</p>}
      </div>
      {!editing ? <Button size="sm" variant="outline" disabled={!query.data || query.isError} onClick={() => { setDraft(structuredClone(query.data!)); resetForm(); setSaved(false); }}>Move cards / edit lines</Button> : <div className="flex items-center gap-2">
        <Button size="sm" variant="ghost" disabled={saving} onClick={cancel}>Cancel draft</Button>
        <Button size="sm" disabled={saving || Boolean(changedElsewhere) || Boolean(unappliedLine)} onClick={() => void save()}>{displayText(saving ? "Saving..." : "Save rules")}</Button>
      </div>}
    </div>
    {query.isError && <div role="alert" className="flex flex-wrap items-center gap-2 text-sm text-destructive">
      <span>{displayText(query.error.message)}</span>
      <Button size="sm" variant="outline" onClick={() => void query.refetch()}>Retry</Button>
    </div>}
    {changedElsewhere && <p role="alert" className="text-sm text-destructive">Rules changed elsewhere. Cancel this draft, reload, and apply your changes again.</p>}
    {error && <p role="alert" className="text-sm text-destructive">{displayText(error)}</p>}
    {unmappedAgents.length > 0 && <p className="text-xs text-muted-foreground"><span>No supported delivery mapping; routes to these agents cannot execute</span>: {unmappedAgents.map((agent) => agent.name).join(", ")}{" · "}<span>Grok can be a source, but it is not a delivery target.</span></p>}
    <p className="text-xs text-muted-foreground">Drag cards directly. Select a colored line, then drag either endpoint onto another agent. Save to keep changes.</p>
    <p className="text-xs text-muted-foreground">Gray dashed lines show reporting only. Colored arrows control collaboration. Moving a card only changes its layout.</p>
    <OrgChart embedded orgTree={orgTree} agents={agents} collaboration={{
      rules: config?.rules ?? [], positions: config?.positions ?? {}, editing: editing && !saving,
      interactive: Boolean(config) && !saving,
      selectedRuleId: selectedId, selectedAgentId: editing ? form.source : null,
      onMove: (id, position) => {
        if (!config || saving) return;
        setDraft((current) => { const base = current ?? config; return { ...base, positions: { ...base.positions, [id]: position } }; });
        setSaved(false);
      },
      onSelectAgent: (id) => { if (!form.source || (form.source && form.target)) { setSelectedId(null); setForm({ ...blankRule(), source: id }); } else setForm({ ...form, target: id }); },
      onSelectRule: selectRule, onReconnect: reconnect,
    }} />
    {editing && <div className="space-y-3 rounded-lg border border-border p-3">
      <p className="text-xs text-muted-foreground">Unsaved draft. Drag cards to move them. Click two cards to choose source and target; click a colored line to edit it.</p>
      <div className="flex flex-wrap items-end gap-3">
        {(["source", "target"] as const).map((field) => <label key={field} className="flex flex-1 flex-col gap-1 text-xs">
          <span>{displayText(field === "source" ? "Source agent" : "Target agent")}</span>
          <select aria-label={displayText(field === "source" ? "Source agent" : "Target agent")} className="h-9 rounded-md border border-input bg-background px-3 text-sm" value={form[field]} disabled={saving} onChange={(event) => setForm({ ...form, [field]: event.target.value })}>
            <option value="">{displayText("Choose an agent")}</option>
            {agents.map((agent) => <option key={agent.id} value={agent.id}>{agent.name}</option>)}
          </select>
        </label>)}
        <label className="flex flex-col gap-1 text-xs"><span>Relationship</span>
          <select aria-label={displayText("Relationship")} className="h-9 rounded-md border border-input bg-background px-3 text-sm" value={form.kind} disabled={saving} onChange={(event) => setForm({ ...form, kind: event.target.value as CollaborationKind })}>
            {COLLABORATION_KINDS.map((kind) => <option key={kind} value={kind}>{displayText(kindLabels[kind])}</option>)}
          </select>
        </label>
        <label className="flex h-9 items-center gap-2 text-xs"><input type="checkbox" checked={form.enabled} disabled={saving} onChange={(event) => setForm({ ...form, enabled: event.target.checked })} />Enabled</label>
        <Button size="sm" variant="outline" disabled={saving} onClick={applyLine}>{displayText(selectedId ? "Update line" : "Add line")}</Button>
        {selectedId && <>
          <Button size="sm" variant="ghost" disabled={saving} onClick={() => { setDraft({ ...draft, rules: draft.rules.filter((rule) => rule.id !== selectedId) }); resetForm(); }}>Delete line</Button>
        </>}
        <Button size="sm" variant="ghost" disabled={saving} onClick={resetForm}>New line</Button>
      </div>
      <p className="text-xs text-muted-foreground">{displayText(kindHelp[form.kind])} <span>Add or update the line before saving all rules.</span></p>
      {unappliedLine && <p className="text-xs text-foreground">Apply line changes before publishing, or choose New line to discard them.</p>}
    </div>}
    {config && <div className="flex flex-wrap gap-2" aria-label="Collaboration lines">
      {config.rules.length === 0 ? <p className="text-xs text-muted-foreground">No collaboration rules published yet. Reporting lines do not dispatch tasks.</p> : config.rules.map((rule) => <Button key={rule.id} size="sm" variant={selectedId === rule.id ? "secondary" : "ghost"} disabled={saving} onClick={() => selectRule(rule.id)} className="h-auto whitespace-normal text-xs">
        {agents.find((agent) => agent.id === rule.source)?.name ?? rule.source} → {agents.find((agent) => agent.id === rule.target)?.name ?? rule.target} · {displayText(kindLabels[rule.kind])}{rule.enabled ? "" : ` · ${displayText("Disabled")}`}
      </Button>)}
    </div>}
  </div>;
}

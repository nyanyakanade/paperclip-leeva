import { i18n } from "../i18n";

// Separate namespace keeps the small upstream core locale schema unchanged.
const en = {
  title: "Usage from original apps",
  description: "Read from mapped Codex conversations and Gemini / Argon. Tasks continue in their original apps.",
  refresh: "Refresh usage", syncing: "Syncing usage…", loading: "Reading local usage…",
  error: "The local usage connection is unavailable. Existing figures may be stale; retry after the service is restored.",
  empty: "No mapped usage sources in this organization.",
  total: "Recorded tokens", fresh: "Uncached input", cached: "Cache read", written: "Cache write", output: "Output",
  agent: "Agent", state: "Connection", requests: "Requests", last: "Last usage", synced: "Last sync",
  money: "Actual charges: unavailable. Token totals are not a bill; the Paperclip ledger below excludes this external usage.",
  scope: "Scope: currently mapped conversations and Codex subagents. Guardian approvals, unmapped conversations and Argon subagent trajectories are excluded. Missing sources are not zero usage. Dispatch, review and execution have not yet been separated per task.",
  connected: "Connected", pending: "Waiting for first sync", unsupported: "Not connected", unavailable: "Source unavailable · saved data", duplicate_mapping: "Duplicate mapping · excluded",
  none: "No records in range", first: "First usage in range",
  saved: "Showing saved counts. Sources refresh while this page is open, at most once per minute.",
};
const zh = {
  title: "原应用用量",
  description: "读取已映射的 Codex 会话和 Gemini / Argon；任务仍在原应用执行。",
  refresh: "刷新用量", syncing: "正在同步用量…", loading: "正在读取本机用量…",
  error: "本机用量连接暂不可用。已有数字可能过期，请在服务恢复后重试。",
  empty: "当前组织没有已映射的用量来源。",
  total: "已记录 Token", fresh: "非缓存输入", cached: "缓存读取", written: "缓存写入", output: "输出",
  agent: "智能体", state: "连接状态", requests: "请求数", last: "最近一笔", synced: "最近同步",
  money: "实际费用：未取得。Token 总量不等于账单金额；下方 Paperclip 账本不包含这些外部用量。",
  scope: "范围：当前映射的会话及 Codex 子智能体。不含系统审批、未映射会话和 Argon 子轨迹。未接入不代表零消耗；派工、验收、执行还未逐任务拆分。",
  connected: "已接通", pending: "等待首次同步", unsupported: "未接入", unavailable: "来源不可用 · 保留历史", duplicate_mapping: "重复映射 · 已排除",
  none: "所选时段无记录", first: "时段内首笔",
  saved: "显示已保存的记录；打开此页时每分钟读取一次原应用，刷新不会调用模型。",
};
i18n.addResourceBundle("en", "externalUsage", en, true, true);
i18n.addResourceBundle("zh-CN", "externalUsage", zh, true, true);

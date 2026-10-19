import { i18n } from "../i18n";

const en = {
  title: "Per-task delegation comparison", metric: "Task comparison metric", total: "All recorded Tokens",
  uncached: "Fresh input + output", requests: "Requests", executor: "Task executor", all: "All executors",
  dispatch: "Dispatch", review: "Review", coordination: "Coordination / pending checks", mixed: "Mixed controller turn",
  execution: "Execution", rework: "Rework / continuation", task: "Task / outcome", sum: "Attributed total",
  controller: "Controller · attributed", workerTotal: "Executor · incl. rework", sharedPending: "Related shared costs excluded",
  assigned: "Attributed to tasks", shared: "Shared / unassigned", coverage: "Sample attribution coverage",
  snapshot: "Attribution snapshot", incomplete: "Incomplete lifecycle", partial: "Date filter clips this task",
  summaryScope: "Summary covers all samples in the date range. The executor filter only changes the task list; shared costs stay unallocated.",
  detail: "Evidence and Token breakdown", basis: "Attribution basis", models: "Observed models", exposure: "Related shared turns",
  sharedNote: "Shared responses are counted once in the pool, never divided evenly or added to each related task. Task totals exclude this pool; missing stages do not mean zero cost.",
  metricNote: "Token volume is not money. Fresh input + output excludes both cache categories; cache still has a cost. Cross-model Token counts are not comparable prices.",
  method: "Use a complete, independently acceptable deliverable as the delegation unit. Keep implementation, tests and delivery together. Combine small edits sharing context; stage uncertain work by falsifiable milestones. No optimal Token threshold or monetary saving is established without comparable accepted outcomes and a direct-execution baseline.",
  empty: "No attributed task samples in this date range.", missing: "No reviewed task-attribution snapshot yet.",
  invalid: "Task-attribution snapshot failed validation; counts are hidden to avoid misleading totals.",
  fresh: "Fresh input", cached: "Cache read", written: "Cache write", output: "Output",
};
const zh = {
  title: "逐任务派工与执行对比", metric: "任务对比指标", total: "全部已记录 Token",
  uncached: "非缓存输入 + 输出", requests: "请求数", executor: "任务执行者", all: "全部执行者",
  dispatch: "主控派工", review: "主控验收", coordination: "协调 / 暂缓复核", mixed: "主控混合回合",
  execution: "执行", rework: "返工 / 续做", task: "任务与结果", sum: "已归属合计",
  controller: "主控（已归属）", workerTotal: "执行（含返工）", sharedPending: "另有相关公共开销，未计入",
  assigned: "已归属任务", shared: "公共 / 未归属开销", coverage: "样本归属覆盖率",
  snapshot: "归属快照", incomplete: "生命周期未完整", partial: "日期筛选截断此任务",
  summaryScope: "汇总覆盖所选日期的全部样本。执行者筛选只改变任务列表，公共开销保持未分摊。",
  detail: "归属依据与 Token 明细", basis: "归属依据", models: "实际记录模型", exposure: "涉及的公共回合",
  sharedNote: "公共回合只在公共池计算一次，不平均分摊，也不重复加到相关任务。任务合计未包含公共池；缺少某阶段记录不代表零成本。",
  metricNote: "Token 量不等于费用。非缓存输入 + 输出不含两类缓存，但缓存仍有成本；不同模型的 Token 不能按相同单价理解。",
  method: "近期按“一个可独立验收的完整成果”派工，实现、测试和交付放在同一单。共享上下文的小修改可合并；高不确定任务按可否定的里程碑拆。还没有同质量直接执行对照，不能宣称最优 Token 门槛或实际省钱比例。",
  empty: "所选日期没有已归属的任务样本。", missing: "尚未导入经过核对的任务归属快照。",
  invalid: "任务归属快照未通过校验，已隐藏数字，避免错误合计。",
  fresh: "非缓存输入", cached: "缓存读取", written: "缓存写入", output: "输出",
};
i18n.addResourceBundle("en", "taskUsage", en, true, false);
i18n.addResourceBundle("zh-CN", "taskUsage", zh, true, false);

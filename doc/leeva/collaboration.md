# 协作图与 Grok 调度

Paperclip 首页保存协作规则，Grok Bot 保留现有调度职责。组织上下级、协作路由和画布位置是三种独立数据；拖动卡片只改变布局，不扩大任何智能体的权限。

宽窄窗口都支持直接拖动卡片，无须先进入编辑模式。点选彩色连线后，拖动来源或目标圆点到其他卡片即可修改连接，无须先打开关系表单。拖动进入未保存草稿，点击“保存规则”才发布，点击“取消草稿”恢复原状态。灰色汇报线不参与这种改线。

## 关系方向

| 类型 | 起点 → 终点 | 触发依据 |
|---|---|---|
| 派工 `dispatch` | 派工者 → 执行者 | 明确的新任务请求 `requested` |
| 验收 `review` | 执行者 → 验收者 | 已取得完成结果 `completed`，不能以 idle 代替 |
| 升级 `escalate` | 当前处理者 → 深度判断者 | 明确需要判断 `needs_judgment` |
| 通知 `notify` | 通知者 → 接收者 | 已确认的里程碑 `milestone` |

灰色线继续表示原有 `reportsTo` 汇报关系。协作线由用户编辑、保存，不自动改写上下级、权限、当前任务或 Grok 的启停状态。

## 本机规则服务

`scripts/leeva/collaboration_rules.py` 使用 Python 标准库，仅在 `127.0.0.1:3103` 提供公司范围的规则读取与发布。界面请求允许来自本机 3100 或 3101；写入检查 Origin、Host 和自定义请求头。它适用于当前本机可信用户部署，不是供远程或多租户公开访问的 API。

```sh
python3 scripts/leeva/install-collaboration-service.py
python3 scripts/leeva/install-collaboration-service.py --apply
```

规则存在用户的 `~/.paperclip/leeva/collaboration/<company-id>/`，不进入 Git。保存使用版本检查和文件锁；已发布版本保留。运行中的任务固定规则版本，外部会话映射发生变化时停止解析，暂停/审批状态仍读取实时 Paperclip 记录。

服务没有调用模型、发送消息、恢复任务或自动执行的能力。它没有替换 Paperclip 服务端、原状态同步桥接或 Grok 的例行调度。仅安装该服务不表示 Grok 已接入。

## Grok 消费规则

在原例行指令中指定本工程的绝对路径和公司 ID。每次正常触发后先读取已发布配置：

```sh
python3 /ABSOLUTE/REPO/scripts/leeva/collaboration_rules.py read --company COMPANY_UUID --consumer grok-bot
```

该命令记录“Grok 已读取版本”的回执，不是执行成功回执。无已发布规则、服务端不可用或公司无法核验时失败，不能退回硬编码路由。

每个新任务保留读取到的 `version`；在既有任务上继续使用原版本。取得明确事件后解析下一步目标：

```sh
python3 /ABSOLUTE/REPO/scripts/leeva/collaboration_rules.py resolve \
  --company COMPANY_UUID --version RULE_VERSION \
  --source SOURCE_AGENT_UUID --kind review --outcome completed \
  --task-id EXISTING_TASK_ID --event-id UNIQUE_COMPLETION_EVENT_ID
```

返回 `targets` 中的智能体与外部会话 ID。多条非通知路线需要明确指定 `--target`，不让模型猜选。暂停、待审批、未映射目标、端点身份变化、错误事件类型和禁用边均阻止路由。派工形成循环时不能发布；执行→验收这种不同类型的返回关系可以保留。

解析结果始终是 `executed:false`。Grok 仍需依据原有授权、暂停标记、任务状态及发送回执决定是否执行，并按事件 ID 去重；规则本身不授权新任务、不承担执行器的恰好一次投递，也不能证明执行成功。原生 Codex 节点若未建立已验证的外部会话映射，不能作为此桥接的执行目标。

最后接入必须单独验证：修改 Grok 例行正文但保留暂停和触发器，让它仅试读并复述版本与映射，再回读已保存的例行正文。不得为了测试擅自恢复调度或向业务智能体发消息。

## 验证

```sh
python3 -m unittest discover -s scripts/leeva -p test_collaboration_rules.py -v
```

测试使用假智能体和临时文件，HTTP 用临时 loopback 端口；覆盖改线改变解析目标、旧版本不变、并发版本冲突、暂停及审批阻断、外部映射变更、非法图和跨网站写入保护。UI 和 Grok 实际接入另行验收。

## 原应用用量接入（2026-10-19）

审计 → 费用顶部的“原应用用量”从同一本机服务读取 `GET /api/companies/:companyId/external-usage?from=ISO&to=ISO`。公司 ID 先向 Paperclip 校验，再按智能体 `metadata.externalKind/externalId` 选择会话 Token 来源。Grok 仅有账户额度，作为独立快照展示，不计入项目 Token 合计。该接口只读，沿用 loopback、Host 和 Origin 限制，不适用于远程、多租户部署。

- Codex：读取当前映射会话和明确 `subagent` 后代的本机 `token_usage_record`，按 response ID 去重，跳过继承记录、普通分叉和系统审批；直接映射的子会话单独归属。只保存用量、时间、模型与来源标识，不保存正文。
- Argon：复用相邻 `../gemini-api-bridge/gemini_api.py` 的受限只读接口，读取映射会话主轨迹的步骤用量和重试记录。只收终态记录；response ID 优先、message ID 兜底去重，不把同一次请求的重试元数据再加一次。新步骤、最近 50 步和未结束步骤增量回读。子轨迹不在范围内。
- 两种输入口径归一：Codex input 包含缓存，Argon input 不含缓存；界面分别列非缓存输入、缓存读取、缓存写入、输出。推理输出已经包含在输出内，不额外相加。相同身份出现矛盾计数时回滚该来源本轮同步，显示来源异常。
- SQLite 缓存存于 `~/.paperclip/leeva/usage/<company-id>.sqlite3`，目录 0700、数据文件 0600，包含记录去重键、增量位置和最近成功时间，不进入 Git。刷新失败保留上次成功记录；无来源、缺日志和重复映射明确显示，不以零代表未取得。
- 打开费用页时至多每分钟同步一次；首次同步在后台进行，界面短轮询缓存直到完成。关闭页面后不持续轮询。该同步只读已有记录，不调用模型、不派任务、不恢复 Grok、不改变原应用执行方式。
- 日期筛选作用于记录时间，所选时段无记录与来源未接入分别显示。金额为 null：订阅账单、积分、逐任务派工/验收/执行成本尚未接入。原生 Paperclip 费用账本不包含这些外部记录，不能把下方 `$0` 当作外部费用。

部署时重新构建并通过 `deploy-ui.mjs` 部署 UI，重启既有 `com.leeva.paperclip-rules` 服务以加载新的只读端点。无数据库迁移；不需要重启 Codex、Gemini、Grok 或 Paperclip 主服务。

### Grok 账户额度（部分接入）

- 公司含 `grok_routine` 映射时，固定读取本机已开放的 `127.0.0.1:9334`，只接受 `/Applications/Grok Bot.app` 的唯一 renderer 目标。`read-grok-usage.mjs` 通过固定的 `window.desktop.main.getCursorWeeklyUsage()` 读取额度，未提供任意脚本或远程地址参数；凭证留在 Grok 内部，不读认证文件。依赖 `/opt/homebrew/bin/node`（支持原生 fetch / WebSocket）。Grok 未运行、接口关闭或版本接口变化时显示不可用，不启动应用或开启调试。
- 已在 Grok Bot 0.71.2 验证：接口提供 `percentUsed`、`nextResetMs` 和 `grokPlanLabel`。只保存这些数值/显示字段及同步时间，舍弃其他返回字段。页面标明当前登录账号整体范围，可能包含其他项目，不随页面日期范围筛选。
- 该接口没有 Token 或请求数。底层程序虽定义聚合 Token schema，但现有公开 IPC 的返回值没有暴露这些字段，不能据此声称 Token 已接通。不会把额度百分比换算成 Token，也不会把按需费用为零理解成没有订阅用量。
- 额度作为 `grokAccount` 单独返回，Grok 行状态为 `quota_only`，Token 列显示空缺。失败保留上次快照并标注过期/可能属于此前账号；首次失败不显示零。多个例行只读一次账户额度。仅关闭本次读取的 WebSocket，保留用户已开放的调试接口，不发送消息、不改变例行启停。
- 所有源继续至多每分钟读取一次；只要页面关闭且没有其他客户端请求此端点，就不主动刷新。Grok 请求是账户查询，不是模型生成。

验证：

```sh
python3 -m unittest discover -s scripts/leeva -p test_external_usage.py -v
python3 -m unittest discover -s scripts/leeva -p test_collaboration_rules.py -v
node --test scripts/leeva/read-grok-usage.test.mjs
cd ui
./node_modules/.bin/vitest run src/components/ExternalUsagePanel.test.tsx src/pages/Costs.test.tsx
./node_modules/.bin/tsc -b
./node_modules/.bin/vite build
```

历史交叉核对：将同一时间窗口的 Argon 主轨迹与此前独立审计逐字段比较，确认请求数及每种 Token 计数一致。实际私有用量保留在本机，不提交到仓库。此项不代表全账号账单或任务性价比已核算完成。

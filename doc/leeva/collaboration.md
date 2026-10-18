# 协作图与 Grok 调度

Paperclip 首页保存协作规则，Grok Bot 保留现有调度职责。组织上下级、协作路由和画布位置是三种独立数据；拖动卡片只改变布局，不扩大任何智能体的权限。

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

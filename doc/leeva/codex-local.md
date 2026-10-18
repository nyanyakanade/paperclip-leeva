# 接入本机 Codex CLI

这个工具通过 Paperclip 官方 API 创建一个新的本机 Codex 智能体。它复用
Paperclip 服务所在机器、所在系统用户已有的 Codex 登录，**不接管 Codex
桌面应用中已经打开的会话**，也不会迁移 Chief 或已有任务。

## 默认配置

| 项目 | 值 |
| --- | --- |
| 适配器 | `codex_local` |
| 执行引擎 | `cli`，明确避开默认 ACP |
| 命令 | 从当前 `PATH` 查找 `codex`，或使用 `--command`；保存绝对路径 |
| 工作目录 | 用户提供的现有 Git 工作树目录，不自动初始化仓库 |
| 推理强度 | `modelReasoningEffort: "low"` |
| 模型 | 默认不覆盖本机配置；可用 `--model` 指定 |
| 沙箱 | `dangerouslyBypassApprovalsAndSandbox: false` |
| 定时心跳、按需唤醒 | 均关闭；并发上限为 1 |
| AI 账户绑定 | 不设置 `runtimeConfig.aiConnection` |
| 执行环境 | `defaultEnvironmentId: null`，沿用实例默认环境 |

关闭沙箱绕过不等于只读运行：当前适配器会采用 workspace-write 沙箱；实际
任务启动后仍可能写工作目录。实例默认环境必须是本机环境，不能指向 SSH
或远程沙箱。工具必须在 Paperclip 所在机器、同一个系统用户下运行；容器
里服务和宿主机 CLI 路径不相通的部署不属于这个工具的支持范围。

## 使用

要求 Node.js 24.11+、Git、Codex CLI，以及本机 `local_trusted` Paperclip。
先在自己的终端确认 `codex login status`；未登录时由用户完成 `codex login`。
工具本身不读取、复制、导出或修改 `auth.json`，也不收集 API key。

在 Paperclip 中取得目标公司 ID，并选择自己的工作树。以下命令中的大写占位符
需要替换；不要把真实公司 ID、登录资料或个人绝对路径提交到仓库。

```sh
# 默认离线预览：验证目录和命令，打印将发送的配置；不请求 API。
node scripts/leeva/codex-local.mjs \
  --company COMPANY_UUID \
  --cwd /absolute/path/to/your/git-worktree

# 确认预览后，显式创建。指定自定义命令路径和端口时也使用同一套参数。
node scripts/leeva/codex-local.mjs \
  --company COMPANY_UUID \
  --cwd /absolute/path/to/your/git-worktree \
  --command /absolute/path/to/codex \
  --base-url http://127.0.0.1:3100 \
  --name "Codex 本机" \
  --apply

node scripts/leeva/codex-local.mjs --help
```

只允许 `127.0.0.1`、`localhost`、`[::1]` 的 HTTP(S) origin；不接受外部地址、
URL 内的登录信息、路径、查询参数或跳转。不支持把认证令牌塞入命令行。
需要登录的 Paperclip 部署若返回 401/403，请使用其正式登录和管理流程。

`--apply` 只调用公司的 agents 列表、新建 agent 和读取 agent 接口；不调用
hello、心跳、任务、登录、数据库或 Chief 的修改接口。官方创建流程可能
生成智能体说明文件及审计记录；这些是正常 API 的副作用。

## 重复运行与失败

- 先查公司当前可见的非终止智能体。相同名称或工具标记已存在且配置一致，
  返回 `already-exists`，不修改、不再创建。
- 重名、配置被修改、多个匹配项或列表格式不符时停止，交由用户在界面处理。
  不自动接管同名的手工配置；也不复用已终止代理。
- 新建成功后读取代理确认配置。POST 响应丢失时只再读一次列表进行核对，
  **不会再次 POST**。无法确认则明确报告结果未知，先检查界面再决定下一步。
- 官方 401/403/409/422 错误原样保留。公司要求招聘审批时，使用官方招聘审批
  流程；工具不会关闭审批、写数据库、修改服务代码或重新提交以求通过。
- 查重不是服务器原子幂等键。不要同时运行多个创建进程；其他客户端并发创建
  也可能导致竞争。遇到超时或结果未知，不要盲目重试。

## 验证和后续启用

创建后在智能体运行设置中检查上述字段，并单独点 **Test** 做连接测试。
Test 会调用模型并消耗少量额度，不能用“配置已保存”代替调用成功。只有用户
准备开始业务任务时，才在界面启用按需唤醒或定时心跳并分配任务。

旧代理已经绑定 Paperclip 托管 AI 账户时，仅修改 CLI 路径不能解除绑定。
这个工具创建独立的新代理，保留旧代理和历史记录；没有删除绑定的隐藏入口。
请使用当前版本提供的正式账户迁移流程处理旧代理。

本机账户继承由官方 `codex_local` 适配器完成。当前实现使用 Paperclip 管理的
运行目录，从本机登录获取认证，通常以链接处理认证文件；有独立登录的既有
目录可能保留其身份。**不手动把 `CODEX_HOME` 指向用户主目录，也不复制认证
文件。** 登录继承规则可能随上游更新，升级后重新执行连接测试。

## 维护与测试

```sh
node --test scripts/leeva/codex-local.test.mjs
```

测试只使用临时 Git 工作树、不会执行的假 CLI 文件和内存 API stub；不访问
实际 Paperclip、不创建真实代理、不发模型请求。覆盖离线预览、默认约束、
路径/URL 校验、查重、官方错误保留、创建读回和响应丢失处理。

升级时核对这些官方契约，再运行测试：

- `server/src/routes/agents.ts`：`normalizeCreatedAgentRuntimeConfig`、
  `applyCodexLocalKeyIsolation`、公司 agents 的 GET/POST 路由。
- `packages/shared/src/validators/agent.ts`：新建和运行配置校验。
- `packages/adapters/codex-local/src/server/codex-args.ts`：CLI、强度和沙箱参数。
- `packages/adapters/codex-local/src/server/codex-home.ts`：本机登录继承。

此工具不修改上游 API、数据库 schema 或模型路由。工具输出含运行时填入的
路径和公司/代理 ID，仅作本机检查；不要作为公共示例提交。

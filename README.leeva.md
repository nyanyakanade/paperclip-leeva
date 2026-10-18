# paperclip-leeva

LEEVA 自用的 Paperclip 分支：简体中文界面与本机 Codex CLI 接入。

- 仓库：<https://github.com/nyanyakanade/paperclip-leeva>
- 日常维护分支：`leeva`
- 上游：<https://github.com/paperclipai/paperclip>（Git remote：`upstream`）
- 初始基线：`v2026.1012.0` / `bba6a45f0d364cfd962ac59b3bdf2426a8222adb`

## 本分支的改动

1. **中文界面**：默认简体中文；中英切换位于设置页，保留浏览器语言偏好，不放常驻浮动按钮。复用上游 i18next，旧界面文案通过源码构建转换逐步迁移；缺少翻译时显示英文。用户任务、评论、模型提示词、路径和内部标识保持原值。实现与翻译来源见 [语言维护说明](ui/src/i18n/README.md)。
2. **本机 Codex**：沿用官方 `codex_local` 适配器，明确使用 `engine: cli` 和本机命令，复用该系统用户的 Codex 登录。提供默认只预览的配置工具；推理强度默认 `low`，关闭自动唤醒和沙箱绕过。详见 [Codex 接入](doc/leeva/codex-local.md)。它会启动独立 CLI 会话，不接管 Codex 桌面应用已有聊天。
3. **组织图首页**：新增公司内 `/home` 首页，桌面默认展示现有智能体组织图，可筛选状态或切换列表；窄屏沿用列表适配。与智能体管理页复用组件和实时数据，不复制智能体。根入口和导航“首页”指向新页面，原 `/dashboard` 控制台与 `/agents/all` 管理页保留。
4. **可编辑协作图**：首页可拖动卡片、编辑派工/验收/升级/通知连线，显式保存版本。独立本机规则服务供原 Grok 调度读取，区分已发布与已读取；不因保存自动派工或恢复暂停。安装、目标映射限制和 Grok 接入步骤见 [协作图说明](doc/leeva/collaboration.md)。

仓库保存实现、模板和维护说明。运行实例的数据库、账号凭据、任务记录、日志和个人配置保存在本机，不纳入版本控制。原项目 MIT 许可和翻译贡献归属保留。

初次整理的实际通过项与未完成项见 [验证记录](doc/leeva/verification-2026-10-18.md)。

## 开发与验证

需要 Node.js 24.11+、pnpm 9.15.4。先读取根目录 [AGENTS.md](AGENTS.md)。

```sh
git clone https://github.com/nyanyakanade/paperclip-leeva.git
cd paperclip-leeva
git switch leeva
git remote add upstream https://github.com/paperclipai/paperclip.git
pnpm install --frozen-lockfile

node --test scripts/leeva/codex-local.test.mjs
pnpm --filter @paperclipai/ui exec vitest run src/i18n
pnpm check:token-gates
pnpm --filter @paperclipai/ui typecheck
pnpm --filter @paperclipai/ui build
```

使用独立数据目录和端口启动开发实例，避免碰到正在使用的 3100 实例：

```sh
PORT=3102 pnpm dev --data-dir ./tmp/leeva-dev
```

只看已构建界面时可运行下面的预览。它会把 `/api` 代理到本机 3100，因此里面的保存操作会影响该实例；仅浏览验收时不要执行业务操作。

```sh
pnpm --filter @paperclipai/ui exec vite preview --host 127.0.0.1 --port 3101
```

发布前按上游要求补跑 `pnpm -r typecheck`、`pnpm test:run`、`pnpm build`；记录实际完成范围，不能用界面构建代替全仓测试通过。

## 后续维护

在 `leeva` 上维护，功能较多时另开工作分支，合并回 `leeva`。`master` 保留上游分支用途。更新上游先备份运行实例，再在升级分支合并并验证；不要让 npm 自动更新覆盖自定义界面后再临时修改压缩 JS。

```sh
git fetch upstream --tags
git switch -c upgrade/UPSTREAM_TAG leeva
git merge UPSTREAM_TAG
# 解决冲突、验证、合并回 leeva，再推送个人 origin。
```

首个基线 tag 的锁文件缺少源码已声明的依赖。本分支同步锁文件并加入独立的 TypeScript 5 AST 构建工具依赖；上游 TypeScript 7 类型检查器保持不变。日后修改依赖时一并核验锁文件，保持冻结安装可复现。

本分支不包含自动发布、付费模型测试或凭据迁移。部署 UI 时先备份、校验上游版本，构建通过后再应用；实例服务、数据库升级与 UI 部署分别验收。

[`Leeva customization checks` 模板](doc/leeva/checks-workflow.example.yml) 检查本分支的脚本、翻译、UI 类型与构建，不请求模型。本次 GitHub 授权不包含 `workflow` 权限，因此模板尚未安装到 `.github/workflows`，没有启用远端 CI。日后使用具备相应权限的维护账号安装模板；当前以明确记录的本机检查为准。

## 更新已有的同版本安装

已有 npm 安装可以仅部署 UI，无须迁移数据库或替换 Codex 配置。先完成上述 UI 构建，再将 `SERVER_PACKAGE_DIR` 替换为已安装的 `@paperclipai/server` 包目录：

```sh
node scripts/leeva/deploy-ui.mjs --server-dir SERVER_PACKAGE_DIR
node scripts/leeva/deploy-ui.mjs --server-dir SERVER_PACKAGE_DIR --apply
# 如需恢复，使用部署输出的完整备份路径：
node scripts/leeva/deploy-ui.mjs --server-dir SERVER_PACKAGE_DIR --restore BACKUP_DIRECTORY --apply
```

工具仅接受 `2026.1012.0`，默认只检查；实际部署完整备份旧界面、保留旧资源，并在切换失败时恢复。部署后刷新网页确认效果。升级到其他上游版本时先完成兼容验证，再更新部署脚本中的版本约束。

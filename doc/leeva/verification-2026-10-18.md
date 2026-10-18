# 初次整理的验证记录（2026-10-18）

基线：上游 `v2026.1012.0`。环境：macOS、Node 24.19.0、pnpm 9.15.4。

## 本次通过

- 更新锁文件后 `pnpm install --frozen-lockfile --offline` 成功。
- `node --test scripts/leeva/codex-local.test.mjs`：11/11，通过；使用假 CLI 与内存 API，不启动模型。
- `node --test scripts/leeva/deploy-ui.test.mjs`：7/7，通过；包括部署失败回滚和备份校验。
- `pnpm --filter @paperclipai/ui exec vitest run src/i18n src/pages/ProfileSettings.test.tsx src/components/SidebarAccountMenu.test.tsx`：5 个测试文件、54/54，通过。
- UI 依赖包构建、`pnpm --filter @paperclipai/ui typecheck`、`pnpm check:token-gates` 和 `pnpm --filter @paperclipai/ui build` 通过。构建仍有上游大 chunk 与静态/动态混合导入警告。
- 浏览器在预览界面确认中文 → 英文 → 中文，以及刷新后保留语言；看板无常驻语言按钮。
- 已通过部署脚本完整备份并更新同版本本机 UI，刷新后设置页显示语言入口、全局浮层消失。数据库、服务端和智能体配置未由部署脚本修改。
- fork 的 `leeva` 分支已推送并读回，设为默认维护分支。

## 没有宣称通过的范围

- `pnpm -r typecheck` 与 `pnpm build` 均在 Paperclip Runner 的 Rust 阶段因缺少 `cargo` 停止。UI 单独检查通过不代表原生 Runner 或全仓通过。
- `pnpm test:run` 已尝试，运行服务端集成测试后中止，未取得全量汇总；不算全量测试通过。后续发布完整服务端前需在具备 Rust 工具链的环境重新完成全仓检查。
- 本次没有重复调用 Codex 模型或启动业务任务。接入工具测试验证配置与 API 交互；实际账户可用性由实例中的正式连接测试验证。
- GitHub OAuth 授权缺少 `workflow` scope，拒绝了新增 Actions 工作流的初次推送。后续改为普通文档模板后源码推送成功；远端当前没有本分支 CI 运行，不能标成 CI 通过。

原始日志和界面截图留在本机，不将实例标识、个人路径或业务记录放进公共仓库。

## 可编辑协作图补充

- 本机规则服务测试 13/13 通过；改线会改变解析目标，旧任务固定旧版本，暂停/审批、未映射目标和派工循环被阻止。
- 相关 UI 测试 5 个文件、36/36 通过；UI 类型检查、样式门禁和构建通过。
- 浏览器实际加入四种协作连线、保存、拖动卡片、再次保存并刷新回读，规则和坐标均保留；选中连线可以修改来源、目标、类型和启用状态。
- 规则服务独立安装在本机回环接口，不调用模型或派发任务。Grok 例行正文更新与真实消费验证尚待完成，发布规则不能视为调度已接通。

## 组织图首页补充

- 新增公司内 `/home` 及状态筛选路由，默认入口、首页导航、切换组织和返回应用入口指向首页；有效页面历史保留。原控制台和智能体管理页继续存在。
- 复用两种界面的 Agents 组件及现有查询，桌面首页默认组织图，窄屏使用列表。没有修改智能体数据、权限、派工或连接配置。
- 相关 Agents、Sidebar、公司路由及翻译检查 6 个文件、85 项通过；默认落点相关检查 4 个文件、46 项通过（两个批次包含重复的公司路由检查，不累计为独立测试数）。UI 类型检查、样式门禁和 UI 构建通过。
- 本机预览确认组织图显示现有智能体；状态筛选保留在 `/home/*`，公司根入口转到首页，原智能体管理页保持原默认视图。此次是 UI 部署，未重跑原生 Runner 或服务端全量测试。

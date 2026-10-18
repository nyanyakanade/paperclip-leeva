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

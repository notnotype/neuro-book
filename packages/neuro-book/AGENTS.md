# packages/neuro-book 规则

仓库共享协作、安全、Git、临时目录、报告和通用 TypeScript 规则见 [`../../AGENTS.md`](../../AGENTS.md)；本文件只补充主应用包的项目专属合同。

## 包内文档

- 主应用专属文档位于 [`docs/`](docs/)：`docs/adr/` 架构决策、`docs/migrations/` 数据迁移、`docs/runbooks/` 操作手册、`docs/research/` 与 `docs/archived/` 非规范资料、`docs/specs/foundation/` 术语与 capability Spec、`docs/proposals/` 产品提案。
- monorepo 级治理仍在根 [`docs/`](../../docs/)（specs 注册表、standards、testing、modules 边界正文与提案流程）；判断当前行为只依据根注册表登记的 `implemented` Spec。
- 主应用交付配置归本包：`Dockerfile*`、`docker-compose*.yml`、`.env.docker.example`、`.env.example`、`.env.product`、`.env.typecheck`、`config.example.yaml` 与包级 `.gitignore`。Docker build context 仍由根 monorepo 提供，根 `.dockerignore` 是 context 过滤器，不是应用源码入口。
- `.env` 与 `config.yaml` 是 State Root 的本机运行文件，不提交到源码包；Source Dev 默认把 State Root 放在平台用户数据目录，运行时 Workspace 为 State Root 下的 `workspace/`。checkout 根的 `assets/`、`workspace/` 只作为历史/用户数据隔离区，不得当作应用源码或通过启动 fallback 读取。
- Vue 组件、composable 和 store 沿用现有函数式风格；主题颜色只消费 `app/utils/theme/README.md` 登记的变量。
- 普通界面复用 `app/components/common` 与现有通知、Dialog、Tooltip、可调整面板能力。
- 前端 API 错误使用 `resolveApiErrorMessage()`；跨入口反馈使用 `useNotification()`。
- 修改 UI 后按根规则选择聚焦测试；未经明确授权不自动执行浏览器人工验收。

## 前端规范

- 通用组件优先复用 `app/components/common`：`NotificationViewport`、`Dialog`、`Tooltip` 和 `form/FormColorField`；非模态浮动窗口复用 `@notnotype/nb-ui/components` 的 `DialogWindow`。
- Novel IDE 普通界面颜色只消费 `app/utils/theme/README.md` 登记的主题变量，不新增 Tailwind 调色板或 `dark:` 变体；新增组件变量前确认现有变量无法表达，并同步登记到主题文档和 8 套内置主题。
- 状态色使用 `warning`（草稿/待审/未保存）、`success`（完成/已同步）、`danger`（错误/删除/冲突）、`info`（运行中/引用/说明）和 `accent`（选中/当前/主操作）。内容、编辑器和 chip 分类色是例外，不按状态色重写。
- World Engine 的 `--we-*` 只在 `app/styles/theme-vars.css` 的 `.world-engine-workbench-theme` 中映射；真实 Dialog 和 preview 使用该 class，不在局部样式反向覆盖全局变量。
- `ReferenceChip.vue` 只输出类别语义 class，外观统一在 `app/styles/reference-chips.css`；不要在 TipTap 或业务组件重复定义。
- 前端 API 错误使用 `resolveApiErrorMessage(error, fallback)`；跨入口、后台动作和完成后 Dialog 会关闭的反馈使用 `useNotification()`，当前表单可恢复的错误使用局部 `error` state。
- 可调整面板统一使用 `app/composables/useResizablePanel.ts`，尺寸由宿主保存，组件通过 `update:width` / `update:height` 回传。
- 用户可见文案面向第一次使用 NeuroBook 的普通作者，不出现内部类名、文件名、Task 或 Phase 编号。
